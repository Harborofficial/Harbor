//! Cooperative cancellation for native subtitle analysis. Frontend timeouts
//! cancel the actual native future, dropping FFmpeg's kill-on-drop child.
use std::collections::HashMap;
use std::future::Future;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use tokio::sync::Notify;

struct CancelFlag {
    cancelled: AtomicBool,
    notify: Notify,
}
type Registry = Mutex<HashMap<String, (Instant, Arc<CancelFlag>)>>;
static SESSIONS: OnceLock<Registry> = OnceLock::new();
const SESSION_TTL: Duration = Duration::from_secs(180);
const MAX_SESSIONS: usize = 128;

fn valid_id(value: &str) -> bool {
    (8..=96).contains(&value.len())
        && value
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'-' | b'_' | b'.'))
}

fn get_flag(id: &str) -> Option<Arc<CancelFlag>> {
    if !valid_id(id) {
        return None;
    }
    let mut sessions = SESSIONS
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
        .ok()?;
    sessions.retain(|_, (when, _)| when.elapsed() < SESSION_TTL);
    if let Some((_, flag)) = sessions.get(id) {
        return Some(Arc::clone(flag));
    }
    if sessions.len() >= MAX_SESSIONS {
        // Evict the oldest entry; a job started more recently is more likely
        // to be active. Never keep URL, header, or subtitle text in this map.
        if let Some(oldest) = sessions
            .iter()
            .min_by_key(|(_, (t, _))| *t)
            .map(|(k, _)| k.clone())
        {
            sessions.remove(&oldest);
        }
    }
    let flag = Arc::new(CancelFlag {
        cancelled: AtomicBool::new(false),
        notify: Notify::new(),
    });
    sessions.insert(id.to_string(), (Instant::now(), Arc::clone(&flag)));
    Some(flag)
}

#[tauri::command]
pub fn subsync_cancel_session(session_id: String) -> bool {
    let Some(flag) = get_flag(&session_id) else {
        return false;
    };
    flag.cancelled.store(true, Ordering::Release);
    flag.notify.notify_waiters();
    true
}

async fn wait_cancelled(flag: Arc<CancelFlag>) {
    loop {
        // Install the listener *before* testing the flag to avoid lost wakes.
        if flag.cancelled.load(Ordering::Acquire) {
            return;
        }
        // The cancel signal can arrive before a Notify waiter is registered.
        // Periodically check the atomic flag as well to eliminate lost wakes.
        tokio::select! {
            () = flag.notify.notified() => {}
            () = tokio::time::sleep(Duration::from_millis(100)) => {}
        }
    }
}

pub async fn run<T>(session_id: Option<&str>, work: impl Future<Output = T>) -> Result<T, String> {
    let Some(flag) = session_id.and_then(get_flag) else {
        return Ok(work.await);
    };
    tokio::select! {
        result = work => Ok(result),
        () = wait_cancelled(flag) => Err("subsync-cancelled".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn cancel_interrupts_an_active_job() {
        let id = "subsync-test-cancel-active-a";
        let waiter = run(Some(id), std::future::pending::<()>());
        let trigger = async {
            assert!(subsync_cancel_session(id.to_string()));
        };
        let (result, ()) = tokio::join!(waiter, trigger);
        assert_eq!(result.unwrap_err(), "subsync-cancelled");
    }
    #[tokio::test]
    async fn cancelled_before_registration_stays_cancelled() {
        let id = "subsync-test-cancel-early-b";
        assert!(subsync_cancel_session(id.to_string()));
        let result = run(Some(id), std::future::pending::<()>()).await;
        assert_eq!(result.unwrap_err(), "subsync-cancelled");
    }
    #[test]
    fn rejects_untrusted_session_ids() {
        assert!(!subsync_cancel_session("bad".into()));
        assert!(!subsync_cancel_session("../../bad-id".into()));
    }
}
