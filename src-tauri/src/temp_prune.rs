use std::path::PathBuf;
use std::time::{Duration, SystemTime};

const UPDATER_KEEP: usize = 1;
const RECENT_GRACE: Duration = Duration::from_secs(60 * 60);
const ORPHAN_MAX_AGE: Duration = Duration::from_secs(24 * 60 * 60);

fn is_updater_dir(name: &str) -> bool {
    name.starts_with("Harbor-") && name.contains("-updater-")
}

fn is_orphan_dir(name: &str) -> bool {
    name.starts_with("harbor-hls-")
        || name.starts_with("harbor-update-")
        || name == "harbor-castsubs"
}

fn sweep_prepared_subtitles_at(temp_dir: &std::path::Path, now: SystemTime) {
    let prepared = temp_dir.join("harbor-subs").join("prepared");
    let Ok(entries) = std::fs::read_dir(&prepared) else {
        return;
    };
    for entry in entries.flatten() {
        let Ok(meta) = entry.metadata() else {
            continue;
        };
        let age = meta
            .modified()
            .ok()
            .and_then(|modified| now.duration_since(modified).ok())
            .unwrap_or_default();
        if age <= ORPHAN_MAX_AGE {
            continue;
        }
        if meta.is_dir() {
            let _ = std::fs::remove_dir_all(entry.path());
        } else {
            let _ = std::fs::remove_file(entry.path());
        }
    }
    let _ = std::fs::remove_dir(&prepared);
}

fn sweep_prepared_subtitles(temp_dir: &std::path::Path) {
    sweep_prepared_subtitles_at(temp_dir, SystemTime::now());
}

pub fn sweep_temp() {
    let dir = std::env::temp_dir();
    // Crash leftovers contain plaintext dialogue, so bound their recovery life
    // while preserving recent files that another Harbor instance may still use.
    sweep_prepared_subtitles(&dir);
    let entries = match std::fs::read_dir(&dir) {
        Ok(e) => e,
        Err(_) => return,
    };
    let now = SystemTime::now();
    let mut updaters: Vec<(PathBuf, SystemTime)> = Vec::new();

    for entry in entries.flatten() {
        let raw = entry.file_name();
        let name = raw.to_string_lossy();
        let meta = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };
        if !meta.is_dir() {
            continue;
        }
        let modified = meta.modified().unwrap_or(now);
        let age = now.duration_since(modified).unwrap_or_default();

        if is_updater_dir(&name) {
            if age > RECENT_GRACE {
                updaters.push((entry.path(), modified));
            }
            continue;
        }
        if is_orphan_dir(&name) && age > ORPHAN_MAX_AGE {
            let _ = std::fs::remove_dir_all(entry.path());
        }
    }

    if updaters.len() <= UPDATER_KEEP {
        return;
    }
    updaters.sort_by_key(|(_, t)| *t);
    let drop_count = updaters.len() - UPDATER_KEEP;
    for (path, _) in updaters.into_iter().take(drop_count) {
        let _ = std::fs::remove_dir_all(path);
    }
}

fn dir_size(path: &PathBuf) -> u64 {
    let mut total = 0u64;
    let entries = match std::fs::read_dir(path) {
        Ok(e) => e,
        Err(_) => return 0,
    };
    for entry in entries.flatten() {
        match entry.metadata() {
            Ok(m) if m.is_dir() => total += dir_size(&entry.path()),
            Ok(m) => total += m.len(),
            Err(_) => {}
        }
    }
    total
}

fn harbor_temp_dirs() -> Vec<PathBuf> {
    let dir = std::env::temp_dir();
    let entries = match std::fs::read_dir(&dir) {
        Ok(e) => e,
        Err(_) => return Vec::new(),
    };
    let mut out = Vec::new();
    for entry in entries.flatten() {
        let raw = entry.file_name();
        let name = raw.to_string_lossy();
        if !entry.metadata().map(|m| m.is_dir()).unwrap_or(false) {
            continue;
        }
        if is_updater_dir(&name) || is_orphan_dir(&name) || name == "harbor-trailers" {
            out.push(entry.path());
        }
    }
    out
}

#[tauri::command]
pub fn temp_usage_bytes() -> u64 {
    harbor_temp_dirs().iter().map(dir_size).sum()
}

#[tauri::command]
pub fn temp_clear() -> u64 {
    let dirs = harbor_temp_dirs();
    let before: u64 = dirs.iter().map(dir_size).sum();
    for path in dirs {
        let _ = std::fs::remove_dir_all(path);
    }
    before
}

#[tauri::command]
pub fn cleanup_legacy_playback_cache(dir: String) -> Result<(), String> {
    let root = PathBuf::from(dir.trim());
    if !root.is_absolute() {
        return Err("Legacy playback cache folder must be absolute".to_string());
    }
    if !root.exists() {
        return Err("Legacy playback cache folder is unavailable".to_string());
    }
    let target = root.join("harbor-playback-cache");
    match std::fs::remove_dir_all(&target) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("Could not remove legacy playback cache: {error}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matches_only_harbor_updater_dirs() {
        assert!(is_updater_dir("Harbor-0.9.113-updater-mbbEi1"));
        assert!(is_updater_dir("Harbor-0.9.35-updater-wTLMpQ"));
        assert!(!is_updater_dir("Harbor-0.9.113"));
        assert!(!is_updater_dir("updater-cache"));
        assert!(!is_updater_dir("SomeOtherApp-updater-xyz"));
        assert!(!is_updater_dir("harbor-trailers"));
    }

    #[test]
    fn matches_only_harbor_orphans() {
        assert!(is_orphan_dir("harbor-hls-1234"));
        assert!(is_orphan_dir("harbor-castsubs"));
        assert!(is_orphan_dir("harbor-update-0.9.121"));
        assert!(!is_orphan_dir("harbor-trailers"));
        assert!(!is_orphan_dir("hls-cache"));
    }

    #[test]
    fn startup_sweep_removes_only_prepared_subtitle_recovery_files() {
        let root = std::env::temp_dir().join(format!(
            "harbor-temp-prune-test-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(SystemTime::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let prepared = root.join("harbor-subs").join("prepared").join("private");
        let saved = root.join("harbor-subs").join("saved");
        std::fs::create_dir_all(&prepared).unwrap();
        std::fs::create_dir_all(&saved).unwrap();
        std::fs::write(prepared.join("subtitle.srt"), b"private dialogue").unwrap();
        std::fs::write(saved.join("kept.srt"), b"user export").unwrap();

        sweep_prepared_subtitles_at(&root, SystemTime::now());

        assert!(prepared.join("subtitle.srt").exists());
        assert!(saved.join("kept.srt").exists());

        sweep_prepared_subtitles_at(
            &root,
            SystemTime::now() + ORPHAN_MAX_AGE + Duration::from_secs(1),
        );

        assert!(!root.join("harbor-subs").join("prepared").exists());
        assert!(saved.join("kept.srt").exists());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn mpv_cache_sweep_removes_only_leftovers_past_the_grace() {
        let dir = std::env::temp_dir().join(format!(
            "harbor-mpv-cache-test-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(SystemTime::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("mpv-cache-old.dat"), b"leftover").unwrap();

        assert_eq!(sweep_mpv_cache_at(dir.clone(), SystemTime::now()), 0);
        assert!(dir.join("mpv-cache-old.dat").exists());

        let freed = sweep_mpv_cache_at(
            dir.clone(),
            SystemTime::now() + MPV_CACHE_RECENT_GRACE + Duration::from_secs(1),
        );

        assert!(freed >= 8);
        assert!(!dir.join("mpv-cache-old.dat").exists());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn legacy_playback_cache_cleanup_removes_only_the_owned_subfolder() {
        let root = std::env::temp_dir().join(format!(
            "harbor-legacy-playback-cache-test-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(SystemTime::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let target = root.join("harbor-playback-cache");
        std::fs::create_dir_all(&target).unwrap();
        std::fs::write(target.join("mpv-cache-old.dat"), b"leftover").unwrap();
        std::fs::create_dir_all(root.join("keep")).unwrap();

        cleanup_legacy_playback_cache(root.to_string_lossy().into_owned()).unwrap();

        assert!(!target.exists());
        assert!(root.join("keep").exists());
        assert!(cleanup_legacy_playback_cache("relative".to_string()).is_err());
        assert!(
            cleanup_legacy_playback_cache(root.join("missing").to_string_lossy().into_owned())
                .is_err()
        );
        std::fs::remove_dir_all(root).unwrap();
    }
}

/// Removes leftover mpv demuxer-cache files. Harbor no longer writes its
/// demuxer cache to disk, so anything in this directory is from an older
/// version or a crashed session. Keep a conservative grace: an older build may
/// still be running (for example a debug instance, where single-instance is
/// disabled) and a paused playback can leave its cache file untouched for a
/// long time.
const MPV_CACHE_RECENT_GRACE: Duration = Duration::from_secs(6 * 60 * 60);

fn sweep_mpv_cache_at(dir: PathBuf, now: SystemTime) -> u64 {
    let entries = match std::fs::read_dir(&dir) {
        Ok(e) => e,
        Err(_) => return 0,
    };
    let mut freed = 0_u64;
    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(meta) = entry.metadata() else {
            continue;
        };
        let age = meta
            .modified()
            .ok()
            .and_then(|modified| now.duration_since(modified).ok())
            .unwrap_or_default();
        if age < MPV_CACHE_RECENT_GRACE {
            continue;
        }
        let size = if meta.is_dir() {
            dir_size(&path)
        } else {
            meta.len()
        };
        let removed = if meta.is_dir() {
            std::fs::remove_dir_all(&path).is_ok()
        } else {
            std::fs::remove_file(&path).is_ok()
        };
        if removed {
            freed += size;
        }
    }
    if freed > 0 {
        eprintln!("[temp-prune] removed leftover mpv cache: {freed} bytes");
    }
    freed
}

pub fn sweep_mpv_cache(dir: PathBuf) -> u64 {
    sweep_mpv_cache_at(dir, SystemTime::now())
}
