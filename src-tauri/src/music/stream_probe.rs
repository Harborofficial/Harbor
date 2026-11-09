use super::MusicStream;
use std::sync::LazyLock;
use std::time::Duration;

const PROBE_TIMEOUT: Duration = Duration::from_secs(4);
static PROBE_CLIENT: LazyLock<Result<reqwest::Client, reqwest::Error>> =
    LazyLock::new(|| reqwest::Client::builder().timeout(PROBE_TIMEOUT).build());

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum StreamHealth {
    Usable,
    Expired,
}

pub(super) fn expiry_status(status: u16) -> bool {
    matches!(status, 401 | 403 | 410)
}

async fn stream_status(stream: &MusicStream) -> Result<reqwest::StatusCode, String> {
    let client = PROBE_CLIENT
        .as_ref()
        .map_err(|_| "Music stream verification is unavailable".to_string())?;
    let response = client
        .get(stream.url.trim())
        .headers(stream.request_headers()?)
        // Match mpv's opening range; a one-byte probe can pass for a URL
        // that rejects actual playback. Drop the response without reading audio.
        .header(reqwest::header::RANGE, "bytes=0-")
        .send()
        .await
        .map_err(|_| "Music could not verify the stream. Please retry.".to_string())?;
    Ok(response.status())
}

/// Preserve the cache's tolerant policy for transient network failures.
pub(super) async fn probe_stream(stream: &MusicStream) -> StreamHealth {
    let url = stream.url.trim();
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return StreamHealth::Usable;
    }
    if stream.request_headers().is_err() {
        return StreamHealth::Expired;
    }
    match stream_status(stream).await {
        Ok(status) if expiry_status(status.as_u16()) => StreamHealth::Expired,
        _ => StreamHealth::Usable,
    }
}

/// Fresh YouTube extraction must be playable before it reaches the stream cache.
pub(super) async fn validate_stream(stream: MusicStream) -> Result<MusicStream, String> {
    let status = stream_status(&stream).await?;
    if !status.is_success() {
        return Err(format!(
            "YouTube rejected the audio stream (HTTP {}). Please retry or choose another source.",
            status.as_u16()
        ));
    }
    Ok(stream)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    async fn fixture(status: &str) -> (MusicStream, tokio::task::JoinHandle<String>) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let status = status.to_string();
        let server = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut request = Vec::new();
            while !request.ends_with(b"\r\n\r\n") {
                let mut byte = [0];
                socket.read_exact(&mut byte).await.unwrap();
                request.push(byte[0]);
                assert!(request.len() < 8192);
            }
            socket
                .write_all(
                    format!("HTTP/1.1 {status}\r\nContent-Length: 1000000\r\n\r\n").as_bytes(),
                )
                .await
                .unwrap();
            // No audio body: validation must finish after reading the headers.
            let mut byte = [0];
            let _ = socket.read(&mut byte).await;
            String::from_utf8(request).unwrap()
        });
        (
            MusicStream {
                url: format!("http://{address}/audio?token=fixture-secret"),
                mime_type: "audio/webm".into(),
                bitrate: 0,
                http_headers: [("User-Agent".into(), "fixture-player".into())].into(),
            },
            server,
        )
    }

    #[tokio::test]
    async fn fresh_stream_rejects_403_without_exposing_the_signed_url() {
        let (stream, server) = fixture("403 Forbidden").await;
        let error = tokio::time::timeout(Duration::from_secs(2), validate_stream(stream))
            .await
            .unwrap()
            .unwrap_err();
        assert!(error.contains("403"));
        assert!(!error.contains("fixture-secret"));
        let request = server.await.unwrap().to_ascii_lowercase();
        assert!(request.contains("range: bytes=0-\r\n"));
        assert!(request.contains("user-agent: fixture-player\r\n"));
    }

    #[tokio::test]
    async fn playable_stream_is_returned_unchanged_without_downloading_audio() {
        let (stream, server) = fixture("206 Partial Content").await;
        let url = stream.url.clone();
        let headers = stream.http_headers.clone();
        let validated = tokio::time::timeout(Duration::from_secs(2), validate_stream(stream))
            .await
            .unwrap()
            .unwrap();
        assert_eq!(validated.url, url);
        assert_eq!(validated.http_headers, headers);
        server.await.unwrap();
    }

    #[tokio::test]
    async fn failed_http_responses_are_not_accepted_as_fresh_streams() {
        for status in [
            "401 Unauthorized",
            "404 Not Found",
            "410 Gone",
            "429 Too Many Requests",
            "503 Service Unavailable",
        ] {
            let (stream, server) = fixture(status).await;
            assert!(validate_stream(stream).await.is_err());
            server.await.unwrap();
        }
    }
}
