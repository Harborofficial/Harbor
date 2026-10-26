use super::db::{upsert_track_in_transaction, MusicDb};
use super::{duration_label, MusicTrack};
use std::path::{Path, PathBuf};

const MAX_M3U_BYTES: u64 = 5 * 1024 * 1024;
const MAX_M3U_TRACKS: usize = 5_000;

// Long-lived native Music process. Only this host owns its stdin/stdout channel;
// serialized commands keep their responses aligned and allow future playback state.
struct NativeMusicHost {
    child: std::process::Child,
    stdin: std::process::ChildStdin,
    replies: std::sync::mpsc::Receiver<Result<Vec<u8>, String>>,
}

impl NativeMusicHost {
    fn start(path: &Path) -> Result<Self, String> {
        use std::process::{Command, Stdio};
        let mut command = Command::new(path);
        command.arg("--serve")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
        }
        crate::proc_guard::configure_std_command(&mut command);
        let mut child = command.spawn().map_err(|error| error.to_string())?;
        // The sidecar must never outlive Harbor, including when Harbor is force-closed by an
        // update or repair. Otherwise it keeps its executable locked against the next install.
        crate::proc_guard::adopt_std(&child);
        let stderr = child.stderr.take().ok_or("Music host event pipe unavailable")?;
        let event_app = MUSIC_EVENT_APP.get().cloned();
        std::thread::spawn(move || {
            use std::io::BufRead;
            use tauri::Emitter;
            let reader = std::io::BufReader::new(stderr);
            for line in reader.lines() {
                let Ok(line) = line else { break };
                if line.len() > 64 * 1024 { break; }
                let Ok(value) = serde_json::from_str::<serde_json::Value>(&line) else { continue };
                if value["kind"] != "music-event"
                    || value["abi"] != 1
                    || value["version"] != env!("CARGO_PKG_VERSION")
                    || value["channel"] != "music://event" {
                    continue;
                }
                if let Some(app) = &event_app {
                    account_for_playback(&value["payload"],app);
                    let _ = app.emit("music://event", value["payload"].clone());
                }
            }
        });
        let stdin = child.stdin.take().ok_or("Music host stdin unavailable")?;
        let stdout = child.stdout.take().ok_or("Music host stdout unavailable")?;
        let (reply_tx, replies) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            use std::io::{BufRead, Read};
            let mut reader = std::io::BufReader::new(stdout);
            loop {
                let mut reply = Vec::new();
                match reader.by_ref().take(16 * 1024 * 1024 + 1).read_until(b'\n', &mut reply) {
                    Ok(0) => {
                        let _ = reply_tx.send(Err("Music host closed its reply pipe".into()));
                        break;
                    }
                    Ok(received) if received > 16 * 1024 * 1024 || !reply.ends_with(b"\n") => {
                        let _ = reply_tx.send(Err("Music host reply missing or too large".into()));
                        break;
                    }
                    Ok(_) => {
                        if reply_tx.send(Ok(reply)).is_err() {
                            break;
                        }
                    }
                    Err(error) => {
                        let _ = reply_tx.send(Err(error.to_string()));
                        break;
                    }
                }
            }
        });
        Ok(Self { child, stdin, replies })
    }

    fn request(&mut self, command: &serde_json::Value) -> Result<Result<serde_json::Value, String>, String> {
        use std::io::Write;
        if self.child.try_wait().map_err(|error| error.to_string())?.is_some() {
            return Err("Music host exited".into());
        }
        let input = serde_json::to_vec(command).map_err(|error| error.to_string())?;
        if input.len() > 16 * 1024 * 1024 {
            return Err("Music host request too large".into());
        }
        self.stdin.write_all(&input).map_err(|error| error.to_string())?;
        self.stdin.write_all(b"\n").map_err(|error| error.to_string())?;
        self.stdin.flush().map_err(|error| error.to_string())?;
        let reply = match self.replies.recv_timeout(std::time::Duration::from_secs(60)) {
            Ok(Ok(reply)) => reply,
            Ok(Err(error)) => return Err(error),
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                return Err("Music host stopped responding".into());
            }
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                return Err("Music host reply channel closed".into());
            }
        };
        let value: serde_json::Value = serde_json::from_slice(&reply)
            .map_err(|error| error.to_string())?;
        if value["abi"] != 1 || value["version"] != env!("CARGO_PKG_VERSION") {
            return Err("Music host ABI or version mismatch".into());
        }
        if value["ok"] != true {
            // Valid protocol response: command failed, but the native process
            // remains healthy and must not be killed during ongoing playback.
            return Ok(Err(value["error"].as_str().unwrap_or("Music host request failed").to_string()));
        }
        Ok(Ok(value["data"].clone()))
    }
}

impl Drop for NativeMusicHost {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

struct ScrobbleLedger {
    track: super::MusicTrack,
    started_at: u64,
    last_position: Option<f64>,
    listened_seconds: f64,
    duration_seconds: f64,
    sent: bool,
}

static MUSIC_SCROBBLE: std::sync::OnceLock<std::sync::Mutex<Option<ScrobbleLedger>>> =
    std::sync::OnceLock::new();

pub(super) fn playback_started(track: &super::MusicTrack) {
    let ledger=MUSIC_SCROBBLE.get_or_init(||std::sync::Mutex::new(None));
    let started_at=std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|v|v.as_secs()).unwrap_or(0);
    if let Ok(mut current)=ledger.lock(){
        *current=Some(ScrobbleLedger{
            track:track.clone(),started_at,last_position:None,
            listened_seconds:0.0,duration_seconds:track.duration_seconds as f64,
            sent:false
        });
    }
}

fn account_for_playback(event:&serde_json::Value, app:&tauri::AppHandle) {
    // Broadcast and DJ deck B must not double-count listening time.
    if event["deck"].as_u64() == Some(1) {return;}
    let Some(ledger)=MUSIC_SCROBBLE.get() else{return};
    let maybe_scrobble={
        let Ok(mut ledger)=ledger.lock() else{return};
        let Some(current)=ledger.as_mut() else{return};
        if event["trackId"].as_str()!=Some(current.track.id.as_str()) {
            return;
        }
        if event["event"]=="property-change" {
            match event["name"].as_str() {
                Some("time-pos")=>{
                    if let Some(position)=event["data"].as_f64() {
                        current.listened_seconds+=crate::music::engine::listened_increment(
                            current.last_position,position);
                        current.last_position=Some(position);
                    }
                },
                Some("duration")=>{
                    if let Some(duration)=event["data"].as_f64().filter(|v|v.is_finite() && *v>0.0) {
                        current.duration_seconds=duration;
                    }
                },
                _=>{}
            }
            return;
        }
        if event["event"]=="seek" {
            current.last_position=None;
            return;
        }
        if event["event"]=="end-file" && event["reason"]=="eof" && !current.sent
            && crate::music::engine::should_scrobble(
                current.listened_seconds,current.duration_seconds) {
            current.sent=true;
            Some((current.track.clone(),current.started_at))
        } else {None}
    };
    if let Some((track,started_at))=maybe_scrobble {
        let app=app.clone();
        tauri::async_runtime::spawn(async move {
            use tauri::Emitter;
            match crate::music::commands::scrobble_track(&app,&track,started_at).await {
                Ok(true)=>{let _=app.emit("music://lastfm",serde_json::json!({"status":"scrobbled"}));},
                Ok(false)=>{},
                Err(error)=>{
                    let _=app.emit("music://lastfm",serde_json::json!({
                        "status":"error","message":error
                    }));
                }
            }
        });
    }
}

static MUSIC_EVENT_APP: std::sync::OnceLock<tauri::AppHandle> = std::sync::OnceLock::new();

pub(super) fn shutdown_host() {
    if let Some(host)=MUSIC_HOST.get() {
        if let Ok(mut state)=host.lock() {
            // Dropping the host closes its pipes and terminates the child. This
            // is a process cleanup, not an account/data deletion operation.
            *state=None;
        }
    }
}

pub(super) fn configure_event_bridge(app: &tauri::AppHandle) {
    let _ = MUSIC_EVENT_APP.set(app.clone());
}

static MUSIC_HOST: std::sync::OnceLock<std::sync::Mutex<Option<NativeMusicHost>>> =
    std::sync::OnceLock::new();

pub(super) fn module_request(command: serde_json::Value) -> Option<Result<serde_json::Value, String>> {
    let directory = std::env::current_exe().ok()?.parent()?.to_path_buf();
    let binary = directory.join("components").join("music").join("harbor-music-module.exe");
    if !binary.is_file() {
        return None;
    }
    let host = MUSIC_HOST.get_or_init(|| std::sync::Mutex::new(None));
    let mut host = match host.lock() {
        Ok(host) => host,
        Err(_) => return Some(Err("Music host lock poisoned".into())),
    };
    if host.is_none() {
        match NativeMusicHost::start(&binary) {
            Ok(client) => *host = Some(client),
            Err(error) => return Some(Err(error)),
        }
    }
    let result = host.as_mut().expect("Music host created").request(&command);
    if result.is_err() {
        // Don't retain a dead or incompatible service across future commands.
        *host = None;
    }
    Some(result.unwrap_or_else(Err))
}

// Opt-in integration gate: production builds continue to use the battle-tested
// in-process playback path until external DJ, Spotify and audio settings are complete.
pub(super) fn experimental_local_playback(track: &super::MusicTrack) -> bool {
    let enabled = cfg!(feature = "music-sidecar")
        || (track.connector_id.as_deref() == Some("local")
            && std::env::var("HARBOR_EXPERIMENTAL_MUSIC_SIDECAR").as_deref() == Ok("1"));
    enabled && std::env::current_exe().ok().and_then(|path| path.parent().map(|p| p
        .join("components").join("music").join("harbor-music-module.exe")))
        .is_some_and(|path| path.is_file())
}

pub(super) async fn module_request_async(
    command: serde_json::Value,
) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        module_request(command).unwrap_or_else(|| Err("Music module is not installed".into()))
    }).await.map_err(|e| format!("Music module request interrupted: {e}"))?
}

#[derive(Default)]
struct EntryMetadata {
    duration_seconds: u64,
    artist: Option<String>,
    title: Option<String>,
}

pub fn import(database: &MusicDb, raw_path: &str) -> Result<Vec<MusicTrack>, String> {
    let path = input_path(raw_path)?;
    let metadata = std::fs::metadata(&path).map_err(|error| error.to_string())?;
    if !metadata.is_file() {
        return Err("M3U import path is not a file".to_string());
    }
    if metadata.len() > MAX_M3U_BYTES {
        return Err("M3U file is larger than 5 MB".to_string());
    }
    let bytes = std::fs::read(&path).map_err(|error| error.to_string())?;
    let content = String::from_utf8_lossy(&bytes);
    let tracks = if let Some(result) = module_request(serde_json::json!({
        "command": "parse_m3u", "path": path.to_string_lossy()
    })) {
        serde_json::from_value(result?).map_err(|error| error.to_string())?
    } else {
        parse(&content, path.parent().unwrap_or_else(|| Path::new(".")))?
    };
    database.with_connection(|connection| {
        let transaction = connection
            .transaction()
            .map_err(|error| error.to_string())?;
        for track in &tracks {
            upsert_track_in_transaction(&transaction, track)?;
        }
        transaction.commit().map_err(|error| error.to_string())?;
        Ok(tracks)
    })
}

pub fn export(raw_path: &str, tracks: &[(MusicTrack, String)]) -> Result<(), String> {
    let path = output_path(raw_path)?;
    let content = if let Some(result) = module_request(serde_json::json!({
        "command": "render_m3u", "tracks": tracks
    })) {
        serde_json::from_value::<String>(result?).map_err(|error| error.to_string())?
    } else {
        render(tracks)?
    };
    std::fs::write(path, content.as_bytes()).map_err(|error| error.to_string())
}

fn parse(content: &str, base: &Path) -> Result<Vec<MusicTrack>, String> {
    let mut tracks = Vec::new();
    let mut pending = EntryMetadata::default();
    for raw_line in content.lines() {
        let line = raw_line.trim().trim_start_matches('\u{feff}');
        if line.is_empty() {
            continue;
        }
        if let Some(value) = line.strip_prefix("#EXTINF:") {
            pending = parse_metadata(value);
            continue;
        }
        if line.starts_with('#') {
            continue;
        }
        if tracks.len() >= MAX_M3U_TRACKS {
            return Err("M3U file contains more than 5000 tracks".to_string());
        }
        let location = normalize_location(line, base)?;
        let title = pending
            .title
            .take()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| title_from_location(&location));
        let artist = pending
            .artist
            .take()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| "Unknown artist".to_string());
        let duration_seconds = pending.duration_seconds;
        pending = EntryMetadata::default();
        let connector = if location.contains("://") {
            "direct"
        } else {
            "local"
        };
        tracks.push(MusicTrack {
            explicit: None,
            version: None,
            media_kind: None,
            id: format!("m3u:{:016x}", stable_hash(&location)),
            connector_id: Some(connector.to_string()),
            source_id: Some(location.clone()),
            playback_url: Some(location),
            title,
            artist,
            album: None,
            artwork: String::new(),
            duration_seconds,
            duration_label: duration_label(duration_seconds),
        });
    }
    Ok(tracks)
}

fn parse_metadata(value: &str) -> EntryMetadata {
    let (duration, label) = value.split_once(',').unwrap_or((value, ""));
    let duration_seconds = duration.trim().parse::<i64>().unwrap_or(0).max(0) as u64;
    let label = label.trim();
    let (artist, title) = label
        .split_once(" - ")
        .map(|(artist, title)| {
            (
                Some(artist.trim().to_string()),
                Some(title.trim().to_string()),
            )
        })
        .unwrap_or((None, (!label.is_empty()).then(|| label.to_string())));
    EntryMetadata {
        duration_seconds,
        artist,
        title,
    }
}

fn normalize_location(location: &str, base: &Path) -> Result<String, String> {
    if location.contains("://") {
        let parsed =
            url::Url::parse(location).map_err(|_| "M3U contains an invalid URL".to_string())?;
        if !matches!(parsed.scheme(), "http" | "https" | "file") {
            return Err(format!(
                "M3U URL scheme is not supported: {}",
                parsed.scheme()
            ));
        }
        return Ok(parsed.to_string());
    }
    let path = PathBuf::from(location);
    let path = if path.is_absolute() {
        path
    } else {
        base.join(path)
    };
    Ok(path.to_string_lossy().to_string())
}

fn title_from_location(location: &str) -> String {
    if let Ok(url) = url::Url::parse(location) {
        if let Some(segment) = url.path_segments().and_then(|segments| segments.last()) {
            let title = segment
                .rsplit_once('.')
                .map(|item| item.0)
                .unwrap_or(segment);
            if !title.is_empty() {
                return title.to_string();
            }
        }
    }
    Path::new(location)
        .file_stem()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .unwrap_or("Untitled track")
        .to_string()
}

fn render(tracks: &[(MusicTrack, String)]) -> Result<String, String> {
    let mut output = String::from("#EXTM3U\n");
    for (track, url) in tracks {
        let url = url.trim();
        if url.is_empty() || url.contains(['\r', '\n']) {
            return Err(format!("{} has no exportable stream URL", track.title));
        }
        let artist = one_line(&track.artist);
        let title = one_line(&track.title);
        output.push_str(&format!(
            "#EXTINF:{},{} - {}\n{}\n",
            track.duration_seconds, artist, title, url
        ));
    }
    Ok(output)
}

fn one_line(value: &str) -> String {
    value.replace(['\r', '\n'], " ").trim().to_string()
}

fn input_path(raw: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(raw.trim());
    if raw.trim().is_empty() {
        return Err("M3U import path is empty".to_string());
    }
    Ok(path)
}

fn output_path(raw: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(raw.trim());
    if raw.trim().is_empty() || path.file_name().is_none() {
        return Err("M3U export path is invalid".to_string());
    }
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() && !parent.is_dir() {
            return Err("M3U export directory does not exist".to_string());
        }
    }
    Ok(path)
}

fn stable_hash(value: &str) -> u64 {
    value
        .as_bytes()
        .iter()
        .fold(0xcbf29ce484222325, |hash, byte| {
            (hash ^ u64::from(*byte)).wrapping_mul(0x100000001b3)
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parser_preserves_extinf_and_resolves_relative_paths() {
        let tracks = parse(
            "#EXTM3U\n#EXTINF:227,Muse - Hysteria\ntracks/hysteria.flac\n",
            Path::new("C:/Music"),
        )
        .expect("parse m3u");
        assert_eq!(tracks.len(), 1);
        assert_eq!(tracks[0].artist, "Muse");
        assert_eq!(tracks[0].title, "Hysteria");
        assert_eq!(tracks[0].duration_seconds, 227);
        let playback = tracks[0].playback_url.as_deref().expect("playback path");
        assert!(playback
            .replace('\\', "/")
            .ends_with("Music/tracks/hysteria.flac"));
    }

    #[test]
    fn renderer_writes_extended_entries_with_stream_urls() {
        let track = MusicTrack {
            explicit: None,
            version: None,
            media_kind: None,
            id: "one".to_string(),
            connector_id: Some("youtube".to_string()),
            source_id: Some("one".to_string()),
            playback_url: None,
            title: "Hysteria".to_string(),
            artist: "Muse".to_string(),
            album: None,
            artwork: String::new(),
            duration_seconds: 227,
            duration_label: "3:47".to_string(),
        };
        let rendered =
            render(&[(track, "https://example.test/audio".to_string())]).expect("render m3u");
        assert_eq!(
            rendered,
            "#EXTM3U\n#EXTINF:227,Muse - Hysteria\nhttps://example.test/audio\n"
        );
    }
}
