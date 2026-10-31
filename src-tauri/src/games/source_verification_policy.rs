//! Source verification credentials never leave native memory or their profile/origin.
use reqwest::Url;
use std::time::{Duration, Instant};
use zeroize::Zeroizing;

pub const MAX_BYTES: usize = 64 * 1024 * 1024;
const MAX_GRANTS: usize = 16;
const LIFETIME: Duration = Duration::from_secs(20 * 60);

pub fn profile(value: &str) -> bool {
    !value.is_empty() && value.len() <= 256 && !value.chars().any(char::is_control)
}

pub fn user_agent(value: &str) -> bool {
    !value.is_empty() && value.len() <= 1024 && value.bytes().all(|b| (32..=126).contains(&b))
}

pub fn cookie(value: &str) -> bool {
    !value.is_empty() && value.len() <= 4096
        && value.bytes().all(|b| b == 0x21 || (0x23..=0x2b).contains(&b)
            || (0x2d..=0x3a).contains(&b) || (0x3c..=0x5b).contains(&b) || (0x5d..=0x7e).contains(&b))
}

pub fn source(value: &str) -> Result<Url, &'static str> {
    if value.len() > 8192 || value.chars().any(|c| c.is_control() || c == '\\') {
        return Err("source_url");
    }
    let url = Url::parse(value).map_err(|_| "source_url")?;
    if url.scheme() != "https" || !url.username().is_empty() || url.password().is_some()
        || url.fragment().is_some() || url.port().is_some()
        || !url.domain().is_some_and(|host| host.contains('.') && !host.ends_with('.')) {
        return Err("source_url");
    }
    Ok(url)
}

pub fn same_origin(expected: &Url, actual: &Url) -> bool {
    source(actual.as_str()).is_ok() && expected.origin() == actual.origin()
}

/// Cloudflare's managed challenge renders Turnstile in a cross-origin frame, which in turn
/// hosts its widget in an `about:srcdoc` frame. wry reports frame navigations through the
/// same handler as the main frame, so refusing those targets leaves the challenge spinning
/// forever. Neither `about:srcdoc` nor a blob can be a top-level target, and the challenge
/// origin is fixed, so the main frame still cannot wander off the catalog's own site.
pub fn navigable(expected: &Url, actual: &str) -> bool {
    let target = actual.strip_prefix("blob:").unwrap_or(actual);
    target == "about:blank"
        || target == "about:srcdoc"
        || target.starts_with("https://challenges.cloudflare.com/")
        || Url::parse(target).is_ok_and(|url| same_origin(expected, &url))
}

#[derive(Clone)]
pub struct Grant {
    pub cookie: Zeroizing<String>,
    pub user_agent: String,
    pub generation: String,
}

struct Entry { profile: String, origin: String, grant: Grant, until: Instant }

#[derive(Default)]
pub struct Grants { entries: Vec<Entry> }

impl Grants {
    pub fn insert(&mut self, profile: &str, url: &Url, value: String, user_agent: String, generation: String, now: Instant) {
        self.entries.retain(|entry| entry.until > now && !(entry.profile == profile && entry.origin == url.origin().ascii_serialization()));
        if self.entries.len() >= MAX_GRANTS { self.entries.remove(0); }
        self.entries.push(Entry { profile: profile.to_owned(), origin: url.origin().ascii_serialization(),
            grant: Grant { cookie: Zeroizing::new(value), user_agent, generation }, until: now + LIFETIME });
    }

    pub fn get(&mut self, profile: &str, url: &Url, now: Instant) -> Option<Grant> {
        self.entries.retain(|entry| entry.until > now);
        self.entries.iter().find(|entry| entry.profile == profile && entry.origin == url.origin().ascii_serialization()).map(|entry| entry.grant.clone())
    }

    pub fn reject(&mut self, profile: &str, url: &Url, generation: &str) {
        self.entries.retain(|entry| !(entry.profile == profile && entry.origin == url.origin().ascii_serialization() && entry.grant.generation == generation));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn refuses_unbound_or_unsafe_browser_targets() {
        for input in ["http://hydralinks.cloud/feed.json", "https://localhost/feed", "https://127.0.0.1/feed", "https://[::1]/feed",
            "https://user:pass@hydralinks.cloud/feed", "https://hydralinks.cloud:8443/feed", "https://hydralinks.cloud/feed#x", "https://hydralinks.cloud./feed", "https://hydralinks.cloud/\\evil"] {
            assert!(source(input).is_err(), "{input}");
        }
        let url = source("https://hydralinks.cloud/sources/fitgirl.json").unwrap();
        assert!(same_origin(&url, &source("https://hydralinks.cloud/cdn-cgi/challenge-platform/test").unwrap()));
        assert!(!same_origin(&url, &source("https://sub.hydralinks.cloud/feed").unwrap()));
        assert!(!same_origin(&url, &source("https://hydralinks.cloud.evil.example/feed").unwrap()));
    }
    #[test]
    fn challenge_frames_are_navigable_but_other_origins_are_not() {
        let url = source("https://hydralinks.cloud/sources/fitgirl.json").unwrap();
        for input in ["about:blank", "https://hydralinks.cloud/cdn-cgi/challenge-platform/h/g/jsd/r/0.1",
            "https://challenges.cloudflare.com/cdn-cgi/challenge-platform/h/g/turnstile/if/ov2/av0/0/x/light/normal/auto/",
            "about:srcdoc", "blob:https://challenges.cloudflare.com/8f3b", "blob:https://hydralinks.cloud/8f3b"] {
            assert!(navigable(&url, input), "{input}");
        }
        for input in ["https://challenges.cloudflare.com.evil.example/turnstile", "https://sub.hydralinks.cloud/feed",
            "http://hydralinks.cloud/sources/fitgirl.json", "about:settings", "javascript:alert(1)", "data:text/html,x"] {
            assert!(!navigable(&url, input), "{input}");
        }
    }
    #[test]
    fn headers_cannot_inject_other_cookies_or_requests() {
        for value in ["", "x; other=secret", "x\r\nHost: example.org", "x y", "x,y", "x\"y", "x\\y"] { assert!(!cookie(value)); }
        assert!(cookie("abc_DEF-123.~=token"));
        assert!(!cookie(&"a".repeat(4097)));
        assert!(!user_agent("Browser\r\nCookie: secret"));
        assert!(!profile("profile\nother"));
    }
    fn insert(grants: &mut Grants, profile: &str, url: &Url, generation: &str, now: Instant) {
        grants.insert(profile, url, "cf_clearance=test".into(), "Browser".into(), generation.into(), now);
    }
    #[test]
    fn clearance_is_profile_and_exact_origin_scoped_and_expires() {
        let mut grants = Grants::default(); let now = Instant::now();
        let url = source("https://catalog.example/feed.json").unwrap();
        insert(&mut grants, "one", &url, "first", now);
        assert!(grants.get("two", &url, now).is_none());
        assert!(grants.get("one", &source("https://other.catalog.example/feed.json").unwrap(), now).is_none());
        assert!(grants.get("one", &source("https://catalog.example/second.json").unwrap(), now).is_some());
        assert!(grants.get("one", &url, now + LIFETIME).is_none());
        assert!(grants.entries.is_empty());
    }
    #[test]
    fn stale_request_cannot_remove_new_clearance() {
        let mut grants = Grants::default(); let now = Instant::now(); let url = source("https://catalog.example/feed").unwrap();
        insert(&mut grants, "one", &url, "old", now); insert(&mut grants, "one", &url, "new", now);
        grants.reject("one", &url, "old"); assert_eq!(grants.get("one", &url, now).unwrap().generation, "new");
        grants.reject("one", &url, "new"); assert!(grants.get("one", &url, now).is_none());
    }
    #[test]
    fn clearance_cache_has_fixed_capacity() {
        let mut grants = Grants::default(); let now = Instant::now(); let url = source("https://catalog.example/feed").unwrap();
        for index in 0..100 { insert(&mut grants, &index.to_string(), &url, "id", now); }
        assert_eq!(grants.entries.len(), MAX_GRANTS);
        assert!(grants.get("0", &url, now).is_none()); assert!(grants.get("99", &url, now).is_some());
    }
}
