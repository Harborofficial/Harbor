use std::collections::{HashMap, HashSet, VecDeque};
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;
use std::time::{Duration, Instant};

use serde_json::{json, Value};
use tauri::{Emitter, State};
#[cfg(windows)]
#[allow(unused_imports)]
use tokio::io::AsyncReadExt;
use tokio::io::AsyncWriteExt;
use tokio::process::{Child, Command};
use tokio::sync::{mpsc, oneshot, Mutex, Notify, OnceCell};
use uuid::Uuid;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

const BUCKET_SECONDS: f64 = 2.0;
const THUMB_WIDTH: u32 = 240;
const SCREENSHOT_QUALITY: u32 = 72;
const REQUEST_TIMEOUT_MS: u64 = 12000;
// This source needs 3-5 s per cold seek. A 4 s cutoff discarded frames that
// were nearly ready and forced a second seek for the same data.
const SEEK_WAIT_MS: u64 = 8000;
// A move this close still reads as "here", so a running seek should finish
// instead of paying for another one.
const NEARBY_BUCKETS: u32 = 5;
const SHADOW_QUIT_GRACE: Duration = Duration::from_millis(80);
const SHADOW_KILL_WAIT: Duration = Duration::from_secs(2);
const THUMB_CACHE_MAX_BYTES: usize = 48 * 1024 * 1024;
const THUMB_CACHE_MAX_ENTRIES: usize = 512;
const PREFETCH_MAX_ATTEMPTS: usize = 512;
const PREFETCH_MAX_QUEUED: usize = 8;

type Pending = Arc<Mutex<HashMap<u64, oneshot::Sender<Result<Value, String>>>>>;

struct CacheEntry {
    value: String,
    bytes: usize,
    last_used: u64,
}

struct ThumbCache {
    entries: HashMap<u32, CacheEntry>,
    total_bytes: usize,
    clock: u64,
    max_bytes: usize,
    max_entries: usize,
}

impl ThumbCache {
    fn new(max_bytes: usize, max_entries: usize) -> Self {
        Self {
            entries: HashMap::new(),
            total_bytes: 0,
            clock: 0,
            max_bytes,
            max_entries,
        }
    }

    fn tick(&mut self) -> u64 {
        self.clock = self.clock.wrapping_add(1);
        self.clock
    }

    fn get(&mut self, bucket: u32) -> Option<String> {
        let last_used = self.tick();
        self.entries.get_mut(&bucket).map(|entry| {
            entry.last_used = last_used;
            entry.value.clone()
        })
    }

    fn contains(&self, bucket: u32) -> bool {
        self.entries.contains_key(&bucket)
    }

    fn insert(&mut self, bucket: u32, value: String) {
        let bytes = value.len();
        if bytes > self.max_bytes || self.max_entries == 0 {
            return;
        }
        if let Some(previous) = self.entries.remove(&bucket) {
            self.total_bytes = self.total_bytes.saturating_sub(previous.bytes);
        }
        while self.entries.len() >= self.max_entries
            || self.total_bytes.saturating_add(bytes) > self.max_bytes
        {
            let Some((&oldest, _)) = self.entries.iter().min_by_key(|(_, entry)| entry.last_used)
            else {
                break;
            };
            if let Some(removed) = self.entries.remove(&oldest) {
                self.total_bytes = self.total_bytes.saturating_sub(removed.bytes);
            }
        }
        let last_used = self.tick();
        self.total_bytes = self.total_bytes.saturating_add(bytes);
        self.entries.insert(
            bucket,
            CacheEntry {
                value,
                bytes,
                last_used,
            },
        );
    }

    fn clear(&mut self) {
        self.entries.clear();
        self.total_bytes = 0;
    }

    #[cfg(test)]
    fn len(&self) -> usize {
        self.entries.len()
    }

    #[cfg(test)]
    fn bytes(&self) -> usize {
        self.total_bytes
    }
}

pub struct ThumbsState {
    inner: Arc<Mutex<Inner>>,
    spawn_lock: Arc<Mutex<()>>,
}

struct Inner {
    shadow: Option<Shadow>,
    url: Option<String>,
    headers: Option<HashMap<String, String>>,
    session: Option<String>,
    cache: ThumbCache,
    pending: Pending,
    next_request_id: u64,
    next_worker_id: u64,
    wanted: Option<u32>,
    in_flight: Option<u32>,
    wanted_notify: Arc<Notify>,
    active_worker: Option<u64>,
    prefetch: VecDeque<u32>,
    prefetched: HashSet<u32>,
    speculative: bool,
    prefetch_allowed: bool,
    timeline: VecDeque<u32>,
    timeline_initialized: bool,
    timeline_turn: bool,
}

struct Shadow {
    child: Child,
    writer_tx: mpsc::Sender<Value>,
    cache_dir: PathBuf,
    pipe: String,
    seek_notify: Arc<Notify>,
    filter_ready: Arc<OnceCell<()>>,
}

enum ThumbResult {
    Ready(String),
    Superseded,
    Failed,
}

impl ThumbsState {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(Inner {
                shadow: None,
                url: None,
                headers: None,
                session: None,
                cache: ThumbCache::new(THUMB_CACHE_MAX_BYTES, THUMB_CACHE_MAX_ENTRIES),
                pending: Arc::new(Mutex::new(HashMap::new())),
                next_request_id: 1000,
                next_worker_id: 1,
                wanted: None,
                in_flight: None,
                wanted_notify: Arc::new(Notify::new()),
                active_worker: None,
                prefetch: VecDeque::new(),
                prefetched: HashSet::new(),
                speculative: false,
                prefetch_allowed: false,
                timeline: VecDeque::new(),
                timeline_initialized: false,
                timeline_turn: false,
            })),
            spawn_lock: Arc::new(Mutex::new(())),
        }
    }
}

pub(crate) fn locate_mpv() -> Option<PathBuf> {
    let mut candidates: Vec<String> = Vec::new();
    if cfg!(windows) {
        if let Ok(exe) = std::env::current_exe() {
            if let Some(dir) = exe.parent() {
                candidates.push(dir.join("mpv.exe").to_string_lossy().into_owned());
                candidates.push(
                    dir.join("mpv-x86_64-pc-windows-msvc.exe")
                        .to_string_lossy()
                        .into_owned(),
                );
                for up in ["..", "..\\..", "..\\..\\.."] {
                    candidates.push(
                        dir.join(format!("{up}\\binaries\\mpv-x86_64-pc-windows-msvc.exe"))
                            .to_string_lossy()
                            .into_owned(),
                    );
                }
            }
        }
        candidates.push(r"src-tauri\binaries\mpv-x86_64-pc-windows-msvc.exe".into());
        candidates.push(r"binaries\mpv-x86_64-pc-windows-msvc.exe".into());
        candidates.push("mpv.exe".into());
        candidates.push("mpv".into());
    } else if cfg!(target_os = "macos") {
        if let Ok(exe) = std::env::current_exe() {
            if let Some(dir) = exe.parent() {
                candidates.push(dir.join("mpv").to_string_lossy().into_owned());
            }
        }
        candidates.push("/opt/homebrew/bin/mpv".into());
        candidates.push("/usr/local/bin/mpv".into());
        candidates.push("mpv".into());
    } else {
        candidates.extend(
            crate::binary_lookup::linux_binary_candidates("mpv")
                .into_iter()
                .map(|path| path.to_string_lossy().into_owned()),
        );
    }
    for c in candidates {
        let p = PathBuf::from(&c);
        let mut cmd = std::process::Command::new(&p);
        cmd.arg("--version");
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }
        if let Ok(out) = cmd.output() {
            if out.status.success() {
                return Some(p);
            }
        }
    }
    None
}

fn shadow_pipe(session: &str) -> String {
    if cfg!(windows) {
        format!("\\\\.\\pipe\\harbor-thumbs-{}", session)
    } else {
        std::env::temp_dir()
            .join(format!("harbor-thumbs-{}.sock", session))
            .to_string_lossy()
            .into_owned()
    }
}

fn cache_dir(session: &str) -> PathBuf {
    std::env::temp_dir().join("harbor-thumbs").join(session)
}

async fn drop_shadow(shadow: &mut Shadow) {
    let _ = shadow.writer_tx.try_send(json!({"command": ["quit"]}));
    tokio::time::sleep(SHADOW_QUIT_GRACE).await;
    if shadow.child.try_wait().ok().flatten().is_none() {
        if let Err(error) = shadow.child.start_kill() {
            eprintln!("[thumbs] failed to kill shadow mpv: {error}");
        }
        if tokio::time::timeout(SHADOW_KILL_WAIT, shadow.child.wait())
            .await
            .is_err()
        {
            eprintln!("[thumbs] shadow mpv did not exit after kill request");
        }
    }
    let _ = tokio::fs::remove_file(&shadow.pipe).await;
    let _ = tokio::fs::remove_dir_all(&shadow.cache_dir).await;
}

async fn send_ipc_message(
    writer_tx: &mpsc::Sender<Value>,
    message: Value,
    timeout_duration: Duration,
) -> Result<(), String> {
    match tokio::time::timeout(timeout_duration, writer_tx.send(message)).await {
        Ok(Ok(())) => Ok(()),
        Ok(Err(_)) => Err("mpv IPC writer closed".to_string()),
        Err(_) => Err("mpv IPC writer timeout".to_string()),
    }
}

#[tauri::command]
pub async fn thumbs_set_url(
    state: State<'_, ThumbsState>,
    url: String,
    headers: Option<HashMap<String, String>>,
) -> Result<String, String> {
    let session = Uuid::new_v4().simple().to_string();
    let shadow = {
        let mut inner = state.inner.lock().await;
        let shadow = inner.shadow.take();
        inner.url = Some(url);
        inner.headers = headers;
        inner.session = Some(session.clone());
        inner.cache.clear();
        inner.prefetch.clear();
        inner.prefetch_allowed = false;
        inner.timeline.clear();
        inner.timeline_initialized = false;
        inner.timeline_turn = false;
        inner.prefetched.clear();
        inner.speculative = false;
        inner.wanted_notify.notify_waiters();
        inner.wanted = None;
        inner.in_flight = None;
        inner.active_worker = None;
        shadow
    };
    let _spawn_guard = state.spawn_lock.lock().await;
    if let Some(mut s) = shadow {
        drop_shadow(&mut s).await;
    }
    Ok(session)
}

#[tauri::command]
pub async fn thumbs_spawn_eager(state: State<'_, ThumbsState>) -> Result<(), String> {
    let _spawn_guard = state.spawn_lock.lock().await;
    let (url, headers, session, pending) = {
        let inner = state.inner.lock().await;
        if inner.shadow.is_some() {
            return Ok(());
        }
        (
            inner.url.clone().ok_or_else(|| "no url".to_string())?,
            inner.headers.clone(),
            inner
                .session
                .clone()
                .ok_or_else(|| "no session".to_string())?,
            inner.pending.clone(),
        )
    };
    let shadow = spawn_shadow(&url, &session, pending, &headers).await?;
    let stale = {
        let mut inner = state.inner.lock().await;
        if inner.session.as_deref() == Some(session.as_str()) && inner.shadow.is_none() {
            inner.shadow = Some(shadow);
            None
        } else {
            Some(shadow)
        }
    };
    if let Some(mut shadow) = stale {
        drop_shadow(&mut shadow).await;
    }
    Ok(())
}

#[tauri::command]
pub async fn thumbs_get(
    app: tauri::AppHandle,
    state: State<'_, ThumbsState>,
    time_sec: f64,
    session: String,
) -> Result<Option<String>, String> {
    if !time_sec.is_finite() || time_sec < 0.0 {
        return Ok(None);
    }
    let bucket = (time_sec / BUCKET_SECONDS).round() as u32;
    let inner_arc = state.inner.clone();
    let mut inner = inner_arc.lock().await;
    if inner.session.as_deref() != Some(session.as_str()) {
        return Ok(None);
    }
    if let Some(p) = inner.cache.get(bucket) {
        return Ok(Some(p.clone()));
    }
    if inner.url.is_none() || inner.session.is_none() {
        return Err("no url".to_string());
    }
    // Promote a speculative frame without restarting its seek. Keep a wanted
    // entry in case cancellation was already signalled before this request.
    if inner.active_worker.is_some() && inner.in_flight == Some(bucket) {
        inner.speculative = false;
        inner.wanted = Some(bucket);
        return Ok(None);
    }
    if inner.wanted != Some(bucket) {
        inner.wanted = Some(bucket);
        inner.wanted_notify.notify_waiters();
    }
    if inner.active_worker.is_none() {
        let worker_id = inner.next_worker_id;
        inner.next_worker_id = inner.next_worker_id.wrapping_add(1);
        inner.active_worker = Some(worker_id);
        let arc = inner_arc.clone();
        let spawn_lock = state.spawn_lock.clone();
        tokio::spawn(worker(arc, spawn_lock, worker_id, app));
    }
    Ok(None)
}

#[tauri::command]
pub async fn thumbs_prefetch(
    app: tauri::AppHandle,
    state: State<'_, ThumbsState>,
    session: String,
    times: Vec<f64>,
    duration_sec: Option<f64>,
) -> Result<(), String> {
    let mut inner = state.inner.lock().await;
    if inner.session.as_deref() != Some(session.as_str()) {
        return Ok(());
    }
    inner.prefetch.clear();
    inner.prefetch_allowed = !times.is_empty();
    if inner.prefetch_allowed && !inner.timeline_initialized {
        if let Some(duration) = duration_sec.filter(|d| d.is_finite() && *d > 0.0) {
            inner.timeline = timeline_buckets(duration);
            inner.timeline_initialized = true;
        }
    }
    if times.is_empty() && inner.speculative {
        inner.wanted_notify.notify_waiters();
    }
    for time in times.into_iter().take(PREFETCH_MAX_QUEUED) {
        if !time.is_finite() || time < 0.0 {
            continue;
        }
        let bucket = (time / BUCKET_SECONDS).round() as u32;
        if !inner.cache.contains(bucket)
            && !inner.prefetched.contains(&bucket)
            && inner.in_flight != Some(bucket)
            && !inner.prefetch.contains(&bucket)
        {
            inner.prefetch.push_back(bucket);
        }
    }
    if inner.prefetch_allowed
        && inner.active_worker.is_none()
        && (!inner.prefetch.is_empty() || !inner.timeline.is_empty())
        && inner.prefetched.len() < PREFETCH_MAX_ATTEMPTS
    {
        let worker_id = inner.next_worker_id;
        inner.next_worker_id = inner.next_worker_id.wrapping_add(1);
        inner.active_worker = Some(worker_id);
        tokio::spawn(worker(
            state.inner.clone(),
            state.spawn_lock.clone(),
            worker_id,
            app,
        ));
    }
    Ok(())
}

// Fill the largest uncovered intervals first, rather than spending minutes
// building previews only at the beginning of a long title.
fn timeline_buckets(duration: f64) -> VecDeque<u32> {
    let spacing = (duration / 180.0).max(30.0);
    let count = (duration / spacing).ceil() as usize;
    let mut ranges = VecDeque::from([(0, count)]);
    let mut buckets = VecDeque::new();
    while let Some((start, end)) = ranges.pop_front() {
        if start >= end {
            continue;
        }
        let mid = start + (end - start) / 2;
        let bucket = ((mid as f64 * spacing) / BUCKET_SECONDS).floor() as u32;
        buckets.push_back(bucket);
        ranges.push_back((start, mid));
        ranges.push_back((mid + 1, end));
    }
    buckets
}

fn should_cancel(wanted: Option<u32>, bucket: u32) -> bool {
    match wanted {
        Some(wanted) => wanted.abs_diff(bucket) > NEARBY_BUCKETS,
        None => true,
    }
}

fn next_bucket(inner: &mut Inner) -> Option<u32> {
    inner.in_flight = None;
    inner.speculative = false;
    if let Some(bucket) = inner.wanted.take() {
        return Some(bucket);
    }
    while inner.prefetch_allowed && inner.prefetched.len() < PREFETCH_MAX_ATTEMPTS {
        let bucket = if inner.timeline_turn {
            inner
                .timeline
                .pop_front()
                .or_else(|| inner.prefetch.pop_front())
        } else {
            inner
                .prefetch
                .pop_front()
                .or_else(|| inner.timeline.pop_front())
        }?;
        if inner.cache.contains(bucket) || !inner.prefetched.insert(bucket) {
            continue;
        }
        inner.timeline_turn = !inner.timeline_turn;
        inner.speculative = true;
        return Some(bucket);
    }
    inner.prefetch.clear();
    None
}

async fn worker(
    inner_arc: Arc<Mutex<Inner>>,
    spawn_lock: Arc<Mutex<()>>,
    worker_id: u64,
    app: tauri::AppHandle,
) {
    loop {
        let (bucket, url, headers, session, pending, shadow) = {
            let mut inner = inner_arc.lock().await;
            if inner.active_worker != Some(worker_id) {
                return;
            }
            let bucket = match next_bucket(&mut inner) {
                Some(b) => b,
                None => {
                    inner.active_worker = None;
                    return;
                }
            };
            inner.in_flight = Some(bucket);
            if inner.cache.contains(bucket) {
                continue;
            }
            let url = match inner.url.clone() {
                Some(u) => u,
                None => {
                    inner.active_worker = None;
                    return;
                }
            };
            let session = match inner.session.clone() {
                Some(s) => s,
                None => {
                    inner.active_worker = None;
                    return;
                }
            };
            (
                bucket,
                url,
                inner.headers.clone(),
                session,
                inner.pending.clone(),
                inner.shadow.is_some(),
            )
        };
        let job_started = Instant::now();
        if !shadow {
            let _spawn_guard = spawn_lock.lock().await;
            let should_spawn = {
                let inner = inner_arc.lock().await;
                inner.active_worker == Some(worker_id)
                    && inner.session.as_deref() == Some(session.as_str())
                    && inner.shadow.is_none()
            };
            if !should_spawn {
                let mut inner = inner_arc.lock().await;
                if inner.active_worker == Some(worker_id) {
                    if inner.session.as_deref() == Some(session.as_str()) && inner.shadow.is_some()
                    {
                        if !inner.speculative {
                            inner.wanted.get_or_insert(bucket);
                        } else if inner.prefetch_allowed {
                            inner.prefetched.remove(&bucket);
                            inner.prefetch.push_front(bucket);
                        }
                        continue;
                    }
                    inner.active_worker = None;
                }
                return;
            }
            let new_shadow = match spawn_shadow(&url, &session, pending.clone(), &headers).await {
                Ok(shadow) => shadow,
                Err(_) => {
                    let mut inner = inner_arc.lock().await;
                    if inner.active_worker == Some(worker_id) {
                        inner.active_worker = None;
                        inner.in_flight = None;
                        let failed = inner.wanted.take().unwrap_or(bucket);
                        let _ = app.emit(
                            "thumb-ready",
                            json!({"session": session, "bucket": failed, "uri": null}),
                        );
                    }
                    return;
                }
            };
            let stale = {
                let mut inner = inner_arc.lock().await;
                if inner.session.as_deref() == Some(session.as_str()) && inner.shadow.is_none() {
                    inner.shadow = Some(new_shadow);
                    None
                } else {
                    Some(new_shadow)
                }
            };
            if let Some(mut stale) = stale {
                drop_shadow(&mut stale).await;
            }
        }
        let (bucket, writer_tx, dir, request_id, seek_notify, filter_ready, wanted_notify) = {
            let mut inner = inner_arc.lock().await;
            if inner.active_worker != Some(worker_id)
                || inner.session.as_deref() != Some(session.as_str())
            {
                if inner.active_worker == Some(worker_id) {
                    inner.active_worker = None;
                }
                return;
            }
            let request_id = inner.next_request_id;
            inner.next_request_id += 3;
            // Startup may have taken seconds; serve the latest hover position first.
            let bucket = if let Some(wanted) = inner.wanted.take() {
                inner.speculative = false;
                wanted
            } else {
                bucket
            };
            if inner.speculative && !inner.prefetch_allowed {
                continue;
            }
            inner.in_flight = Some(bucket);
            let Some(shadow) = inner.shadow.as_ref() else {
                inner.active_worker = None;
                return;
            };
            (
                bucket,
                shadow.writer_tx.clone(),
                shadow.cache_dir.clone(),
                request_id,
                shadow.seek_notify.clone(),
                shadow.filter_ready.clone(),
                inner.wanted_notify.clone(),
            )
        };
        // A newer position arrived while this one was being set up; skip it so
        // the seek is spent on what the pointer is actually over.
        if inner_arc.lock().await.wanted.is_some() {
            continue;
        }
        let started = Instant::now();
        // Distant jumps cancel the running seek; nearby moves let it finish.
        // The UI already shows a nearby cached frame and marks it approximate,
        // so restarting a multi-second remote seek on every small move is waste.
        let cancelled = {
            let inner_arc = inner_arc.clone();
            let wanted_notify = wanted_notify.clone();
            async move {
                loop {
                    wanted_notify.notified().await;
                    let wanted = inner_arc.lock().await.wanted;
                    if should_cancel(wanted, bucket) {
                        return;
                    }
                }
            }
        };
        tokio::pin!(cancelled);
        let generation = generate_thumb(
            bucket,
            &writer_tx,
            &dir,
            request_id,
            &pending,
            &seek_notify,
            &filter_ready,
        );
        let uri = tokio::select! {
            result = generation => result,
            _ = &mut cancelled => ThumbResult::Superseded,
        };
        // Cancelling during metadata/screenshot IPC must also release its waiter.
        if matches!(uri, ThumbResult::Superseded) {
            let mut pending = pending.lock().await;
            for id in request_id..request_id + 3 {
                pending.remove(&id);
            }
        }
        let mut inner = inner_arc.lock().await;
        if inner.active_worker != Some(worker_id)
            || inner.session.as_deref() != Some(session.as_str())
        {
            if inner.active_worker == Some(worker_id) {
                inner.active_worker = None;
            }
            return;
        }
        if !inner.speculative {
            let outcome = match &uri {
                ThumbResult::Ready(_) => "ready",
                ThumbResult::Failed => "failed",
                ThumbResult::Superseded => "superseded",
            };
            eprintln!(
                "[harbor/thumbs] target_sec={} startup_ms={} decode_ms={} outcome={}",
                bucket * 2,
                started.duration_since(job_started).as_millis(),
                started.elapsed().as_millis(),
                outcome
            );
        }
        match uri {
            ThumbResult::Ready(u) => {
                inner.cache.insert(bucket, u.clone());
                let _ = app.emit(
                    "thumb-ready",
                    json!({"session": session, "bucket": bucket, "uri": u}),
                );
            }
            ThumbResult::Failed => {
                let _ = app.emit(
                    "thumb-ready",
                    json!({"session": session, "bucket": bucket, "uri": null}),
                );
            }
            ThumbResult::Superseded => {}
        }
        inner.in_flight = None;
        let pause = inner.speculative && inner.wanted.is_none();
        let wake = wanted_notify.notified();
        tokio::pin!(wake);
        wake.as_mut().enable();
        drop(inner);
        // Register before releasing the lock so a foreground request cannot
        // miss the wake-up and wait through the background cooldown.
        if pause {
            tokio::select! {
                _ = tokio::time::sleep(Duration::from_millis(250)) => {},
                _ = wake => {},
            }
        }
    }
}

async fn generate_thumb(
    bucket: u32,
    writer_tx: &mpsc::Sender<Value>,
    cache_dir: &PathBuf,
    request_id: u64,
    pending: &Pending,
    seek_notify: &Arc<Notify>,
    filter_ready: &OnceCell<()>,
) -> ThumbResult {
    use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
    let started = Instant::now();
    let target_time = (bucket as f64) * BUCKET_SECONDS;
    let thumb_path = cache_dir.join(format!("{}.jpg", bucket));
    let thumb_str = thumb_path.to_string_lossy().to_string();

    let restart = seek_notify.notified();
    tokio::pin!(restart);
    restart.as_mut().enable();
    if send_ipc_message(
        writer_tx,
        json!({"command": ["seek", target_time, "absolute+keyframes"]}),
        Duration::from_millis(REQUEST_TIMEOUT_MS),
    )
    .await
    .is_err()
    {
        return ThumbResult::Failed;
    }
    // The worker cancels this future on a distant move; a nearby move leaves
    // the seek running so its frame can be shown.
    if tokio::time::timeout(Duration::from_millis(SEEK_WAIT_MS), restart)
        .await
        .is_err()
    {
        return ThumbResult::Failed;
    }

    let seek_ms = started.elapsed().as_millis();
    // Read metadata from the decoder that already opened the stream instead of
    // opening it a second time with ffprobe (especially costly for remote media).
    if filter_ready
        .get_or_try_init(|| async {
            let gamma = ipc_request(
                writer_tx,
                pending,
                request_id + 1,
                json!(["get_property", "video-params/gamma"]),
            )
            .await?;
            if matches!(gamma.as_str(), Some("pq" | "hlg")) {
                ipc_request(
                    writer_tx,
                    pending,
                    request_id + 2,
                    json!(["set_property", "vf", thumb_filter(true)]),
                )
                .await?;
            }
            Ok::<(), String>(())
        })
        .await
        .is_err()
    {
        return ThumbResult::Failed;
    }

    if ipc_request(
        writer_tx,
        pending,
        request_id,
        json!(["screenshot-to-file", thumb_str, "video"]),
    )
    .await
    .is_err()
    {
        return ThumbResult::Failed;
    }
    let Ok(bytes) = tokio::fs::read(&thumb_path).await else {
        return ThumbResult::Failed;
    };
    let _ = tokio::fs::remove_file(&thumb_path).await;
    if bytes.is_empty() {
        return ThumbResult::Failed;
    }
    if started.elapsed() >= Duration::from_secs(1) {
        eprintln!(
            "[harbor/thumbs] slow_frame target_sec={} seek_ms={} capture_ms={}",
            target_time,
            seek_ms,
            started.elapsed().as_millis().saturating_sub(seek_ms)
        );
    }
    ThumbResult::Ready(format!("data:image/jpeg;base64,{}", B64.encode(&bytes)))
}

async fn ipc_request(
    writer_tx: &mpsc::Sender<Value>,
    pending: &Pending,
    request_id: u64,
    command: Value,
) -> Result<Value, String> {
    let (done_tx, done_rx) = oneshot::channel();
    {
        let mut p = pending.lock().await;
        p.insert(request_id, done_tx);
    }
    if let Err(error) = send_ipc_message(
        writer_tx,
        json!({
            "command": command,
            "request_id": request_id,
        }),
        Duration::from_millis(REQUEST_TIMEOUT_MS),
    )
    .await
    {
        let mut p = pending.lock().await;
        p.remove(&request_id);
        return Err(error);
    }

    let result = tokio::time::timeout(Duration::from_millis(REQUEST_TIMEOUT_MS), done_rx).await;
    {
        let mut p = pending.lock().await;
        p.remove(&request_id);
    }

    match result {
        Ok(Ok(Ok(data))) => Ok(data),
        Ok(Ok(Err(e))) => Err(e),
        Ok(Err(_)) => Err("request canceled".to_string()),
        Err(_) => Err("mpv IPC request timeout".to_string()),
    }
}

#[tauri::command]
pub async fn thumbs_stop(state: State<'_, ThumbsState>) -> Result<(), String> {
    state.stop().await;
    Ok(())
}

impl ThumbsState {
    async fn stop(&self) {
        let shadow = {
            let mut inner = self.inner.lock().await;
            let shadow = inner.shadow.take();
            inner.url = None;
            inner.headers = None;
            inner.session = None;
            inner.cache.clear();
            inner.prefetch.clear();
            inner.prefetch_allowed = false;
            inner.timeline.clear();
            inner.timeline_initialized = false;
            inner.timeline_turn = false;
            inner.prefetched.clear();
            inner.speculative = false;
            inner.wanted_notify.notify_waiters();
            inner.wanted = None;
            inner.in_flight = None;
            inner.active_worker = None;
            shadow
        };
        let _spawn_guard = self.spawn_lock.lock().await;
        if let Some(mut s) = shadow {
            drop_shadow(&mut s).await;
        }
    }
}

pub(crate) fn shutdown(app: &tauri::AppHandle) {
    use tauri::Manager;

    let state = app.state::<ThumbsState>();
    tauri::async_runtime::block_on(state.stop());
}

fn thumb_filter(hdr: bool) -> String {
    if !hdr {
        return format!("scale={}:-2", THUMB_WIDTH);
    }
    format!(
        "zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,\
tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p,scale={}:-2",
        THUMB_WIDTH
    )
}

async fn spawn_shadow(
    url: &str,
    session: &str,
    pending: Pending,
    headers: &Option<HashMap<String, String>>,
) -> Result<Shadow, String> {
    let bin = locate_mpv().ok_or_else(|| "mpv not found".to_string())?;
    let pipe = shadow_pipe(session);
    let dir = cache_dir(session);
    tokio::fs::create_dir_all(&dir)
        .await
        .map_err(|e| format!("cache dir: {}", e))?;

    // Use the same HTTP identity as the player. Some hosts serve a signed URL
    // differently (or much slower) for a header-less, mpv-user-agent request.
    let (user_agent, header_fields) = crate::mpv::stream_http_options(headers);

    let mut args: Vec<String> = vec![
        format!("--input-ipc-server={}", pipe),
        format!("--user-agent={}", user_agent),
        "--no-config".into(),
        "--no-audio".into(),
        "--no-sub".into(),
        "--vo=null".into(),
        "--pause=yes".into(),
        "--keep-open=yes".into(),
        "--idle=yes".into(),
        "--load-scripts=no".into(),
        "--ytdl=no".into(),
        "--cache=yes".into(),
        // Retain packets already read, but do not download playback-sized buffers
        // for every speculative thumbnail seek.
        "--cache-secs=0".into(),
        "--demuxer-readahead-secs=0".into(),
        "--cache-pause=no".into(),
        "--demuxer-max-bytes=32MiB".into(),
        // A single frame is all a preview needs. Frame-threaded decoding batches
        // frames (and their packets) before the first one comes out, which made
        // seeks over the network wait for far more data than necessary.
        "--vd-lavc-threads=1".into(),
        format!("--vf={}", thumb_filter(false)),
        "--screenshot-format=jpg".into(),
        format!("--screenshot-jpeg-quality={}", SCREENSHOT_QUALITY),
        "--screenshot-tag-colorspace=no".into(),
        "--hr-seek=no".into(),
    ];
    if !header_fields.is_empty() {
        args.push(format!("--http-header-fields={}", header_fields.join(",")));
    }
    args.push("--".into());
    args.push(url.to_string());

    let mut cmd = Command::new(&bin);
    cmd.kill_on_drop(true);
    cmd.args(&args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    crate::proc_guard::configure_command(&mut cmd);
    let mut child = cmd.spawn().map_err(|e| format!("spawn shadow: {}", e))?;
    crate::proc_guard::adopt(&child);

    tokio::time::sleep(Duration::from_millis(400)).await;
    if let Some(status) = child
        .try_wait()
        .map_err(|e| format!("check shadow process: {e}"))?
    {
        let _ = tokio::fs::remove_file(&pipe).await;
        let _ = tokio::fs::remove_dir_all(&dir).await;
        return Err(format!("shadow mpv exited during startup: {status}"));
    }

    let (writer_tx, writer_rx) = mpsc::channel::<Value>(64);
    let seek_notify = Arc::new(Notify::new());
    spawn_ipc(pipe.clone(), writer_rx, pending, seek_notify.clone());

    Ok(Shadow {
        child,
        writer_tx,
        cache_dir: dir,
        pipe,
        seek_notify,
        filter_ready: Arc::new(OnceCell::new()),
    })
}

fn handle_line(line: &str, pending: &Pending, seek_notify: &Arc<Notify>) {
    let v: Value = match serde_json::from_str(line) {
        Ok(v) => v,
        Err(_) => return,
    };
    if v.get("event").and_then(|x| x.as_str()) == Some("playback-restart") {
        seek_notify.notify_waiters();
        return;
    }
    let id = match v.get("request_id").and_then(|x| x.as_u64()) {
        Some(id) => id,
        None => return,
    };
    let error = v
        .get("error")
        .and_then(|x| x.as_str())
        .unwrap_or("unknown")
        .to_string();
    let pending = pending.clone();
    tokio::spawn(async move {
        let mut p = pending.lock().await;
        if let Some(tx) = p.remove(&id) {
            let _ = tx.send(if error == "success" {
                Ok(v.get("data").cloned().unwrap_or(Value::Null))
            } else {
                Err(error)
            });
        }
    });
}

#[cfg(windows)]
fn spawn_ipc(
    pipe: String,
    mut writer_rx: mpsc::Receiver<Value>,
    pending: Pending,
    seek_notify: Arc<Notify>,
) {
    use tokio::net::windows::named_pipe::ClientOptions;
    tokio::spawn(async move {
        let mut client = None;
        for _ in 0..40 {
            match ClientOptions::new().open(&pipe) {
                Ok(c) => {
                    client = Some(c);
                    break;
                }
                Err(_) => tokio::time::sleep(Duration::from_millis(100)).await,
            }
        }
        let client = match client {
            Some(c) => c,
            None => return,
        };
        let (mut reader, mut writer) = tokio::io::split(client);

        let read_pending = pending.clone();
        let read_notify = seek_notify.clone();
        tokio::spawn(async move {
            let mut buf = vec![0u8; 8192];
            let mut acc = String::new();
            loop {
                let n = match tokio::time::timeout(
                    Duration::from_millis(50),
                    AsyncReadExt::read(&mut reader, &mut buf),
                )
                .await
                {
                    Ok(Ok(0)) => break,
                    Ok(Ok(n)) => n,
                    Ok(Err(_)) => break,
                    Err(_) => 0,
                };
                if n == 0 {
                    tokio::time::sleep(Duration::from_millis(20)).await;
                    continue;
                }
                acc.push_str(&String::from_utf8_lossy(&buf[..n]));
                while let Some(idx) = acc.find('\n') {
                    let line = acc[..idx].trim().to_string();
                    acc = acc[idx + 1..].to_string();
                    if line.is_empty() {
                        continue;
                    }
                    handle_line(&line, &read_pending, &read_notify);
                }
            }
        });

        while let Some(msg) = writer_rx.recv().await {
            let mut s = msg.to_string();
            s.push('\n');
            if writer.write_all(s.as_bytes()).await.is_err() {
                break;
            }
            let _ = writer.flush().await;
        }
    });
}

#[cfg(not(windows))]
fn spawn_ipc(
    pipe: String,
    mut writer_rx: mpsc::Receiver<Value>,
    pending: Pending,
    seek_notify: Arc<Notify>,
) {
    use tokio::io::{AsyncBufReadExt, BufReader};
    use tokio::net::UnixStream;
    tokio::spawn(async move {
        let mut stream = None;
        for _ in 0..40 {
            match UnixStream::connect(&pipe).await {
                Ok(s) => {
                    stream = Some(s);
                    break;
                }
                Err(_) => tokio::time::sleep(Duration::from_millis(100)).await,
            }
        }
        let stream = match stream {
            Some(s) => s,
            None => return,
        };
        let (r, mut w) = stream.into_split();
        let mut reader = BufReader::new(r);
        let read_pending = pending.clone();
        let read_notify = seek_notify.clone();
        tokio::spawn(async move {
            let mut line = String::new();
            loop {
                line.clear();
                match reader.read_line(&mut line).await {
                    Ok(0) => break,
                    Ok(_) => {
                        let trimmed = line.trim();
                        if trimmed.is_empty() {
                            continue;
                        }
                        handle_line(trimmed, &read_pending, &read_notify);
                    }
                    Err(_) => break,
                }
            }
        });
        while let Some(msg) = writer_rx.recv().await {
            let mut s = msg.to_string();
            s.push('\n');
            if w.write_all(s.as_bytes()).await.is_err() {
                break;
            }
        }
    });
}

#[cfg(test)]
mod cache_tests {
    use super::{
        handle_line, ipc_request, next_bucket, send_ipc_message, should_cancel, timeline_buckets,
        ThumbCache, ThumbsState, PREFETCH_MAX_ATTEMPTS,
    };
    use serde_json::json;
    use std::time::Duration;

    #[tokio::test]
    async fn ipc_metadata_response_preserves_data_and_reports_errors() {
        let pending = Default::default();
        let notify = Default::default();
        let (tx, mut rx) = tokio::sync::mpsc::channel::<serde_json::Value>(1);
        let reply = async {
            let message = rx.recv().await.unwrap();
            assert_eq!(
                message["command"],
                json!(["get_property", "video-params/gamma"])
            );
            handle_line(
                r#"{"request_id":1,"error":"success","data":"pq"}"#,
                &pending,
                &notify,
            );
        };
        let (result, ()) = tokio::join!(
            ipc_request(
                &tx,
                &pending,
                1,
                json!(["get_property", "video-params/gamma"])
            ),
            reply
        );
        assert_eq!(result, Ok(json!("pq")));
        assert!(pending.lock().await.is_empty());

        let reply = async {
            rx.recv().await.unwrap();
            handle_line(
                r#"{"request_id":2,"error":"property unavailable"}"#,
                &pending,
                &notify,
            );
        };
        let (result, ()) = tokio::join!(
            ipc_request(
                &tx,
                &pending,
                2,
                json!(["get_property", "video-params/gamma"])
            ),
            reply
        );
        assert_eq!(result, Err("property unavailable".into()));
        assert!(pending.lock().await.is_empty());
    }

    #[test]
    fn nearby_moves_keep_a_running_seek_and_far_moves_cancel_it() {
        assert!(!should_cancel(Some(99), 100));
        assert!(!should_cancel(Some(100), 100));
        assert!(!should_cancel(Some(105), 100));
        assert!(should_cancel(Some(106), 100));
        assert!(should_cancel(None, 100));
    }

    #[test]
    fn timeline_spreads_coverage_before_filling_gaps() {
        let buckets = timeline_buckets(7200.0);
        assert_eq!(buckets.len(), 180);
        let first: Vec<_> = buckets.iter().take(3).copied().collect();
        assert_eq!(first, vec![1800, 900, 2700]);
        let mut sorted: Vec<_> = buckets.into_iter().collect();
        sorted.sort_unstable();
        sorted.dedup();
        assert_eq!(sorted.len(), 180);
        assert!(sorted.windows(2).all(|pair| pair[1] - pair[0] <= 20));
        assert!(sorted.iter().all(|bucket| *bucket < 3600));
    }

    #[tokio::test]
    async fn timeline_progresses_between_nearby_jobs_and_survives_suspension() {
        let state = ThumbsState::new();
        let mut inner = state.inner.lock().await;
        inner.prefetch_allowed = true;
        inner.prefetch.extend([1, 2, 3]);
        inner.timeline.extend([100, 200]);
        assert_eq!(next_bucket(&mut inner), Some(1));
        assert_eq!(next_bucket(&mut inner), Some(100));
        inner.prefetch_allowed = false;
        assert_eq!(next_bucket(&mut inner), None);
        inner.prefetch_allowed = true;
        inner.wanted = Some(9);
        assert_eq!(next_bucket(&mut inner), Some(9));
        assert_eq!(next_bucket(&mut inner), Some(200));
    }

    #[tokio::test]
    async fn foreground_preempts_prefetch_and_cached_background_is_skipped() {
        let state = ThumbsState::new();
        let mut inner = state.inner.lock().await;
        inner.prefetch_allowed = true;
        inner.prefetch.extend([10, 11]);
        inner.cache.insert(10, "cached".into());
        inner.wanted = Some(20);
        assert_eq!(next_bucket(&mut inner), Some(20));
        assert!(!inner.speculative);
        assert_eq!(next_bucket(&mut inner), Some(11));
        assert!(inner.speculative);
        assert_eq!(next_bucket(&mut inner), None);
    }

    #[tokio::test]
    async fn speculative_budget_never_blocks_foreground_requests() {
        let state = ThumbsState::new();
        let mut inner = state.inner.lock().await;
        inner.prefetch_allowed = true;
        inner.prefetched.extend(0..PREFETCH_MAX_ATTEMPTS as u32);
        inner.prefetch.push_back(500);
        assert_eq!(next_bucket(&mut inner), None);
        inner.wanted = Some(500);
        assert_eq!(next_bucket(&mut inner), Some(500));
        assert!(!inner.speculative);
    }

    #[tokio::test]
    async fn disabled_prefetch_and_repeated_attempts_do_not_decode() {
        let state = ThumbsState::new();
        let mut inner = state.inner.lock().await;
        inner.prefetch.push_back(10);
        assert_eq!(next_bucket(&mut inner), None);
        inner.prefetch_allowed = true;
        inner.prefetched.insert(10);
        inner.prefetch.extend([10, 12]);
        assert_eq!(next_bucket(&mut inner), Some(12));
        assert_eq!(next_bucket(&mut inner), None);
    }

    #[test]
    fn cache_evicts_least_recently_used_entry() {
        let mut cache = ThumbCache::new(8, 2);
        cache.insert(1, "1111".into());
        cache.insert(2, "2222".into());
        assert_eq!(cache.get(1), Some("1111".into()));
        cache.insert(3, "3333".into());
        assert_eq!(cache.get(2), None);
        assert_eq!(cache.get(1), Some("1111".into()));
        assert_eq!(cache.get(3), Some("3333".into()));
    }

    #[test]
    fn cache_enforces_byte_and_entry_limits() {
        let mut cache = ThumbCache::new(6, 2);
        cache.insert(1, "111".into());
        cache.insert(2, "222".into());
        cache.insert(3, "333".into());
        assert_eq!(cache.len(), 2);
        assert_eq!(cache.bytes(), 6);
        assert_eq!(cache.get(1), None);
    }

    #[test]
    fn cache_rejects_oversized_entries_and_clears_cleanly() {
        let mut cache = ThumbCache::new(4, 2);
        cache.insert(1, "12345".into());
        assert_eq!(cache.len(), 0);
        cache.insert(2, "1234".into());
        cache.clear();
        assert_eq!(cache.len(), 0);
        assert_eq!(cache.bytes(), 0);
    }

    #[tokio::test]
    async fn ipc_send_times_out_when_writer_is_stalled() {
        let (tx, _rx) = tokio::sync::mpsc::channel(1);
        tx.send(json!({"first": true})).await.unwrap();

        let result =
            send_ipc_message(&tx, json!({"second": true}), Duration::from_millis(10)).await;

        assert_eq!(result, Err("mpv IPC writer timeout".to_string()));
    }

    #[tokio::test]
    async fn stop_clears_thumbnail_session_state() {
        let state = ThumbsState::new();
        {
            let mut inner = state.inner.lock().await;
            inner.url = Some("https://example.com/video".into());
            inner.session = Some("session".into());
            inner.cache.insert(1, "thumbnail".into());
            inner.wanted = Some(1);
            inner.active_worker = Some(1);
        }

        state.stop().await;

        let inner = state.inner.lock().await;
        assert!(inner.shadow.is_none());
        assert!(inner.url.is_none());
        assert!(inner.session.is_none());
        assert_eq!(inner.cache.len(), 0);
        assert!(inner.wanted.is_none());
        assert!(inner.active_worker.is_none());
    }
}
