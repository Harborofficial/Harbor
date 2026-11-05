use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;
use std::time::{Duration, Instant};

use sha2::{Digest, Sha256};

use super::analysis_windows::{
    self, AnalysisWindow, RequestedValidationWindow, DIRECT_ANALYSIS_PROVENANCE,
    DIRECT_EXPLICIT_HELD_OUT_PROVENANCE, DIRECT_HELD_OUT_PROVENANCE,
};
use super::correlate::{self, AlignmentQuality};
use super::extract;

#[path = "url_guard.rs"]
mod url_guard;

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PieceSeg {
    from_sec: f32,
    to_sec: f32,
    offset_sec: f32,
    ratio: f32,
}

#[derive(serde::Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub(crate) enum ScoreTransform {
    #[serde(rename_all = "camelCase")]
    Affine {
        offset_sec: f32,
        ratio: f32,
    },
    Piecewise {
        segments: Vec<PieceSeg>,
    },
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScoredWindow {
    id: String,
    from_sec: f32,
    to_sec: f32,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScoredAlignmentQuality {
    ncc: f32,
    coverage: f32,
    z: f32,
    window_ids: Vec<String>,
    windows: Vec<ScoredWindow>,
    provenance: String,
    request_provenance: Option<String>,
    // Bounded, non-identifying sample quality diagnostics. These let Harbor
    // tell an unusable speech mask from an actual bad timing candidate.
    speech_fraction: Option<f32>,
    subtitle_fraction: Option<f32>,
    speech_segments: Option<usize>,
    subtitle_segments: Option<usize>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreflightCandidateInput {
    id: String,
    cues: Vec<[f32; 2]>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreflightCandidateScore {
    id: String,
    invalid: bool,
    identity: Option<AlignmentQuality>,
    best: Option<AlignmentQuality>,
    offset_sec: Option<f32>,
    ratio: Option<f32>,
    window_ids: Vec<String>,
    provenance: String,
}

static PREFLIGHT_BUSY: AtomicBool = AtomicBool::new(false);
const NATIVE_SCORING_TIMEOUT_SECS: u64 = 25;
const SCORE_AUDIO_CACHE_TTL_SECS: u64 = 90;
const MAX_CACHED_WINDOWS: usize = 32;

// A bounded, in-memory decoded-speech cache shared by candidate preflight
// and scoring. Key the *media*, headers and selected audio stream separately
// from the time window, so the narrower held-out windows can reuse an earlier
// preflight decode without weakening their held-out provenance.
struct CachedAudioWindow {
    source_key: [u8; 32],
    created: Instant,
    window: AnalysisWindow,
    intervals: Vec<(f32, f32)>,
}
static SCORE_AUDIO_CACHE: OnceLock<tokio::sync::Mutex<Vec<CachedAudioWindow>>> = OnceLock::new();

struct PreflightBusyGuard;

impl Drop for PreflightBusyGuard {
    fn drop(&mut self) {
        PREFLIGHT_BUSY.store(false, Ordering::SeqCst);
    }
}

fn apply_piecewise(cues: &[(f32, f32)], segs: &[PieceSeg]) -> Vec<(f32, f32)> {
    if segs.is_empty() {
        return cues.to_vec();
    }
    let last = &segs[segs.len() - 1];
    cues.iter()
        .map(|&(a, b)| {
            let seg = segs
                .iter()
                .find(|g| a >= g.from_sec && a < g.to_sec)
                .unwrap_or(last);
            (
                seg.ratio * a + seg.offset_sec,
                seg.ratio * b + seg.offset_sec,
            )
        })
        .collect()
}

fn apply_transform(cues: &[(f32, f32)], transform: &ScoreTransform) -> Vec<(f32, f32)> {
    match transform {
        ScoreTransform::Affine { offset_sec, ratio } => cues
            .iter()
            .map(|&(start, end)| {
                let corrected_start = ratio * start + offset_sec;
                let corrected_end = ratio * end + offset_sec;
                (
                    corrected_start.min(corrected_end),
                    corrected_start.max(corrected_end),
                )
            })
            .collect(),
        ScoreTransform::Piecewise { segments } => apply_piecewise(cues, segments),
    }
}

pub(crate) fn pack_intervals(
    intervals: &[(f32, f32)],
    windows: &[AnalysisWindow],
) -> (Vec<(f32, f32)>, f32) {
    let mut packed = Vec::new();
    let mut cursor = 0.0f32;
    for window in windows {
        let window_end = window.end_sec();
        for &(start, end) in intervals {
            let clipped_start = start.max(window.start_sec);
            let clipped_end = end.min(window_end);
            if clipped_end > clipped_start {
                packed.push((
                    cursor + clipped_start - window.start_sec,
                    cursor + clipped_end - window.start_sec,
                ));
            }
        }
        cursor += window.len_sec;
    }
    (packed, cursor)
}

pub(crate) async fn decode_speech(
    url: &str,
    headers: &HashMap<String, String>,
    windows: &[AnalysisWindow],
    map_spec: &str,
) -> Result<(Vec<(f32, f32)>, Vec<AnalysisWindow>), String> {
    decode_speech_cached(url, headers, windows, map_spec).await
}

fn score_audio_key(
    url: &str,
    headers: &HashMap<String, String>,
    _windows: &[AnalysisWindow],
    map_spec: &str,
) -> [u8; 32] {
    fn field(hasher: &mut Sha256, value: &[u8]) {
        hasher.update((value.len() as u64).to_le_bytes());
        hasher.update(value);
    }
    let mut hasher = Sha256::new();
    field(&mut hasher, url.as_bytes());
    field(&mut hasher, map_spec.as_bytes());
    let mut hdrs = headers.iter().collect::<Vec<_>>();
    hdrs.sort_by(|a, b| a.0.cmp(b.0));
    for (name, value) in hdrs {
        field(&mut hasher, name.as_bytes());
        field(&mut hasher, value.as_bytes());
    }
    hasher.finalize().into()
}

fn covers(cached: &AnalysisWindow, requested: &AnalysisWindow) -> bool {
    cached.start_sec <= requested.start_sec + 0.001
        && cached.end_sec() >= requested.end_sec() - 0.001
}

async fn decode_speech_cached(
    url: &str,
    headers: &HashMap<String, String>,
    windows: &[AnalysisWindow],
    map_spec: &str,
) -> Result<(Vec<(f32, f32)>, Vec<AnalysisWindow>), String> {
    let source_key = score_audio_key(url, headers, &[], map_spec);
    let cache = SCORE_AUDIO_CACHE.get_or_init(|| tokio::sync::Mutex::new(Vec::new()));
    let mut audio = Vec::new();
    let mut used_windows = Vec::new();
    for window in windows {
        // Serialize native decoders against this cache, preventing the preflight
        // and playback analyzer from competing for remote seek connections.
        let mut guard = cache.lock().await;
        guard.retain(|entry| {
            entry.created.elapsed() < Duration::from_secs(SCORE_AUDIO_CACHE_TTL_SECS)
        });
        let intervals = if let Some(cached) = guard
            .iter()
            .find(|entry| entry.source_key == source_key && covers(&entry.window, window))
        {
            cached
                .intervals
                .iter()
                .filter_map(|&(start, end)| {
                    let clipped_start = start.max(window.start_sec);
                    let clipped_end = end.min(window.end_sec());
                    (clipped_end > clipped_start).then_some((clipped_start, clipped_end))
                })
                .collect::<Vec<_>>()
        } else {
            // The timing verifier must measure *speech*, not merely
            // non-silence. SilenceDetect treats music and ambient effects as
            // dialogue; use the same heuristic VAD as the offset fitter.
            let decoded = extract::speech_intervals_reference(
                url,
                headers,
                window.start_sec,
                window.len_sec,
                map_spec,
                false,
            )
            .await?;
            if !decoded.is_empty() {
                if guard.len() >= MAX_CACHED_WINDOWS {
                    guard.remove(0);
                }
                guard.push(CachedAudioWindow {
                    source_key,
                    created: Instant::now(),
                    window: window.clone(),
                    intervals: decoded.clone(),
                });
            }
            decoded
        };
        if intervals.is_empty() {
            return Err("audio-window-no-speech".into());
        }
        audio.extend(intervals);
        used_windows.push(window.clone());
    }
    Ok((audio, used_windows))
}

pub(crate) fn scored_quality(
    quality: AlignmentQuality,
    windows: &[AnalysisWindow],
    provenance: &str,
    request_provenance: Option<String>,
) -> ScoredAlignmentQuality {
    ScoredAlignmentQuality {
        ncc: quality.ncc,
        coverage: quality.coverage,
        z: quality.z,
        window_ids: windows.iter().map(|window| window.id.clone()).collect(),
        windows: windows
            .iter()
            .map(|window| ScoredWindow {
                id: window.id.clone(),
                from_sec: window.start_sec,
                to_sec: window.end_sec(),
            })
            .collect(),
        provenance: provenance.to_string(),
        request_provenance,
        speech_fraction: None,
        subtitle_fraction: None,
        speech_segments: None,
        subtitle_segments: None,
    }
}

/// Coverage of the union of timing intervals. A constantly-on speech mask has
/// zero statistical variance, so its NCC=0 is not an actual timing measurement.
fn occupied_fraction(intervals: &[(f32, f32)], duration: f32) -> f32 {
    if !duration.is_finite() || duration <= 0.0 {
        return 0.0;
    }
    let mut spans = intervals
        .iter()
        .filter_map(|&(start, end)| {
            if !start.is_finite() || !end.is_finite() || end <= start {
                return None;
            }
            let lo = start.max(0.0).min(duration);
            let hi = end.max(0.0).min(duration);
            (hi > lo).then_some((lo, hi))
        })
        .collect::<Vec<_>>();
    spans.sort_by(|a, b| a.0.total_cmp(&b.0));
    let mut total = 0.0_f32;
    let mut tail = 0.0_f32;
    for (start, end) in spans {
        if end <= tail {
            continue;
        }
        total += end - start.max(tail);
        tail = end;
    }
    (total / duration).clamp(0.0, 1.0)
}

fn direct_excluded_windows(
    duration_sec: f32,
    excluded_window_ids: &[String],
    cues: &[[f32; 2]],
    remote: bool,
) -> Option<Vec<AnalysisWindow>> {
    let mut fit = analysis_windows::fit_windows(duration_sec);
    // VAD still uses the original longer fit windows. Include both those and
    // the new cue-aware fit windows in the held-out exclusion check so audio
    // evidence can never overlap fitting even if the estimation route changes.
    if remote {
        fit.extend(analysis_windows::remote_cue_aware_windows(duration_sec, cues).0);
    }
    let mut excluded = Vec::new();
    for id in excluded_window_ids {
        // The legacy VAD fit and new remote scorer fit share stable IDs but
        // may use different physical ranges. Exclude *both* geometries.
        let matched = fit
            .iter()
            .filter(|window| &window.id == id)
            .collect::<Vec<_>>();
        if matched.is_empty() {
            return None;
        }
        for window in matched {
            if !excluded.iter().any(|existing: &AnalysisWindow| {
                existing.id == window.id
                    && (existing.start_sec - window.start_sec).abs() < 0.001
                    && (existing.len_sec - window.len_sec).abs() < 0.001
            }) {
                excluded.push(window.clone());
            }
        }
    }
    Some(excluded)
}

pub(crate) fn requested_provenance(value: Option<String>) -> Option<String> {
    value.filter(|item| {
        !item.is_empty()
            && item.len() <= 128
            && item.bytes().all(|byte| {
                byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b':')
            })
    })
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn subsync_score_transform(
    url: String,
    headers: Option<HashMap<String, String>>,
    cues: Vec<[f32; 2]>,
    duration_sec: f32,
    transform: ScoreTransform,
    validation: Option<bool>,
    exclude_window_ids: Option<Vec<String>>,
    validation_windows: Option<Vec<RequestedValidationWindow>>,
    validation_provenance: Option<String>,
    map_spec: Option<String>,
    session_id: Option<String>,
) -> Result<Option<ScoredAlignmentQuality>, String> {
    if !crate::transcode::ffmpeg_present() {
        return Err("ffmpeg-unavailable".into());
    }
    url_guard::validate_media_url(&url, true)?;
    if cues.len() < 4 || duration_sec < 60.0 || !duration_sec.is_finite() {
        return Ok(None);
    }

    let requested = validation_windows.unwrap_or_default();
    let held_out = validation.unwrap_or(false) || !requested.is_empty();
    let excluded_ids = exclude_window_ids.unwrap_or_default();
    let remote = url.starts_with("http://") || url.starts_with("https://");
    let (remote_fit, remote_held_out) =
        analysis_windows::remote_cue_aware_windows(duration_sec, &cues);
    let (windows, provenance) = if !requested.is_empty() {
        let Some(excluded) = direct_excluded_windows(duration_sec, &excluded_ids, &cues, remote)
        else {
            return Ok(None);
        };
        (
            analysis_windows::explicit_validation_windows(duration_sec, &requested, &excluded),
            DIRECT_EXPLICIT_HELD_OUT_PROVENANCE,
        )
    } else if held_out {
        (
            if remote {
                // IDs from either the original VAD fit or the cue-aware fit
                // must belong to known windows; never relax provenance checks.
                let Some(excluded) =
                    direct_excluded_windows(duration_sec, &excluded_ids, &cues, true)
                else {
                    return Ok(None);
                };
                if !analysis_windows::windows_are_disjoint(&remote_held_out, &excluded) {
                    return Ok(None);
                }
                remote_held_out
            } else {
                analysis_windows::validation_windows(duration_sec, &excluded_ids)
            },
            DIRECT_HELD_OUT_PROVENANCE,
        )
    } else {
        (
            if remote {
                remote_fit
            } else {
                analysis_windows::fit_windows(duration_sec)
            },
            DIRECT_ANALYSIS_PROVENANCE,
        )
    };
    if windows.is_empty() {
        return Ok(None);
    }

    let hdrs = headers.unwrap_or_default();
    let map = url_guard::safe_map_spec(map_spec.as_deref());
    let (audio, used_windows) = match super::analysis_control::run(
        session_id.as_deref(),
        tokio::time::timeout(
            Duration::from_secs(NATIVE_SCORING_TIMEOUT_SECS),
            decode_speech_cached(&url, &hdrs, &windows, &map),
        ),
    )
    .await?
    {
        Ok(Ok(value)) => value,
        Ok(Err(error)) => return Err(format!("audio-decode: {}", error)),
        Err(_) => return Err("scoring-timeout".into()),
    };
    if audio.is_empty() || used_windows.len() != windows.len() {
        return Err("audio-window-unavailable".into());
    }
    let cue_pairs: Vec<(f32, f32)> = cues.iter().map(|cue| (cue[0], cue[1])).collect();
    let corrected = apply_transform(&cue_pairs, &transform);
    let (packed_audio, packed_duration) = pack_intervals(&audio, &used_windows);
    let (packed_cues, _) = pack_intervals(&corrected, &used_windows);
    if packed_audio.is_empty() || packed_duration <= 0.0 {
        return Err("scoring-no-speech-in-sampled-windows".into());
    }
    if packed_cues.len() < 2 {
        return Err("scoring-too-few-cues-in-sampled-windows".into());
    }
    let speech_fraction = occupied_fraction(&packed_audio, packed_duration);
    let subtitle_fraction = occupied_fraction(&packed_cues, packed_duration);
    if speech_fraction >= 0.995 {
        return Err("scoring-no-speech-timing-contrast".into());
    }
    if subtitle_fraction >= 0.995 {
        return Err("scoring-no-subtitle-timing-contrast".into());
    }
    let quality = correlate::score_affine(&packed_audio, &packed_cues, packed_duration, 0.0, 1.0);
    let mut scored = scored_quality(
        quality,
        &used_windows,
        provenance,
        if requested.is_empty() {
            None
        } else {
            requested_provenance(validation_provenance)
        },
    );
    scored.speech_fraction = Some(speech_fraction);
    scored.subtitle_fraction = Some(subtitle_fraction);
    scored.speech_segments = Some(packed_audio.len());
    scored.subtitle_segments = Some(packed_cues.len());
    Ok(Some(scored))
}

fn valid_preflight_cues(cues: &[[f32; 2]], duration_sec: f32) -> bool {
    if cues.len() < 4 {
        return false;
    }
    let mut previous_start = -1.0f32;
    cues.iter().all(|cue| {
        let valid = cue[0].is_finite()
            && cue[1].is_finite()
            && cue[0] >= 0.0
            && cue[1] > cue[0]
            && cue[0] >= previous_start
            && cue[1] <= duration_sec * 1.25 + 300.0;
        previous_start = cue[0];
        valid
    })
}

fn intervals_in_windows(intervals: &[(f32, f32)], windows: &[AnalysisWindow]) -> Vec<(f32, f32)> {
    let mut selected = Vec::new();
    for window in windows {
        for &(start, end) in intervals {
            let clipped_start = start.max(window.start_sec);
            let clipped_end = end.min(window.end_sec());
            if clipped_end > clipped_start {
                selected.push((clipped_start, clipped_end));
            }
        }
    }
    selected
}

fn score_in_windows(
    audio: &[(f32, f32)],
    cues: &[(f32, f32)],
    windows: &[AnalysisWindow],
) -> Option<AlignmentQuality> {
    let (packed_audio, packed_duration) = pack_intervals(audio, windows);
    let (packed_cues, _) = pack_intervals(cues, windows);
    if packed_audio.is_empty() || packed_cues.len() < 2 || packed_duration <= 0.0 {
        return None;
    }
    Some(correlate::score_affine(
        &packed_audio,
        &packed_cues,
        packed_duration,
        0.0,
        1.0,
    ))
}

fn score_preflight_candidate(
    candidate: PreflightCandidateInput,
    fit_audio: &[(f32, f32)],
    validation_audio: &[(f32, f32)],
    duration_sec: f32,
    validation_windows: &[AnalysisWindow],
) -> PreflightCandidateScore {
    if !valid_preflight_cues(&candidate.cues, duration_sec) {
        return PreflightCandidateScore {
            id: candidate.id,
            invalid: true,
            identity: None,
            best: None,
            offset_sec: None,
            ratio: None,
            window_ids: validation_windows
                .iter()
                .map(|window| window.id.clone())
                .collect(),
            provenance: DIRECT_HELD_OUT_PROVENANCE.to_string(),
        };
    }
    let cues = candidate
        .cues
        .iter()
        .map(|cue| (cue[0], cue[1]))
        .collect::<Vec<_>>();
    let identity = score_in_windows(validation_audio, &cues, validation_windows);
    let solved = correlate::solve(fit_audio, &cues, duration_sec, 0.3)
        .filter(|result| result.offset_sec.abs() <= 60.0 && (result.ratio - 1.0).abs() <= 0.08);
    let (best, offset_sec, ratio) = match solved {
        Some(result) => {
            let corrected = cues
                .iter()
                .map(|&(start, end)| {
                    (
                        result.ratio * start + result.offset_sec,
                        result.ratio * end + result.offset_sec,
                    )
                })
                .collect::<Vec<_>>();
            (
                score_in_windows(validation_audio, &corrected, validation_windows),
                Some(result.offset_sec),
                Some(result.ratio),
            )
        }
        None => (None, None, None),
    };
    PreflightCandidateScore {
        id: candidate.id,
        invalid: false,
        identity,
        best,
        offset_sec,
        ratio,
        window_ids: validation_windows
            .iter()
            .map(|window| window.id.clone())
            .collect(),
        provenance: DIRECT_HELD_OUT_PROVENANCE.to_string(),
    }
}

#[tauri::command]
pub async fn subsync_preflight_candidates(
    url: String,
    headers: Option<HashMap<String, String>>,
    duration_sec: f32,
    candidates: Vec<PreflightCandidateInput>,
    map_spec: Option<String>,
    session_id: Option<String>,
) -> Result<Option<Vec<PreflightCandidateScore>>, String> {
    if !crate::transcode::ffmpeg_present() {
        return Err("ffmpeg-unavailable".into());
    }
    url_guard::validate_media_url(&url, true)?;
    if duration_sec < 60.0 || !duration_sec.is_finite() || candidates.is_empty() {
        return Ok(None);
    }
    if PREFLIGHT_BUSY.swap(true, Ordering::SeqCst) {
        return Ok(None);
    }
    let _busy_guard = PreflightBusyGuard;
    let remote = url.starts_with("http://") || url.starts_with("https://");
    let (cue_fit, cue_validation) = analysis_windows::remote_cue_aware_windows(
        duration_sec,
        &candidates.first().map(|c| c.cues.as_slice()).unwrap_or(&[]),
    );
    let fit_windows = if remote {
        cue_fit
    } else {
        analysis_windows::fit_windows(duration_sec)
    };
    let fit_ids = fit_windows
        .iter()
        .map(|window| window.id.clone())
        .collect::<Vec<_>>();
    let validation_windows = if remote {
        cue_validation
    } else {
        analysis_windows::validation_windows(duration_sec, &fit_ids)
    };
    if fit_windows.is_empty() || validation_windows.is_empty() {
        return Ok(None);
    }
    let all_windows = fit_windows
        .iter()
        .chain(validation_windows.iter())
        .cloned()
        .collect::<Vec<_>>();
    let hdrs = headers.unwrap_or_default();
    let map = url_guard::safe_map_spec(map_spec.as_deref());
    let Ok(Ok((audio, used_windows))) = super::analysis_control::run(
        session_id.as_deref(),
        tokio::time::timeout(
            Duration::from_secs(NATIVE_SCORING_TIMEOUT_SECS),
            decode_speech(&url, &hdrs, &all_windows, &map),
        ),
    )
    .await?
    else {
        return Ok(None);
    };
    if audio.is_empty() || used_windows.len() != all_windows.len() {
        return Ok(None);
    }
    let fit_audio = intervals_in_windows(&audio, &fit_windows);
    let validation_audio = intervals_in_windows(&audio, &validation_windows);
    if fit_audio.is_empty() || validation_audio.is_empty() {
        return Ok(None);
    }
    Ok(Some(
        candidates
            .into_iter()
            .map(|candidate| {
                score_preflight_candidate(
                    candidate,
                    &fit_audio,
                    &validation_audio,
                    duration_sec,
                    &validation_windows,
                )
            })
            .collect(),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cue_pattern() -> Vec<[f32; 2]> {
        let gaps = [4.3f32, 6.1, 3.2, 7.4, 5.0, 3.9, 8.2, 4.7, 6.6, 3.5];
        let mut time = 5.0f32;
        let mut cues = Vec::new();
        for index in 0..28 {
            let duration = 1.0 + (index % 4) as f32 * 0.3;
            cues.push([time, time + duration]);
            time += duration + gaps[index % gaps.len()];
        }
        cues
    }

    #[test]
    fn score_cache_key_is_bound_to_media_auth_audio_stream_and_windows() {
        let windows = vec![AnalysisWindow {
            id: "validation-middle-a".to_string(),
            start_sec: 120.0,
            len_sec: 20.0,
        }];
        let mut headers = HashMap::new();
        headers.insert("Authorization".to_string(), "token-one".to_string());
        headers.insert("Referer".to_string(), "test-origin".to_string());
        let key = score_audio_key("https://example.test/movie", &headers, &windows, "0:a:0");
        let mut shuffled = HashMap::new();
        shuffled.insert("Referer".to_string(), "test-origin".to_string());
        shuffled.insert("Authorization".to_string(), "token-one".to_string());
        assert_eq!(
            key,
            score_audio_key("https://example.test/movie", &shuffled, &windows, "0:a:0")
        );
        assert_ne!(
            key,
            score_audio_key("https://example.test/another", &headers, &windows, "0:a:0")
        );
        assert_ne!(
            key,
            score_audio_key("https://example.test/movie", &headers, &windows, "0:a:1")
        );
        shuffled.insert("Authorization".to_string(), "token-two".to_string());
        assert_ne!(
            key,
            score_audio_key("https://example.test/movie", &shuffled, &windows, "0:a:0")
        );
        let moved = vec![AnalysisWindow {
            start_sec: 121.0,
            ..windows[0].clone()
        }];
        // The source identity is the same; range coverage determines reuse.
        assert_eq!(
            key,
            score_audio_key("https://example.test/movie", &headers, &moved, "0:a:0")
        );
        assert!(!covers(&windows[0], &moved[0]));
        let smaller = AnalysisWindow {
            start_sec: 123.0,
            len_sec: 8.0,
            ..windows[0].clone()
        };
        assert!(covers(&windows[0], &smaller));
    }

    #[test]
    fn occupied_fraction_does_not_double_count_overlapping_dialogue() {
        assert!(
            (occupied_fraction(&[(0.0, 3.0), (2.0, 5.0), (9.0, 12.0)], 10.0) - 0.6).abs() < 0.001
        );
        assert_eq!(occupied_fraction(&[(0.0, 10.0)], 10.0), 1.0);
        assert_eq!(occupied_fraction(&[(1.0, 2.0)], 10.0), 0.1);
        assert_eq!(occupied_fraction(&[(f32::NAN, 10.0)], 10.0), 0.0);
    }

    #[test]
    fn packing_keeps_only_intervals_inside_selected_windows() {
        let windows = vec![AnalysisWindow {
            id: "validation-middle-a".to_string(),
            start_sec: 100.0,
            len_sec: 20.0,
        }];
        let (packed, duration) =
            pack_intervals(&[(90.0, 95.0), (105.0, 110.0), (118.0, 125.0)], &windows);
        assert_eq!(packed, vec![(5.0, 10.0), (18.0, 20.0)]);
        assert_eq!(duration, 20.0);
    }

    #[test]
    fn piecewise_applies_segment_by_start() {
        let cues = vec![(10.0f32, 12.0f32), (100.0f32, 102.0f32)];
        let segs = vec![
            PieceSeg {
                from_sec: 0.0,
                to_sec: 50.0,
                offset_sec: 1.0,
                ratio: 1.0,
            },
            PieceSeg {
                from_sec: 50.0,
                to_sec: 1000.0,
                offset_sec: 5.0,
                ratio: 1.0,
            },
        ];
        assert_eq!(
            apply_piecewise(&cues, &segs),
            vec![(11.0, 13.0), (105.0, 107.0)]
        );
    }

    #[test]
    fn affine_is_applied_before_window_packing() {
        let corrected = apply_transform(
            &[(98.0f32, 100.0f32)],
            &ScoreTransform::Affine {
                offset_sec: 5.0,
                ratio: 1.0,
            },
        );
        assert_eq!(corrected, vec![(103.0, 105.0)]);
    }

    #[test]
    fn preflight_reuses_audio_and_recovers_a_fixed_offset() {
        let cues = cue_pattern();
        let audio = cues
            .iter()
            .map(|cue| (cue[0] + 7.25, cue[1] + 7.25))
            .collect::<Vec<_>>();
        let score = score_preflight_candidate(
            PreflightCandidateInput {
                id: "fixed".to_string(),
                cues,
            },
            &audio,
            &audio,
            300.0,
            &analysis_windows::validation_windows(
                300.0,
                &["fit-early".to_string(), "fit-late".to_string()],
            ),
        );
        assert!(!score.invalid);
        assert!((score.offset_sec.expect("offset") - 7.25).abs() < 0.05);
        assert!((score.ratio.expect("ratio") - 1.0).abs() < 0.001);
        assert!(score.best.expect("best quality").ncc > 0.9);
    }

    #[test]
    fn preflight_marks_malformed_cues_invalid_without_scoring() {
        let score = score_preflight_candidate(
            PreflightCandidateInput {
                id: "invalid".to_string(),
                cues: vec![[4.0, 3.0], [5.0, 6.0], [7.0, 8.0], [9.0, 10.0]],
            },
            &[(1.0, 2.0)],
            &[(1.0, 2.0)],
            300.0,
            &[],
        );
        assert!(score.invalid);
        assert!(score.identity.is_none());
        assert!(score.best.is_none());
    }

    #[test]
    fn preflight_scores_the_fitted_transform_only_on_held_out_audio() {
        let cues = cue_pattern();
        let fit_audio = cues
            .iter()
            .map(|cue| (cue[0] + 7.25, cue[1] + 7.25))
            .collect::<Vec<_>>();
        let validation_audio = cues
            .iter()
            .map(|cue| (cue[0] - 9.0, cue[1] - 9.0))
            .collect::<Vec<_>>();
        let validation_windows = analysis_windows::validation_windows(
            300.0,
            &["fit-early".to_string(), "fit-late".to_string()],
        );
        let score = score_preflight_candidate(
            PreflightCandidateInput {
                id: "different-held-out-cut".to_string(),
                cues,
            },
            &fit_audio,
            &validation_audio,
            300.0,
            &validation_windows,
        );

        assert!((score.offset_sec.expect("fit offset") - 7.25).abs() < 0.05);
        assert!(score.best.expect("held-out quality").ncc < 0.55);
    }
}
