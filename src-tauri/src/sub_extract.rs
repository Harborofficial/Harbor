use std::collections::HashMap;
#[cfg(windows)]
use std::os::windows::process::CommandExt;
use std::time::Duration;

const EXTRACT_TIMEOUT: Duration = Duration::from_secs(90);
const MAX_SRT_BYTES: usize = 4 * 1024 * 1024;

#[tauri::command]
pub async fn subtitle_extract(
    source: String,
    stream_index: Option<u32>,
    headers: Option<HashMap<String, String>>,
) -> Result<String, String> {
    // Export the whole track in one pass. Per-cue range reads are useful for
    // Auto Sync's short samples but add a round trip for each cue in a full export.
    let ffmpeg = crate::transcode::locate_ffmpeg().ok_or_else(|| "ffmpeg not found".to_string())?;
    let map = format!("0:s:{}", stream_index.unwrap_or(0));
    let mut cmd = std::process::Command::new(&ffmpeg);
    cmd.arg("-nostdin").arg("-loglevel").arg("error");
    let remote = source.starts_with("https://") || source.starts_with("http://");
    if remote {
        let (ua, _) = crate::mpv::stream_http_options(&headers);
        cmd.arg("-user_agent").arg(ua);
        if let Some(h) = &headers {
            let fields = crate::subsync::url_guard::safe_header_blob(h);
            if !fields.is_empty() {
                cmd.arg("-headers").arg(fields);
            }
        }
        cmd.arg("-rw_timeout")
            .arg(EXTRACT_TIMEOUT.as_micros().to_string());
    }
    cmd.arg("-i")
        .arg(&source)
        .arg("-map")
        .arg(&map)
        .arg("-f")
        .arg("srt")
        .arg("-");
    #[cfg(windows)]
    {
        cmd.creation_flags(0x0800_0000);
    }
    cmd.stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    // Full remote track extraction can run longer than an individual network read.
    // Keep the remote Windows-safe process reader so cancellation reaps ffmpeg.
    let deadline = if remote {
        Duration::from_secs(600)
    } else {
        EXTRACT_TIMEOUT
    };
    let output = match crate::process_output::output(cmd, deadline).await {
        Ok(o) => o,
        Err(e) if e.kind() == std::io::ErrorKind::TimedOut => {
            return Err("subtitle extraction timed out".to_string())
        }
        Err(e) => return Err(format!("ffmpeg spawn: {}", e)),
    };
    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr);
        let reason = if err.contains("403 Forbidden") || err.contains("401 Unauthorized") {
            "subtitle source denied access"
        } else if err.contains("matches no streams") {
            "subtitle track missing"
        } else if err.contains("bitmap to bitmap") {
            "image subtitle track"
        } else if err.to_ascii_lowercase().contains("timed out") {
            "subtitle extraction timed out"
        } else {
            "ffmpeg could not extract subtitle"
        };
        return Err(reason.into());
    }
    let mut bytes = output.stdout;
    if bytes.len() > MAX_SRT_BYTES {
        bytes.truncate(MAX_SRT_BYTES);
    }
    let text = String::from_utf8_lossy(&bytes).to_string();
    if text.trim().is_empty() {
        return Err("no subtitle content extracted".to_string());
    }
    Ok(text)
}

const ASS_HEADER_TIMEOUT: Duration = Duration::from_secs(30);
const MAX_ASS_BYTES: usize = 2 * 1024 * 1024;

#[tauri::command]
pub async fn subtitle_extract_ass(
    source: String,
    stream_index: Option<u32>,
    headers: Option<HashMap<String, String>>,
) -> Result<String, String> {
    let ffmpeg = crate::transcode::locate_ffmpeg().ok_or_else(|| "ffmpeg not found".to_string())?;
    let map = format!("0:s:{}", stream_index.unwrap_or(0));
    let remote = source.starts_with("https://") || source.starts_with("http://");
    let mut cmd = std::process::Command::new(&ffmpeg);
    cmd.arg("-nostdin").arg("-loglevel").arg("error");
    if remote {
        // Normalization runs while the same stream is playing, so mirror the
        // player's HTTP identity and do not let a stalled connection hold the
        // task until the whole-file deadline.
        let (ua, _) = crate::mpv::stream_http_options(&headers);
        cmd.arg("-user_agent").arg(ua);
        if let Some(h) = &headers {
            let fields = crate::subsync::url_guard::safe_header_blob(h);
            if !fields.is_empty() {
                cmd.arg("-headers").arg(fields);
            }
        }
        cmd.arg("-rw_timeout")
            .arg(ASS_HEADER_TIMEOUT.as_micros().to_string());
    }
    // Only the ASS script header (style names and font sizes) is needed for
    // normalization. Copying without a duration made ffmpeg demux the whole
    // file, which is far too slow for a remote MKV and hit the timeout.
    cmd.arg("-i")
        .arg(&source)
        .arg("-map")
        .arg(&map)
        .arg("-c:s")
        .arg("copy")
        .arg("-t")
        .arg("2")
        .arg("-f")
        .arg("ass")
        .arg("-");
    #[cfg(windows)]
    {
        cmd.creation_flags(0x0800_0000);
    }
    cmd.stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    let output = match crate::process_output::output(cmd, ASS_HEADER_TIMEOUT).await {
        Ok(o) => o,
        Err(e) if e.kind() == std::io::ErrorKind::TimedOut => {
            return Err("ass header extraction timed out".to_string())
        }
        Err(e) => return Err(format!("ffmpeg spawn: {}", e)),
    };
    let mut bytes = output.stdout;
    if bytes.len() > MAX_ASS_BYTES {
        bytes.truncate(MAX_ASS_BYTES);
    }
    let text = String::from_utf8_lossy(&bytes).to_string();
    if text.contains("[V4+ Styles]") || text.contains("[V4 Styles]") {
        return Ok(text);
    }
    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr);
        return Err(format!(
            "ffmpeg failed: {}",
            err.chars().take(200).collect::<String>()
        ));
    }
    Err("no ass header extracted".to_string())
}
