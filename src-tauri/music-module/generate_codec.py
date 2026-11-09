from pathlib import Path
base=Path(__file__).resolve().parent
src=(base.parent/"src"/"music"/"m3u.rs").read_text(encoding="utf-8")
fragment=src[src.index("fn parse(content:"):src.index("#[cfg(test)]")]
fragment=fragment.replace("fn parse(content:", "pub fn parse(content:",1).replace("fn render(tracks:", "pub fn render(tracks:",1)
header='''use serde::{Serialize, Deserialize};
use std::path::{Path, PathBuf};
const MAX_M3U_TRACKS: usize = 5_000;
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all="camelCase")]
pub struct MusicTrack {
    pub explicit: Option<bool>, pub version: Option<String>, pub media_kind: Option<String>,
    pub id: String, pub connector_id: Option<String>, pub source_id: Option<String>,
    pub playback_url: Option<String>, pub title: String, pub artist: String,
    pub album: Option<String>, pub artwork: String, pub duration_seconds: u64,
    pub duration_label: String,
}
#[derive(Default)]
struct EntryMetadata { duration_seconds: u64, artist: Option<String>, title: Option<String> }
fn duration_label(s:u64)->String { format!("{}:{:02}",s/60,s%60) }
pub fn parse_file(raw:&str)->Result<Vec<MusicTrack>,String> {
 let path=PathBuf::from(raw.trim());
 if raw.trim().is_empty() { return Err("M3U import path is empty".into()); }
 let meta=std::fs::metadata(&path).map_err(|e|e.to_string())?;
 if !meta.is_file(){return Err("M3U import path is not a file".into());}
 if meta.len()>5*1024*1024{return Err("M3U file is larger than 5 MB".into());}
 let bytes=std::fs::read(&path).map_err(|e|e.to_string())?;
 parse(&String::from_utf8_lossy(&bytes),path.parent().unwrap_or_else(||Path::new(".")))
}
'''
(base/"src"/"lib.rs").write_text(header+fragment,encoding="utf-8")
