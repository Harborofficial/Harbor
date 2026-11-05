use realfft::num_complex::Complex;
use realfft::RealFftPlanner;

pub const GRID_HZ: f32 = 100.0;
const MAX_LAG_SEC: f32 = 60.0;
const Z_MIN: f32 = 6.0;
const DOMINANCE_MIN: f32 = 1.3;

pub struct SyncResult {
    pub offset_sec: f32,
    pub ratio: f32,
    pub confidence: f32,
}

fn ratios() -> Vec<f32> {
    let base = [1.0f32, 1.25, 0.8, 1.0427, 1.00092, 1.04167];
    let mut v: Vec<f32> = Vec::new();
    for &r in base.iter() {
        if !v.iter().any(|x| (x - r).abs() < 1e-5) {
            v.push(r);
        }
        let inv = 1.0 / r;
        if (inv - 1.0).abs() > 1e-4 && !v.iter().any(|x| (x - inv).abs() < 1e-5) {
            v.push(inv);
        }
    }
    v
}

fn rasterize(intervals: &[(f32, f32)], scale: f32, len: usize) -> Vec<f32> {
    let mut m = vec![0f32; len];
    for &(a, b) in intervals {
        let s = ((a * scale * GRID_HZ).round().max(0.0)) as usize;
        let e = ((b * scale * GRID_HZ).round().max(0.0)) as usize;
        for x in m.iter_mut().take(e.min(len)).skip(s.min(len)) {
            *x = 1.0;
        }
    }
    m
}

fn fft_xcorr(a: &[f32], b: &[f32], max_lag: usize) -> Vec<f32> {
    let n = a.len().max(b.len());
    let m = (n + max_lag + 1).next_power_of_two();
    let mut planner = RealFftPlanner::<f32>::new();
    let fwd = planner.plan_fft_forward(m);
    let inv = planner.plan_fft_inverse(m);
    let mut abuf = fwd.make_input_vec();
    let mut bbuf = fwd.make_input_vec();
    abuf[..a.len()].copy_from_slice(a);
    bbuf[..b.len()].copy_from_slice(b);
    let mut aspec = fwd.make_output_vec();
    let mut bspec = fwd.make_output_vec();
    if fwd.process(&mut abuf, &mut aspec).is_err() || fwd.process(&mut bbuf, &mut bspec).is_err() {
        return vec![0f32; 2 * max_lag + 1];
    }
    let mut prod: Vec<Complex<f32>> = aspec
        .iter()
        .zip(bspec.iter())
        .map(|(&x, &y)| x * y.conj())
        .collect();
    let mut out = inv.make_output_vec();
    if inv.process(&mut prod, &mut out).is_err() {
        return vec![0f32; 2 * max_lag + 1];
    }
    let norm = m as f32;
    let mut res = vec![0f32; 2 * max_lag + 1];
    for l in 0..=max_lag {
        res[max_lag + l] = out[l] / norm;
        if l > 0 {
            res[max_lag - l] = out[m - l] / norm;
        }
    }
    res
}

fn peak_stats(corr: &[f32]) -> (usize, f32, f32) {
    let n = corr.len();
    let mut peak = f32::MIN;
    let mut pidx = 0;
    for (i, &v) in corr.iter().enumerate() {
        if v > peak {
            peak = v;
            pidx = i;
        }
    }
    let mean = corr.iter().sum::<f32>() / n as f32;
    let var = corr.iter().map(|&v| (v - mean).powi(2)).sum::<f32>() / n as f32;
    let std = var.sqrt().max(1e-9);
    let z = (peak - mean) / std;
    let guard = GRID_HZ as usize;
    let mut second = f32::MIN;
    for (i, &v) in corr.iter().enumerate() {
        let far = (i + guard) < pidx || i > (pidx + guard);
        if far && v > second {
            second = v;
        }
    }
    let dominance = if second > 1e-6 {
        peak / second
    } else {
        f32::INFINITY
    };
    (pidx, z, dominance)
}

fn ncc_at(a: &[f32], b: &[f32], lag: isize) -> f32 {
    let (mut sx, mut sy, mut cnt) = (0.0f32, 0.0f32, 0.0f32);
    for (i, &x) in a.iter().enumerate() {
        let j = i as isize - lag;
        if j < 0 || j as usize >= b.len() {
            continue;
        }
        sx += x;
        sy += b[j as usize];
        cnt += 1.0;
    }
    if cnt < 1.0 {
        return 0.0;
    }
    let (mx, my) = (sx / cnt, sy / cnt);
    let (mut xy, mut xx, mut yy) = (0.0f32, 0.0f32, 0.0f32);
    for (i, &x) in a.iter().enumerate() {
        let j = i as isize - lag;
        if j < 0 || j as usize >= b.len() {
            continue;
        }
        let dx = x - mx;
        let dy = b[j as usize] - my;
        xy += dx * dy;
        xx += dx * dx;
        yy += dy * dy;
    }
    let denom = (xx * yy).sqrt();
    if denom < 1e-9 {
        0.0
    } else {
        xy / denom
    }
}

#[derive(Clone, Copy, Debug)]
pub struct MatchMetrics {
    pub offset_sec: f32,
    pub ratio: f32,
    pub ncc: f32,
    pub z: f32,
    pub dominance: f32,
}

impl MatchMetrics {
    pub fn is_reliable(&self, min_confidence: f32, total_sec: f32) -> bool {
        // In a one-minute excerpt, a perfect alignment can have z < 6
        // because the correlation contains fewer independent lag samples.
        // Demand stronger correlation and uniqueness in exchange.
        let short_clip = total_sec <= 90.0;
        let ncc_min = if short_clip {
            min_confidence.max(0.65)
        } else {
            min_confidence
        };
        let z_min = if short_clip { 4.5 } else { Z_MIN };
        let dominance_min = if short_clip { 1.5 } else { DOMINANCE_MIN };
        self.ncc >= ncc_min
            && self.z >= z_min
            && self.dominance >= dominance_min
            && self.offset_sec.is_finite()
    }
}

/// Preserve the best rejected candidate for diagnostics. The strongest NCC
/// alone is not necessarily trustworthy: it can be an ambiguous peak while a
/// slightly weaker peak at another frame ratio passes all reliability gates.
pub fn solve_with_metrics(
    audio: &[(f32, f32)],
    cues: &[(f32, f32)],
    total_sec: f32,
    conf_min: f32,
) -> (Option<SyncResult>, Option<MatchMetrics>) {
    let len = ((total_sec * GRID_HZ).round() as usize).max(1);
    if cues.is_empty() || audio.is_empty() || len < 2 || !total_sec.is_finite() {
        return (None, None);
    }
    if total_sec <= 90.0 && (audio.len() < 4 || cues.len() < 4) {
        return (None, None);
    }
    let amask = rasterize(audio, 1.0, len);
    // A 60s clip cannot reliably support a 59s shift: NCC at that lag is
    // calculated from only one second of overlapping data. Require at least
    // 30 seconds' overlap, without reducing the range for normal full films.
    let max_lag_sec = MAX_LAG_SEC.min((total_sec - 30.0).max(1.0));
    let max_lag = (max_lag_sec * GRID_HZ) as usize;
    let mut best_valid: Option<MatchMetrics> = None;
    let mut best_attempt: Option<MatchMetrics> = None;
    // A minute can establish a local shift but cannot reliably establish
    // long-term frame-rate drift. The UI applies delay only for this mode.
    let candidate_ratios = if total_sec <= 90.0 {
        vec![1.0]
    } else {
        ratios()
    };
    for r in candidate_ratios {
        let bmask = rasterize(cues, r, len);
        let corr = fft_xcorr(&amask, &bmask, max_lag);
        let (pidx, z, dominance) = peak_stats(&corr);
        let lag = pidx as isize - max_lag as isize;
        let metrics = MatchMetrics {
            ratio: r,
            offset_sec: lag as f32 / GRID_HZ,
            ncc: ncc_at(&amask, &bmask, lag),
            z,
            dominance,
        };
        if !metrics.ncc.is_finite() {
            continue;
        }
        if best_attempt
            .map(|existing| metrics.ncc > existing.ncc)
            .unwrap_or(true)
        {
            best_attempt = Some(metrics);
        }
        if metrics.is_reliable(conf_min, total_sec)
            && best_valid
                .map(|existing| metrics.ncc > existing.ncc)
                .unwrap_or(true)
        {
            best_valid = Some(metrics);
        }
    }
    let reported = best_valid.or(best_attempt);
    if let Some(metrics) = reported {
        eprintln!(
            "[subsync] match ratio={:.4} offset={:.2}s ncc={:.3} z={:.1} dom={:.2} accepted={} (min ncc={:.2} z={:.1} dom={:.1})",
            metrics.ratio, metrics.offset_sec, metrics.ncc, metrics.z, metrics.dominance,
            best_valid.is_some(),
            if total_sec <= 90.0 { conf_min.max(0.65) } else { conf_min },
            if total_sec <= 90.0 { 4.5 } else { Z_MIN },
            if total_sec <= 90.0 { 1.5 } else { DOMINANCE_MIN }
        );
    }
    (
        best_valid.map(|m| SyncResult {
            offset_sec: m.offset_sec,
            ratio: m.ratio,
            confidence: m.ncc,
        }),
        reported,
    )
}

pub fn solve(
    audio: &[(f32, f32)],
    cues: &[(f32, f32)],
    total_sec: f32,
    conf_min: f32,
) -> Option<SyncResult> {
    solve_with_metrics(audio, cues, total_sec, conf_min).0
}

#[derive(serde::Serialize)]
pub struct AlignmentQuality {
    pub ncc: f32,
    pub coverage: f32,
    pub z: f32,
}

fn coverage_at(a: &[f32], b: &[f32], lag: isize) -> f32 {
    let (mut on_cue, mut on_both) = (0.0f32, 0.0f32);
    for (i, &x) in a.iter().enumerate() {
        let j = i as isize - lag;
        if j < 0 || j as usize >= b.len() {
            continue;
        }
        if b[j as usize] > 0.0 {
            on_cue += 1.0;
            if x > 0.0 {
                on_both += 1.0;
            }
        }
    }
    if on_cue > 0.0 {
        on_both / on_cue
    } else {
        0.0
    }
}

fn z_at(a: &[f32], b: &[f32], lag: isize) -> f32 {
    let max_lag = (MAX_LAG_SEC * GRID_HZ) as usize;
    let corr = fft_xcorr(a, b, max_lag);
    let n = corr.len();
    if n == 0 {
        return 0.0;
    }
    let mean = corr.iter().sum::<f32>() / n as f32;
    let var = corr.iter().map(|&v| (v - mean).powi(2)).sum::<f32>() / n as f32;
    let std = var.sqrt().max(1e-9);
    let idx = (max_lag as isize + lag).clamp(0, n as isize - 1) as usize;
    (corr[idx] - mean) / std
}

pub fn score_affine(
    speech: &[(f32, f32)],
    cues: &[(f32, f32)],
    total_sec: f32,
    offset: f32,
    ratio: f32,
) -> AlignmentQuality {
    let len = ((total_sec * GRID_HZ).round() as usize).max(1);
    if speech.is_empty() || cues.is_empty() || len < 2 {
        return AlignmentQuality {
            ncc: 0.0,
            coverage: 0.0,
            z: 0.0,
        };
    }
    let amask = rasterize(speech, 1.0, len);
    let bmask = rasterize(cues, ratio, len);
    let lag = (offset * GRID_HZ).round() as isize;
    let ncc = ncc_at(&amask, &bmask, lag).max(0.0);
    let coverage = coverage_at(&amask, &bmask, lag);
    let z = z_at(&amask, &bmask, lag);
    AlignmentQuality { ncc, coverage, z }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cue_pattern() -> Vec<(f32, f32)> {
        let gaps = [
            4.3f32, 6.1, 3.2, 7.4, 5.0, 3.9, 8.2, 4.7, 6.6, 3.5, 5.8, 7.1,
        ];
        let mut t = 5.0f32;
        let mut cues = Vec::new();
        for k in 0..26 {
            let dur = 1.0 + (k % 4) as f32 * 0.3;
            cues.push((t, t + dur));
            t += dur + gaps[k % gaps.len()];
        }
        cues
    }

    #[test]
    fn live_minute_recovers_distinct_dialogue_offset() {
        let cues = [
            (4.0, 5.2),
            (8.5, 10.3),
            (14.2, 15.8),
            (21.6, 23.0),
            (27.1, 28.5),
            (32.6, 34.1),
            (40.2, 41.4),
            (45.9, 47.3),
        ];
        let audio: Vec<_> = cues.iter().map(|&(a, b)| (a + 3.2, b + 3.2)).collect();
        let result = solve(&audio, &cues, 60.0, 0.55).expect("minute should align");
        assert!((result.offset_sec - 3.2).abs() < 0.1);
    }

    #[test]
    fn live_minute_with_unbroken_noise_is_not_trusted() {
        let cues = [(4.0, 5.0), (12.0, 13.0), (22.0, 23.0), (37.0, 39.0)];
        assert!(solve(&[(0.0, 60.0)], &cues, 60.0, 0.55).is_none());
    }

    #[test]
    fn recovers_flat_offset() {
        let cues = cue_pattern();
        let audio: Vec<(f32, f32)> = cues.iter().map(|&(a, b)| (a + 7.3, b + 7.3)).collect();
        let r = solve(&audio, &cues, 260.0, 0.55).expect("should sync");
        assert!((r.offset_sec - 7.3).abs() < 0.05, "offset {}", r.offset_sec);
        assert!((r.ratio - 1.0).abs() < 1e-4, "ratio {}", r.ratio);
    }

    #[test]
    fn recovers_fps_drift() {
        let cues = cue_pattern();
        let audio: Vec<(f32, f32)> = cues.iter().map(|&(a, b)| (a * 1.25, b * 1.25)).collect();
        let r = solve(&audio, &cues, 340.0, 0.55).expect("should sync drift");
        assert!((r.ratio - 1.25).abs() < 1e-3, "ratio {}", r.ratio);
    }

    #[test]
    fn declines_on_no_structure() {
        let cues = cue_pattern();
        let audio = vec![(0.0f32, 260.0f32)];
        assert!(solve(&audio, &cues, 260.0, 0.55).is_none());
    }

    #[test]
    fn score_rewards_correct_offset() {
        let cues = cue_pattern();
        let audio: Vec<(f32, f32)> = cues.iter().map(|&(a, b)| (a + 7.3, b + 7.3)).collect();
        let good = score_affine(&audio, &cues, 260.0, 7.3, 1.0);
        let bad = score_affine(&audio, &cues, 260.0, 0.0, 1.0);
        assert!(good.ncc > 0.9, "good ncc {}", good.ncc);
        assert!(good.coverage > 0.8, "coverage {}", good.coverage);
        assert!(
            good.ncc > bad.ncc + 0.2,
            "good {} bad {}",
            good.ncc,
            bad.ncc
        );
    }

    #[test]
    fn score_recovers_ratio_drift() {
        let cues = cue_pattern();
        let audio: Vec<(f32, f32)> = cues.iter().map(|&(a, b)| (a * 1.25, b * 1.25)).collect();
        let good = score_affine(&audio, &cues, 340.0, 0.0, 1.25);
        let flat = score_affine(&audio, &cues, 340.0, 0.0, 1.0);
        assert!(
            good.ncc > flat.ncc + 0.2,
            "drift {} flat {}",
            good.ncc,
            flat.ncc
        );
    }
}
