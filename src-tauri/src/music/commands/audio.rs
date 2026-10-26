use super::super::{audio::MusicAudioSettings, m3u, MusicState, ACTIVE_SPOTIFY, ACTIVE_MODULE, ACTIVE_MODULE_SPOTIFY};

#[tauri::command]
pub async fn music_audio_devices(
    state: tauri::State<'_, MusicState>,
) -> Result<Vec<crate::mpv::AudioDevice>, String> {
    state.engine.audio_devices().await
}

#[tauri::command]
pub fn music_audio_settings_get(
    state: tauri::State<'_, MusicState>,
) -> Result<MusicAudioSettings, String> {
    state.engine.audio_settings()
}

#[tauri::command]
pub async fn music_audio_settings_set(
    state: tauri::State<'_, MusicState>,
    settings: MusicAudioSettings,
) -> Result<MusicAudioSettings, String> {
    if state.active_engine() == ACTIVE_MODULE {
        // Harbor retains the original settings file and is authoritative for persistence.
        // Apply the native settings before committing them to disk, restoring the prior
        // sidecar configuration if Harbor fails to persist the update.
        let previous = state.engine.audio_settings()?;
        let applied: MusicAudioSettings = serde_json::from_value(
            m3u::module_request_async(serde_json::json!({
                "command": "mpv_audio_settings_set", "settings": settings
            })).await?
        ).map_err(|e|format!("Music host returned invalid audio settings: {e}"))?;
        match state.engine.set_audio_settings(applied).await {
            Ok(saved) => Ok(saved),
            Err(error) => {
                let _ = m3u::module_request_async(serde_json::json!({
                    "command":"mpv_audio_settings_set","settings":previous
                })).await;
                Err(error)
            }
        }
    } else {
        state.engine.set_audio_settings(settings).await
    }
}

#[tauri::command]
pub async fn music_audio_meter_set_enabled(
    state: tauri::State<'_, MusicState>,
    enabled: bool,
) -> Result<(), String> {
    if state.active_engine() == ACTIVE_MODULE {
        m3u::module_request_async(serde_json::json!({
            "command":"mpv_meter_set","enabled":enabled
        })).await?;
        return Ok(());
    }
    if state.active_engine() == ACTIVE_MODULE_SPOTIFY {
        m3u::module_request_async(serde_json::json!({
            "command":"spotify_meter_set","enabled":enabled
        })).await?;
        return Ok(());
    }
    if state.active_engine() == ACTIVE_SPOTIFY {
        state.spotify.set_meter_enabled(enabled).await;
        return Ok(());
    }
    state.engine.set_meter_enabled(enabled).await
}

#[tauri::command]
pub async fn music_audio_meter_snapshot(
    state: tauri::State<'_, MusicState>,
) -> Result<Option<super::super::engine::MusicMeterSnapshot>, String> {
    if state.active_engine() == ACTIVE_MODULE {
        let result = m3u::module_request_async(serde_json::json!({
            "command":"mpv_meter_snapshot","deck":0
        })).await?;
        return serde_json::from_value(result).map_err(|e|e.to_string());
    }
    if state.active_engine() == ACTIVE_MODULE_SPOTIFY {
        let result=m3u::module_request_async(serde_json::json!({
            "command":"spotify_meter_snapshot"
        })).await?;
        return serde_json::from_value(result).map_err(|e|e.to_string());
    }
    if state.active_engine() == ACTIVE_SPOTIFY {
        return Ok(state.spotify.meter_snapshot().await);
    }
    Ok(state.engine.meter_snapshot().await)
}

#[tauri::command]
pub async fn music_broadcast_targets(
    state: tauri::State<'_, MusicState>,
) -> Result<super::super::engine::BroadcastTargets, String> {
    state.engine.broadcast_targets().await
}

#[tauri::command]
pub async fn music_broadcast_start(
    app: tauri::AppHandle,
    state: tauri::State<'_, MusicState>,
    device: Option<String>,
) -> Result<super::super::engine::BroadcastStatus, String> {
    if state.active_engine()==ACTIVE_MODULE {
        // Retain Harbor's established virtual-device classification and
        // interactive device selection instead of trusting arbitrary paths.
        let targets=state.engine.broadcast_targets().await?;
        let choice=device.or_else(||targets.devices.first().map(|d|d.name.clone()))
            .ok_or_else(||"No virtual audio device was found".to_string())?;
        if !targets.devices.iter().any(|d|d.name==choice){
            return Err("That broadcast output is no longer available".into());
        }
        let response=m3u::module_request_async(serde_json::json!({
            "command":"mpv_broadcast_start","device":choice
        })).await?;
        return serde_json::from_value(response).map_err(|e|e.to_string());
    }
    state.engine.start_broadcast(app, device).await
}

#[tauri::command]
pub async fn music_broadcast_stop(
    state: tauri::State<'_, MusicState>,
) -> Result<super::super::engine::BroadcastStatus, String> {
    if state.active_engine()==ACTIVE_MODULE {
        let response=m3u::module_request_async(serde_json::json!({
            "command":"mpv_broadcast_stop"
        })).await?;
        return serde_json::from_value(response).map_err(|e|e.to_string());
    }
    state.engine.stop_broadcast().await
}

#[tauri::command]
pub async fn music_broadcast_status(
    state: tauri::State<'_, MusicState>,
) -> Result<super::super::engine::BroadcastStatus, String> {
    if state.active_engine()==ACTIVE_MODULE {
        let response=m3u::module_request_async(serde_json::json!({
            "command":"mpv_broadcast_status"
        })).await?;
        return serde_json::from_value(response).map_err(|e|e.to_string());
    }
    Ok(state.engine.broadcast_status().await)
}

#[tauri::command]
pub async fn music_export_filtered(
    state: tauri::State<'_, MusicState>,
    path: String,
) -> Result<bool, String> {
    let settings = state.engine.audio_settings()?;
    let chain = super::super::audio::export_filter_chain(&settings);
    if chain.is_empty() {
        return Ok(false);
    }
    let Some(ffmpeg) = crate::transcode::locate_ffmpeg() else {
        return Err("music.download.noFfmpeg".to_string());
    };
    let source = std::path::PathBuf::from(&path);
    if !source.is_file() {
        return Err("music.download.missing".to_string());
    }
    let extension = source
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("m4a")
        .to_string();
    let target = source.with_extension(format!("filtered.{extension}"));
    let status = tokio::process::Command::new(&ffmpeg)
        .args(["-hide_banner", "-loglevel", "error", "-y", "-i"])
        .arg(&source)
        .args(["-af", &chain, "-vn", "-map_metadata", "0"])
        .arg(&target)
        .status()
        .await
        .map_err(|error| format!("ffmpeg: {error}"))?;
    if !status.success() {
        let _ = std::fs::remove_file(&target);
        return Err("music.download.filterFailed".to_string());
    }
    std::fs::rename(&target, &source).map_err(|error| format!("replace: {error}"))?;
    Ok(true)
}
