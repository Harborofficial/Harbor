mod api;
mod artist_catalog;
mod auth;
mod browse;
pub mod connector;
mod control;
mod device_auth;
pub mod devices;
mod keystore;
pub(super) mod library;
#[cfg(not(feature="music-sidecar"))]
mod meter;
mod parse;
#[cfg(not(feature="music-sidecar"))]
mod player;
#[cfg(feature="music-sidecar")]
#[path="player_sidecar.rs"]
mod player;
mod session;
mod tokens;

pub use device_auth::{DevicePoll, DevicePrompt};

use super::{MusicConnection, MusicTrack};
use super::engine::MusicMeterSnapshot;
#[cfg(not(feature="music-sidecar"))]
use super::engine::MusicMeterChannel;
use librespot_core::authentication::Credentials;
use librespot_core::session::Session;
use parking_lot::RwLock;
use serde::Serialize;
use session::AccountTier;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use tauri::AppHandle;
use tokio::sync::Mutex;

const NOT_INITIALIZED: &str = "Spotify storage is not initialized";
/// Strongest level the analyzers report, matching the mpv meter's clamp.
#[cfg(not(feature="music-sidecar"))]
const MAX_METER_DB: f64 = 24.0;
/// How far the volume compensation may lift a measurement, so a nearly silent slider
/// cannot turn into signal.
#[cfg(not(feature="music-sidecar"))]
const MAX_COMPENSATION_DB: f64 = 60.0;

/// Decibels to add back to a measurement that already went through the soft volume.
#[cfg(not(feature="music-sidecar"))]
fn meter_level_offset_db(attenuation: f64) -> f64 {
    if !attenuation.is_finite() || attenuation <= 0.0 || attenuation >= 1.0 {
        return 0.0;
    }
    (-20.0 * attenuation.log10()).min(MAX_COMPENSATION_DB)
}

#[cfg(not(feature="music-sidecar"))]
fn lift_level(db: f64, offset: f64) -> f64 {
    (db + offset).min(MAX_METER_DB)
}

struct SpotifyRuntime {
    session: Session,
    audio: player::SpotifyPlayer,
}

struct Account {
    session: Option<Session>,
    username: String,
    country: String,
    tier: AccountTier,
}

impl Account {
    fn empty() -> Self {
        Self {
            session: None,
            username: String::new(),
            country: String::new(),
            tier: AccountTier::Unknown,
        }
    }

    fn connected(&self) -> bool {
        self.session
            .as_ref()
            .is_some_and(|session| !session.is_invalid())
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpotifyStatus {
    /// A saved account authorization exists; this alone does not mean audio can play.
    pub connected: bool,
    /// A live local librespot session has been established for playback.
    pub playback_ready: bool,
    /// Playback pairing is remembered even when the local audio session is offline.
    pub playback_linked: bool,
    /// Browsing can use a current/refreshable Web API token or the live local session.
    pub browsing_ready: bool,
    /// The Web API token belongs to the listener's own developer app, not librespot.
    pub own_app_browsing: bool,
    /// Stable Spotify account identifier for internal correlation, not a UI label.
    pub username: Option<String>,

    pub country: Option<String>,
    pub premium: bool,
    pub account_type: Option<String>,
    pub error: Option<String>,
}

/// What the local librespot player holds right now; the position is the last one it reported.
#[derive(Debug, Clone)]
pub struct SpotifyPlaybackState {
    pub live: bool,
    pub paused: bool,
    pub track: Option<MusicTrack>,
    pub position_seconds: Option<f64>,
}

pub struct SpotifyState {
    runtime: Mutex<Option<SpotifyRuntime>>,
    account: RwLock<Account>,
    cache_dir: RwLock<Option<PathBuf>>,
    app: RwLock<Option<AppHandle>>,
    http: reqwest::Client,
    web_token: RwLock<Option<keystore::WebToken>>,

    last_error: RwLock<Option<String>>,
    linked: AtomicBool,
    remote: RwLock<Option<String>>,
    pub(super) remote_watch: AtomicU64,
    device: RwLock<Option<device_auth::PendingDevice>>,
    paused: AtomicBool,
    paused_for_video: AtomicBool,
}

impl SpotifyState {
    pub fn new() -> Self {
        Self {
            runtime: Mutex::new(None),
            account: RwLock::new(Account::empty()),
            cache_dir: RwLock::new(None),
            app: RwLock::new(None),
            http: http_client(),
            web_token: RwLock::new(None),

            last_error: RwLock::new(None),
            linked: AtomicBool::new(false),
            remote: RwLock::new(None),
            remote_watch: AtomicU64::new(0),
            device: RwLock::new(None),
            paused: AtomicBool::new(true),
            paused_for_video: AtomicBool::new(false),
        }
    }

    pub fn initialize(self: &Arc<Self>, app: &AppHandle, cache_dir: PathBuf) {
        *self.cache_dir.write() = Some(cache_dir.clone());
        *self.app.write() = Some(app.clone());
        *self.remote.write() = keystore::read(app, keystore::PLAY_TARGET_KEY);
        let cache = match session::make_cache(&cache_dir) {
            Ok(cache) => cache,
            Err(error) => {
                self.record_failure(error);
                return;
            }
        };
        let Some(credentials) = keystore::load(app, &cache_dir) else {
            return;
        };
        self.linked.store(true, Ordering::SeqCst);
        let state = self.clone();
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            if let Err(error) = state.connect_with(app, cache, credentials).await {
                state.record_failure(error);
            }
        });
    }

    pub async fn connect_interactive(&self, app: AppHandle) -> Result<SpotifyStatus, String> {
        *self.app.write() = Some(app.clone());
        let cache_dir = self.cache_path()?;
        let granted = match auth::authorize(&app).await {
            Ok(granted) => granted,
            Err(error) => {
                self.record_failure(error.clone());
                return Err(error);
            }
        };
        let cache = session::make_cache(&cache_dir)?;
        let credentials = Credentials::with_access_token(granted.access_token.clone());
        if let Err(error) = self.connect_with(app.clone(), cache, credentials).await {
            self.record_failure(error.clone());
            return Err(error);
        }
        self.adopt_web_token(&app, granted, None, None);
        self.status().await
    }

    // librespot is authorised with an access token that expires within the hour, and nothing
    // else renews it: the web token has its own refresh path, which is why browsing keeps
    // working while playback dies. Rebuild an expired session from the cached credentials.
    pub(super) async fn ensure_session(&self) -> Result<(), String> {
        {
            let slot = self.runtime.lock().await;
            if slot
                .as_ref()
                .is_some_and(|runtime| !runtime.session.is_invalid())
            {
                return Ok(());
            }
        }
        let app = self
            .app
            .read()
            .clone()
            .ok_or_else(|| NOT_INITIALIZED.to_string())?;
        let cache_dir = self.cache_path()?;
        let Some(credentials) = keystore::load(&app, &cache_dir) else {
            self.linked.store(false, Ordering::SeqCst);
            return Err(tokens::CONNECT_FIRST.to_string());
        };
        let cache = session::make_cache(&cache_dir)?;
        if let Err(error) = self.connect_with(app, cache, credentials).await {
            self.record_failure(error.clone());
            return Err(error);
        }
        Ok(())
    }

    async fn connect_with(
        &self,
        app: AppHandle,
        cache: librespot_core::cache::Cache,
        credentials: Credentials,
    ) -> Result<(), String> {
        let cache_dir = self.cache_path()?;
        let spotify_session = session::build(cache, keystore::device_id(&app));
        let mut tier = session::connect(&spotify_session, credentials).await?;
        keystore::capture(&app, &cache_dir);
        if tier == AccountTier::Unknown {
            tier = self.probe_tier(&spotify_session).await;
            if tier == AccountTier::Free {
                spotify_session.shutdown();
                return Err(session::FREE_ACCOUNT.to_string());
            }
        }
        let username = spotify_session.username();
        let country = spotify_session.country();
        let audio = player::start(app, spotify_session.clone())?;
        let mut slot = self.runtime.lock().await;
        if let Some(previous) = slot.take() {
            previous.audio.player.stop();
            previous.session.shutdown();
            std::thread::spawn(move || drop(previous));
        }
        *slot = Some(SpotifyRuntime {
            session: spotify_session.clone(),
            audio,
        });

        *self.account.write() = Account {
            session: Some(spotify_session),
            username,
            country: country.clone(),
            tier,
        };
        *self.last_error.write() = None;
        self.linked.store(true, Ordering::SeqCst);
        self.paused.store(true, Ordering::SeqCst);
        Ok(())
    }

    pub async fn disconnect(&self) -> Result<(), String> {
        #[cfg(feature="music-sidecar")]
        {
            // Explicit disconnect revokes the in-memory external playback session
            // before Harbor forgets its existing credential keys and cached data.
            let _=super::m3u::module_request_async(serde_json::json!({
                "command":"spotify_disconnect"
            })).await;
        }
        let mut slot = self.runtime.lock().await;
        if let Some(runtime) = slot.take() {
            runtime.audio.player.stop();
            runtime.session.shutdown();
            std::thread::spawn(move || drop(runtime));
        }
        drop(slot);
        *self.account.write() = Account::empty();
        *self.web_token.write() = None;

        *self.last_error.write() = None;
        self.linked.store(false, Ordering::SeqCst);
        *self.remote.write() = None;
        devices::stop_watching(self);
        self.paused.store(true, Ordering::SeqCst);
        self.paused_for_video.store(false, Ordering::SeqCst);
        let cache_dir = self.cache_path()?;
        let app = self
            .app
            .read()
            .clone()
            .ok_or_else(|| NOT_INITIALIZED.to_string())?;
        session::clear_audio_cache(&cache_dir);
        keystore::forget(&app, &cache_dir)
    }

    pub async fn status(&self) -> Result<SpotifyStatus, String> {

        Ok(self.snapshot())
    }

    /// The local player's current hold on a track, so a reloaded interface can rejoin it
    /// instead of restoring a checkpoint that has not known about playback since the page went
    /// away. Only local playback is reported; a remote Connect device keeps its own progress.
    pub async fn playback_state(&self) -> SpotifyPlaybackState {
        let paused = self.paused.load(Ordering::SeqCst);
        let slot = self.runtime.lock().await;
        let Some(runtime) = slot.as_ref() else {
            return SpotifyPlaybackState {
                live: false,
                paused: true,
                track: None,
                position_seconds: None,
            };
        };
        let snapshot = player::snapshot(&runtime.audio);
        SpotifyPlaybackState {
            live: snapshot.track.is_some(),
            paused,
            track: snapshot.track,
            position_seconds: snapshot.position_seconds,
        }
    }

    /// Measured on the decoded samples instead of the mpv chain, so the dock visualizer,
    /// signal panel and Miku keep working while Spotify is the active engine.
    pub async fn set_meter_enabled(&self, enabled: bool) {
        let slot = self.runtime.lock().await;
        if let Some(runtime) = slot.as_ref() {
            runtime.audio.meter.set_enabled(enabled);
        }
    }

    #[cfg(feature="music-sidecar")]
    pub async fn meter_snapshot(&self) -> Option<MusicMeterSnapshot> {
        let data=crate::music::m3u::module_request_async(serde_json::json!({
            "command":"spotify_meter_snapshot"
        })).await.ok()?;
        serde_json::from_value(data).ok()
    }

    #[cfg(not(feature="music-sidecar"))]
    pub async fn meter_snapshot(&self) -> Option<MusicMeterSnapshot> {
        let paused = self.paused.load(Ordering::SeqCst);
        let slot = self.runtime.lock().await;
        let runtime = slot.as_ref()?;
        let track = player::snapshot(&runtime.audio).track?;
        let reading = runtime.audio.meter.reading();
        // librespot attenuates the decoded samples inside the player, before the sink the
        // meter wraps, so a reading would track the volume slider instead of the music.
        // The mpv chain measures ahead of mpv's own volume for the same reason, so undo
        // the attenuation and let every source's visualizer ignore the listening level.
        let offset = meter_level_offset_db(runtime.audio.mixer.get_soft_volume().attenuation_factor());
        Some(MusicMeterSnapshot {
            track_id: track.id,
            connector_id: track.connector_id,
            active: runtime.audio.meter.running() && !paused && reading.seen,
            channels: reading
                .channels
                .into_iter()
                .map(|channel| MusicMeterChannel {
                    rms_db: lift_level(channel.rms_db, offset),
                    peak_db: lift_level(channel.peak_db, offset),
                })
                .collect(),
            spectrum_db: reading
                .spectrum
                .into_iter()
                .map(|db| lift_level(db, offset))
                .collect(),
            output_sample_rate_hz: Some(librespot_playback::SAMPLE_RATE),
            output_channels: Some("stereo".to_string()),
            output_device: None,
            output_backend: Some("spotify".to_string()),
        })
    }

    pub(super) fn connection(&self) -> MusicConnection {
        let status = self.snapshot();
        let state = if status.connected {
            "connected"
        } else if status.error.is_some() {
            "error"
        } else {
            "disconnected"
        };
        let capabilities: &[&str] = if status.playback_ready {
            &["search", "browse", "play"]
        } else {
            &["search", "browse"]
        };
        let mut connection = MusicConnection::new(
            "spotify",
            "Spotify",
            "streaming",
            state,
            capabilities,
        );
        connection.account = status.username;
        connection.error = status.error;
        // Spotify only issues tokens to a registered app, and a new app may add at most a
        // handful of listeners. Harbor ships no client id: each listener brings their own.
        if status.connected {
            connection.detail = if status.playback_ready {
                status.account_type
            } else if status.playback_linked {
                Some("Spotify playback pairing is saved, but the local player is unavailable. Pair again if reconnection fails.".to_string())
            } else {
                Some("Spotify browsing is connected. Pair this device to enable local playback.".to_string())
            };
        } else {
            // Device pairing is the primary connection; a developer app is optional.
            connection.detail = Some(
                "Pair Spotify to play music in Harbor. Own-app browsing is optional.".to_string(),
            );
        }
        connection
    }

    /// A librespot socket dies on any network blip, but the stored sign in outlives it and the
    /// web token refreshes on its own, so browsing and status follow the link, not the socket.
    pub(super) fn remote_device(&self) -> Option<String> {
        self.remote.read().clone()
    }

    pub async fn set_remote_device(&self, device: Option<String>) -> Result<(), String> {
        let chosen = device.map(|id| id.trim().to_string()).filter(|id| !id.is_empty());
        let app = self
            .app
            .read()
            .clone()
            .ok_or_else(|| NOT_INITIALIZED.to_string())?;
        keystore::write(&app, keystore::PLAY_TARGET_KEY, chosen.as_deref())?;
        devices::stop_watching(self);
        let previous = self.remote.read().clone();
        *self.remote.write() = chosen.clone();
        // Handing playback somewhere else has to silence where it was, or the old device keeps
        // playing to an empty room while Harbor shows the song running somewhere new.
        if let Some(old) = previous.filter(|old| Some(old) != chosen.as_ref()) {
            let _ = devices::set_paused(self, &old, true).await;
        }
        Ok(())
    }

    pub async fn devices(&self) -> Result<Vec<devices::SpotifyDevice>, String> {
        devices::list(self).await
    }

    /// Token status is local only; this checks refreshability, not remote Spotify availability.
    fn browsing_token_state(&self) -> (bool, bool) {
        let token = self.web_token.read().clone().or_else(|| {
            self.app
                .read()
                .as_ref()
                .and_then(keystore::web_token)
        });
        let Some(token) = token else {
            return (false, false);
        };
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        let usable = token.is_fresh(now) || token.refresh_token.is_some();
        let own_app = usable
            && token.client_id.as_ref().is_some_and(|id| {
                id != &librespot_core::config::SessionConfig::default().client_id
            });
        (usable, own_app)
    }

    pub(super) fn connected(&self) -> bool {
        self.account.read().connected()
            || self.linked.load(Ordering::SeqCst)
            || self.browsing_token_state().0
    }

    fn snapshot(&self) -> SpotifyStatus {
        let account = self.account.read();
        let playback_ready = account.connected();
        let playback_linked = playback_ready || self.linked.load(Ordering::SeqCst);
        let (token_ready, own_app_browsing) = self.browsing_token_state();
        let browsing_ready = token_ready || playback_ready;
        let connected = playback_linked || browsing_ready;
        SpotifyStatus {
            connected,
            playback_ready,
            playback_linked,
            browsing_ready,
            own_app_browsing,
            username: playback_linked.then(|| text(&account.username)).flatten(),

            country: playback_linked.then(|| text(&account.country)).flatten(),
            premium: playback_ready && account.tier.premium(),
            account_type: playback_ready
                .then(|| account.tier.label().map(str::to_string))
                .flatten(),
            // Do not hide a failed session restore behind a stored authorization.
            error: if playback_ready {
                None
            } else {
                self.last_error.read().clone()
            },
        }
    }

    fn cache_path(&self) -> Result<PathBuf, String> {
        self.cache_dir
            .read()
            .clone()
            .ok_or_else(|| NOT_INITIALIZED.to_string())
    }

    fn record_failure(&self, error: String) {
        if error == session::SIGN_IN_AGAIN || error == session::FREE_ACCOUNT {
            self.linked.store(false, Ordering::SeqCst);
        }
        *self.last_error.write() = Some(error);
    }
}

fn http_client() -> reqwest::Client {
    reqwest::Client::builder()
        .user_agent(concat!("Harbor/", env!("CARGO_PKG_VERSION"), " (music)"))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new())
}

fn text(value: &str) -> Option<String> {
    let trimmed = value.trim();
    (!trimmed.is_empty()).then(|| trimmed.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_volume_offset_undoes_attenuation_without_boosting_or_clipping() {
        assert!((meter_level_offset_db(0.5) - 6.02).abs() < 0.01);
        assert!((meter_level_offset_db(0.25) - 12.04).abs() < 0.01);
        assert_eq!(meter_level_offset_db(1.0), 0.0, "a unity slider needs no lift");
        assert_eq!(meter_level_offset_db(1.5), 0.0, "an amplified slider is not trimmed");
        assert_eq!(meter_level_offset_db(0.0), 0.0, "a silent slider stays silent");
        assert_eq!(meter_level_offset_db(f64::NAN), 0.0);
        assert_eq!(meter_level_offset_db(1e-9), MAX_COMPENSATION_DB);
        assert_eq!(lift_level(-80.0, 12.0), -68.0);
        assert_eq!(lift_level(20.0, 12.0), MAX_METER_DB);
    }

    #[test]
    fn a_disconnected_state_never_claims_premium() {
        let state = SpotifyState::new();
        let status = state.snapshot();
        assert!(!status.connected);
        assert!(!status.playback_ready);
        assert!(!status.premium);
        assert!(status.account_type.is_none());
        assert!(!state.connected());
    }

    #[test]
    fn browsing_only_oauth_is_connected_without_claiming_playback() {
        let state = SpotifyState::new();
        *state.web_token.write() = Some(keystore::WebToken {
            access_token: "test-token".into(),
            refresh_token: Some("refresh-token".into()),
            expires_at: u64::MAX,
            scopes: vec![],
            client_id: Some("my-personal-developer-app".into()),
        });
        let status = state.snapshot();
        assert!(status.connected);
        assert!(status.browsing_ready);
        assert!(status.own_app_browsing);
        assert!(!status.playback_linked);
        assert!(!status.playback_ready);
        assert!(!status.premium);
        assert!(state.connected());
        let connection = state.connection();
        assert_eq!(connection.status, "connected");
        assert!(connection.detail.unwrap().contains("browsing is connected"));
    }

    #[test]
    fn saved_sign_in_without_a_live_session_is_not_reported_as_playback_ready() {
        let state = SpotifyState::new();
        state.linked.store(true, Ordering::SeqCst);
        state.record_failure("Spotify session reconnect failed: network timeout".to_string());
        let status = state.snapshot();
        assert!(status.connected, "stored authorization is still present");
        assert!(!status.playback_ready, "a saved token cannot play audio by itself");
        assert!(!status.premium, "Premium cannot be inferred from a stale login");
        assert_eq!(
            status.error.as_deref(),
            Some("Spotify session reconnect failed: network timeout")
        );
        let connection = state.connection();
        assert_eq!(connection.status, "connected");
        assert_eq!(connection.error, status.error);
        assert!(connection.detail.unwrap().contains("playback is not ready"));
    }

    #[test]
    fn a_recorded_failure_becomes_the_connection_error() {
        let state = SpotifyState::new();
        state.record_failure(session::FREE_ACCOUNT.to_string());
        let connection = state.connection();
        assert_eq!(connection.id, "spotify");
        assert_eq!(connection.status, "error");
        assert_eq!(connection.capabilities, vec!["search", "browse", "play"]);
        assert_eq!(connection.error.as_deref(), Some(session::FREE_ACCOUNT));
        assert!(connection.account.is_none());
        assert_eq!(connection.detail.as_deref(), Some(auth::BRING_YOUR_OWN));
    }

    #[test]
    fn a_disconnected_spotify_asks_for_a_client_id_of_your_own() {
        let connection = SpotifyState::new().connection();
        let field = connection
            .needs
            .iter()
            .find(|field| field.key == "clientId")
            .expect("disconnected Spotify offers a client id field");
        assert!(!field.required, "connecting without one is a valid attempt");
        assert!(auth::setup_hint().contains("127.0.0.1:8898/login"));
    }

    #[test]
    fn a_recorded_failure_leaves_a_stored_sign_in_alone() {
        let directory = std::env::temp_dir().join(format!(
            "harbor-spotify-cache-policy-{}",
            std::process::id()
        ));
        std::fs::create_dir_all(&directory).expect("create test cache");
        let marker = directory.join("credentials.json");
        std::fs::write(&marker, b"cached").expect("write cached sign in");
        let state = SpotifyState::new();
        *state.cache_dir.write() = Some(directory.clone());
        state.record_failure("network unavailable".to_string());
        assert!(marker.exists());
        assert_eq!(
            state.last_error.read().as_deref(),
            Some("network unavailable")
        );
        std::fs::remove_file(marker).expect("remove test sign in");
        std::fs::remove_dir(directory).expect("remove test cache");
    }

    #[test]
    fn blank_account_text_is_reported_as_absent() {
        assert_eq!(text("  "), None);
        assert_eq!(text(" josiah "), Some("josiah".to_string()));
    }
}
