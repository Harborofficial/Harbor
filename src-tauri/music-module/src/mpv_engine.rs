//! Experimental MPV music decks hosted outside of harbor.exe.
//! The Tauri command facade remains in the application until event transport and
//! audio settings parity are validated. Shared libmpv stays in the installer.
use libmpv2::{Mpv, Format};
use crate::audio::MusicAudioSettings;
use crate::{meter, spectrum};
use std::sync::Mutex;
use libmpv2::events::{Event, EventContext, PropertyData};
use std::sync::{Arc, atomic::{AtomicU64, Ordering}};
use serde_json::json;
use std::io::Write;
use std::ffi::{CString, c_char};

#[repr(transparent)]
pub(crate) struct NativeFlag(pub i32);
unsafe impl libmpv2::GetData for NativeFlag {
    fn get_format() -> libmpv2::Format { libmpv2::Format::Flag }
}
use serde::Serialize;

#[derive(Default)]
struct Deck {
    player: Option<Arc<Mpv>>,
    generation: Arc<AtomicU64>,
    track_id: Option<String>,
    connector_id: Option<String>,
    source_url: Option<String>,
    volume: f64,
    gain: f64,
    spectrum: Arc<Mutex<spectrum::Spectrum>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeckSnapshot {
    pub deck: u8,
    pub live: bool,
    pub track_id: Option<String>,
    pub connector_id: Option<String>,
    pub volume: f64,
    pub paused: Option<bool>,
    pub position_seconds: Option<f64>,
    pub duration_seconds: Option<f64>,
    pub gain: f64,
}

pub struct MusicMpvEngine {
    decks: [Deck; 2],
    crossfade: f64,
    settings: MusicAudioSettings,
    meter_enabled: bool,
    broadcast_device: Option<String>,
    broadcast_generation: Arc<AtomicU64>,
}

impl Default for MusicMpvEngine {
    fn default() -> Self {
        Self { decks: [
            Deck { volume: 0.82, gain: 1.0, ..Deck::default() },
            Deck { volume: 0.82, gain: 0.0, ..Deck::default() },
        ], crossfade: -1.0, settings: MusicAudioSettings::default(), meter_enabled: false, broadcast_device: None, broadcast_generation: Arc::new(AtomicU64::new(0)) }
    }
}

fn deck_index(deck: u8) -> Result<usize, String> {
    (deck <= 1).then_some(usize::from(deck))
        .ok_or_else(|| "Music deck must be 0 or 1".into())
}

fn checked_level(value: f64) -> Result<f64, String> {
    if !value.is_finite() || !(0.0..=6.0).contains(&value) {
        return Err("Music volume is invalid".into());
    }
    Ok(value)
}

pub(crate) fn mpv_argv_command(player:&Mpv,args:&[&str])->Result<(),String> {
    let args:Vec<CString>=args.iter().map(|s|CString::new(*s)
        .map_err(|_|"Invalid NUL in music command".to_string())).collect::<Result<_,_>>()?;
    let mut ptrs:Vec<*const c_char>=args.iter().map(|s|s.as_ptr()).collect();
    ptrs.push(std::ptr::null());
    // Native mpv command accepts a NULL-terminated array of arguments. CString
    // instances own the buffers until the synchronous function has returned.
    let status=unsafe{libmpv2_sys::mpv_command(player.ctx.as_ptr(),ptrs.as_mut_ptr())};
    if status<0 {Err(format!("Music mpv command failed: {status}"))} else {Ok(())}
}

fn apply_audio(player: &Mpv, settings: &MusicAudioSettings) -> Result<(),String> {
    let replay = if settings.dsp_bypass || settings.replay_gain=="off" {
        "no"
    } else {settings.replay_gain.as_str()};
    for (key,value) in [
        ("replaygain", replay), ("replaygain-clip","no"),
        ("replaygain-preamp","0"), ("replaygain-fallback","0"),
    ] {player.set_property(key,value).map_err(|e|format!("{key}: {e}"))?;}
    player.set_property("volume-max", settings.volume_limit*100.0)
        .map_err(|e|format!("Music volume ceiling: {e}"))?;
    let filter=settings.filter();
    player.set_property("af",filter.as_str())
        .map_err(|e|format!("Music DSP filters: {e}"))?;
    player.set_property("speed",settings.speed).map_err(|e|e.to_string())?;
    player.set_property("audio-pitch-correction",
        if settings.keep_pitch {"yes"} else {"no"}).map_err(|e|e.to_string())?;
    player.set_property("audio-exclusive",
        if settings.exclusive {"yes"} else {"no"}).map_err(|e|e.to_string())?;
    player.set_property("audio-samplerate",i64::from(settings.sample_rate))
        .map_err(|e|e.to_string())?;
    player.set_property("audio-device",settings.device.as_str())
        .map_err(|e|e.to_string())?;
    Ok(())
}

fn apply_stream_headers(player:&Mpv,headers:&std::collections::BTreeMap<String,String>)
    ->Result<(),String>{
    use libmpv2_sys::{mpv_format_MPV_FORMAT_NODE,mpv_format_MPV_FORMAT_NODE_ARRAY,
        mpv_format_MPV_FORMAT_STRING,mpv_node,mpv_node__bindgen_ty_1,mpv_node_list};
    if headers.len()>16 {return Err("Too many Music source headers".into());}
    let mut strings=Vec::new();
    for (name,value) in headers{
        if name.is_empty()||name.len()>128||value.len()>8192||
            !name.bytes().all(|c| c.is_ascii_alphanumeric() || c==b'-'||c==b'_')||
            value.chars().any(|c|c=='\r'||c=='\n'||c=='\0'){
            return Err("Music source headers are invalid".into());
        }
        if name.eq_ignore_ascii_case("user-agent"){
            player.set_property("user-agent",value.as_str()).map_err(|e|e.to_string())?;
        }else{
            strings.push(CString::new(format!("{name}: {value}")).map_err(|e|e.to_string())?);
        }
    }
    let mut nodes:Vec<mpv_node>=strings.iter().map(|v|mpv_node{
        u:mpv_node__bindgen_ty_1{string:v.as_ptr().cast_mut()},
        format:mpv_format_MPV_FORMAT_STRING
    }).collect();
    let mut list=mpv_node_list{num:nodes.len() as i32,
        values:if nodes.is_empty(){std::ptr::null_mut()}else{nodes.as_mut_ptr()},
        keys:std::ptr::null_mut()};
    let mut node=mpv_node{u:mpv_node__bindgen_ty_1{list:&mut list},
        format:mpv_format_MPV_FORMAT_NODE_ARRAY};
    let status=unsafe{libmpv2_sys::mpv_set_property(player.ctx.as_ptr(),
        b"http-header-fields\0".as_ptr().cast(),mpv_format_MPV_FORMAT_NODE,
        (&mut node as *mut mpv_node).cast())};
    if status<0{Err("Music source headers could not be applied".into())}else{Ok(())}
}

fn new_player(label: &str) -> Result<Mpv, String> {
    Mpv::with_initializer(|init| {
        for (key, value) in [
            ("title", label), ("audio-client-name", label),
            ("video", "no"), ("vo", "null"), ("force-window", "no"),
            ("terminal", "no"), ("idle", "yes"), ("keep-open", "yes"),
            ("ytdl", "no"), ("volume-max", "600"),
        ] {
            init.set_property(key, value)?;
        }
        // Automated functional probes must never seize the user's audio output.
        if std::env::var("HARBOR_MUSIC_TEST_NO_AUDIO").as_deref() == Ok("1") {
            init.set_property("ao", "null")?;
        }
        Ok(())
    }).map_err(|error| format!("Music module MPV: {error}"))
}

impl MusicMpvEngine {
    pub fn settings(&self) -> MusicAudioSettings {self.settings.clone()}

    pub fn set_settings(&mut self, settings: MusicAudioSettings) -> Result<MusicAudioSettings,String> {
        let updated=settings.normalized();
        // Apply to currently active decks before adopting the new settings.
        // If any update fails, restore the previous configuration.
        for (index,deck) in self.decks.iter().enumerate() {
            if let Some(player)=deck.player.as_ref() {
                let mut requested=updated.clone();
                if index==1 {
                    if let Some(device)=self.broadcast_device.as_ref() {
                        requested.device=device.clone();
                        requested.exclusive=false;
                    }
                }
                if let Err(error)=apply_audio(player,&requested) {
                    for old in &self.decks {
                        if let Some(player)=old.player.as_ref() {
                            let _=apply_audio(player,&self.settings);
                        }
                    }
                    return Err(error);
                }
            }
        }
        self.settings=updated.clone();
        Ok(updated)
    }

    pub fn play(&mut self, deck: u8, url: &str, track_id: &str, connector_id: Option<&str>, volume: f64,
        headers:&std::collections::BTreeMap<String,String>) -> Result<(), String> {
        let index = deck_index(deck)?;
        let volume = checked_level(volume)?;
        if index==1 && self.broadcast_device.is_some() {
            return Err("Deck B is carrying the broadcast".into());
        }
        if url.trim().is_empty() || url.len() > 16384 || url.contains('\0') {
            return Err("Music stream URL is invalid".into());
        }
        if track_id.len() > 1024 {
            return Err("Music track identifier too long".into());
        }
        // Stop the prior event loop before replacing its native session.
        let generation = self.decks[index].generation.fetch_add(1, Ordering::SeqCst) + 1;
        let player = new_player(if index == 0 { "Harbor Music" } else { "Harbor Music B" })?;
        apply_audio(&player,&self.settings)?;
        apply_stream_headers(&player,headers)?;
        if self.meter_enabled && index==0 {
            meter::set_enabled(&player,true)?;
        }
        player.set_property("volume", self.settings.clamp_volume(volume) * self.decks[index].gain * 100.0)
            .map_err(|e| format!("Music volume: {e}"))?;
        // libmpv2 command accepts an argument vector; the source string is kept
        // as a single argument rather than interpolated into a shell command.
        let player = Arc::new(player);
        let spectrum = Arc::new(Mutex::new(spectrum::Spectrum::default()));
        spawn_mpv_events(player.clone(), self.decks[index].generation.clone(), generation,
            track_id.to_owned(), connector_id.map(str::to_owned), deck, spectrum.clone())?;
        mpv_argv_command(&player, &["loadfile", url, "replace"])?;
        self.decks[index].player = Some(player);
        self.decks[index].track_id = Some(track_id.to_owned());
        self.decks[index].connector_id = connector_id.map(str::to_owned);
        self.decks[index].source_url=Some(url.to_owned());
        self.decks[index].volume = self.settings.clamp_volume(volume);
        self.decks[index].spectrum = spectrum;
        if index==0 {
            if let Some(device)=self.broadcast_device.clone() {
                self.broadcast_start(&device)?;
            }
        }
        Ok(())
    }

    pub fn meter_enabled(&mut self, enabled: bool) -> Result<(), String> {
        if self.meter_enabled == enabled {
            return Ok(());
        }
        for (index,deck) in self.decks.iter().enumerate() {
            if index==0 {
                if let Some(player)=&deck.player {
                    meter::set_enabled(player,enabled)?;
                }
            }
            if let Ok(mut spectrum)=deck.spectrum.lock() { spectrum.clear(); }
        }
        self.meter_enabled=enabled;
        Ok(())
    }

    pub fn meter_snapshot(&self, deck:u8) -> Result<Option<meter::MusicMeterSnapshot>,String> {
        let index=deck_index(deck)?;
        if !self.meter_enabled || index!=0 {return Ok(None);}
        let state=&self.decks[index];
        let (Some(player),Some(track_id))=(&state.player,&state.track_id) else {return Ok(None)};
        let mut snapshot=meter::snapshot(player,track_id,state.connector_id.as_deref());
        if snapshot.active {
            if let (Ok(spectrum),Ok(position))=(state.spectrum.lock(),player.get_property::<f64>("time-pos")) {
                snapshot.spectrum_db=spectrum.at(position);
            }
        }
        Ok(Some(snapshot))
    }

    pub fn broadcast_status(&self) -> serde_json::Value {
        let Some(device)=&self.broadcast_device else {
            return serde_json::json!({"active":false,"device":null,"product":null,"trackId":null,"driftMs":null});
        };
        let a=self.snapshot(0).ok();
        let b=self.snapshot(1).ok();
        let drift=match (a.as_ref().and_then(|a|a.position_seconds),b.as_ref().and_then(|b|b.position_seconds)) {
            (Some(a),Some(b))=>Some((b-a)*1000.0),
            _=>None
        };
        serde_json::json!({"active":true,"device":device,"product":null,
            "trackId":b.and_then(|v|v.track_id),"driftMs":drift})
    }

    pub fn broadcast_start(&mut self,device:&str)->Result<serde_json::Value,String>{
        if device.trim().is_empty() || device.len()>500 || device.chars().any(char::is_control) {
            return Err("Invalid Music broadcast output".into());
        }
        if self.broadcast_device.is_some(){self.broadcast_stop()?;}
        if self.decks[1].player.is_some(){
            return Err("Deck B is already playing. Stop it before broadcasting.".into());
        }
        let source=self.decks[0].source_url.clone();
        let track=self.decks[0].track_id.clone();
        let connector=self.decks[0].connector_id.clone();
        if let (Some(source),Some(track))=(source,track) {
            let player=new_player("Harbor Music Broadcast")?;
            let mut settings=self.settings.clone();
            settings.device=device.to_owned();
            settings.exclusive=false;
            apply_audio(&player,&settings)?;
            player.set_property("volume",self.decks[0].volume*100.0)
                .map_err(|e|e.to_string())?;
            let original=self.snapshot(0)?;
            let player=Arc::new(player);
            let generation=self.decks[1].generation.fetch_add(1,Ordering::SeqCst)+1;
            let spectrum=Arc::new(Mutex::new(spectrum::Spectrum::default()));
            spawn_mpv_events(player.clone(),self.decks[1].generation.clone(),generation,
                track.clone(),connector.clone(),1,spectrum.clone())?;
            mpv_argv_command(&player,&["loadfile",&source,"replace"])?;
            if let Some(position)=original.position_seconds.filter(|value|*value>0.05){
                let _=mpv_argv_command(&player,&["seek",&position.to_string(),"absolute"]);
            }
            if original.paused.unwrap_or(false){
                let _=player.set_property("pause",true);
            }
            self.decks[1].player=Some(player);
            self.decks[1].track_id=Some(track);
            self.decks[1].connector_id=connector;
            self.decks[1].source_url=Some(source);
            self.decks[1].spectrum=spectrum;
            self.decks[1].volume=self.decks[0].volume;
        }
        self.broadcast_device=Some(device.to_owned());
        let generation=self.broadcast_generation.fetch_add(1,Ordering::SeqCst)+1;
        if let (Some(source),Some(mirror))=(&self.decks[0].player,&self.decks[1].player){
            let active=self.broadcast_generation.clone();
            let source=source.clone();
            let mirror=mirror.clone();
            std::thread::spawn(move||{
                while active.load(Ordering::SeqCst)==generation {
                    std::thread::sleep(std::time::Duration::from_millis(250));
                    if active.load(Ordering::SeqCst)!=generation {break;}
                    let a=source.get_property::<f64>("time-pos").ok();
                    let b=mirror.get_property::<f64>("time-pos").ok();
                    let paused=source.get_property::<NativeFlag>("pause").ok().is_some_and(|v|v.0!=0);
                    let _=mirror.set_property("pause",paused);
                    if let (Some(a),Some(b))=(a,b){
                        if (a-b).abs()>0.15 && a>=0.0 && a.is_finite(){
                            let _=mpv_argv_command(&mirror,&["seek",&a.to_string(),"absolute+exact"]);
                        }
                    }
                }
            });
        }
        Ok(self.broadcast_status())
    }

    pub fn broadcast_stop(&mut self)->Result<serde_json::Value,String>{
        self.broadcast_generation.fetch_add(1,Ordering::SeqCst);
        if self.broadcast_device.is_some(){
            self.broadcast_device=None;
            self.stop(1)?;
        }
        Ok(self.broadcast_status())
    }

    pub fn paused(&mut self, deck: u8, paused: bool) -> Result<(), String> {
        let index = deck_index(deck)?;
        if let Some(player) = &self.decks[index].player {
            player.set_property("pause", paused).map_err(|e| e.to_string())?;
        }
        if index==0 && self.broadcast_device.is_some() {
            if let Some(player)=&self.decks[1].player {
                let _=player.set_property("pause",paused);
            }
        }
        Ok(())
    }

    pub fn seek(&mut self, deck: u8, seconds: f64) -> Result<(), String> {
        let index = deck_index(deck)?;
        if !seconds.is_finite() || seconds < 0.0 {
            return Err("Music seek position is invalid".into());
        }
        if let Some(player) = &self.decks[index].player {
            mpv_argv_command(player, &["seek", &seconds.to_string(), "absolute"])?;
        }
        if index==0 && self.broadcast_device.is_some() {
            if let Some(player)=&self.decks[1].player{
                let _=mpv_argv_command(player,&["seek",&seconds.to_string(),"absolute"]);
            }
        }
        Ok(())
    }

    pub fn set_loop(&mut self, deck: u8, start: Option<f64>, end: Option<f64>) -> Result<(), String> {
        let index=deck_index(deck)?;
        let point=|value:Option<f64>| -> Result<String,String> {
            match value {
                Some(v) if v.is_finite() && v>=0.0 => Ok(format!("{v:.3}")),
                None => Ok("no".into()),
                _ => Err("Music loop point invalid".into()),
            }
        };
        let start=point(start)?;
        let end=point(end)?;
        if let Some(player)=&self.decks[index].player {
            player.set_property("ab-loop-a",start.as_str()).map_err(|e|e.to_string())?;
            player.set_property("ab-loop-b",end.as_str()).map_err(|e|e.to_string())?;
        }
        Ok(())
    }

    pub fn scratch(&mut self, deck: u8, position: f64, rate: f64, holding: bool) -> Result<f64,String> {
        let index=deck_index(deck)?;
        if !position.is_finite() || position<0.0 || !rate.is_finite() {
            return Err("Music scratch input invalid".into());
        }
        let Some(player)=&self.decks[index].player else{return Ok(position)};
        let target=format!("{position:.3}");
        if holding {
            let _=player.set_property("audio-pitch-correction","no");
            let _=player.set_property("speed",rate.abs().clamp(0.25,4.0));
        } else {
            let _=player.set_property("speed",1.0);
        }
        mpv_argv_command(player,&["seek",target.as_str(),"absolute+exact"])?;
        Ok(player.get_property::<f64>("time-pos").unwrap_or(position))
    }

    pub fn mute(&mut self, deck:u8, muted:bool) -> Result<(),String> {
        let index=deck_index(deck)?;
        if let Some(player)=&self.decks[index].player {
            player.set_property("mute", if muted {"yes"} else {"no"})
                .map_err(|e|e.to_string())?;
        }
        Ok(())
    }

    pub fn volume(&mut self, deck: u8, volume: f64) -> Result<(), String> {
        let index = deck_index(deck)?;
        let volume = checked_level(volume)?;
        let state = &mut self.decks[index];
        if let Some(player) = &state.player {
            player.set_property("volume", volume * state.gain * 100.0)
                .map_err(|e| e.to_string())?;
        }
        state.volume = volume;
        Ok(())
    }

    pub fn stop(&mut self, deck: u8) -> Result<(), String> {
        let index = deck_index(deck)?;
        self.decks[index].generation.fetch_add(1, Ordering::SeqCst);
        self.decks[index].player = None;
        self.decks[index].track_id = None;
        self.decks[index].connector_id = None;
        self.decks[index].source_url=None;
        if index==0 && self.broadcast_device.is_some(){
            self.broadcast_generation.fetch_add(1,Ordering::SeqCst);
            self.stop(1)?;
        }
        Ok(())
    }

    pub fn crossfade(&mut self, position: f64) -> Result<(), String> {
        if !position.is_finite() || !(-1.0..=1.0).contains(&position) {
            return Err("Music crossfade position is invalid".into());
        }
        let left = if position <= 0.0 { 1.0 } else { 1.0 - position };
        let right = if position >= 0.0 { 1.0 } else { 1.0 + position };
        for (index, gain) in [left, right].into_iter().enumerate() {
            let state = &mut self.decks[index];
            if self.broadcast_device.is_some() && index==1 {continue;}
            if let Some(player) = &state.player {
                player.set_property("volume", state.volume * gain * 100.0)
                    .map_err(|e| e.to_string())?;
            }
            state.gain = gain;
        }
        self.crossfade = position;
        Ok(())
    }

    pub fn snapshot(&self, deck: u8) -> Result<DeckSnapshot, String> {
        let index = deck_index(deck)?;
        let state = &self.decks[index];
        let player = state.player.as_ref();
        Ok(DeckSnapshot {
            deck,
            live: player.is_some(),
            track_id: state.track_id.clone(),
            connector_id: state.connector_id.clone(),
            volume: state.volume,
            paused: player.and_then(|p| p.get_property::<NativeFlag>("pause").ok().map(|v| v.0 != 0)),
            position_seconds: player.and_then(|p| p.get_property::<f64>("time-pos").ok()),
            duration_seconds: player.and_then(|p| p.get_property::<f64>("duration").ok()),
            gain: state.gain,
        })
    }
}


// stderr is a distinct framed event channel. stdout remains request/reply only.
pub(crate) fn emit_event(payload: serde_json::Value) {
    let framed=json!({
        "kind":"music-event", "abi":1, "version":env!("CARGO_PKG_VERSION"),
        "channel":"music://event", "payload":payload
    });
    let stderr=std::io::stderr();
    let mut output=stderr.lock();
    if serde_json::to_writer(&mut output,&framed).is_ok() {
        let _=output.write_all(b"\n");
    }
}

fn spawn_mpv_events(
    player: Arc<Mpv>,
    active_generation: Arc<AtomicU64>,
    generation: u64,
    track_id: String,
    connector_id: Option<String>,
    deck: u8,
    spectrum: Arc<Mutex<spectrum::Spectrum>>,
) -> Result<(), String> {
    let mut context=EventContext::new(player.ctx);
    for (name,format,id) in [
        ("time-pos",Format::Double,1),("duration",Format::Double,2),
        ("pause",Format::Flag,3),("volume",Format::Double,4),
        ("eof-reached",Format::Flag,5),
    ] {
        context.observe_property(name,format,id)
            .map_err(|e|format!("Music event subscription: {e}"))?;
    }
    std::thread::spawn(move || {
        while active_generation.load(Ordering::SeqCst)==generation {
            let Some(Ok(event))=context.wait_event(0.25) else {continue};
            if let Event::LogMessage {prefix,text,..} = &event {
                if *prefix=="ffmpeg" {
                    if let Ok(mut value)=spectrum.lock(){value.ingest(text);}
                }
                continue;
            }
            if matches!(event,Event::Seek){
                if let Ok(mut value)=spectrum.lock(){value.clear();}
            }
            let output=match event {
                Event::FileLoaded=>Some(json!({"event":"file-loaded"})),
                Event::Seek=>Some(json!({"event":"seek"})),
                Event::EndFile(_)=>Some(json!({"event":"end-file","reason":"eof"})),
                Event::Shutdown=>break,
                Event::PropertyChange {name,change,..}=>{
                    let data=match change {
                        PropertyData::Flag(value)=>json!(value),
                        PropertyData::Double(value)=>json!(value),
                        PropertyData::Int64(value)=>json!(value),
                        PropertyData::Str(value)=>json!(value),
                        PropertyData::OsdStr(value)=>json!(value),
                        PropertyData::Node(_)=>continue,
                    };
                    Some(json!({"event":"property-change","name":name,"data":data}))
                },
                _=>None,
            };
            if let Some(mut output)=output {
                output["trackId"]=json!(track_id);
                output["connectorId"]=json!(connector_id);
                output["deck"]=json!(deck);
                emit_event(output);
            }
        }
    });
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_untrusted_input_before_opening_mpv() {
        let mut engine = MusicMpvEngine::default();
        assert!(engine.play(2, "http://example.test", "x", None, 0.5, &std::collections::BTreeMap::new()).is_err());
        assert!(engine.play(0, "", "x", None, 0.5, &std::collections::BTreeMap::new()).is_err());
        assert!(engine.play(0, "file.mp3", "x", None, f64::NAN, &std::collections::BTreeMap::new()).is_err());
        assert!(engine.seek(0, f64::INFINITY).is_err());
        assert!(engine.crossfade(2.0).is_err());
        assert!(!engine.snapshot(0).unwrap().live);
    }
    #[test]
    fn deck_gain_starts_on_a() {
        let engine = MusicMpvEngine::default();
        assert_eq!(engine.snapshot(0).unwrap().gain, 1.0);
        assert_eq!(engine.snapshot(1).unwrap().gain, 0.0);
    }
}
