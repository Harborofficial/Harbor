//! Convert mpv's experimental dump-cache output into a verified, audio-only clip.
//! The cache recorder can write a substantial MKV while silently losing video packets
//! (notably B-frames without DTS). Never feed the raw recorder output to the matcher.

use std::collections::HashMap;
use std::path::PathBuf;
use std::time::Duration;

use serde::Serialize;
use tokio::process::Command;

const SAMPLE_RATE: f64 = 16_000.0;
const MIN_AUDIO_SECONDS: f64 = 43.0;
const MAX_AUDIO_SECONDS: u64 = 46;
const EXTRACTION_TIMEOUT_SECONDS: u64 = 30;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreparedCacheAudio {
    pub path: String,
    pub duration_sec: f64,
    pub start_sec: f64,
    pub subtitle_intervals: Option<Vec<(f64, f64)>>,
}

fn cache_dump_path(input: &str) -> Result<PathBuf, String> {
    let allowed_dir = std::fs::canonicalize(std::env::temp_dir().join("harbor-subs").join("live"))
        .map_err(|_| "cache-audio-temp-dir-unavailable")?;
    let source = std::fs::canonicalize(input).map_err(|_| "cache-audio-dump-missing")?;
    if source.parent() != Some(allowed_dir.as_path())
        || source.extension().and_then(|ext| ext.to_str()) != Some("mkv")
        || !source
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| name.starts_with("tap-"))
    {
        return Err("cache-audio-path-invalid".into());
    }
    Ok(source)
}

/// Normalize the *selected* stream to PCM, avoiding the muxer's broken video
/// packets and giving the matcher a clean, zero-based audio timeline.
/// The input must be Harbor's temporary cache dump, never an arbitrary path.
#[tauri::command]
pub async fn subsync_prepare_cache_audio(
    input: String,
    map_spec: Option<String>,
    session_id: Option<String>,
    anchor_input: String,
    requested_end_sec: f64,
    anchor_end_sec: f64,
    embedded_subtitles: Option<bool>,
) -> Result<PreparedCacheAudio, String> {
    if !requested_end_sec.is_finite()
        || !anchor_end_sec.is_finite()
        || anchor_end_sec < 0.0
        || !(1.0..=5.0).contains(&(requested_end_sec - anchor_end_sec))
    {
        return Err("cache-audio-timeline-invalid".into());
    }
    let input_path = cache_dump_path(&input)?;
    let anchor_path = cache_dump_path(&anchor_input)?;
    let (start_sec, movie_offset) = super::analysis_control::run(session_id.as_deref(), async {
        let deadline = tokio::time::Instant::now() + Duration::from_secs(25);
        let cached =
            tokio::time::timeout_at(deadline, packet_timeline(&input_path.to_string_lossy()))
                .await
                .map_err(|_| "cache-audio-timeline-cache-timeout".to_string())??;
        let anchor =
            tokio::time::timeout_at(deadline, packet_timeline(&anchor_path.to_string_lossy()))
                .await
                .map_err(|_| "cache-audio-timeline-cache-timeout".to_string())??;
        let start = verified_start(&cached, &anchor, requested_end_sec, anchor_end_sec)?;
        let first = cached.packets[0]
            .pts_time
            .as_ref()
            .and_then(|s| s.parse::<f64>().ok())
            .ok_or("cache-audio-timeline-invalid")?;
        Ok::<_, String>((start, start - first))
    })
    .await??;

    let subtitle_intervals = if embedded_subtitles == Some(true) {
        Some(
            super::analysis_control::run(session_id.as_deref(), async {
                tokio::time::timeout(
                    Duration::from_secs(25),
                    cached_subtitles(&input_path, movie_offset),
                )
                .await
                .map_err(|_| "cache-subtitle-timeout".to_string())?
            })
            .await??,
        )
    } else {
        None
    };

    let ffmpeg = crate::transcode::locate_ffmpeg().ok_or("ffmpeg-unavailable")?;
    let output_path = input_path.with_extension("wav");
    let selected_map = super::url_guard::safe_map_spec(map_spec.as_deref());

    let mut cmd = Command::new(ffmpeg);
    cmd.args([
        "-nostdin",
        "-hide_banner",
        "-loglevel",
        "error",
        "-fflags",
        "+genpts",
    ])
    .arg("-i")
    .arg(&input_path)
    .arg("-map")
    .arg(&selected_map)
    .args(["-vn", "-sn", "-dn", "-t"])
    .arg(MAX_AUDIO_SECONDS.to_string())
    .args([
        "-af",
        "asetpts=PTS-STARTPTS",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-c:a",
        "pcm_s16le",
        "-y",
    ])
    .arg(&output_path);
    cmd.kill_on_drop(true);
    #[cfg(windows)]
    cmd.creation_flags(0x0800_0000 | 0x0000_4000);

    let output = match super::analysis_control::run(
        session_id.as_deref(),
        tokio::time::timeout(
            Duration::from_secs(EXTRACTION_TIMEOUT_SECONDS),
            cmd.output(),
        ),
    )
    .await
    {
        Ok(output) => output,
        Err(error) => {
            // Cancelling while FFmpeg is writing must not leave a partial WAV
            // which might be mistaken for a later completed cache extraction.
            let _ = std::fs::remove_file(&output_path);
            return Err(error);
        }
    };
    let success = matches!(output, Ok(Ok(ref result)) if result.status.success());
    if !success {
        let _ = std::fs::remove_file(&output_path);
        return Err(match output {
            Err(_) => "cache-audio-extract-timeout",
            _ => "cache-audio-extract-failed",
        }
        .into());
    }

    let wav = hound::WavReader::open(&output_path).map_err(|_| "cache-audio-output-missing")?;
    let duration_sec = wav.duration() as f64 / SAMPLE_RATE;
    if !duration_sec.is_finite() || duration_sec < MIN_AUDIO_SECONDS {
        let _ = std::fs::remove_file(&output_path);
        return Err("cache-audio-incomplete".into());
    }
    Ok(PreparedCacheAudio {
        path: output_path.to_string_lossy().into_owned(),
        duration_sec,
        start_sec,
        subtitle_intervals,
    })
}

async fn cached_subtitles(
    path: &std::path::Path,
    movie_offset: f64,
) -> Result<Vec<(f64, f64)>, String> {
    let ffprobe = crate::transcode::locate_ffprobe().ok_or("ffprobe-unavailable")?;
    let mut cmd = Command::new(ffprobe);
    cmd.args([
        "-v",
        "error",
        "-select_streams",
        "s",
        "-show_streams",
        "-show_frames",
        "-show_entries",
        "stream=index:subtitle=pts_time,start_display_time,end_display_time,num_rects",
        "-of",
        "json",
        "-i",
    ])
    .arg(path)
    .kill_on_drop(true);
    #[cfg(windows)]
    cmd.creation_flags(0x0800_0000);
    let output = cmd
        .output()
        .await
        .map_err(|_| "cache-subtitle-read-failed")?;
    if !output.status.success() {
        return Err("cache-subtitle-read-failed".into());
    }
    #[derive(serde::Deserialize)]
    struct Report {
        #[serde(default)]
        streams: Vec<serde_json::Value>,
        #[serde(default)]
        frames: Vec<super::cache_subtitles::SubtitleFrame>,
    }
    let report: Report =
        serde_json::from_slice(&output.stdout).map_err(|_| "cache-subtitle-invalid")?;
    // Multiple cached subtitle tracks cannot safely be assigned to the primary
    // selection by assuming their remuxed index matches the original track ID.
    if report.streams.len() != 1 {
        return Err("cache-subtitle-track-ambiguous".into());
    }
    super::cache_subtitles::intervals(&report.frames, movie_offset)
}

#[derive(serde::Deserialize)]
struct Packet {
    pts_time: Option<String>,
    dts_time: Option<String>,
    data_hash: Option<String>,
    duration_time: Option<String>,
    flags: Option<String>,
}
#[derive(serde::Deserialize)]
struct PacketTimeline {
    packets: Vec<Packet>,
}

async fn packet_timeline(path: &str) -> Result<PacketTimeline, String> {
    let ffprobe = crate::transcode::locate_ffprobe().ok_or("ffprobe-unavailable")?;
    let mut cmd = Command::new(ffprobe);
    cmd.args([
        "-v",
        "error",
        // Packet hashes need container timestamps, not exhaustive codec analysis
        // of every video/subtitle track in the cached remux.
        "-analyzeduration",
        "1000000",
        "-probesize",
        "1000000",
        "-select_streams",
        "a:0",
        "-show_packets",
        "-show_data_hash",
        "sha256",
        "-show_entries",
        "packet=pts_time,dts_time,duration_time,data_hash,flags",
        "-of",
        "json",
    ]);
    cmd.arg("-i").arg(path).kill_on_drop(true);
    #[cfg(windows)]
    cmd.creation_flags(0x0800_0000);
    let output = cmd
        .output()
        .await
        .map_err(|_| "cache-audio-timeline-probe-failed")?;
    if !output.status.success() {
        return Err("cache-audio-timeline-probe-failed".into());
    }
    serde_json::from_slice(&output.stdout).map_err(|_| "cache-audio-timeline-invalid".into())
}

// dump-cache rebases the start, but stops audio before the first keyframe at
// or after the requested end. Two different cuts and shared packet hashes let
// us recover that clock locally. Never infer an origin from requested start.
fn verified_start(
    cached: &PacketTimeline,
    anchor: &PacketTimeline,
    end: f64,
    anchor_end: f64,
) -> Result<f64, String> {
    fn number(value: &Option<String>) -> Result<f64, String> {
        value
            .as_ref()
            .and_then(|v| v.parse::<f64>().ok())
            .filter(|v| v.is_finite())
            .ok_or_else(|| "cache-audio-timeline-invalid".into())
    }
    fn validate(timeline: &PacketTimeline) -> Result<(), String> {
        let mut previous_end: Option<f64> = None;
        for p in &timeline.packets {
            let pts = number(&p.pts_time)?;
            let duration = number(&p.duration_time)?;
            // The end-boundary argument only holds for independently decodable
            // audio packets with no timestamp reordering or gaps.
            if !(0.0 < duration && duration <= 0.12)
                || !p
                    .flags
                    .as_deref()
                    .is_some_and(|v| v.starts_with('K') && !v.contains('C'))
                || p.dts_time.is_some() && (number(&p.dts_time)? - pts).abs() > 0.002
            {
                return Err("cache-audio-timeline-invalid".into());
            }
            if previous_end.is_some_and(|v| (pts - v).abs() > 0.002) {
                return Err("cache-audio-timeline-discontinuous".into());
            }
            previous_end = Some(pts + duration);
        }
        if timeline.packets.len() < 3 {
            return Err("cache-audio-timeline-unverified".into());
        }
        let first = number(&timeline.packets[0].pts_time)?;
        if previous_end.unwrap() - first > 120.0 {
            return Err("cache-audio-timeline-invalid".into());
        }
        Ok(())
    }
    if !end.is_finite()
        || !anchor_end.is_finite()
        || anchor_end < 0.0
        || !(1.0..=5.0).contains(&(end - anchor_end))
    {
        return Err("cache-audio-timeline-invalid".into());
    }
    validate(cached)?;
    validate(anchor)?;
    let mut hashes: HashMap<&str, Option<&Packet>> = HashMap::new();
    for p in &cached.packets {
        if let Some(hash) = p.data_hash.as_deref() {
            hashes
                .entry(hash)
                .and_modify(|v| *v = None)
                .or_insert(Some(p));
        }
    }
    let mut offsets = Vec::new();
    let mut first_match = f64::INFINITY;
    let mut last_match = f64::NEG_INFINITY;
    for p in &anchor.packets {
        if let Some(Some(other)) = p.data_hash.as_deref().and_then(|h| hashes.get(h)) {
            let pts = number(&p.pts_time)?;
            offsets.push(number(&other.pts_time)? - pts);
            first_match = first_match.min(pts);
            last_match = last_match.max(pts);
        }
    }
    if offsets.len() < 3 || last_match - first_match < 1.0 {
        return Err("cache-audio-timeline-unverified".into());
    }
    offsets.sort_by(f64::total_cmp);
    if offsets.last().unwrap() - offsets[0] > 0.002 {
        return Err("cache-audio-timeline-discontinuous".into());
    }
    let last = cached.packets.last().unwrap();
    let marker = anchor.packets.last().unwrap();
    let matched = marker
        .data_hash
        .as_deref()
        .and_then(|h| hashes.get(h))
        .and_then(|p| *p)
        .ok_or("cache-audio-timeline-unverified")?;
    let last_pts = number(&last.pts_time)?;
    let marker_pts = number(&matched.pts_time)?;
    // Identical ends mean cache exhaustion, not two independently observed cuts.
    if last_pts - marker_pts < 0.8 {
        return Err("cache-audio-timeline-unverified".into());
    }
    let low = (end - last_pts - number(&last.duration_time)?)
        .max(anchor_end - marker_pts - number(&matched.duration_time)?);
    let high = (end - last_pts).min(anchor_end - marker_pts);
    if low > high + 0.002 {
        return Err("cache-audio-timeline-unverified".into());
    }
    // Midpoint error is bounded by half an audio packet (at most 60 ms),
    // rather than the several-second keyframe error of the requested start.
    let start = number(&cached.packets[0].pts_time)? + (low + high) / 2.0;
    if start < -0.06 {
        return Err("cache-audio-timeline-invalid".into());
    }
    Ok(start.max(0.0))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn timeline(first: usize, count: usize, rebase: f64) -> PacketTimeline {
        PacketTimeline {
            packets: (first..first + count)
                .map(|i| Packet {
                    pts_time: Some((i as f64 * 0.032 - rebase).to_string()),
                    dts_time: Some((i as f64 * 0.032 - rebase).to_string()),
                    duration_time: Some("0.032".into()),
                    data_hash: Some(format!("SHA256:{i}")),
                    flags: Some("K__".into()),
                })
                .collect(),
        }
    }
    #[test]
    fn independent_local_cuts_recover_rebased_start() {
        for rebase in [0.0, 10.0, 20.0] {
            let cached = timeline(625, 1563, rebase);
            let anchor = timeline(1900, 225, 60.0);
            let start = verified_start(&cached, &anchor, 70.0, 68.0).unwrap();
            assert!((start - 20.0).abs() <= 0.016);
        }
    }
    #[test]
    fn exhausted_or_truncated_cache_is_not_a_timing_anchor() {
        assert!(verified_start(
            &timeline(625, 1500, 20.0),
            &timeline(1900, 225, 60.0),
            70.0,
            68.0
        )
        .is_err());
        assert!(verified_start(
            &timeline(625, 1540, 20.0),
            &timeline(1900, 225, 60.0),
            70.0,
            68.0
        )
        .is_err());
    }
    #[test]
    fn missing_repeated_or_unrelated_terminal_packets_are_rejected() {
        let cached = timeline(625, 1563, 20.0);
        let mut anchor = timeline(1900, 225, 60.0);
        anchor.packets.last_mut().unwrap().data_hash = None;
        assert!(verified_start(&cached, &anchor, 70.0, 68.0).is_err());
        let mut cached = timeline(625, 1563, 20.0);
        for p in &mut cached.packets {
            p.data_hash = Some("same".into());
        }
        assert!(verified_start(&cached, &anchor, 70.0, 68.0).is_err());
        assert!(verified_start(
            &timeline(625, 1563, 20.0),
            &timeline(3000, 225, 60.0),
            70.0,
            68.0
        )
        .is_err());
    }
    #[test]
    fn gaps_reordering_and_non_keyframe_audio_are_rejected() {
        for change in 0..3 {
            let mut cached = timeline(625, 1563, 20.0);
            match change {
                0 => cached.packets[10].pts_time = Some("50".into()),
                1 => cached.packets[10].dts_time = Some("50".into()),
                _ => cached.packets[10].flags = Some("___".into()),
            }
            assert!(verified_start(&cached, &timeline(1900, 225, 60.0), 70.0, 68.0).is_err());
        }
    }
}
