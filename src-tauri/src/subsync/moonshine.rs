//! Optional Moonshine speech recognition testing backend.
//! Native inference runs in a child Python process, never inside Harbor/mpv.
//! The app-private runtime is installed on explicit user request only.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::time::Duration;
use tauri::Manager;
use tokio::process::Command;

const VERSION: &str = "0.1.6";
const RESULT_PREFIX: &str = "HARBOR_MOONSHINE_RESULT=";
const SUPPORTED_LANGUAGES: &[&str] = &["en", "ar", "de", "es", "ja", "zh", "tl", "vi"];

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MoonshineStatus {
    supported: bool,
    runtime_installed: bool,
    installed: bool,
    language: String,
}

#[derive(Serialize, Deserialize)]
pub struct MoonshineToken {
    pub text: String,
    pub t0: f32,
    pub t1: f32,
    pub p: f32,
}
#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct MoonshineStats {
    pub recognized_lines: usize,
    pub word_candidates: usize,
    pub word_intervals: usize,
    pub line_intervals: usize,
    pub audio_rms: f32,
    pub audio_peak: f32,
    pub chunk_retry: bool,
    pub retry_recognized_lines: usize,
    pub retry_word_candidates: usize,
    pub retry_line_intervals: usize,
    pub retry_timed_intervals: usize,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MoonshineWindow {
    pub start_sec: f32,
    pub len_sec: f32,
    pub lang: String,
    pub tokens: Vec<MoonshineToken>,
    #[serde(default)]
    pub stats: Option<MoonshineStats>,
}

fn language_code(input: &str) -> Result<&str, String> {
    let code = input.trim().split(['-', '_']).next().unwrap_or("");
    if SUPPORTED_LANGUAGES.contains(&code) {
        Ok(code)
    } else {
        Err("moonshine-language-unsupported".into())
    }
}

fn root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|_| "moonshine-data-dir")?
        .join("moonshine"))
}

struct Python {
    program: String,
    prefix: Vec<String>,
}
async fn find_python() -> Result<Python, String> {
    // Never run via a shell or accept a program path from web/UI input.
    #[cfg(windows)]
    let candidates = [("python", &[][..]), ("py", &["-3"][..])];
    #[cfg(not(windows))]
    let candidates = [("python3", &[][..]), ("python", &[][..])];
    for (name, prefix) in candidates {
        let mut cmd = Command::new(name);
        cmd.args(prefix)
            .args(["-I", "-c", "import sys; print(sys.version_info.major)"]);
        cmd.kill_on_drop(true);
        #[cfg(windows)]
        cmd.creation_flags(0x0800_0000);
        if let Ok(Ok(output)) = tokio::time::timeout(Duration::from_secs(4), cmd.output()).await {
            if output.status.success() && output.stdout.starts_with(b"3") {
                return Ok(Python {
                    program: name.into(),
                    prefix: prefix.iter().map(|s| (*s).into()).collect(),
                });
            }
        }
    }
    Err("moonshine-python3-required".into())
}

// Packaged installs use this self-contained worker. Development builds may
// fall back to a separate Python 3 installation for Moonshine testing.
fn bundled_worker(app: &tauri::AppHandle) -> Option<PathBuf> {
    #[cfg(windows)]
    {
        let resource_dir = app.path().resource_dir().ok()?;
        let exe = resource_dir
            .join("resources")
            .join("moonshine")
            .join("moonshine-worker.exe");
        if exe.is_file() {
            return Some(exe);
        }
    }
    let _ = app;
    None
}

fn base_command(python: &Python) -> Command {
    let mut cmd = Command::new(&python.program);
    cmd.args(&python.prefix);
    cmd.kill_on_drop(true);
    #[cfg(windows)]
    cmd.creation_flags(0x0800_0000);
    cmd
}

async fn output(mut cmd: Command, timeout_sec: u64) -> Result<std::process::Output, String> {
    let result = tokio::time::timeout(Duration::from_secs(timeout_sec), cmd.output())
        .await
        .map_err(|_| "moonshine-worker-timeout")?
        .map_err(|_| "moonshine-worker-unavailable")?;
    Ok(result)
}
async fn worker(
    app: &tauri::AppHandle,
    mode: &str,
    lang: &str,
    job: Option<&Path>,
    timeout_sec: u64,
) -> Result<Value, String> {
    let root = root(app)?;
    let mut cmd = if let Some(executable) = bundled_worker(app) {
        let mut cmd = Command::new(executable);
        cmd.kill_on_drop(true);
        #[cfg(windows)]
        cmd.creation_flags(0x0800_0000);
        cmd.arg(mode).arg(&root).arg(lang);
        cmd
    } else {
        let python = find_python().await?;
        let mut cmd = base_command(&python);
        cmd.args(["-I", "-c", include_str!("moonshine_worker.py"), mode]);
        cmd.arg(&root).arg(lang);
        cmd
    };
    if let Some(job) = job {
        cmd.arg(job);
    }
    cmd.env("PYTHONUTF8", "1").env("PYTHONNOUSERSITE", "1");
    let result = output(cmd, timeout_sec).await?;
    // Native library diagnostics go to stderr; only the controlled JSON line
    // is trusted. Do not log transcript text, paths or stderr.
    let stdout = String::from_utf8_lossy(&result.stdout);
    let payload = stdout
        .lines()
        .rev()
        .find_map(|line| line.strip_prefix(RESULT_PREFIX))
        .ok_or("moonshine-worker-exited")?;
    let value: Value =
        serde_json::from_str(payload).map_err(|_| "moonshine-worker-invalid-result")?;
    if let Some(error) = value.get("error").and_then(Value::as_str) {
        return Err(error.to_owned());
    }
    if !result.status.success() {
        return Err("moonshine-worker-exited".into());
    }
    Ok(value)
}

#[tauri::command]
pub async fn moonshine_model_status(
    app: tauri::AppHandle,
    language: String,
) -> Result<MoonshineStatus, String> {
    let lang = language_code(&language)?;
    match worker(&app, "status", lang, None, 12).await {
        Ok(value) => {
            serde_json::from_value(value).map_err(|_| "moonshine-worker-invalid-result".into())
        }
        Err(error) if error == "moonshine-python3-required" => Ok(MoonshineStatus {
            supported: false,
            runtime_installed: false,
            installed: false,
            language: lang.to_owned(),
        }),
        Err(error) => Err(error),
    }
}

#[tauri::command]
pub async fn moonshine_runtime_install(app: tauri::AppHandle) -> Result<(), String> {
    if bundled_worker(&app).is_some() {
        return Ok(());
    }
    let python = find_python().await?;
    let install_dir = root(&app)?.join("runtime");
    tokio::fs::create_dir_all(&install_dir)
        .await
        .map_err(|_| "moonshine-install-dir")?;
    let mut cmd = base_command(&python);
    cmd.args([
        "-I",
        "-m",
        "pip",
        "install",
        "--disable-pip-version-check",
        "--no-warn-script-location",
        "--upgrade",
        "--target",
    ]);
    cmd.arg(&install_dir)
        .arg(format!("moonshine-voice=={VERSION}"));
    let result = output(cmd, 300).await?;
    if !result.status.success() {
        return Err("moonshine-runtime-install-failed".into());
    }
    Ok(())
}

#[tauri::command]
pub async fn moonshine_model_download(
    app: tauri::AppHandle,
    language: String,
) -> Result<MoonshineStatus, String> {
    let lang = language_code(&language)?;
    let value = worker(&app, "download", lang, None, 300).await?;
    serde_json::from_value(value).map_err(|_| "moonshine-worker-invalid-result".into())
}

#[tauri::command]
pub async fn moonshine_model_remove(
    app: tauri::AppHandle,
    language: String,
) -> Result<MoonshineStatus, String> {
    let lang = language_code(&language)?;
    let value = worker(&app, "remove", lang, None, 10).await?;
    serde_json::from_value(value).map_err(|_| "moonshine-worker-invalid-result".into())
}

struct Cleanup(PathBuf);
impl Drop for Cleanup {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn moonshine_transcribe_windows(
    app: tauri::AppHandle,
    url: String,
    headers: Option<std::collections::HashMap<String, String>>,
    duration_sec: f32,
    sub_lang: Option<String>,
    probe_count: Option<usize>,
    window_sec: Option<f32>,
    map_spec: Option<String>,
    session_id: Option<String>,
) -> Result<Vec<MoonshineWindow>, String> {
    super::url_guard::validate_media_url(&url, true)?;
    let lang = language_code(sub_lang.as_deref().unwrap_or(""))?.to_owned();
    if !duration_sec.is_finite() || !(15.0..=86_400.0).contains(&duration_sec) {
        return Err("moonshine-invalid-duration".into());
    }
    let len = window_sec.unwrap_or(30.0).clamp(10.0, 35.0);
    let probes = super::asr::probe_windows(duration_sec, probe_count.unwrap_or(1).clamp(1, 3), len);
    let map = super::url_guard::safe_map_spec(map_spec.as_deref());
    super::analysis_control::run(session_id.as_deref(), async {
        let dir = root(&app)?.join("jobs").join(uuid::Uuid::new_v4().to_string());
        tokio::fs::create_dir_all(&dir).await.map_err(|_| "moonshine-job-dir")?;
        let _cleanup = Cleanup(dir.clone());
        let mut entries = Vec::new();
        for (index, (start, length)) in probes.iter().enumerate() {
            let pcm = super::asr::pcm_window(
                &url, &headers.clone().unwrap_or_default(), *start, *length, &map
            ).await?;
            if pcm.len() < 16_000 || pcm.len() > 35 * 16_000 || pcm.iter().any(|p| !p.is_finite()) {
                return Err("moonshine-invalid-audio".into());
            }
            let mut bytes = Vec::with_capacity(pcm.len() * 4);
            for sample in &pcm { bytes.extend_from_slice(&sample.to_le_bytes()); }
            let filename = format!("{index}.f32");
            tokio::fs::write(dir.join(&filename), bytes).await.map_err(|_| "moonshine-audio-write")?;
            entries.push(json!({"file": filename, "start": start, "length": pcm.len() as f32 / 16000.0, "samples": pcm.len()}));
        }
        let request = dir.join("request.json");
        tokio::fs::write(&request, json!({"dir": dir, "windows": entries}).to_string())
            .await.map_err(|_| "moonshine-job-write")?;
        let value = worker(&app, "transcribe", &lang, Some(&request), 90).await?;
        let windows: Vec<MoonshineWindow> = serde_json::from_value(value)
            .map_err(|_| "moonshine-worker-invalid-result")?;
        if windows.iter().flat_map(|window| &window.tokens).any(|token|
            !token.t0.is_finite() || !token.t1.is_finite() || token.t1 <= token.t0) {
            return Err("moonshine-invalid-timestamps".into());
        }
        Ok(windows)
    }).await?
}

#[cfg(test)]
mod tests {
    use super::language_code;
    #[test]
    fn moonshine_languages_reject_unavailable_models() {
        assert_eq!(language_code("en-US"), Ok("en"));
        assert_eq!(language_code("ar"), Ok("ar"));
        assert!(language_code("fr").is_err());
        assert!(language_code("../en").is_err());
    }
}
