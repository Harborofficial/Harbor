//! Keep the shared YouTube extractor current without replacing the bundled fallback.
//! Every executable is matched to the official release's SHA-256 manifest before use.

use crate::trailer::YtDlpOutput;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use std::sync::LazyLock;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::Manager;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::Mutex;

const RELEASE_API: &str = "https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest";
const RELEASE_TAG_API: &str = "https://api.github.com/repos/yt-dlp/yt-dlp/releases/tags/";
// 2026.10.21 and 2026.10.26 resolve URLs that googlevideo rejects with 403 on both audio and
// video. 2026.08.19 still returns playable URLs; use it until a later release is verified.
const KNOWN_BAD_RELEASES: [&str; 2] = ["2026.10.21", "2026.10.26"];
const FALLBACK_RELEASE: &str = "2026.08.19";
const CHECK_INTERVAL: Duration = Duration::from_secs(24 * 60 * 60);
const RETRY_INTERVAL: Duration = Duration::from_secs(5 * 60);
const UPDATE_TIMEOUT: Duration = Duration::from_secs(60);
const METADATA_TIMEOUT: Duration = Duration::from_secs(4);
const MAX_BINARY: usize = 96 * 1024 * 1024;
const MAX_METADATA: usize = 1024 * 1024;
const MAX_CHECKSUMS: usize = 256 * 1024;
const MANIFEST: &str = "verified-release.json";
static UPDATE_GATE: LazyLock<Mutex<Option<Instant>>> = LazyLock::new(|| Mutex::new(None));

#[derive(Clone, Deserialize, Serialize)]
struct CachedRelease {
    version: String,
    asset: String,
    sha256: String,
    checked_at: u64,
}

impl CachedRelease {
    fn filename(&self) -> Option<String> {
        if !safe_version(&self.version)
            || known_bad_release(&self.version)
            || Some(self.asset.as_str()) != platform_asset()
            || !valid_digest(&self.sha256)
        {
            return None;
        }
        Some(format!("{}-{}", self.version, self.asset))
    }

    fn fresh(&self, now: u64) -> bool {
        now >= self.checked_at && now - self.checked_at < CHECK_INTERVAL.as_secs()
    }
}

#[derive(Deserialize)]
struct Release {
    tag_name: String,
    assets: Vec<Asset>,
}

#[derive(Deserialize)]
struct Asset {
    name: String,
    browser_download_url: String,
}

/// One total deadline includes a remote attempt and the existing bundled fallback.
pub async fn run(
    app: &tauri::AppHandle,
    args: Vec<String>,
    timeout: Duration,
    label: &str,
) -> Result<YtDlpOutput, String> {
    tokio::time::timeout(timeout, run_with_fallback(app, args, timeout, label))
        .await
        .map_err(|_| "YouTube Music timed out while resolving this track.".to_string())?
}

async fn run_with_fallback(
    app: &tauri::AppHandle,
    args: Vec<String>,
    timeout: Duration,
    label: &str,
) -> Result<YtDlpOutput, String> {
    let started = Instant::now();
    let directory = app
        .path()
        .app_cache_dir()
        .ok()
        .map(|path| path.join("music/yt-dlp"));
    let (remote, update) = match directory {
        Some(directory) => {
            let cached = read_verified(&directory).await;
            let path = cached
                .as_ref()
                .and_then(CachedRelease::filename)
                .map(|name| directory.join(name));
            // A stale verify is old enough that YouTube may already reject the URLs it returns,
            // which only shows up after playback starts. Refresh it before the first play; a
            // fresh one is used immediately while the update check runs in the background.
            let stale = needs_refresh(cached.as_ref(), now_seconds());
            if stale && path.is_some() {
                (cached_executable(&directory).await, None)
            } else {
                // With no verified extractor there is nothing to refresh: start the update and
                // let the bundled helper serve this play instead of waiting for the download.
                let update = tokio::spawn(async move { cached_executable(&directory).await });
                (path, Some(update))
            }
        }
        None => (None, None),
    };
    if let Some(executable) = remote.as_ref() {
        // Reserve time for the bundled helper when the current release cannot run.
        let budget = timeout.saturating_sub(started.elapsed()).mul_f32(0.65);
        if let Ok(output) = execute(executable, &args, budget).await {
            if output.success {
                return Ok(output);
            }
        }
    }
    let remaining = timeout.saturating_sub(started.elapsed());
    let budget = if update.is_some() {
        remaining.mul_f32(0.65)
    } else {
        remaining
    };
    let output = crate::trailer::run_yt_dlp(app, args.clone(), budget, label).await;
    let error = match output {
        Ok(output) if output.success => return Ok(output),
        Ok(output) => {
            let error = extraction_error(&output.stderr);
            if !retry_after_update(&output.stderr) {
                return Err(error);
            }
            error
        }
        Err(error) => error,
    };
    // A background update used to benefit only the user's next manual retry.
    // Adopt it now after failure, without rerunning the same cached executable.
    if let Some(update) = update {
        let wait = timeout
            .saturating_sub(started.elapsed())
            .saturating_sub(Duration::from_secs(5));
        if let Ok(Ok(Some(path))) = tokio::time::timeout(wait, update).await {
            if remote.as_ref() != Some(&path) {
                let remaining = timeout.saturating_sub(started.elapsed());
                if let Ok(output) = execute(&path, &args, remaining).await {
                    return if output.success {
                        Ok(output)
                    } else {
                        Err(extraction_error(&output.stderr))
                    };
                }
            }
        }
    }
    Err(error)
}

fn retry_after_update(stderr: &[u8]) -> bool {
    let message = String::from_utf8_lossy(stderr).to_ascii_lowercase();
    ![
        "not a bot",
        "http error 429",
        "private video",
        "sign in to confirm your age",
        "video is unavailable",
        "video has been removed",
        "not available in your country",
    ]
    .iter()
    .any(|marker| message.contains(marker))
}

fn extraction_error(stderr: &[u8]) -> String {
    let message = String::from_utf8_lossy(stderr).to_ascii_lowercase();
    // Return categories, never raw extractor output containing signed URLs or cookies.
    if message.contains("not a bot") || message.contains("http error 429") {
        return "YouTube is limiting requests or requires a browser verification. Wait before retrying, or open this track on YouTube.".to_string();
    }
    if message.contains("javascript runtime") || message.contains("challenge solving failed") {
        return "YouTube extraction needs a supported JavaScript runtime. Install Deno or Node.js 22 or newer, restart Harbor, and retry.".to_string();
    }
    if message.contains("private video") || message.contains("sign in to confirm your age") {
        return "This YouTube video requires account access. Open it on YouTube.".to_string();
    }
    "YouTube Music could not resolve this track. Try again or choose another source.".to_string()
}

async fn execute(path: &Path, args: &[String], timeout: Duration) -> Result<YtDlpOutput, ()> {
    let mut command = tokio::process::Command::new(path);
    command.args(args).kill_on_drop(true);
    #[cfg(windows)]
    command.creation_flags(0x08000000); // CREATE_NO_WINDOW
    let output = tokio::time::timeout(timeout, command.output())
        .await
        .map_err(|_| ())?
        .map_err(|_| ())?;
    Ok(YtDlpOutput {
        success: output.status.success(),
        exit_code: output.status.code(),
        stdout: output.stdout,
        stderr: output.stderr,
    })
}

fn needs_refresh(cached: Option<&CachedRelease>, now: u64) -> bool {
    cached.is_none_or(|entry| !entry.fresh(now))
}

/// Keeps the extractor current in the background, so the first play does not pay for the check.
pub async fn warm(app: &tauri::AppHandle) {
    let Some(directory) = app
        .path()
        .app_cache_dir()
        .ok()
        .map(|path| path.join("music/yt-dlp"))
    else {
        return;
    };
    let _ = cached_executable(&directory).await;
}

async fn cached_executable(directory: &Path) -> Option<PathBuf> {
    let mut attempted = UPDATE_GATE.lock().await;
    let cached = read_verified(directory).await;
    let cached_path = cached
        .as_ref()
        .and_then(|entry| entry.filename())
        .map(|name| directory.join(name));
    if cached
        .as_ref()
        .is_some_and(|entry| entry.fresh(now_seconds()))
        || attempted.is_some_and(|stamp| stamp.elapsed() < RETRY_INTERVAL)
    {
        return cached_path;
    }
    *attempted = Some(Instant::now());
    match tokio::time::timeout(UPDATE_TIMEOUT, refresh(directory, cached.as_ref())).await {
        Ok(Ok(path)) => Some(path),
        _ => cached_path,
    }
}

async fn read_verified(directory: &Path) -> Option<CachedRelease> {
    let manifest = read_limited(&directory.join(MANIFEST), MAX_METADATA).await?;
    let entry: CachedRelease = serde_json::from_slice(&manifest).ok()?;
    let filename = entry.filename()?;
    let bytes = read_limited(&directory.join(filename), MAX_BINARY).await?;
    digest_matches(&bytes, &entry.sha256).then_some(entry)
}

async fn read_limited(path: &Path, limit: usize) -> Option<Vec<u8>> {
    let metadata = tokio::fs::metadata(path).await.ok()?;
    if !metadata.is_file() || metadata.len() > limit as u64 {
        return None;
    }
    let file = tokio::fs::File::open(path).await.ok()?;
    let mut bytes = Vec::new();
    file.take(limit as u64 + 1)
        .read_to_end(&mut bytes)
        .await
        .ok()?;
    (bytes.len() <= limit).then_some(bytes)
}

async fn refresh(directory: &Path, cached: Option<&CachedRelease>) -> Result<PathBuf, ()> {
    let asset_name = platform_asset().ok_or(())?;
    let client = reqwest::Client::builder()
        .user_agent("Harbor-Music")
        .connect_timeout(Duration::from_secs(3))
        .timeout(UPDATE_TIMEOUT)
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            let url = attempt.url();
            if attempt.previous().len() < 5
                && url.scheme() == "https"
                && matches!(
                    url.host_str(),
                    Some(
                        "github.com"
                            | "release-assets.githubusercontent.com"
                            | "objects.githubusercontent.com"
                    )
                )
            {
                attempt.follow()
            } else {
                attempt.stop()
            }
        }))
        .build()
        .map_err(|_| ())?;
    let release = fetch_release(&client, RELEASE_API).await?;
    let release = if known_bad_release(&release.tag_name) {
        fetch_release(&client, &format!("{RELEASE_TAG_API}{FALLBACK_RELEASE}")).await?
    } else {
        release
    };
    if !safe_version(&release.tag_name) {
        return Err(());
    }
    if let Some(cached) = cached.filter(|entry| entry.version == release.tag_name) {
        let mut renewed = cached.clone();
        renewed.checked_at = now_seconds();
        save_manifest(directory, &renewed).await?;
        return Ok(directory.join(renewed.filename().ok_or(())?));
    }
    let asset_url = release_url(&release, asset_name).ok_or(())?;
    let checksum_url = release_url(&release, "SHA2-256SUMS").ok_or(())?;
    let checksum_body =
        fetch_limited(&client, checksum_url, MAX_CHECKSUMS, METADATA_TIMEOUT).await?;
    let expected = checksum_for(
        std::str::from_utf8(&checksum_body).map_err(|_| ())?,
        asset_name,
    )
    .ok_or(())?;
    // A previously downloaded release may already be on disk after a downgrade or a stale
    // manifest. Verify it against this tag's checksum instead of downloading it again.
    let cached_bytes = read_limited(
        &directory.join(format!("{}-{}", release.tag_name, asset_name)),
        MAX_BINARY,
    )
    .await;
    let bytes = match cached_bytes.filter(|bytes| digest_matches(bytes, &expected)) {
        Some(bytes) => bytes,
        None => fetch_limited(&client, asset_url, MAX_BINARY, UPDATE_TIMEOUT).await?,
    };
    if !digest_matches(&bytes, &expected) {
        return Err(());
    }
    let entry = CachedRelease {
        version: release.tag_name.clone(),
        asset: asset_name.to_string(),
        sha256: expected,
        checked_at: now_seconds(),
    };
    tokio::fs::create_dir_all(directory).await.map_err(|_| ())?;
    let path = directory.join(entry.filename().ok_or(())?);
    atomic_write(&path, &bytes, true).await?;
    save_manifest(directory, &entry).await?;
    if let Some(previous) = cached
        .and_then(CachedRelease::filename)
        .map(|name| directory.join(name))
    {
        if previous != path {
            // A process may still be using this release; failure leaves it intact.
            let _ = tokio::fs::remove_file(previous).await;
        }
    }
    Ok(path)
}

fn known_bad_release(version: &str) -> bool {
    KNOWN_BAD_RELEASES.contains(&version)
}

async fn fetch_release(client: &reqwest::Client, url: &str) -> Result<Release, ()> {
    let metadata = fetch_limited(client, url, MAX_METADATA, METADATA_TIMEOUT).await?;
    let release: Release = serde_json::from_slice(&metadata).map_err(|_| ())?;
    (!release.tag_name.is_empty()).then_some(release).ok_or(())
}

async fn fetch_limited(
    client: &reqwest::Client,
    url: &str,
    limit: usize,
    timeout: Duration,
) -> Result<Vec<u8>, ()> {
    let mut response = client
        .get(url)
        .timeout(timeout)
        .send()
        .await
        .map_err(|_| ())?
        .error_for_status()
        .map_err(|_| ())?;
    if response
        .content_length()
        .is_some_and(|length| length > limit as u64)
    {
        return Err(());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| ())? {
        if chunk.len() > limit.saturating_sub(bytes.len()) {
            return Err(());
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}

async fn save_manifest(directory: &Path, entry: &CachedRelease) -> Result<(), ()> {
    let bytes = serde_json::to_vec(entry).map_err(|_| ())?;
    atomic_write(&directory.join(MANIFEST), &bytes, false).await
}

struct PartialFile(PathBuf);
impl Drop for PartialFile {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}

async fn atomic_write(path: &Path, bytes: &[u8], executable: bool) -> Result<(), ()> {
    let temporary = PartialFile(path.with_extension(format!("{}.part", uuid::Uuid::new_v4())));
    let mut file = tokio::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary.0)
        .await
        .map_err(|_| ())?;
    file.write_all(bytes).await.map_err(|_| ())?;
    file.flush().await.map_err(|_| ())?;
    drop(file);
    #[cfg(unix)]
    if executable {
        use std::os::unix::fs::PermissionsExt;
        tokio::fs::set_permissions(&temporary.0, std::fs::Permissions::from_mode(0o755))
            .await
            .map_err(|_| ())?;
    }
    #[cfg(not(unix))]
    let _ = executable;
    tokio::fs::rename(&temporary.0, path).await.map_err(|_| ())
}

fn release_url<'a>(release: &'a Release, asset: &str) -> Option<&'a str> {
    let expected = format!(
        "https://github.com/yt-dlp/yt-dlp/releases/download/{}/{asset}",
        release.tag_name
    );
    release
        .assets
        .iter()
        .find(|candidate| candidate.name == asset && candidate.browser_download_url == expected)
        .map(|candidate| candidate.browser_download_url.as_str())
}

fn checksum_for(manifest: &str, asset: &str) -> Option<String> {
    manifest.lines().find_map(|line| {
        let mut fields = line.split_whitespace();
        let digest = fields.next()?;
        let filename = fields.next()?.trim_start_matches('*');
        (filename == asset && fields.next().is_none() && valid_digest(digest))
            .then(|| digest.to_ascii_lowercase())
    })
}

fn valid_digest(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn digest_matches(bytes: &[u8], expected: &str) -> bool {
    valid_digest(expected) && format!("{:x}", Sha256::digest(bytes)).eq_ignore_ascii_case(expected)
}

fn safe_version(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 40
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || byte == b'.')
        && value.bytes().any(|byte| byte.is_ascii_digit())
}

fn now_seconds() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn platform_asset() -> Option<&'static str> {
    match (std::env::consts::OS, std::env::consts::ARCH) {
        ("windows", "x86_64") => Some("yt-dlp.exe"),
        ("windows", "aarch64") => Some("yt-dlp_arm64.exe"),
        ("macos", "x86_64" | "aarch64") => Some("yt-dlp_macos"),
        ("linux", "x86_64") => Some("yt-dlp_linux"),
        ("linux", "aarch64") => Some("yt-dlp_linux_aarch64"),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extraction_errors_explain_requirements_without_exposing_output() {
        assert!(extraction_error(b"Sign in to confirm you're not a bot").contains("verification"));
        assert!(extraction_error(b"HTTP Error 429").contains("Wait"));
        assert!(extraction_error(b"No supported JavaScript runtime").contains("Node.js 22"));
        assert!(
            extraction_error(b"Private video https://private.example/?token=secret")
                .contains("account access")
        );
        assert!(!extraction_error(b"https://private.example/?token=secret").contains("secret"));
    }

    #[test]
    fn known_broken_extractor_releases_fall_back_to_the_working_one() {
        assert!(known_bad_release("2026.10.21"));
        assert!(known_bad_release("2026.10.26"));
        assert!(!known_bad_release(FALLBACK_RELEASE));
        assert!(!known_bad_release("2026.11.01"));
    }

    #[test]
    fn a_stale_or_missing_extractor_is_updated_before_first_play() {
        assert!(needs_refresh(None, 1000));
        let entry = CachedRelease {
            version: "2026.08.19".into(),
            asset: platform_asset().expect("desktop fixture").into(),
            sha256: "0".repeat(64),
            checked_at: 1000,
        };
        assert!(!needs_refresh(Some(&entry), 1000 + CHECK_INTERVAL.as_secs() - 1));
        assert!(needs_refresh(Some(&entry), 1000 + CHECK_INTERVAL.as_secs()));
    }

    #[test]
    fn extractor_updates_retry_compatibility_failures_not_access_restrictions() {
        assert!(retry_after_update(b"Signature extraction failed"));
        assert!(retry_after_update(b"No supported JavaScript runtime"));
        for message in [
            "Sign in to confirm you're not a bot",
            "HTTP Error 429",
            "Private video",
            "This video is unavailable",
        ] {
            assert!(!retry_after_update(message.as_bytes()));
        }
    }

    #[test]
    fn checksums_match_the_exact_official_asset_and_reject_changed_bytes() {
        let digest = format!("{:x}", Sha256::digest(b"verified extractor"));
        let manifest = format!("{digest}  yt-dlp.exe\n{digest}  yt-dlp_linux\n");
        assert_eq!(
            checksum_for(&manifest, "yt-dlp.exe").as_deref(),
            Some(digest.as_str())
        );
        assert!(checksum_for(&manifest, "yt-dlp").is_none());
        assert!(checksum_for("bad  yt-dlp.exe", "yt-dlp.exe").is_none());
        assert!(digest_matches(b"verified extractor", &digest));
        assert!(!digest_matches(b"changed extractor", &digest));
    }

    #[test]
    fn release_assets_require_the_exact_official_https_location() {
        let mut release = Release {
            tag_name: "2026.08.19".into(),
            assets: vec![Asset {
                name: "yt-dlp.exe".into(),
                browser_download_url:
                    "https://github.com/yt-dlp/yt-dlp/releases/download/2026.08.19/yt-dlp.exe"
                        .into(),
            }],
        };
        assert!(release_url(&release, "yt-dlp.exe").is_some());
        release.assets[0].browser_download_url = "https://example.com/yt-dlp.exe".into();
        assert!(release_url(&release, "yt-dlp.exe").is_none());
        assert!(!safe_version("../2026.08.19"));
        assert!(!safe_version("2026.08.19/evil"));
    }

    #[tokio::test]
    async fn a_cached_release_is_verified_again_before_use() {
        let directory =
            std::env::temp_dir().join(format!("harbor-ytdlp-test-{}", uuid::Uuid::new_v4()));
        tokio::fs::create_dir_all(&directory)
            .await
            .expect("fixture directory");
        let entry = CachedRelease {
            version: "2026.08.19".into(),
            asset: platform_asset().expect("desktop fixture").into(),
            sha256: format!("{:x}", Sha256::digest(b"verified extractor")),
            checked_at: 1000,
        };
        let path = directory.join(entry.filename().expect("safe filename"));
        atomic_write(&path, b"verified extractor", false)
            .await
            .expect("fixture binary");
        save_manifest(&directory, &entry)
            .await
            .expect("fixture manifest");
        assert!(read_verified(&directory).await.is_some());
        assert!(entry.fresh(1000 + CHECK_INTERVAL.as_secs() - 1));
        assert!(!entry.fresh(1000 + CHECK_INTERVAL.as_secs()));
        assert!(!entry.fresh(999));
        tokio::fs::write(&path, b"changed extractor")
            .await
            .expect("tamper fixture");
        assert!(read_verified(&directory).await.is_none());
        tokio::fs::remove_file(path)
            .await
            .expect("remove fixture binary");
        tokio::fs::remove_file(directory.join(MANIFEST))
            .await
            .expect("remove fixture manifest");
        tokio::fs::remove_dir(directory)
            .await
            .expect("remove fixture directory");
    }
}
