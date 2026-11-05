//! Convert mpv's experimental dump-cache output into a verified, audio-only clip.
//! The cache recorder can write a substantial MKV while silently losing video packets
//! (notably B-frames without DTS). Never feed the raw recorder output to the matcher.

use std::path::PathBuf;
use std::time::Duration;

use serde::Serialize;
use tokio::process::Command;

const SAMPLE_RATE: f64 = 16_000.0;
const MIN_AUDIO_SECONDS: f64 = 43.0;
const MAX_AUDIO_SECONDS: u64 = 46;
const EXTRACTION_TIMEOUT_SECONDS: u64 = 30;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreparedCacheAudio {
    pub path: String,
    pub duration_sec: f64,
}

fn cache_dump_path(input: &str) -> Result<PathBuf, String> {
    let allowed_dir = std::fs::canonicalize(std::env::temp_dir().join("harbor-subs").join("live"))
        .map_err(|_| "cache-audio-temp-dir-unavailable")?;
    let source = std::fs::canonicalize(input).map_err(|_| "cache-audio-dump-missing")?;
    if source.parent() != Some(allowed_dir.as_path())
        || source.extension().and_then(|ext| ext.to_str()) != Some("mkv")
        || !source
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| name.starts_with("tap-"))
    {
        return Err("cache-audio-path-invalid".into());
    }
    Ok(source)
}

/// Normalize the *selected* stream to PCM, avoiding the muxer's broken video
/// packets and giving the matcher a clean, zero-based audio timeline.
/// The input must be Harbor's temporary cache dump, never an arbitrary path.
#[tauri::command]
pub async fn subsync_prepare_cache_audio(
    input: String,
    map_spec: Option<String>,
    session_id: Option<String>,
) -> Result<PreparedCacheAudio, String> {
    let input_path = cache_dump_path(&input)?;
    let ffmpeg = crate::transcode::locate_ffmpeg().ok_or("ffmpeg-unavailable")?;
    let output_path = input_path.with_extension("wav");
    let selected_map = super::url_guard::safe_map_spec(map_spec.as_deref());

    let mut cmd = Command::new(ffmpeg);
    cmd.args([
        "-nostdin",
        "-hide_banner",
        "-loglevel",
        "error",
        "-fflags",
        "+genpts",
    ])
    .arg("-i")
    .arg(&input_path)
    .arg("-map")
    .arg(&selected_map)
    .args(["-vn", "-sn", "-dn", "-t"])
    .arg(MAX_AUDIO_SECONDS.to_string())
    .args(["-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", "-y"])
    .arg(&output_path);
    cmd.kill_on_drop(true);
    #[cfg(windows)]
    cmd.creation_flags(0x0800_0000 | 0x0000_4000);

    let output = match super::analysis_control::run(
        session_id.as_deref(),
        tokio::time::timeout(
            Duration::from_secs(EXTRACTION_TIMEOUT_SECONDS),
            cmd.output(),
        ),
    )
    .await
    {
        Ok(output) => output,
        Err(error) => {
            // Cancelling while FFmpeg is writing must not leave a partial WAV
            // which might be mistaken for a later completed cache extraction.
            let _ = std::fs::remove_file(&output_path);
            return Err(error);
        }
    };
    let success = matches!(output, Ok(Ok(ref result)) if result.status.success());
    if !success {
        let _ = std::fs::remove_file(&output_path);
        return Err(match output {
            Err(_) => "cache-audio-extract-timeout",
            _ => "cache-audio-extract-failed",
        }
        .into());
    }

    // The PCM payload is constant bitrate, so its size bounds actual decoded
    // audio even if the damaged MKV claims it contains a full minute.
    let bytes = std::fs::metadata(&output_path)
        .map_err(|_| "cache-audio-output-missing")?
        .len();
    let duration_sec = (bytes.saturating_sub(44) as f64) / (SAMPLE_RATE * 2.0);
    if !duration_sec.is_finite() || duration_sec < MIN_AUDIO_SECONDS {
        let _ = std::fs::remove_file(&output_path);
        return Err("cache-audio-incomplete".into());
    }
    Ok(PreparedCacheAudio {
        path: output_path.to_string_lossy().into_owned(),
        duration_sec,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pcm_length_detects_short_or_missing_audio() {
        assert!((45.0 - (1_440_044u64 - 44) as f64 / (SAMPLE_RATE * 2.0)).abs() < 0.001);
        assert!((640_044u64 - 44) as f64 / (SAMPLE_RATE * 2.0) < MIN_AUDIO_SECONDS);
    }
}
