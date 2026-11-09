use rusqlite::{params, Connection, OptionalExtension};
use std::path::{Path, PathBuf};
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Mutex,
};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::Manager;

pub const MAX_BYTES: u64 = 2 * 1024 * 1024 * 1024;
const MAX_FILES: usize = 50_000;
const MAX_AGE: u64 = 30 * 24 * 3600;
const MAX_IMAGE_BYTES: usize = 32 * 1024 * 1024;
static IO: Mutex<()> = Mutex::new(());
static GENERATION: AtomicU64 = AtomicU64::new(0);
static CLEANED: Mutex<Option<PathBuf>> = Mutex::new(None);
static SCHEMA: Mutex<Option<PathBuf>> = Mutex::new(None);
static LEGACY: Mutex<bool> = Mutex::new(false);
static LAST_SWEEP: AtomicU64 = AtomicU64::new(0);
static WRITES: AtomicU64 = AtomicU64::new(0);

pub fn generation() -> u64 {
    GENERATION.load(Ordering::SeqCst)
}
fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
fn dir(app: &tauri::AppHandle) -> Option<PathBuf> {
    app.path()
        .app_cache_dir()
        .ok()
        .map(|p| p.join("media-images-v1"))
}
/// The pre-DB cache lived in a different directory and was capped at 256 MB.
/// Remove it once after an upgrade instead of waiting for a manual clear.
fn cleanup_legacy(app: &tauri::AppHandle) {
    let Ok(mut cleaned) = LEGACY.lock() else { return };
    if *cleaned {
        return;
    }
    if let Ok(cache) = app.path().cache_dir() {
        let _ = std::fs::remove_dir_all(cache.join("harbor-thumb-cache"));
    }
    *cleaned = true;
}

fn file_stem(url: &str, width: u32) -> String {
    use sha2::{Digest, Sha256};
    let mut hash = Sha256::new();
    hash.update(b"image-v2\0");
    hash.update(width.to_le_bytes());
    hash.update(url.as_bytes());
    hash.finalize().iter().map(|b| format!("{b:02x}")).collect()
}

fn database(dir: &Path) -> Option<Connection> {
    std::fs::create_dir_all(dir).ok()?;
    let db = Connection::open(dir.join("index.sqlite")).ok()?;
    // Schema setup and column probes are per-process work, not per-image work.
    let mut schema = SCHEMA.lock().ok()?;
    if schema.as_deref() != Some(dir) {
        db.execute_batch("CREATE TABLE IF NOT EXISTS images (key TEXT PRIMARY KEY, file TEXT NOT NULL, bytes INTEGER NOT NULL, accessed INTEGER NOT NULL, expires INTEGER NOT NULL, content_type TEXT NOT NULL, etag TEXT, modified TEXT, digest TEXT NOT NULL DEFAULT ''); CREATE INDEX IF NOT EXISTS image_access ON images(accessed); CREATE INDEX IF NOT EXISTS image_expiry ON images(expires);").ok()?;
        if db.prepare("SELECT digest FROM images LIMIT 0").is_err() {
            db.execute(
                "ALTER TABLE images ADD COLUMN digest TEXT NOT NULL DEFAULT ''",
                [],
            )
            .ok()?;
        }
        if db.prepare("SELECT lifetime FROM images LIMIT 0").is_err() {
            // Old entries have no recoverable origin policy; revalidate them conservatively.
            db.execute(
                "ALTER TABLE images ADD COLUMN lifetime INTEGER NOT NULL DEFAULT 0",
                [],
            )
            .ok()?;
        }
        *schema = Some(dir.to_path_buf());
    }
    drop(schema);
    let mut cleaned = CLEANED.lock().ok()?;
    if cleaned.as_deref() != Some(dir) {
        let mut statement = db.prepare("SELECT file FROM images").ok()?;
        let known = statement
            .query_map([], |row| row.get::<_, String>(0))
            .ok()?
            .collect::<Result<std::collections::HashSet<_>, _>>()
            .ok()?;
        // Recover files left between an atomic rename and the index commit.
        for entry in std::fs::read_dir(dir).ok()?.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            let payload = name.strip_suffix(".tmp").unwrap_or(&name);
            if image_path(dir, payload).is_some() && !known.contains(&name) {
                let _ = std::fs::remove_file(entry.path());
            }
        }
        *cleaned = Some(dir.to_path_buf());
    }
    Some(db)
}

fn extension_for(content_type: &str) -> &'static str {
    let lower = content_type.to_ascii_lowercase();
    if lower.contains("png") {
        "png"
    } else if lower.contains("webp") {
        "webp"
    } else if lower.contains("gif") {
        "gif"
    } else if lower.contains("avif") {
        "avif"
    } else {
        "jpg"
    }
}

fn image_path(dir: &Path, file: &str) -> Option<PathBuf> {
    let (stem, extension) = file.rsplit_once('.')?;
    if !matches!(
        extension.to_ascii_lowercase().as_str(),
        "img" | "jpg" | "jpeg" | "png" | "webp" | "gif" | "avif"
    ) {
        return None;
    }
    let (key, revision) = stem.split_once('-')?;
    if key.len() != 64
        || !key.chars().all(|c| c.is_ascii_hexdigit())
        || revision.is_empty()
        || !revision.chars().all(|c| c.is_ascii_digit())
    {
        return None;
    }
    Some(dir.join(file))
}

/// Fresh cached file that can be served directly through the asset protocol.
/// `.img` was the first-generation extension whose MIME type is unknown to the
/// WebView, so those entries keep using the base64 path until revalidated.
pub fn cached_path(app: &tauri::AppHandle, url: &str, width: u32) -> Option<String> {
    let _lock = IO.lock().ok()?;
    cleanup_legacy(app);
    let dir = dir(app)?;
    let db = database(&dir)?;
    let key = file_stem(url, width);
    let (file, expires, bytes) = db
        .query_row(
            "SELECT file,expires,bytes FROM images WHERE key=?1",
            [&key],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, u64>(1)?,
                    row.get::<_, u64>(2)?,
                ))
            },
        )
        .optional()
        .ok()??;
    if expires <= now() {
        return None;
    }
    let path = image_path(&dir, &file)?;
    let extension = path.extension()?.to_str()?.to_ascii_lowercase();
    if extension == "img" || !path.is_file() {
        return None;
    }
    if std::fs::metadata(&path).ok()?.len() != bytes {
        return None;
    }
    Some(path.to_string_lossy().into_owned())
}

fn checksum(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    Sha256::digest(bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

pub struct CachedImage {
    pub bytes: Vec<u8>,
    pub content_type: String,
    pub etag: Option<String>,
    pub modified: Option<String>,
    pub fresh: bool,
    pub max_age: u64,
    pub lifetime: u64,
}

impl CachedImage {
    pub fn revalidated_lifetime(&self, cache_control: Option<&str>) -> Option<u64> {
        cache_control
            .map(|control| image_lifetime(Some(control)))
            .unwrap_or(Some(self.lifetime))
    }
}

pub fn read_thumb(app: &tauri::AppHandle, url: &str, width: u32) -> Option<CachedImage> {
    let _lock = IO.lock().ok()?;
    cleanup_legacy(app);
    let dir = dir(app)?;
    read_image(&dir, url, width)
}

fn read_image(dir: &Path, url: &str, width: u32) -> Option<CachedImage> {
    let db = database(&dir)?;
    let key = file_stem(url, width);
    let row = db
        .query_row(
            "SELECT file, bytes, expires, content_type, etag, modified, digest, lifetime FROM images WHERE key=?1",
            [&key],
            |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, u64>(1)?,
                    r.get::<_, u64>(2)?,
                    r.get::<_, String>(3)?,
                    r.get::<_, Option<String>>(4)?,
                    r.get::<_, Option<String>>(5)?,
                    r.get::<_, String>(6)?,
                    r.get::<_, u64>(7)?,
                ))
            },
        )
        .optional()
        .ok()??;
    let path = image_path(dir, &row.0)?;
    let bytes = std::fs::read(&path).ok()?;
    if bytes.is_empty() || bytes.len() as u64 != row.1 || checksum(&bytes) != row.6 {
        let _ = std::fs::remove_file(path);
        let _ = db.execute("DELETE FROM images WHERE key=?1", [&key]);
        return None;
    }
    let _ = db.execute(
        "UPDATE images SET accessed=?1 WHERE key=?2 AND accessed<?3",
        params![now(), key, now().saturating_sub(60)],
    );
    Some(CachedImage {
        bytes,
        fresh: row.2 > now(),
        max_age: row.2.saturating_sub(now()),
        content_type: row.3,
        etag: row.4,
        modified: row.5,
        lifetime: row.7,
    })
}

pub fn image_lifetime(cache_control: Option<&str>) -> Option<u64> {
    let mut seconds = MAX_AGE;
    for directive in cache_control.unwrap_or("").split(',').map(str::trim) {
        // This is a per-device cache, so `private` is not a reason to skip it;
        // only `no-store` forbids keeping the bytes locally.
        if directive.eq_ignore_ascii_case("no-store") {
            return None;
        }
        if directive.eq_ignore_ascii_case("no-cache") {
            seconds = 0;
        }
        if let Some((name, value)) = directive.split_once('=') {
            if name.trim().eq_ignore_ascii_case("max-age") {
                if let Ok(value) = value.trim().trim_matches('"').parse::<u64>() {
                    seconds = seconds.min(value);
                }
            }
        }
    }
    Some(seconds)
}

pub fn write_thumb(
    app: &tauri::AppHandle,
    url: &str,
    width: u32,
    image: &CachedImage,
    lifetime: u64,
    expected_generation: u64,
) {
    let Ok(_lock) = IO.lock() else {
        return;
    };
    if generation() != expected_generation
        || image.bytes.is_empty()
        || image.bytes.len() > MAX_IMAGE_BYTES
    {
        return;
    }
    cleanup_legacy(app);
    let Some(dir) = dir(app) else {
        return;
    };
    write_image(&dir, url, width, image, lifetime);
}

pub fn remove_thumb(app: &tauri::AppHandle, url: &str, width: u32, expected_generation: u64) {
    let Ok(_lock) = IO.lock() else { return; };
    if generation() != expected_generation { return; }
    let Some(dir) = dir(app) else { return; };
    let Some(db) = database(&dir) else { return; };
    let key = file_stem(url, width);
    let file = db.query_row("SELECT file FROM images WHERE key=?1", [&key], |row| row.get::<_, String>(0)).optional().ok().flatten();
    if db.execute("DELETE FROM images WHERE key=?1", [&key]).is_ok() {
        if let Some(path) = file.and_then(|file| image_path(&dir, &file)) {
            let _ = std::fs::remove_file(path);
        }
    }
}

fn write_image(dir: &Path, url: &str, width: u32, image: &CachedImage, lifetime: u64) {
    let Some(mut db) = database(&dir) else {
        return;
    };
    let key = file_stem(url, width);
    let previous = db
        .query_row("SELECT file FROM images WHERE key=?1", [&key], |r| {
            r.get::<_, String>(0)
        })
        .optional()
        .ok()
        .flatten();
    let revision = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let file = format!("{key}-{revision}.{}", extension_for(&image.content_type));
    let temporary = dir.join(format!("{file}.tmp"));
    let path = dir.join(&file);
    let write = || {
        std::fs::write(&temporary, &image.bytes).and_then(|_| std::fs::rename(&temporary, &path))
    };
    if let Err(error) = write() {
        let _ = std::fs::remove_file(&temporary);
        if error.kind() != std::io::ErrorKind::StorageFull
            && !matches!(error.raw_os_error(), Some(28 | 112))
        {
            return;
        }
        prune(&dir, &db, Some(image.bytes.len() as u64));
        if write().is_err() {
            let _ = std::fs::remove_file(&temporary);
            return;
        }
    }
    let committed = db
        .transaction()
        .and_then(|tx| {
            tx.execute(
                "INSERT OR REPLACE INTO images (key,file,bytes,accessed,expires,content_type,etag,modified,digest,lifetime) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
                params![
                    key,
                    file,
                    image.bytes.len() as u64,
                    now(),
                    now().saturating_add(lifetime),
                    image.content_type,
                    image.etag,
                    image.modified,
                    checksum(&image.bytes),
                    lifetime,
                ],
            )?;
            tx.commit()
        })
        .is_ok();
    if !committed {
        let _ = std::fs::remove_file(path);
        return;
    }
    if let Some(previous) = previous.and_then(|file| image_path(dir, &file)) {
        let _ = std::fs::remove_file(previous);
    }
    // The cap check aggregates the whole index; run it periodically instead of
    // on every image write.
    if WRITES.fetch_add(1, Ordering::Relaxed) % 64 == 0 {
        prune(&dir, &db, None);
    }
}

fn prune(dir: &Path, db: &Connection, free_bytes: Option<u64>) {
    if free_bytes.is_none() {
        let timestamp = now();
        let last = LAST_SWEEP.load(Ordering::Relaxed);
        if last == 0 || timestamp.saturating_sub(last) >= 3600 {
            LAST_SWEEP.store(timestamp, Ordering::Relaxed);
            // The pre-DB cache dropped files after 30 days; keep that retention
            // policy now that the freshness deadline alone no longer evicts.
            let cutoff = timestamp.saturating_sub(MAX_AGE);
            let mut stale = Vec::new();
            if let Ok(mut statement) =
                db.prepare("SELECT key,file FROM images WHERE accessed < ?1")
            {
                if let Ok(rows) = statement
                    .query_map([cutoff], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
                {
                    stale.extend(rows.flatten());
                }
            }
            for (key, file) in stale {
                let removable = image_path(dir, &file).is_none_or(|path| {
                    std::fs::remove_file(path)
                        .map(|_| true)
                        .unwrap_or_else(|error| error.kind() == std::io::ErrorKind::NotFound)
                });
                if removable {
                    let _ = db.execute("DELETE FROM images WHERE key=?1", [&key]);
                }
            }
        }
    }
    let (mut bytes, mut files) = db
        .query_row(
            "SELECT COALESCE(SUM(bytes),0), COUNT(*) FROM images",
            [],
            |r| Ok((r.get::<_, u64>(0)?, r.get::<_, usize>(1)?)),
        )
        .unwrap_or_default();
    if free_bytes.is_none() && bytes <= MAX_BYTES && files <= MAX_FILES {
        return;
    }
    let target_bytes = free_bytes.map_or(MAX_BYTES * 9 / 10, |required| {
        bytes.saturating_sub(required.max(bytes / 10))
    });
    let target_files = if free_bytes.is_some() {
        files.saturating_sub(1)
    } else {
        MAX_FILES * 9 / 10
    };
    let Ok(mut statement) = db.prepare("SELECT key,file,bytes FROM images ORDER BY accessed")
    else {
        return;
    };
    let Ok(rows) = statement.query_map([], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, u64>(2)?,
        ))
    }) else {
        return;
    };
    for row in rows.flatten() {
        if bytes <= target_bytes && files <= target_files {
            break;
        }
        if image_path(dir, &row.1).is_none_or(|path| {
            std::fs::remove_file(path)
                .map(|_| true)
                .unwrap_or_else(|error| error.kind() == std::io::ErrorKind::NotFound)
        }) {
            let _ = db.execute("DELETE FROM images WHERE key=?1", [row.0]);
            bytes = bytes.saturating_sub(row.2);
            files = files.saturating_sub(1);
        }
    }
}

pub fn thumb_cache_size(app: &tauri::AppHandle) -> (u64, usize) {
    let Ok(_lock) = IO.lock() else {
        return (0, 0);
    };
    let Some(dir) = dir(app) else {
        return (0, 0);
    };
    let Some(db) = database(&dir) else {
        return (0, 0);
    };
    db.query_row(
        "SELECT COALESCE(SUM(bytes),0), COUNT(*) FROM images",
        [],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )
    .unwrap_or_default()
}

pub fn clear_thumb_dir(app: &tauri::AppHandle) -> Result<(), String> {
    let _lock = IO.lock().map_err(|error| error.to_string())?;
    GENERATION.fetch_add(1, Ordering::SeqCst);
    if let Some(dir) = dir(app) {
        if let Err(error) = std::fs::remove_dir_all(dir) {
            if error.kind() != std::io::ErrorKind::NotFound {
                return Err(error.to_string());
            }
        }
    } else {
        return Err("Image cache directory unavailable".to_string());
    }
    if let Ok(dir) = app.path().cache_dir() {
        let _ = std::fs::remove_dir_all(dir.join("harbor-thumb-cache"));
    }
    if let Ok(mut schema) = SCHEMA.lock() {
        *schema = None;
    }
    if let Ok(mut cleaned) = CLEANED.lock() {
        *cleaned = None;
    }
    LAST_SWEEP.store(0, Ordering::Relaxed);
    WRITES.store(0, Ordering::Relaxed);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn keys_scope_size_and_source() {
        let a = file_stem("https://example.com/a.png", 400);
        assert_eq!(a.len(), 64);
        assert!(a.chars().all(|c| c.is_ascii_hexdigit()));
        assert_eq!(a, file_stem("https://example.com/a.png", 400));
        assert_ne!(a, file_stem("https://example.com/a.png", 600));
        assert_ne!(a, file_stem("https://example.com/b.png", 400));
    }
    #[test]
    fn respects_origin_cache_policy() {
        assert_eq!(image_lifetime(None), Some(MAX_AGE));
        assert_eq!(image_lifetime(Some("public, max-age=60")), Some(60));
        assert_eq!(image_lifetime(Some("no-cache")), Some(0));
        assert_eq!(image_lifetime(Some("private, max-age=60")), Some(60));
        assert_eq!(image_lifetime(Some("no-store")), None);
        assert_eq!(image_lifetime(Some("public, MAX-AGE=60")), Some(60));
    }

    #[test]
    fn png_webp_and_original_sizes_round_trip_with_validators() {
        let dir = std::env::temp_dir().join(format!(
            "harbor-image-cache-test-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        for (url, bytes, kind, width) in [
            (
                "https://example.com/a.png",
                b"\x89PNG\r\n\x1a\n".as_slice(),
                "image/png",
                400,
            ),
            (
                "https://example.com/b.webp",
                b"RIFF0000WEBP".as_slice(),
                "image/webp",
                0,
            ),
        ] {
            let image = CachedImage {
                bytes: bytes.to_vec(),
                content_type: kind.to_string(),
                etag: Some("version1".to_string()),
                modified: Some("yesterday".to_string()),
                fresh: true,
                max_age: 60,
                lifetime: 60,
            };
            write_image(&dir, url, width, &image, 60);
            let cached = read_image(&dir, url, width).unwrap();
            assert_eq!(cached.bytes, bytes);
            assert_eq!(cached.content_type, kind);
            assert_eq!(cached.etag.as_deref(), Some("version1"));
            assert_eq!(cached.revalidated_lifetime(None), Some(60));
            assert_eq!(cached.revalidated_lifetime(Some("max-age=15")), Some(15));
            assert_eq!(cached.revalidated_lifetime(Some("no-store")), None);
            assert!(cached.fresh);
            assert!(read_image(&dir, url, width + 1).is_none());
            write_image(&dir, url, width, &image, 0);
            let stale = read_image(&dir, url, width).unwrap();
            assert!(!stale.fresh);
            assert_eq!(stale.revalidated_lifetime(None), Some(0));
        }
        let files = std::fs::read_dir(&dir)
            .unwrap()
            .flatten()
            .filter(|entry| {
                image_path(&dir, &entry.file_name().to_string_lossy()).is_some()
            })
            .count();
        assert_eq!(files, 2, "atomic replacement removes old revisions");
        let db = database(&dir).unwrap();
        let file = db
            .query_row(
                "SELECT file FROM images WHERE key=?1",
                [file_stem("https://example.com/a.png", 400)],
                |row| row.get::<_, String>(0),
            )
            .unwrap();
        std::fs::write(image_path(&dir, &file).unwrap(), b"corrupt!").unwrap();
        assert!(read_image(&dir, "https://example.com/a.png", 400).is_none());
        drop(db);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn payload_paths_cannot_escape_the_image_cache() {
        let dir = Path::new("cache");
        for file in [
            "../outside.img",
            "C:\\outside.img",
            "invalid.img",
            "../../index.sqlite",
        ] {
            assert!(image_path(dir, file).is_none());
        }
    }
}
