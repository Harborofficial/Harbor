use std::collections::HashMap;
use std::future::Future;
use std::net::{IpAddr, SocketAddr};
use std::sync::OnceLock;
use std::time::Duration;

use crate::http_redirect::same_origin;
use base64::Engine;
use serde::{Deserialize, Serialize};
use tokio::sync::{Semaphore, SemaphorePermit};

const BROWSER_UA: &str =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

const MAX_CONCURRENT_FETCHES: usize = 48;
const DEFAULT_TIMEOUT_MS: u64 = 30_000;
const SOLVER_WAIT: Duration = Duration::from_secs(105);
const MAX_REDIRECTS: usize = 10;

fn fetch_semaphore() -> &'static Semaphore {
    static SEM: OnceLock<Semaphore> = OnceLock::new();
    SEM.get_or_init(|| Semaphore::new(MAX_CONCURRENT_FETCHES))
}

async fn acquire_fetch_permit() -> Result<SemaphorePermit<'static>, String> {
    fetch_semaphore()
        .acquire()
        .await
        .map_err(|error| format!("semaphore: {error}"))
}

async fn run_with_deadline<T>(
    duration: Duration,
    work: impl Future<Output = Result<T, String>>,
) -> Result<T, String> {
    tokio::time::timeout(duration, work)
        .await
        .unwrap_or_else(|_| Err(format!("timeout after {} ms", duration.as_millis())))
}

fn make_thumb(bytes: &[u8], width: u32) -> Option<Vec<u8>> {
    if width == 0 {
        return None;
    }
    let format = image::guess_format(bytes).ok()?;
    match format {
        image::ImageFormat::Jpeg | image::ImageFormat::Png | image::ImageFormat::WebP => {}
        _ => return None,
    }
    // Preserve animated images instead of flattening them to their first frame.
    if bytes
        .windows(4)
        .any(|chunk| chunk == b"acTL" || chunk == b"ANIM")
    {
        return None;
    }
    let img = image::load_from_memory(bytes).ok()?;
    if img.width() <= width {
        return None;
    }
    let height = ((img.height() as u64 * width as u64) / img.width() as u64).max(1) as u32;
    let small = img.resize(width, height, image::imageops::FilterType::Triangle);
    let mut buf = Vec::new();
    match format {
        image::ImageFormat::Jpeg => {
            image::codecs::jpeg::JpegEncoder::new_with_quality(&mut buf, 82)
                .encode_image(&small)
                .ok()?;
        }
        image::ImageFormat::Png => {
            use image::ImageEncoder;
            let rgb = small.to_rgba8();
            let (w, h) = (rgb.width(), rgb.height());
            image::codecs::png::PngEncoder::new(&mut buf)
                .write_image(rgb.as_raw(), w, h, image::ExtendedColorType::Rgba8)
                .ok()?;
        }
        _ => {
            let rgb = small.to_rgba8();
            let (w, h) = (rgb.width(), rgb.height());
            image::codecs::webp::WebPEncoder::new_lossless(&mut buf)
                .encode(rgb.as_raw(), w, h, image::ExtendedColorType::Rgba8)
                .ok()?;
        }
    }
    if buf.is_empty() {
        return None;
    }
    Some(buf)
}

async fn thumb_or_base64(
    app: &tauri::AppHandle,
    url: &str,
    width: Option<u32>,
    bytes: &[u8],
    persistence: Option<(u64, u64, Option<String>, Option<String>)>,
) -> String {
    let w = width.unwrap_or(0);
    let owned = bytes.to_vec();
    let output = tokio::task::spawn_blocking(move || make_thumb(&owned, w).unwrap_or(owned))
        .await
        .unwrap_or_else(|_| bytes.to_vec());
    let body = base64::engine::general_purpose::STANDARD.encode(&output);
    if let Some((lifetime, generation, etag, modified)) = persistence {
        if let Ok(format) = image::guess_format(&output) {
            let image = crate::thumb_cache::CachedImage {
                bytes: output,
                content_type: format.to_mime_type().to_string(),
                etag,
                modified,
                fresh: true,
                max_age: lifetime,
                lifetime,
            };
            let app = app.clone();
            let url = url.to_string();
            let _ = tokio::task::spawn_blocking(move || {
                crate::thumb_cache::write_thumb(&app, &url, w, &image, lifetime, generation)
            })
            .await;
        }
    }
    body
}

#[tauri::command]
pub async fn clear_thumb_cache(app: tauri::AppHandle) -> Result<(), String> {
    let app = app.clone();
    tokio::task::spawn_blocking(move || crate::thumb_cache::clear_thumb_dir(&app))
        .await
        .map_err(|error| format!("clear: {error}"))??;
    Ok(())
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThumbCacheSize {
    pub bytes: u64,
    pub files: usize,
}

#[tauri::command]
pub async fn cached_thumb_path(app: tauri::AppHandle, url: String, width: u32) -> Option<String> {
    let app = app.clone();
    tokio::task::spawn_blocking(move || crate::thumb_cache::cached_path(&app, &url, width))
        .await
        .ok()
        .flatten()
}

#[tauri::command]
pub async fn thumb_cache_size(app: tauri::AppHandle) -> Result<ThumbCacheSize, String> {
    let app = app.clone();
    let (bytes, files) =
        tokio::task::spawn_blocking(move || crate::thumb_cache::thumb_cache_size(&app))
            .await
            .map_err(|error| format!("size: {error}"))?;
    Ok(ThumbCacheSize { bytes, files })
}

fn is_blocked_ip(ip: IpAddr) -> bool {
    let ip = match ip {
        IpAddr::V6(v6) => match v6.to_ipv4_mapped() {
            Some(v4) => IpAddr::V4(v4),
            None => IpAddr::V6(v6),
        },
        other => other,
    };
    match ip {
        IpAddr::V4(v4) => {
            v4.is_loopback() || v4.is_link_local() || v4.is_unspecified() || v4.is_broadcast()
        }
        IpAddr::V6(v6) => {
            v6.is_loopback() || v6.is_unspecified() || (v6.segments()[0] & 0xffc0) == 0xfe80
        }
    }
}

fn is_public_network_ip(ip: IpAddr) -> bool {
    let ip = match ip {
        IpAddr::V6(v6) => match v6.to_ipv4_mapped() {
            Some(v4) => IpAddr::V4(v4),
            None => IpAddr::V6(v6),
        },
        other => other,
    };
    match ip {
        IpAddr::V4(v4) => {
            let [a, b, c, _] = v4.octets();
            !(a == 0
                || a == 10
                || a == 127
                || a >= 224
                || (a == 100 && (64..=127).contains(&b))
                || (a == 169 && b == 254)
                || (a == 172 && (16..=31).contains(&b))
                || (a == 192 && b == 168)
                || (a == 192 && b == 0)
                || (a == 192 && b == 88 && c == 99)
                || (a == 198 && (b == 18 || b == 19))
                || (a == 198 && b == 51 && c == 100)
                || (a == 203 && b == 0 && c == 113))
        }
        IpAddr::V6(v6) => {
            let segments = v6.segments();
            (segments[0] & 0xe000) == 0x2000
                && segments[0] != 0x2002
                && !(segments[0] == 0x2001 && segments[1] == 0x0db8)
                && !(segments[0] == 0x2001 && segments[1] < 0x0200)
        }
    }
}

async fn resolve_public_target(url: &reqwest::Url) -> Result<Vec<SocketAddr>, String> {
    if url.scheme() != "http" && url.scheme() != "https" {
        return Err(format!("public target bad scheme: {}", url.scheme()));
    }
    let host = url
        .host_str()
        .map(|value| {
            value
                .trim_start_matches('[')
                .trim_end_matches(']')
                .to_string()
        })
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "public target has no host".to_string())?;
    let port = url
        .port_or_known_default()
        .ok_or_else(|| "public target has no port".to_string())?;
    if let Ok(ip) = host.parse::<IpAddr>() {
        if !is_public_network_ip(ip) {
            return Err(format!("blocked non-public target: {host}"));
        }
        return Ok(vec![SocketAddr::new(ip, port)]);
    }

    let lookup = (host.clone(), port);
    let mut addresses = tokio::task::spawn_blocking(move || {
        use std::net::ToSocketAddrs;
        lookup
            .to_socket_addrs()
            .map(|items| items.collect::<Vec<_>>())
    })
    .await
    .map_err(|_| format!("public target DNS failed: {host}"))?
    .map_err(|_| format!("public target DNS failed: {host}"))?;
    if addresses.is_empty()
        || addresses
            .iter()
            .any(|address| !is_public_network_ip(address.ip()))
    {
        return Err(format!("blocked non-public target: {host}"));
    }
    addresses.sort_unstable();
    addresses.dedup();
    Ok(addresses)
}

fn host_is_blocked_literal(url: &reqwest::Url) -> bool {
    match url.host_str() {
        Some(h) => match h
            .trim_start_matches('[')
            .trim_end_matches(']')
            .parse::<IpAddr>()
        {
            Ok(ip) => is_blocked_ip(ip),
            Err(_) => false,
        },
        None => false,
    }
}

// `allow_local` opts the target out of the SSRF guard for loopback, link-local,
// and private network addresses. It is only set by callers that have explicitly
// received a URL from the user (e.g. wiring up their own self-hosted Suwayomi
// server), never for implicitly-discovered URLs.
pub(crate) async fn validate_target(url: &reqwest::Url, allow_local: bool) -> Result<(), String> {
    let host = match url.host_str() {
        Some(h) => h.trim_start_matches('[').trim_end_matches(']').to_string(),
        None => return Ok(()),
    };
    if host_is_blocked_literal(url) && !allow_local {
        return Err(format!("blocked internal target: {}", host));
    }
    if host.parse::<IpAddr>().is_ok() {
        return Ok(());
    }
    if allow_local {
        return Ok(());
    }
    let port = url.port_or_known_default().unwrap_or(80);
    let lookup = (host.clone(), port);
    let resolved = tokio::task::spawn_blocking(move || {
        use std::net::ToSocketAddrs;
        lookup
            .to_socket_addrs()
            .map(|it| it.map(|a| a.ip()).collect::<Vec<_>>())
    })
    .await;
    if let Ok(Ok(ips)) = resolved {
        if ips.into_iter().any(is_blocked_ip) {
            return Err(format!("blocked internal target: {}", host));
        }
    }
    Ok(())
}

fn is_https_downgrade(a: &reqwest::Url, b: &reqwest::Url) -> bool {
    a.scheme() == "https" && b.scheme() == "http"
}

fn strip_headers(headers: &mut Vec<(String, String)>, drop: &[&str]) {
    headers.retain(|(k, _)| {
        let low = k.to_ascii_lowercase();
        !drop.contains(&low.as_str())
    });
}

fn collect_headers(headers: &reqwest::header::HeaderMap) -> HashMap<String, String> {
    let mut out = HashMap::new();
    for (name, value) in headers.iter() {
        if let Ok(v) = value.to_str() {
            out.insert(name.as_str().to_ascii_lowercase(), v.to_string());
        }
    }
    out
}

fn is_followable_redirect(status: reqwest::StatusCode) -> bool {
    use reqwest::StatusCode;
    matches!(
        status,
        StatusCode::MOVED_PERMANENTLY
            | StatusCode::FOUND
            | StatusCode::SEE_OTHER
            | StatusCode::TEMPORARY_REDIRECT
            | StatusCode::PERMANENT_REDIRECT
    )
}

fn apply_redirect_method(
    method: &mut reqwest::Method,
    body: &mut Option<Vec<u8>>,
    status: reqwest::StatusCode,
) {
    use reqwest::{Method, StatusCode};
    match status {
        StatusCode::SEE_OTHER => {
            if *method != Method::HEAD {
                *method = Method::GET;
            }
            *body = None;
        }
        StatusCode::MOVED_PERMANENTLY | StatusCode::FOUND if *method == Method::POST => {
            *method = Method::GET;
            *body = None;
        }
        _ => {}
    }
}

pub(crate) fn http_client_builder() -> reqwest::ClientBuilder {
    reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(30))
        .connect_timeout(Duration::from_secs(10))
        .pool_idle_timeout(Duration::from_secs(30))
        .pool_max_idle_per_host(8)
}

fn http_client() -> Result<&'static reqwest::Client, String> {
    static CLIENT: OnceLock<Result<reqwest::Client, String>> = OnceLock::new();
    CLIENT
        .get_or_init(|| {
            http_client_builder()
                .build()
                .map_err(|e| format!("client: {e}"))
        })
        .as_ref()
        .map_err(|e| e.clone())
}

pub(crate) async fn public_http_client(url: &reqwest::Url) -> Result<reqwest::Client, String> {
    let host = url
        .host_str()
        .ok_or_else(|| "public target has no host".to_string())?;
    let addresses = resolve_public_target(url).await?;
    http_client_builder()
        .resolve_to_addrs(host, &addresses)
        .build()
        .map_err(|error| format!("public client: {error}"))
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct HarborFetchArgs {
    pub url: String,
    pub method: Option<String>,
    pub headers: Option<HashMap<String, String>>,
    pub body: Option<String>,
    pub body_base64: Option<String>,
    pub timeout_ms: Option<u64>,
    pub response_type: Option<String>,
    pub max_response_bytes: Option<u64>,
    pub credential_handle: Option<String>,
    pub public_network_only: Option<bool>,
    pub allow_local_network: Option<bool>,
    pub follow_redirects: Option<bool>,
    pub thumb_width_px: Option<u32>,
    pub cache_image: Option<bool>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HarborFetchResponse {
    pub status: u16,
    pub ok: bool,
    pub body: String,
    pub content_type: Option<String>,
    pub headers: HashMap<String, String>,
    pub url: Option<String>,
}

fn cached_image_response(
    url: &str,
    max_response_bytes: Option<u64>,
    image: &crate::thumb_cache::CachedImage,
    marker: &str,
    max_age: u64,
) -> Result<HarborFetchResponse, String> {
    if max_response_bytes.is_some_and(|limit| image.bytes.len() as u64 > limit) {
        return Err("response size limit exceeded".to_string());
    }
    Ok(HarborFetchResponse {
        status: 200,
        ok: true,
        body: base64::engine::general_purpose::STANDARD.encode(&image.bytes),
        content_type: Some(image.content_type.clone()),
        headers: HashMap::from([
            ("content-type".to_string(), image.content_type.clone()),
            ("x-harbor-image-cache".to_string(), marker.to_string()),
            ("x-harbor-image-max-age".to_string(), max_age.to_string()),
        ]),
        url: Some(url.to_string()),
    })
}

fn stale_image_response(
    url: &str,
    max_response_bytes: Option<u64>,
    image: &crate::thumb_cache::CachedImage,
) -> Result<HarborFetchResponse, String> {
    cached_image_response(url, max_response_bytes, image, "stale", 300)
}

#[tauri::command]
pub async fn harbor_fetch(
    app: tauri::AppHandle,
    args: HarborFetchArgs,
) -> Result<HarborFetchResponse, String> {
    let timeout = Duration::from_millis(args.timeout_ms.unwrap_or(DEFAULT_TIMEOUT_MS));
    let solver_wait = if can_open_solver(&args) {
        SOLVER_WAIT
    } else {
        Duration::ZERO
    };
    let image_generation = crate::thumb_cache::generation();
    let _permit = acquire_fetch_permit().await?;
    run_with_deadline(
        timeout + solver_wait,
        harbor_fetch_inner(app, args, image_generation, false),
    )
    .await
}

async fn harbor_fetch_inner(
    app: tauri::AppHandle,
    args: HarborFetchArgs,
    image_generation: u64,
    retried: bool,
) -> Result<HarborFetchResponse, String> {
    let timeout = Duration::from_millis(args.timeout_ms.unwrap_or(DEFAULT_TIMEOUT_MS));
    let solver_ok = can_open_solver(&args);
    let retry_args = args.clone();
    let public_network_only = args.public_network_only.unwrap_or(false);
    let allow_local_network = args.allow_local_network.unwrap_or(false);
    let follow_redirects = args.follow_redirects.unwrap_or(true);

    let method = args.method.as_deref().unwrap_or("GET").to_uppercase();
    let mut current_method =
        reqwest::Method::from_bytes(method.as_bytes()).map_err(|e| format!("method: {}", e))?;

    let mut current_url = reqwest::Url::parse(&args.url).map_err(|e| format!("url: {}", e))?;
    if !args.cache_image.unwrap_or(false) {
        validate_target(&current_url, allow_local_network).await?;
    }

    let mut subtitle_credential = args
        .credential_handle
        .as_deref()
        .map(crate::subtitle_credentials::resolve)
        .transpose()?;

    let original_host = current_url.host_str().map(|s| s.to_string());
    let cf = current_url.host_str().and_then(crate::cf_solver::cf_cached);
    let had_clearance = cf.is_some();
    // Browser-only sessions and verified hosts that reqwest has rechallenged
    // should use the matching WebView directly. Never trust the browser-session
    // map unless the shared WebView is still on the requested hostname.
    let verified_browser = original_host
        .as_deref()
        .is_some_and(|host| crate::cf_solver::cf_browser_ready_for(&app, host));
    let browser_eligible = can_browser_fallback(&retry_args);
    let prefer_browser = !had_clearance
        || original_host
            .as_deref()
            .is_some_and(crate::cf_solver::cf_prefer_browser);
    if should_use_verified_browser(
        had_clearance,
        verified_browser,
        browser_eligible,
        prefer_browser,
    ) {
        let host = original_host.as_deref().unwrap_or("");
        if crate::cf_solver::cf_browser_cooling_down(host) {
            return Err(format!(
                "Cloudflare browser verification for {host} is cooling down after a failed request"
            ));
        }
        match crate::cf_solver::cf_browser_fetch(&app, &retry_args.url, browser_accept(&retry_args))
            .await
        {
            Ok(Some(browser)) => {
                crate::cf_solver::cf_clear_browser_failure(host);
                return Ok(browser_text_response(browser, retry_args.url));
            }
            Err(error) => {
                eprintln!("[cf] verified browser fetch failed for {host}: {error}");
            }
            Ok(None) => {}
        }
        crate::cf_solver::cf_note_browser_failure(host);
        return Err(format!(
            "Cloudflare verification for {host} did not return usable content"
        ));
    }

    let mut headers: Vec<(String, String)> = Vec::new();
    let mut caller_cookie: Option<String> = None;
    let mut has_user_agent = false;
    let mut has_accept = false;
    let mut has_accept_language = false;
    if let Some(caller_headers) = args.headers {
        for (k, v) in caller_headers {
            let low = k.to_ascii_lowercase();
            if low == "x-harbor-subtitle-credential" {
                continue;
            }
            if subtitle_credential.is_some() && low == "x-api-key" {
                continue;
            }
            if low == "user-agent" {
                if cf.is_some() {
                    continue;
                }
                has_user_agent = true;
            }
            if low == "cookie" && cf.is_some() {
                caller_cookie = Some(match caller_cookie {
                    Some(previous) if !previous.is_empty() => format!("{previous}; {v}"),
                    _ => v,
                });
                continue;
            }
            if low == "accept" {
                has_accept = true;
            }
            if low == "accept-language" {
                has_accept_language = true;
            }
            headers.push((k, v));
        }
    }
    if let Some((cookie, ua)) = cf {
        let cookie = match caller_cookie {
            Some(caller) if !caller.trim().is_empty() => merge_cookie_headers(&caller, &cookie),
            _ => cookie,
        };
        headers.push(("Cookie".to_string(), cookie));
        headers.push(("User-Agent".to_string(), ua));
        has_user_agent = true;
    }
    if !has_user_agent {
        headers.push(("User-Agent".to_string(), BROWSER_UA.to_string()));
    }
    if !has_accept {
        headers.push((
            "Accept".to_string(),
            "application/json, text/plain, */*".to_string(),
        ));
    }
    if !has_accept_language {
        headers.push(("Accept-Language".to_string(), "en-US,en;q=0.9".to_string()));
    }

    let cache_image = args.cache_image.unwrap_or(false)
        && method == "GET"
        && args.response_type.as_deref() == Some("base64")
        && !allow_local_network
        && !public_network_only
        && subtitle_credential.is_none()
        && args.body.is_none()
        && args.body_base64.is_none()
        && headers.iter().all(|(name, _)| {
            matches!(
                name.to_ascii_lowercase().as_str(),
                "user-agent" | "accept" | "accept-language"
            )
        });
    let mut cached_image = None;
    if cache_image {
        let disk_app = app.clone();
        let disk_url = args.url.clone();
        let width = args.thumb_width_px.unwrap_or(0);
        cached_image = tokio::task::spawn_blocking(move || {
            crate::thumb_cache::read_thumb(&disk_app, &disk_url, width)
        })
        .await
        .ok()
        .flatten();
        if let Some(hit) = cached_image.as_ref() {
            if hit.fresh
                && args
                    .max_response_bytes
                    .is_none_or(|limit| hit.bytes.len() as u64 <= limit)
            {
                return Ok(HarborFetchResponse {
                    status: 200,
                    ok: true,
                    body: base64::engine::general_purpose::STANDARD.encode(&hit.bytes),
                    content_type: Some(hit.content_type.clone()),
                    headers: HashMap::from([
                        ("content-type".to_string(), hit.content_type.clone()),
                        ("x-harbor-image-cache".to_string(), "hit".to_string()),
                        (
                            "x-harbor-image-max-age".to_string(),
                            hit.max_age.to_string(),
                        ),
                    ]),
                    url: Some(args.url.clone()),
                });
            }
            if let Some(etag) = &hit.etag {
                headers.push(("If-None-Match".to_string(), etag.clone()));
            }
            if let Some(modified) = &hit.modified {
                headers.push(("If-Modified-Since".to_string(), modified.clone()));
            }
        }
    }

    // Cached bytes need no DNS lookup. Outbound image requests keep the same
    // target validation as other HTTP requests, including conditional refreshes.
    if args.cache_image.unwrap_or(false) {
        validate_target(&current_url, allow_local_network).await?;
    }
    let mut body = match args.body_base64 {
        Some(value) => Some(
            base64::engine::general_purpose::STANDARD
                .decode(value)
                .map_err(|error| format!("request base64: {error}"))?,
        ),
        None => args.body.map(String::into_bytes),
    };
    let mut redirect_count = 0usize;

    let mut res = loop {
        let pinned_client = if public_network_only {
            Some(public_http_client(&current_url).await?)
        } else {
            None
        };
        let client = if let Some(client) = pinned_client.as_ref() {
            client
        } else {
            http_client()?
        };
        let (request_url, credential_header) = match subtitle_credential.as_ref() {
            Some(credential) => {
                crate::subtitle_credentials::apply_to_request(&current_url, credential)?
            }
            None => (current_url.clone(), None),
        };
        let mut req = client
            .request(current_method.clone(), request_url)
            .timeout(timeout);
        for (k, v) in &headers {
            req = req.header(k.as_str(), v.as_str());
        }
        if let Some((name, value)) = credential_header {
            req = req.header(name.as_str(), value.as_str());
        }
        if let Some(b) = &body {
            req = req.body(b.clone());
        }

        let resp = match req.send().await {
            Ok(resp) => resp,
            Err(error) => {
                // A previously cached image is still useful when the origin is
                // unreachable; the old filesystem cache served it for 30 days.
                if let Some(hit) = cached_image.as_ref() {
                    if !hit.fresh {
                        return stale_image_response(&args.url, args.max_response_bytes, hit);
                    }
                }
                return Err(if subtitle_credential.is_some() {
                    "send: subtitle provider request failed".to_string()
                } else {
                    format!("send: {error}")
                });
            }
        };
        let status = resp.status();
        if !follow_redirects || !is_followable_redirect(status) {
            break resp;
        }
        let location = resp
            .headers()
            .get(reqwest::header::LOCATION)
            .and_then(|v| v.to_str().ok())
            .map(|s| s.to_string());
        let Some(location) = location else {
            break resp;
        };

        redirect_count += 1;
        if redirect_count > MAX_REDIRECTS {
            return Err("too many redirects".to_string());
        }
        let next_url = current_url
            .join(&location)
            .map_err(|e| format!("redirect url: {}", e))?;
        if next_url.scheme() != "http" && next_url.scheme() != "https" {
            return Err(format!("redirect bad scheme: {}", next_url.scheme()));
        }
        if is_https_downgrade(&current_url, &next_url) {
            return Err("redirect from HTTPS to HTTP is not allowed".to_string());
        }
        if !public_network_only {
            validate_target(&next_url, allow_local_network).await?;
        }
        let cross_origin = !same_origin(&current_url, &next_url);
        let had_body = body.is_some();
        apply_redirect_method(&mut current_method, &mut body, status);
        if cross_origin_redirect_forwards_body(cross_origin, &body) {
            return Err("cross-origin redirect cannot forward request body".to_string());
        }
        if cross_origin {
            subtitle_credential = None;
            headers.retain(|(name, _)| crate::http_redirect::safe_cross_origin_header(name));
        }
        if had_body && body.is_none() {
            strip_headers(
                &mut headers,
                &[
                    "content-type",
                    "content-length",
                    "content-encoding",
                    "transfer-encoding",
                ],
            );
        }
        current_url = next_url;
    };

    let status = res.status().as_u16();
    let ok = res.status().is_success();
    if cache_image && (status >= 500 || status == 429 || status == 403) {
        if let Some(hit) = cached_image.as_ref() {
            if !hit.fresh {
                return stale_image_response(&args.url, args.max_response_bytes, hit);
            }
        }
    }
    let cf_mitigated = res
        .headers()
        .get("cf-mitigated")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_lowercase());
    let content_type = res
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());
    let mut response_headers = collect_headers(res.headers());
    if status == 304 {
        if let Some(mut hit) = cached_image.take() {
            if args
                .max_response_bytes
                .is_some_and(|limit| hit.bytes.len() as u64 > limit)
            {
                return Err("response size limit exceeded".to_string());
            }
            let body = base64::engine::general_purpose::STANDARD.encode(&hit.bytes);
            hit.etag = response_headers.get("etag").cloned().or(hit.etag);
            hit.modified = response_headers
                .get("last-modified")
                .cloned()
                .or(hit.modified);
            let content_type = hit.content_type.clone();
            let freshness =
                hit.revalidated_lifetime(response_headers.get("cache-control").map(String::as_str));
            if let Some(lifetime) = freshness {
                let app = app.clone();
                let url = args.url.clone();
                let width = args.thumb_width_px.unwrap_or(0);
                let _ = tokio::task::spawn_blocking(move || {
                    crate::thumb_cache::write_thumb(
                        &app,
                        &url,
                        width,
                        &hit,
                        lifetime,
                        image_generation,
                    )
                })
                .await;
            } else {
                let app = app.clone();
                let url = args.url.clone();
                let width = args.thumb_width_px.unwrap_or(0);
                let _ = tokio::task::spawn_blocking(move || {
                    crate::thumb_cache::remove_thumb(&app, &url, width, image_generation)
                })
                .await;
            }
            return Ok(HarborFetchResponse {
                status: 200,
                ok: true,
                body,
                content_type: Some(content_type.clone()),
                headers: HashMap::from([
                    ("content-type".to_string(), content_type),
                    (
                        "x-harbor-image-cache".to_string(),
                        "revalidated".to_string(),
                    ),
                    (
                        "x-harbor-image-max-age".to_string(),
                        freshness.unwrap_or(0).to_string(),
                    ),
                ]),
                url: Some(args.url.clone()),
            });
        }
    }
    let persistence = if cache_image
        && ok
        && content_type
            .as_deref()
            .is_some_and(|kind| kind.starts_with("image/"))
    {
        crate::thumb_cache::image_lifetime(
            response_headers.get("cache-control").map(String::as_str),
        )
        .map(|lifetime| {
            (
                lifetime,
                image_generation,
                response_headers.get("etag").cloned(),
                response_headers.get("last-modified").cloned(),
            )
        })
    } else {
        None
    };
    if cache_image {
        response_headers.insert("x-harbor-image-cache".to_string(), "miss".to_string());
        if let Some((lifetime, ..)) = persistence.as_ref() {
            response_headers.insert("x-harbor-image-max-age".to_string(), lifetime.to_string());
        }
    }
    let final_url = res.url().to_string();
    let body = if let Some(max_bytes) = args.max_response_bytes {
        if res.content_length().is_some_and(|size| size > max_bytes) {
            if let Some(hit) = cached_image.as_ref() {
                if !hit.fresh {
                    return stale_image_response(&args.url, args.max_response_bytes, hit);
                }
            }
            return Err("response size limit exceeded".to_string());
        }
        let mut bytes = Vec::new();
        loop {
            match res.chunk().await {
                Ok(Some(chunk)) => {
                    if (bytes.len() as u64).saturating_add(chunk.len() as u64) > max_bytes {
                        if let Some(hit) = cached_image.as_ref() {
                            if !hit.fresh {
                                return stale_image_response(
                                    &args.url,
                                    args.max_response_bytes,
                                    hit,
                                );
                            }
                        }
                        return Err("response size limit exceeded".to_string());
                    }
                    bytes.extend_from_slice(&chunk);
                }
                Ok(None) => break,
                Err(error) => {
                    if let Some(hit) = cached_image.as_ref() {
                        if !hit.fresh {
                            return stale_image_response(&args.url, args.max_response_bytes, hit);
                        }
                    }
                    return Err(format!("read: {error}"));
                }
            }
        }
        if args.response_type.as_deref() == Some("base64") {
            thumb_or_base64(&app, &args.url, args.thumb_width_px, &bytes, persistence).await
        } else {
            String::from_utf8_lossy(&bytes).into_owned()
        }
    } else if args.response_type.as_deref() == Some("base64") {
        match res.bytes().await {
            Ok(bytes) => {
                thumb_or_base64(&app, &args.url, args.thumb_width_px, &bytes, persistence).await
            }
            Err(_) => {
                if let Some(hit) = cached_image.as_ref() {
                    if !hit.fresh {
                        return stale_image_response(&args.url, args.max_response_bytes, hit);
                    }
                }
                String::new()
            }
        }
    } else {
        res.text().await.unwrap_or_default()
    };

    if (200..300).contains(&status)
        && content_type
            .as_deref()
            .is_some_and(|kind| kind.contains("text/html"))
    {
        if let Some(reason) = crate::cf_solver::cf_security_page_reason(&body) {
            eprintln!("[cf] response rejected because it contains a protection page: {reason}");
            return Err(format!("source returned a protection page: {reason}"));
        }
    }

    if is_cloudflare_challenge(status, cf_mitigated.as_deref(), &body) {
        // Once a verified browser is accepted but the native TLS fingerprint is
        // challenged, prefer browser requests for this host in future.
        if verified_browser && browser_eligible {
            let host = original_host.as_deref().unwrap_or("");
            if had_clearance {
                crate::cf_solver::cf_note_native_rechallenge(host);
            }
            if !crate::cf_solver::cf_browser_cooling_down(host) {
                match crate::cf_solver::cf_browser_fetch(
                    &app,
                    &retry_args.url,
                    browser_accept(&retry_args),
                )
                .await
                {
                    Ok(Some(browser)) => {
                        crate::cf_solver::cf_clear_browser_failure(host);
                        return Ok(browser_text_response(browser, retry_args.url));
                    }
                    Err(error) => eprintln!("[cf] browser fallback failed for {host}: {error}"),
                    Ok(None) => {}
                }
                crate::cf_solver::cf_note_browser_failure(host);
            }
        }
        if had_clearance && !verified_browser {
            if let Some(h) = original_host.as_deref() {
                crate::cf_solver::cf_invalidate(h);
            }
        }
        // The solver is user-interactive, so it only runs for text requests that did
        // not opt into a response-size contract. Binary/capped callers keep the
        // original bounded response.
        if solver_ok {
            if retried || (verified_browser && browser_eligible) {
                eprintln!("[cf] verified request still challenged for {}", args.url);
            } else {
                eprintln!("[cf] challenge detected ({}) for {}", status, args.url);
                match crate::cf_solver::cf_fetch(app.clone(), args.url.clone()).await {
                    Ok(()) => {
                        eprintln!("[cf] retrying {} with clearance", args.url);
                        return Box::pin(harbor_fetch_inner(
                            app,
                            retry_args,
                            image_generation,
                            true,
                        ))
                        .await;
                    }
                    Err(error) => eprintln!("[cf] solve failed for {}: {error}", args.url),
                }
            }
            response_headers.insert("x-harbor-challenge".to_string(), "1".to_string());
            response_headers.insert("x-harbor-challenge-url".to_string(), args.url.clone());
        }
    }

    Ok(HarborFetchResponse {
        status,
        ok,
        body,
        content_type,
        headers: response_headers,
        url: Some(final_url),
    })
}

// Friends' reviews are fetched on detail-page load. A Letterboxd challenge must
// return to the caller instead of opening the "Checking source" window.
const BACKGROUND_PROVIDER_HOSTS: &[&str] = &[
    "api.theintrodb.org",
    "api.introdb.app",
    "api.skipdb.tv",
    "letterboxd.com",
    "www.letterboxd.com",
];

fn solver_host_allowed(host: &str) -> bool {
    let host = host.trim_end_matches('.').to_ascii_lowercase();
    !BACKGROUND_PROVIDER_HOSTS.contains(&host.as_str())
}

fn should_use_verified_browser(
    had_clearance: bool,
    verified_browser: bool,
    browser_eligible: bool,
    prefer_browser: bool,
) -> bool {
    verified_browser && browser_eligible && (!had_clearance || prefer_browser)
}

fn browser_accept(args: &HarborFetchArgs) -> Option<&str> {
    args.headers.as_ref().and_then(|headers| {
        headers
            .iter()
            .find(|(name, _)| name.eq_ignore_ascii_case("accept"))
            .map(|(_, value)| value.as_str())
    })
}

fn browser_text_response(
    browser: crate::cf_solver::BrowserTextResponse,
    url: String,
) -> HarborFetchResponse {
    let mut headers = HashMap::new();
    if let Some(content_type) = browser.content_type.as_deref() {
        headers.insert("content-type".to_string(), content_type.to_string());
    }
    HarborFetchResponse {
        status: browser.status,
        ok: (200..300).contains(&browser.status),
        body: browser.body,
        content_type: browser.content_type,
        headers,
        url: Some(url),
    }
}

fn can_browser_fallback(args: &HarborFetchArgs) -> bool {
    args.method
        .as_deref()
        .unwrap_or("GET")
        .eq_ignore_ascii_case("GET")
        && args.body.is_none()
        && args.body_base64.is_none()
        && args.credential_handle.is_none()
        && args.response_type.as_deref() != Some("base64")
        && args.max_response_bytes.is_none()
        && args.headers.as_ref().is_none_or(|headers| {
            let target = reqwest::Url::parse(&args.url).ok();
            headers.iter().all(|(name, value)| {
                name.eq_ignore_ascii_case("accept")
                    || name.eq_ignore_ascii_case("accept-language")
                    // Manga plugin requests add a default User-Agent. The verified
                    // WebView retains its own UA; no custom UA is injected into it.
                    || name.eq_ignore_ascii_case("user-agent")
                    || (name.eq_ignore_ascii_case("referer")
                        && target.as_ref().is_some_and(|url| {
                            reqwest::Url::parse(value).ok().is_some_and(|referer| {
                                referer.origin() == url.origin()
                            })
                        }))
            })
        })
}

fn can_open_solver(args: &HarborFetchArgs) -> bool {
    args.response_type.as_deref() != Some("base64")
        && args.max_response_bytes.is_none()
        && reqwest::Url::parse(&args.url)
            .ok()
            .and_then(|url| url.host_str().map(solver_host_allowed))
            .unwrap_or(false)
}

fn is_clearance_cookie(name: &str) -> bool {
    name == "cf_clearance" || name == "__cf_bm" || name.starts_with("cf_chl")
}

fn merge_cookie_headers(caller: &str, solver: &str) -> String {
    let mut cookies: Vec<(String, String)> = Vec::new();
    for pair in caller.split(';') {
        let pair = pair.trim();
        if pair.is_empty() {
            continue;
        }
        let (name, value) = pair.split_once('=').unwrap_or((pair, ""));
        if let Some((_, current)) = cookies.iter_mut().find(|(existing, _)| existing == name) {
            *current = value.to_string();
        } else {
            cookies.push((name.to_string(), value.to_string()));
        }
    }
    for pair in solver.split(';') {
        let pair = pair.trim();
        if pair.is_empty() {
            continue;
        }
        let (name, value) = pair.split_once('=').unwrap_or((pair, ""));
        if let Some((_, current)) = cookies.iter_mut().find(|(existing, _)| existing == name) {
            if is_clearance_cookie(name) {
                *current = value.to_string();
            }
        } else {
            cookies.push((name.to_string(), value.to_string()));
        }
    }
    cookies
        .into_iter()
        .map(|(name, value)| format!("{name}={value}"))
        .collect::<Vec<_>>()
        .join("; ")
}

fn is_cloudflare_hard_block(body: &str) -> bool {
    body.contains("Sorry, you have been blocked")
        || body.contains("error code: 1020")
        || body.contains("Error 1015")
        || body.contains("You are being rate limited")
}

fn is_cloudflare_challenge(status: u16, cf_mitigated: Option<&str>, body: &str) -> bool {
    if is_cloudflare_hard_block(body) {
        return false;
    }
    if cf_mitigated == Some("challenge") {
        return true;
    }
    if !matches!(status, 403 | 503) {
        return false;
    }
    body.contains("Just a moment")
        || body.contains("cf_chl_opt")
        || body.contains("challenge-form")
        || body.contains("cf-please-wait")
        || body.contains("challenge-platform")
        || body.contains("Enable JavaScript and cookies to continue")
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HarborUploadArgs {
    pub url: String,
    pub field: String,
    pub filename: String,
    pub content_type: Option<String>,
    pub data_base64: String,
    pub headers: Option<HashMap<String, String>>,
    pub timeout_ms: Option<u64>,
}

#[tauri::command]
pub async fn harbor_upload(args: HarborUploadArgs) -> Result<HarborFetchResponse, String> {
    let timeout = Duration::from_millis(args.timeout_ms.unwrap_or(DEFAULT_TIMEOUT_MS));
    run_with_deadline(timeout, harbor_upload_inner(args)).await
}

async fn harbor_upload_inner(args: HarborUploadArgs) -> Result<HarborFetchResponse, String> {
    let _permit = acquire_fetch_permit().await?;
    let client = http_client()?;
    let url = reqwest::Url::parse(&args.url).map_err(|e| format!("url: {}", e))?;
    validate_target(&url, false).await?;

    let bytes = base64::engine::general_purpose::STANDARD
        .decode(args.data_base64.as_bytes())
        .map_err(|e| format!("base64: {}", e))?;

    let mut part = reqwest::multipart::Part::bytes(bytes).file_name(args.filename);
    if let Some(ct) = args.content_type.as_deref() {
        part = part.mime_str(ct).map_err(|e| format!("mime: {}", e))?;
    }
    let form = reqwest::multipart::Form::new().part(args.field, part);

    let mut req = client
        .post(url)
        .timeout(Duration::from_millis(
            args.timeout_ms.unwrap_or(DEFAULT_TIMEOUT_MS),
        ))
        .multipart(form);
    let mut has_ua = false;
    if let Some(caller_headers) = args.headers {
        for (k, v) in caller_headers {
            if k.eq_ignore_ascii_case("user-agent") {
                has_ua = true;
            }
            req = req.header(k.as_str(), v.as_str());
        }
    }
    if !has_ua {
        req = req.header("User-Agent", BROWSER_UA);
    }

    let resp = req.send().await.map_err(|e| format!("send: {}", e))?;
    let status = resp.status().as_u16();
    let ok = resp.status().is_success();
    let content_type = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());
    let headers = collect_headers(resp.headers());
    let url = Some(resp.url().to_string());
    let body = resp.text().await.unwrap_or_default();
    Ok(HarborFetchResponse {
        status,
        ok,
        body,
        content_type,
        headers,
        url,
    })
}

fn cross_origin_redirect_forwards_body(cross_origin: bool, body: &Option<Vec<u8>>) -> bool {
    cross_origin && body.is_some()
}

#[cfg(test)]
mod tests {
    use super::HarborFetchArgs;
    use super::{
        apply_redirect_method, cached_image_response, cross_origin_redirect_forwards_body,
        host_is_blocked_literal, is_cloudflare_challenge, is_https_downgrade, is_public_network_ip,
        merge_cookie_headers, same_origin, solver_host_allowed, validate_target,
    };
    use crate::thumb_cache::CachedImage;
    use std::collections::HashMap;

    #[test]
    fn stale_cached_image_response_honors_the_size_limit() {
        let image = CachedImage {
            bytes: b"abc".to_vec(),
            content_type: "image/png".to_string(),
            etag: None,
            modified: None,
            fresh: false,
            max_age: 0,
            lifetime: 60,
        };
        let response =
            cached_image_response("https://example.com/a.png", Some(10), &image, "stale", 300)
                .expect("stale response");
        assert_eq!(response.status, 200);
        assert_eq!(response.body, "YWJj");
        assert_eq!(
            response
                .headers
                .get("x-harbor-image-cache")
                .map(String::as_str),
            Some("stale")
        );
        assert!(
            cached_image_response("https://example.com/a.png", Some(2), &image, "stale", 300)
                .is_err()
        );
    }

    #[test]
    fn background_metadata_does_not_open_cloudflare_windows() {
        for host in [
            "letterboxd.com",
            "www.letterboxd.com",
            "LETTERBOXD.COM.",
            "api.theintrodb.org",
            "api.introdb.app",
            "api.skipdb.tv",
        ] {
            assert!(!solver_host_allowed(host), "{host}");
        }
        assert!(solver_host_allowed("torrentio.strem.fun"));
    }

    #[test]
    fn connected_letterboxd_friends_reviews_cannot_open_checking_source() {
        let url: reqwest::Url =
            "https://letterboxd.com/fixture/friends/film/practical-magic/reviews/"
                .parse()
                .unwrap();
        for status in [403, 503] {
            assert!(super::is_cloudflare_challenge(
                status,
                Some("challenge"),
                "<title>Just a moment...</title>",
            ));
            assert!(!solver_host_allowed(url.host_str().unwrap()));
        }
    }

    #[test]
    fn solver_clearance_replaces_stale_cf_cookies_and_keeps_the_session() {
        assert_eq!(
            merge_cookie_headers(
                "session=abc; cf_clearance=stale",
                "session=solver; __cf_bm=fresh; cf_clearance=new"
            ),
            "session=abc; cf_clearance=new; __cf_bm=fresh"
        );
        assert_eq!(
            merge_cookie_headers("", "session=solver; cf_clearance=new"),
            "session=solver; cf_clearance=new"
        );
    }

    #[test]
    fn verified_browser_preference_suppresses_native_retries_only_for_supported_requests() {
        // A browser-only session should bypass a second native 403 immediately
        // after verification, even on the recursive retry path.
        assert!(super::should_use_verified_browser(false, true, true, true));
        assert!(super::should_use_verified_browser(true, true, true, true));
        assert!(!super::should_use_verified_browser(true, true, true, false));
        assert!(!super::should_use_verified_browser(
            false, false, true, true
        ));
        assert!(!super::should_use_verified_browser(
            false, true, false, true
        ));
    }

    #[test]
    fn browser_fallback_only_handles_simple_text_gets() {
        let mut request = HarborFetchArgs {
            url: "https://example.org/catalog".into(),
            method: Some("GET".into()),
            headers: None,
            body: None,
            body_base64: None,
            timeout_ms: None,
            response_type: None,
            max_response_bytes: None,
            credential_handle: None,
            public_network_only: None,
            allow_local_network: None,
            follow_redirects: None,
            thumb_width_px: None,
            cache_image: None,
        };
        assert!(super::can_browser_fallback(&request));
        request.headers = Some(HashMap::from([("Accept".into(), "text/html".into())]));
        assert!(super::can_browser_fallback(&request));
        request.headers = Some(HashMap::from([(
            "User-Agent".into(),
            "Plugin browser UA".into(),
        )]));
        assert!(super::can_browser_fallback(&request));
        request.headers = Some(HashMap::from([(
            "Referer".into(),
            "https://example.org/".into(),
        )]));
        assert!(super::can_browser_fallback(&request));
        request.headers = Some(HashMap::from([(
            "Referer".into(),
            "https://other.example/".into(),
        )]));
        assert!(!super::can_browser_fallback(&request));
        request.headers = Some(HashMap::from([("Authorization".into(), "secret".into())]));
        assert!(!super::can_browser_fallback(&request));
        request.headers = None;
        request.method = Some("POST".into());
        assert!(!super::can_browser_fallback(&request));
        request.method = Some("GET".into());
        request.max_response_bytes = Some(2048);
        assert!(!super::can_browser_fallback(&request));
    }

    #[test]
    fn detects_managed_and_localized_cloudflare_challenges() {
        assert!(is_cloudflare_challenge(200, Some("challenge"), ""));
        assert!(is_cloudflare_challenge(
            403,
            None,
            "Enable JavaScript and cookies to continue",
        ));
        assert!(is_cloudflare_challenge(
            503,
            None,
            r#"<script src="/cdn-cgi/challenge-platform/h/b/orchestrate/chl_page/v1"></script>"#,
        ));
    }

    #[test]
    fn cross_host_redirects_strip_credentials() {
        let mut headers = vec![
            ("X-API-Key".to_string(), "secret".to_string()),
            ("Authorization".to_string(), "Bearer secret".to_string()),
            ("Cookie".to_string(), "session=secret".to_string()),
            ("X-Unknown-Token".to_string(), "synthetic-only".to_string()),
            ("Accept".to_string(), "application/zip".to_string()),
        ];
        headers.retain(|(name, _)| crate::http_redirect::safe_cross_origin_header(name));
        assert_eq!(
            headers,
            vec![("Accept".to_string(), "application/zip".to_string())]
        );
    }

    #[test]
    fn redirect_origin_includes_scheme_and_effective_port() {
        let https = reqwest::Url::parse("https://example.test/path").unwrap();
        let same = reqwest::Url::parse("https://example.test/next").unwrap();
        let downgrade = reqwest::Url::parse("http://example.test:443/next").unwrap();

        assert!(same_origin(&https, &same));
        assert!(!same_origin(&https, &downgrade));
        assert!(is_https_downgrade(&https, &downgrade));
    }

    #[test]
    fn cross_origin_redirects_never_forward_request_bodies() {
        use reqwest::{Method, StatusCode};

        for (status, method) in [
            (StatusCode::TEMPORARY_REDIRECT, Method::POST),
            (StatusCode::PERMANENT_REDIRECT, Method::POST),
            (StatusCode::MOVED_PERMANENTLY, Method::PUT),
            (StatusCode::FOUND, Method::PATCH),
        ] {
            let mut redirected_method = method;
            let mut body = Some(b"secret".to_vec());
            apply_redirect_method(&mut redirected_method, &mut body, status);
            assert!(cross_origin_redirect_forwards_body(true, &body));
            assert!(!cross_origin_redirect_forwards_body(false, &body));
        }

        let mut method = Method::POST;
        let mut body = Some(b"safe-to-drop".to_vec());
        apply_redirect_method(&mut method, &mut body, StatusCode::SEE_OTHER);
        assert!(!cross_origin_redirect_forwards_body(true, &body));
    }

    #[test]
    fn provider_public_network_policy_rejects_local_and_reserved_ranges() {
        for value in [
            "127.0.0.1",
            "10.0.0.1",
            "172.16.0.1",
            "192.168.1.1",
            "100.64.0.1",
            "169.254.1.1",
            "198.18.0.1",
            "203.0.113.1",
            "::1",
            "fe80::1",
            "fc00::1",
            "fec0::1",
            "2001:db8::1",
            "2002:0a00:0001::1",
            "::ffff:127.0.0.1",
        ] {
            let ip: std::net::IpAddr = value.parse().unwrap();
            assert!(!is_public_network_ip(ip), "{value}");
        }
        for value in ["1.1.1.1", "8.8.8.8", "2606:4700:4700::1111"] {
            let ip: std::net::IpAddr = value.parse().unwrap();
            assert!(is_public_network_ip(ip), "{value}");
        }
    }

    #[test]
    fn guarded_fetch_blocks_loopback_literals() {
        for value in [
            "http://127.0.0.1:4567/api",
            "http://[::1]:4567/api",
            "http://[::ffff:127.0.0.1]:4567/api",
            "http://0.0.0.0:4567/api",
            "http://169.254.169.254/latest/meta-data/",
        ] {
            let url: reqwest::Url = value.parse().unwrap();
            assert!(host_is_blocked_literal(&url), "{value}");
        }
        for value in [
            "http://sonicbit.example.com:4567/api",
            "http://192.168.1.10:4567/api",
            "http://8.8.8.8:4567/api",
        ] {
            let url: reqwest::Url = value.parse().unwrap();
            assert!(!host_is_blocked_literal(&url), "{value}");
        }
    }

    #[tokio::test]
    async fn validate_target_respects_allow_local() {
        for value in [
            "http://127.0.0.1:4567/api",
            "http://[::1]:4567/api",
            "http://[::ffff:127.0.0.1]:4567/api",
            "http://0.0.0.0:4567/api",
            "http://169.254.169.254/latest/meta-data/",
        ] {
            let url: reqwest::Url = value.parse().unwrap();
            assert!(
                validate_target(&url, false).await.is_err(),
                "{value} blocked"
            );
            assert!(
                validate_target(&url, true).await.is_ok(),
                "{value} allowed with allow_local"
            );
        }
        for value in ["http://192.168.1.10:4567/api", "http://8.8.8.8:4567/api"] {
            let url: reqwest::Url = value.parse().unwrap();
            assert!(
                validate_target(&url, false).await.is_ok(),
                "{value} public ok"
            );
        }
    }
}
