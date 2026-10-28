#![cfg_attr(all(windows, not(debug_assertions)), windows_subsystem = "windows")]

use std::io::{Read,Write,BufRead,BufReader};
use serde::{Serialize,Deserialize};
use harbor_music_module::{parse_file,render,MusicTrack};
use harbor_music_module::mpv_engine::MusicMpvEngine;
use harbor_music_module::spotify_engine::SpotifyEngine;
use std::cell::RefCell;
thread_local! { static ENGINE: RefCell<MusicMpvEngine> = RefCell::new(MusicMpvEngine::default()); }
thread_local! { static SPOTIFY: RefCell<SpotifyEngine> = RefCell::new(SpotifyEngine::new().expect("start Spotify runtime")); }
const ABI:u32=1;
#[derive(Deserialize)]
#[serde(tag="command",rename_all="snake_case")]
enum Request{Handshake,ParseM3u{path:String},RenderM3u{tracks:Vec<(MusicTrack,String)>},ReadTags{path:String,covers:String},BatchReadTags{paths:Vec<String>,covers:String},ReadAudioProperties{path:String},MpvPlay{deck:u8,url:String,track_id:String,connector_id:Option<String>,volume:f64,
        #[serde(default)]headers:std::collections::BTreeMap<String,String>},MpvPause{deck:u8,paused:bool},MpvSeek{deck:u8,seconds:f64},MpvVolume{deck:u8,volume:f64},MpvStop{deck:u8},MpvCrossfade{position:f64},MpvState{deck:u8},MpvLoop{deck:u8,start:Option<f64>,end:Option<f64>},MpvScratch{deck:u8,position:f64,rate:f64,holding:bool},MpvMute{deck:u8,muted:bool},MpvAudioSettingsGet,MpvAudioSettingsSet{settings:harbor_music_module::audio::MusicAudioSettings},MpvMeterSet{enabled:bool},MpvMeterSnapshot{deck:u8},MpvBroadcastStart{device:String},MpvBroadcastStop,MpvBroadcastStatus,
    SpotifyConnect{credentials:String,cache_path:String,device_id:String},
    SpotifyPlay{source_id:String,track_id:String,volume:f64},
    SpotifyPreload{source_id:String},
    SpotifyPause{paused:bool},
    SpotifySeek{seconds:f64},
    SpotifyVolume{volume:f64},
    SpotifyStop,SpotifyState,SpotifyDisconnect,SpotifyMeterSet{enabled:bool},SpotifyMeterSnapshot}
#[derive(Serialize)]
struct Reply{abi:u32,version:&'static str,ok:bool,data:Option<serde_json::Value>,error:Option<String>}
fn handle(req:Request)->Result<serde_json::Value,String>{
 match req{
  Request::Handshake=>Ok(serde_json::json!({"kind":"harbor-music","abi":ABI,"version":env!("CARGO_PKG_VERSION")})),
  Request::ParseM3u{path}=>serde_json::to_value(parse_file(&path)?).map_err(|e|e.to_string()),
  Request::RenderM3u{tracks}=>Ok(serde_json::json!(render(&tracks)?)),
  Request::ReadTags{path,covers}=>serde_json::to_value(harbor_music_module::tags::read(std::path::Path::new(&path),std::path::Path::new(&covers))?).map_err(|e|e.to_string()),
  Request::ReadAudioProperties{path}=>Ok(serde_json::json!(harbor_music_module::local_audio_properties(std::path::Path::new(&path)))),
  Request::MpvPlay{deck,url,track_id,connector_id,volume,headers}=>ENGINE.with(|host|host.borrow_mut().play(deck,&url,&track_id,connector_id.as_deref(),volume,&headers).map(|()|serde_json::Value::Null)),
  Request::MpvPause{deck,paused}=>ENGINE.with(|host|host.borrow_mut().paused(deck,paused).map(|()|serde_json::Value::Null)),
  Request::MpvSeek{deck,seconds}=>ENGINE.with(|host|host.borrow_mut().seek(deck,seconds).map(|()|serde_json::Value::Null)),
  Request::MpvVolume{deck,volume}=>ENGINE.with(|host|host.borrow_mut().volume(deck,volume).map(|()|serde_json::Value::Null)),
  Request::MpvStop{deck}=>ENGINE.with(|host|host.borrow_mut().stop(deck).map(|()|serde_json::Value::Null)),
  Request::MpvCrossfade{position}=>ENGINE.with(|host|host.borrow_mut().crossfade(position).map(|()|serde_json::Value::Null)),
  Request::MpvLoop{deck,start,end}=>ENGINE.with(|host|host.borrow_mut().set_loop(deck,start,end).map(|()|serde_json::Value::Null)),
  Request::MpvScratch{deck,position,rate,holding}=>ENGINE.with(|host|host.borrow_mut().scratch(deck,position,rate,holding).map(|v|serde_json::json!(v))),
  Request::MpvMute{deck,muted}=>ENGINE.with(|host|host.borrow_mut().mute(deck,muted).map(|()|serde_json::Value::Null)),
  Request::MpvBroadcastStart{device}=>ENGINE.with(|host|host.borrow_mut().broadcast_start(&device)),
  Request::MpvBroadcastStop=>ENGINE.with(|host|host.borrow_mut().broadcast_stop()),
  Request::MpvBroadcastStatus=>ENGINE.with(|host|Ok(host.borrow().broadcast_status())),
  Request::MpvMeterSet{enabled}=>ENGINE.with(|host|host.borrow_mut().meter_enabled(enabled).map(|()|serde_json::Value::Null)),
  Request::MpvMeterSnapshot{deck}=>ENGINE.with(|host|serde_json::to_value(host.borrow().meter_snapshot(deck)?).map_err(|e|e.to_string())),
  Request::MpvAudioSettingsGet=>ENGINE.with(|host|serde_json::to_value(host.borrow().settings()).map_err(|e|e.to_string())),
  Request::MpvAudioSettingsSet{settings}=>ENGINE.with(|host|serde_json::to_value(host.borrow_mut().set_settings(settings)?).map_err(|e|e.to_string())),
  Request::MpvState{deck}=>ENGINE.with(|host|serde_json::to_value(host.borrow().snapshot(deck)?).map_err(|e|e.to_string())),
  Request::SpotifyConnect{credentials,cache_path,device_id}=>SPOTIFY.with(|host|host.borrow_mut().connect(&credentials,&cache_path,&device_id).map(|()|serde_json::Value::Null)),
  Request::SpotifyPlay{source_id,track_id,volume}=>SPOTIFY.with(|host|host.borrow_mut().play(&source_id,&track_id,volume).map(|()|serde_json::Value::Null)),
  Request::SpotifyPreload{source_id}=>SPOTIFY.with(|host|host.borrow().preload(&source_id).map(|()|serde_json::json!(true))),
  Request::SpotifyPause{paused}=>SPOTIFY.with(|host|{host.borrow_mut().pause(paused);Ok(serde_json::Value::Null)}),
  Request::SpotifySeek{seconds}=>SPOTIFY.with(|host|host.borrow_mut().seek(seconds).map(|()|serde_json::Value::Null)),
  Request::SpotifyVolume{volume}=>SPOTIFY.with(|host|host.borrow_mut().volume(volume).map(|()|serde_json::Value::Null)),
  Request::SpotifyStop=>SPOTIFY.with(|host|{host.borrow_mut().stop();Ok(serde_json::Value::Null)}),
  Request::SpotifyMeterSet{enabled}=>SPOTIFY.with(|host|{host.borrow().set_meter_enabled(enabled);Ok(serde_json::Value::Null)}),
  Request::SpotifyMeterSnapshot=>SPOTIFY.with(|host|serde_json::to_value(host.borrow().meter_snapshot()).map_err(|e|e.to_string())),
  Request::SpotifyState=>SPOTIFY.with(|host|serde_json::to_value(host.borrow().state()).map_err(|e|e.to_string())),
  Request::SpotifyDisconnect=>SPOTIFY.with(|host|{host.borrow_mut().disconnect();Ok(serde_json::Value::Null)}),
  Request::BatchReadTags{paths,covers}=>{
   if paths.len()>64 {return Err("Music tag batch exceeds 64 tracks".into());}
   let covers=std::path::Path::new(&covers);
   let tracks:Vec<Option<harbor_music_module::tags::ScannedTrack>>=paths.iter()
    .map(|path|harbor_music_module::tags::read(std::path::Path::new(path),covers).ok())
    .collect();
   serde_json::to_value(tracks).map_err(|e|e.to_string())
  }
 }
}
#[cfg(test)]
mod tests {
 use super::*;
 #[test]
 fn handshake_reports_versioned_abi() {
  let value=handle(Request::Handshake).unwrap();
  assert_eq!(value["abi"],1);
  assert_eq!(value["version"],env!("CARGO_PKG_VERSION"));
 }
 #[test]
 fn tag_batch_has_a_strict_limit() {
  assert!(handle(Request::BatchReadTags {
   paths: vec![String::new();65], covers:String::new()
  }).is_err());
 }
 #[test]
 fn tag_batch_preserves_order_and_skips_bad_files() {
  let data=handle(Request::BatchReadTags {
   paths: vec!["not-a-real-media-file.flac".to_string();2],
   covers:std::env::temp_dir().to_string_lossy().into_owned()
  }).unwrap();
  assert_eq!(data,serde_json::json!([null,null]));
 }
 #[test]
 fn multiple_framed_requests_have_matching_responses() {
   let input = concat!(r#"{"command":"handshake"}"#,"\n",r#"{"command":"invalid"}"#,"\n",r#"{"command":"handshake"}"#,"\n").as_bytes();
   let mut output=Vec::new();
   serve(BufReader::new(&input[..]),&mut output).unwrap();
   let responses=String::from_utf8(output).unwrap();
   let lines:Vec<serde_json::Value>=responses.lines().map(|v|serde_json::from_str(v).unwrap()).collect();
   assert_eq!(lines.len(),3);
   assert_eq!(lines[0]["ok"],true);
   assert_eq!(lines[1]["ok"],false);
   assert_eq!(lines[2]["data"]["abi"],1);
 }
 #[test]
 fn empty_import_is_rejected() {
  assert!(handle(Request::ParseM3u{path:String::new()}).is_err());
 }
}
// Long-lived framed transport: each line is one JSON request and one reply.
// The app retains the one-shot mode during staged migration.
fn serve<R: BufRead, W: Write>(reader: R, mut writer: W) -> std::io::Result<()> {
    for line in reader.lines() {
        let line = line?;
        if line.len() > 16 * 1024 * 1024 {
            write_reply(&mut writer, Err("Request too large".into()))?;
            break;
        }
        let response = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            serde_json::from_str::<Request>(&line)
                .map_err(|error| error.to_string())
                .and_then(handle)
        }))
        .unwrap_or_else(|_| Err("Music command failed inside the native module".into()));
        write_reply(&mut writer, response)?;
        writer.flush()?;
    }
    Ok(())
}
fn write_reply<W: Write>(writer: &mut W, result: Result<serde_json::Value,String>) -> std::io::Result<()> {
    let reply=match result {
      Ok(data)=>Reply{abi:ABI,version:env!("CARGO_PKG_VERSION"),ok:true,data:Some(data),error:None},
      Err(error)=>Reply{abi:ABI,version:env!("CARGO_PKG_VERSION"),ok:false,data:None,error:Some(error)}
    };
    serde_json::to_writer(&mut *writer, &reply)?;
    writer.write_all(b"\n")
}
fn main(){
 if std::env::args().any(|arg|arg=="--serve") {
     let stdin=std::io::stdin();
     let stdout=std::io::stdout();
     let _=serve(BufReader::new(stdin.lock()),stdout.lock());
     return;
 }

 let mut input=Vec::new();
 let result:Result<serde_json::Value,String>=(||{
  std::io::stdin().take(16*1024*1024+1).read_to_end(&mut input).map_err(|e|e.to_string())?;
  if input.len()>16*1024*1024{return Err("Request too large".into());}
  handle(serde_json::from_slice(&input).map_err(|e|e.to_string())?)
 })();
 let reply=match result{
  Ok(data)=>Reply{abi:ABI,version:env!("CARGO_PKG_VERSION"),ok:true,data:Some(data),error:None},
  Err(error)=>Reply{abi:ABI,version:env!("CARGO_PKG_VERSION"),ok:false,data:None,error:Some(error)}
 };
 let _=std::io::stdout().write_all(&serde_json::to_vec(&reply).unwrap());
}
