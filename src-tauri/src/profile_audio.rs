use serde::Serialize;
use std::collections::BTreeMap;
use std::time::Duration;

const RESOLVE_TIMEOUT: Duration = Duration::from_secs(25);
const AUDIO_FORMAT: &str = "bestaudio[ext=m4a][protocol^=https]/bestaudio[acodec=mp4a][protocol^=https]/bestaudio[protocol^=https]/bestaudio/best";
const SEPARATOR: &str = "|||";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileAudioStream {
    url: String,
    mime_type: String,
    headers: BTreeMap<String, String>,
    expires_at: Option<u64>,
}

fn youtube_id(url: &url::Url) -> Option<String> {
    let host = url
        .host_str()?
        .trim_start_matches("www.")
        .trim_start_matches("m.");
    let id = match host {
        "youtu.be" => url
            .path()
            .trim_start_matches('/')
            .split('/')
            .next()?
            .to_string(),
        "youtube.com" | "music.youtube.com" | "youtube-nocookie.com" => {
            if let Some((_, value)) = url.query_pairs().find(|(key, _)| key == "v") {
                value.into_owned()
            } else {
                let mut segments = url.path().trim_start_matches('/').split('/');
                match (segments.next(), segments.next()) {
                    (Some("embed" | "shorts" | "v"), Some(id)) => id.to_string(),
                    _ => return None,
                }
            }
        }
        _ => return None,
    };
    let valid = id.len() == 11
        && id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_');
    valid.then_some(id)
}

fn soundcloud_url(url: &url::Url) -> Option<String> {
    let host = url.host_str()?.trim_start_matches("www.");
    if host != "soundcloud.com" && host != "m.soundcloud.com" {
        return None;
    }
    let path = url.path();
    if !path.starts_with('/') || path.len() <= 1 {
        return None;
    }
    Some(format!("https://soundcloud.com{path}"))
}

fn source_url(provider: &str, raw: &str) -> Result<String, String> {
    let url = url::Url::parse(raw.trim()).map_err(|_| "Invalid profile song URL".to_string())?;
    if url.scheme() != "https" {
        return Err("Profile songs must use https".to_string());
    }
    match provider {
        "youtube" => youtube_id(&url)
            .map(|id| format!("https://www.youtube.com/watch?v={id}"))
            .ok_or_else(|| "Invalid YouTube profile song".to_string()),
        "soundcloud" => {
            soundcloud_url(&url).ok_or_else(|| "Invalid SoundCloud profile song".to_string())
        }
        _ => Err("Unsupported profile song provider".to_string()),
    }
}

fn mime_of(extension: &str) -> String {
    match extension {
        "webm" | "opus" => "audio/webm",
        "m4a" | "mp4" | "aac" => "audio/mp4",
        "mp3" => "audio/mpeg",
        "ogg" | "oga" => "audio/ogg",
        _ => "audio/mp4",
    }
    .to_string()
}

fn expires_at(raw: &str) -> Option<u64> {
    let url = url::Url::parse(raw).ok()?;
    url.query_pairs()
        .find(|(key, _)| key.eq_ignore_ascii_case("expire") || key.eq_ignore_ascii_case("expires"))
        .and_then(|(_, value)| value.parse().ok())
}

fn parse_output(stdout: &[u8]) -> Result<ProfileAudioStream, String> {
    let text = String::from_utf8_lossy(stdout);
    let line = text
        .lines()
        .map(str::trim)
        .find(|line| line.starts_with("https://"))
        .ok_or_else(|| "Could not resolve this profile song".to_string())?;
    let mut parts = line.splitn(3, SEPARATOR);
    let url = parts.next().unwrap_or_default().trim();
    if !url.starts_with("https://") {
        return Err("Could not resolve this profile song".to_string());
    }
    let extension = parts.next().unwrap_or_default().trim();
    let headers = match parts.next().map(str::trim) {
        Some(raw) if raw.starts_with('{') => serde_json::from_str(raw).unwrap_or_default(),
        _ => BTreeMap::new(),
    };
    Ok(ProfileAudioStream {
        url: url.to_string(),
        mime_type: mime_of(extension),
        headers,
        expires_at: expires_at(url),
    })
}

fn resolve_error(message: &str) -> String {
    let lower = message.to_ascii_lowercase();
    if lower.contains("javascript runtime") || lower.contains("challenge solving") {
        return "This song needs a YouTube extraction runtime that is not available.".to_string();
    }
    if lower.contains("not a bot")
        || lower.contains("http error 429")
        || lower.contains("limiting requests")
    {
        return "YouTube is limiting requests. Try again later or open the song on YouTube."
            .to_string();
    }
    if lower.contains("private video")
        || lower.contains("sign in to confirm your age")
        || lower.contains("requires account access")
    {
        return "This song needs account access. Open it on YouTube.".to_string();
    }
    if lower.contains("timed out") {
        return "The song took too long to load. Try again.".to_string();
    }
    "Could not play this profile song.".to_string()
}

#[tauri::command]
pub async fn resolve_profile_audio(
    app: tauri::AppHandle,
    provider: String,
    url: String,
) -> Result<ProfileAudioStream, String> {
    let source = source_url(&provider, &url)?;
    let args = vec![
        "--no-warnings".to_string(),
        "--no-playlist".to_string(),
        "-f".to_string(),
        AUDIO_FORMAT.to_string(),
        "--print".to_string(),
        format!("%(url)s{SEPARATOR}%(ext)s{SEPARATOR}%(http_headers)j"),
        source,
    ];
    let output = crate::ytdlp_update::run(&app, args, RESOLVE_TIMEOUT, "profile song")
        .await
        .map_err(|error| resolve_error(&error))?;
    if !output.success {
        return Err(resolve_error(&String::from_utf8_lossy(&output.stderr)));
    }
    parse_output(&output.stdout)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn youtube_sources_are_reduced_to_a_video_id() {
        for source in [
            "https://youtu.be/dQw4w9WgXcQ",
            "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=30",
            "https://music.youtube.com/watch?v=dQw4w9WgXcQ",
            "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
            "https://youtube.com/shorts/dQw4w9WgXcQ",
        ] {
            let url = url::Url::parse(source).unwrap();
            assert_eq!(youtube_id(&url).as_deref(), Some("dQw4w9WgXcQ"), "{source}");
        }
        let bad = url::Url::parse("https://www.youtube.com/watch?v=short").unwrap();
        assert_eq!(youtube_id(&bad), None);
    }

    #[test]
    fn soundcloud_sources_keep_only_the_track_path() {
        let url = url::Url::parse("https://soundcloud.com/muse/hysteria?si=tracking").unwrap();
        assert_eq!(
            soundcloud_url(&url).as_deref(),
            Some("https://soundcloud.com/muse/hysteria")
        );
        let bad = url::Url::parse("https://soundcloud.example/muse/hysteria").unwrap();
        assert_eq!(soundcloud_url(&bad), None);
    }

    #[test]
    fn a_printed_line_becomes_an_audio_stream() {
        let line = "https://rr1---sn.googlevideo.com/videoplayback?expire=1900000000|||m4a|||{\"User-Agent\":\"test\"}\n";
        let stream = parse_output(line.as_bytes()).expect("a printed line resolves");
        assert_eq!(stream.mime_type, "audio/mp4");
        assert_eq!(stream.expires_at, Some(1_900_000_000));
        assert_eq!(
            stream.headers.get("User-Agent").map(String::as_str),
            Some("test")
        );
    }

    #[test]
    fn missing_headers_still_resolve_the_audio() {
        let stream = parse_output(b"https://example.com/audio|||mp3|||\n").unwrap();
        assert_eq!(stream.mime_type, "audio/mpeg");
        assert!(stream.headers.is_empty());
    }
}
