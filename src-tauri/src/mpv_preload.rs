use std::sync::{
    atomic::{AtomicU64, Ordering},
    Mutex,
};
use std::time::{Duration, Instant};

static NEXT_TOKEN: AtomicU64 = AtomicU64::new(1);
const SELECTION_TIMEOUT: Duration = Duration::from_secs(2);

struct Pending {
    id: u64,
    token: String,
    deadline: Instant,
}

#[derive(Default)]
pub struct PreloadSelection {
    pending: Mutex<Option<Pending>>,
}

impl PreloadSelection {
    pub fn begin(&self, id: u64) -> String {
        let token = NEXT_TOKEN.fetch_add(1, Ordering::Relaxed).to_string();
        *self.pending.lock().unwrap_or_else(|e| e.into_inner()) = Some(Pending {
            id,
            token: token.clone(),
            deadline: Instant::now() + SELECTION_TIMEOUT,
        });
        token
    }

    pub fn finish(&self, token: &str, apply: impl FnOnce(u64)) -> bool {
        let mut pending = self.pending.lock().unwrap_or_else(|e| e.into_inner());
        let Some(current) = pending.as_ref() else {
            return false;
        };
        if current.token != token || Instant::now() >= current.deadline {
            return false;
        }
        // Serialize selection with timeout release so a stale reply cannot
        // change tracks after the hook has already continued.
        let current = pending.take().unwrap();
        apply(current.id);
        true
    }

    pub fn expire(&self, resume: impl FnOnce(u64)) -> bool {
        let mut pending = self.pending.lock().unwrap_or_else(|e| e.into_inner());
        if !pending
            .as_ref()
            .is_some_and(|p| Instant::now() >= p.deadline)
        {
            return false;
        }
        let current = pending.take().unwrap();
        resume(current.id);
        true
    }

    pub fn poll_timeout(&self, normal: f64) -> f64 {
        let pending = self.pending.lock().unwrap_or_else(|e| e.into_inner());
        pending.as_ref().map_or(normal, |p| {
            normal.min(
                p.deadline
                    .saturating_duration_since(Instant::now())
                    .as_secs_f64(),
            )
        })
    }
}
