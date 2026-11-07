use super::db::{now_millis, track_from_row, upsert_track_in_transaction, MusicDb};
use super::MusicTrack;
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use uuid::Uuid;

const TRACK_COLUMNS: &str =
    "t.id, t.connector, t.source_id, t.title, t.artist, t.album, t.artwork, t.duration_seconds, t.resolved_url, t.media_kind, t.explicit, t.version";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MusicAlbum {
    id: i64,
    title: String,
    artist: String,
    artwork: String,
    track_count: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MusicArtist {
    id: i64,
    name: String,
    track_count: u64,
    album_count: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MusicPlaylist {
    pub id: String,
    name: String,
    created_at: String,
    pub updated_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<MusicPlaylistSource>,
    tracks: Vec<MusicTrack>,
    track_added_at: HashMap<String, String>,
}

#[derive(Clone, Serialize, Deserialize, PartialEq, Eq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct MusicPlaylistSource {
    pub connector_id: String,
    pub source_id: String,
    pub synced_at: String,
}

pub fn import_linked_playlist(
    database: &MusicDb,
    expected_generation: u64,
    connector_id: &str,
    source_id: &str,
    imported: &super::MusicPlaylistImport,
) -> Result<MusicPlaylist, String> {
    database.with_connection_at_generation(expected_generation, |connection| {
        let transaction = connection
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(|error| error.to_string())?;
        let name = unique_remote_playlist_name(&transaction, &imported.name, None)?;
        let id = Uuid::new_v4().to_string();
        let timestamp = now_millis().to_string();
        transaction.execute(
            "INSERT INTO playlists (id, name, created_at, updated_at) VALUES (?1, ?2, ?3, ?3)",
            params![id, name, timestamp],
        ).map_err(|error| error.to_string())?;
        mirror_playlist_tracks(&transaction, &id, &imported.tracks, &timestamp)?;
        transaction.execute(
            "INSERT INTO playlist_sources (playlist_id, connector_id, source_id, synced_at) VALUES (?1, ?2, ?3, ?4)",
            params![id, connector_id, source_id, timestamp],
        ).map_err(|error| error.to_string())?;
        let playlist = get_playlist(&transaction, &id)?;
        transaction.commit().map_err(|error| error.to_string())?;
        Ok(playlist)
    })
}

pub fn linked_playlist(database: &MusicDb, playlist_id: &str) -> Result<MusicPlaylist, String> {
    database.with_connection(|connection| {
        let playlist = get_playlist(connection, playlist_id)?;
        if playlist.source.is_none() {
            return Err("Music playlist is not linked".to_string());
        }
        Ok(playlist)
    })
}

pub fn sync_linked_playlist(
    database: &MusicDb,
    expected_generation: u64,
    playlist_id: &str,
    expected_source: &MusicPlaylistSource,
    expected_updated_at: &str,
    imported: &super::MusicPlaylistImport,
) -> Result<MusicPlaylist, String> {
    database.with_connection_at_generation(expected_generation, |connection| {
        let transaction = connection
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(|error| error.to_string())?;
        let current = get_playlist(&transaction, playlist_id)?;
        if current.source.as_ref() != Some(expected_source)
            || current.updated_at != expected_updated_at
        {
            return Err(
                "Music playlist changed while syncing; fetch it again before retrying".to_string(),
            );
        }
        let name = unique_remote_playlist_name(&transaction, &imported.name, Some(playlist_id))?;
        let timestamp = next_playlist_timestamp(&transaction, playlist_id)?;
        mirror_playlist_tracks(&transaction, playlist_id, &imported.tracks, &timestamp)?;
        transaction
            .execute(
                "UPDATE playlists SET name = ?2, updated_at = ?3 WHERE id = ?1",
                params![playlist_id, name, timestamp],
            )
            .map_err(|error| error.to_string())?;
        transaction
            .execute(
                "UPDATE playlist_sources SET synced_at = ?2 WHERE playlist_id = ?1",
                params![playlist_id, timestamp],
            )
            .map_err(|error| error.to_string())?;
        let playlist = get_playlist(&transaction, playlist_id)?;
        transaction.commit().map_err(|error| error.to_string())?;
        Ok(playlist)
    })
}

pub fn unlink_playlist(database: &MusicDb, playlist_id: &str) -> Result<MusicPlaylist, String> {
    database.with_connection(|connection| {
        let transaction = connection
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(|error| error.to_string())?;
        let timestamp = next_playlist_timestamp(&transaction, playlist_id)?;
        transaction
            .execute(
                "DELETE FROM playlist_sources WHERE playlist_id = ?1",
                params![playlist_id],
            )
            .map_err(|error| error.to_string())?;
        transaction
            .execute(
                "UPDATE playlists SET updated_at = ?2 WHERE id = ?1",
                params![playlist_id, timestamp],
            )
            .map_err(|error| error.to_string())?;
        let playlist = get_playlist(&transaction, playlist_id)?;
        transaction.commit().map_err(|error| error.to_string())?;
        Ok(playlist)
    })
}

fn unique_remote_playlist_name(
    transaction: &rusqlite::Transaction<'_>,
    remote_name: &str,
    excluding_id: Option<&str>,
) -> Result<String, String> {
    let base = valid_playlist_name(&remote_name.trim().chars().take(100).collect::<String>())?;
    let mut number = 1_u64;
    loop {
        let suffix = if number == 1 {
            String::new()
        } else {
            format!(" ({number})")
        };
        let candidate = format!(
            "{}{}",
            base.chars()
                .take(100 - suffix.chars().count())
                .collect::<String>(),
            suffix
        );
        let exists = transaction.query_row(
            "SELECT EXISTS(SELECT 1 FROM playlists WHERE name = ?1 COLLATE NOCASE AND (?2 IS NULL OR id <> ?2))",
            params![candidate, excluding_id],
            |row| row.get::<_, bool>(0),
        ).map_err(|error| error.to_string())?;
        if !exists {
            return Ok(candidate);
        }
        number = number
            .checked_add(1)
            .ok_or_else(|| "No unique playlist name is available".to_string())?;
    }
}

fn mirror_playlist_tracks(
    transaction: &rusqlite::Transaction<'_>,
    playlist_id: &str,
    tracks: &[MusicTrack],
    timestamp: &str,
) -> Result<(), String> {
    let dates = playlist_dates(transaction, playlist_id)?;
    transaction
        .execute(
            "DELETE FROM playlist_tracks WHERE playlist_id = ?1",
            params![playlist_id],
        )
        .map_err(|error| error.to_string())?;
    transaction
        .execute(
            "DELETE FROM playlist_track_dates WHERE playlist_id = ?1",
            params![playlist_id],
        )
        .map_err(|error| error.to_string())?;
    let mut seen = std::collections::HashSet::new();
    for track in tracks {
        if !seen.insert(&track.id) {
            continue;
        }
        upsert_track_in_transaction(transaction, track)?;
        transaction
            .execute(
                "INSERT INTO playlist_tracks (playlist_id, position, track_id) VALUES (?1, ?2, ?3)",
                params![playlist_id, (seen.len() - 1) as i64, track.id],
            )
            .map_err(|error| error.to_string())?;
        transaction.execute(
            "INSERT INTO playlist_track_dates (playlist_id, track_id, added_at) VALUES (?1, ?2, ?3)",
            params![playlist_id, track.id, dates.get(&track.id).map(String::as_str).unwrap_or(timestamp)],
        ).map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn next_playlist_timestamp(
    connection: &rusqlite::Connection,
    playlist_id: &str,
) -> Result<String, String> {
    let previous = connection
        .query_row(
            "SELECT updated_at FROM playlists WHERE id = ?1",
            params![playlist_id],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "Music playlist was not found".to_string())?;
    // This timestamp is also the sync revision: rapid edits and clock rollback must invalidate it.
    let next = previous
        .parse::<i64>()
        .unwrap_or(0)
        .checked_add(1)
        .ok_or_else(|| "Music playlist timestamp cannot advance".to_string())?;
    Ok(now_millis().max(next).to_string())
}

pub fn list_albums(database: &MusicDb) -> Result<Vec<MusicAlbum>, String> {
    database.with_connection(|connection| {
        let mut statement = connection
            .prepare(
                r#"
SELECT al.id, al.title, ar.name,
       COALESCE(NULLIF(al.artwork, ''), MAX(t.artwork), ''),
       COUNT(t.id)
FROM albums al
JOIN artists ar ON ar.id = al.artist_id
LEFT JOIN music_tracks t
  ON t.album = al.title COLLATE NOCASE AND t.artist = ar.name COLLATE NOCASE
GROUP BY al.id, al.title, ar.name, al.artwork
ORDER BY al.title COLLATE NOCASE, ar.name COLLATE NOCASE
"#,
            )
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map([], |row| {
                Ok(MusicAlbum {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    artist: row.get(2)?,
                    artwork: row.get(3)?,
                    track_count: row.get::<_, i64>(4)?.max(0) as u64,
                })
            })
            .map_err(|error| error.to_string())?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|error| error.to_string())
    })
}

pub fn list_artists(database: &MusicDb) -> Result<Vec<MusicArtist>, String> {
    database.with_connection(|connection| {
        let mut statement = connection
            .prepare(
                r#"
SELECT ar.id, ar.name, COUNT(DISTINCT t.id), COUNT(DISTINCT al.id)
FROM artists ar
LEFT JOIN music_tracks t ON t.artist = ar.name COLLATE NOCASE
LEFT JOIN albums al ON al.artist_id = ar.id
GROUP BY ar.id, ar.name
ORDER BY ar.name COLLATE NOCASE
"#,
            )
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map([], |row| {
                Ok(MusicArtist {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    track_count: row.get::<_, i64>(2)?.max(0) as u64,
                    album_count: row.get::<_, i64>(3)?.max(0) as u64,
                })
            })
            .map_err(|error| error.to_string())?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|error| error.to_string())
    })
}

pub fn list_playlists(database: &MusicDb) -> Result<Vec<MusicPlaylist>, String> {
    database.with_connection(|connection| {
        let mut statement = connection
            .prepare(
                "SELECT id, name, created_at, updated_at FROM playlists ORDER BY CAST(updated_at AS INTEGER) DESC, name COLLATE NOCASE",
            )
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                ))
            })
            .map_err(|error| error.to_string())?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|error| error.to_string())?;
        drop(statement);

        rows.into_iter()
            .map(|(id, name, created_at, updated_at)| {
                let tracks = playlist_tracks(connection, &id)?;
                let track_added_at = playlist_dates(connection, &id)?;
                Ok(MusicPlaylist {
                    source: playlist_source(connection, &id)?,
                    track_added_at,
                    id,
                    name,
                    created_at,

                    updated_at,
                    tracks,
                })
            })
            .collect()
    })
}

pub fn tracks_for_playlist(
    database: &MusicDb,
    playlist_id: &str,
) -> Result<Vec<MusicTrack>, String> {
    database.with_connection(|connection| {
        require_playlist(connection, playlist_id)?;
        playlist_tracks(connection, playlist_id)
    })
}

pub fn create_playlist(database: &MusicDb, name: &str) -> Result<MusicPlaylist, String> {
    let name = valid_playlist_name(name)?;
    let id = Uuid::new_v4().to_string();
    let timestamp = now_millis().to_string();
    database.with_connection(|connection| {
        connection
            .execute(
                "INSERT INTO playlists (id, name, created_at, updated_at) VALUES (?1, ?2, ?3, ?3)",
                params![id, name, timestamp],
            )
            .map_err(|error| error.to_string())?;
        Ok(MusicPlaylist {
            source: None,
            id,
            name,
            created_at: timestamp.clone(),
            updated_at: timestamp,
            tracks: Vec::new(),
            track_added_at: HashMap::new(),
        })
    })
}

pub fn rename_playlist(
    database: &MusicDb,
    playlist_id: &str,
    name: &str,
) -> Result<MusicPlaylist, String> {
    let name = valid_playlist_name(name)?;
    database.with_connection(|connection| {
        let transaction = connection
            .transaction()
            .map_err(|error| error.to_string())?;
        let timestamp = next_playlist_timestamp(&transaction, playlist_id)?;
        transaction
            .execute(
                "UPDATE playlists SET name = ?2, updated_at = ?3 WHERE id = ?1",
                params![playlist_id, name, timestamp],
            )
            .map_err(|error| error.to_string())?;
        transaction.commit().map_err(|error| error.to_string())?;
        get_playlist(connection, playlist_id)
    })
}

pub fn delete_playlist(database: &MusicDb, playlist_id: &str) -> Result<(), String> {
    database.with_connection(|connection| {
        let transaction = connection
            .transaction()
            .map_err(|error| error.to_string())?;
        require_playlist(&transaction, playlist_id)?;
        // The membership rows are removed explicitly rather than relying on a cascade, which
        // this schema does not declare.
        transaction
            .execute(
                "DELETE FROM playlist_tracks WHERE playlist_id = ?1",
                params![playlist_id],
            )
            .map_err(|error| error.to_string())?;
        transaction
            .execute("DELETE FROM playlists WHERE id = ?1", params![playlist_id])
            .map_err(|error| error.to_string())?;
        transaction.commit().map_err(|error| error.to_string())?;
        Ok(())
    })
}

pub fn add_to_playlist(
    database: &MusicDb,
    playlist_id: &str,
    track: &MusicTrack,
) -> Result<MusicPlaylist, String> {
    add_tracks_to_playlist(database, playlist_id, std::slice::from_ref(track))
}

pub fn add_tracks_to_playlist(
    database: &MusicDb,
    playlist_id: &str,
    tracks: &[MusicTrack],
) -> Result<MusicPlaylist, String> {
    database.with_connection(|connection| {
        let transaction = connection.transaction().map_err(|error| error.to_string())?;
        require_playlist(&transaction, playlist_id)?;
        let mut position = transaction
            .query_row(
                "SELECT COALESCE(MAX(position) + 1, 0) FROM playlist_tracks WHERE playlist_id = ?1",
                params![playlist_id],
                |row| row.get::<_, i64>(0),
            )
            .map_err(|error| error.to_string())?;
        for track in tracks {
            upsert_track_in_transaction(&transaction, track)?;
            let inserted = transaction
                .execute(
                    "INSERT OR IGNORE INTO playlist_tracks (playlist_id, position, track_id) VALUES (?1, ?2, ?3)",
                    params![playlist_id, position, track.id],
                )
                .map_err(|error| error.to_string())?;
            if inserted > 0 {
                transaction.execute(
                    "INSERT INTO playlist_track_dates (playlist_id, track_id, added_at) VALUES (?1, ?2, ?3)",
                    params![playlist_id, track.id, now_millis().to_string()],
                ).map_err(|error| error.to_string())?;
                position = position.saturating_add(1);
            }
        }
        transaction
            .execute(
                "UPDATE playlists SET updated_at = ?2 WHERE id = ?1",
                params![playlist_id, next_playlist_timestamp(&transaction, playlist_id)?],
            )
            .map_err(|error| error.to_string())?;
        transaction.commit().map_err(|error| error.to_string())?;
        get_playlist(connection, playlist_id)
    })
}

/// The order after moving one track to a new index. Pulled out of the database work so the
/// index arithmetic, which is the part that is easy to get wrong, can be tested on its own.
pub fn reordered(mut ids: Vec<String>, track_id: &str, to_index: usize) -> Vec<String> {
    let Some(from) = ids.iter().position(|id| id == track_id) else {
        return ids;
    };
    let track = ids.remove(from);
    let to = to_index.min(ids.len());
    ids.insert(to, track);
    ids
}

pub fn reorder_playlist(
    database: &MusicDb,
    playlist_id: &str,
    track_id: &str,
    to_index: usize,
) -> Result<MusicPlaylist, String> {
    database.with_connection(|connection| {
        let transaction = connection.transaction().map_err(|error| error.to_string())?;
        require_playlist(&transaction, playlist_id)?;
        let current = {
            let mut statement = transaction
                .prepare(
                    "SELECT track_id FROM playlist_tracks WHERE playlist_id = ?1 ORDER BY position",
                )
                .map_err(|error| error.to_string())?;
            let ids = statement
                .query_map(params![playlist_id], |row| row.get::<_, String>(0))
                .map_err(|error| error.to_string())?
                .collect::<rusqlite::Result<Vec<_>>>()
                .map_err(|error| error.to_string())?;
            ids
        };
        let next = reordered(current, track_id, to_index);
        transaction
            .execute(
                "DELETE FROM playlist_tracks WHERE playlist_id = ?1",
                params![playlist_id],
            )
            .map_err(|error| error.to_string())?;
        for (position, id) in next.iter().enumerate() {
            transaction
                .execute(
                    "INSERT INTO playlist_tracks (playlist_id, position, track_id) VALUES (?1, ?2, ?3)",
                    params![playlist_id, position as i64, id],
                )
                .map_err(|error| error.to_string())?;
        }
        transaction
            .execute(
                "UPDATE playlists SET updated_at = ?2 WHERE id = ?1",
                params![playlist_id, next_playlist_timestamp(&transaction, playlist_id)?],
            )
            .map_err(|error| error.to_string())?;
        transaction.commit().map_err(|error| error.to_string())?;
        get_playlist(connection, playlist_id)
    })
}

pub fn remove_from_playlist(
    database: &MusicDb,
    playlist_id: &str,
    track_id: &str,
) -> Result<MusicPlaylist, String> {
    database.with_connection(|connection| {
        let transaction = connection.transaction().map_err(|error| error.to_string())?;
        require_playlist(&transaction, playlist_id)?;
        transaction.execute(
            "DELETE FROM playlist_track_dates WHERE playlist_id = ?1 AND track_id = ?2",
            params![playlist_id, track_id],
        ).map_err(|error| error.to_string())?;
        let track_ids = {
            let mut statement = transaction
                .prepare(
                    "SELECT track_id FROM playlist_tracks WHERE playlist_id = ?1 AND track_id <> ?2 ORDER BY position",
                )
                .map_err(|error| error.to_string())?;
            let tracks = statement
                .query_map(params![playlist_id, track_id], |row| row.get::<_, String>(0))
                .map_err(|error| error.to_string())?
                .collect::<rusqlite::Result<Vec<_>>>()
                .map_err(|error| error.to_string())?;
            tracks
        };
        transaction
            .execute(
                "DELETE FROM playlist_tracks WHERE playlist_id = ?1",
                params![playlist_id],
            )
            .map_err(|error| error.to_string())?;
        for (position, remaining_id) in track_ids.iter().enumerate() {
            transaction
                .execute(
                    "INSERT INTO playlist_tracks (playlist_id, position, track_id) VALUES (?1, ?2, ?3)",
                    params![playlist_id, position as i64, remaining_id],
                )
                .map_err(|error| error.to_string())?;
        }
        transaction
            .execute(
                "UPDATE playlists SET updated_at = ?2 WHERE id = ?1",
                params![playlist_id, next_playlist_timestamp(&transaction, playlist_id)?],
            )
            .map_err(|error| error.to_string())?;
        transaction.commit().map_err(|error| error.to_string())?;
        get_playlist(connection, playlist_id)
    })
}

fn get_playlist(
    connection: &rusqlite::Connection,
    playlist_id: &str,
) -> Result<MusicPlaylist, String> {
    let row = connection
        .query_row(
            "SELECT id, name, created_at, updated_at FROM playlists WHERE id = ?1",
            params![playlist_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                ))
            },
        )
        .optional()
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "Music playlist was not found".to_string())?;
    Ok(MusicPlaylist {
        source: playlist_source(connection, playlist_id)?,
        id: row.0,
        name: row.1,
        created_at: row.2,
        updated_at: row.3,
        tracks: playlist_tracks(connection, playlist_id)?,
        track_added_at: playlist_dates(connection, playlist_id)?,
    })
}

fn playlist_source(
    connection: &rusqlite::Connection,
    playlist_id: &str,
) -> Result<Option<MusicPlaylistSource>, String> {
    connection.query_row(
        "SELECT connector_id, source_id, synced_at FROM playlist_sources WHERE playlist_id = ?1",
        params![playlist_id],
        |row| Ok(MusicPlaylistSource {
            connector_id: row.get(0)?,
            source_id: row.get(1)?,
            synced_at: row.get(2)?,
        }),
    ).optional().map_err(|error| error.to_string())
}

fn playlist_dates(
    connection: &rusqlite::Connection,
    playlist_id: &str,
) -> Result<HashMap<String, String>, String> {
    let mut statement = connection
        .prepare("SELECT track_id, added_at FROM playlist_track_dates WHERE playlist_id = ?1")
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(params![playlist_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|error| error.to_string())?;
    rows.collect::<rusqlite::Result<HashMap<_, _>>>()
        .map_err(|error| error.to_string())
}

fn playlist_tracks(
    connection: &rusqlite::Connection,
    playlist_id: &str,
) -> Result<Vec<MusicTrack>, String> {
    let sql = format!(
        "SELECT {TRACK_COLUMNS} FROM playlist_tracks p JOIN music_tracks t ON t.id = p.track_id WHERE p.playlist_id = ?1 ORDER BY p.position"
    );
    let mut statement = connection
        .prepare(&sql)
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(params![playlist_id], track_from_row)
        .map_err(|error| error.to_string())?;
    rows.collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|error| error.to_string())
}

fn require_playlist(connection: &rusqlite::Connection, playlist_id: &str) -> Result<(), String> {
    let exists = connection
        .query_row(
            "SELECT 1 FROM playlists WHERE id = ?1",
            params![playlist_id],
            |_| Ok(()),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    exists.ok_or_else(|| "Music playlist was not found".to_string())
}

fn valid_playlist_name(name: &str) -> Result<String, String> {
    let name = name.trim();
    if name.is_empty() || name.chars().count() > 100 {
        return Err("Playlist name must be between 1 and 100 characters".to_string());
    }
    Ok(name.to_string())
}

#[cfg(test)]
mod tests {
    use super::super::MusicPlaylistImport;
    use super::*;

    fn imported(name: &str, ids: &[&str]) -> MusicPlaylistImport {
        MusicPlaylistImport {
            name: name.to_string(),
            tracks: ids
                .iter()
                .map(|id| track(id, id, Some("Absolution")))
                .collect(),
        }
    }

    fn stored(database: &MusicDb, id: &str) -> MusicPlaylist {
        database
            .with_connection(|connection| get_playlist(connection, id))
            .unwrap()
    }

    fn snapshot(playlist: &MusicPlaylist) -> serde_json::Value {
        serde_json::to_value(playlist).unwrap()
    }

    struct ProfileDatabases(std::path::PathBuf);

    impl ProfileDatabases {
        fn new() -> Self {
            Self(std::env::temp_dir().join(format!("harbor-music-profiles-{}", Uuid::new_v4())))
        }

        fn path(&self, profile: &str) -> std::path::PathBuf {
            self.0.join(format!("{profile}.sqlite"))
        }
    }

    impl Drop for ProfileDatabases {
        fn drop(&mut self) {
            std::fs::remove_dir_all(&self.0).expect("remove test profile databases");
        }
    }

    #[test]
    fn linked_import_rejects_a_profile_switch_without_writing_to_the_new_database() {
        let profiles = ProfileDatabases::new();
        let database = MusicDb::new();
        database.initialize(&profiles.path("a")).unwrap();
        let generation = database.generation().unwrap();
        let remote = imported("From A", &["remote-track"]);

        database.initialize(&profiles.path("b")).unwrap();
        let local = create_playlist(&database, "Local B").unwrap();
        let local = add_to_playlist(&database, &local.id, &track("local-b", "Local", None)).unwrap();
        let before = snapshot(&local);
        let result = import_linked_playlist(&database, generation, "youtube", "remote", &remote);

        assert!(result.is_err(), "a stale import must not commit to profile B");
        assert_eq!(list_playlists(&database).unwrap().len(), 1);
        assert_eq!(snapshot(&stored(&database, &local.id)), before);
        assert!(database.get_track("remote-track").unwrap().is_none());
        assert_eq!(list_artists(&database).unwrap().len(), 1);
        assert!(list_albums(&database).unwrap().is_empty());
    }

    #[test]
    fn linked_sync_rejects_a_profile_switch_even_with_an_identical_playlist_snapshot() {
        let profiles = ProfileDatabases::new();
        let database = MusicDb::new();
        database.initialize(&profiles.path("a")).unwrap();
        let generation = database.generation().unwrap();
        let original = import_linked_playlist(
            &database,
            generation,
            "youtube",
            "remote",
            &imported("Original", &["one"]),
        )
        .unwrap();

        database.initialize(&profiles.path("b")).unwrap();
        database
            .with_connection(|connection| {
                connection
                    .execute(
                        "ATTACH DATABASE ?1 AS profile_a",
                        params![profiles.path("a").to_str().unwrap()],
                    )
                    .map_err(|error| error.to_string())?;
                connection
                    .execute_batch(
                        "INSERT INTO artists SELECT * FROM profile_a.artists;
                         INSERT INTO albums SELECT * FROM profile_a.albums;
                         INSERT INTO music_tracks SELECT * FROM profile_a.music_tracks;
                         INSERT INTO playlists SELECT * FROM profile_a.playlists;
                         INSERT INTO playlist_tracks SELECT * FROM profile_a.playlist_tracks;
                         INSERT INTO playlist_track_dates SELECT * FROM profile_a.playlist_track_dates;
                         INSERT INTO playlist_sources SELECT * FROM profile_a.playlist_sources;
                         DETACH DATABASE profile_a;",
                    )
                    .map_err(|error| error.to_string())
            })
            .unwrap();
        let before = snapshot(&stored(&database, &original.id));
        let mut remote = imported("Must not overwrite B", &["one", "new"]);
        remote.tracks[0].title = "Changed title".into();
        let result = sync_linked_playlist(
            &database,
            generation,
            &original.id,
            original.source.as_ref().unwrap(),
            &original.updated_at,
            &remote,
        );

        assert!(result.is_err(), "a stale sync must not commit to profile B");
        assert_eq!(snapshot(&stored(&database, &original.id)), before);
        assert_eq!(list_playlists(&database).unwrap().len(), 1);
        assert!(database.get_track("new").unwrap().is_none());
    }

    #[test]
    fn linked_writes_reject_a_profile_switch_back_to_the_original_path() {
        let profiles = ProfileDatabases::new();
        let database = MusicDb::new();
        database.initialize(&profiles.path("a")).unwrap();
        let generation = database.generation().unwrap();
        let original = import_linked_playlist(
            &database,
            generation,
            "youtube",
            "remote",
            &imported("Original", &["one"]),
        )
        .unwrap();
        let remote = imported("Stale", &["new"]);

        database.initialize(&profiles.path("b")).unwrap();
        database.initialize(&profiles.path("a")).unwrap();
        assert!(import_linked_playlist(&database, generation, "youtube", "remote", &remote).is_err());
        assert!(sync_linked_playlist(
            &database,
            generation,
            &original.id,
            original.source.as_ref().unwrap(),
            &original.updated_at,
            &remote,
        )
        .is_err());
        assert_eq!(
            snapshot(&stored(&database, &original.id)),
            snapshot(&original)
        );
        assert_eq!(list_playlists(&database).unwrap().len(), 1);
        assert!(database.get_track("new").unwrap().is_none());
    }

    #[test]
    fn linked_writes_remain_valid_after_repeated_same_path_initialization() {
        let profiles = ProfileDatabases::new();
        let database = MusicDb::new();
        database.initialize(&profiles.path("a")).unwrap();
        let generation = database.generation().unwrap();
        let remote = imported("Original", &["one"]);
        database.initialize(&profiles.path("a")).unwrap();
        database.initialize(&profiles.path("a")).unwrap();
        let original =
            import_linked_playlist(&database, generation, "youtube", "remote", &remote).unwrap();
        database.initialize(&profiles.path("a")).unwrap();
        let mirrored = sync_linked_playlist(
            &database,
            generation,
            &original.id,
            original.source.as_ref().unwrap(),
            &original.updated_at,
            &imported("Updated", &["two"]),
        )
        .unwrap();
        assert_eq!(mirrored.name, "Updated");
        assert_eq!(mirrored.tracks[0].id, "two");
        assert_eq!(
            snapshot(&stored(&database, &original.id)),
            snapshot(&mirrored)
        );
    }

    fn sync(
        database: &MusicDb,
        playlist: &MusicPlaylist,
        imported: &MusicPlaylistImport,
    ) -> MusicPlaylist {
        sync_linked_playlist(
            database,
            database.generation().unwrap(),
            &playlist.id,
            playlist.source.as_ref().unwrap(),
            &playlist.updated_at,
            imported,
        )
        .unwrap()
    }

    #[test]
    fn linked_import_persists_source_metadata_memberships_and_unique_remote_names() {
        let database = MusicDb::in_memory();
        create_playlist(&database, "evening").unwrap();
        let remote = imported("  Evening  ", &["one", "two", "one"]);
        let first = import_linked_playlist(
            &database,
            database.generation().unwrap(),
            "youtube",
            "remote",
            &remote,
        )
        .unwrap();
        assert_eq!(first.name, "Evening (2)");
        assert_eq!(
            first
                .tracks
                .iter()
                .map(|track| track.id.as_str())
                .collect::<Vec<_>>(),
            ["one", "two"]
        );
        assert_eq!(first.track_added_at.len(), 2);
        assert_eq!(first.track_added_at["one"], first.created_at);
        assert_eq!(first.source.as_ref().unwrap().connector_id, "youtube");
        assert_eq!(first.source.as_ref().unwrap().source_id, "remote");
        assert_eq!(first.source.as_ref().unwrap().synced_at, first.updated_at);
        assert_eq!(
            snapshot(&linked_playlist(&database, &first.id).unwrap()),
            snapshot(&first)
        );
        let listed = list_playlists(&database)
            .unwrap()
            .into_iter()
            .find(|playlist| playlist.id == first.id)
            .unwrap();
        assert_eq!(snapshot(&listed), snapshot(&first));
        let source = first.source.as_ref().unwrap();
        assert_eq!(
            serde_json::from_value::<MusicPlaylistSource>(snapshot(&first)["source"].clone())
                .unwrap(),
            *source
        );
        assert_eq!(snapshot(&first)["source"]["connectorId"], "youtube");
        let second = import_linked_playlist(
            &database,
            database.generation().unwrap(),
            "youtube",
            "remote",
            &remote,
        )
        .unwrap();
        assert_eq!(second.name, "Evening (3)");
        assert_ne!(first.id, second.id);
        let saved_track = database.get_track("one").unwrap().unwrap();
        assert_eq!(saved_track.album.as_deref(), Some("Absolution"));
        assert_eq!(saved_track.artwork, "cover.jpg");
        assert_eq!(saved_track.duration_seconds, 180);
        assert_eq!(list_albums(&database).unwrap().len(), 1);
    }

    #[test]
    fn linked_remote_titles_are_truncated_with_suffix_but_local_naming_is_unchanged() {
        let database = MusicDb::in_memory();
        let long = "界".repeat(140);
        assert!(create_playlist(&database, &long).is_err());
        let first = import_linked_playlist(
            &database,
            database.generation().unwrap(),
            "youtube",
            "remote",
            &imported(&long, &[]),
        )
        .unwrap();
        let second = import_linked_playlist(
            &database,
            database.generation().unwrap(),
            "youtube",
            "remote",
            &imported(&long, &[]),
        )
        .unwrap();
        assert_eq!(first.name, "界".repeat(100));
        assert_eq!(second.name, format!("{} (2)", "界".repeat(96)));
        assert_eq!(second.name.chars().count(), 100);
        assert!(create_playlist(&database, &first.name).is_err());
        assert!(rename_playlist(&database, &first.id, &long).is_err());
        assert!(import_linked_playlist(
            &database,
            database.generation().unwrap(),
            "youtube",
            "remote",
            &imported("  ", &[]),
        )
        .is_err());
    }

    #[test]
    fn linked_mirror_follows_remote_order_name_and_membership_dates() {
        let database = MusicDb::in_memory();
        let original = import_linked_playlist(
            &database,
            database.generation().unwrap(),
            "youtube",
            "remote",
            &imported("Before", &["one", "two", "three"]),
        )
        .unwrap();
        create_playlist(&database, "after").unwrap();
        database
            .with_connection(|connection| {
                connection
                    .execute(
                        "UPDATE playlist_track_dates SET added_at = '10' WHERE playlist_id = ?1",
                        params![original.id],
                    )
                    .map_err(|error| error.to_string())?;
                Ok(())
            })
            .unwrap();
        let mut remote = imported("After", &["three", "four", "one", "four"]);
        remote.tracks[0].title = "Refreshed".into();
        remote.tracks[3].title = "Duplicate must not win".into();
        let mirrored = sync(&database, &original, &remote);
        assert_eq!(mirrored.name, "After (2)");
        assert_eq!(
            mirrored
                .tracks
                .iter()
                .map(|track| track.id.as_str())
                .collect::<Vec<_>>(),
            ["three", "four", "one"]
        );
        assert_eq!(mirrored.tracks[0].title, "Refreshed");
        assert_eq!(mirrored.tracks[1].title, "four");
        assert_eq!(mirrored.track_added_at["one"], "10");
        assert_eq!(mirrored.track_added_at["three"], "10");
        assert_eq!(mirrored.track_added_at["four"], mirrored.updated_at);
        assert!(!mirrored.track_added_at.contains_key("two"));
        assert!(
            mirrored.updated_at.parse::<i64>().unwrap()
                > original.updated_at.parse::<i64>().unwrap()
        );
        assert_eq!(
            mirrored.source.as_ref().unwrap().synced_at,
            mirrored.updated_at
        );
        assert_eq!(
            snapshot(&stored(&database, &original.id)),
            snapshot(&mirrored)
        );
        let again = sync(&database, &mirrored, &remote);
        assert_eq!(
            again.name, "After (2)",
            "exclude this playlist from name collisions"
        );
        assert_eq!(again.track_added_at, mirrored.track_added_at);
    }

    #[test]
    fn linked_mirror_accepts_an_empty_snapshot_without_touching_other_playlists_or_queue() {
        let database = MusicDb::in_memory();
        let linked = import_linked_playlist(
            &database,
            database.generation().unwrap(),
            "youtube",
            "remote",
            &imported("Linked", &["one", "two"]),
        )
        .unwrap();
        let other = create_playlist(&database, "Other").unwrap();
        let other = add_tracks_to_playlist(
            &database,
            &other.id,
            &[
                track("one", "one", Some("Absolution")),
                track("unrelated", "Unrelated", None),
            ],
        )
        .unwrap();
        let other_linked = import_linked_playlist(
            &database,
            database.generation().unwrap(),
            "youtube",
            "other-remote",
            &imported("Other linked", &["three"]),
        )
        .unwrap();
        database
            .with_connection(|connection| {
                connection
                    .execute("INSERT INTO music_queue VALUES (0, 'one')", [])
                    .map_err(|error| error.to_string())?;
                Ok(())
            })
            .unwrap();
        let empty = sync(&database, &linked, &imported("Empty", &[]));
        assert_eq!(empty.name, "Empty");
        assert!(empty.tracks.is_empty());
        assert!(empty.track_added_at.is_empty());
        assert!(empty.source.is_some());
        assert_eq!(snapshot(&stored(&database, &other.id)), snapshot(&other));
        assert_eq!(
            snapshot(&linked_playlist(&database, &other_linked.id).unwrap()),
            snapshot(&other_linked)
        );
        database
            .with_connection(|connection| {
                assert_eq!(
                    connection
                        .query_row(
                            "SELECT track_id FROM music_queue WHERE position = 0",
                            [],
                            |row| row.get::<_, String>(0)
                        )
                        .unwrap(),
                    "one"
                );
                Ok(())
            })
            .unwrap();
        assert!(database.get_track("two").unwrap().is_some());
    }

    #[test]
    fn linked_unlink_preserves_contents_and_delete_cascades_the_source() {
        let database = MusicDb::in_memory();
        let linked = import_linked_playlist(
            &database,
            database.generation().unwrap(),
            "youtube",
            "remote",
            &imported("Linked", &["one"]),
        )
        .unwrap();
        let unlinked = unlink_playlist(&database, &linked.id).unwrap();
        assert!(unlinked.source.is_none());
        assert!(snapshot(&unlinked).get("source").is_none());
        assert_eq!(unlinked.name, linked.name);
        assert_eq!(unlinked.created_at, linked.created_at);
        assert_eq!(unlinked.track_added_at, linked.track_added_at);
        assert_eq!(unlinked.tracks[0].id, "one");
        assert_ne!(unlinked.updated_at, linked.updated_at);
        assert!(linked_playlist(&database, &linked.id).is_err());
        assert!(sync_linked_playlist(
            &database,
            database.generation().unwrap(),
            &linked.id,
            linked.source.as_ref().unwrap(),
            &linked.updated_at,
            &imported("Remote", &[])
        )
        .is_err());
        let deletable = import_linked_playlist(
            &database,
            database.generation().unwrap(),
            "youtube",
            "remote",
            &imported("Delete", &["one"]),
        )
        .unwrap();
        delete_playlist(&database, &deletable.id).unwrap();
        assert!(linked_playlist(&database, &deletable.id).is_err());
        assert!(sync_linked_playlist(
            &database,
            database.generation().unwrap(),
            &deletable.id,
            deletable.source.as_ref().unwrap(),
            &deletable.updated_at,
            &imported("Remote", &[])
        )
        .is_err());
        assert!(unlink_playlist(&database, "missing").is_err());
        database
            .with_connection(|connection| {
                assert_eq!(
                    connection
                        .query_row("SELECT COUNT(*) FROM playlist_sources", [], |row| row
                            .get::<_, i64>(0))
                        .unwrap(),
                    0
                );
                Ok(())
            })
            .unwrap();
        assert!(database.get_track("one").unwrap().is_some());
    }

    #[test]
    fn linked_source_is_absent_from_every_local_playlist_output() {
        let database = MusicDb::in_memory();
        let created = create_playlist(&database, "Local").unwrap();
        let added = add_to_playlist(&database, &created.id, &track("one", "One", None)).unwrap();
        let renamed = rename_playlist(&database, &created.id, "Rename").unwrap();
        let reordered = reorder_playlist(&database, &created.id, "one", 0).unwrap();
        let removed = remove_from_playlist(&database, &created.id, "one").unwrap();
        for playlist in [created, added, renamed, reordered, removed]
            .into_iter()
            .chain(list_playlists(&database).unwrap())
        {
            assert!(playlist.source.is_none());
            assert!(snapshot(&playlist).get("source").is_none());
            assert!(linked_playlist(&database, &playlist.id).is_err());
        }
    }

    #[test]
    fn linked_import_rolls_back_all_writes_if_source_storage_fails() {
        let database = MusicDb::in_memory();
        let local = create_playlist(&database, "Local").unwrap();
        database.with_connection(|connection| connection.execute_batch(
            "CREATE TRIGGER fail_source BEFORE INSERT ON playlist_sources BEGIN SELECT RAISE(ABORT, 'source failed'); END;",
        ).map_err(|error| error.to_string())).unwrap();
        assert!(import_linked_playlist(
            &database,
            database.generation().unwrap(),
            "youtube",
            "remote",
            &imported("Remote", &["one"])
        )
        .unwrap_err()
        .contains("source failed"));
        assert_eq!(list_playlists(&database).unwrap().len(), 1);
        assert_eq!(snapshot(&stored(&database, &local.id)), snapshot(&local));
        assert!(database.get_track("one").unwrap().is_none());
        assert!(list_artists(&database).unwrap().is_empty());
        assert!(list_albums(&database).unwrap().is_empty());
        database
            .with_connection(|connection| {
                for table in [
                    "playlist_tracks",
                    "playlist_track_dates",
                    "playlist_sources",
                ] {
                    assert_eq!(
                        connection
                            .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| row
                                .get::<_, i64>(0))
                            .unwrap(),
                        0
                    );
                }
                Ok(())
            })
            .unwrap();
    }

    #[test]
    fn linked_mirror_rolls_back_tracks_dates_name_and_source_on_a_late_write_failure() {
        let database = MusicDb::in_memory();
        let original = import_linked_playlist(
            &database,
            database.generation().unwrap(),
            "youtube",
            "remote",
            &imported("Original", &["one", "two"]),
        )
        .unwrap();
        database.with_connection(|connection| connection.execute_batch(
            "CREATE TRIGGER fail_sync BEFORE UPDATE ON playlist_sources BEGIN SELECT RAISE(ABORT, 'sync failed'); END;",
        ).map_err(|error| error.to_string())).unwrap();
        let mut remote = imported("Changed", &["one", "new"]);
        remote.tracks[0].title = "Must roll back".into();
        assert!(sync_linked_playlist(
            &database,
            database.generation().unwrap(),
            &original.id,
            original.source.as_ref().unwrap(),
            &original.updated_at,
            &remote
        )
        .unwrap_err()
        .contains("sync failed"));
        assert_eq!(
            snapshot(&stored(&database, &original.id)),
            snapshot(&original)
        );
        assert!(database.get_track("new").unwrap().is_none());
    }

    #[test]
    fn linked_mirror_guards_every_source_field_and_the_updated_at_snapshot() {
        let database = MusicDb::in_memory();
        let original = import_linked_playlist(
            &database,
            database.generation().unwrap(),
            "youtube",
            "remote",
            &imported("Original", &["one"]),
        )
        .unwrap();
        let remote = imported("Must not overwrite", &["new"]);
        let source = original.source.as_ref().unwrap();
        for field in 0..4 {
            let mut expected_source = source.clone();
            let mut expected_updated_at = original.updated_at.clone();
            match field {
                0 => expected_source.connector_id = "different".into(),
                1 => expected_source.source_id = "different".into(),
                2 => expected_source.synced_at = "different".into(),
                _ => expected_updated_at = "different".into(),
            }
            assert!(sync_linked_playlist(
                &database,
                database.generation().unwrap(),
                &original.id,
                &expected_source,
                &expected_updated_at,
                &remote
            )
            .is_err());
            assert_eq!(
                snapshot(&stored(&database, &original.id)),
                snapshot(&original)
            );
            assert!(database.get_track("new").unwrap().is_none());
        }
        let current = sync(&database, &original, &imported("Original", &["one"]));
        assert!(sync_linked_playlist(
            &database,
            database.generation().unwrap(),
            &original.id,
            source,
            &original.updated_at,
            &remote
        )
        .is_err());
        assert_eq!(
            snapshot(&stored(&database, &original.id)),
            snapshot(&current)
        );
        assert!(database.get_track("new").unwrap().is_none());
    }

    #[test]
    fn linked_local_edits_advance_the_guard_even_with_a_clock_behind_the_stored_timestamp() {
        for edit in 0..4 {
            let database = MusicDb::in_memory();
            let linked = import_linked_playlist(
                &database,
                database.generation().unwrap(),
                "youtube",
                "remote",
                &imported("Linked", &["one", "two"]),
            )
            .unwrap();
            database
                .with_connection(|connection| {
                    connection
                        .execute(
                            "UPDATE playlists SET updated_at = ?2 WHERE id = ?1",
                            params![linked.id, (now_millis() + 60_000).to_string()],
                        )
                        .map_err(|error| error.to_string())?;
                    Ok(())
                })
                .unwrap();
            let before = linked_playlist(&database, &linked.id).unwrap();
            let edited = match edit {
                0 => rename_playlist(&database, &linked.id, "User edit").unwrap(),
                1 => add_to_playlist(&database, &linked.id, &track("new", "New", None)).unwrap(),
                2 => reorder_playlist(&database, &linked.id, "two", 0).unwrap(),
                _ => remove_from_playlist(&database, &linked.id, "one").unwrap(),
            };
            assert!(
                edited.updated_at.parse::<i64>().unwrap()
                    > before.updated_at.parse::<i64>().unwrap()
            );
            assert!(sync_linked_playlist(
                &database,
                database.generation().unwrap(),
                &before.id,
                before.source.as_ref().unwrap(),
                &before.updated_at,
                &imported("Overwrite", &[])
            )
            .is_err());
            assert_eq!(snapshot(&stored(&database, &before.id)), snapshot(&edited));
        }
    }

    fn track(id: &str, title: &str, album: Option<&str>) -> MusicTrack {
        MusicTrack {
            explicit: None,
            version: None,
            media_kind: None,
            id: id.to_string(),
            connector_id: Some("youtube".to_string()),
            source_id: Some(id.to_string()),
            playback_url: None,
            title: title.to_string(),
            artist: "Muse".to_string(),
            album: album.map(str::to_string),
            artwork: "cover.jpg".to_string(),
            duration_seconds: 180,
            duration_label: "3:00".to_string(),
        }
    }

    #[test]
    fn membership_dates_survive_reordering_and_remove_only_with_membership() {
        let database = MusicDb::in_memory();
        let songs = [track("one", "One", None), track("two", "Two", None)];
        let playlist = create_playlist(&database, "Dates").unwrap();
        let added = add_tracks_to_playlist(&database, &playlist.id, &songs).unwrap();
        assert_eq!(added.track_added_at.len(), 2);
        let duplicate = add_to_playlist(&database, &playlist.id, &songs[0]).unwrap();
        assert_eq!(duplicate.track_added_at, added.track_added_at);
        let moved = reorder_playlist(&database, &playlist.id, "two", 0).unwrap();
        assert_eq!(moved.track_added_at, added.track_added_at);
        let removed = remove_from_playlist(&database, &playlist.id, "one").unwrap();
        assert_eq!(removed.track_added_at.len(), 1);
        assert_eq!(
            removed.track_added_at.get("two"),
            added.track_added_at.get("two")
        );
        let reread = list_playlists(&database).unwrap();
        assert_eq!(reread[0].track_added_at, removed.track_added_at);
        delete_playlist(&database, &playlist.id).unwrap();
        database
            .with_connection(|connection| {
                assert!(playlist_dates(connection, &playlist.id)?.is_empty());
                Ok(())
            })
            .unwrap();
    }

    #[test]
    fn reordering_moves_one_track_and_leaves_the_rest_in_order() {
        let ids = || {
            vec![
                "a".to_string(),
                "b".to_string(),
                "c".to_string(),
                "d".to_string(),
            ]
        };
        assert_eq!(reordered(ids(), "a", 2), vec!["b", "c", "a", "d"]);
        assert_eq!(reordered(ids(), "d", 0), vec!["d", "a", "b", "c"]);
        assert_eq!(
            reordered(ids(), "b", 1),
            ids(),
            "moving to its own index is a no-op"
        );
        assert_eq!(
            reordered(ids(), "a", 99),
            vec!["b", "c", "d", "a"],
            "past the end clamps"
        );
        assert_eq!(
            reordered(ids(), "missing", 0),
            ids(),
            "an unknown track changes nothing"
        );
        assert_eq!(reordered(Vec::new(), "a", 0), Vec::<String>::new());
    }

    #[test]
    fn reordering_a_playlist_persists_the_new_order() {
        let database = MusicDb::in_memory();
        let songs = [
            track("one", "One", Some("Absolution")),
            track("two", "Two", Some("Absolution")),
            track("three", "Three", Some("Absolution")),
        ];
        for song in &songs {
            database.upsert_track(song).expect("store track");
        }
        let playlist = create_playlist(&database, "Evening").expect("create playlist");
        add_tracks_to_playlist(&database, &playlist.id, &songs).expect("add tracks");

        let moved = reorder_playlist(&database, &playlist.id, "three", 0).expect("reorder");
        let order: Vec<_> = moved.tracks.iter().map(|t| t.id.as_str()).collect();
        assert_eq!(order, vec!["three", "one", "two"]);

        let reread = list_playlists(&database).expect("list");
        let stored: Vec<_> = reread[0].tracks.iter().map(|t| t.id.as_str()).collect();
        assert_eq!(
            stored,
            vec!["three", "one", "two"],
            "the order survives a reread"
        );
    }

    #[test]
    fn reordering_an_unknown_playlist_is_an_error() {
        let database = MusicDb::in_memory();
        assert!(reorder_playlist(&database, "missing", "a", 0).is_err());
    }

    #[test]
    fn a_playlist_can_be_renamed_and_deleted() {
        let database = MusicDb::in_memory();
        let song = track("one", "One", Some("Absolution"));
        database.upsert_track(&song).expect("store track");
        let playlist = create_playlist(&database, "Evening").expect("create playlist");
        add_to_playlist(&database, &playlist.id, &song).expect("add track");

        let renamed = rename_playlist(&database, &playlist.id, "  Late night  ")
            .expect("rename the playlist");
        assert_eq!(renamed.name, "Late night", "the stored name is trimmed");
        assert_eq!(renamed.tracks.len(), 1, "renaming leaves the tracks alone");

        delete_playlist(&database, &playlist.id).expect("delete the playlist");
        assert!(
            list_playlists(&database)
                .expect("list playlists")
                .is_empty(),
            "the playlist is gone"
        );
        assert!(
            database.get_track("one").expect("read track").is_some(),
            "deleting a playlist must not take the tracks with it"
        );
    }

    #[test]
    fn renaming_rejects_an_empty_name_and_an_unknown_playlist() {
        let database = MusicDb::in_memory();
        let playlist = create_playlist(&database, "Evening").expect("create playlist");
        assert!(rename_playlist(&database, &playlist.id, "   ").is_err());
        assert!(rename_playlist(&database, "missing", "Anything").is_err());
        assert!(delete_playlist(&database, "missing").is_err());
    }

    #[test]
    fn native_library_derives_metadata_and_persists_playlists() {
        let database = MusicDb::in_memory();
        let first = track("one", "One", Some("Absolution"));
        let second = track("two", "Two", Some("Absolution"));
        database.upsert_track(&first).expect("store first track");
        database.upsert_track(&second).expect("store second track");

        let albums = list_albums(&database).expect("list albums");
        let artists = list_artists(&database).expect("list artists");
        assert_eq!(albums.len(), 1);
        assert_eq!(albums[0].track_count, 2);
        assert_eq!(artists[0].track_count, 2);

        let playlist = create_playlist(&database, "Drive").expect("create playlist");
        add_to_playlist(&database, &playlist.id, &first).expect("add first track");
        add_to_playlist(&database, &playlist.id, &second).expect("add second track");
        let playlists = list_playlists(&database).expect("list playlists");
        assert_eq!(playlists[0].tracks.len(), 2);

        let updated =
            remove_from_playlist(&database, &playlist.id, &first.id).expect("remove first track");
        assert_eq!(updated.tracks.len(), 1);
        assert_eq!(updated.tracks[0].id, second.id);
    }
}
