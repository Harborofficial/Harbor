use serde::{Serialize, Deserialize};
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
pub fn parse(content: &str, base: &Path) -> Result<Vec<MusicTrack>, String> {
    let mut tracks = Vec::new();
    let mut pending = EntryMetadata::default();
    for raw_line in content.lines() {
        let line = raw_line.trim().trim_start_matches('\u{feff}');
        if line.is_empty() {
            continue;
        }
        if let Some(value) = line.strip_prefix("#EXTINF:") {
            pending = parse_metadata(value);
            continue;
        }
        if line.starts_with('#') {
            continue;
        }
        if tracks.len() >= MAX_M3U_TRACKS {
            return Err("M3U file contains more than 5000 tracks".to_string());
        }
        let location = normalize_location(line, base)?;
        let title = pending
            .title
            .take()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| title_from_location(&location));
        let artist = pending
            .artist
            .take()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| "Unknown artist".to_string());
        let duration_seconds = pending.duration_seconds;
        pending = EntryMetadata::default();
        let connector = if location.contains("://") {
            "direct"
        } else {
            "local"
        };
        tracks.push(MusicTrack {
            explicit: None,
            version: None,
            media_kind: None,
            id: format!("m3u:{:016x}", stable_hash(&location)),
            connector_id: Some(connector.to_string()),
            source_id: Some(location.clone()),
            playback_url: Some(location),
            title,
            artist,
            album: None,
            artwork: String::new(),
            duration_seconds,
            duration_label: duration_label(duration_seconds),
        });
    }
    Ok(tracks)
}

fn parse_metadata(value: &str) -> EntryMetadata {
    let (duration, label) = value.split_once(',').unwrap_or((value, ""));
    let duration_seconds = duration.trim().parse::<i64>().unwrap_or(0).max(0) as u64;
    let label = label.trim();
    let (artist, title) = label
        .split_once(" - ")
        .map(|(artist, title)| {
            (
                Some(artist.trim().to_string()),
                Some(title.trim().to_string()),
            )
        })
        .unwrap_or((None, (!label.is_empty()).then(|| label.to_string())));
    EntryMetadata {
        duration_seconds,
        artist,
        title,
    }
}

fn normalize_location(location: &str, base: &Path) -> Result<String, String> {
    if location.contains("://") {
        let parsed =
            url::Url::parse(location).map_err(|_| "M3U contains an invalid URL".to_string())?;
        if !matches!(parsed.scheme(), "http" | "https" | "file") {
            return Err(format!(
                "M3U URL scheme is not supported: {}",
                parsed.scheme()
            ));
        }
        return Ok(parsed.to_string());
    }
    let path = PathBuf::from(location);
    let path = if path.is_absolute() {
        path
    } else {
        base.join(path)
    };
    Ok(path.to_string_lossy().to_string())
}

fn title_from_location(location: &str) -> String {
    if let Ok(url) = url::Url::parse(location) {
        if let Some(segment) = url.path_segments().and_then(|segments| segments.last()) {
            let title = segment
                .rsplit_once('.')
                .map(|item| item.0)
                .unwrap_or(segment);
            if !title.is_empty() {
                return title.to_string();
            }
        }
    }
    Path::new(location)
        .file_stem()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .unwrap_or("Untitled track")
        .to_string()
}

pub fn render(tracks: &[(MusicTrack, String)]) -> Result<String, String> {
    let mut output = String::from("#EXTM3U\n");
    for (track, url) in tracks {
        let url = url.trim();
        if url.is_empty() || url.contains(['\r', '\n']) {
            return Err(format!("{} has no exportable stream URL", track.title));
        }
        let artist = one_line(&track.artist);
        let title = one_line(&track.title);
        output.push_str(&format!(
            "#EXTINF:{},{} - {}\n{}\n",
            track.duration_seconds, artist, title, url
        ));
    }
    Ok(output)
}

fn one_line(value: &str) -> String {
    value.replace(['\r', '\n'], " ").trim().to_string()
}

fn input_path(raw: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(raw.trim());
    if raw.trim().is_empty() {
        return Err("M3U import path is empty".to_string());
    }
    Ok(path)
}

fn output_path(raw: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(raw.trim());
    if raw.trim().is_empty() || path.file_name().is_none() {
        return Err("M3U export path is invalid".to_string());
    }
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() && !parent.is_dir() {
            return Err("M3U export directory does not exist".to_string());
        }
    }
    Ok(path)
}

fn stable_hash(value: &str) -> u64 {
    value
        .as_bytes()
        .iter()
        .fold(0xcbf29ce484222325, |hash, byte| {
            (hash ^ u64::from(*byte)).wrapping_mul(0x100000001b3)
        })
}


pub mod tags;
#[path = "../../src/music/audio.rs"]
pub mod audio;
#[path = "../../src/music/spectrum.rs"]
pub mod spectrum;
pub mod meter;
pub mod mpv_engine;
#[path = "../../src/music/spotify/meter.rs"]
pub mod spotify_meter;
pub mod spotify_engine;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all="camelCase")]
pub struct LocalAudioProperties {
    pub bit_depth: Option<u8>,
    pub sample_rate_hz: Option<u32>,
    pub bitrate_kbps: Option<f64>,
}
pub fn local_audio_properties(path: &std::path::Path) -> Option<LocalAudioProperties> {
    use lofty::file::AudioFile;
    let tagged=lofty::probe::Probe::open(path).ok()?
        .guess_file_type().ok()?
        .options(lofty::config::ParseOptions::new()
            .read_tags(false).read_cover_art(false)).read().ok()?;
    let p=tagged.properties();
    Some(LocalAudioProperties {
        bit_depth:p.bit_depth().filter(|v| *v>0 && *v<=64),
        sample_rate_hz:p.sample_rate().filter(|v| *v>0 && *v<=3_072_000),
        bitrate_kbps:p.audio_bitrate().filter(|v| *v>0 && *v<=100_000).map(f64::from),
    })
}
