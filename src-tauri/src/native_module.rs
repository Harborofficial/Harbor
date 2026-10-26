mod locate;
mod services;

use std::collections::HashMap;
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex as SyncMutex, OnceLock};
use std::time::Duration;

use serde_json::{json, Value};
use tauri::{AppHandle, Manager};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::sync::{mpsc, oneshot, Mutex};

use locate::resolve_module;

// An infrastructure ceiling only; each module owns its operation deadlines.
const HOST_REQUEST_CEILING: Duration = Duration::from_secs(300);

pub(super) struct ModuleSpec {
    directory: &'static str,
    executable: &'static str,
    manifest: &'static str,
    kind: &'static str,
    abi: u32,
    data_directory: &'static str,
    services: &'static [&'static str],
}

fn specification(module: &str) -> Result<ModuleSpec, String> {
    match module {
        #[cfg(feature = "plugins")]
        "extensions" => {
            crate::install_features::require_plugins()?;
            Ok(ModuleSpec {
                directory: "capstan",
                executable: "harbor-extensions-module",
                manifest: "extensions-module.json",
                kind: "harbor-extensions",
                abi: 2,
                data_directory: "capstan",
                services: &["browser.clearance"],
            })
        }
        _ => Err("Native module is unavailable in this installation.".into()),
    }
}

struct Bridge {
    tx: mpsc::UnboundedSender<String>,
    pending: Arc<SyncMutex<HashMap<String, oneshot::Sender<Value>>>>,
    alive: Arc<AtomicBool>,
    stop: tokio::sync::watch::Sender<bool>,
}

fn slots() -> &'static Mutex<HashMap<String, Arc<Bridge>>> {
    static SLOTS: OnceLock<Mutex<HashMap<String, Arc<Bridge>>>> = OnceLock::new();
    SLOTS.get_or_init(|| Mutex::new(HashMap::new()))
}

pub(crate) fn shutdown() {
    if let Some(slots) = slots().try_lock().ok() {
        for bridge in slots.values() {
            let _ = bridge.stop.send(true);
        }
    }
}

fn next_id() -> String {
    static NEXT: AtomicU64 = AtomicU64::new(0);
    format!("c{}", NEXT.fetch_add(1, Ordering::Relaxed))
}

async fn spawn(app: &AppHandle, spec: ModuleSpec) -> Result<Arc<Bridge>, String> {
    let module = resolve_module(app, &spec)?;
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("no data directory: {e}"))?
        .join(spec.data_directory);
    let mut cmd = tokio::process::Command::new(&module);
    cmd.arg("--abi")
        .arg(spec.abi.to_string())
        .arg("--host-version")
        .arg(env!("CARGO_PKG_VERSION"))
        .arg("--data-dir")
        .arg(dunce::simplified(&data_dir));
    cmd.stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    #[cfg(windows)]
    cmd.creation_flags(0x0800_0000);
    crate::proc_guard::configure_command(&mut cmd);

    let mut child = cmd.spawn().map_err(|e| {
        format!(
            "could not start the native module {}: {e}",
            module.display()
        )
    })?;
    crate::proc_guard::adopt(&child);
    eprintln!("[native-module] native module started");

    let mut stdin = child.stdin.take().ok_or("bridge stdin unavailable")?;
    stdin
        .write_all(b"start\n")
        .await
        .map_err(|e| e.to_string())?;
    stdin.flush().await.map_err(|e| e.to_string())?;
    let stdout = child.stdout.take().ok_or("bridge stdout unavailable")?;
    let stderr = child.stderr.take().ok_or("bridge stderr unavailable")?;

    let (tx, mut rx) = mpsc::unbounded_channel::<String>();
    let pending: Arc<SyncMutex<HashMap<String, oneshot::Sender<Value>>>> =
        Arc::new(SyncMutex::new(HashMap::new()));
    let alive = Arc::new(AtomicBool::new(true));
    let (stop, mut reader_stop) = tokio::sync::watch::channel(false);
    let mut writer_stop = stop.subscribe();

    tokio::spawn(async move {
        loop {
            let line = tokio::select! {
                _ = writer_stop.changed() => break,
                line = rx.recv() => match line { Some(line) => line, None => break },
            };
            if stdin.write_all(line.as_bytes()).await.is_err()
                || stdin.write_all(b"\n").await.is_err()
                || stdin.flush().await.is_err()
            {
                break;
            }
        }
    });

    tokio::spawn(async move {
        let mut lines = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            eprintln!("[native-module] {line}");
        }
    });

    let reader_pending = pending.clone();
    let reader_alive = alive.clone();
    let reader_tx = tx.clone();
    let reader_app = app.clone();
    tokio::spawn(async move {
        let mut lines = BufReader::new(stdout).lines();
        loop {
            let line = tokio::select! {
                _ = reader_stop.changed() => break,
                line = lines.next_line() => match line { Ok(Some(line)) => line, _ => break },
            };
            let line = line.trim();
            if line.is_empty() {
                continue;
            }
            let Ok(frame) = serde_json::from_str::<Value>(line) else {
                eprintln!("[native-module] stdout carried a line that is not protocol: {line}");
                continue;
            };
            if frame.get("service").is_some() {
                let app = reader_app.clone();
                let tx = reader_tx.clone();
                tokio::spawn(async move {
                    let _ = tx.send(services::serve(app, frame, spec.services).await.to_string());
                });
                continue;
            }
            let Some(id) = frame.get("id").and_then(|v| v.as_str()) else {
                continue;
            };
            let waiting = reader_pending.lock().unwrap().remove(id);
            if let Some(waiting) = waiting {
                let _ = waiting.send(frame);
            }
        }
        reader_alive.store(false, Ordering::SeqCst);
        reader_pending.lock().unwrap().clear();
        let _ = child.kill().await;
        let _ = child.wait().await;
        eprintln!("[native-module] bridge exited");
    });

    Ok(Arc::new(Bridge {
        tx,
        pending,
        alive,
        stop,
    }))
}

async fn ensure(app: &AppHandle, module: &str) -> Result<Arc<Bridge>, String> {
    // Recheck installation policy even for an already-running module.
    let spec = specification(module)?;
    let mut slots = slots().lock().await;
    if let Some(running) = slots.get(module) {
        if running.alive.load(Ordering::SeqCst) {
            return Ok(running.clone());
        }
    }
    let fresh = spawn(app, spec).await?;
    slots.insert(module.to_string(), fresh.clone());
    Ok(fresh)
}

struct PendingRequest {
    bridge: Arc<Bridge>,
    id: String,
}
impl Drop for PendingRequest {
    fn drop(&mut self) {
        self.bridge.pending.lock().unwrap().remove(&self.id);
    }
}

#[tauri::command]
pub async fn native_module_call(
    app: AppHandle,
    module: String,
    command: String,
    args: Option<Value>,
) -> Result<Value, String> {
    let bridge = ensure(&app, &module).await?;
    let id = next_id();
    let (tx, rx) = oneshot::channel();
    bridge.pending.lock().unwrap().insert(id.clone(), tx);
    let _pending = PendingRequest {
        bridge: bridge.clone(),
        id: id.clone(),
    };
    let frame = json!({ "id": id, "command": command, "args": args.unwrap_or_else(|| json!({})) });
    bridge
        .tx
        .send(frame.to_string())
        .map_err(|_| "Native module connection closed")?;
    let reply = tokio::time::timeout(HOST_REQUEST_CEILING, rx)
        .await
        .map_err(|_| "Native module request exceeded the host deadline")?
        .map_err(|_| "Native module stopped before answering")?;
    if let Some(error) = reply.get("error").and_then(Value::as_str) {
        return Err(error.to_string());
    }
    reply
        .get("result")
        .cloned()
        .ok_or_else(|| "Invalid native module response".into())
}
