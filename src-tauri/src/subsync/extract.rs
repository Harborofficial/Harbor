use std::collections::HashMap;
use std::time::Duration;
use tokio::process::Command;

use crate::transcode::locate_ffmpeg;

use super::vad;

const NOISE_DB: &str = "-30dB";
const MIN_SILENCE: &str = "0.35";
const SPEECH_FILTER: &str = "aformat=channel_layouts=mono,highpass=f=200,lowpass=f=3000";
const HARD_TIMEOUT_SECS: u64 = 90;

fn ffmpeg_failure_bucket(stderr: &str) -> &'static str {
    let lower = stderr.to_ascii_lowercase();
    if lower.contains("401")
        || lower.contains("403")
        || lower.contains("unauthorized")
        || lower.contains("forbidden")
    {
        "http-auth"
    } else if lower.contains("does not contain any stream")
        || lower.contains("matches no streams")
        || lower.contains("stream map")
    {
        "audio-track"
    } else if lower.contains("seek") || lower.contains("range not satisfiable") {
        "remote-seek"
    } else if lower.contains("timed out") || lower.contains("timeout") {
        "network-timeout"
    } else if lower.contains("invalid data") || lower.contains("moov atom not found") {
        "container"
    } else if lower.contains("decoder") || lower.contains("error while decoding") {
        "audio-decode"
    } else {
        "other"
    }
}

fn parse_after(line: &str, tag: &str) -> Option<f32> {
    let idx = line.find(tag)?;
    let rest = &line[idx + tag.len()..];
    rest.split_whitespace().next()?.parse::<f32>().ok()
}

fn complement(silences: &mut [(f32, f32)], len: f32, offset: f32) -> Vec<(f32, f32)> {
    silences.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));
    let mut speech = Vec::new();
    let mut cursor = 0.0f32;
    for &(s, e) in silences.iter() {
        if s > cursor {
            speech.push((cursor + offset, s + offset));
        }
        cursor = cursor.max(e);
    }
    if cursor < len {
        speech.push((cursor + offset, len + offset));
    }
    speech
}

pub async fn speech_intervals(
    url: &str,
    headers: &HashMap<String, String>,
    start_sec: f32,
    len_sec: f32,
    map_spec: &str,
    from_start: bool,
) -> Result<Vec<(f32, f32)>, String> {
    let Some(ff) = locate_ffmpeg() else {
        return Err("ffmpeg not found".into());
    };
    let mut cmd = Command::new(&ff);
    cmd.arg("-hide_banner").arg("-nostats");
    let ua = super::url_guard::user_agent(headers);
    // FFmpeg rejects HTTP-only options when reading a local WAV cache clip.
    if url.starts_with("http://") || url.starts_with("https://") {
        cmd.arg("-user_agent")
            .arg(ua.unwrap_or_else(|| "Harbor".into()));
        let blob = super::url_guard::safe_header_blob(headers);
        if !blob.is_empty() {
            cmd.arg("-headers").arg(blob);
        }
    }
    if !from_start {
        cmd.arg("-ss")
            .arg(format!("{}", start_sec))
            .arg("-t")
            .arg(format!("{}", len_sec));
    }
    cmd.arg("-i").arg(url);
    if from_start {
        // A dumped cache can start at the movie's timestamp rather than 0; decode
        // from the beginning and discard until the requested offset instead.
        cmd.arg("-ss")
            .arg(format!("{}", start_sec))
            .arg("-t")
            .arg(format!("{}", len_sec));
    }
    cmd.arg("-vn")
        .arg("-map")
        .arg(map_spec)
        .arg("-af")
        .arg(format!(
            "{}{},silencedetect=noise={}:d={}",
            if from_start {
                "asetpts=PTS-STARTPTS,"
            } else {
                ""
            },
            SPEECH_FILTER,
            NOISE_DB,
            MIN_SILENCE
        ))
        .arg("-f")
        .arg("null")
        .arg("-");
    cmd.stdout(std::process::Stdio::null());
    cmd.stderr(std::process::Stdio::piped());
    cmd.kill_on_drop(true);
    #[cfg(windows)]
    cmd.creation_flags(0x0800_0000 | 0x0000_4000);

    let output = tokio::time::timeout(Duration::from_secs(HARD_TIMEOUT_SECS), cmd.output())
        .await
        .map_err(|_| "ffmpeg-timeout".to_string())?
        .map_err(|error| format!("run ffmpeg: {}", error))?;
    if !output.status.success() {
        // Never include stderr itself: authenticated URLs and headers may
        // appear in FFmpeg logs. Export only a stable diagnostic bucket.
        return Err(format!(
            "ffmpeg-failed:{}",
            ffmpeg_failure_bucket(&String::from_utf8_lossy(&output.stderr))
        ));
    }
    let mut silences: Vec<(f32, f32)> = Vec::new();
    let mut open_start: Option<f32> = None;
    for line in String::from_utf8_lossy(&output.stderr).lines() {
        if let Some(value) = parse_after(line, "silence_start:") {
            open_start = Some(value);
        } else if let Some(value) = parse_after(line, "silence_end:") {
            if let Some(start) = open_start.take() {
                silences.push((start, value));
            }
        }
    }
    if let Some(start) = open_start {
        silences.push((start, len_sec));
    }

    Ok(complement(&mut silences, len_sec, start_sec))
}

pub async fn speech_intervals_reference(
    url: &str,
    headers: &HashMap<String, String>,
    start_sec: f32,
    len_sec: f32,
    map_spec: &str,
    from_start: bool,
) -> Result<Vec<(f32, f32)>, String> {
    if from_start {
        return speech_intervals(url, headers, start_sec, len_sec, map_spec, true).await;
    }
    match vad::speech_intervals_ml(
        url,
        headers,
        start_sec,
        len_sec,
        &vad::VadConfig::default(),
        vad::Backend::Heuristic,
        map_spec,
    )
    .await
    {
        Ok(iv) => Ok(iv),
        Err(_) => speech_intervals(url, headers, start_sec, len_sec, map_spec, false).await,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ffmpeg_failures_have_sanitized_stage_codes() {
        assert_eq!(
            ffmpeg_failure_bucket("HTTP error 403 Forbidden https://token/abc"),
            "http-auth"
        );
        assert_eq!(
            ffmpeg_failure_bucket("Stream map 0:a:1 matches no streams."),
            "audio-track"
        );
        assert_eq!(
            ffmpeg_failure_bucket("HTTP Range not satisfiable"),
            "remote-seek"
        );
        assert_eq!(
            ffmpeg_failure_bucket("Invalid data found when processing input"),
            "container"
        );
        assert_eq!(ffmpeg_failure_bucket("unrecognized private token"), "other");
    }

    #[test]
    fn complement_inverts_silence() {
        let mut sil = vec![(2.0f32, 4.0f32), (7.0f32, 8.0f32)];
        let speech = complement(&mut sil, 10.0, 100.0);
        assert_eq!(speech, vec![(100.0, 102.0), (104.0, 107.0), (108.0, 110.0)]);
    }

    #[test]
    fn parse_after_reads_value() {
        assert_eq!(
            parse_after(
                "[silencedetect @ 0x1] silence_start: 12.34",
                "silence_start:"
            ),
            Some(12.34)
        );
    }
}
