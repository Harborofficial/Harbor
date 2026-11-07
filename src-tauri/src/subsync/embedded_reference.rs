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
const WINDOW_DEADLINE: Duration = Duration::from_secs(30);

fn extraction_failure(stderr: &[u8]) -> &'static str {
    let text = String::from_utf8_lossy(stderr).to_ascii_lowercase();
    if text.contains("403 forbidden") || text.contains("401 unauthorized") {
        "reference-access-denied"
    } else if text.contains("matches no streams") {
        "reference-track-missing"
    } else if text.contains("timed out") {
        "reference-read-timeout"
    } else {
        "reference-decode-failed"
    }
}

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
    timestamps_absolute: bool,
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
    let (user_agent, _) = crate::mpv::stream_http_options(&headers);
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
                    timestamps_absolute: false,
                    srt,
                })
            })
            .collect();
        // One indexed excerpt cannot establish an independent timing match.
        // Sparse subtitle indexes must not prevent the FFmpeg fallback from
        // reading the other requested scenes.
        if excerpts.len() >= 2 {
            return Ok(excerpts);
        }
    }

    // Run bounded remote seeks concurrently: 18s index + 30s fallback.
    let reads = windows.into_iter().map(|window| {
        let ffmpeg = &ffmpeg;
        let user_agent = &user_agent;
        let hdrs = &hdrs;
        let source = &source;
        let map_spec = &map_spec;
        let session_id = &session_id;
        async move {
            let mut cmd = Command::new(&ffmpeg);
            cmd.args(["-nostdin", "-hide_banner", "-loglevel", "error"]);
            if remote {
                cmd.arg("-user_agent").arg(user_agent);
                let blob = super::url_guard::safe_header_blob(&hdrs);
                if !blob.is_empty() {
                    cmd.arg("-headers").arg(blob);
                }
            }
            // Preserve the media clock. Default SRT muxing may shift the first
            // returned cue to zero, which is not the requested seek position.
            cmd.arg("-copyts")
                .arg("-ss")
                .arg(format!("{:.3}", window.start_sec))
                .arg("-i")
                .arg(&source)
                .arg("-to")
                .arg(format!("{:.3}", window.start_sec + window.len_sec))
                .args(["-avoid_negative_ts", "disabled"])
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
            let output = output
                .map_err(|_| "reference-read-timeout".to_string())?
                .map_err(|_| "reference-spawn-failed".to_string())?;
            if !output.status.success() {
                return Err(extraction_failure(&output.stderr).to_string());
            }
            if output.stdout.len() > MAX_SRT_BYTES {
                return Err("reference-output-too-large".to_string());
            }
            let srt = String::from_utf8(output.stdout)
                .map_err(|_| "reference-invalid-text".to_string())?;
            if srt.trim().is_empty() {
                return Ok(None);
            }
            Ok(Some(ReferenceExcerpt {
                start_sec: window.start_sec,
                len_sec: window.len_sec,
                timestamps_absolute: true,
                srt,
            }))
        }
    });
    let mut excerpts = Vec::new();
    let mut failure = None;
    for result in futures_util::future::join_all(reads).await {
        match result {
            Ok(Some(excerpt)) => excerpts.push(excerpt),
            Ok(None) => {}
            Err(error) => failure = Some(error),
        }
    }
    if excerpts.is_empty() {
        if let Some(error) = failure {
            return Err(error);
        }
    }
    Ok(excerpts)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn classifies_errors_without_exporting_private_details() {
        assert_eq!(
            extraction_failure(b"https://private: 403 Forbidden"),
            "reference-access-denied"
        );
        assert_eq!(
            extraction_failure(b"Stream map matches no streams"),
            "reference-track-missing"
        );
        assert_eq!(
            extraction_failure(b"Connection timed out"),
            "reference-read-timeout"
        );
        assert_eq!(
            extraction_failure(b"private decoder details"),
            "reference-decode-failed"
        );
    }

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
