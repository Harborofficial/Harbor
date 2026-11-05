pub mod analysis_control;
mod analysis_windows;
pub mod cache_audio;
pub mod embedded_reference;
pub(crate) mod correlate;
mod extract;
pub mod moviehash;

pub mod asr;
mod asr_match;
pub mod audio_tracks;
pub mod fingerprint;
pub mod scorer;
pub mod torrent_sync;
pub(crate) mod url_guard;
mod vad;

#[cfg(feature = "asr-whisper")]
mod asr_whisper;

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

const FIT_TIMEOUT_SECS: u64 = 45;

#[derive(serde::Serialize)]
pub struct SyncOut {
    #[serde(rename = "offsetSec")]
    pub offset_sec: f32,
    pub ratio: f32,
    pub confidence: f32,
    #[serde(rename = "fitWindowIds")]
    pub fit_window_ids: Vec<String>,
}

static BUSY: AtomicBool = AtomicBool::new(false);

struct BusyGuard;
impl Drop for BusyGuard {
    fn drop(&mut self) {
        BUSY.store(false, Ordering::SeqCst);
    }
}

#[tauri::command]
pub async fn sync_subtitle(
    url: String,
    headers: Option<HashMap<String, String>>,
    cues: Vec<[f32; 2]>,
    duration_sec: f32,
    info_hash: Option<String>,
    conf_min: Option<f32>,
    map_spec: Option<String>,
    from_start: Option<bool>,
    window_start_sec: Option<f32>,
    report_failures: Option<bool>,
    session_id: Option<String>,
    playback_clip: Option<bool>,
) -> Result<Option<SyncOut>, String> {
    if info_hash.as_deref().map(|h| !h.is_empty()).unwrap_or(false) {
        return Ok(None);
    }
    if !crate::transcode::ffmpeg_present() {
        return Err("ffmpeg-unavailable".into());
    }
    let is_playback_clip = playback_clip.unwrap_or(false);
    if cues.len() < 4 || duration_sec < if is_playback_clip { 40.0 } else { 60.0 } {
        return Ok(None);
    }
    if BUSY.swap(true, Ordering::SeqCst) {
        return if window_start_sec.is_some() || report_failures.unwrap_or(false) {
            Err("subsync-analysis-busy".into())
        } else {
            Ok(None)
        };
    }
    let _guard = BusyGuard;

    // An optional source position lets the live fallback analyze the same
    // minute as the player, instead of probing the beginning and end of a film.
    let origin = window_start_sec.unwrap_or(0.0);
    if !origin.is_finite() || origin < 0.0 || (origin > 0.0 && from_start.unwrap_or(false)) {
        return Err("subsync-window-start-invalid".into());
    }
    let hdrs = headers.unwrap_or_default();
    let map = url_guard::safe_map_spec(map_spec.as_deref());
    let mut audio: Vec<(f32, f32)> = Vec::new();
    let planned_fit_windows = if is_playback_clip {
        analysis_windows::playback_clip_fit_windows(duration_sec)
    } else if url.starts_with("http://") || url.starts_with("https://") {
        // Avoid long, fixed-position remote seeks through intros and quiet
        // sequences. Use the same cue-rich fitting policy as the scorer.
        analysis_windows::remote_cue_aware_windows(duration_sec, &cues).0
    } else {
        analysis_windows::fit_windows(duration_sec)
    };
    let mut used_fit_windows = Vec::new();
    let mut last_error: Option<String> = None;
    // The frontend gives up on this command after 45s. Bound it here too, or a
    // slow source keeps BUSY set and every later sync returns "no candidate".
    let analyze_fit = async {
        for window in &planned_fit_windows {
            match extract::speech_intervals_reference(
                &url,
                &hdrs,
                origin + window.start_sec,
                window.len_sec,
                &map,
                from_start.unwrap_or(false),
            )
            .await
            {
                Ok(iv) if !iv.is_empty() => {
                    // The matcher sees a zero-based minute, even though FFmpeg
                    // read it from an arbitrary position in the actual movie.
                    audio.extend(
                        iv.into_iter()
                            .map(|(start, end)| (start - origin, end - origin)),
                    );
                    used_fit_windows.push(window.clone());
                }
                Ok(_) => {}
                Err(error) => last_error = Some(error),
            }
        }
    };
    if analysis_control::run(
        session_id.as_deref(),
        tokio::time::timeout(Duration::from_secs(FIT_TIMEOUT_SECS), analyze_fit),
    )
    .await?
    .is_err()
    {
        return if window_start_sec.is_some() || report_failures.unwrap_or(false) {
            Err("subsync-analysis-timeout".into())
        } else {
            Ok(None)
        };
    }
    if audio.is_empty() {
        return Err(last_error.unwrap_or_else(|| "no-audio-analyzed".into()));
    }
    if used_fit_windows.len() != planned_fit_windows.len() {
        return if window_start_sec.is_some() || report_failures.unwrap_or(false) {
            Err("subsync-audio-windows-incomplete".into())
        } else {
            Ok(None)
        };
    }

    let cue_pairs: Vec<(f32, f32)> = cues.iter().map(|c| (c[0], c[1])).collect();
    let (res, metrics) =
        correlate::solve_with_metrics(&audio, &cue_pairs, duration_sec, conf_min.unwrap_or(0.55));
    if res.is_none() && report_failures.unwrap_or(false) {
        // Diagnostics contain counts and normalized match scores only, never
        // media URLs, subtitle text, or user paths.
        let speech_duration: f32 = audio
            .iter()
            .map(|(start, end)| (end - start).max(0.0))
            .sum();
        let speech_fraction = speech_duration / duration_sec;
        return Err(if let Some(m) = metrics {
            format!(
                "subsync-low-confidence:ncc={:.3},z={:.2},dominance={:.2},offset={:.2},speech_fraction={:.2},speech_segments={},subtitle_cues={}",
                m.ncc, m.z, m.dominance, m.offset_sec, speech_fraction,
                audio.len(), cue_pairs.len()
            )
        } else {
            format!(
                "subsync-no-match:audio_segments={},subtitle_cues={}",
                audio.len(),
                cue_pairs.len()
            )
        });
    }
    Ok(res.map(|r| SyncOut {
        offset_sec: r.offset_sec,
        ratio: r.ratio,
        confidence: r.confidence,
        fit_window_ids: used_fit_windows
            .iter()
            .map(|window| window.id.to_string())
            .collect(),
    }))
}
