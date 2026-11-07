//! Speech detection only on the bounded, selected-track playback WAV.

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackSpeech {
    duration_sec: f32,
    intervals: Vec<(f32, f32)>,
}

#[cfg(feature = "silero-vad")]
fn prepared_path(input: &str) -> Result<std::path::PathBuf, String> {
    let root = std::fs::canonicalize(std::env::temp_dir().join("harbor-subs/live"))
        .map_err(|_| "cache-audio-temp-dir-unavailable")?;
    let path = std::fs::canonicalize(input).map_err(|_| "cache-audio-output-missing")?;
    if path.parent() != Some(root.as_path())
        || path.extension().and_then(|v| v.to_str()) != Some("wav")
        || !path
            .file_name()
            .and_then(|v| v.to_str())
            .is_some_and(|v| v.starts_with("tap-"))
        || std::fs::metadata(&path)
            .map_err(|_| "cache-audio-output-missing")?
            .len()
            > 2_000_000
    {
        return Err("cache-audio-path-invalid".into());
    }
    Ok(path)
}

#[tauri::command]
pub async fn subsync_playback_speech(
    path: String,
    session_id: Option<String>,
) -> Result<Option<PlaybackSpeech>, String> {
    #[cfg(not(feature = "silero-vad"))]
    {
        let _ = (path, session_id);
        Ok(None)
    }
    #[cfg(feature = "silero-vad")]
    {
        let path = prepared_path(&path)?;
        super::analysis_control::run(session_id.as_deref(), async {
            let pcm = super::asr::pcm_window(
                &path.to_string_lossy(),
                &std::collections::HashMap::new(),
                0.0,
                46.0,
                "0:a:0",
            )
            .await?;
            let duration_sec = pcm.len() as f32 / super::vad::SR as f32;
            if !(30.0..=46.0).contains(&duration_sec) || pcm.iter().any(|v| !v.is_finite()) {
                return Err("cache-audio-incomplete".into());
            }
            // ONNX inference never blocks Tauri's async executor or mpv callbacks.
            // Input length is capped even if the caller abandons this worker.
            let intervals = tokio::task::spawn_blocking(move || {
                Ok::<_, String>(
                    super::vad::speech_report_pcm(
                        &pcm,
                        0.0,
                        duration_sec,
                        &super::vad::VadConfig::default(),
                        super::vad::Backend::Silero,
                    )?
                    .intervals,
                )
            })
            .await
            .map_err(|_| "silero-worker-failed")??;
            Ok(Some(PlaybackSpeech {
                duration_sec,
                intervals,
            }))
        })
        .await?
    }
}
