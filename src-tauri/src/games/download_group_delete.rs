//! Deliberate, confirmed removal of downloaded game data.
//! The ordinary Remove action intentionally preserves user files.
//! This operation deletes only paths verified against Harbor download records.
use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteGroup {
    pub profile: String,
    pub direct_ids: Vec<String>,
    pub torrent_ids: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeletedGroup {
    pub files: usize,
    pub folders: usize,
}

fn group_key(
    game: Option<&super::download_metadata::DownloadGame>,
    batch: Option<&str>,
    kind: &str,
    id: &str,
) -> String {
    if let Some(game) = game {
        return format!(
            "game:{}:{}",
            game.id,
            game.content_kind.as_deref().unwrap_or("game")
        );
    }
    if kind == "direct" {
        if let Some(batch) = batch {
            return format!("batch:{batch}");
        }
    }
    format!("{kind}:{id}")
}

fn safe_type(meta: &fs::Metadata) -> bool {
    if meta.file_type().is_symlink() {
        return false;
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        // Also reject junctions and other Windows reparse points.
        if meta.file_attributes() & 0x400 != 0 {
            return false;
        }
    }
    true
}
fn owned_file(path: &Path) -> Result<(), &'static str> {
    match fs::symlink_metadata(path) {
        Ok(meta) if safe_type(&meta) && meta.is_file() => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        _ => Err("games_delete_unsafe"),
    }
}
fn owned_tree(path: &Path) -> Result<(), &'static str> {
    let mut pending = vec![PathBuf::from(path)];
    let mut entries = 0usize;
    while let Some(next) = pending.pop() {
        entries = entries.saturating_add(1);
        if entries > 100_000 {
            return Err("games_delete_unsafe");
        }
        let meta = fs::symlink_metadata(&next).map_err(|_| "games_delete_unsafe")?;
        if !safe_type(&meta) {
            return Err("games_delete_unsafe");
        }
        if meta.is_dir() {
            for entry in fs::read_dir(&next).map_err(|_| "games_delete_unsafe")? {
                pending.push(entry.map_err(|_| "games_delete_unsafe")?.path());
            }
        } else if !meta.is_file() {
            return Err("games_delete_unsafe");
        }
    }
    Ok(())
}

pub async fn delete(
    app: tauri::AppHandle,
    request: DeleteGroup,
) -> Result<DeletedGroup, &'static str> {
    if request.profile.is_empty()
        || request.profile.len() > 256
        || request.direct_ids.len() + request.torrent_ids.len() == 0
        || request.direct_ids.len() + request.torrent_ids.len() > 200
    {
        return Err("games_delete_request");
    }
    let mut keys = HashSet::new();
    if request
        .direct_ids
        .iter()
        .any(|id| !keys.insert(format!("d:{id}")))
        || request
            .torrent_ids
            .iter()
            .any(|id| !keys.insert(format!("t:{id}")))
    {
        return Err("games_delete_request");
    }
    let direct = super::transfers::manager(&app)?;
    let torrent = super::p2p::manager(&app)?;
    let direct_records = direct.list(&request.profile)?;
    let torrent_records = torrent.list(&request.profile)?;
    let mut files = Vec::<(String, PathBuf, PathBuf)>::new();
    let mut folders = Vec::<(String, PathBuf)>::new();
    let mut seen_paths = HashSet::new();
    // Only accept records from the same exact game (or download batch when
    // game metadata is absent). Never let a crafted request span other games.
    let mut group = None::<String>;
    let mut ensure_group = |key: String| -> Result<(), &'static str> {
        if group.as_ref().is_some_and(|existing| *existing != key) {
            return Err("games_delete_request");
        }
        group = Some(key);
        Ok(())
    };
    for id in &request.direct_ids {
        let record = direct_records
            .iter()
            .find(|record| &record.id == id)
            .ok_or("games_delete_request")?;
        if !matches!(
            record.status,
            super::transfers::Status::Paused
                | super::transfers::Status::Failed
                | super::transfers::Status::Canceled
                | super::transfers::Status::Complete
        ) {
            return Err("games_delete_busy");
        }
        ensure_group(group_key(
            record.game.as_ref(),
            record.batch_id.as_deref(),
            "direct",
            id,
        ))?;
        direct.ensure_removable(&request.profile, id)?;
        let path = super::transfer_files::destination(&record.destination)?;
        let partial = super::transfer_files::partial(&path, id)?;
        // Never delete a path still owned by a different download record.
        if direct.destination_owned_by_another(id, &path)? || !seen_paths.insert(path.clone()) {
            return Err("games_delete_unsafe");
        }
        owned_file(&path)?;
        owned_file(&partial)?;
        files.push((id.clone(), path, partial));
    }
    for id in &request.torrent_ids {
        let record = torrent_records
            .iter()
            .find(|record| &record.id == id)
            .ok_or("games_delete_request")?;
        if !matches!(
            record.status,
            super::p2p::Status::Paused | super::p2p::Status::Failed | super::p2p::Status::Complete
        ) || record
            .sharing
            .as_ref()
            .is_some_and(|sharing| sharing.active())
        {
            return Err("games_delete_busy");
        }
        ensure_group(group_key(record.game.as_ref(), None, "torrent", id))?;
        torrent.ensure_inactive(id)?;
        let path = PathBuf::from(&record.destination);
        if !path.is_absolute()
            || path.parent().is_none()
            || !path.is_dir()
            || path.file_name().is_none()
            || !seen_paths.insert(path.clone())
        {
            return Err("games_delete_unsafe");
        }
        // Torrent roots are dedicated folders created by Harbor. Confirm their
        // marker, including profile digest and info hash, before recursive deletion.
        let marker =
            fs::read_to_string(path.join(".harbor-torrent")).map_err(|_| "games_delete_unsafe")?;
        let expected = format!(
            "{}\n{}\n{}",
            id,
            super::p2p_files::digest(request.profile.as_bytes()),
            record.info_hash
        );
        if marker != expected {
            return Err("games_delete_unsafe");
        }
        // Block overlap with any still-registered torrent or direct download.
        if torrent.directory_owned_by_another(id, &path)? || direct.any_destination_in(&path)? {
            return Err("games_delete_unsafe");
        }
        owned_tree(&path)?;
        folders.push((id.clone(), path));
    }
    // Complete the destructive work first. If a filesystem operation fails,
    // the record remains present so the user can inspect/retry without losing
    // the ownership metadata. Partial deletion is reported as an error.
    let file_count = files.len();
    let folder_count = folders.len();
    for (id, path, partial) in files {
        if path.exists() {
            fs::remove_file(&path).map_err(|_| "games_delete_failed")?;
        }
        if partial.exists() {
            fs::remove_file(&partial).map_err(|_| "games_delete_failed")?;
        }
        direct.action(&request.profile, &id, "remove")?;
    }
    for (id, path) in folders {
        fs::remove_dir_all(&path).map_err(|_| "games_delete_failed")?;
        torrent
            .action(request.profile.clone(), id, "remove".into())
            .await?;
    }
    Ok(DeletedGroup {
        files: file_count,
        folders: folder_count,
    })
}

#[cfg(test)]
#[path = "download_group_delete_tests.rs"]
mod tests;
