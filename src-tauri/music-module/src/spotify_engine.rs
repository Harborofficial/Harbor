//! Experimental Spotify Premium playback session outside of Harbor Core.
//! The app remains the sole owner of the existing secrets and user data.
//! Credentials arrive through an inherited stdin pipe, never a command line.
use librespot_core::authentication::Credentials;
use librespot_core::cache::Cache;
use librespot_core::config::SessionConfig;
use librespot_core::session::Session;
use librespot_core::SpotifyUri;
use librespot_playback::audio_backend;
use librespot_metadata::audio::{AudioFileFormat,AudioFiles};
use crate::spotify_meter::{SpotifyMeter, MeteredSink};
use crate::meter::{MusicMeterChannel,MusicMeterSnapshot};
use librespot_playback::config::{AudioFormat, Bitrate, PlayerConfig};
use librespot_playback::mixer::softmixer::SoftMixer;
use librespot_playback::mixer::{Mixer, MixerConfig};
use librespot_playback::player::{Player, PlayerEvent};
use serde::Serialize;
use serde_json::json;
use std::path::Path;
use std::sync::{Arc, Mutex, atomic::{AtomicBool, Ordering}};
use std::time::Duration;
use crate::mpv_engine::emit_event;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all="camelCase")]
pub struct PlaybackState {
    pub live: bool,
    pub connected: bool,
    pub paused: bool,
    pub track_id: Option<String>,
    pub position_seconds: Option<f64>,
}

#[derive(Default)]
struct Current {
    id: Option<String>,
    source: Option<String>,
    position: Option<f64>,
}

pub struct SpotifyEngine {
    executor: tokio::runtime::Runtime,
    session: Option<Session>,
    player: Option<Arc<Player>>,
    mixer: Option<Arc<dyn Mixer>>,
    current: Arc<Mutex<Current>>,
    paused: Arc<AtomicBool>,
    meter: Arc<SpotifyMeter>,
}

fn create_session(
    executor: &tokio::runtime::Runtime,
    config: SessionConfig,
    cache: Cache,
) -> Session {
    executor.block_on(async move { Session::new(config, Some(cache)) })
}

fn quality_for(files:&AudioFiles)->Option<(&'static str,u32)> {
    const ORDER:[AudioFileFormat;7]=[
        AudioFileFormat::OGG_VORBIS_320,AudioFileFormat::MP3_320,
        AudioFileFormat::MP3_256,AudioFileFormat::OGG_VORBIS_160,
        AudioFileFormat::MP3_160,AudioFileFormat::OGG_VORBIS_96,
        AudioFileFormat::MP3_96
    ];
    let format=*ORDER.iter().find(|format|files.contains_key(*format))?;
    Some(match format{
        AudioFileFormat::OGG_VORBIS_320=>("vorbis",320),
        AudioFileFormat::MP3_320=>("mp3",320),
        AudioFileFormat::MP3_256=>("mp3",256),
        AudioFileFormat::OGG_VORBIS_160=>("vorbis",160),
        AudioFileFormat::MP3_160=>("mp3",160),
        AudioFileFormat::OGG_VORBIS_96=>("vorbis",96),
        AudioFileFormat::MP3_96=>("mp3",96),
        _=>return None
    })
}

impl SpotifyEngine {
    pub fn new() -> Result<Self,String> {
        let executor=tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2).enable_all().build().map_err(|e|e.to_string())?;
        Ok(Self {
            executor, session:None, player:None, mixer:None,
            current:Arc::new(Mutex::new(Current::default())),
            paused:Arc::new(AtomicBool::new(true)),
            meter:Arc::new(SpotifyMeter::new()),
        })
    }

    pub fn connect(&mut self, credentials: &str, cache_path: &str, device_id: &str)
        -> Result<(),String> {
        if credentials.is_empty() || credentials.len()>64*1024 {
            return Err("Spotify session credentials are invalid".into());
        }
        let credentials:Credentials=serde_json::from_str(credentials)
            .map_err(|_|"Spotify session credentials are invalid".to_string())?;
        let root=Path::new(cache_path);
        if cache_path.trim().is_empty() || !root.is_absolute() {
            return Err("Spotify cache path must be absolute".into());
        }
        let audio=root.join("audio");
        std::fs::create_dir_all(&audio).map_err(|e|e.to_string())?;
        let cache=Cache::new(
            Some(root.to_path_buf()),Some(root.to_path_buf()),
            Some(audio),Some(2*1024*1024*1024),
        ).map_err(|e|e.to_string())?;
        let mut config=SessionConfig::default();
        if !device_id.trim().is_empty() && device_id.len()<=128 {
            config.device_id=device_id.to_string();
        }
        // librespot stores the current Tokio handle when the session is created and
        // spawns its socket tasks on that runtime, so creation and connect must run
        // inside this engine's runtime rather than on the synchronous serve thread.
        let session=create_session(&self.executor,config,cache);
        self.executor.block_on(session.connect(credentials,true))
            .map_err(|e|format!("Spotify sign-in failed: {e}"))?;
        if session.is_invalid() {
            return Err("Spotify session is invalid".into());
        }
        // A known Free account must never be presented as playable by librespot.
        if session.get_user_attribute("type").is_some_and(|tier|
            tier.to_ascii_lowercase()!="premium") {
            session.shutdown();
            return Err("Spotify Premium is required for local playback".into());
        }
        let mixer:Arc<dyn Mixer>=Arc::new(
            SoftMixer::open(MixerConfig::default())
                .map_err(|e|format!("Spotify mixer unavailable: {e}"))?
        );
        let sink_builder=audio_backend::find(None)
            .ok_or_else(||"No Spotify audio output available".to_string())?;
        let meter=self.meter.clone();
        let player=Player::new(PlayerConfig {
            bitrate:Bitrate::Bitrate320,
            gapless:true,
            position_update_interval:Some(Duration::from_millis(250)),
            ..Default::default()
        },session.clone(),mixer.get_soft_volume(),move|| {
            Box::new(MeteredSink::new(sink_builder(None, AudioFormat::F32),meter.clone()))
        });
        self.disconnect();
        let current=self.current.clone();
        let paused=self.paused.clone();
        let mut events=player.get_player_event_channel();
        self.executor.spawn(async move {
            while let Some(event)=events.recv().await {
                match event {
                    PlayerEvent::TrackChanged{audio_item}=>{
                        if let Ok(current)=current.lock(){
                            if current.source.as_deref()==Some(audio_item.uri.as_str()){
                                if let Some((codec,bitrate))=quality_for(&audio_item.files){
                                    emit_event(json!({"event":"audio-quality",
                                        "trackId":current.id,"connectorId":"spotify",
                                        "quality":{"codec":codec,"sampleRateHz":librespot_playback::SAMPLE_RATE,
                                            "bitrateKbps":bitrate}
                                    }));
                                }
                            }
                        }
                    },
                    PlayerEvent::Playing{position_ms,..}=>{
                        paused.store(false,Ordering::SeqCst);
                        if let Ok(mut current)=current.lock(){
                            current.position=Some(position_ms as f64 / 1000.0);
                            let id=current.id.clone();
                            emit_event(json!({"event":"file-loaded","trackId":id,"connectorId":"spotify"}));
                            emit_event(json!({"event":"property-change","name":"pause","data":false,
                                "trackId":id,"connectorId":"spotify"}));
                        }
                    },
                    PlayerEvent::Paused{position_ms,..}=>{
                        paused.store(true,Ordering::SeqCst);
                        if let Ok(mut current)=current.lock() {
                            current.position=Some(position_ms as f64 / 1000.0);
                            emit_event(json!({"event":"property-change","name":"pause","data":true,
                                "trackId":current.id,"connectorId":"spotify"}));
                        }
                    },
                    PlayerEvent::PositionChanged{position_ms,..}
                    |PlayerEvent::PositionCorrection{position_ms,..}
                    |PlayerEvent::Seeked{position_ms,..}=>{
                        if let Ok(mut current)=current.lock() {
                            current.position=Some(position_ms as f64 / 1000.0);
                            emit_event(json!({"event":"property-change","name":"time-pos",
                                "data":position_ms as f64 / 1000.0,
                                "trackId":current.id,"connectorId":"spotify"}));
                        }
                    },
                    PlayerEvent::EndOfTrack{..}=>{
                        let track=current.lock().ok().and_then(|v|v.id.clone());
                        emit_event(json!({"event":"end-file","reason":"eof",
                            "trackId":track,"connectorId":"spotify"}));
                    },
                    PlayerEvent::Unavailable{..}=>{
                        emit_event(json!({"event":"player-failure","reason":"Spotify track unavailable",
                            "connectorId":"spotify"}));
                    },
                    _=>{}
                }
            }
        });
        self.session=Some(session);
        self.mixer=Some(mixer);
        self.player=Some(player);
        self.paused.store(true,Ordering::SeqCst);
        Ok(())
    }

    pub fn play(&mut self, source_id:&str, track_id:&str, volume:f64)
        -> Result<(),String> {
        if !volume.is_finite() || !(0.0..=6.0).contains(&volume) {
            return Err("Spotify volume is invalid".into());
        }
        let uri=SpotifyUri::from_uri(source_id)
            .map_err(|e|format!("Invalid Spotify URI: {e}"))?;
        let player=self.player.as_ref()
            .ok_or_else(||"Connect Spotify Premium first".to_string())?;
        if let Some(mixer)=&self.mixer {
            mixer.set_volume((volume.min(1.0)*65535.0) as u16);
        }
        if let Ok(mut current)=self.current.lock(){
            current.id=Some(track_id.to_owned());
            current.source=Some(source_id.to_owned());
            current.position=Some(0.0);
        }
        self.meter.reset();
        {
            // Player::load takes Handle::current() before it spawns its loader thread.
            let _runtime=self.executor.enter();
            player.load(uri,true,0);
        }
        self.paused.store(false,Ordering::SeqCst);
        Ok(())
    }

    pub fn preload(&self, source_id:&str)->Result<(),String>{
        let uri=SpotifyUri::from_uri(source_id)
            .map_err(|e|format!("Invalid Spotify URI: {e}"))?;
        let player=self.player.as_ref()
            .ok_or_else(||"Spotify player unavailable".to_string())?;
        // Same Handle::current() requirement as Player::load.
        let _runtime=self.executor.enter();
        player.preload(uri);
        Ok(())
    }

    pub fn pause(&mut self, paused:bool) {
        if let Some(player)=&self.player {
            if paused {player.pause();} else {player.play();}
        }
        self.paused.store(paused,Ordering::SeqCst);
    }

    pub fn seek(&mut self,seconds:f64)->Result<(),String>{
        if !seconds.is_finite() || seconds<0.0 {return Err("Spotify seek is invalid".into())}
        if let Some(player)=&self.player {
            player.seek((seconds*1000.0).min(u32::MAX as f64) as u32);
        }
        Ok(())
    }

    pub fn volume(&mut self,volume:f64)->Result<(),String>{
        if !volume.is_finite() || !(0.0..=1.0).contains(&volume) {
            return Err("Spotify volume is invalid".into())
        }
        if let Some(mixer)=&self.mixer {
            mixer.set_volume((volume*65535.0) as u16);
        }
        Ok(())
    }

    pub fn stop(&mut self){
        if let Some(player)=&self.player {player.stop();}
        if let Ok(mut current)=self.current.lock() {*current=Current::default();}
        self.paused.store(true,Ordering::SeqCst);
    }

    pub fn set_meter_enabled(&self,enabled:bool) {
        self.meter.set_enabled(enabled);
    }

    pub fn meter_snapshot(&self)->Option<MusicMeterSnapshot> {
        let current=self.current.lock().ok()?;
        let id=current.id.as_ref()?;
        let reading=self.meter.reading();
        let offset=self.mixer.as_ref().map(|mixer|{
            let value=mixer.get_soft_volume().attenuation_factor();
            if value.is_finite() && value>0.0 && value<1.0 {
                (-20.0*value.log10()).clamp(0.0,60.0)
            } else {0.0}
        }).unwrap_or(0.0);
        let lifted=|db:f64|if db<=-120.0{-120.0}else{(db+offset).clamp(-120.0,24.0)};
        Some(MusicMeterSnapshot {
            track_id:id.clone(),connector_id:Some("spotify".into()),
            active:self.meter.running() && !self.paused.load(Ordering::SeqCst) && reading.seen,
            channels:reading.channels.into_iter().map(|v|MusicMeterChannel {
                rms_db:lifted(v.rms_db),peak_db:lifted(v.peak_db)
            }).collect(),
            spectrum_db:reading.spectrum.into_iter().map(lifted).collect(),
            output_sample_rate_hz:Some(librespot_playback::SAMPLE_RATE),
            output_channels:Some("stereo".into()),
            output_device:None,output_backend:Some("spotify".into()),
        })
    }

    pub fn state(&self)->PlaybackState{
        let current=self.current.lock().ok();
        PlaybackState{
            connected:self.session.as_ref().is_some_and(|session|!session.is_invalid()),
            live:current.as_ref().is_some_and(|c|c.id.is_some()) && self.player.is_some(),
            paused:self.paused.load(Ordering::SeqCst),
            track_id:current.as_ref().and_then(|c|c.id.clone()),
            position_seconds:current.as_ref().and_then(|c|c.position),
        }
    }

    pub fn disconnect(&mut self){
        self.stop();
        if let Some(session)=self.session.take(){session.shutdown();}
        self.player=None;
        self.mixer=None;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_bad_credentials_without_touching_cache(){
        let mut engine=SpotifyEngine::new().unwrap();
        assert!(engine.connect("invalid", "C:/not-a-real-spotify-cache", "").is_err());
        assert!(!engine.state().live);
        assert!(engine.play("spotify:track:bad","id",0.5).is_err());
    }
    #[test]
    fn seek_and_volume_validate_numeric_input(){
        let mut engine=SpotifyEngine::new().unwrap();
        assert!(engine.seek(f64::NAN).is_err());
        assert!(engine.volume(f64::INFINITY).is_err());
    }
    #[test]
    fn session_creation_has_a_runtime_context() {
        // librespot's Session::new reads Handle::current(). The native module serves
        // commands on a plain thread, so this must run through its own runtime.
        let engine=SpotifyEngine::new().unwrap();
        let cache=Cache::new::<std::path::PathBuf>(None,None,None,None).unwrap();
        let session=create_session(&engine.executor,SessionConfig::default(),cache);
        assert!(!session.is_invalid());
        session.shutdown();
    }
}
