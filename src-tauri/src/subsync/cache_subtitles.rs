use serde::Deserialize;

#[derive(Deserialize)]
pub(super) struct SubtitleFrame {
    pts_time: Option<String>,
    start_display_time: Option<u32>,
    end_display_time: Option<u32>,
    num_rects: Option<u32>,
}

// Bitmap subtitles often end with a separate clear event rather than a duration.
// Never turn an unclosed display into a guessed, indefinitely visible cue.
pub(super) fn intervals(
    frames: &[SubtitleFrame],
    movie_offset: f64,
) -> Result<Vec<(f64, f64)>, String> {
    let mut out = Vec::new();
    let mut active: Option<(f64, Option<f64>)> = None;
    let mut previous = f64::NEG_INFINITY;
    for frame in frames {
        let pts = frame
            .pts_time
            .as_ref()
            .and_then(|s| s.parse::<f64>().ok())
            .filter(|v| v.is_finite())
            .ok_or("cache-subtitle-invalid")?;
        let start = pts + f64::from(frame.start_display_time.unwrap_or(0)) / 1000.0;
        if start < previous {
            return Err("cache-subtitle-invalid".into());
        }
        previous = start;
        if let Some((a, end)) = active.take() {
            let b = end.unwrap_or(start).min(start);
            if b > a {
                out.push((a + movie_offset, b + movie_offset));
            }
        }
        if frame.num_rects.ok_or("cache-subtitle-invalid")? > 0 {
            let end = frame
                .end_display_time
                .filter(|v| *v != u32::MAX)
                .map(|ms| pts + f64::from(ms) / 1000.0)
                .filter(|v| *v > start);
            active = Some((start, end));
        }
    }
    if let Some((a, Some(b))) = active {
        out.push((a + movie_offset, b + movie_offset));
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn frame(pts: &str, end: u32, rects: u32) -> SubtitleFrame {
        SubtitleFrame {
            pts_time: Some(pts.into()),
            start_display_time: Some(0),
            end_display_time: Some(end),
            num_rects: Some(rects),
        }
    }
    #[test]
    fn image_display_clear_events_recover_movie_timing() {
        let frames = [
            frame("1", u32::MAX, 0),
            frame("2", u32::MAX, 1),
            frame("4", u32::MAX, 0),
            frame("5", u32::MAX, 1),
        ];
        assert_eq!(intervals(&frames, 100.0).unwrap(), vec![(102.0, 104.0)]);
    }
    #[test]
    fn explicit_duration_and_replacement() {
        let frames = [frame("1", 4000, 1), frame("3", 1500, 1)];
        assert_eq!(
            intervals(&frames, 10.0).unwrap(),
            vec![(11.0, 13.0), (13.0, 14.5)]
        );
    }
    #[test]
    fn invalid_timestamps_fail_closed() {
        assert!(intervals(&[frame("NaN", 1000, 1)], 0.0).is_err());
        assert!(intervals(&[frame("3", 1000, 1), frame("2", 1000, 1)], 0.0).is_err());
    }
}
