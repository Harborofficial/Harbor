use std::collections::{BTreeMap, HashSet};
use std::sync::Mutex;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::tray::TrayIcon;
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder, WindowEvent,
};

#[path = "tray_popup_geometry.rs"]
mod geometry;

pub const LABEL: &str = "harbor-tray-menu";
const EVENT: &str = "harbor://tray-menu-state";
const READY_TIMEOUT: Duration = Duration::from_secs(10);
const CLOSE_TIMEOUT: Duration = Duration::from_millis(250);
/// How long a freshly presented menu ignores a focus loss.
const TOKEN_KEYS: [&str; 13] = [
    "--color-canvas",
    "--color-surface",
    "--color-elevated",
    "--color-raised",
    "--color-ink",
    "--color-ink-muted",
    "--color-ink-subtle",
    "--color-edge",
    "--color-edge-soft",
    "--color-accent",
    "--color-accent-soft",
    "--color-danger",
    "--tray-row-hover",
];

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThemeEntry {
    id: String,
    name: String,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Labels {
    show: String,
    theme: String,
    always_on_top: String,
    pause_minimized: String,
    pause_unfocused: String,
    close_to_tray: String,
    quit: String,
    error: String,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
enum Direction {
    Ltr,
    Rtl,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
enum ColorScheme {
    Light,
    Dark,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrayDisplay {
    theme_id: String,
    themes: Vec<ThemeEntry>,
    tokens: BTreeMap<String, String>,
    labels: Labels,
    direction: Direction,
    color_scheme: ColorScheme,
    menu_width: f64,
    theme_width: f64,
}

impl TrayDisplay {
    fn validate(&self) -> Result<(), String> {
        if !self.menu_width.is_finite()
            || !self.theme_width.is_finite()
            || !(160.0..=600.0).contains(&self.menu_width)
            || !(160.0..=600.0).contains(&self.theme_width)
            || self.themes.is_empty()
            || self.themes.len() > 1024
            || self.tokens.len() != TOKEN_KEYS.len()
        {
            return Err("invalid tray display dimensions or catalog".into());
        }
        let mut ids = HashSet::new();
        for theme in &self.themes {
            if theme.id.is_empty()
                || theme.id.len() > 256
                || theme.name.trim().is_empty()
                || theme.name.len() > 512
                || !ids.insert(theme.id.as_str())
            {
                return Err("invalid tray theme catalog".into());
            }
        }
        if !ids.contains(self.theme_id.as_str()) {
            return Err("current tray theme is absent from catalog".into());
        }
        if self.tokens.iter().any(|(key, value)| {
            !TOKEN_KEYS.contains(&key.as_str()) || value.is_empty() || value.len() > 2048
        }) {
            return Err("invalid tray theme tokens".into());
        }
        if [
            &self.labels.show,
            &self.labels.theme,
            &self.labels.always_on_top,
            &self.labels.pause_minimized,
            &self.labels.pause_unfocused,
            &self.labels.close_to_tray,
            &self.labels.quit,
            &self.labels.error,
        ]
        .iter()
        .any(|label| label.trim().is_empty() || label.len() > 512)
        {
            return Err("invalid tray labels".into());
        }
        Ok(())
    }

    fn has_theme(&self, id: &str) -> bool {
        self.themes.iter().any(|theme| theme.id == id)
    }
}

/// The branded menu is what a right click opens, so the popup holds Harbor's own
/// palette until the frontend publishes the active theme. Without it the tray
/// would fall back to the native menu for as long as the app takes to load.
fn default_display() -> TrayDisplay {
    let mut tokens = BTreeMap::new();
    for (key, value) in [
        ("--color-canvas", "oklch(0.18 0.004 260)"),
        ("--color-surface", "oklch(0.22 0.004 260)"),
        ("--color-elevated", "oklch(0.27 0.004 260)"),
        ("--color-raised", "oklch(0.32 0.004 260)"),
        ("--color-ink", "oklch(0.97 0.003 260)"),
        ("--color-ink-muted", "oklch(0.72 0.003 260)"),
        ("--color-ink-subtle", "oklch(0.50 0.003 260)"),
        ("--color-edge", "oklch(0.36 0.004 260 / 0.55)"),
        ("--color-edge-soft", "oklch(0.36 0.004 260 / 0.25)"),
        ("--color-accent", "oklch(0.78 0.13 60)"),
        ("--color-accent-soft", "oklch(0.78 0.13 60 / 0.18)"),
        ("--color-danger", "oklch(0.55 0.18 25)"),
        ("--tray-row-hover", "oklch(0.27 0.004 260)"),
    ] {
        tokens.insert(key.to_string(), value.to_string());
    }
    TrayDisplay {
        theme_id: "cool-grey".to_string(),
        themes: vec![ThemeEntry {
            id: "cool-grey".to_string(),
            name: "Harbor default".to_string(),
        }],
        tokens,
        labels: Labels {
            show: "Show Harbor".to_string(),
            theme: "Theme".to_string(),
            always_on_top: "Always on Top".to_string(),
            pause_minimized: "Pause When Minimized".to_string(),
            pause_unfocused: "Pause When Unfocused".to_string(),
            close_to_tray: "Close to Tray".to_string(),
            quit: "Quit Harbor".to_string(),
            error: "Could not apply this change. Try again.".to_string(),
        },
        direction: Direction::Ltr,
        color_scheme: ColorScheme::Dark,
        menu_width: 260.0,
        theme_width: 240.0,
    }
}

#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Layout {
    width: f64,
    height: f64,
    main_x: f64,
    main_y: f64,
    main_width: f64,
    main_height: f64,
    theme_x: f64,
    theme_y: f64,
    theme_width: f64,
    theme_height: f64,
    submenu_side: &'static str,
}

impl From<geometry::Geometry> for Layout {
    fn from(g: geometry::Geometry) -> Self {
        Self {
            width: g.width,
            height: g.height,
            main_x: g.main.x,
            main_y: g.main.y,
            main_width: g.main.width,
            main_height: g.main.height,
            theme_x: g.theme.x,
            theme_y: g.theme.y,
            theme_width: g.theme.width,
            theme_height: g.theme.height,
            submenu_side: if g.submenu_left { "left" } else { "right" },
        }
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    revision: u64,
    open_id: u64,
    open: bool,
    closing: bool,
    prefs: crate::tray::TrayPrefs,
    display: Option<TrayDisplay>,
    layout: Layout,
}

#[derive(Default)]
struct Popup {
    enabled: bool,
    creating: bool,
    revision: u64,
    open_id: u64,
    open: bool,
    presented: bool,
    display: Option<TrayDisplay>,
    geometry: Option<geometry::Geometry>,
    watchdog: Option<tauri::async_runtime::JoinHandle<()>>,
}

impl Popup {
    fn can_present(&self, id: u64) -> bool {
        self.open && self.open_id == id && !self.presented && self.display.is_some()
    }

    fn closing(&self) -> bool {
        !self.open && self.presented
    }

    fn begin_dismiss(&mut self) -> bool {
        if !self.open {
            return false;
        }
        self.cancel_watchdog();
        self.open = false;
        self.revision = self.revision.wrapping_add(1);
        true
    }

    fn complete_dismiss(&mut self, id: u64) -> bool {
        if !self.closing() || self.open_id != id {
            return false;
        }
        self.cancel_watchdog();
        self.presented = false;
        self.revision = self.revision.wrapping_add(1);
        true
    }

    fn cancel_watchdog(&mut self) {
        if let Some(watchdog) = self.watchdog.take() {
            watchdog.abort();
        }
    }

    fn snapshot(&self) -> Snapshot {
        Snapshot {
            revision: self.revision,
            open_id: self.open_id,
            open: self.open,
            closing: self.closing(),
            prefs: crate::tray::current_prefs(),
            display: self.display.clone(),
            layout: self.geometry.map(Layout::from).unwrap_or_else(|| Layout {
                submenu_side: "right",
                ..Layout::default()
            }),
        }
    }
}

#[derive(Default)]
struct PopupState(Mutex<Popup>);

fn with_state<T>(app: &AppHandle, f: impl FnOnce(&mut Popup) -> T) -> Result<T, String> {
    let state = app
        .try_state::<PopupState>()
        .ok_or("tray menu unavailable")?;
    let mut state = state.0.lock().map_err(|_| "tray menu state unavailable")?;
    Ok(f(&mut state))
}

fn emit_state(app: &AppHandle) -> Result<Snapshot, String> {
    let snapshot = with_state(app, |state| state.snapshot())?;
    app.emit_to(LABEL, EVENT, &snapshot)
        .map_err(|error| error.to_string())?;
    Ok(snapshot)
}

fn check_caller_label(label: &str, expected: &str) -> Result<(), String> {
    if label != expected {
        return Err("tray command unavailable to this window".into());
    }
    Ok(())
}

fn check_caller(window: &WebviewWindow, expected: &str) -> Result<(), String> {
    check_caller_label(window.label(), expected)
}

pub fn app_command_allowed(window: &str, webview: &str, command: &str) -> bool {
    (window != LABEL && webview != LABEL)
        || matches!(
            command,
            "tray_popup_snapshot"
                | "tray_popup_present"
                | "tray_popup_dismiss"
                | "tray_popup_submenu"
                | "tray_popup_action"
        )
}

pub fn initialize(app: &AppHandle, tray: &TrayIcon) -> Result<(), String> {
    app.manage(PopupState::default());
    // Keep the native menu attached for immediate fallback, but avoid showing both menus.
    tray.with_inner_tray_icon(|inner| inner.set_show_menu_on_right_click(false))
        .map_err(|error| error.to_string())?;
    with_state(app, |state| {
        state.enabled = true;
        state.display = Some(default_display());
    })?;
    ensure_window(app.clone());
    Ok(())
}

fn ensure_window(app: AppHandle) {
    let create = with_state(&app, |state| {
        if !state.enabled || state.creating || app.get_webview_window(LABEL).is_some() {
            return false;
        }
        state.creating = true;
        true
    });
    if !matches!(create, Ok(true)) {
        return;
    }
    // WebView2 creation must not run in a synchronous tray/event callback.
    std::thread::spawn(move || {
        let result = (|| -> Result<WebviewWindow, String> {
            let tray = app
                .tray_by_id("harbor-tray")
                .ok_or("tray owner unavailable")?;
            let owner = tray
                .with_inner_tray_icon(|inner| inner.window_handle() as isize)
                .map_err(|error| error.to_string())?;
            if owner == 0 {
                return Err("tray owner unavailable".into());
            }
            // The persistent hidden tray window keeps this popup out of Alt+Tab
            // without inheriting the main window's minimize/hide behavior.
            let builder =
                WebviewWindowBuilder::new(&app, LABEL, WebviewUrl::App("tray.html".into()))
                    .owner_raw(windows::Win32::Foundation::HWND(owner as *mut _))
                    .title("Harbor")
                    .inner_size(520.0, 450.0)
                    .visible(false)
                    .focused(false)
                    .decorations(false)
                    .transparent(true)
                    .shadow(false)
                    .resizable(false)
                    .maximizable(false)
                    .minimizable(false)
                    .skip_taskbar(true)
                    .always_on_top(true);
            let window = crate::browser_args::match_main(&app, builder)
                .build()
                .map_err(|error| error.to_string())?;
            if let Err(error) = disable_native_transitions(&window) {
                // A cosmetic DWM failure must not take away the working menu.
                eprintln!("[harbor::tray] disable native transitions: {error}");
            }
            // The window must not keep the decorations it was created with: the
            // native layer paints a caption over the menu while it is shown.
            let _ = window.set_decorations(false);
            // The client area covers the whole window, so activating the menu
            // never paints a caption over it.
            crate::install_tray_subclass(&window);
            // Without a transparent webview the menu flashes white the first
            // time it is shown, before the page has painted.
            crate::make_webview_transparent(&window);
            Ok(window)
        })();
        match result {
            Ok(window) => {
                if let Err(error) = with_state(&app, |state| state.creating = false) {
                    eprintln!("[harbor::tray] window state: {error}");
                }
                if !with_state(&app, |state| state.enabled).unwrap_or(false)
                    || app.get_webview_window("main").is_none()
                {
                    if let Err(error) = window.destroy() {
                        eprintln!("[harbor::tray] late window cleanup: {error}");
                    }
                    return;
                }
                let handle = app.clone();
                let popup = window.clone();
                // A request that arrived while the window was still being created
                // never reached the frontend, so the state is sent again here.
                window.on_window_event(move |event| match event {
                    WindowEvent::Focused(false) => {
                        let over = pointer_over_popup(&popup);
                        let shell = shell_owns_foreground();
                        let presented =
                            with_state(&handle, |state| state.presented).unwrap_or(false);
                        if presented {
                            if !focus_loss_closes_menu(over, shell) {
                                // The user is on the menu, so it keeps the foreground.
                                // The shell only takes it back when the menu is idle,
                                // and the mouse watcher closes the menu then.
                                if over && !overflow_flyout_open() {
                                    crate::force_show_foreground(&popup);
                                }
                                return;
                            }
                            if let Err(error) = dismiss(&handle) {
                                eprintln!("[harbor::tray] dismiss: {error}");
                            }
                        }
                    }
                    WindowEvent::CloseRequested { api, .. } => {
                        api.prevent_close();
                        if let Err(error) = dismiss(&handle) {
                            eprintln!("[harbor::tray] dismiss: {error}");
                        }
                    }
                    _ => {}
                });
            }
            Err(error) => {
                let requested = with_state(&app, |state| {
                    state.creating = false;
                    if state.open {
                        Some(state.open_id)
                    } else {
                        None
                    }
                });
                if let Ok(Some(id)) = requested {
                    fallback(&app, id, &format!("create menu: {error}"));
                } else {
                    eprintln!("[harbor::tray] create menu: {error}");
                }
            }
        }
    });
}

fn place(
    app: &AppHandle,
    anchor: tauri::Rect,
    display: &TrayDisplay,
) -> Result<geometry::Geometry, String> {
    let position = anchor.position.to_physical::<f64>(1.0);
    let size = anchor.size.to_physical::<f64>(1.0);
    let monitor = app
        .monitor_from_point(
            position.x + size.width / 2.0,
            position.y + size.height / 2.0,
        )
        .map_err(|error| error.to_string())?
        .ok_or("tray monitor unavailable")?;
    let work = monitor.work_area();
    geometry::calculate(
        geometry::Rect {
            x: work.position.x as f64,
            y: work.position.y as f64,
            width: work.size.width as f64,
            height: work.size.height as f64,
        },
        geometry::Rect {
            x: position.x,
            y: position.y,
            width: size.width,
            height: size.height,
        },
        monitor.scale_factor(),
        display.menu_width,
        display.theme_width,
        display.themes.len(),
        matches!(display.direction, Direction::Rtl),
    )
    .map_err(str::to_string)
}

pub fn request_open(app: &AppHandle, anchor: tauri::Rect) {
    let prepared = (|| -> Result<Option<u64>, String> {
        let request = with_state(app, |state| {
            if state.enabled {
                state.cancel_watchdog();
                state.open_id = state.open_id.wrapping_add(1);
                state.revision = state.revision.wrapping_add(1);
                state.open = true;
                state.presented = false;
                Ok((state.open_id, state.display.clone()))
            } else {
                Err("native menu active")
            }
        })?;
        let (id, display) = match request {
            Err(_) => return Ok(None),
            Ok((id, display)) => (id, display.ok_or("tray theme not ready")?),
        };
        let geometry = place(app, anchor, &display)?;
        with_state(app, |state| {
            state.geometry = Some(geometry);
        })?;
        if let Some(window) = app.get_webview_window(LABEL) {
            window.hide().map_err(|error| error.to_string())?;
        }
        ensure_window(app.clone());
        emit_state(app)?;
        watch_outside_click(app.clone(), id);
        Ok(Some(id))
    })();
    match prepared {
        Ok(Some(id)) => {
            let handle = app.clone();
            // The popup webview can miss the request while it is still starting,
            // so the state is sent again until the menu is presented.
            let retry = app.clone();
            tauri::async_runtime::spawn(async move {
                for delay in [
                    Duration::from_millis(120),
                    Duration::from_millis(300),
                    Duration::from_millis(600),
                    Duration::from_millis(1200),
                    Duration::from_millis(2000),
                    Duration::from_millis(3000),
                ] {
                    tokio::time::sleep(delay).await;
                    let pending = with_state(&retry, |state| {
                        state.open && state.open_id == id && !state.presented
                    })
                    .unwrap_or(false);
                    if !pending {
                        return;
                    }
                    // The revision moves so the frontend accepts the newer state.
                    if with_state(&retry, |state| {
                        state.revision = state.revision.wrapping_add(1);
                    })
                    .is_err()
                    {
                        return;
                    }
                    if emit_state(&retry).is_err() {
                        return;
                    }
                }
            });
            let watchdog = tauri::async_runtime::spawn(async move {
                tokio::time::sleep(READY_TIMEOUT).await;
                let fallback_handle = handle.clone();
                if let Err(error) = handle.run_on_main_thread(move || {
                    if matches!(
                        with_state(&fallback_handle, |state| state.open
                            && state.open_id == id
                            && !state.presented),
                        Ok(true)
                    ) {
                        fallback(&fallback_handle, id, "menu render timeout");
                    }
                }) {
                    eprintln!("[harbor::tray] schedule fallback: {error}");
                }
            });
            if let Err(error) = with_state(app, |state| {
                if state.open && state.open_id == id && !state.presented {
                    state.watchdog = Some(watchdog);
                } else {
                    watchdog.abort();
                }
            }) {
                eprintln!("[harbor::tray] watchdog: {error}");
            }
        }
        Ok(None) => {}
        Err(error) => {
            let id = with_state(app, |state| state.open_id).unwrap_or_default();
            fallback(app, id, &error);
        }
    }
}

fn fallback(app: &AppHandle, id: u64, error: &str) {
    let current = with_state(app, |state| state.open && state.open_id == id).unwrap_or(false);
    if !current {
        return;
    }
    eprintln!("[harbor::tray] {error}; using native menu");
    if let Err(error) = dismiss_immediately(app) {
        eprintln!("[harbor::tray] fallback dismiss: {error}");
    }
    if let Some(tray) = app.tray_by_id("harbor-tray") {
        if let Err(error) = tray.with_inner_tray_icon(|inner| inner.show_menu()) {
            eprintln!("[harbor::tray] native fallback: {error}");
        }
    }
}

fn dismiss(app: &AppHandle) -> Result<Snapshot, String> {
    let (started, snapshot) = with_state(app, |state| {
        let started = state.begin_dismiss();
        (started, state.snapshot())
    })?;
    if !started {
        return Ok(snapshot);
    }
    if snapshot.closing {
        let handle = app.clone();
        let id = snapshot.open_id;
        // The frontend owns the 120ms fade; this bounds visibility if it stops responding.
        let watchdog = tauri::async_runtime::spawn(async move {
            tokio::time::sleep(CLOSE_TIMEOUT).await;
            let close_handle = handle.clone();
            if let Err(error) = handle.run_on_main_thread(move || {
                if let Err(error) = complete_dismiss(&close_handle, id) {
                    eprintln!("[harbor::tray] finish close: {error}");
                }
            }) {
                eprintln!("[harbor::tray] schedule close: {error}");
            }
        });
        with_state(app, |state| {
            if state.closing() && state.open_id == id {
                state.watchdog = Some(watchdog);
            } else {
                watchdog.abort();
            }
        })?;
    } else {
        hide_window(app)?;
    }
    emit_state(app)
}

fn complete_dismiss(app: &AppHandle, id: u64) -> Result<Snapshot, String> {
    if with_state(app, |state| state.complete_dismiss(id))? {
        hide_window(app)?;
        #[cfg(windows)]
        {
            // The menu took the foreground when it was clicked, so it hands it
            // back to the flyout it came from.
            use windows::Win32::UI::WindowsAndMessaging::GetForegroundWindow;
            let ours = app
                .get_webview_window(LABEL)
                .and_then(|window| window.hwnd().ok())
                .map(|hwnd| unsafe { GetForegroundWindow() } == hwnd)
                .unwrap_or(false);
            if ours {
                restore_flyout_foreground();
            }
        }
        emit_state(app)
    } else {
        with_state(app, |state| state.snapshot())
    }
}

fn dismiss_immediately(app: &AppHandle) -> Result<Snapshot, String> {
    with_state(app, |state| {
        state.cancel_watchdog();
        state.open = false;
        state.presented = false;
        state.revision = state.revision.wrapping_add(1);
    })?;
    hide_window(app)?;
    emit_state(app)
}

fn hide_window(app: &AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(LABEL) {
        window.hide().map_err(|error| error.to_string())?;
    }
    Ok(())
}

pub fn prefs_changed(app: &AppHandle) -> Result<(), String> {
    if app.try_state::<PopupState>().is_none() {
        return Ok(());
    }
    with_state(app, |state| state.revision = state.revision.wrapping_add(1))?;
    emit_state(app).map(|_| ())
}

pub fn destroy(app: &AppHandle) -> Result<(), String> {
    if app.try_state::<PopupState>().is_none() {
        return Ok(());
    }
    with_state(app, |state| {
        state.cancel_watchdog();
        state.enabled = false;
        state.open = false;
        state.presented = false;
    })?;
    if let Some(window) = app.get_webview_window(LABEL) {
        window.destroy().map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn set_region(window: &WebviewWindow, g: geometry::Geometry, submenu: bool) -> Result<(), String> {
    use windows::Win32::Graphics::Gdi::{
        CombineRgn, CreateRectRgn, DeleteObject, SetWindowRgn, RGN_ERROR, RGN_OR,
    };
    let hwnd = window.hwnd().map_err(|error| error.to_string())?;
    let create = |r: geometry::Rect| unsafe {
        CreateRectRgn(
            (r.x * g.scale).floor() as i32,
            (r.y * g.scale).floor() as i32,
            ((r.x + r.width) * g.scale).ceil() as i32,
            ((r.y + r.height) * g.scale).ceil() as i32,
        )
    };
    let region = create(g.main);
    if region.is_invalid() {
        return Err("create tray window region failed".into());
    }
    let result = (|| {
        if submenu {
            let bridge_left = if g.submenu_left {
                g.theme.x + g.theme.width
            } else {
                g.main.x + g.main.width
            };
            let bridge_y = (g.main.y + geometry::THEME_ROW_TOP).clamp(
                g.main.y.max(g.theme.y),
                (g.main.y + g.main.height).min(g.theme.y + g.theme.height) - 32.0,
            );
            for rect in [
                g.theme,
                geometry::Rect {
                    x: bridge_left,
                    y: bridge_y,
                    width: 6.0,
                    height: 32.0,
                },
            ] {
                let part = create(rect);
                if part.is_invalid() {
                    return Err("create tray submenu region failed".into());
                }
                let combined =
                    unsafe { CombineRgn(Some(region), Some(region), Some(part), RGN_OR) };
                unsafe {
                    let _ = DeleteObject(part.into());
                }
                if combined == RGN_ERROR {
                    return Err("combine tray submenu region failed".into());
                }
            }
        }
        if unsafe { SetWindowRgn(hwnd, Some(region), true) } == 0 {
            return Err("set tray window region failed".into());
        }
        Ok(())
    })();
    // On success Windows owns the region; failures leave ownership with us.
    if result.is_err() {
        unsafe {
            let _ = DeleteObject(region.into());
        }
    }
    result
}

/// Test the clipped window region, not the bounding rectangle: space reserved
/// for the theme submenu can extend below the visible main menu.
fn pointer_over_popup(window: &WebviewWindow) -> bool {
    use windows::Win32::Foundation::{POINT, RECT};
    use windows::Win32::UI::WindowsAndMessaging::{GetCursorPos, GetWindowRect};
    let Ok(hwnd) = window.hwnd() else {
        return false;
    };
    let mut cursor = POINT::default();
    if unsafe { GetCursorPos(&mut cursor) }.is_err() {
        return false;
    }
    let mut rect = RECT::default();
    if unsafe { GetWindowRect(hwnd, &mut rect) }.is_err() {
        return false;
    }
    popup_region_contains(hwnd, cursor.x - rect.left, cursor.y - rect.top)
}

fn popup_region_contains(hwnd: windows::Win32::Foundation::HWND, x: i32, y: i32) -> bool {
    use windows::Win32::Graphics::Gdi::{
        CreateRectRgn, DeleteObject, GetWindowRgn, PtInRegion, RGN_ERROR,
    };
    unsafe {
        let region = CreateRectRgn(0, 0, 0, 0);
        if region.is_invalid() {
            return false;
        }
        let inside = GetWindowRgn(hwnd, region) != RGN_ERROR && PtInRegion(region, x, y).as_bool();
        let _ = DeleteObject(region.into());
        inside
    }
}

/// Which window owns the foreground, so the tray can tell the shell taking it
/// back from the user leaving the menu.
fn foreground_class() -> String {
    use windows::Win32::UI::WindowsAndMessaging::{GetClassNameW, GetForegroundWindow};
    let hwnd = unsafe { GetForegroundWindow() };
    if hwnd.0.is_null() {
        return "none".to_string();
    }
    let mut buffer = [0u16; 256];
    let length = unsafe { GetClassNameW(hwnd, &mut buffer) };
    if length <= 0 {
        return "unknown".to_string();
    }
    String::from_utf16_lossy(&buffer[..length as usize])
}

/// Hands the foreground back to the notification area flyout when the menu
/// closes. The flyout only survives the pointer leaving it while it still
/// owns the foreground, so the menu gives it back instead of letting another
/// window keep it.
fn restore_flyout_foreground() {
    use windows::core::PCWSTR;
    use windows::Win32::UI::WindowsAndMessaging::{
        FindWindowW, IsWindowVisible, SetForegroundWindow,
    };
    let class: Vec<u16> = "TopLevelWindowForOverflowXamlIsland"
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect();
    let Ok(hwnd) = (unsafe { FindWindowW(PCWSTR(class.as_ptr()), None) }) else {
        return;
    };
    if unsafe { IsWindowVisible(hwnd) }.as_bool() {
        unsafe {
            let _ = SetForegroundWindow(hwnd);
        }
    }
}

/// Whether the Windows notification area flyout is open. The flyout is a shell
/// window that does not always hold the foreground, so its presence is checked
/// directly: activating the popup while the flyout is open closes it.
fn overflow_flyout_open() -> bool {
    use windows::Win32::Foundation::LPARAM;
    use windows::Win32::UI::WindowsAndMessaging::{EnumWindows, GetClassNameW, IsWindowVisible};
    static OPEN: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
    unsafe extern "system" fn visit(
        hwnd: windows::Win32::Foundation::HWND,
        _lparam: LPARAM,
    ) -> windows::core::BOOL {
        let mut class = [0u16; 128];
        let length = GetClassNameW(hwnd, &mut class);
        if length > 0 {
            let name = String::from_utf16_lossy(&class[..length as usize]);
            if name.contains("Overflow") && IsWindowVisible(hwnd).as_bool() {
                OPEN.store(true, std::sync::atomic::Ordering::Relaxed);
                return windows::core::BOOL(0);
            }
        }
        windows::core::BOOL(1)
    }
    OPEN.store(false, std::sync::atomic::Ordering::Relaxed);
    unsafe {
        let _ = EnumWindows(Some(visit), LPARAM(0));
    }
    OPEN.load(std::sync::atomic::Ordering::Relaxed)
}

/// Whether the shell owns the foreground. The taskbar inherits it when the
/// notification area flyout closes, and that flyout takes it back while it
/// animates away. Neither is the user leaving the menu.
fn shell_owns_foreground() -> bool {
    let class = foreground_class();
    class == "Shell_TrayWnd" || class.contains("Overflow")
}

/// Whether a focus loss means the user left the menu.
///
/// The shell owns the foreground while its notification area flyout is open and
/// inherits it when that flyout closes, which happens a few seconds after the
/// menu opens. That is not the user walking away, so the menu stays open and
/// claims the foreground again.
fn focus_loss_closes_menu(pointer_over_menu: bool, shell_foreground: bool) -> bool {
    !(pointer_over_menu || shell_foreground)
}

/// Whether a mouse button was pressed since the last check or is held down. The
/// low bit of the key state catches a click that was over before this poll.
fn mouse_button_pressed() -> bool {
    use windows::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_LBUTTON, VK_RBUTTON};
    unsafe {
        let left = GetAsyncKeyState(VK_LBUTTON.0 as i32);
        let right = GetAsyncKeyState(VK_RBUTTON.0 as i32);
        (left | right) & (0x8001u16 as i16) != 0
    }
}

/// Native menus close when the user clicks outside them. The popup never sees
/// that click, so it watches the mouse while it is open.
fn watch_outside_click(app: AppHandle, open_id: u64) {
    tauri::async_runtime::spawn(async move {
        // The button that opened the menu may still be held down.
        let mut held = mouse_button_pressed();
        loop {
            tokio::time::sleep(Duration::from_millis(40)).await;
            let status = with_state(&app, |state| {
                (state.open && state.open_id == open_id, state.presented)
            })
            .unwrap_or((false, false));
            if !status.0 {
                return;
            }
            let down = mouse_button_pressed();
            let pressed = down && !held;
            held = down;
            if !status.1 || !pressed {
                continue;
            }
            let Some(window) = app.get_webview_window(LABEL) else {
                return;
            };
            if pointer_over_popup(&window) {
                continue;
            }
            let _ = dismiss(&app);
            return;
        }
    });
}

fn disable_native_transitions(window: &WebviewWindow) -> Result<(), String> {
    use windows::core::BOOL;
    use windows::Win32::Graphics::Dwm::{DwmSetWindowAttribute, DWMWA_TRANSITIONS_FORCEDISABLED};
    let hwnd = window.hwnd().map_err(|error| error.to_string())?;
    let disabled = BOOL::from(true);
    // Keep Windows' scale/fade transition from competing with the menu's opacity fade.
    unsafe {
        DwmSetWindowAttribute(
            hwnd,
            DWMWA_TRANSITIONS_FORCEDISABLED,
            (&disabled as *const BOOL).cast(),
            std::mem::size_of::<BOOL>() as u32,
        )
    }
    .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn tray_popup_publish(
    window: WebviewWindow,
    app: AppHandle,
    display: TrayDisplay,
) -> Result<Snapshot, String> {
    check_caller(&window, "main")?;
    display.validate()?;
    with_state(&app, |state| {
        state.display = Some(display);
        state.revision = state.revision.wrapping_add(1);
    })?;
    emit_state(&app)
}

#[tauri::command]
pub fn tray_popup_snapshot(window: WebviewWindow, app: AppHandle) -> Result<Snapshot, String> {
    check_caller(&window, LABEL)?;
    with_state(&app, |state| state.snapshot())
}

#[tauri::command]
pub fn tray_popup_present(
    window: WebviewWindow,
    app: AppHandle,
    open_id: u64,
) -> Result<Snapshot, String> {
    check_caller(&window, LABEL)?;
    let geometry = with_state(&app, |state| {
        if state.can_present(open_id) {
            state.geometry
        } else {
            None
        }
    })?;
    let Some(geometry) = geometry else {
        return with_state(&app, |state| state.snapshot());
    };
    let present = (|| -> Result<(), String> {
        // The caption has to go before the geometry is applied, so the client
        // area still matches the clip region the menu is drawn into.
        window
            .set_position(PhysicalPosition::new(geometry.x, geometry.y))
            .map_err(|error| error.to_string())?;
        window
            .set_size(PhysicalSize::new(
                (geometry.width * geometry.scale).ceil() as u32,
                (geometry.height * geometry.scale).ceil() as u32,
            ))
            .map_err(|error| error.to_string())?;
        set_region(&window, geometry, false)?;
        // While the shell's flyout is open the menu must not activate, or the
        // flyout closes with it. Showing the window activates it, so the
        // activation is taken away again right after.
        let flyout = overflow_flyout_open();
        crate::set_no_activate(&window, flyout);
        let current = with_state(&app, |state| {
            if !state.open || state.open_id != open_id {
                return false;
            }
            state.presented = true;
            state.cancel_watchdog();
            true
        })?;
        if !current {
            return Ok(());
        }
        window.show().map_err(|error| error.to_string())?;
        // Showing the window re-applies the native style, so the activation is
        // taken away again.
        crate::set_no_activate(&window, flyout);
        if !flyout {
            // The tray icon cannot own the foreground, so the popup has to
            // claim it the way the main window does.
            crate::force_show_foreground(&window);
            let _ = window.set_focus();
        }
        Ok(())
    })();
    if let Err(error) = present {
        fallback(&app, open_id, &error);
        return Err(error);
    }
    with_state(&app, |state| state.snapshot())
}

#[tauri::command]
pub fn tray_popup_dismiss(
    window: WebviewWindow,
    app: AppHandle,
    completed_open_id: Option<u64>,
) -> Result<Snapshot, String> {
    check_caller(&window, LABEL)?;
    match completed_open_id {
        Some(id) => complete_dismiss(&app, id),
        None => dismiss(&app),
    }
}

#[tauri::command]
pub fn tray_popup_submenu(
    window: WebviewWindow,
    app: AppHandle,
    open: bool,
) -> Result<Snapshot, String> {
    check_caller(&window, LABEL)?;
    let geometry = with_state(&app, |state| if state.open { state.geometry } else { None })?;
    if let Some(geometry) = geometry {
        set_region(&window, geometry, open)?;
    }
    with_state(&app, |state| state.snapshot())
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", deny_unknown_fields)]
pub enum Action {
    Show,
    AlwaysOnTop,
    PauseMinimized,
    PauseUnfocused,
    CloseToTray,
    Quit,
    Theme { value: String },
}

#[tauri::command]
pub fn tray_popup_action(
    window: WebviewWindow,
    app: AppHandle,
    action: Action,
) -> Result<Snapshot, String> {
    check_caller(&window, LABEL)?;
    let id = match action {
        Action::Show => "tray_show".into(),
        Action::AlwaysOnTop => "tray_aot".into(),
        Action::PauseMinimized => "tray_pmin".into(),
        Action::PauseUnfocused => "tray_punf".into(),
        Action::CloseToTray => "tray_ctt".into(),
        Action::Quit => "tray_quit".into(),
        Action::Theme { value } => {
            let valid = with_state(&app, |state| {
                state
                    .display
                    .as_ref()
                    .is_some_and(|display| display.has_theme(&value))
            })?;
            if !valid {
                return Err("unknown tray theme".into());
            }
            format!("tray_theme_{value}")
        }
    };
    let dismiss_first = id == "tray_show" || id == "tray_quit";
    if dismiss_first {
        dismiss(&app)?;
    }
    crate::tray::dispatch(&app, &id)?;
    if dismiss_first {
        with_state(&app, |state| state.snapshot())
    } else {
        dismiss(&app)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn display() -> TrayDisplay {
        let labels = Labels {
            show: "Show".into(),
            theme: "Theme".into(),
            always_on_top: "Always on Top".into(),
            pause_minimized: "Pause When Minimized".into(),
            pause_unfocused: "Pause When Unfocused".into(),
            close_to_tray: "Close to Tray".into(),
            quit: "Quit".into(),
            error: "Try again".into(),
        };
        TrayDisplay {
            theme_id: "cool-grey".into(),
            themes: vec![ThemeEntry {
                id: "cool-grey".into(),
                name: "Harbor default".into(),
            }],
            tokens: TOKEN_KEYS
                .iter()
                .map(|key| (key.to_string(), "#111111".into()))
                .collect(),
            labels,
            direction: Direction::Ltr,
            color_scheme: ColorScheme::Dark,
            menu_width: 280.0,
            theme_width: 230.0,
        }
    }

    #[test]
    fn popup_hit_test_excludes_invisible_space_below_the_menu() {
        use windows::core::w;
        use windows::Win32::Graphics::Gdi::{CreateRectRgn, SetWindowRgn};
        use windows::Win32::UI::WindowsAndMessaging::{
            CreateWindowExW, DestroyWindow, WINDOW_EX_STYLE, WS_POPUP,
        };
        unsafe {
            let hwnd = CreateWindowExW(
                WINDOW_EX_STYLE::default(),
                w!("STATIC"),
                w!(""),
                WS_POPUP,
                0,
                0,
                520,
                450,
                None,
                None,
                None,
                None,
            )
            .unwrap();
            // The full window reserves space for a taller theme submenu.
            let region = CreateRectRgn(260, 0, 520, 300);
            assert_ne!(SetWindowRgn(hwnd, Some(region), false), 0);
            let inside = popup_region_contains(hwnd, 390, 150);
            let outside = [
                (390, -1),
                (259, 150),
                (520, 150),
                (390, 300),
                (390, 350),
                (259, 350),
                (520, 350),
            ]
            .map(|(x, y)| popup_region_contains(hwnd, x, y));
            DestroyWindow(hwnd).unwrap();
            assert!(inside);
            assert!(outside.into_iter().all(|inside| !inside));
        }
    }

    #[test]
    fn a_shell_takeover_keeps_the_menu_open_but_another_app_closes_it() {
        // The taskbar inherits the foreground when the notification area flyout
        // closes. That is not the user leaving the menu.
        assert!(!focus_loss_closes_menu(false, true));
        // Another application taking the foreground is the user leaving.
        assert!(focus_loss_closes_menu(false, false));
        // The pointer still on the menu means the menu is in use.
        assert!(!focus_loss_closes_menu(true, false));
        assert!(!focus_loss_closes_menu(true, true));
    }

    #[test]
    fn startup_display_opens_the_branded_menu_without_waiting_for_the_frontend() {
        let data = default_display();
        assert!(data.validate().is_ok());
        assert!(data.tokens.contains_key("--tray-row-hover"));
        assert_eq!(data.themes.len(), 1);
        assert_eq!(data.theme_id, "cool-grey");
    }

    #[test]
    fn publish_and_actions_accept_only_their_exact_window_label() {
        assert!(check_caller_label("main", "main").is_ok());
        assert!(check_caller_label(LABEL, LABEL).is_ok());
        for label in ["main", "harbor-browser", "harbor-tray-menu-other", ""] {
            assert!(check_caller_label(label, LABEL).is_err());
        }
        assert!(check_caller_label(LABEL, "main").is_err());
    }

    #[test]
    fn popup_invoke_gate_allows_only_the_five_popup_commands() {
        for command in [
            "tray_popup_snapshot",
            "tray_popup_present",
            "tray_popup_dismiss",
            "tray_popup_submenu",
            "tray_popup_action",
        ] {
            assert!(app_command_allowed(LABEL, LABEL, command));
        }
        for command in [
            "tray_popup_publish",
            "tray_set_prefs",
            "harbor_scan_folder",
            "games_launch_custom",
            "unknown",
        ] {
            assert!(!app_command_allowed(LABEL, LABEL, command));
        }
        assert!(!app_command_allowed(
            LABEL,
            "other-webview",
            "tray_popup_publish"
        ));
        assert!(!app_command_allowed(
            "other-window",
            LABEL,
            "tray_popup_publish"
        ));
    }

    #[test]
    fn popup_invoke_gate_preserves_existing_windows_dispatch() {
        for label in [
            "main",
            "harbor-browser",
            "harbor-pip",
            "harbor-tray-menu-other",
        ] {
            for command in [
                "tray_popup_publish",
                "tray_set_prefs",
                "harbor_scan_folder",
                "games_launch_custom",
                "unknown",
            ] {
                assert!(app_command_allowed(label, label, command));
            }
        }
    }

    #[test]
    fn catalog_rejects_duplicate_and_unpublished_theme_ids() {
        let mut data = display();
        assert!(data.validate().is_ok());
        assert!(!data.has_theme("user:unpublished"));
        data.theme_id = "user:unpublished".into();
        assert!(data.validate().is_err());
        data.theme_id = "cool-grey".into();
        data.themes.push(data.themes[0].clone());
        assert!(data.validate().is_err());
    }

    #[test]
    fn only_semantic_tokens_and_bounded_labels_enter_popup() {
        let mut data = display();
        data.tokens.remove("--color-danger");
        data.tokens.insert("--unrelated".into(), "red".into());
        assert!(data.validate().is_err());
        let mut data = display();
        data.labels.show = "x".repeat(513);
        assert!(data.validate().is_err());
        let mut data = display();
        data.menu_width = f64::INFINITY;
        assert!(data.validate().is_err());
    }

    #[test]
    fn unknown_or_malformed_actions_cannot_reach_dispatcher() {
        for payload in [
            r#"{"type":"execute","value":"anything"}"#,
            r#"{"type":"theme"}"#,
            r#"{"type":"theme","value":"nord","extra":true}"#,
        ] {
            assert!(serde_json::from_str::<Action>(payload).is_err());
        }
        assert!(
            matches!(serde_json::from_str::<Action>(r#"{"type":"theme","value":"nord"}"#).unwrap(), Action::Theme { value } if value == "nord")
        );
    }

    #[test]
    fn cancelled_stale_and_already_presented_requests_cannot_show() {
        let mut popup = Popup {
            open: true,
            open_id: 7,
            display: Some(display()),
            ..Popup::default()
        };
        assert!(popup.can_present(7));
        assert!(!popup.can_present(6));
        popup.open = false;
        assert!(!popup.can_present(7));
        popup.open = true;
        popup.presented = true;
        assert!(!popup.can_present(7));
    }

    #[test]
    fn dismissal_keeps_the_presented_window_until_the_exit_fade_completes() {
        let mut popup = Popup {
            open: true,
            presented: true,
            open_id: 7,
            ..Popup::default()
        };
        assert!(popup.begin_dismiss());
        let snapshot = popup.snapshot();
        assert!(!snapshot.open);
        assert!(snapshot.closing);
        assert!(popup.presented);
        assert!(!popup.can_present(7));
    }

    #[test]
    fn repeated_dismissal_and_stale_completion_do_not_change_a_closing_request() {
        let mut popup = Popup {
            open: true,
            presented: true,
            open_id: 7,
            ..Popup::default()
        };
        assert!(popup.begin_dismiss());
        let revision = popup.revision;
        assert!(!popup.begin_dismiss());
        assert_eq!(popup.revision, revision);
        assert!(!popup.complete_dismiss(6));
        assert!(popup.closing());
        assert!(popup.complete_dismiss(7));
        assert!(!popup.closing());
        assert!(!popup.presented);
        assert!(!popup.complete_dismiss(7));
    }

    #[test]
    fn late_fade_completion_cannot_hide_a_reopened_menu() {
        let mut popup = Popup {
            open: true,
            presented: true,
            open_id: 7,
            ..Popup::default()
        };
        assert!(popup.begin_dismiss());
        popup.open_id = 8;
        popup.open = true;
        popup.presented = true;
        assert!(!popup.complete_dismiss(7));
        assert!(popup.open);
        assert!(popup.presented);
    }

    #[test]
    fn cancelling_an_unpresented_request_does_not_start_an_exit_fade() {
        let mut popup = Popup {
            open: true,
            open_id: 7,
            ..Popup::default()
        };
        assert!(popup.begin_dismiss());
        assert!(!popup.snapshot().closing);
        assert!(!popup.complete_dismiss(7));
    }

    #[tokio::test]
    async fn fade_completion_cancels_the_close_failsafe() {
        let task = tokio::spawn(std::future::pending::<()>());
        let cancellation = task.abort_handle();
        let mut popup = Popup {
            open: false,
            presented: true,
            open_id: 7,
            watchdog: Some(tauri::async_runtime::JoinHandle::Tokio(task)),
            ..Popup::default()
        };
        assert!(!popup.complete_dismiss(6));
        assert!(popup.watchdog.is_some());
        assert!(popup.complete_dismiss(7));
        assert!(popup.watchdog.is_none());
        tokio::time::timeout(Duration::from_secs(1), async {
            while !cancellation.is_finished() {
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn completion_cancels_and_removes_the_ready_watchdog() {
        let task = tokio::spawn(std::future::pending::<()>());
        let cancellation = task.abort_handle();
        let mut popup = Popup {
            watchdog: Some(tauri::async_runtime::JoinHandle::Tokio(task)),
            ..Popup::default()
        };
        popup.cancel_watchdog();
        assert!(popup.watchdog.is_none());
        tokio::time::timeout(Duration::from_secs(1), async {
            while !cancellation.is_finished() {
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
    }
}
