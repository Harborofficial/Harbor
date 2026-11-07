#[cfg(feature = "asr-whisper")]
use futures_util::StreamExt;
#[cfg(feature = "asr-whisper")]
use sha2::{Digest, Sha256};
#[cfg(feature = "asr-whisper")]
use std::io::Write;
use std::path::{Path, PathBuf};
#[cfg(feature = "asr-whisper")]
use std::time::Duration;
#[cfg(feature = "asr-whisper")]
use tauri::Emitter;
use tauri::Manager;

#[cfg(feature = "asr-whisper")]
const MODEL_URLS: &[&str] = &[
    "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin",
    "https://harborcommunity.site/models/ggml-tiny.bin",
];
#[cfg(feature = "asr-whisper")]
const MODEL_SHA256: &str = "be07e048e1e599ad46341c8d2a135645097a538221678b7acdd1b1919c6e1b21";
const MODEL_FILE: &str = "ggml-tiny.bin";
const MODEL_PART: &str = "ggml-tiny.bin.part";
const MIN_VALID_BYTES: u64 = 1_000_000;
#[cfg(feature = "asr-whisper")]
const MAX_MODEL_BYTES: u64 = 256_000_000;

// Model installation and deletion must never race each other.
#[cfg(feature = "asr-whisper")]
static MODEL_WRITE_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AsrModelStatus {
    supported: bool,
    installed: bool,
    size_bytes: Option<u64>,
}

fn model_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let base = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok(base.join("asr"))
}

fn is_valid_model(path: &Path) -> bool {
    std::fs::metadata(path)
        .map(|m| m.is_file() && m.len() >= MIN_VALID_BYTES)
        .unwrap_or(false)
}

fn existing(app: &tauri::AppHandle) -> Result<Option<PathBuf>, String> {
    let dest = model_dir(app)?.join(MODEL_FILE);
    Ok(is_valid_model(&dest).then_some(dest))
}

#[tauri::command]
pub fn asr_model_status(app: tauri::AppHandle) -> Result<AsrModelStatus, String> {
    let installed = existing(&app)?;
    let size_bytes = installed
        .as_ref()
        .and_then(|path| std::fs::metadata(path).ok().map(|m| m.len()));
    Ok(AsrModelStatus {
        supported: cfg!(feature = "asr-whisper"),
        installed: installed.is_some(),
        size_bytes,
    })
}

#[tauri::command]
pub fn asr_model_path(app: tauri::AppHandle) -> Result<Option<String>, String> {
    Ok(existing(&app)?.map(|p| p.to_string_lossy().into_owned()))
}

/// The player only uses a model the user has installed. In particular, a
/// playback attempt must not silently trigger a large network download.
#[tauri::command]
pub async fn asr_ensure_model(app: tauri::AppHandle) -> Result<Option<String>, String> {
    #[cfg(not(feature = "asr-whisper"))]
    {
        let _ = app;
        Err("asr-whisper is not enabled in this build".into())
    }

    #[cfg(feature = "asr-whisper")]
    {
        asr_model_path(app)
    }
}

#[tauri::command]
pub async fn asr_model_download(app: tauri::AppHandle) -> Result<String, String> {
    #[cfg(not(feature = "asr-whisper"))]
    {
        let _ = app;
        return Err("Speech recognition is not available in this build".into());
    }

    #[cfg(feature = "asr-whisper")]
    {
        let _guard = MODEL_WRITE_LOCK.lock().await;
        if let Some(path) = existing(&app)? {
            return Ok(path.to_string_lossy().into_owned());
        }
        let dir = model_dir(&app)?;
        std::fs::create_dir_all(&dir).map_err(|e| format!("create model directory: {e}"))?;
        let dest = dir.join(MODEL_FILE);
        let part = dir.join(MODEL_PART);

        let result: Result<(), String> = async {
            let client = reqwest::Client::builder()
                .user_agent("Harbor")
                .connect_timeout(Duration::from_secs(15))
                .timeout(Duration::from_secs(180))
                .build()
                .map_err(|e| e.to_string())?;
            let mut downloaded = None;
            let mut last_error = "no model download sources succeeded".to_owned();
            for source in MODEL_URLS {
                let attempt: Result<u64, String> = async {
                    let resp = client
                        .get(*source)
                        .send()
                        .await
                        .map_err(|e| format!("connect to model host: {e}"))?;
                    if !resp.status().is_success() {
                        return Err(format!("model host returned HTTP {}", resp.status()));
                    }
                    let total = resp.content_length().unwrap_or(0);
                    if total > MAX_MODEL_BYTES {
                        return Err("model download exceeds the size limit".into());
                    }
                    let _ = app.emit("asr-model://progress", (0_u64, total));
                    let mut file = std::fs::File::create(&part)
                        .map_err(|e| format!("create model download: {e}"))?;
                    let mut received = 0_u64;
                    let mut last_emit = 0_u64;
                    let mut digest = Sha256::new();
                    let mut stream = resp.bytes_stream();
                    while let Some(chunk) = stream.next().await {
                        let chunk = chunk.map_err(|e| format!("read model download: {e}"))?;
                        received = received.saturating_add(chunk.len() as u64);
                        if received > MAX_MODEL_BYTES {
                            return Err("model download exceeds the size limit".into());
                        }
                        digest.update(&chunk);
                        file.write_all(&chunk)
                            .map_err(|e| format!("write model download: {e}"))?;
                        if received.saturating_sub(last_emit) >= 1_048_576 {
                            last_emit = received;
                            let _ = app.emit("asr-model://progress", (received, total));
                        }
                    }
                    file.flush()
                        .map_err(|e| format!("flush model download: {e}"))?;
                    drop(file);
                    if !is_valid_model(&part) {
                        return Err("downloaded speech model is missing or incomplete".into());
                    }
                    if format!("{:x}", digest.finalize()) != MODEL_SHA256 {
                        return Err("downloaded speech model failed integrity verification".into());
                    }
                    Ok(received)
                }
                .await;
                match attempt {
                    Ok(received) => {
                        downloaded = Some(received);
                        break;
                    }
                    Err(e) => {
                        last_error = e;
                        let _ = std::fs::remove_file(&part);
                    }
                }
            }
            let received =
                downloaded.ok_or_else(|| format!("speech model download failed: {last_error}"))?;
            // Windows cannot rename over a stale invalid target.
            if dest.exists() {
                std::fs::remove_file(&dest)
                    .map_err(|e| format!("replace incomplete speech model: {e}"))?;
            }
            std::fs::rename(&part, &dest).map_err(|e| format!("install speech model: {e}"))?;
            let _ = app.emit("asr-model://progress", (received, received));
            Ok(())
        }
        .await;
        if result.is_err() {
            let _ = std::fs::remove_file(&part);
        }
        result?;
        Ok(dest.to_string_lossy().into_owned())
    }
}

#[tauri::command]
pub async fn asr_model_remove(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(feature = "asr-whisper")]
    let _guard = MODEL_WRITE_LOCK.lock().await;

    let dir = model_dir(&app)?;
    for name in [MODEL_FILE, MODEL_PART] {
        match std::fs::remove_file(dir.join(name)) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(format!("remove speech model: {e}")),
        }
    }
    Ok(())
}
