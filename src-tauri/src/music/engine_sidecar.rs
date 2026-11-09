//! Lightweight Music engine facade for builds that keep native playback in the
//! optional components/music/harbor-music-module.exe, like Games/Plugins.
use super::{audio::MusicAudioSettings, m3u, MusicStream, MusicTrack};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Mutex;
use tauri::AppHandle;

#[path = "engine_sidecar_probe.rs"]
mod core_setup;

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
#[serde(default, rename_all="camelCase")]
pub struct MusicDeckState {
    pub deck: u8,
    pub live: bool,
    pub paused: bool,
    pub track_id: Option<String>,
    pub connector_id: Option<String>,
    pub position_seconds: Option<f64>,
    pub duration_seconds: Option<f64>,
    pub volume: f64,
    pub gain: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all="camelCase")]
pub struct MusicMeterChannel {
    pub rms_db: f64,
    pub peak_db: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all="camelCase")]
pub struct MusicMeterSnapshot {
    pub track_id: String,
    pub connector_id: Option<String>,
    pub active: bool,
    pub channels: Vec<MusicMeterChannel>,
    pub spectrum_db: Vec<f64>,
    pub output_sample_rate_hz: Option<u32>,
    pub output_channels: Option<String>,
    pub output_device: Option<String>,
    pub output_backend: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all="camelCase")]
pub struct VirtualAudioDevice {
    pub name: String,
    pub description: String,
    pub kind: String,
    pub product: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all="camelCase")]
pub struct BroadcastTargets {
    pub devices: Vec<VirtualAudioDevice>,
    pub install_product: String,
    pub install_url: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default, rename_all="camelCase")]
pub struct BroadcastStatus {
    pub active: bool,
    pub device: Option<String>,
    pub product: Option<String>,
    pub track_id: Option<String>,
    pub drift_ms: Option<f64>,
}

fn module(command: serde_json::Value) -> Result<serde_json::Value,String> {
    m3u::module_request(command)
        .unwrap_or_else(||Err("Music native component is not installed. Repair Music in Shipyard.".into()))
}

async fn request(command: serde_json::Value) -> Result<serde_json::Value,String> {
    m3u::module_request_async(command).await
}

fn devices_as_targets(devices:&[crate::mpv::AudioDevice])->Vec<VirtualAudioDevice>{
    const MATCHES:[(&str,&str,&str);12]=[
        ("voicemeeter","voicemeeter","VoiceMeeter"),
        ("cable input","vb-cable","VB-Audio Virtual Cable"),
        ("virtual audio cable","virtual-audio-cable","Virtual Audio Cable"),
        ("vb-audio","vb-cable","VB-Audio Virtual Cable"),
        ("blackhole","blackhole","BlackHole"),
        ("loopback audio","loopback","Loopback"),
        ("soundflower","soundflower","Soundflower"),
        ("null output","null-sink","Null sink"),
        ("null-sink","null-sink","Null sink"),
        ("null_sink","null-sink","Null sink"),
        ("virtual sink","null-sink","Virtual sink"),
        ("virtual-sink","null-sink","Virtual sink"),
    ];
    devices.iter().filter_map(|dev|{
        if dev.name=="null" || dev.name.starts_with("null/") {return None;}
        let haystack=format!("{} {}",dev.name,dev.description).to_ascii_lowercase();
        let (_,kind,product)=MATCHES.iter().find(|(needle,_,_)|haystack.contains(needle))?;
        Some(VirtualAudioDevice {
            name:dev.name.clone(),description:dev.description.clone(),
            kind:kind.to_string(),product:product.to_string()
        })
    }).collect()
}

fn hint()->(&'static str,&'static str){
    #[cfg(target_os="windows")]
    {("VB-Audio Virtual Cable","https://vb-audio.com/Cable/")}
    #[cfg(target_os="macos")]
    {("BlackHole","https://existential.audio/blackhole/")}
    #[cfg(not(any(target_os="windows",target_os="macos")))]
    {("a PulseAudio or PipeWire null sink","https://wiki.archlinux.org/title/PipeWire")}
}

pub(in crate::music) fn listened_increment(previous:Option<f64>,current:f64)->f64{
    let Some(previous)=previous else{return 0.0};
    let delta=current-previous;
    if current.is_finite() && delta.is_finite() && delta>0.0 && delta<=2.0 {delta}else{0.0}
}

pub(in crate::music) fn should_scrobble(listened:f64,duration:f64)->bool{
    let threshold=if duration.is_finite() && duration>0.0 {
        (duration*0.5).min(240.0)
    }else{240.0};
    listened>=threshold
}

pub struct MusicEngine {
    audio:Mutex<MusicAudioSettings>,
    audio_path:Mutex<Option<PathBuf>>,
    primary:AtomicUsize,
    crossfade:Mutex<f64>,
    meter:AtomicBool,
    paused_for_video:AtomicBool,
    source:Mutex<Option<String>>,
}

impl MusicEngine {
    pub fn new()->Self{
        Self {
            audio:Mutex::new(MusicAudioSettings::default()),
            audio_path:Mutex::new(None),primary:AtomicUsize::new(0),
            crossfade:Mutex::new(-1.0),meter:AtomicBool::new(false),
            paused_for_video:AtomicBool::new(false),source:Mutex::new(None),
        }
    }

    pub fn initialize_audio(&self,path:PathBuf){
        let settings=std::fs::read(&path).ok().filter(|bytes|bytes.len()<=8192)
            .and_then(|bytes|serde_json::from_slice::<MusicAudioSettings>(&bytes).ok())
            .unwrap_or_default().normalized();
        if let Ok(mut value)=self.audio.lock(){*value=settings;}
        if let Ok(mut value)=self.audio_path.lock(){*value=Some(path);}
    }

    pub fn audio_settings(&self)->Result<MusicAudioSettings,String>{
        self.audio.lock().map(|value|value.clone())
            .map_err(|_|"Music audio settings unavailable".to_string())
    }

    fn persist(&self,settings:&MusicAudioSettings)->Result<(),String>{
        let path=self.audio_path.lock().map_err(|_|"Music storage unavailable")?
            .clone().ok_or("Music storage is not ready")?;
        let bytes=serde_json::to_vec(settings).map_err(|e|e.to_string())?;
        let tmp=path.with_extension("json.tmp");
        std::fs::write(&tmp,bytes).map_err(|e|e.to_string())?;
        std::fs::rename(&tmp,&path).map_err(|e|e.to_string())
    }

    pub async fn audio_devices(&self)->Result<Vec<crate::mpv::AudioDevice>,String>{
        core_setup::read_music_audio_devices(&core_setup::probe_core()?)
    }

    pub async fn set_audio_settings(&self,settings:MusicAudioSettings)
        ->Result<MusicAudioSettings,String>{
        let mut new=settings.normalized();
        if new.device!="auto" && !self.audio_devices().await?.iter().any(|x|x.name==new.device){
            return Err("Selected music output is unavailable".into());
        }
        let previous=self.audio_settings()?;
        new.broadcast_enabled=previous.broadcast_enabled;
        new.broadcast_device=previous.broadcast_device.clone();
        let applied:MusicAudioSettings=serde_json::from_value(request(json!({
            "command":"mpv_audio_settings_set","settings":new
        })).await?).map_err(|e|e.to_string())?;
        if let Err(error)=self.persist(&applied) {
            let _=request(json!({"command":"mpv_audio_settings_set","settings":previous})).await;
            return Err(error);
        }
        *self.audio.lock().map_err(|_|"Music audio settings unavailable")?=applied.clone();
        Ok(applied)
    }

    pub async fn play(&self,_app:AppHandle,stream:MusicStream,track:MusicTrack,volume:f64)
        ->Result<(),String>{

        let settings=self.audio_settings()?;
        request(json!({"command":"mpv_audio_settings_set","settings":settings})).await?;
        request(json!({"command":"mpv_play","deck":self.primary_deck(),
            "url":stream.url,"track_id":track.id,"connector_id":track.connector_id,
            "volume":settings.clamp_volume(volume),"headers":stream.http_headers})).await?;
        if let Ok(mut source)=self.source.lock(){*source=Some(stream.url);}
        m3u::playback_started(&track);
        Ok(())
    }

    pub fn primary_deck(&self)->usize{self.primary.load(Ordering::SeqCst).min(1)}

    pub async fn set_primary_deck(&self,index:usize)->bool{
        if index>1 || index==self.primary_deck(){return false;}
        let decks=self.deck_states().await;
        if !decks.get(index).is_some_and(|value|value.live) {return false;}
        if index==1 && self.broadcast_status().await.active {return false;}
        self.primary.store(index,Ordering::SeqCst);
        true
    }

    pub async fn pause_for_video(&self)->Result<bool,String>{
        let state=self.deck_state(self.primary_deck()).await?;
        if !state.live || state.paused{return Ok(false);}
        self.set_paused(true).await?;
        self.paused_for_video.store(true,Ordering::SeqCst);
        Ok(true)
    }

    pub fn paused_for_video(&self)->bool{self.paused_for_video.load(Ordering::SeqCst)}

    pub async fn resume_after_video(&self)->Result<(),String>{
        if self.paused_for_video.swap(false,Ordering::SeqCst){
            self.set_paused(false).await?;
        }
        Ok(())
    }

    pub async fn set_paused(&self,paused:bool)->Result<(),String>{
        self.paused_for_video.store(false,Ordering::SeqCst);
        self.deck_pause(self.primary_deck(),paused).await
    }

    pub async fn seek(&self,position:f64)->Result<(),String>{
        self.deck_seek(self.primary_deck(),position).await
    }

    pub async fn set_volume(&self,volume:f64)->Result<(),String>{
        self.deck_volume(self.primary_deck(),volume).await
    }

    pub async fn set_loop(&self,start:Option<f64>,end:Option<f64>)->Result<(),String>{
        request(json!({"command":"mpv_loop","deck":self.primary_deck(),
            "start":start,"end":end})).await.map(|_|())
    }

    pub async fn scratch(&self,position:f64,rate:f64,holding:bool)->Result<f64,String>{
        request(json!({"command":"mpv_scratch","deck":self.primary_deck(),
            "position":position,"rate":rate,"holding":holding}))
            .await?.as_f64().ok_or("Music native scratch response invalid".into())
    }

    pub async fn set_muted(&self,muted:bool)->Result<(),String>{
        request(json!({"command":"mpv_mute","deck":self.primary_deck(),
            "muted":muted})).await.map(|_|())
    }

    pub async fn source_path(&self)->Option<String>{
        self.source.lock().ok()?.clone()
    }

    pub async fn stop(&self,unpause:bool)->Result<(),String>{
        if unpause {return self.resume_after_video().await;}
        self.deck_stop(self.primary_deck()).await?;
        if let Ok(mut source)=self.source.lock(){*source=None;}
        Ok(())
    }

    pub fn shutdown(&self){
        // music::shutdown drops the existing native host after this call.
        // Do not start a previously unused Music module merely to stop it.
    }

    pub async fn deck_play(&self,app:AppHandle,index:usize,stream:MusicStream,
        track:MusicTrack,volume:f64)->Result<(),String>{
        if index==self.primary_deck(){return self.play(app,stream,track,volume).await;}
        if index>1{return Err("Unknown music deck".into());}

        request(json!({"command":"mpv_play","deck":index,"url":stream.url,
            "track_id":track.id,"connector_id":track.connector_id,
            "volume":self.audio_settings()?.clamp_volume(volume),"headers":stream.http_headers})).await.map(|_|())
    }

    pub async fn deck_pause(&self,index:usize,paused:bool)->Result<(),String>{
        request(json!({"command":"mpv_pause","deck":index,"paused":paused})).await.map(|_|())
    }
    pub async fn deck_seek(&self,index:usize,position:f64)->Result<(),String>{
        request(json!({"command":"mpv_seek","deck":index,"seconds":position})).await.map(|_|())
    }
    pub async fn deck_volume(&self,index:usize,volume:f64)->Result<(),String>{
        request(json!({"command":"mpv_volume","deck":index,
            "volume":self.audio_settings()?.clamp_volume(volume)})).await.map(|_|())
    }
    pub async fn deck_stop(&self,index:usize)->Result<(),String>{
        request(json!({"command":"mpv_stop","deck":index})).await.map(|_|())
    }

    async fn deck_state(&self,index:usize)->Result<MusicDeckState,String>{
        serde_json::from_value(request(json!({"command":"mpv_state","deck":index})).await?)
            .map_err(|e|e.to_string())
    }

    pub async fn deck_states(&self)->Vec<MusicDeckState>{
        let mut states=Vec::new();
        for index in 0..2 {
            states.push(self.deck_state(index).await.unwrap_or(MusicDeckState{
                deck:index as u8,..MusicDeckState::default()
            }));
        }
        states
    }

    pub async fn set_meter_enabled(&self,enabled:bool)->Result<(),String>{
        request(json!({"command":"mpv_meter_set","enabled":enabled})).await?;
        self.meter.store(enabled,Ordering::SeqCst);
        Ok(())
    }

    pub async fn meter_snapshot(&self)->Option<MusicMeterSnapshot>{
        if !self.meter.load(Ordering::SeqCst){return None;}
        let data=request(json!({"command":"mpv_meter_snapshot",
            "deck":self.primary_deck()})).await.ok()?;
        serde_json::from_value(data).ok()
    }

    pub fn crossfade(&self)->f64{self.crossfade.lock().map(|v|*v).unwrap_or(-1.0)}

    pub async fn heal_crossfade(&self){
        if !self.deck_states().await.get(1).is_some_and(|v|v.live){
            let _=self.set_crossfade(-1.0).await;
        }
    }

    pub async fn set_crossfade(&self,position:f64)->Result<(),String>{
        if !position.is_finite(){return Err("Crossfader position is invalid".into());}
        let position=position.clamp(-1.0,1.0);
        request(json!({"command":"mpv_crossfade","position":position})).await?;
        if let Ok(mut value)=self.crossfade.lock(){*value=position;}
        if position>=0.35 {let _=self.set_primary_deck(1).await;}
        if position<=-0.35 {let _=self.set_primary_deck(0).await;}
        Ok(())
    }

    pub async fn broadcast_targets(&self)->Result<BroadcastTargets,String>{
        let devices=self.audio_devices().await?;
        let (product,url)=hint();
        Ok(BroadcastTargets{
            devices:devices_as_targets(&devices),
            install_product:product.to_string(),
            install_url:url.to_string(),
        })
    }

    pub async fn broadcast_status(&self)->BroadcastStatus{
        request(json!({"command":"mpv_broadcast_status"})).await.ok()
            .and_then(|data|serde_json::from_value(data).ok()).unwrap_or_default()
    }

    async fn persist_broadcast(&self,enabled:bool,device:Option<String>)->Result<(),String>{
        let mut settings=self.audio_settings()?;
        settings.broadcast_enabled=enabled;
        if let Some(device)=device{settings.broadcast_device=device;}
        self.persist(&settings)?;
        *self.audio.lock().map_err(|_|"Music audio settings unavailable")?=settings;
        Ok(())
    }

    pub async fn start_broadcast(&self,_app:AppHandle,device:Option<String>)
        ->Result<BroadcastStatus,String>{
        let targets=self.broadcast_targets().await?;
        let device=device.or_else(||targets.devices.first().map(|x|x.name.clone()))
            .ok_or("No virtual audio device was found")?;
        if !targets.devices.iter().any(|x|x.name==device){
            return Err("That broadcast output is no longer available".into());
        }
        let result:BroadcastStatus=serde_json::from_value(
            request(json!({"command":"mpv_broadcast_start","device":device})).await?
        ).map_err(|e|e.to_string())?;
        if let Err(error)=self.persist_broadcast(true,Some(device)).await {
            let _=request(json!({"command":"mpv_broadcast_stop"})).await;
            return Err(error);
        }
        Ok(result)
    }

    pub async fn stop_broadcast(&self)->Result<BroadcastStatus,String>{
        let response:BroadcastStatus=serde_json::from_value(
            request(json!({"command":"mpv_broadcast_stop"})).await?
        ).map_err(|e|e.to_string())?;
        self.persist_broadcast(false,None).await?;
        Ok(response)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn scrobble_threshold_matches_existing_engine(){
        assert!(should_scrobble(31.0,60.0));
        assert!(!should_scrobble(29.0,60.0));
        assert!(!should_scrobble(239.0,1200.0));
        assert_eq!(listened_increment(Some(1.0),2.0),1.0);
    }
}
