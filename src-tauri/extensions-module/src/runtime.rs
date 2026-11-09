use crate::{
    commands::{self, Request},
    locate,
};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    path::PathBuf,
    process::Stdio,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex as StdMutex,
    },
    time::Duration,
};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    sync::{mpsc, oneshot, watch, Mutex},
};

type Pending = Arc<StdMutex<HashMap<String, oneshot::Sender<Value>>>>;
static NEXT: AtomicU64 = AtomicU64::new(1);
fn id(prefix: &str) -> String {
    format!("{prefix}{}", NEXT.fetch_add(1, Ordering::Relaxed))
}
const REQUEST_DEADLINE: Duration = Duration::from_secs(145);
const CHALLENGE_DEADLINE: Duration = Duration::from_secs(110);

struct PendingGuard {
    pending: Pending,
    id: String,
}
impl Drop for PendingGuard {
    fn drop(&mut self) {
        self.pending.lock().unwrap().remove(&self.id);
    }
}

pub struct Host {
    pub output: mpsc::UnboundedSender<Value>,
    pending: Pending,
}
impl Host {
    pub fn new(output: mpsc::UnboundedSender<Value>) -> Self {
        Self {
            output,
            pending: Arc::default(),
        }
    }
    pub fn answer(&self, frame: Value) {
        if let Some(id) = frame["id"].as_str() {
            if let Some(waiter) = self.pending.lock().unwrap().remove(id) {
                let _ = waiter.send(frame);
            }
        }
    }
    async fn clearance(&self, params: Value) -> Result<Value, String> {
        let id = id("host-");
        let (tx, rx) = oneshot::channel();
        self.pending.lock().unwrap().insert(id.clone(), tx);
        let _guard = PendingGuard {
            pending: self.pending.clone(),
            id: id.clone(),
        };
        self.output
            .send(json!({"id":id,"service":"browser.clearance","params":params}))
            .map_err(|_| "Host disconnected")?;
        let frame = tokio::time::timeout(CHALLENGE_DEADLINE, rx)
            .await
            .map_err(|_| "Extension challenge timed out")?
            .map_err(|_| "Host disconnected")?;
        if let Some(error) = frame["error"].as_str() {
            return Err(error.into());
        }
        frame
            .get("result")
            .cloned()
            .ok_or_else(|| "Invalid browser service response".into())
    }
    async fn challenge(&self, frame: Value) -> Value {
        let id = frame["id"].clone();
        if frame["host"] != "challenge" {
            return json!({"id":id,"ok":false,"error":{"code":"unknown_method","message":"Unknown extension host method"}});
        }
        let params = frame.get("params").cloned().unwrap_or_else(|| json!({}));
        if params["url"].as_str().is_none_or(str::is_empty) {
            return json!({"id":id,"ok":false,"error":{"code":"extension_error","message":"challenge request carried no url"}});
        }
        match self.clearance(params).await {
            Ok(result) => json!({"id":id,"ok":true,"result":result}),
            Err(message) => {
                json!({"id":id,"ok":false,"error":{"code":"extension_error","message":message}})
            }
        }
    }
}

struct Bridge {
    tx: mpsc::UnboundedSender<Value>,
    pending: Pending,
    alive: Arc<AtomicBool>,
    stop: watch::Sender<bool>,
    done: Mutex<Option<oneshot::Receiver<()>>>,
}

pub struct Runtime {
    host: Arc<Host>,
    root: PathBuf,
    data: PathBuf,
    bridge: Mutex<Option<Arc<Bridge>>>,
}

impl Runtime {
    pub fn new(host: Arc<Host>, root: PathBuf, data: PathBuf) -> Self {
        Self {
            host,
            root,
            data,
            bridge: Mutex::new(None),
        }
    }
    async fn spawn(&self) -> Result<Arc<Bridge>, String> {
        let layout = locate::resolve_layout(&self.root)?;
        let jvm = locate::resolve_jvm(&self.root)?;
        std::fs::create_dir_all(&self.data).map_err(|e| e.to_string())?;
        let separator = if cfg!(windows) { ";" } else { ":" };
        let cp = std::iter::once(&layout.jar)
            .chain(layout.libs.iter())
            .map(|p| dunce::simplified(p).to_string_lossy().into_owned())
            .collect::<Vec<_>>()
            .join(separator);
        let mut cmd = tokio::process::Command::new(&jvm.exe);
        cmd.arg("-cp").arg(cp);
        if let Some(tools) = layout.dex_tools {
            cmd.arg(format!(
                "-Dharbor.capstan.dexTools={}",
                dunce::simplified(&tools).display()
            ));
        }
        cmd.arg("com.harbor.capstan.bridge.Bridge")
            .arg("--data-dir")
            .arg(dunce::simplified(&self.data))
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .kill_on_drop(true);
        #[cfg(windows)]
        cmd.creation_flags(0x0800_0000);
        #[cfg(target_os = "linux")]
        unsafe {
            cmd.pre_exec(|| {
                libc::prctl(libc::PR_SET_PDEATHSIG, libc::SIGKILL);
                Ok(())
            });
        }
        eprintln!("[extensions-module] starting {}", jvm.source);
        let mut child = cmd.spawn().map_err(|e| e.to_string())?;
        let mut input = child.stdin.take().ok_or("Extension stdin unavailable")?;
        let output = child.stdout.take().ok_or("Extension stdout unavailable")?;
        let (tx, mut rx) = mpsc::unbounded_channel::<Value>();
        let pending: Pending = Arc::default();
        let alive = Arc::new(AtomicBool::new(true));
        let (stop, mut stopped) = watch::channel(false);
        let mut writer_stop = stop.subscribe();
        let fail_stop = stop.clone();
        tokio::spawn(async move {
            loop {
                let frame = tokio::select! {
                    _ = writer_stop.changed() => break,
                    frame = rx.recv() => match frame { Some(frame) => frame, None => break },
                };
                if input
                    .write_all(format!("{frame}\n").as_bytes())
                    .await
                    .is_err()
                    || input.flush().await.is_err()
                {
                    break;
                }
            }
            let _ = fail_stop.send(true);
        });
        let reader_pending = pending.clone();
        let reader_alive = alive.clone();
        let reader_tx = tx.clone();
        let host = self.host.clone();
        let reader_stop = stop.clone();
        let (done_tx, done_rx) = oneshot::channel();
        tokio::spawn(async move {
            let mut lines = BufReader::new(output).lines();
            let mut callbacks = tokio::task::JoinSet::new();
            loop {
                let line = tokio::select! {
                    _ = stopped.changed() => break,
                    Some(_) = callbacks.join_next(), if !callbacks.is_empty() => continue,
                    line = lines.next_line() => match line { Ok(Some(line)) => line, _ => break },
                };
                let Ok(frame) = serde_json::from_str::<Value>(&line) else {
                    continue;
                };
                if frame.get("host").is_some() {
                    let host = host.clone();
                    let tx = reader_tx.clone();
                    callbacks.spawn(async move {
                        let _ = tx.send(host.challenge(frame).await);
                    });
                } else if let Some(id) = frame["id"].as_str() {
                    if let Some(waiter) = reader_pending.lock().unwrap().remove(id) {
                        let _ = waiter.send(frame);
                    }
                }
            }
            callbacks.abort_all();
            let _ = reader_stop.send(true);
            let _ = child.kill().await;
            let _ = child.wait().await;
            reader_alive.store(false, Ordering::SeqCst);
            reader_pending.lock().unwrap().clear();
            let _ = done_tx.send(());
        });
        Ok(Arc::new(Bridge {
            tx,
            pending,
            alive,
            stop,
            done: Mutex::new(Some(done_rx)),
        }))
    }
    async fn ensure(&self) -> Result<Arc<Bridge>, String> {
        let mut slot = self.bridge.lock().await;
        if let Some(bridge) = slot.as_ref().filter(|b| b.alive.load(Ordering::SeqCst)) {
            return Ok(bridge.clone());
        }
        let bridge = self.spawn().await?;
        *slot = Some(bridge.clone());
        Ok(bridge)
    }
    pub async fn call(&self, request: Request) -> Result<Value, String> {
        for attempt in 0..2 {
            let bridge = self.ensure().await?;
            let id = id("capstan-");
            let (tx, rx) = oneshot::channel();
            bridge.pending.lock().unwrap().insert(id.clone(), tx);
            let _guard = PendingGuard {
                pending: bridge.pending.clone(),
                id: id.clone(),
            };
            let frame = json!({"id":id,"method":request.method,"params":request.params});
            if bridge.tx.send(frame).is_err() {
                if attempt == 0 && request.replay_safe {
                    continue;
                }
                return Err("the extension bridge is not accepting requests".into());
            }
            match tokio::time::timeout(REQUEST_DEADLINE, rx).await {
                Ok(Ok(frame)) => return commands::unwrap_frame(frame),
                Ok(Err(_)) if attempt == 0 && request.replay_safe => continue,
                Ok(Err(_)) => return Err("the extension bridge stopped before answering".into()),
                Err(_) => {
                    return Err(format!(
                        "{} timed out after {}ms",
                        request.method,
                        REQUEST_DEADLINE.as_millis()
                    ))
                }
            }
        }
        Err("the extension bridge could not be started".into())
    }
    pub async fn shutdown(&self) {
        if let Some(bridge) = self.bridge.lock().await.take() {
            let _ = bridge.stop.send(true);
            if let Some(done) = bridge.done.lock().await.take() {
                let _ = tokio::time::timeout(Duration::from_secs(5), done).await;
            }
        }
    }
}
