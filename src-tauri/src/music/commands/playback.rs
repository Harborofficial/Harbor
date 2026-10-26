use super::super::engine::MusicDeckState;
use super::super::{
    library, m3u, MusicState, MusicTrack, ACTIVE_NONE, ACTIVE_SPOTIFY, ACTIVE_STREAM, ACTIVE_MODULE, ACTIVE_MODULE_SPOTIFY,
};
use super::search::resolve_track;
use std::sync::atomic::Ordering;
use tauri::Manager;

#[tauri::command]
pub async fn music_play_track(
    app: tauri::AppHandle,
    state: tauri::State<'_, MusicState>,
    track: MusicTrack,
    volume: Option<f64>,
) -> Result<(), String> {
    let request = state.begin_play_request();
    let volume = volume.unwrap_or(0.82);
    if track.connector_id.as_deref() == Some("spotify") {
        let sidecar_enabled = std::env::var("HARBOR_EXPERIMENTAL_MUSIC_SPOTIFY").as_deref()==Ok("1")
            && m3u::experimental_local_playback(&MusicTrack {
                connector_id: Some("local".into()), ..track.clone()
            })
            && state.spotify.remote_device().is_none();
        if sidecar_enabled {
            let _commit=state.play_commit.lock().await;
            if !state.is_current_play_request(request) {return Ok(());}
            let snapshot=m3u::module_request_async(serde_json::json!({
                "command":"spotify_state"
            })).await?;
            if snapshot["connected"]!=true {
                let stored=crate::settings_store::secret_value(&app,
                    "harbor.spotify.v1.credentials")?
                    .ok_or_else(||"Connect Spotify Premium before playing".to_string())?;
                let device_id=crate::settings_store::secret_value(&app,
                    "harbor.spotify.v1.deviceId")?.unwrap_or_default();
                let folder=app.path().app_data_dir().map_err(|e|e.to_string())?.join("spotify");
                m3u::module_request_async(serde_json::json!({
                    "command":"spotify_connect","credentials":stored,
                    "cache_path":folder.to_string_lossy(),"device_id":device_id
                })).await?;
            }
            let source_id=track.source_id.as_deref()
                .ok_or_else(||"Spotify track has no URI".to_string())?;
            if state.active_engine()==ACTIVE_MODULE {
                m3u::module_request_async(serde_json::json!({"command":"mpv_stop","deck":0})).await?;
            }
            state.engine.stop(false).await?;
            m3u::module_request_async(serde_json::json!({
                "command":"spotify_play","source_id":source_id,
                "track_id":track.id,"volume":volume
            })).await?;
            m3u::playback_started(&track);
            state.set_active_engine(ACTIVE_MODULE_SPOTIFY);
            return Ok(());
        }
        if state.active_engine()==ACTIVE_MODULE_SPOTIFY {
            m3u::module_request_async(serde_json::json!({"command":"spotify_stop"})).await?;
        }
        let _commit = state.play_commit.lock().await;
        if !state.is_current_play_request(request) {
            return Ok(());
        }
        if state.active_engine() == ACTIVE_MODULE {
            m3u::module_request_async(serde_json::json!({"command":"mpv_stop","deck":0})).await?;
        }
        state.engine.stop(false).await?;
        if !state.is_current_play_request(request) {
            return Ok(());
        }
        state.spotify.play(track, volume).await?;
        state.set_active_engine(ACTIVE_SPOTIFY);
        return Ok(());
    }
    let stream = resolve_track(&app, state.inner(), &track).await;
    if !state.is_current_play_request(request) {
        return Ok(());
    }
    let stream = stream?;
    let _commit = state.play_commit.lock().await;
    if !state.is_current_play_request(request) {
        return Ok(());
    }
    state.spotify.stop(false).await?;
    if state.active_engine()==ACTIVE_MODULE_SPOTIFY {
        m3u::module_request_async(serde_json::json!({"command":"spotify_stop"})).await?;
    }
    if !state.is_current_play_request(request) {
        return Ok(());
    }
    if m3u::experimental_local_playback(&track) {
        let audio = state.engine.audio_settings()?;
        m3u::module_request_async(serde_json::json!({
            "command":"mpv_audio_settings_set","settings":audio
        })).await?;
        state.engine.stop(false).await?;
        m3u::module_request_async(serde_json::json!({
            "command":"mpv_play","deck":0,"url":stream.url,
            "track_id":track.id,"connector_id":track.connector_id,"volume":volume,
            "headers":stream.http_headers
        })).await?;
        state.external_primary.store(0, Ordering::SeqCst);
        m3u::playback_started(&track);
        state.set_active_engine(ACTIVE_MODULE);
        return Ok(());
    }
    if state.active_engine() == ACTIVE_MODULE {
        m3u::module_request_async(serde_json::json!({"command":"mpv_stop","deck":0})).await?;
    }
    state.engine.play(app, stream, track, volume).await?;
    state.set_active_engine(ACTIVE_STREAM);
    Ok(())
}

/// Warm the next Spotify track while the current one is still playing. The request is a
/// no-op unless local Spotify playback owns the output.
#[tauri::command]
pub async fn music_spotify_preload(
    state: tauri::State<'_, MusicState>,
    track: MusicTrack,
) -> Result<bool, String> {
    if state.active_engine()==ACTIVE_MODULE_SPOTIFY {
        let Some(source_id)=track.source_id else{return Ok(false)};
        m3u::module_request_async(serde_json::json!({
            "command":"spotify_preload","source_id":source_id
        })).await?;
        return Ok(true);
    }
    if state.active_engine() != ACTIVE_SPOTIFY {
        return Ok(false);
    }
    state.spotify.preload(track).await
}

#[tauri::command]
pub async fn music_engine_pause(
    state: tauri::State<'_, MusicState>,
    paused: bool,
) -> Result<(), String> {
    match state.active_engine() {
        ACTIVE_SPOTIFY => state.spotify.set_paused(paused).await,
        ACTIVE_MODULE_SPOTIFY => m3u::module_request_async(serde_json::json!({"command":"spotify_pause","paused":paused})).await.map(|_|()),
        ACTIVE_STREAM => state.engine.set_paused(paused).await,
        ACTIVE_MODULE => {
            state.external_paused_for_video.store(false,Ordering::SeqCst);
            m3u::module_request_async(serde_json::json!({
                "command":"mpv_pause","deck":0,"paused":paused
            })).await.map(|_| ())
        },
        _ => Ok(()),
    }
}

/// Only true when a video silenced the music, so the offer to resume is never shown to
/// someone who paused it themselves.
#[tauri::command]
pub async fn music_paused_for_video(state: tauri::State<'_, MusicState>) -> Result<bool, String> {
    Ok(match state.active_engine() {
        ACTIVE_SPOTIFY => state.spotify.paused_for_video(),
        ACTIVE_MODULE_SPOTIFY => state.external_paused_for_video.load(Ordering::SeqCst),
        ACTIVE_STREAM => state.engine.paused_for_video(),
        ACTIVE_MODULE => state.external_paused_for_video.load(Ordering::SeqCst),
        _ => false,
    })
}

#[tauri::command]
pub async fn music_resume_after_video(state: tauri::State<'_, MusicState>) -> Result<(), String> {
    match state.active_engine() {
        ACTIVE_SPOTIFY => state.spotify.set_paused(false).await,
        ACTIVE_MODULE_SPOTIFY => {
            if state.external_paused_for_video.swap(false,Ordering::SeqCst) {
                m3u::module_request_async(serde_json::json!({"command":"spotify_pause","paused":false})).await?;
            }
            Ok(())
        },
        ACTIVE_STREAM => state.engine.resume_after_video().await,
        ACTIVE_MODULE => {
            if state.external_paused_for_video.swap(false,Ordering::SeqCst) {
                m3u::module_request_async(serde_json::json!({
                    "command":"mpv_pause","deck":0,"paused":false
                })).await?;
            }
            Ok(())
        },
        _ => Ok(()),
    }
}

#[tauri::command]
pub async fn music_engine_seek(
    state: tauri::State<'_, MusicState>,
    position: f64,
) -> Result<(), String> {
    match state.active_engine() {
        ACTIVE_SPOTIFY => state.spotify.seek(position).await,
        ACTIVE_MODULE_SPOTIFY => m3u::module_request_async(serde_json::json!({"command":"spotify_seek","seconds":position})).await.map(|_|()),
        ACTIVE_STREAM => state.engine.seek(position).await,
        ACTIVE_MODULE => m3u::module_request_async(serde_json::json!({
            "command":"mpv_seek","deck":0,"seconds":position
        })).await.map(|_| ()) ,
        _ => Ok(()),
    }
}

#[tauri::command]
pub async fn music_engine_set_volume(
    state: tauri::State<'_, MusicState>,
    volume: f64,
) -> Result<(), String> {
    match state.active_engine() {
        ACTIVE_SPOTIFY => state.spotify.set_volume(volume).await,
        ACTIVE_MODULE_SPOTIFY => m3u::module_request_async(serde_json::json!({"command":"spotify_volume","volume":volume})).await.map(|_|()),
        ACTIVE_STREAM => state.engine.set_volume(volume).await,
        ACTIVE_MODULE => m3u::module_request_async(serde_json::json!({
            "command":"mpv_volume","deck":0,"volume":volume
        })).await.map(|_| ()) ,
        _ => Ok(()),
    }
}

#[tauri::command]
pub async fn music_engine_stop(
    state: tauri::State<'_, MusicState>,
    unpause: Option<bool>,
) -> Result<(), String> {
    let unpause = unpause.unwrap_or(false);
    let request = (!unpause).then(|| state.begin_play_request());
    let _commit = state.play_commit.lock().await;
    if request.is_some_and(|request| !state.is_current_play_request(request)) {
        return Ok(());
    }
    let result = match state.active_engine() {
        ACTIVE_SPOTIFY => state.spotify.stop(unpause).await,
        ACTIVE_MODULE_SPOTIFY => {
            if unpause {
                if state.external_paused_for_video.swap(false,Ordering::SeqCst) {
                    m3u::module_request_async(serde_json::json!({"command":"spotify_pause","paused":false})).await?;
                }
                Ok(())
            } else {
                m3u::module_request_async(serde_json::json!({"command":"spotify_stop"})).await.map(|_|())
            }
        },
        ACTIVE_STREAM => state.engine.stop(unpause).await,
        ACTIVE_MODULE => {
            if unpause {
                if state.external_paused_for_video.swap(false,Ordering::SeqCst) {
                    m3u::module_request_async(serde_json::json!({
                        "command":"mpv_pause","deck":0,"paused":false
                    })).await?;
                }
                Ok(())
            } else {
                m3u::module_request_async(serde_json::json!({
                    "command":"mpv_stop","deck":0
                })).await.map(|_| ())
            }
        },
        _ => Ok(()),
    };
    if !unpause && result.is_ok() {
        state.set_active_engine(ACTIVE_NONE);
    }
    result
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MusicEngineSnapshot {
    pub engine: String,
    pub live: bool,
    pub paused: bool,
    pub deck: Option<u8>,
    pub track_id: Option<String>,
    pub connector_id: Option<String>,
    pub position_seconds: Option<f64>,
    pub duration_seconds: Option<f64>,
}

/// The engine that is actually on air, so a reloaded interface can rejoin it instead of
/// restoring a checkpoint that has not known about playback since the page went away.
#[tauri::command]
pub async fn music_engine_state(
    state: tauri::State<'_, MusicState>,
) -> Result<MusicEngineSnapshot, String> {
    let mut snapshot = MusicEngineSnapshot {
        engine: "none".to_string(),
        live: false,
        paused: true,
        deck: None,
        track_id: None,
        connector_id: None,
        position_seconds: None,
        duration_seconds: None,
    };
    if state.active_engine() == ACTIVE_SPOTIFY {
        let playback = state.spotify.playback_state().await;
        snapshot.engine = "spotify".to_string();
        snapshot.live = playback.live;
        snapshot.paused = playback.paused;
        snapshot.track_id = playback.track.as_ref().map(|track| track.id.clone());
        snapshot.connector_id = playback
            .track
            .as_ref()
            .and_then(|track| track.connector_id.clone());
        snapshot.duration_seconds = playback
            .track
            .as_ref()
            .map(|track| track.duration_seconds as f64)
            .filter(|value| *value > 0.0);
        snapshot.position_seconds = playback.position_seconds;
        return Ok(snapshot);
    }
    if state.active_engine()==ACTIVE_MODULE_SPOTIFY {
        let data=m3u::module_request_async(serde_json::json!({
            "command":"spotify_state"
        })).await?;
        snapshot.engine="spotify".to_string();
        snapshot.live=data["live"].as_bool().unwrap_or(false);
        snapshot.paused=data["paused"].as_bool().unwrap_or(true);
        snapshot.track_id=data["trackId"].as_str().map(str::to_owned);
        snapshot.connector_id=Some("spotify".into());
        snapshot.position_seconds=data["positionSeconds"].as_f64();
        return Ok(snapshot);
    }
    if state.active_engine() == ACTIVE_MODULE {
        let primary = state.external_primary.load(Ordering::SeqCst).min(1);
        let data = m3u::module_request_async(serde_json::json!({
            "command":"mpv_state","deck":primary
        })).await?;
        snapshot.engine="stream".to_string();
        snapshot.live=data["live"].as_bool().unwrap_or(false);
        snapshot.paused=data["paused"].as_bool().unwrap_or(false);
        snapshot.deck=Some(primary);
        snapshot.track_id=data["trackId"].as_str().map(str::to_string);
        snapshot.connector_id=data["connectorId"].as_str().map(str::to_string);
        snapshot.position_seconds=data["positionSeconds"].as_f64();
        snapshot.duration_seconds=data["durationSeconds"].as_f64();
        return Ok(snapshot);
    }
    // A deck can be live without the active engine ever being claimed (the DJ deck plays
    // straight to deck B), so the primary deck is inspected for every non-Spotify state.
    let decks = state.engine.deck_states().await;
    let primary = state.engine.primary_deck();
    if let Some(deck) = decks.get(primary).filter(|deck| deck.live) {
        snapshot.engine = "stream".to_string();
        snapshot.live = true;
        snapshot.paused = deck.paused;
        snapshot.deck = Some(primary as u8);
        snapshot.track_id = deck.track_id.clone();
        snapshot.connector_id = deck.connector_id.clone();
        snapshot.position_seconds = deck.position_seconds;
        snapshot.duration_seconds = deck.duration_seconds;
    }
    Ok(snapshot)
}

#[tauri::command]
pub fn music_import_m3u(
    state: tauri::State<'_, MusicState>,
    path: String,
) -> Result<Vec<MusicTrack>, String> {
    m3u::import(&state.db, &path)
}

#[tauri::command]
pub async fn music_export_m3u(
    app: tauri::AppHandle,
    state: tauri::State<'_, MusicState>,
    playlist_id: String,
    path: String,
) -> Result<(), String> {
    let tracks = library::tracks_for_playlist(&state.db, &playlist_id)?;
    let mut resolved = Vec::with_capacity(tracks.len());
    for track in tracks {
        let stream = resolve_track(&app, state.inner(), &track).await?;
        resolved.push((track, stream.url));
    }
    m3u::export(&path, &resolved)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn a_slow_old_resolver_cannot_replace_the_newest_request() {
        let state = MusicState::new();
        let old = state.begin_play_request();
        let newest = state.begin_play_request();
        {
            let _commit = state.play_commit.lock().await;
            assert!(state.is_current_play_request(newest));
        }
        let _old_commit = state.play_commit.lock().await;
        assert!(!state.is_current_play_request(old));
    }

    #[test]
    fn stop_invalidates_a_pending_resolution() {
        let state = MusicState::new();
        let pending = state.begin_play_request();
        let stop = state.begin_play_request();
        assert!(!state.is_current_play_request(pending));
        assert!(state.is_current_play_request(stop));
    }
}

#[tauri::command]
pub async fn music_deck_loop(
    state: tauri::State<'_, MusicState>,
    start: Option<f64>,
    end: Option<f64>,
) -> Result<(), String> {
    if state.active_engine() == ACTIVE_MODULE {
        m3u::module_request_async(serde_json::json!({
            "command":"mpv_loop","deck":0,"start":start,"end":end
        })).await?;
        return Ok(());
    }
    if state.active_engine() != ACTIVE_STREAM {
        return Ok(());
    }
    state.engine.set_loop(start, end).await
}

#[tauri::command]
pub async fn music_deck_scratch(
    state: tauri::State<'_, MusicState>,
    position: f64,
    rate: f64,
    holding: bool,
) -> Result<f64, String> {
    match state.active_engine() {
        ACTIVE_STREAM => state.engine.scratch(position, rate, holding).await,
        ACTIVE_MODULE => m3u::module_request_async(serde_json::json!({
            "command":"mpv_scratch","deck":0,"position":position,"rate":rate,"holding":holding
        })).await?.as_f64().ok_or_else(||"Music scratch returned invalid position".to_string()),
        ACTIVE_SPOTIFY if !holding => state.spotify.seek(position).await.map(|()| position),
        _ => Ok(position),
    }
}

#[tauri::command]
pub async fn music_deck_play(
    app: tauri::AppHandle,
    state: tauri::State<'_, MusicState>,
    deck: u8,
    track: MusicTrack,
    volume: Option<f64>,
) -> Result<(), String> {
    if deck == 0 {
        return music_play_track(app, state, track, volume).await;
    }
    if track.connector_id.as_deref() == Some("spotify") {
        return Err("Spotify plays on the main deck only".to_string());
    }
    let volume = volume.unwrap_or(0.82);
    let stream = resolve_track(&app, state.inner(), &track).await?;
    if state.active_engine()==ACTIVE_MODULE && m3u::experimental_local_playback(&track) {
        m3u::module_request_async(serde_json::json!({
            "command":"mpv_play","deck":deck,"url":stream.url,
            "track_id":track.id,"connector_id":track.connector_id,"volume":volume
        })).await?;
        return Ok(());
    }
    state
        .engine
        .deck_play(app, usize::from(deck), stream, track, volume)
        .await
}

#[tauri::command]
pub async fn music_deck_pause(
    state: tauri::State<'_, MusicState>,
    deck: u8,
    paused: bool,
) -> Result<(), String> {
    if deck == 0 {
        return music_engine_pause(state, paused).await;
    }
    if state.active_engine()==ACTIVE_MODULE {
        m3u::module_request_async(serde_json::json!({
            "command":"mpv_pause","deck":deck,"paused":paused
        })).await?;
        return Ok(());
    }
    state.engine.deck_pause(usize::from(deck), paused).await
}

#[tauri::command]
pub async fn music_deck_seek(
    state: tauri::State<'_, MusicState>,
    deck: u8,
    position: f64,
) -> Result<(), String> {
    if deck == 0 {
        return music_engine_seek(state, position).await;
    }
    if state.active_engine()==ACTIVE_MODULE {
        m3u::module_request_async(serde_json::json!({
            "command":"mpv_seek","deck":deck,"seconds":position
        })).await?;
        return Ok(());
    }
    state.engine.deck_seek(usize::from(deck), position).await
}

#[tauri::command]
pub async fn music_deck_volume(
    state: tauri::State<'_, MusicState>,
    deck: u8,
    volume: f64,
) -> Result<(), String> {
    if deck == 0 {
        return music_engine_set_volume(state, volume).await;
    }
    if state.active_engine()==ACTIVE_MODULE {
        m3u::module_request_async(serde_json::json!({
            "command":"mpv_volume","deck":deck,"volume":volume
        })).await?;
        return Ok(());
    }
    state.engine.deck_volume(usize::from(deck), volume).await
}

#[tauri::command]
pub async fn music_deck_stop(
    state: tauri::State<'_, MusicState>,
    deck: u8,
) -> Result<(), String> {
    if deck == 0 {
        return music_engine_stop(state, Some(false)).await;
    }
    if state.active_engine()==ACTIVE_MODULE {
        m3u::module_request_async(serde_json::json!({
            "command":"mpv_stop","deck":deck
        })).await?;
        return Ok(());
    }
    state.engine.deck_stop(usize::from(deck)).await
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MusicDeckSnapshot {
    pub decks: Vec<MusicDeckState>,
    pub primary: u8,
}

async fn external_deck_state(deck:u8)->Result<MusicDeckState,String> {
    let data=m3u::module_request_async(serde_json::json!({
        "command":"mpv_state","deck":deck
    })).await?;
    Ok(MusicDeckState {
        deck,
        live:data["live"].as_bool().unwrap_or(false),
        paused:data["paused"].as_bool().unwrap_or(true),
        track_id:data["trackId"].as_str().map(str::to_owned),
        connector_id:data["connectorId"].as_str().map(str::to_owned),
        position_seconds:data["positionSeconds"].as_f64(),
        duration_seconds:data["durationSeconds"].as_f64(),
        volume:data["volume"].as_f64().unwrap_or(0.82),
        gain:data["gain"].as_f64().unwrap_or(if deck==0 {1.0} else {0.0}),
    })
}

#[tauri::command]
pub async fn music_deck_states(
    state: tauri::State<'_, MusicState>,
) -> Result<MusicDeckSnapshot, String> {
    if state.active_engine()==ACTIVE_MODULE {
        return Ok(MusicDeckSnapshot {
            decks:vec![external_deck_state(0).await?,external_deck_state(1).await?],
            primary:state.external_primary.load(Ordering::SeqCst).min(1),
        });
    }
    Ok(MusicDeckSnapshot {
        decks: state.engine.deck_states().await,
        primary: u8::try_from(state.engine.primary_deck()).unwrap_or(0),
    })
}

#[tauri::command]
pub async fn music_deck_primary(
    state: tauri::State<'_, MusicState>,
    deck: u8,
) -> Result<bool, String> {
    if state.active_engine()==ACTIVE_MODULE {
        if deck>1 {return Ok(false);}
        if !external_deck_state(deck).await?.live {return Ok(false);}
        return Ok(state.external_primary.swap(deck,Ordering::SeqCst)!=deck);
    }
    Ok(state.engine.set_primary_deck(usize::from(deck)).await)
}

#[tauri::command]
pub async fn music_deck_crossfade(
    state: tauri::State<'_, MusicState>,
    position: f64,
) -> Result<(), String> {
    if state.active_engine()==ACTIVE_MODULE {
        m3u::module_request_async(serde_json::json!({
            "command":"mpv_crossfade","position":position
        })).await?;
        state.external_crossfade.store(position.to_bits(),Ordering::SeqCst);
        return Ok(());
    }
    state.engine.set_crossfade(position).await
}

#[tauri::command]
pub fn music_deck_crossfade_get(state: tauri::State<'_, MusicState>) -> f64 {
    if state.active_engine()==ACTIVE_MODULE {
        return f64::from_bits(state.external_crossfade.load(Ordering::SeqCst));
    }
    state.engine.crossfade()
}
