use serde::Deserialize;
use std::collections::HashMap;
use std::sync::mpsc;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use tauri::{AppHandle, Manager, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tokio::sync::{oneshot, Mutex as AsyncMutex};

const SOLVER_LABEL: &str = "harbor-cf-solver";
const CF_TTL: Duration = Duration::from_secs(20 * 60);
const SOLVER_RETRY_COOLDOWN: Duration = Duration::from_secs(30);

static PENDING: Mutex<Option<oneshot::Sender<()>>> = Mutex::new(None);

fn request_lock() -> &'static AsyncMutex<()> {
    static LOCK: OnceLock<AsyncMutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| AsyncMutex::new(()))
}

struct CfEntry {
    cookie: String,
    ua: String,
    at: Instant,
}

// Cloudflare sometimes accepts the embedded browser without issuing a
// transferable cf_clearance cookie. This grants only same-origin browser
// fetching, never permission to replay a fabricated cookie in reqwest.
struct BrowserSession {
    at: Instant,
}

fn browser_sessions() -> &'static Mutex<HashMap<String, BrowserSession>> {
    static S: OnceLock<Mutex<HashMap<String, BrowserSession>>> = OnceLock::new();
    S.get_or_init(|| Mutex::new(HashMap::new()))
}

pub fn cf_browser_ready(host: &str) -> bool {
    browser_sessions()
        .lock()
        .unwrap()
        .get(host)
        .is_some_and(|session| session.at.elapsed() < CF_TTL)
}

fn cf_browser_mark_ready(host: &str) {
    browser_sessions()
        .lock()
        .unwrap()
        .insert(host.to_string(), BrowserSession { at: Instant::now() });
}

fn cf_cache() -> &'static Mutex<HashMap<String, CfEntry>> {
    static C: OnceLock<Mutex<HashMap<String, CfEntry>>> = OnceLock::new();
    C.get_or_init(|| Mutex::new(HashMap::new()))
}

fn solver_cooldown() -> &'static Mutex<HashMap<String, Instant>> {
    static C: OnceLock<Mutex<HashMap<String, Instant>>> = OnceLock::new();
    C.get_or_init(|| Mutex::new(HashMap::new()))
}

fn solver_cooldown_active(host: &str) -> bool {
    let mut active = solver_cooldown().lock().unwrap();
    active.retain(|_, time| time.elapsed() < SOLVER_RETRY_COOLDOWN);
    active.contains_key(host)
}

fn note_solver_cooldown(host: &str) {
    solver_cooldown()
        .lock()
        .unwrap()
        .insert(host.to_owned(), Instant::now());
}

fn clear_solver_cooldown(host: &str) {
    solver_cooldown().lock().unwrap().remove(host);
}

// A bot-management cookie is not clearance; only Cloudflare's clearance cookie
// establishes that a challenge has been passed.
fn is_clearance_cookie(name: &str) -> bool {
    name == "cf_clearance"
}

pub fn cf_cached(host: &str) -> Option<(String, String)> {
    let cache = cf_cache().lock().unwrap();
    let entry = cache.get(host)?;
    if entry.at.elapsed() > CF_TTL {
        return None;
    }
    Some((entry.cookie.clone(), entry.ua.clone()))
}

pub fn cf_invalidate(host: &str) {
    cf_cache().lock().unwrap().remove(host);
}

/// Must already be on the main thread. Topmost is set before the window is shown
/// because Windows refuses SetForegroundWindow to a process that does not own the
/// current foreground window, which left the check sitting behind Harbor.
fn raise_window(w: &tauri::WebviewWindow) {
    let _ = w.unminimize();
    let _ = w.set_always_on_top(true);
    let _ = w.show();
    let _ = w.set_focus();
}

struct SolverDismiss(AppHandle);

impl Drop for SolverDismiss {
    fn drop(&mut self) {
        if let Some(w) = self.0.get_webview_window(SOLVER_LABEL) {
            let _ = w.set_always_on_top(false);
            let _ = w.hide();
        }
    }
}

fn harvest(app: &AppHandle, url: &str, ua: &str) -> bool {
    let Some(win) = app.get_webview_window(SOLVER_LABEL) else {
        return false;
    };
    let Ok(parsed) = Url::parse(url) else {
        return false;
    };
    let Some(host) = parsed.host_str().map(|s| s.to_string()) else {
        return false;
    };
    if ua.is_empty() {
        return false;
    }
    let cookies = match win.cookies_for_url(parsed) {
        Ok(c) => c,
        Err(e) => {
            eprintln!("[cf] cookie read failed: {e}");
            return false;
        }
    };
    let mut parts: Vec<String> = Vec::new();
    let mut has_clearance = false;
    for c in cookies {
        let name = c.name();
        if is_clearance_cookie(name) && !c.value().is_empty() {
            has_clearance = true;
        }
        parts.push(format!("{}={}", name, c.value()));
    }
    if !has_clearance {
        return false;
    }
    let cookie = parts.join("; ");
    cf_cache().lock().unwrap().insert(
        host.clone(),
        CfEntry {
            cookie,
            ua: ua.to_string(),
            at: Instant::now(),
        },
    );
    eprintln!("[cf] harvested clearance for {}", host);
    true
}

// Native WebView evaluation avoids exposing Harbor IPC to arbitrary Cloudflare
// pages. Do not grant remote HTTP(S) origins Tauri command permissions.
const PROBE_SCRIPT: &str = r#"(() => {
  const title = (document.title || '').toLowerCase();
  const present = (selector) => {
    const el = document.querySelector(selector);
    return !!(el && (el.offsetWidth || el.offsetHeight || el.getClientRects().length));
  };
  const sample = (document.body?.innerText || '').slice(0, 1200).toLowerCase();
  const challenged =
    title.includes('just a moment') || title.includes('attention required') ||
    title.includes('access denied') || title.includes('403 forbidden') ||
    sample.includes('sorry, you have been blocked') ||
    sample.includes('you are being rate limited') || sample.includes('error code: 1020') ||
    sample.includes('error 1015') ||
    present('#challenge-form, #challenge-running, #cf-challenge-running, #cf-please-wait') ||
    (present('.cf-turnstile') && !!document.querySelector('#challenge-form, #challenge-running'));
  // An empty/placeholder document is not evidence of a successful challenge.
  const usable = !!(document.body && document.documentElement?.outerHTML.length >= 200);
  return {
    host: location.hostname || '',
    protocol: location.protocol || '',
    ready: document.readyState || '',
    challenged: !!challenged,
    usable,
    user_agent: navigator.userAgent || ''
  };
})()"#;

#[derive(Clone, Debug, Deserialize)]
struct PageProbe {
    host: String,
    protocol: String,
    ready: String,
    challenged: bool,
    usable: bool,
    user_agent: String,
}

fn probe_is_ready(probe: &PageProbe, target: &Url) -> bool {
    probe
        .host
        .eq_ignore_ascii_case(target.host_str().unwrap_or(""))
        && probe.protocol == target.scheme().to_string() + ":"
        && probe.ready == "complete"
        && !probe.challenged
        && probe.usable
        && !probe.user_agent.is_empty()
}

async fn probe_page(window: &WebviewWindow) -> Result<Option<PageProbe>, String> {
    let (sender, receiver) = oneshot::channel();
    let sender = Mutex::new(Some(sender));
    window
        .eval_with_callback(PROBE_SCRIPT, move |value| {
            if let Ok(mut sender) = sender.lock() {
                if let Some(sender) = sender.take() {
                    let _ = sender.send(value);
                }
            }
        })
        .map_err(|error| format!("probe injection: {error}"))?;
    let raw = match tokio::time::timeout(Duration::from_secs(3), receiver).await {
        Ok(Ok(raw)) => raw,
        _ => return Ok(None),
    };
    serde_json::from_str(&raw)
        .map(Some)
        .map_err(|error| format!("probe decode: {error}"))
}

/// Only ordinary, same-origin text requests can use the already verified WebView.
/// This avoids Cloudflare browser-fingerprint mismatches without exposing native IPC.
pub struct BrowserTextResponse {
    pub status: u16,
    pub body: String,
    pub content_type: Option<String>,
}

#[derive(Deserialize)]
#[serde(tag = "state", rename_all = "snake_case")]
enum BrowserRead {
    Ready {
        status: u16,
        body: String,
        content_type: String,
    },
    Error {
        reason: String,
    },
}

const MAX_BROWSER_TEXT_BYTES: usize = 2 * 1024 * 1024;

fn browser_request_lock() -> &'static AsyncMutex<()> {
    static LOCK: OnceLock<AsyncMutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| AsyncMutex::new(()))
}

// If a same-origin JavaScript fetch is challenged again, a top-level browser
// navigation may still work with its WebView2 fingerprint. Return the actual
// document only after its address and page probe are both verified.
async fn browser_navigation_fetch(
    window: &WebviewWindow,
    target: &Url,
) -> Result<Option<BrowserTextResponse>, String> {
    let current = window
        .url()
        .map_err(|error| format!("browser window address: {error}"))?;
    if target.scheme() != "https" || current.origin() != target.origin() {
        return Ok(None);
    }
    window
        .navigate(target.clone())
        .map_err(|error| format!("browser navigate: {error}"))?;
    let read = format!(
        r#"(() => {{
          if (location.href !== {} || document.readyState !== 'complete') return null;
          const title = (document.title || '').toLowerCase();
          const text = (document.body?.innerText || '').slice(0, 1200).toLowerCase();
          if (title.includes('just a moment') || title.includes('attention required') ||
              title.includes('access denied') || text.includes('sorry, you have been blocked') ||
              text.includes('error code: 1020') || text.includes('error 1015') ||
              document.querySelector('#challenge-form, #challenge-running, #cf-please-wait'))
            return null;
          const html = document.documentElement?.outerHTML || '';
          if (html.length < 200 || html.length > {}) return null;
          return {{state:'ready',status:200,content_type:'text/html; charset=utf-8',body:html}};
        }})()"#,
        serde_json::to_string(target.as_str()).map_err(|error| error.to_string())?,
        MAX_BROWSER_TEXT_BYTES
    );
    let started = Instant::now();
    while started.elapsed() < Duration::from_secs(15) {
        tokio::time::sleep(Duration::from_millis(400)).await;
        let current = match window.url() {
            Ok(url) => url,
            Err(_) => break,
        };
        if current.origin() != target.origin() {
            break;
        }
        if current != *target {
            continue;
        }
        let Some(probe) = probe_page(window).await? else {
            continue;
        };
        if !probe_is_ready(&probe, target) {
            continue;
        }
        let (tx, rx) = oneshot::channel();
        let tx = Mutex::new(Some(tx));
        window
            .eval_with_callback(&read, move |json| {
                if let Ok(mut sender) = tx.lock() {
                    if let Some(sender) = sender.take() {
                        let _ = sender.send(json);
                    }
                }
            })
            .map_err(|error| format!("browser document: {error}"))?;
        let raw = match tokio::time::timeout(Duration::from_secs(3), rx).await {
            Ok(Ok(body)) => body,
            _ => continue,
        };
        if let Ok(Some(BrowserRead::Ready {
            status,
            body,
            content_type,
        })) = serde_json::from_str::<Option<BrowserRead>>(&raw)
        {
            if status == 200 && body.len() <= MAX_BROWSER_TEXT_BYTES {
                eprintln!(
                    "[cf] browser navigation returned verified HTML ({} bytes)",
                    body.len()
                );
                return Ok(Some(BrowserTextResponse {
                    status,
                    body,
                    content_type: Some(content_type),
                }));
            }
        }
    }
    Ok(None)
}

pub async fn cf_browser_fetch(
    app: &AppHandle,
    url: &str,
    accept: Option<&str>,
) -> Result<Option<BrowserTextResponse>, String> {
    let target = Url::parse(url).map_err(|error| format!("url: {error}"))?;
    if target.scheme() != "https" || target.username() != "" || target.password().is_some() {
        return Ok(None);
    }
    let host = target.host_str().ok_or("browser fallback has no host")?;
    if cf_cached(host).is_none() && !cf_browser_ready(host) {
        return Ok(None);
    }
    let _browser_guard = browser_request_lock().lock().await;
    let Some(window) = app.get_webview_window(SOLVER_LABEL) else {
        return Ok(None);
    };
    let current = window
        .url()
        .map_err(|error| format!("browser window address: {error}"))?;
    if current.origin() != target.origin() {
        return Ok(None);
    }
    let Some(probe) = probe_page(&window).await? else {
        return Ok(None);
    };
    if !probe_is_ready(&probe, &target) {
        return Ok(None);
    }

    // Use a fresh per-request key: multiple requests can share the same hidden WebView.
    static REQUEST_ID: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let id = REQUEST_ID
        .fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        .to_string();
    let script = format!(
        r#"
      (() => {{
        const key = {};
        const address = {};
        const cap = {};
        const accept = {};
        const results = window.__harborCfBrowserResults ||= Object.create(null);
        results[key] = null;
        (async () => {{
          let controller = new AbortController();
          let timer = setTimeout(() => controller.abort(), 15000);
          try {{
            if (new URL(address).origin !== location.origin) throw Error('origin');
            const response = await fetch(address, {{
              credentials: 'include',
              redirect: 'error',
              cache: 'no-store',
              signal: controller.signal,
              headers: {{ Accept: accept }}
            }});
            if (!response.ok || response.headers.get('cf-mitigated') === 'challenge')
              throw Error('challenged');
            const contentType = (response.headers.get('content-type') || '').toLowerCase();
            if (!(/text\/|json|xml|javascript/.test(contentType)))
              throw Error('non-text');
            if (Number(response.headers.get('content-length') || 0) > cap)
              throw Error('too-large');
            if (!response.body) throw Error('empty');
            let reader = response.body.getReader();
            let decoder = new TextDecoder();
            let body = '', bytes = 0;
            try {{
              while (true) {{
                const chunk = await reader.read();
                if (chunk.done) break;
                bytes += chunk.value.byteLength;
                if (bytes > cap) throw Error('too-large');
                body += decoder.decode(chunk.value, {{ stream: true }});
              }}
              body += decoder.decode();
            }} finally {{ reader.cancel().catch(() => {{}}); reader.releaseLock(); }}
            if (/<title[^>]*>\s*(just a moment|attention required)|cf_chl_opt|\/cdn-cgi\/challenge-platform\//i.test(body))
              throw Error('challenged');
            results[key] = {{state: 'ready', status: response.status, content_type: contentType, body}};
          }} catch (error) {{
            // A completed interstitial can provide the requested HTML document even
            // if its JS-fetches are challenged again. Only use the exact loaded URL.
            const title = (document.title || '').toLowerCase();
            const pageReady = document.readyState === 'complete' &&
              !title.includes('just a moment') && !title.includes('attention required') &&
              !document.querySelector('#challenge-form, #challenge-running, #cf-please-wait');
            const html = document.documentElement?.outerHTML || '';
            if (pageReady && location.href === address && html.length > 0 && html.length <= cap)
              results[key] = {{state: 'ready', status: 200, content_type: 'text/html; charset=utf-8', body: html}};
            else results[key] = {{state: 'error', reason: String(error?.message || 'browser fetch failed').slice(0, 48)}};
          }} finally {{ clearTimeout(timer); }}
        }})();
      }})()
    "#,
        serde_json::to_string(&id).map_err(|e| e.to_string())?,
        serde_json::to_string(url).map_err(|e| e.to_string())?,
        MAX_BROWSER_TEXT_BYTES,
        serde_json::to_string(accept.unwrap_or("text/html, application/json, text/plain, */*"))
            .map_err(|error| error.to_string())?
    );
    window
        .eval(&script)
        .map_err(|error| format!("browser request: {error}"))?;

    let read_script = format!(
        "(() => {{ const map = window.__harborCfBrowserResults; const key = {}; if (!map || !map[key]) return null; const value = map[key]; delete map[key]; return value; }})()",
        serde_json::to_string(&id).map_err(|e| e.to_string())?
    );
    let deadline = Instant::now();
    while deadline.elapsed() < Duration::from_secs(19) {
        tokio::time::sleep(Duration::from_millis(300)).await;
        let (sender, receiver) = oneshot::channel();
        let sender = Mutex::new(Some(sender));
        if window
            .eval_with_callback(&read_script, move |value| {
                if let Ok(mut sender) = sender.lock() {
                    if let Some(sender) = sender.take() {
                        let _ = sender.send(value);
                    }
                }
            })
            .is_err()
        {
            return Ok(None);
        }
        let raw = match tokio::time::timeout(Duration::from_secs(2), receiver).await {
            Ok(Ok(value)) => value,
            _ => continue,
        };
        match serde_json::from_str::<Option<BrowserRead>>(&raw) {
            Ok(Some(BrowserRead::Ready {
                status,
                body,
                content_type,
            })) if (200..300).contains(&status) && body.len() <= MAX_BROWSER_TEXT_BYTES => {
                eprintln!(
                    "[cf] browser fallback returned verified text ({} bytes)",
                    body.len()
                );
                return Ok(Some(BrowserTextResponse {
                    status,
                    body,
                    content_type: Some(content_type),
                }));
            }
            Ok(Some(BrowserRead::Error { reason })) => {
                eprintln!("[cf] browser fetch unavailable: {reason}");
                // Only HTML-compatible requests can be fulfilled by browsing to
                // the destination. Never turn a JSON/API request into HTML.
                let html =
                    accept.is_none_or(|value| value.contains("text/html") || value.contains("*/*"));
                if html && reason != "origin" && reason != "too-large" && reason != "non-text" {
                    return browser_navigation_fetch(&window, &target).await;
                }
                return Ok(None);
            }
            Ok(Some(_)) => return Ok(None),
            _ => {}
        }
    }
    eprintln!("[cf] browser fallback timed out");
    Ok(None)
}

fn open_solver(app: &AppHandle, url: &str) -> Result<(), String> {
    if let Some(existing) = app.get_webview_window(SOLVER_LABEL) {
        eprintln!("[cf] reusing solver window");
        let target = Url::parse(url).map_err(|error| format!("url: {error}"))?;
        // Native navigation still works if the challenge page has disabled scripts.
        existing
            .navigate(target)
            .map_err(|error| format!("solver navigation: {error}"))?;
        let w = existing.clone();
        let _ = app.run_on_main_thread(move || raise_window(&w));
        return Ok(());
    }

    let parsed = Url::parse(url).map_err(|e| format!("url: {e}"))?;
    let app_main = app.clone();
    let (tx, rx) = mpsc::channel::<Result<(), String>>();
    app.run_on_main_thread(move || {
        let builder =
            WebviewWindowBuilder::new(&app_main, SOLVER_LABEL, WebviewUrl::External(parsed))
                .title("Harbor · checking source")
                .inner_size(480.0, 640.0)
                .center()
                .resizable(true)
                .decorations(true)
                .shadow(true)
                .focused(true)
                .on_page_load(|_, payload| {
                    let phase =
                        if matches!(payload.event(), tauri::webview::PageLoadEvent::Finished) {
                            "finished"
                        } else {
                            "started"
                        };
                    eprintln!("[cf] WebView navigation {phase}");
                });
        let built = crate::browser_args::match_main(&app_main, builder).build();
        match built {
            Ok(window) => {
                window.on_window_event(|event| {
                    if matches!(
                        event,
                        tauri::WindowEvent::CloseRequested { .. } | tauri::WindowEvent::Destroyed
                    ) {
                        eprintln!("[cf] solver window closed");
                        // cf_fetch owns the active hostname and applies its own
                        // cooldown on close. Do not cool down an unrelated host.
                        if let Some(tx) = PENDING.lock().unwrap().take() {
                            let _ = tx.send(());
                        }
                    }
                });
                raise_window(&window);
                eprintln!("[cf] solver window built + shown");
                let _ = tx.send(Ok(()));
            }
            Err(e) => {
                eprintln!("[cf] build FAILED: {e}");
                let _ = tx.send(Err(format!("build: {e}")));
            }
        }
    })
    .map_err(|e| format!("main thread: {e}"))?;
    rx.recv_timeout(Duration::from_secs(8))
        .map_err(|e| format!("build wait: {e}"))?
}

pub async fn cf_fetch(app: AppHandle, url: String) -> Result<(), String> {
    let _guard = request_lock().lock().await;
    let host = Url::parse(&url)
        .ok()
        .and_then(|parsed| parsed.host_str().map(|h| h.to_string()));
    if let Some(host) = host.as_deref() {
        if cf_cached(host).is_some() {
            eprintln!("[cf] clearance already cached for {host}");
            return Ok(());
        }
        if cf_browser_ready(host) && app.get_webview_window(SOLVER_LABEL).is_some() {
            eprintln!("[cf] verified browser session already available for {host}");
            return Ok(());
        }
    }
    if solver_cooldown_active(host.as_deref().unwrap_or("")) {
        eprintln!("[cf] solver cooling down after a recent failed or closed attempt");
        return Err("cloudflare solver is cooling down".into());
    }
    let (tx, mut closed) = oneshot::channel::<()>();
    *PENDING.lock().unwrap() = Some(tx);

    eprintln!("[cf] solving {}", url);
    if let Err(error) = open_solver(&app, &url) {
        PENDING.lock().unwrap().take();
        note_solver_cooldown(host.as_deref().unwrap_or(""));
        return Err(error);
    }
    let _dismiss = SolverDismiss(app.clone());
    let Some(window) = app.get_webview_window(SOLVER_LABEL) else {
        PENDING.lock().unwrap().take();
        note_solver_cooldown(host.as_deref().unwrap_or(""));
        return Err("cloudflare solver window missing".into());
    };
    let window_raised = window.clone();
    if let Err(error) = app.run_on_main_thread(move || raise_window(&window_raised)) {
        eprintln!("[cf] could not raise solver window: {error}");
    }

    let target = Url::parse(&url).map_err(|error| format!("url: {error}"))?;
    let start = Instant::now();
    let mut stable_since: Option<Instant> = None;
    let mut last_stage = String::new();
    let mut last_diagnostic = Instant::now();
    loop {
        if start.elapsed() >= Duration::from_secs(90) {
            PENDING.lock().unwrap().take();
            note_solver_cooldown(host.as_deref().unwrap_or(""));
            eprintln!("[cf] timeout after 90 seconds; last stage: {last_stage}");
            return Err("cloudflare challenge timed out".into());
        }
        tokio::select! {
            _ = &mut closed => {
                PENDING.lock().unwrap().take();
                note_solver_cooldown(host.as_deref().unwrap_or(""));
                eprintln!("[cf] verification window closed by user");
                return Err("cloudflare solver window was closed".into());
            }
            _ = tokio::time::sleep(Duration::from_millis(800)) => {}
        }
        match probe_page(&window).await {
            Ok(Some(probe)) => {
                let stage = if probe.challenged {
                    "challenge"
                } else if probe.ready != "complete" {
                    "loading"
                } else if !probe
                    .host
                    .eq_ignore_ascii_case(target.host_str().unwrap_or(""))
                {
                    "redirected"
                } else {
                    "page-ready"
                };
                if stage != last_stage || last_diagnostic.elapsed() >= Duration::from_secs(10) {
                    eprintln!(
                        "[cf] page stage={stage} ready={} elapsed={}s",
                        probe.ready,
                        start.elapsed().as_secs()
                    );
                    last_stage = stage.to_string();
                    last_diagnostic = Instant::now();
                }
                if probe_is_ready(&probe, &target) {
                    let stable = stable_since.get_or_insert_with(Instant::now);
                    if stable.elapsed() >= Duration::from_secs(2) {
                        let has_cookie = harvest(&app, &url, &probe.user_agent);
                        if let Some(host) = host.as_deref() {
                            cf_browser_mark_ready(host);
                            if !has_cookie {
                                eprintln!("[cf] browser page verified for {host}; no transferable clearance cookie; using browser-only session");
                            }
                        }
                        PENDING.lock().unwrap().take();
                        clear_solver_cooldown(host.as_deref().unwrap_or(""));
                        return Ok(());
                    }
                } else {
                    stable_since = None;
                }
            }
            Ok(None) => {
                if last_diagnostic.elapsed() >= Duration::from_secs(10) {
                    eprintln!(
                        "[cf] waiting for WebView JavaScript evaluation ({}s)",
                        start.elapsed().as_secs()
                    );
                    last_diagnostic = Instant::now();
                }
            }
            Err(error) => {
                if last_diagnostic.elapsed() >= Duration::from_secs(10) {
                    eprintln!("[cf] {error} ({}s)", start.elapsed().as_secs());
                    last_diagnostic = Instant::now();
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bot_management_cookie_alone_is_not_clearance() {
        assert!(is_clearance_cookie("cf_clearance"));
        assert!(!is_clearance_cookie("__cf_bm"));
        assert!(!is_clearance_cookie("cf_chl_2"));
        assert!(!is_clearance_cookie("session"));
    }

    #[test]
    fn solver_cooldown_only_applies_to_the_challenged_host() {
        note_solver_cooldown("host-a.example");
        assert!(solver_cooldown_active("host-a.example"));
        assert!(!solver_cooldown_active("host-b.example"));
        clear_solver_cooldown("host-a.example");
        assert!(!solver_cooldown_active("host-a.example"));
    }

    #[test]
    fn browser_only_verification_does_not_fabricate_native_clearance() {
        let host = "browser-only-cloudflare-fixture.invalid";
        cf_browser_mark_ready(host);
        assert!(cf_browser_ready(host));
        assert!(cf_cached(host).is_none());
    }

    #[test]
    fn only_completed_same_origin_non_challenge_pages_are_ready() {
        let target = Url::parse("https://example.org/comics").unwrap();
        let valid = PageProbe {
            host: "example.org".into(),
            protocol: "https:".into(),
            ready: "complete".into(),
            challenged: false,
            usable: true,
            user_agent: "Example browser".into(),
        };
        assert!(probe_is_ready(&valid, &target));
        assert!(!probe_is_ready(
            &PageProbe {
                challenged: true,
                ..valid.clone()
            },
            &target
        ));
        assert!(!probe_is_ready(
            &PageProbe {
                ready: "loading".into(),
                ..valid.clone()
            },
            &target
        ));
        assert!(!probe_is_ready(
            &PageProbe {
                host: "evil.example".into(),
                ..valid.clone()
            },
            &target
        ));
        assert!(!probe_is_ready(
            &PageProbe {
                usable: false,
                ..valid.clone()
            },
            &target
        ));
        assert!(!probe_is_ready(
            &PageProbe {
                user_agent: String::new(),
                ..valid
            },
            &target
        ));
    }
}
