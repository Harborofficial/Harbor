//! Plays videos in the user's own mpv instead of the mpv built into Harbor.
//!
//! Harbor starts the user's mpv with a pipe it can listen to, and a background thread
//! follows it. The time, length and pause state go to the player screen as
//! `external-player://state`, so Harbor keeps saving progress and marking episodes
//! watched, just like with its built-in player. `external-player://exit` is sent once
//! when that mpv closes.

use std::io::{self, BufRead, BufReader, Read, Write};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};

const CONNECT_TIMEOUT: Duration = Duration::from_secs(20);
const EMIT_INTERVAL: Duration = Duration::from_millis(500);

static NEXT_SESSION: AtomicU64 = AtomicU64::new(1);
static SESSION: Mutex<Option<Session>> = Mutex::new(None);

struct Session {
    id: u64,
    child: Child,
    ipc_path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalPlayerStartArgs {
    pub url: String,
    /// If left empty, it uses mpv from PATH.
    pub binary: Option<String>,
    pub start_at_sec: Option<f64>,
    pub start_paused: Option<bool>,
    pub title: Option<String>,
    pub headers: Option<std::collections::HashMap<String, String>>,
    pub extra_args: Option<Vec<String>>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct PlayerState {
    session: u64,
    position_sec: f64,
    duration_sec: f64,
    paused: bool,
    buffering: bool,
    loaded: bool,
    eof: bool,
    width: i64,
    height: i64,
    /// The video stream itself could not be opened.
    error: Option<String>,
    /// mpv could not start or Harbor could not listen to it, so trying the source again
    /// won't help.
    launch_error: Option<String>,
}

fn ipc_path(session: u64) -> String {
    let pid = std::process::id();
    if cfg!(windows) {
        format!(r"\\.\pipe\harbor-external-mpv-{pid}-{session}")
    } else {
        std::env::temp_dir()
            .join(format!("harbor-external-mpv-{pid}-{session}.sock"))
            .to_string_lossy()
            .into_owned()
    }
}

#[cfg(windows)]
fn connect(path: &str) -> io::Result<(Box<dyn Read + Send>, Box<dyn Write + Send>)> {
    let pipe = std::fs::OpenOptions::new().read(true).write(true).open(path)?;
    let writer = pipe.try_clone()?;
    Ok((Box::new(pipe), Box::new(writer)))
}

#[cfg(unix)]
fn connect(path: &str) -> io::Result<(Box<dyn Read + Send>, Box<dyn Write + Send>)> {
    let stream = std::os::unix::net::UnixStream::connect(path)?;
    let writer = stream.try_clone()?;
    Ok((Box::new(stream), Box::new(writer)))
}

/// mpv opens its pipe a moment after it starts, so keep trying until it answers, mpv
/// closes, or the time limit runs out.
fn connect_when_ready(
    session: u64,
    path: &str,
) -> Option<(Box<dyn Read + Send>, Box<dyn Write + Send>)> {
    let started = Instant::now();
    while started.elapsed() < CONNECT_TIMEOUT {
        if !session_alive(session) {
            return None;
        }
        if let Ok(conn) = connect(path) {
            return Some(conn);
        }
        std::thread::sleep(Duration::from_millis(150));
    }
    None
}

fn session_alive(session: u64) -> bool {
    let mut guard = SESSION.lock().unwrap_or_else(|e| e.into_inner());
    match guard.as_mut() {
        Some(s) if s.id == session => matches!(s.child.try_wait(), Ok(None)),
        _ => false,
    }
}

fn session_pid(session: u64) -> Option<u32> {
    let guard = SESSION.lock().unwrap_or_else(|e| e.into_inner());
    guard.as_ref().filter(|s| s.id == session).map(|s| s.child.id())
}

/// Brings the mpv window to the front, so the user doesn't have to Alt+Tab to it.
/// Windows only allows this because Harbor is usually the active window right now.
/// Returns false while the mpv window isn't open yet.
#[cfg(windows)]
fn bring_to_front(pid: u32) -> bool {
    use windows::core::BOOL;
    use windows::Win32::Foundation::{HWND, LPARAM};
    use windows::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetWindowThreadProcessId, IsIconic, IsWindowVisible, SetForegroundWindow,
        SetWindowPos, ShowWindow, HWND_NOTOPMOST, HWND_TOPMOST, SWP_NOMOVE, SWP_NOSIZE,
        SW_RESTORE,
    };

    struct Search {
        pid: u32,
        found: Option<isize>,
    }
    unsafe extern "system" fn enum_proc(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let search = &mut *(lparam.0 as *mut Search);
        let mut pid = 0u32;
        GetWindowThreadProcessId(hwnd, Some(&mut pid));
        if pid == search.pid && IsWindowVisible(hwnd).as_bool() {
            search.found = Some(hwnd.0 as isize);
            return BOOL(0);
        }
        BOOL(1)
    }

    let mut search = Search { pid, found: None };
    unsafe {
        let _ = EnumWindows(Some(enum_proc), LPARAM(&mut search as *mut Search as isize));
    }
    let Some(raw) = search.found else { return false };
    let hwnd = HWND(raw as *mut _);
    unsafe {
        if IsIconic(hwnd).as_bool() {
            let _ = ShowWindow(hwnd, SW_RESTORE);
        }
        // Briefly pin it "always on top" and unpin it, so it lands above Harbor even if
        // Windows refuses to switch the focus.
        let flags = SWP_NOMOVE | SWP_NOSIZE;
        let _ = SetWindowPos(hwnd, Some(HWND_TOPMOST), 0, 0, 0, 0, flags);
        let _ = SetWindowPos(hwnd, Some(HWND_NOTOPMOST), 0, 0, 0, 0, flags);
        let _ = SetForegroundWindow(hwnd);
    }
    true
}

#[cfg(not(windows))]
fn bring_to_front(_pid: u32) -> bool {
    true
}

/// mpv's window shows up a moment after its pipe, so keep trying for a few seconds.
fn bring_to_front_when_shown(session: u64) {
    std::thread::spawn(move || {
        let started = Instant::now();
        while started.elapsed() < Duration::from_secs(5) {
            let Some(pid) = session_pid(session) else { return };
            if bring_to_front(pid) {
                return;
            }
            std::thread::sleep(Duration::from_millis(100));
        }
    });
}

fn kill_current() {
    kill_matching(|_| true);
}

fn kill_matching(matches: impl Fn(u64) -> bool) {
    let taken = {
        let mut guard = SESSION.lock().unwrap_or_else(|e| e.into_inner());
        if guard.as_ref().is_some_and(|s| matches(s.id)) {
            guard.take()
        } else {
            None
        }
    };
    if let Some(mut s) = taken {
        let _ = s.child.kill();
        let _ = s.child.wait();
    }
}

fn apply_property(state: &mut PlayerState, name: &str, data: &Value) {
    match name {
        "time-pos" => {
            if let Some(v) = data.as_f64() {
                state.position_sec = v;
                state.loaded = true;
            }
        }
        "duration" => {
            if let Some(v) = data.as_f64() {
                state.duration_sec = v;
            }
        }
        "pause" => state.paused = data.as_bool().unwrap_or(false),
        "paused-for-cache" => state.buffering = data.as_bool().unwrap_or(false),
        // mpv only sends this with keep-open on, and seeking back after the end clears it.
        // While closing, mpv also sends it empty, which must not undo the end.
        "eof-reached" => {
            if let Some(reached) = data.as_bool() {
                state.eof = reached;
            }
        }
        "width" => state.width = data.as_i64().unwrap_or(0),
        "height" => state.height = data.as_i64().unwrap_or(0),
        _ => {}
    }
}

fn follow(app: AppHandle, session: u64, path: String) {
    let mut state = PlayerState { session, ..Default::default() };
    let Some((reader, mut writer)) = connect_when_ready(session, &path) else {
        state.launch_error = Some(if session_alive(session) {
            "Harbor could not connect to mpv to follow playback.".into()
        } else {
            "mpv closed right after it started. Check the mpv location and mpv options in \
             Harbor's player settings."
                .into()
        });
        // If Harbor can't listen to mpv, nothing would save the progress, so close it.
        kill_matching(|id| id == session);
        let _ = app.emit("external-player://exit", &state);
        return;
    };
    let props = [
        "time-pos",
        "duration",
        "pause",
        "paused-for-cache",
        "eof-reached",
        "width",
        "height",
    ];
    for (i, name) in props.iter().enumerate() {
        let line = json!({ "command": ["observe_property", i + 1, name] }).to_string() + "\n";
        if writer.write_all(line.as_bytes()).is_err() {
            break;
        }
    }
    let _ = writer.flush();
    bring_to_front_when_shown(session);

    let mut last_emit = Instant::now() - EMIT_INTERVAL;
    let mut last_sent = PlayerState::default();
    for line in BufReader::new(reader).lines() {
        let Ok(line) = line else { break };
        let Ok(msg) = serde_json::from_str::<Value>(&line) else { continue };
        match msg.get("event").and_then(Value::as_str) {
            Some("property-change") => {
                let name = msg.get("name").and_then(Value::as_str).unwrap_or("");
                let was_loaded = state.loaded;
                apply_property(&mut state, name, msg.get("data").unwrap_or(&Value::Null));
                // Harbor's player screen can take the focus back while the video
                // loads, so bring mpv to the front again.
                if state.loaded && !was_loaded {
                    bring_to_front_when_shown(session);
                }
            }
            Some("end-file") => match msg.get("reason").and_then(Value::as_str) {
                Some("eof") => state.eof = true,
                Some("error") => {
                    let detail = msg
                        .get("file_error")
                        .and_then(Value::as_str)
                        .unwrap_or("mpv could not open the stream");
                    state.error = Some(detail.to_string());
                }
                _ => {}
            },
            _ => continue,
        }
        // The time changes every frame, so it is sent at most twice a second.
        // Everything else is sent right away.
        let only_clock_moved = PlayerState {
            position_sec: last_sent.position_sec,
            ..state.clone()
        } == last_sent;
        if only_clock_moved && last_emit.elapsed() < EMIT_INTERVAL {
            continue;
        }
        last_emit = Instant::now();
        last_sent = state.clone();
        let _ = app.emit("external-player://state", &state);
    }

    // The pipe closes when mpv quits, whether the user closed it or the video finished.
    kill_matching(|id| id == session);
    let _ = app.emit("external-player://exit", &state);
}

/// Starts the user's mpv for `url`, closing any external mpv Harbor started before.
/// Returns the ticket number (session id) that every update and the exit message carry.
#[tauri::command]
pub async fn external_player_start(
    app: AppHandle,
    args: ExternalPlayerStartArgs,
) -> Result<u64, String> {
    kill_current();
    let session = NEXT_SESSION.fetch_add(1, Ordering::Relaxed);
    let path = ipc_path(session);
    let binary = args
        .binary
        .as_deref()
        .map(str::trim)
        .filter(|b| !b.is_empty())
        .unwrap_or("mpv")
        .trim_matches('"')
        .to_string();

    let mut cmd = Command::new(&binary);
    #[cfg(target_os = "linux")]
    crate::linux_gamescope::configure_external_mpv(&mut cmd);
    cmd.arg(format!("--input-ipc-server={path}"))
        .arg("--force-window=immediate");
    if let Some(start) = args.start_at_sec.filter(|s| *s > 0.0) {
        cmd.arg(format!("--start={start:.3}"));
    }
    if args.start_paused.unwrap_or(false) {
        cmd.arg("--pause");
    }
    if let Some(title) = args.title.as_deref().filter(|t| !t.is_empty()) {
        cmd.arg(format!("--force-media-title={title}"));
    }
    for (key, value) in args.headers.iter().flatten() {
        if key.eq_ignore_ascii_case("user-agent") {
            cmd.arg(format!("--user-agent={value}"));
        } else {
            cmd.arg(format!("--http-header-fields-append={key}: {value}"));
        }
    }
    for extra in args.extra_args.iter().flatten() {
        cmd.arg(extra);
    }
    cmd.arg("--").arg(&args.url);
    cmd.stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // Stops a black console window from flashing up when the path points at mpv.com.
        cmd.creation_flags(0x0800_0000);
    }

    let child = cmd
        .spawn()
        .map_err(|e| {
            format!(
                "Could not start mpv at \"{binary}\": {e}. Check the mpv location in Harbor's \
                 player settings."
            )
        })?;
    *SESSION.lock().unwrap_or_else(|e| e.into_inner()) = Some(Session {
        id: session,
        child,
        ipc_path: path.clone(),
    });
    std::thread::Builder::new()
        .name("external-mpv".into())
        .spawn(move || follow(app, session, path))
        .map_err(|e| e.to_string())?;
    Ok(session)
}

/// Sends one command to the running mpv (for example `["set_property", "pause", true]`)
/// over a new pipe connection, then waits for mpv's answer.
#[tauri::command]
pub async fn external_player_command(session: u64, cmd: Vec<Value>) -> Result<(), String> {
    let path = SESSION
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .as_ref()
        .filter(|s| s.id == session)
        .map(|s| s.ipc_path.clone())
        .ok_or("external mpv session is not running")?;
    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        let (reader, mut writer) = connect_when_ready(session, &path)
            .ok_or("external mpv session closed before IPC was ready")?;
        let line = json!({ "command": cmd, "request_id": 1 }).to_string() + "\n";
        writer.write_all(line.as_bytes()).map_err(|e| e.to_string())?;
        writer.flush().map_err(|e| e.to_string())?;
        for line in BufReader::new(reader).lines() {
            let line = line.map_err(|e| e.to_string())?;
            let Ok(msg) = serde_json::from_str::<Value>(&line) else { continue };
            if msg.get("request_id").and_then(Value::as_u64) != Some(1) {
                continue;
            }
            return match msg.get("error").and_then(Value::as_str) {
                Some("success") | None => Ok(()),
                Some(err) => Err(err.to_string()),
            };
        }
        Err("mpv closed the connection".into())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Closes the external mpv with this ticket number, or whichever one is running if none
/// is given.
#[tauri::command]
pub async fn external_player_stop(session: Option<u64>) {
    kill_matching(|id| session.is_none_or(|wanted| wanted == id));
}

pub fn shutdown() {
    kill_current();
}
