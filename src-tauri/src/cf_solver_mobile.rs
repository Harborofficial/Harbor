// Android stand-in for cf_solver, bound as `crate::cf_solver` by a #[path]
// mod declaration in lib.rs so http_fetch compiles unmodified.
//
// The real solver drives a hidden webview window through a Cloudflare
// interstitial. Android has one webview and no second window, so the capability
// is genuinely absent rather than merely unported. These are real bodies, not
// placeholders: the cache is always empty and cf_fetch reports the failure so
// harbor_fetch surfaces the original Cloudflare response instead of silently
// returning a challenge page as if it were content.

use tauri::AppHandle;

pub fn cf_cached(_host: &str) -> Option<(String, String)> {
    None
}

pub fn cf_invalidate(_host: &str) {}

pub fn cf_browser_ready(_host: &str) -> bool {
    false
}

pub fn cf_browser_ready_for(_app: &AppHandle, _host: &str) -> bool {
    false
}
pub fn cf_prefer_browser(_host: &str) -> bool {
    false
}
pub fn cf_note_native_rechallenge(_host: &str) {}
pub fn cf_browser_cooling_down(_host: &str) -> bool {
    false
}
pub fn cf_note_browser_failure(_host: &str) {}
pub fn cf_clear_browser_failure(_host: &str) {}
pub fn cf_security_page_reason(_body: &str) -> Option<&'static str> {
    None
}

pub async fn cf_fetch(_app: AppHandle, url: String) -> Result<(), String> {
    Err(format!(
        "cloudflare challenge for {} cannot be solved on Android: the solver needs a second webview window",
        url
    ))
}

// The desktop-only browser fallback has no WebView equivalent on Android.
// Keep the shared HTTP API compatible without presenting a challenge as data.
pub struct BrowserTextResponse {
    pub status: u16,
    pub body: String,
    pub content_type: Option<String>,
}

pub async fn cf_browser_fetch(
    _app: &AppHandle,
    _url: &str,
    _accept: Option<&str>,
) -> Result<Option<BrowserTextResponse>, String> {
    Ok(None)
}
