pub const DIRECT_HELD_OUT_PROVENANCE: &str = "direct-middle-held-out-v2";
pub const DIRECT_EXPLICIT_HELD_OUT_PROVENANCE: &str = "direct-explicit-held-out-v1";
pub const DIRECT_ANALYSIS_PROVENANCE: &str = "direct-analysis-windows-v2";
pub const TORRENT_HELD_OUT_PROVENANCE: &str = "torrent-middle-held-out-v1";
pub const TORRENT_EXPLICIT_HELD_OUT_PROVENANCE: &str = "torrent-explicit-held-out-v1";

const MIN_DISJOINT_DURATION_SEC: f32 = 300.0;
const MIN_FIT_WINDOW_SEC: f32 = 60.0;
// Two minutes of dialogue is plenty to solve the offset, and keeps a 4K remux's
// high-bitrate audio track (FLAC/TrueHD) from being the slowest part of the check.
const MAX_FIT_WINDOW_SEC: f32 = 120.0;
const MIN_VALIDATION_WINDOW_SEC: f32 = 30.0;
// Long enough for a robust score, short enough to fetch from a slow stream.
const MAX_VALIDATION_WINDOW_SEC: f32 = 45.0;
// Remote streams may play normally in mpv while FFmpeg's independent range
// seeks are slow. Keep two disjoint held-out windows, but request less media.
const REMOTE_VALIDATION_WINDOW_SEC: f32 = 20.0;
const REMOTE_FIT_WINDOW_SEC: f32 = 30.0;

/// For long remote media, choose *cue-rich* sections rather than probing
/// fixed positions that may contain silence, intros or credits. Fit and
/// held-out verification use four separate timeline regions, so the latter
/// never reuses the audio used to estimate a correction.
pub fn remote_cue_aware_windows(
    duration_sec: f32,
    cues: &[[f32; 2]],
) -> (Vec<AnalysisWindow>, Vec<AnalysisWindow>) {
    if !duration_sec.is_finite() || duration_sec < 300.0 {
        let fit = remote_fit_windows(duration_sec);
        let fit_ids = fit.iter().map(|w| w.id.clone()).collect::<Vec<_>>();
        let verification = remote_validation_windows(duration_sec, &fit_ids);
        return (fit, verification);
    }
    let regions = [
        (
            "fit-early",
            0.025_f32,
            0.30_f32,
            REMOTE_FIT_WINDOW_SEC,
            0.16_f32,
        ),
        (
            "validation-middle-a",
            0.32,
            0.48,
            REMOTE_VALIDATION_WINDOW_SEC,
            0.40,
        ),
        (
            "validation-middle-b",
            0.52,
            0.68,
            REMOTE_VALIDATION_WINDOW_SEC,
            0.60,
        ),
        ("fit-late", 0.70, 0.975, REMOTE_FIT_WINDOW_SEC, 0.84),
    ];
    let mut windows = Vec::with_capacity(regions.len());
    for (id, low_frac, high_frac, len, default_frac) in regions {
        let earliest = duration_sec * low_frac;
        let latest = duration_sec * high_frac - len;
        if latest <= earliest {
            return (Vec::new(), Vec::new());
        }
        let target = duration_sec * default_frac - len / 2.0;
        let mut best_start = target.clamp(earliest, latest);
        let mut best_cues = 0_usize;
        let mut best_coverage = 0.0_f32;
        let mut best_distance = f32::INFINITY;
        for candidate in std::iter::once(best_start).chain(cues.iter().filter_map(|cue| {
            if !cue[0].is_finite() || !cue[1].is_finite() || cue[1] <= cue[0] {
                return None;
            }
            let midpoint = (cue[0] + cue[1]) / 2.0;
            Some((midpoint - len / 2.0).clamp(earliest, latest))
        })) {
            let finish = candidate + len;
            let mut hits = 0_usize;
            let mut coverage = 0.0_f32;
            for cue in cues {
                if cue[0].is_finite() && cue[1].is_finite() && cue[1] > cue[0] {
                    let overlap = (cue[1].min(finish) - cue[0].max(candidate)).max(0.0);
                    if overlap >= 0.35 {
                        hits += 1;
                        coverage += overlap.min(6.0);
                    }
                }
            }
            let distance = (candidate - target).abs();
            if hits > best_cues
                || (hits == best_cues && coverage > best_coverage + 0.01)
                || (hits == best_cues
                    && (coverage - best_coverage).abs() <= 0.01
                    && distance < best_distance)
            {
                best_start = candidate;
                best_cues = hits;
                best_coverage = coverage;
                best_distance = distance;
            }
        }
        windows.push(AnalysisWindow {
            id: id.to_string(),
            start_sec: best_start,
            len_sec: len,
        });
    }
    let fit = vec![windows.remove(0), windows.pop().expect("four regions")];
    let verification = windows;
    debug_assert!(windows_are_disjoint(&verification, &fit));
    (fit, verification)
}

/// Guided playback clips only support a local delay estimate; never
/// infer a frame-rate ratio or claim full-film held-out verification.
pub fn playback_clip_fit_windows(duration_sec: f32) -> Vec<AnalysisWindow> {
    if !duration_sec.is_finite() || duration_sec < 40.0 {
        return Vec::new();
    }
    vec![AnalysisWindow {
        id: "fit-playback".to_string(),
        start_sec: 1.0,
        len_sec: duration_sec - 2.0,
    }]
}

pub fn remote_fit_windows(duration_sec: f32) -> Vec<AnalysisWindow> {
    fit_windows(duration_sec)
        .into_iter()
        .map(|mut window| {
            let midpoint = window.start_sec + window.len_sec / 2.0;
            window.len_sec = window.len_sec.min(REMOTE_FIT_WINDOW_SEC);
            window.start_sec = midpoint - window.len_sec / 2.0;
            window
        })
        .collect()
}
const MAX_EXPLICIT_WINDOWS: usize = 24;
const MIN_EXPLICIT_WINDOW_SEC: f32 = 2.0;

#[derive(Clone, Debug, PartialEq)]
pub struct AnalysisWindow {
    pub id: String,
    pub start_sec: f32,
    pub len_sec: f32,
}

#[derive(Clone, Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RequestedValidationWindow {
    pub id: String,
    pub from_sec: f32,
    pub to_sec: f32,
}

impl AnalysisWindow {
    pub fn end_sec(&self) -> f32 {
        self.start_sec + self.len_sec
    }

    pub fn overlaps(&self, other: &Self) -> bool {
        self.start_sec < other.end_sec() && other.start_sec < self.end_sec()
    }
}

fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 96
        && id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b':'))
}

pub fn fit_windows(duration_sec: f32) -> Vec<AnalysisWindow> {
    if !duration_sec.is_finite() || duration_sec < 60.0 {
        return Vec::new();
    }
    if duration_sec < MIN_DISJOINT_DURATION_SEC {
        let start = (duration_sec * 0.05).max(5.0);
        let end = (duration_sec * 0.95).max(start + 30.0).min(duration_sec);
        return vec![AnalysisWindow {
            id: "fit-whole".to_string(),
            start_sec: start,
            len_sec: (end - start).max(0.0),
        }];
    }

    let margin = (duration_sec * 0.05).clamp(5.0, 270.0);
    let len = (duration_sec * 0.22).clamp(MIN_FIT_WINDOW_SEC, MAX_FIT_WINDOW_SEC);
    vec![
        AnalysisWindow {
            id: "fit-early".to_string(),
            start_sec: margin,
            len_sec: len,
        },
        AnalysisWindow {
            id: "fit-late".to_string(),
            start_sec: (duration_sec - margin - len).max(margin + len),
            len_sec: len,
        },
    ]
}

pub fn default_validation_windows(duration_sec: f32) -> Vec<AnalysisWindow> {
    if !duration_sec.is_finite() || duration_sec < MIN_DISJOINT_DURATION_SEC {
        return Vec::new();
    }
    let len = (duration_sec * 0.1).clamp(MIN_VALIDATION_WINDOW_SEC, MAX_VALIDATION_WINDOW_SEC);
    [0.43f32, 0.57f32]
        .into_iter()
        .enumerate()
        .map(|(index, center)| AnalysisWindow {
            id: format!("validation-middle-{}", if index == 0 { "a" } else { "b" }),
            start_sec: duration_sec * center - len * 0.5,
            len_sec: len,
        })
        .collect()
}

pub fn windows_are_disjoint(windows: &[AnalysisWindow], excluded: &[AnalysisWindow]) -> bool {
    windows.iter().enumerate().all(|(index, window)| {
        windows
            .iter()
            .skip(index + 1)
            .all(|other| !window.overlaps(other))
            && excluded.iter().all(|other| !window.overlaps(other))
    })
}

pub fn validation_windows(
    duration_sec: f32,
    excluded_window_ids: &[String],
) -> Vec<AnalysisWindow> {
    let fit = fit_windows(duration_sec);
    let mut excluded = Vec::new();
    for id in excluded_window_ids {
        let Some(window) = fit.iter().find(|window| &window.id == id) else {
            return Vec::new();
        };
        if !excluded
            .iter()
            .any(|existing: &AnalysisWindow| existing.id == window.id)
        {
            excluded.push(window.clone());
        }
    }
    let candidates = default_validation_windows(duration_sec);
    if candidates.is_empty() || !windows_are_disjoint(&candidates, &excluded) {
        return Vec::new();
    }
    candidates
}

/// Use the same independently selected held-out ranges as local validation,
/// narrowed to reduce network range requests on high-bitrate remote streams.
/// Neither the window IDs nor their trusted held-out provenance change.
pub fn remote_validation_windows(
    duration_sec: f32,
    excluded_window_ids: &[String],
) -> Vec<AnalysisWindow> {
    validation_windows(duration_sec, excluded_window_ids)
        .into_iter()
        .map(|mut window| {
            let midpoint = window.start_sec + window.len_sec / 2.0;
            window.len_sec = window.len_sec.min(REMOTE_VALIDATION_WINDOW_SEC);
            window.start_sec = midpoint - window.len_sec / 2.0;
            window
        })
        .collect()
}

pub fn explicit_validation_windows(
    duration_sec: f32,
    requested: &[RequestedValidationWindow],
    excluded: &[AnalysisWindow],
) -> Vec<AnalysisWindow> {
    if !duration_sec.is_finite() || requested.is_empty() || requested.len() > MAX_EXPLICIT_WINDOWS {
        return Vec::new();
    }
    let mut windows = Vec::with_capacity(requested.len());
    for request in requested {
        if !valid_id(&request.id)
            || !request.from_sec.is_finite()
            || !request.to_sec.is_finite()
            || request.from_sec < 0.0
            || request.to_sec > duration_sec
            || request.to_sec - request.from_sec < MIN_EXPLICIT_WINDOW_SEC
            || windows
                .iter()
                .any(|window: &AnalysisWindow| window.id == request.id)
        {
            return Vec::new();
        }
        windows.push(AnalysisWindow {
            id: request.id.clone(),
            start_sec: request.from_sec,
            len_sec: request.to_sec - request.from_sec,
        });
    }
    if !windows_are_disjoint(&windows, excluded) {
        return Vec::new();
    }
    windows
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ids(windows: &[AnalysisWindow]) -> Vec<&str> {
        windows.iter().map(|window| window.id.as_str()).collect()
    }

    #[test]
    fn remote_windows_select_dialogue_rich_positions_and_keep_held_out_independent() {
        let duration = 3600.0_f32;
        // Most of the timeline is silent, with isolated dialogue clusters
        // intentionally away from the old fixed .16/.40/.60/.84 probes.
        let clusters = [360.0, 1440.0, 2230.0, 2900.0];
        let mut cues = Vec::new();
        for cluster in clusters {
            for i in 0..9 {
                let t = cluster + i as f32 * 2.0;
                cues.push([t, t + 1.1]);
            }
        }
        cues.sort_by(|a, b| a[0].total_cmp(&b[0]));
        let (fit, validation) = remote_cue_aware_windows(duration, &cues);
        assert_eq!(ids(&fit), vec!["fit-early", "fit-late"]);
        assert_eq!(
            ids(&validation),
            vec!["validation-middle-a", "validation-middle-b"]
        );
        assert!(windows_are_disjoint(&validation, &fit));
        for window in fit.iter().chain(validation.iter()) {
            let cues_inside = cues
                .iter()
                .filter(|cue| cue[0] >= window.start_sec && cue[1] <= window.end_sec())
                .count();
            assert!(cues_inside >= 4, "no dialogue selected for {}", window.id);
        }
        assert_ne!(fit[0].start_sec, remote_fit_windows(duration)[0].start_sec);
    }

    #[test]
    fn remote_cue_windows_ignore_invalid_timing_and_short_videos_keep_legacy_plan() {
        let cues = vec![[f32::NAN, 24.0], [3.0, 2.0], [400.0, 401.0]];
        let (fit, validation) = remote_cue_aware_windows(3600.0, &cues);
        assert_eq!(fit.len(), 2);
        assert_eq!(validation.len(), 2);
        assert!(windows_are_disjoint(&validation, &fit));
        let (short_fit, short_validation) = remote_cue_aware_windows(240.0, &[]);
        assert_eq!(ids(&short_fit), vec!["fit-whole"]);
        assert!(short_validation.is_empty());
    }

    #[test]
    fn ordinary_episode_has_disjoint_fit_and_validation_windows() {
        let fit = fit_windows(1_200.0);
        let excluded = ids(&fit)
            .into_iter()
            .map(str::to_string)
            .collect::<Vec<_>>();
        let validation = validation_windows(1_200.0, &excluded);
        assert_eq!(ids(&fit), vec!["fit-early", "fit-late"]);
        assert_eq!(
            ids(&validation),
            vec!["validation-middle-a", "validation-middle-b"]
        );
        assert!(windows_are_disjoint(&validation, &fit));
    }

    #[test]
    fn remote_validation_stays_disjoint_but_fetches_less_audio() {
        let duration = 5400.0;
        let excluded = fit_windows(duration)
            .iter()
            .map(|window| window.id.clone())
            .collect::<Vec<_>>();
        let local = validation_windows(duration, &excluded);
        let remote = remote_validation_windows(duration, &excluded);
        assert_eq!(remote.len(), 2);
        assert_eq!(
            remote.iter().map(|w| w.id.as_str()).collect::<Vec<_>>(),
            vec!["validation-middle-a", "validation-middle-b"],
        );
        assert!(windows_are_disjoint(&remote, &fit_windows(duration)));
        for (small, large) in remote.iter().zip(local.iter()) {
            assert!(small.len_sec <= REMOTE_VALIDATION_WINDOW_SEC);
            assert!(small.start_sec >= large.start_sec);
            assert!(small.end_sec() <= large.end_sec());
        }
        assert!(remote_validation_windows(299.0, &[]).is_empty());
    }

    #[test]
    fn five_minute_boundary_is_feasible_but_short_clips_are_unknown() {
        let fit = fit_windows(300.0);
        let excluded = ids(&fit)
            .into_iter()
            .map(str::to_string)
            .collect::<Vec<_>>();
        assert_eq!(validation_windows(300.0, &excluded).len(), 2);
        assert!(validation_windows(299.9, &["fit-whole".to_string()]).is_empty());
    }

    #[test]
    fn unknown_fit_provenance_refuses_default_validation() {
        assert!(validation_windows(5_400.0, &["fit-unknown".to_string()]).is_empty());
    }

    #[test]
    fn explicit_ranges_preserve_ids_and_reject_overlap_or_invalid_geometry() {
        let requested = vec![
            RequestedValidationWindow {
                id: "pivot-held-out-1".to_string(),
                from_sec: 400.0,
                to_sec: 416.0,
            },
            RequestedValidationWindow {
                id: "pivot-held-out-2".to_string(),
                from_sec: 700.0,
                to_sec: 716.0,
            },
        ];
        assert_eq!(
            ids(&explicit_validation_windows(1_200.0, &requested, &[])),
            vec!["pivot-held-out-1", "pivot-held-out-2"]
        );
        let overlapping = AnalysisWindow {
            id: "fit".to_string(),
            start_sec: 390.0,
            len_sec: 20.0,
        };
        assert!(explicit_validation_windows(1_200.0, &requested, &[overlapping]).is_empty());

        let duplicate = vec![requested[0].clone(), requested[0].clone()];
        assert!(explicit_validation_windows(1_200.0, &duplicate, &[]).is_empty());
    }
}
