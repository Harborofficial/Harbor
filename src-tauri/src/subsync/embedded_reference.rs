//! Short, read-only embedded text subtitle reference extraction for Auto sync.
//! Never changes mpv's selected subtitle. Only FFmpeg's supported text subtitle
//! streams can become reference cues. Raw URLs, headers and decoder stderr are
//! intentionally excluded from errors and diagnostic output.
use std::collections::HashMap;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tokio::process::Command;

const MAX_WINDOWS: usize = 3;
const MAX_STREAM_INDEX: u32 = 31;
const MAX_WINDOW_SECONDS: f64 = 120.0;
const MAX_SRT_BYTES: usize = 384 * 1024;
const WINDOW_DEADLINE: Duration = Duration::from_secs(10);

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReferenceWindow {
    start_sec: f64,
    len_sec: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReferenceExcerpt {
    start_sec: f64,
    len_sec: f64,
    srt: String,
}

fn valid_window(w: &ReferenceWindow) -> bool {
    w.start_sec.is_finite()
        && w.len_sec.is_finite()
        && w.start_sec >= 0.0
        && (30.0..=MAX_WINDOW_SECONDS).contains(&w.len_sec)
        && w.start_sec <= 86_400.0
}

#[tauri::command]
pub async fn subsync_embedded_reference(
    source: String,
    headers: Option<HashMap<String, String>>,
    stream_index: u32,
    windows: Vec<ReferenceWindow>,
    session_id: Option<String>,
) -> Result<Vec<ReferenceExcerpt>, String> {
    super::url_guard::validate_media_url(&source, true)
        .map_err(|_| "reference-source-not-allowed".to_string())?;
    if stream_index > MAX_STREAM_INDEX
        || windows.is_empty()
        || windows.len() > MAX_WINDOWS
        || windows.iter().any(|w| !valid_window(w))
    {
        return Err("reference-invalid-request".into());
    }
    let ffmpeg = crate::transcode::locate_ffmpeg().ok_or("ffmpeg-unavailable")?;
    let hdrs = headers.unwrap_or_default();
    let remote = source.starts_with("http://") || source.starts_with("https://");
    let map_spec = format!("0:s:{stream_index}");

    // A remote MKV's cue index can provide exact, independently located
    // subtitle excerpts. This avoids seeking through huge debrid videos and
    // uses the same selected subtitle ordinal as the full extractor.
    let samples: Vec<(f64, f64)> = windows.iter().map(|w| (w.start_sec, w.len_sec)).collect();
    let indexed = super::analysis_control::run(
        session_id.as_deref(),
        tokio::time::timeout(
            Duration::from_secs(18),
            crate::indexed_mkv_subtitles::extract(
                &source,
                stream_index,
                Some(&hdrs),
                Some(&samples),
            ),
        ),
    )
    .await?;
    if let Ok(Some(cues)) = indexed {
        let excerpts: Vec<_> = windows
            .iter()
            .filter_map(|w| {
                let start_ms = (w.start_sec * 1000.0).round() as u64;
                let end_ms = ((w.start_sec + w.len_sec) * 1000.0).round() as u64;
                let sample: Vec<_> = cues
                    .iter()
                    .filter(|cue| cue.start_ms >= start_ms && cue.start_ms < end_ms)
                    .cloned()
                    .collect();
                if sample.is_empty() {
                    return None;
                }
                let srt = crate::indexed_mkv_subtitles::to_srt(&sample, start_ms);
                (!srt.trim().is_empty() && srt.len() <= MAX_SRT_BYTES).then_some(ReferenceExcerpt {
                    start_sec: w.start_sec,
                    len_sec: w.len_sec,
                    srt,
                })
            })
            .collect();
        if !excerpts.is_empty() {
            return Ok(excerpts);
        }
    }

    let mut excerpts = Vec::with_capacity(windows.len());
    for window in windows {
        let mut cmd = Command::new(&ffmpeg);
        cmd.args(["-nostdin", "-hide_banner", "-loglevel", "error"]);
        if remote {
            cmd.arg("-user_agent")
                .arg(super::url_guard::user_agent(&hdrs).unwrap_or_else(|| "Harbor".into()));
            let blob = super::url_guard::safe_header_blob(&hdrs);
            if !blob.is_empty() {
                cmd.arg("-headers").arg(blob);
            }
        }
        // Use short independently sought excerpts rather than reading the
        // entire source. FFmpeg rebases SRT timestamps to the input seek;
        // the frontend adds the requested start offset back.
        cmd.arg("-ss")
            .arg(format!("{:.3}", window.start_sec))
            .arg("-i")
            .arg(&source)
            .arg("-t")
            .arg(format!("{:.3}", window.len_sec))
            .arg("-map")
            .arg(&map_spec)
            .args(["-an", "-vn", "-dn", "-c:s", "srt", "-f", "srt", "-"]);
        cmd.kill_on_drop(true);
        #[cfg(windows)]
        cmd.creation_flags(0x0800_0000 | 0x0000_4000);
        let output = super::analysis_control::run(
            session_id.as_deref(),
            tokio::time::timeout(WINDOW_DEADLINE, cmd.output()),
        )
        .await?;
        // An optional reference must not poison Auto sync if a remote range
        // cannot be read. Check the remaining independent windows.
        let Ok(Ok(output)) = output else {
            continue;
        };
        if !output.status.success() || output.stdout.len() > MAX_SRT_BYTES {
            continue;
        }
        let Ok(srt) = String::from_utf8(output.stdout) else {
            continue;
        };
        if srt.trim().is_empty() {
            continue;
        }
        excerpts.push(ReferenceExcerpt {
            start_sec: window.start_sec,
            len_sec: window.len_sec,
            srt,
        });
    }
    Ok(excerpts)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_unbounded_reference_windows() {
        assert!(valid_window(&ReferenceWindow {
            start_sec: 1200.0,
            len_sec: 85.0
        }));
        assert!(!valid_window(&ReferenceWindow {
            start_sec: f64::NAN,
            len_sec: 85.0
        }));
        assert!(!valid_window(&ReferenceWindow {
            start_sec: 0.0,
            len_sec: 121.0
        }));
        assert!(!valid_window(&ReferenceWindow {
            start_sec: 0.0,
            len_sec: 12.0
        }));
        assert!(!valid_window(&ReferenceWindow {
            start_sec: -1.0,
            len_sec: 85.0
        }));
    }
}
