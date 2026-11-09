//! Spotify control adapter for external native Music playback.
 //! Spotify account browsing, OAuth, user secrets and Remote Connect remain in Harbor.
use super::super::{m3u,MusicTrack};
use librespot_core::{session::Session,SpotifyUri};
use parking_lot::RwLock;
use std::sync::Arc;
use tauri::{AppHandle,Manager};

fn command(command:serde_json::Value)->Result<serde_json::Value,String>{
    m3u::module_request(command)
        .unwrap_or_else(||Err("Music component is not installed".into()))
}

pub struct ProxyPlayer {
    app:AppHandle,
}

impl ProxyPlayer {
    pub fn stop(&self) {
        let _=command(serde_json::json!({"command":"spotify_stop"}));
    }
    pub fn pause(&self){
        let _=command(serde_json::json!({"command":"spotify_pause","paused":true}));
    }
    pub fn play(&self){
        let _=command(serde_json::json!({"command":"spotify_pause","paused":false}));
    }
    pub fn seek(&self,ms:u32){
        let _=command(serde_json::json!({"command":"spotify_seek","seconds":ms as f64/1000.0}));
    }
    pub fn preload(&self,uri:SpotifyUri){
        if let Ok(uri)=uri.to_uri(){
            let _=command(serde_json::json!({"command":"spotify_preload","source_id":uri}));
        }
    }
}

pub struct ProxyMixer {
    app:AppHandle,
    volume:std::sync::Mutex<f64>,
}
impl ProxyMixer {
    pub fn set_volume(&self,volume:u16){
        let fraction=f64::from(volume)/65535.0;
        if let Ok(mut stored)=self.volume.lock(){*stored=fraction;}
        let _=command(serde_json::json!({"command":"spotify_volume","volume":fraction}));
    }
}

pub struct ProxyMeter;
impl ProxyMeter {
    pub fn reset(&self){}
    pub fn set_enabled(&self,enabled:bool){
        let _=command(serde_json::json!({"command":"spotify_meter_set","enabled":enabled}));
    }
}

pub struct PlaybackContext { pub track:MusicTrack }

pub struct SpotifyPlayer {
    pub player:Arc<ProxyPlayer>,
    pub mixer:Arc<ProxyMixer>,
    pub current:Arc<RwLock<Option<PlaybackContext>>>,
    pub meter:Arc<ProxyMeter>,
}
pub struct PlaybackSnapshot {
    pub track:Option<MusicTrack>,
    pub position_seconds:Option<f64>,
}
pub fn start(app:AppHandle,_session:Session)->Result<SpotifyPlayer,String>{
    Ok(SpotifyPlayer{
        player:Arc::new(ProxyPlayer{app:app.clone()}),
        mixer:Arc::new(ProxyMixer{app,volume:std::sync::Mutex::new(0.82)}),
        current:Arc::new(RwLock::new(None)),
        meter:Arc::new(ProxyMeter),
    })
}
pub fn play(runtime:&SpotifyPlayer,track:MusicTrack)->Result<(),String>{
    let uri=track.source_id.as_ref().ok_or("Spotify track lacks its URI")?;
    let app=&runtime.player.app;
    let data_dir=app.path().app_data_dir().map_err(|e|e.to_string())?;
    let state=command(serde_json::json!({"command":"spotify_state"}))?;
    if state["connected"]!=true {
        let credentials=super::keystore::read(app,super::keystore::SESSION_KEY)
            .ok_or("Connect Spotify Premium before playing")?;
        let device_id=super::keystore::read(app,super::keystore::DEVICE_ID_KEY)
            .unwrap_or_default();
        command(serde_json::json!({
            "command":"spotify_connect","credentials":credentials,
            "cache_path":data_dir.join("spotify").to_string_lossy(),
            "device_id":device_id
        }))?;
    }
    let volume=runtime.mixer.volume.lock().map(|v|*v).unwrap_or(0.82);
    command(serde_json::json!({"command":"spotify_play",
        "source_id":uri,"track_id":track.id,"volume":volume}))?;
    *runtime.current.write()=Some(PlaybackContext{track});
    Ok(())
}
pub fn snapshot(runtime:&SpotifyPlayer)->PlaybackSnapshot{
    let track=runtime.current.read().as_ref().map(|v|v.track.clone());
    let position=command(serde_json::json!({"command":"spotify_state"})).ok()
        .and_then(|v|v["positionSeconds"].as_f64());
    PlaybackSnapshot{track,position_seconds:position}
}
