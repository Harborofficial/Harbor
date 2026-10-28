#[cfg(all(desktop, feature = "music"))]
mod ytmusic;
// Modules that build on every target, desktop and Android alike. Nothing in
// here may reach a `#[cfg(desktop)]` tauri API: every Window setter (show,
// hide, close, set_size, set_position, set_focus, set_always_on_top,
// start_dragging, set_icon) is desktop-only in tauri 2, and so are
// `tauri::menu` and `tauri::tray`. The getters are not, which is why
// display geometry reads are fine and display geometry writes are not.
mod binary_lookup;
mod cast_hls;
mod cast_subs;
#[cfg(desktop)]
mod context_review;
mod crash_report;
mod diagnostics;
mod download;
mod download_file_policy;
mod download_files;
mod ebook_tts;
mod fonts;
mod gamepad;
mod http_fetch;
mod http_redirect;
mod local_lib;
mod log_privacy;
mod media_server;
#[cfg(windows)]
mod native_context_menu;
#[cfg(windows)]
mod native_context_policy;
mod playback_redirect;
mod power;
mod privacy;
mod proc_guard;
mod proc_mem;
mod settings_store;
mod stream_proxy;
mod streams;
mod stremio_auth;
mod subtitle_credentials;
mod temp_prune;
mod thumb_cache;
mod torrent_engine;
mod transcode;
mod web_server;

// Desktop-only. Each of these either drives a window, drives a tray or menu,
// links libmpv, or exists purely to serve one of those. `desktop` is a cfg
// alias emitted by tauri-build, so on Windows, macOS and Linux the predicate
// is a compile-time true and the compiler sees exactly the tree it saw before.
#[cfg(desktop)]
mod airplay;
#[cfg(desktop)]
mod anime4k;
#[cfg(desktop)]
mod app_icon;
#[cfg(desktop)]
mod asr_model;
#[cfg(desktop)]
mod browser;
mod browser_args;
#[cfg(desktop)]
mod native_module;
#[cfg(desktop)]
mod captions;
#[cfg(desktop)]
mod cast;
#[cfg(desktop)]
mod cast_server;
#[cfg(desktop)]
mod cf_relay;
#[cfg(desktop)]
mod cf_solver;
#[cfg(desktop)]
mod desktop_notify;
#[cfg(desktop)]
mod discord_rp;
#[cfg(desktop)]
mod display_fit;
#[cfg(desktop)]
mod ytdlp_update;
#[cfg(all(desktop, feature = "music"))]
mod dj_deck;
#[cfg(desktop)]
mod dlna;
#[cfg(desktop)]
mod dvr;
#[cfg(desktop)]
mod external_player;
#[cfg(desktop)]
mod fullscreen;
#[cfg(all(desktop, feature = "games"))]
mod games;
#[cfg(desktop)]
mod harbor_lan;
#[cfg(desktop)]
mod hdr_overlay;
mod install_features;
#[cfg(desktop)]
mod installer_handoff;
#[cfg(desktop)]
mod media_controls;
mod modal_overlay;
#[cfg(desktop)]
mod monitors;
#[cfg(desktop)]
mod mpv;
#[cfg(target_os = "linux")]
mod linux_gamescope;
#[cfg(target_os = "linux")]
mod mpv_render_linux;
#[cfg(target_os = "macos")]
mod mpv_render_mac;
#[cfg(desktop)]
mod multiview;
#[cfg(all(desktop, feature = "music"))]
mod music;
#[cfg(desktop)]
mod pip;
#[cfg(target_os = "macos")]
mod pip_mac;
mod pip_window;
#[cfg(desktop)]
mod playback_cache;
#[cfg(desktop)]
mod roku;
#[cfg(desktop)]
mod shaders;
#[cfg(desktop)]
mod song_id;
#[cfg(desktop)]
mod song_id_gemini;
#[cfg(desktop)]
mod sub_extract;
#[cfg(desktop)]
mod subsync;
#[cfg(desktop)]
mod svp;
#[cfg(target_os = "windows")]
mod taskbar;
#[cfg(desktop)]
mod thumbs;
#[cfg(desktop)]
mod trailer;
#[cfg(desktop)]
mod tray;
#[cfg(windows)]
mod tray_popup;
#[cfg(desktop)]
mod webview_helpers;
#[cfg(windows)]
mod win_graphics;

// http_fetch calls crate::cf_solver on the challenge path, and the real solver
// needs a hidden webview window that Android does not have. Rather than edit
// http_fetch, mobile binds the same module name to a stub that reports the
// capability as absent instead of pretending it succeeded.
#[cfg(mobile)]
#[path = "cf_solver_mobile.rs"]
mod cf_solver;
#[cfg(mobile)]
mod mobile;
// Android P2P policy. torrent_engine picks up engine_dir, new_session and the
// DHT rate from here behind the same cfg, so leaving this undeclared silently
// reverts Android to the desktop tuning: payloads into a cacheDir the OS
// reclaims mid-stream, and 400 DHT qps that fills a home router's NAT table.
#[cfg(target_os = "android")]
mod p2p_android;

#[cfg(desktop)]
pub(crate) fn release_stremio_scheme(app: &tauri::AppHandle) {
    if cfg!(feature = "context-review") {
        return;
    }
    use std::io::Write;
    use tauri_plugin_deep_link::DeepLinkExt;
    let msg = match app.deep_link().unregister("stremio") {
        Ok(()) => "[harbor::deeplink] released stremio:// on shutdown".to_string(),
        Err(e) => format!("[harbor::deeplink] could not release stremio://: {}", e),
    };
    let _ = writeln!(std::io::stderr(), "{}", msg);
}

#[cfg(desktop)]
pub(crate) fn shutdown_services(app: &tauri::AppHandle) {
    release_stremio_scheme(app);
    native_module::shutdown();
    thumbs::shutdown(app);
    multiview::shutdown(app);
    dvr::shutdown(app);
    #[cfg(feature = "music")]
    music::shutdown(app);
    stream_proxy::shutdown(app);
    cast_server::stop();
    torrent_engine::stop();
    discord_rp::shutdown(app);
    #[cfg(desktop)]
    external_player::shutdown();
    crash_report::mark_clean_exit();
}

#[cfg(desktop)]
pub static CLOSE_FLUSH_DONE: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);
#[cfg(desktop)]
static CLOSE_IN_PROGRESS: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
// Maximised windows are clamped to the work area so they never cover the taskbar.
// Fullscreen must cover it, so the clamp is lifted while fullscreen is active.
#[cfg(desktop)]
static MAXGUARD_CLAMP: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(true);

#[cfg(desktop)]
fn desktop_invoke_handler<F>(
    handler: F,
) -> impl Fn(tauri::ipc::Invoke<tauri::Wry>) -> bool + Send + Sync + 'static
where
    F: Fn(tauri::ipc::Invoke<tauri::Wry>) -> bool + Send + Sync + 'static,
{
    let music_enabled = install_features::music_enabled();
    let games_enabled = install_features::games_enabled();
    move |invoke| {
        // Plugin commands use capabilities; local app commands need this explicit popup boundary.
        #[cfg(windows)]
        {
            let webview = invoke.message.webview_ref();
            if !tray_popup::app_command_allowed(
                webview.window().label(),
                webview.label(),
                invoke.message.command(),
            ) {
                invoke
                    .resolver
                    .reject("Command unavailable to the tray menu");
                return true;
            }
        }
        if install_features::is_music_command(invoke.message.command()) && !music_enabled {
            invoke.resolver.reject("Music is unavailable in this installation.");
            return true;
        }
        if invoke.message.command().starts_with("games_") && !games_enabled {
            invoke.resolver.reject("Games are unavailable in this installation.");
            return true;
        }
        handler(invoke)
    }
}

#[cfg(desktop)]
#[tauri::command]
fn set_maximize_clamp(enabled: bool) {
    MAXGUARD_CLAMP.store(enabled, std::sync::atomic::Ordering::Relaxed);
}

#[cfg(desktop)]
#[tauri::command]
fn harbor_flush_done() {
    CLOSE_FLUSH_DONE.store(true, std::sync::atomic::Ordering::SeqCst);
}

#[cfg(desktop)]
#[tauri::command]
fn harbor_startup_ready(window: tauri::WebviewWindow) {
    if window.label() == "main" {
        let _ = window.set_focus();
    }
}

#[cfg(desktop)]
#[tauri::command]
fn close_aux_windows(app: tauri::AppHandle) {
    use tauri::Manager;
    for (label, window) in app.webview_windows() {
        if label != "main" {
            let _ = window.close();
        }
    }
}

#[cfg(desktop)]
#[tauri::command]
async fn deeplink_set_stremio(app: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    if cfg!(feature = "context-review") {
        return Ok(());
    }
    use tauri_plugin_deep_link::DeepLinkExt;
    if enabled {
        app.deep_link()
            .register("stremio")
            .map_err(|e| format!("register stremio: {}", e))?;
    } else {
        let _ = app.deep_link().unregister("stremio");
    }
    Ok(())
}

#[cfg(desktop)]
#[tauri::command]
async fn deeplink_is_stremio_registered(app: tauri::AppHandle) -> Result<bool, String> {
    if cfg!(feature = "context-review") {
        return Ok(false);
    }
    use tauri_plugin_deep_link::DeepLinkExt;
    app.deep_link()
        .is_registered("stremio")
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn save_text_file(path: String, contents: String) -> Result<(), String> {
    let target = std::path::PathBuf::from(&path);
    if let Some(parent) = target.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent).map_err(|e| format!("create folder: {}", e))?;
        }
    }
    std::fs::write(&target, contents.as_bytes()).map_err(|e| format!("write file: {}", e))
}

/// The tray popup is a plain surface with no frame of its own. The window
/// style still carries a caption, so the shell paints one whenever the window
/// is activated. Owning the non-client calculation keeps the client area over
/// the whole window and leaves nothing for the shell to paint.
#[cfg(windows)]
const HARBOR_TRAY_SUBCLASS_ID: usize = 0x4842_5452;

#[cfg(windows)]
unsafe extern "system" fn tray_subclass_proc(
    hwnd: windows::Win32::Foundation::HWND,
    msg: u32,
    wparam: windows::Win32::Foundation::WPARAM,
    lparam: windows::Win32::Foundation::LPARAM,
    _id: usize,
    _data: usize,
) -> windows::Win32::Foundation::LRESULT {
    use windows::Win32::UI::Shell::DefSubclassProc;
    use windows::Win32::UI::WindowsAndMessaging::{WM_NCACTIVATE, WM_NCCALCSIZE, WM_NCPAINT};
    match msg {
        // Leaving the proposed rectangle unchanged makes the whole window client
        // area, for both RECT and NCCALCSIZE_PARAMS forms of this message.
        WM_NCCALCSIZE | WM_NCPAINT => return windows::Win32::Foundation::LRESULT(0),
        WM_NCACTIVATE => return windows::Win32::Foundation::LRESULT(1),
        _ => {}
    }
    DefSubclassProc(hwnd, msg, wparam, lparam)
}

#[cfg(all(test, windows))]
#[test]
fn tray_frame_messages_preserve_the_client_area_without_painting_a_caption() {
    use windows::Win32::Foundation::{HWND, LPARAM, RECT, WPARAM};
    use windows::Win32::UI::WindowsAndMessaging::{
        NCCALCSIZE_PARAMS, WM_NCACTIVATE, WM_NCCALCSIZE, WM_NCPAINT,
    };
    unsafe {
        let mut rect = RECT {
            left: 10,
            top: 20,
            right: 530,
            bottom: 470,
        };
        let mut params = NCCALCSIZE_PARAMS::default();
        params.rgrc[0] = rect;
        for (extended, pointer) in [
            (0, (&mut rect as *mut RECT) as isize),
            (1, (&mut params as *mut NCCALCSIZE_PARAMS) as isize),
        ] {
            assert_eq!(
                tray_subclass_proc(
                    HWND::default(),
                    WM_NCCALCSIZE,
                    WPARAM(extended),
                    LPARAM(pointer),
                    0,
                    0,
                )
                .0,
                0
            );
        }
        assert_eq!(rect.top, 20);
        assert_eq!(params.rgrc[0].top, 20);
        assert_eq!(params.rgrc[0].right, 530);
        for (message, expected) in [(WM_NCPAINT, 0), (WM_NCACTIVATE, 1)] {
            for active in [0, 1] {
                assert_eq!(
                    tray_subclass_proc(HWND::default(), message, WPARAM(active), LPARAM(0), 0, 0).0,
                    expected
                );
            }
        }
    }
}

/// Gives the tray popup a client area that covers the whole window.
#[cfg(windows)]
pub(crate) fn install_tray_subclass(window: &tauri::WebviewWindow) {
    use windows::Win32::UI::Shell::SetWindowSubclass;
    use windows::Win32::UI::WindowsAndMessaging::{
        SetWindowPos, SWP_FRAMECHANGED, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER,
    };
    let Ok(hwnd) = window.hwnd() else {
        return;
    };
    // SetWindowSubclass must run on the thread that owns the window. Popup
    // creation runs on a worker to avoid blocking WebView2's event loop.
    let handle = hwnd.0 as isize;
    if let Err(error) = window.run_on_main_thread(move || unsafe {
        let hwnd = windows::Win32::Foundation::HWND(handle as *mut _);
        if !SetWindowSubclass(hwnd, Some(tray_subclass_proc), HARBOR_TRAY_SUBCLASS_ID, 0).as_bool()
        {
            eprintln!("[harbor::tray] install window subclass failed");
            return;
        }
        if let Err(error) = SetWindowPos(
            hwnd,
            None,
            0,
            0,
            0,
            0,
            SWP_FRAMECHANGED | SWP_NOMOVE | SWP_NOACTIVATE | SWP_NOSIZE | SWP_NOZORDER,
        ) {
            eprintln!("[harbor::tray] refresh window frame: {error}");
        }
    }) {
        eprintln!("[harbor::tray] schedule window subclass: {error}");
    }
}

/// Keeps a window from taking activation, so showing it leaves the foreground
/// where it was. The shell closes its notification area flyout when another
/// window activates.
#[cfg(windows)]
pub(crate) fn set_no_activate(window: &tauri::WebviewWindow, no_activate: bool) {
    use windows::Win32::UI::WindowsAndMessaging::{
        GetWindowLongPtrW, SetWindowLongPtrW, GWL_EXSTYLE, WS_EX_NOACTIVATE,
    };
    let Ok(hwnd) = window.hwnd() else {
        return;
    };
    unsafe {
        let style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
        let updated = if no_activate {
            style | WS_EX_NOACTIVATE.0 as isize
        } else {
            style & !(WS_EX_NOACTIVATE.0 as isize)
        };
        if updated != style {
            SetWindowLongPtrW(hwnd, GWL_EXSTYLE, updated);
        }
    }
}

#[cfg(windows)]
pub(crate) fn make_webview_transparent(window: &tauri::WebviewWindow) {
    let res = window.with_webview(|webview| unsafe {
        use webview2_com::Microsoft::Web::WebView2::Win32::{
            ICoreWebView2Controller2, COREWEBVIEW2_COLOR,
        };
        use windows::core::Interface;
        let controller = webview.controller();
        match controller.cast::<ICoreWebView2Controller2>() {
            Ok(controller2) => {
                let color = COREWEBVIEW2_COLOR {
                    A: 0,
                    R: 0,
                    G: 0,
                    B: 0,
                };
                if let Err(e) = controller2.SetDefaultBackgroundColor(color) {
                    eprintln!(
                        "[harbor::transparent] SetDefaultBackgroundColor FAILED: {:?}",
                        e
                    );
                }
            }
            Err(e) => eprintln!("[harbor::transparent] cast to Controller2 FAILED: {:?}", e),
        }
    });
    if let Err(e) = res {
        eprintln!("[harbor::transparent] with_webview FAILED: {:?}", e);
    }
}

#[cfg(windows)]
fn make_main_transparent(app: &tauri::AppHandle) {
    use tauri::Manager;
    let Some(window) = app.get_webview_window("main") else {
        eprintln!("[harbor::transparent] main window missing");
        return;
    };
    make_webview_transparent(&window);
}

#[cfg(windows)]
pub(crate) fn force_show_foreground(window: &tauri::WebviewWindow) {
    use windows::Win32::UI::WindowsAndMessaging::{
        IsIconic, SetForegroundWindow, ShowWindow, SW_RESTORE, SW_SHOW,
    };
    let Ok(hwnd) = window.hwnd() else {
        return;
    };
    unsafe {
        if IsIconic(hwnd).as_bool() {
            let _ = ShowWindow(hwnd, SW_RESTORE);
        } else {
            let _ = ShowWindow(hwnd, SW_SHOW);
        }
        let _ = SetForegroundWindow(hwnd);
    }
}

#[cfg(windows)]
const HARBOR_MAXGUARD_SUBCLASS_ID: usize = 0x4842_4D47;

#[cfg(windows)]
static MAIN_IN_SIZE_MOVE: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

#[cfg(windows)]
unsafe extern "system" fn maxguard_subclass_proc(
    hwnd: windows::Win32::Foundation::HWND,
    msg: u32,
    wparam: windows::Win32::Foundation::WPARAM,
    lparam: windows::Win32::Foundation::LPARAM,
    _id: usize,
    _data: usize,
) -> windows::Win32::Foundation::LRESULT {
    use windows::Win32::Graphics::Gdi::{
        GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST,
    };
    use windows::Win32::UI::Shell::DefSubclassProc;
    use windows::Win32::UI::WindowsAndMessaging::{
        MINMAXINFO, WM_ENTERSIZEMOVE, WM_ERASEBKGND, WM_EXITSIZEMOVE, WM_GETMINMAXINFO,
        WM_NCDESTROY,
    };
    if msg == WM_ENTERSIZEMOVE {
        MAIN_IN_SIZE_MOVE.store(true, std::sync::atomic::Ordering::Relaxed);
    } else if msg == WM_EXITSIZEMOVE || msg == WM_NCDESTROY {
        MAIN_IN_SIZE_MOVE.store(false, std::sync::atomic::Ordering::Relaxed);
    }
    // Suppress repeated erases only during an interactive move/resize, where
    // the WebView and mpv repaint asynchronously. Outside that loop, let Tao
    // paint the configured black background before transparent content appears.
    if msg == WM_ERASEBKGND && MAIN_IN_SIZE_MOVE.load(std::sync::atomic::Ordering::Relaxed) {
        return windows::Win32::Foundation::LRESULT(1);
    }
    let res = DefSubclassProc(hwnd, msg, wparam, lparam);
    if msg == WM_GETMINMAXINFO && MAXGUARD_CLAMP.load(std::sync::atomic::Ordering::Relaxed) {
        let monitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
        let mut mi = MONITORINFO {
            cbSize: std::mem::size_of::<MONITORINFO>() as u32,
            ..Default::default()
        };
        if GetMonitorInfoW(monitor, &mut mi).as_bool() {
            let mmi = &mut *(lparam.0 as *mut MINMAXINFO);
            mmi.ptMaxPosition.x = mi.rcWork.left - mi.rcMonitor.left;
            mmi.ptMaxPosition.y = mi.rcWork.top - mi.rcMonitor.top;
            mmi.ptMaxSize.x = mi.rcWork.right - mi.rcWork.left;
            mmi.ptMaxSize.y = mi.rcWork.bottom - mi.rcWork.top;
        }
    }
    if matches!(
        msg,
        windows::Win32::UI::WindowsAndMessaging::WM_NCPAINT
            | windows::Win32::UI::WindowsAndMessaging::WM_NCACTIVATE
    ) && MAXGUARD_CLAMP.load(std::sync::atomic::Ordering::Relaxed)
    {
        paint_main_taskbar_gap(hwnd);
    }
    res
}

#[cfg(windows)]
unsafe fn paint_main_taskbar_gap(hwnd: windows::Win32::Foundation::HWND) {
    use windows::Win32::Foundation::{POINT, RECT};
    use windows::Win32::Graphics::Gdi::{
        ClientToScreen, FillRect, GetMonitorInfoW, GetStockObject, GetWindowDC, MonitorFromWindow,
        ReleaseDC, BLACK_BRUSH, HBRUSH, MONITORINFO, MONITOR_DEFAULTTONEAREST,
    };
    use windows::Win32::UI::WindowsAndMessaging::{GetClientRect, GetWindowRect, IsZoomed};
    if !IsZoomed(hwnd).as_bool() {
        return;
    }
    let mut client = RECT::default();
    let mut outer = RECT::default();
    let mut origin = POINT::default();
    let mut monitor = MONITORINFO {
        cbSize: std::mem::size_of::<MONITORINFO>() as u32,
        ..Default::default()
    };
    if GetClientRect(hwnd, &mut client).is_err()
        || GetWindowRect(hwnd, &mut outer).is_err()
        || !ClientToScreen(hwnd, &mut origin).as_bool()
        || !GetMonitorInfoW(
            MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST),
            &mut monitor,
        )
        .as_bool()
    {
        return;
    }
    let work = monitor.rcWork;
    // Tao reserves one nonclient pixel for an auto-hidden taskbar. The WebView
    // cannot paint it. Own that strip's paint without changing its hit testing,
    // the client bounds, or the normal restored-window frame.
    if origin.x != work.left
        || origin.y != work.top
        || origin.x + client.right != work.right
        || origin.y + client.bottom != work.bottom - 1
        || outer.left > work.left
        || outer.right < work.right
        || outer.top > work.bottom - 1
        || outer.bottom < work.bottom
    {
        return;
    }
    let dc = GetWindowDC(Some(hwnd));
    if dc.0.is_null() {
        return;
    }
    let strip = RECT {
        left: work.left - outer.left,
        right: work.right - outer.left,
        top: work.bottom - 1 - outer.top,
        bottom: work.bottom - outer.top,
    };
    let brush = HBRUSH(GetStockObject(BLACK_BRUSH).0);
    let _ = FillRect(dc, &strip, brush);
    let _ = ReleaseDC(Some(hwnd), dc);
}

#[cfg(windows)]
fn install_maximize_guard(app: &tauri::AppHandle) {
    use tauri::Manager;
    use windows::Win32::UI::Shell::SetWindowSubclass;
    let Some(window) = app.get_webview_window("main") else {
        eprintln!("[harbor::maxguard] main window missing");
        return;
    };
    let Ok(hwnd) = window.hwnd() else {
        eprintln!("[harbor::maxguard] hwnd unavailable");
        return;
    };
    unsafe {
        let _ = SetWindowSubclass(
            hwnd,
            Some(maxguard_subclass_proc),
            HARBOR_MAXGUARD_SUBCLASS_ID,
            0,
        );
    }
    eprintln!("[harbor::maxguard] WM_GETMINMAXINFO work-area guard installed");
}

// Opt-in geometry-only diagnostics: never log player URLs or account data.
#[cfg(windows)]
fn log_main_geometry(app: &tauri::AppHandle, reason: &'static str) {
    use tauri::Manager;
    static ENABLED: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
    if !*ENABLED.get_or_init(|| std::env::var_os("HARBOR_WINDOW_DIAGNOSTICS").is_some()) {
        return;
    }
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let native_window = window.clone();
    let _ = window.with_webview(move |webview| unsafe {
        let Ok(hwnd) = native_window.hwnd() else { return };
        use windows::Win32::Foundation::{POINT, RECT};
        use windows::Win32::Graphics::Gdi::{ClientToScreen, GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST};
        use windows::Win32::UI::WindowsAndMessaging::{GetClientRect, GetWindowRect, IsZoomed};
        let mut outer = RECT::default();
        let mut client = RECT::default();
        let mut origin = POINT::default();
        let mut bounds = RECT::default();
        let mut monitor = MONITORINFO { cbSize: std::mem::size_of::<MONITORINFO>() as u32, ..Default::default() };
        let outer_ok = GetWindowRect(hwnd, &mut outer).is_ok();
        let client_ok = GetClientRect(hwnd, &mut client).is_ok();
        let origin_ok = ClientToScreen(hwnd, &mut origin).as_bool();
        let monitor_ok = GetMonitorInfoW(MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST), &mut monitor).as_bool();
        let bounds_ok = webview.controller().Bounds(&mut bounds).is_ok();
        eprintln!("[harbor::window-geometry] {reason} zoomed={} outer={outer:?}/{outer_ok} client={client:?}/{client_ok} origin={origin:?}/{origin_ok} webview={bounds:?}/{bounds_ok} monitor={:?} work={:?}/{monitor_ok}", IsZoomed(hwnd).as_bool(), monitor.rcMonitor, monitor.rcWork);
    });
}

#[tauri::command]
fn harbor_set_webview_memory_low(app: tauri::AppHandle, low: bool) {
    #[cfg(windows)]
    {
        use tauri::Manager;
        let Some(window) = app.get_webview_window("main") else {
            return;
        };
        let _ = window.with_webview(move |webview| unsafe {
            use webview2_com::Microsoft::Web::WebView2::Win32::{
                ICoreWebView2_19, COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW,
                COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL,
            };
            use windows::core::Interface;
            let controller = webview.controller();
            if let Ok(core) = controller.CoreWebView2() {
                if let Ok(w3) = core.cast::<ICoreWebView2_19>() {
                    let level = if low {
                        COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW
                    } else {
                        COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL
                    };
                    let _ = w3.SetMemoryUsageTargetLevel(level);
                }
            }
        });
    }
    #[cfg(not(windows))]
    {
        let _ = (&app, low);
    }
}

#[tauri::command]
fn harbor_set_webview_visible(app: tauri::AppHandle, visible: bool) {
    #[cfg(windows)]
    {
        use tauri::Manager;
        let Some(window) = app.get_webview_window("main") else {
            return;
        };
        let _ = window.with_webview(move |webview| unsafe {
            let _ = webview.controller().SetIsVisible(visible);
        });
    }
    #[cfg(not(windows))]
    {
        let _ = (&app, visible);
    }
}

#[tauri::command]
fn harbor_set_context_menu(app: tauri::AppHandle, enabled: bool) {
    #[cfg(windows)]
    {
        use tauri::Manager;
        let Some(window) = app.get_webview_window("main") else {
            return;
        };
        let _ = window.with_webview(move |webview| unsafe {
            let controller = webview.controller();
            if let Ok(core) = controller.CoreWebView2() {
                if let Ok(settings) = core.Settings() {
                    let _ = settings.SetAreDefaultContextMenusEnabled(enabled);
                }
            }
        });
    }
    #[cfg(not(windows))]
    {
        let _ = (&app, enabled);
    }
}

#[tauri::command]
async fn harbor_ack_frame_context(
    app: tauri::AppHandle,
    request_id: u64,
    handled: bool,
) -> Result<bool, String> {
    #[cfg(windows)]
    {
        native_context_menu::acknowledge(app, request_id, handled).await
    }
    #[cfg(not(windows))]
    {
        let _ = (app, request_id, handled);
        Ok(false)
    }
}

#[tauri::command]
fn harbor_try_suspend_webview(app: tauri::AppHandle) {
    #[cfg(windows)]
    {
        use tauri::Manager;
        let Some(window) = app.get_webview_window("main") else {
            return;
        };
        let _ = window.with_webview(move |webview| unsafe {
            use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2_3;
            use webview2_com::TrySuspendCompletedHandler;
            use windows::core::Interface;
            let controller = webview.controller();
            let _ = controller.SetIsVisible(false);
            if let Ok(core) = controller.CoreWebView2() {
                if let Ok(c3) = core.cast::<ICoreWebView2_3>() {
                    let handler = TrySuspendCompletedHandler::create(Box::new(|_hr, _ok| Ok(())));
                    let _ = c3.TrySuspend(&handler);
                }
            }
        });
    }
    #[cfg(not(windows))]
    {
        let _ = &app;
    }
}

#[tauri::command]
fn harbor_resume_webview(app: tauri::AppHandle) {
    #[cfg(windows)]
    {
        use tauri::Manager;
        let Some(window) = app.get_webview_window("main") else {
            return;
        };
        let _ = window.with_webview(move |webview| unsafe {
            use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2_3;
            use windows::core::Interface;
            let controller = webview.controller();
            if let Ok(core) = controller.CoreWebView2() {
                if let Ok(c3) = core.cast::<ICoreWebView2_3>() {
                    let _ = c3.Resume();
                }
            }
            let _ = controller.SetIsVisible(true);
        });
    }
    #[cfg(not(windows))]
    {
        let _ = &app;
    }
}

#[cfg(desktop)]
const REVEAL_FAILSAFE_MS: u64 = 12_000;

#[cfg(desktop)]
fn install_reveal_failsafe(app: &tauri::AppHandle) {
    use tauri::Manager;
    let handle = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(REVEAL_FAILSAFE_MS));
        let Some(window) = handle.get_webview_window("main") else {
            return;
        };
        if matches!(window.is_visible(), Ok(true)) {
            return;
        }
        eprintln!(
            "[harbor::reveal] page load did not finish in {REVEAL_FAILSAFE_MS}ms, showing window anyway"
        );
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    });
}

#[cfg(desktop)]
fn ensure_window_on_screen(app: &tauri::AppHandle) {
    use tauri::Manager;
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let (pos, size) = match (window.outer_position(), window.outer_size()) {
        (Ok(p), Ok(s)) => (p, s),
        _ => return,
    };
    let monitors = match window.available_monitors() {
        Ok(m) if !m.is_empty() => m,
        _ => return,
    };
    let ww = size.width as i32;
    let wh = size.height as i32;
    let on_screen = monitors.iter().any(|m| {
        let mp = m.position();
        let ms = m.size();
        pos.x < mp.x + ms.width as i32
            && pos.x + ww > mp.x
            && pos.y < mp.y + ms.height as i32
            && pos.y + wh > mp.y
    });
    if on_screen {
        return;
    }
    let target = window
        .primary_monitor()
        .ok()
        .flatten()
        .or_else(|| monitors.into_iter().next());
    let Some(mon) = target else {
        return;
    };
    let mp = mon.position();
    let ms = mon.size();
    let cx = mp.x + (ms.width as i32 - ww).max(0) / 2;
    let cy = mp.y + (ms.height as i32 - wh).max(0) / 2;
    let _ = window.set_position(tauri::PhysicalPosition::new(cx, cy));
    eprintln!(
        "[harbor::window] launched off-screen; recentered to {},{}",
        cx, cy
    );
}

#[cfg(desktop)]
const MEDIA_EXTS: &[&str] = &[
    "mkv", "mp4", "avi", "mov", "webm", "m4v", "ts", "m2ts", "mpg", "mpeg", "wmv", "flv", "ogv",
    "3gp",
];

#[cfg(desktop)]
fn media_file_from_args(args: &[String]) -> Option<String> {
    for a in args {
        let lower = a.to_lowercase();
        if MEDIA_EXTS.iter().any(|e| lower.ends_with(&format!(".{e}")))
            && std::path::Path::new(a).is_file()
        {
            return Some(a.clone());
        }
    }
    None
}

static PENDING_OPEN_FILE: std::sync::OnceLock<std::sync::Mutex<Option<String>>> =
    std::sync::OnceLock::new();

fn pending_open_file() -> &'static std::sync::Mutex<Option<String>> {
    PENDING_OPEN_FILE.get_or_init(|| std::sync::Mutex::new(None))
}

#[tauri::command]
fn harbor_take_pending_file() -> Option<String> {
    pending_open_file().lock().ok().and_then(|mut g| g.take())
}

// Android runs an entirely separate builder in `mobile.rs`. Desktop keeps this
// one verbatim: the `cfg_attr(mobile, ...)` that used to sit here expanded to
// nothing on desktop, so the emitted code is unchanged.
#[cfg(mobile)]
#[tauri::mobile_entry_point]
pub fn run() {
    mobile::run();
}

#[cfg(desktop)]
pub fn run() {
    #[cfg(target_os = "linux")]
    linux_gamescope::prepare();
    #[cfg(feature = "music")]
    if music::try_run_connector_worker() {
        return;
    }
    #[cfg(feature = "games")]
    if games::try_run_achievement_worker() {
        return;
    }
    #[cfg(feature = "games")]
    if games::try_run_archive_worker() {
        return;
    }
    #[cfg(feature = "games")]
    if games::try_run_hydra_import_worker() {
        return;
    }
    let context = tauri::generate_context!();
    context_review::prepare(context.config()).expect("unsafe context review configuration");
    if !cfg!(feature = "context-review") {
        let args: Vec<String> = std::env::args().skip(1).collect();
        if let Some(p) = media_file_from_args(&args) {
            if let Ok(mut g) = pending_open_file().lock() {
                *g = Some(p);
            }
        }
    }
    #[cfg(any(windows, target_os = "linux"))]
    svp::prime_svp_env();
    #[cfg(target_os = "linux")]
    mpv_render_linux::configure_linux_graphics();
    #[cfg(windows)]
    win_graphics::configure_windows_graphics();
    let _ = rustls::crypto::ring::default_provider().install_default();
    if !cfg!(feature = "context-review") {
        trailer::sweep_cache();
        std::thread::spawn(trailer::sweep_ytdlp_extractions);
        std::thread::spawn(temp_prune::sweep_temp);
    }

    let proxy_state = tauri::async_runtime::block_on(stream_proxy::ProxyState::start())
        .unwrap_or_else(|e| {
            eprintln!("[stream-proxy] failed to start: {}", e);
            stream_proxy::ProxyState::placeholder()
        });
    let mpv_state = mpv::MpvState::new();
    let pip_state = pip::PipState::new();
    let pip_window_state = pip_window::PipWindowState::default();
    let fullscreen_state = fullscreen::FullscreenState::new();
    let thumbs_state = thumbs::ThumbsState::new();
    let dvr_state = dvr::DvrState::new();
    let multiview_state = multiview::MultiviewState::new();
    let modal_overlay_state = modal_overlay::ModalOverlayState::new();
    let app_builder = tauri::Builder::default();
    // Dev builds can run alongside installed Harbor and other dev instances.
    #[cfg(not(debug_assertions))]
    let app_builder = app_builder.plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
        use tauri::{Emitter, Manager};
        if let Some(w) = app.get_webview_window("main") {
            let _ = w.show();
            let _ = w.unminimize();
            let _ = w.set_focus();
            #[cfg(windows)]
            force_show_foreground(&w);
        } else {
            eprintln!("[harbor::single-instance] no main window to focus, releasing the lock");
            app.exit(0);
            return;
        }
        if cfg!(feature = "context-review") {
            return;
        }
        if let Some(url) = args.iter().find(|a| a.starts_with("harbor://")) {
            let _ = app.emit("harbor:stremio-deeplink", url.clone());
        }
        if let Some(path) = media_file_from_args(&args) {
            let _ = app.emit("harbor:open-file", path);
        }
    }));
    let app_builder = app_builder
        // tauri-plugin-opener injects a page script that itself opens target="_blank" anchors, duplicating Harbor's own openUrl.
        .plugin(
            tauri_plugin_opener::Builder::new()
                .open_js_links_on_click(false)
                .build(),
        )
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_process::init())
        .plugin({
            let builder = tauri_plugin_window_state::Builder::default()
                .with_denylist(&[
                    #[cfg(target_os = "macos")]
                    "main",
                    "harbor-ytmusic-embed",
                    "harbor-tray-menu",
                ])
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::SIZE
                        | tauri_plugin_window_state::StateFlags::POSITION
                        | tauri_plugin_window_state::StateFlags::MAXIMIZED,
                );
            // Restore the Windows main window only after its maximize guard is
            // installed, so startup uses the same work-area rules as user maximize.
            #[cfg(windows)]
            let builder = builder.skip_initial_state("main");
            builder.build()
        })
        .manage(proxy_state)
        .manage(mpv_state)
        .manage(pip_state)
        .manage(pip_window_state)
        .manage(fullscreen_state)
        .manage(thumbs_state)
        .manage(dvr_state)
        .manage(multiview_state)
        .manage(modal_overlay_state)
        .manage(discord_rp::DiscordState::new())
        .manage(download::DownloadState::new());

    #[cfg(feature = "music")]
    let app_builder = if install_features::music_enabled() {
        app_builder.manage(music::MusicState::new())
    } else {
        app_builder
    };

    let app_builder = if cfg!(feature = "context-review") {
        app_builder.plugin(context_review::plugin())
    } else {
        app_builder.plugin(tauri_plugin_updater::Builder::new().build())
    };

    #[cfg(target_os = "macos")]
    let app_builder = app_builder.register_uri_scheme_protocol("stremio", |ctx, request| {
        use tauri::Emitter;
        let url = request.uri().to_string();
        let _ = ctx.app_handle().emit("harbor:stremio-deeplink", url);
        tauri::http::Response::builder()
            .status(200)
            .header("content-type", "text/html; charset=utf-8")
            .body(b"<!doctype html><meta charset=\"utf-8\"><title>Harbor</title>".to_vec())
            .unwrap()
    });

    app_builder
        .plugin(privacy::init())
        .on_page_load(|webview, payload| {
            if webview.label() == "main"
                && matches!(payload.event(), tauri::webview::PageLoadEvent::Finished)
            {
                let _ = webview.window().show();
            }
        })
        .setup(move |app| {
            #[cfg(windows)]
            if let Err(error) = native_context_menu::install(app.handle()) {
                eprintln!("[harbor::context-menu] install failed: {error}");
            }
            if let Err(error) = crash_report::initialize(app.handle()) {
                eprintln!("[harbor::crash-report] initialization failed: {error}");
            }
            proc_guard::init();
            if !cfg!(feature = "context-review") {
                proc_guard::reap_orphans();
            }
            #[cfg(feature = "games")]
            if install_features::games_enabled() {
                games::initialize_download_preparation(app.handle());
            }
            #[cfg(feature = "music")]
            if install_features::music_enabled() {
                music::initialize(app.handle()).map_err(std::io::Error::other)?;
            }
            #[cfg(windows)]
            if !cfg!(feature = "context-review") {
                use tauri_plugin_deep_link::DeepLinkExt;
                if let Err(e) = app.deep_link().register_all() {
                    eprintln!("[harbor::deep-link] register_all failed: {:?}", e);
                }
            }
            #[cfg(target_os = "linux")]
            {
                if !cfg!(feature = "context-review") && std::env::var_os("FLATPAK_ID").is_none() {
                    use tauri_plugin_deep_link::DeepLinkExt;
                    if let Err(e) = app.deep_link().register_all() {
                        eprintln!("[harbor::deep-link] register_all failed: {:?}", e);
                    }
                }
            }
            #[cfg(windows)]
            make_main_transparent(&app.handle());
            #[cfg(windows)]
            install_maximize_guard(&app.handle());
            #[cfg(windows)]
            {
                use tauri::Manager;
                use tauri_plugin_window_state::{StateFlags, WindowExt};
                if let Some(window) = app.get_webview_window("main") {
                    if let Err(error) = window.restore_state(
                        StateFlags::SIZE | StateFlags::POSITION | StateFlags::MAXIMIZED,
                    ) {
                        eprintln!("[harbor::window] startup restore failed: {error}");
                    }
                }
            }
            display_fit::install(app.handle());
            install_reveal_failsafe(app.handle());
            ensure_window_on_screen(&app.handle());
            #[cfg(target_os = "macos")]
            {
                use tauri::Manager;
                if let Some(window) = app.handle().get_webview_window("main") {
                    if let Ok(ns_window) = window.ns_window() {
                        let ns_window_ptr = ns_window as i64;
                        if let Err(e) = mpv_render_mac::install_window_rounding(ns_window_ptr) {
                            eprintln!("[harbor::mac] rounding failed: {}", e);
                        }
                        if let Err(e) = mpv_render_mac::make_resizable(ns_window_ptr) {
                            eprintln!("[harbor::mac] resizable failed: {}", e);
                        }
                    }
                }
            }
            cast_server::ensure_started_on_setup(&app.handle());
            torrent_engine::ensure_started_on_setup(&app.handle());
            {
                let handle = app.handle().clone();
                std::thread::spawn(move || {
                    use tauri::Manager;
                    if let Ok(base) = handle.path().app_cache_dir() {
                        let _ = temp_prune::sweep_mpv_cache(base.join("mpv-cache"));
                    }
                });
            }
            media_controls::ensure_started_on_setup(&app.handle());
            #[cfg(target_os = "windows")]
            taskbar::init(&app.handle());
            {
                let handle = app.handle().clone();
                std::thread::spawn(move || discord_rp::run_loop(handle));
            }
            gamepad::spawn(app.handle().clone());
            #[cfg(desktop)]
            if let Err(e) = tray::build(&app.handle()) {
                eprintln!("[harbor::tray] build failed: {:?}", e);
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            use tauri::Manager;

            #[cfg(target_os = "linux")]
            if window.label() == pip_window::PIP_LABEL {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    // Keep GTK/Tauri from destroying the host before mpv is
                    // retargeted back to the main window.
                    api.prevent_close();

                    let app = window.app_handle().clone();
                    tauri::async_runtime::spawn(async move {
                        let state = app.state::<pip_window::PipWindowState>();

                        match pip_window::pip_window_exit(app.clone(), state).await {
                            Ok(()) => {
                                // Also handles an already-inactive but visible stale window.
                                if let Some(pip) =
                                    app.get_webview_window(pip_window::PIP_LABEL)
                                {
                                    let _ = pip.hide();
                                }
                            }
                            Err(error) => {
                                eprintln!(
                                    "[harbor::pip] failed to restore video after PiP close: {error}"
                                );
                            }
                        }
                    });
                }
                return;
            }

            if window.label() != "main" {
                return;
            }
            #[cfg(windows)]
            if matches!(
                event,
                tauri::WindowEvent::Moved(_)
                    | tauri::WindowEvent::Resized(_)
                    | tauri::WindowEvent::ScaleFactorChanged { .. }
            ) && window
                .app_handle()
                .get_webview_window(hdr_overlay::HDR_OVERLAY_LABEL)
                .is_some()
            {
                let app = window.app_handle().clone();
                tauri::async_runtime::spawn(async move {
                    let _ = hdr_overlay::hdr_overlay_sync(app).await;
                });
            }
            #[cfg(windows)]
            match event {
                tauri::WindowEvent::Resized(_) => log_main_geometry(window.app_handle(), "resized"),
                tauri::WindowEvent::Moved(_) => log_main_geometry(window.app_handle(), "moved"),
                tauri::WindowEvent::Focused(true) => {
                    log_main_geometry(window.app_handle(), "focused")
                }
                _ => {}
            }
            match event {
                tauri::WindowEvent::CloseRequested { api, .. } => {
                    if tray::close_to_tray() {
                        api.prevent_close();
                        let _ = window.hide();
                    } else if !CLOSE_IN_PROGRESS.swap(true, std::sync::atomic::Ordering::SeqCst) {
                        use tauri::Emitter;
                        api.prevent_close();
                        CLOSE_FLUSH_DONE.store(false, std::sync::atomic::Ordering::SeqCst);
                        let _ = window.emit("harbor://app-closing", ());
                        let w = window.clone();
                        std::thread::spawn(move || {
                            for _ in 0..24 {
                                if CLOSE_FLUSH_DONE.load(std::sync::atomic::Ordering::SeqCst) {
                                    break;
                                }
                                std::thread::sleep(std::time::Duration::from_millis(50));
                            }
                            let _ = w.destroy();
                        });
                    }
                }
                tauri::WindowEvent::Focused(focused) => {
                    use tauri::Emitter;
                    gamepad::set_window_focused(*focused);
                    if *focused
                        && (pip::window_pip_is_active(window.app_handle())
                            || tray::always_on_top_pref())
                    {
                        let _ = window.set_always_on_top(true);
                    }
                    let minimized = if *focused {
                        false
                    } else {
                        window.is_minimized().unwrap_or(false)
                            || !window.is_visible().unwrap_or(true)
                    };
                    let _ = window.emit(
                        "harbor://window-activity",
                        serde_json::json!({ "focused": *focused, "minimized": minimized }),
                    );
                }
                tauri::WindowEvent::Destroyed => {
                    #[cfg(windows)]
                    if let Err(error) = tray_popup::destroy(window.app_handle()) {
                        eprintln!("[harbor::tray] cleanup failed: {error}");
                    }
                    shutdown_services(window.app_handle());
                }
                _ => {}
            }
        })
        .invoke_handler(desktop_invoke_handler(tauri::generate_handler![
            #[cfg(feature = "games")]
            games::games_pokemon,
            #[cfg(feature = "games")]
            games::games_scan_steam,
            #[cfg(feature = "games")]
            games::steam_shortcut_commands::games_scan_steam_shortcuts,
            #[cfg(feature = "games")]
            games::steam_shortcut_commands::games_launch_steam_shortcut,
            #[cfg(feature = "games")]
            games::steam_shortcut_commands::games_steam_shortcut_icons,
            #[cfg(feature = "games")]
            games::steam_shortcut_commands::games_launch_steam_shortcut_direct,
            #[cfg(feature = "games")]
            games::steam_shortcut_commands::games_steam_shortcut_running,
            #[cfg(feature = "games")]
            games::games_scan_launchers,
            #[cfg(feature = "games")]
            games::games_wow_addons,
            #[cfg(feature = "games")]
            games::games_sims_folders,
            #[cfg(feature = "games")]
            games::games_sims_workspace,
            #[cfg(feature = "games")]
            games::games_sims_inspect,
            #[cfg(feature = "games")]
            games::games_sims_metadata,
            #[cfg(feature = "games")]
            games::games_sims_packs,
            #[cfg(feature = "games")]
            games::games_sims_duplicates,
            #[cfg(feature = "games")]
            games::games_sims_dependencies,
            #[cfg(feature = "games")]
            games::games_sims_tray_preview,
            #[cfg(feature = "games")]
            games::games_sims_tray_content,
            #[cfg(feature = "games")]
            games::games_sims_kept_folder,
            #[cfg(feature = "games")]
            games::games_sims_catalog,
            #[cfg(feature = "games")]
            games::games_sims_lot51_catalog,
            #[cfg(feature = "games")]
            games::stardew_commands::games_stardew_folders,
            #[cfg(feature = "games")]
            games::stardew_commands::games_stardew_inspect,
            #[cfg(feature = "games")]
            games::stardew_commands::games_stardew_updates,
            #[cfg(feature = "games")]
            games::stardew_commands::games_stardew_cancel,
            #[cfg(feature = "games")]
            games::stardew_commands::games_stardew_workspace,
            #[cfg(feature = "games")]
            games::stardew_commands::games_stardew_review,
            #[cfg(feature = "games")]
            games::stardew_commands::games_stardew_apply,
            #[cfg(feature = "games")]
            games::stardew_commands::games_stardew_recover,
            #[cfg(feature = "games")]
            games::stardew_commands::games_stardew_discard,
            #[cfg(feature = "games")]
            games::stardew_commands::games_stardew_catalog,
            #[cfg(feature = "games")]
            games::stardew_commands::games_stardew_creator_review,
            #[cfg(feature = "games")]
            games::games_sims_mts_detail,
            #[cfg(feature = "games")]
            games::games_sims_mts_browse,
            #[cfg(feature = "games")]
            games::games_sims_mts_review,
            #[cfg(feature = "games")]
            games::games_sims_lot51_detail,
            #[cfg(feature = "games")]
            games::games_sims_lot51_review,
            #[cfg(feature = "games")]
            games::games_sims_creator_review,
            #[cfg(feature = "games")]
            games::games_sims_review,
            #[cfg(feature = "games")]
            games::games_sims_apply,
            #[cfg(feature = "games")]
            games::games_sims_cancel,
            #[cfg(feature = "games")]
            games::games_sims_sets,
            #[cfg(feature = "games")]
            games::games_sims_set_save,
            #[cfg(feature = "games")]
            games::games_sims_set_remove,
            #[cfg(feature = "games")]
            games::games_sims_discard,
            #[cfg(feature = "games")]
            games::games_sims_recover,
            #[cfg(feature = "games")]
            games::games_sims_save_context,
            #[cfg(feature = "games")]
            games::games_sims_save_recover,
            #[cfg(feature = "games")]
            games::games_save_recovery_status,
            #[cfg(feature = "games")]
            games::games_recover_save_restore,
            #[cfg(feature = "games")]
            games::games_sims_save_list,
            #[cfg(feature = "games")]
            games::games_sims_save_snapshot,
            #[cfg(feature = "games")]
            games::games_sims_save_review,
            #[cfg(feature = "games")]
            games::games_wow_addon_package,
            #[cfg(feature = "games")]
            games::games_wow_addon_workspace,
            #[cfg(feature = "games")]
            games::games_wow_addon_review,
            #[cfg(feature = "games")]
            games::games_wow_addon_apply,
            #[cfg(feature = "games")]
            games::games_wow_addon_discard,
            #[cfg(feature = "games")]
            games::games_wow_addon_cancel,
            #[cfg(feature = "games")]
            games::games_wow_addon_recover,
            #[cfg(feature = "games")]
            games::games_launch_launcher_game,
            #[cfg(feature = "games")]
            games::games_launcher_sessions,
            #[cfg(feature = "games")]
            games::games_inspect_archive,
            #[cfg(feature = "games")]
            games::games_inspect_setup,
            #[cfg(feature = "games")]
            games::games_setup_icon,
            #[cfg(feature = "games")]
            games::games_start_setup,
            #[cfg(feature = "games")]
            games::games_setup_jobs,
            #[cfg(feature = "games")]
            games::games_recover_setup,
            #[cfg(feature = "games")]
            games::games_reveal_setup,
            #[cfg(feature = "games")]
            games::games_observe_setup,
            #[cfg(feature = "games")]
            games::games_archive_space,
            #[cfg(feature = "games")]
            games::games_extract_archive,
            #[cfg(feature = "games")]
            games::games_cancel_archive,
            #[cfg(feature = "games")]
            games::games_discard_archive,
            #[cfg(feature = "games")]
            games::games_archive_jobs,
            #[cfg(feature = "games")]
            games::games_review_archive_cleanup,
            #[cfg(feature = "games")]
            games::games_discard_archive_cleanup,
            #[cfg(feature = "games")]
            games::games_recycle_archive_sources,
            #[cfg(feature = "games")]
            games::games_archive_cleanup_records,
            #[cfg(feature = "games")]
            games::games_archive_cleanup_action,
            #[cfg(feature = "games")]
            games::games_start_archive,
            #[cfg(feature = "games")]
            games::games_prepare_archive,
            #[cfg(feature = "games")]
            games::games_preparation_choices,
            #[cfg(feature = "games")]
            games::games_preparation_version,
            #[cfg(feature = "games")]
            games::games_preparation_candidates,
            #[cfg(feature = "games")]
            games::games_set_preparation,
            #[cfg(feature = "games")]
            games::games_disable_preparation,
            #[cfg(feature = "games")]
            games::games_remove_archive_job,
            #[cfg(feature = "games")]
            games::games_steam_account_status,
            #[cfg(feature = "games")]
            games::games_battlenet_account,
            #[cfg(feature = "games")]
            games::games_battlenet_import,
            #[cfg(feature = "games")]
            games::games_battlenet_cancel,
            #[cfg(feature = "games")]
            games::games_battlenet_preferences,
            #[cfg(feature = "games")]
            games::games_battlenet_disconnect,
            #[cfg(feature = "games")]
            games::games_minecraft_status,
            #[cfg(feature = "games")]
            games::games_minecraft_begin,
            #[cfg(feature = "games")]
            games::games_minecraft_poll,
            #[cfg(feature = "games")]
            games::games_minecraft_cancel,
            #[cfg(feature = "games")]
            games::games_minecraft_refresh,
            #[cfg(feature = "games")]
            games::games_minecraft_disconnect,
            #[cfg(feature = "games")]
            games::games_minecraft_apply_skin,
            #[cfg(feature = "games")]
            games::games_minecraft_apply_cape,
            #[cfg(feature = "games")]
            games::games_minecraft_texture,
            #[cfg(feature = "games")]
            games::games_minecraft_catalog,
            #[cfg(feature = "games")]
            games::games_minecraft_instances,
            #[cfg(feature = "games")]
            games::games_minecraft_instance_create,
            #[cfg(feature = "games")]
            games::games_minecraft_instance_rename,
            #[cfg(feature = "games")]
            games::games_minecraft_instance_folder,
            #[cfg(feature = "games")]
            games::games_minecraft_content,
            #[cfg(feature = "games")]
            games::games_minecraft_fabric_versions,
            #[cfg(feature = "games")]
            games::games_minecraft_loader_versions,
            #[cfg(feature = "games")]
            games::games_minecraft_pack_update_state,
            #[cfg(feature = "games")]
            games::games_minecraft_pack_update_review,
            #[cfg(feature = "games")]
            games::games_minecraft_pack_update_select,
            #[cfg(feature = "games")]
            games::games_minecraft_pack_update_apply,
            #[cfg(feature = "games")]
            games::games_minecraft_pack_update_discard,
            #[cfg(feature = "games")]
            games::games_minecraft_pack_update_cancel,
            #[cfg(feature = "games")]
            games::games_minecraft_instance_export_review,
            #[cfg(feature = "games")]
            games::games_minecraft_instance_export_apply,
            #[cfg(feature = "games")]
            games::games_minecraft_instance_storage,
            #[cfg(feature = "games")]
            games::games_minecraft_instance_remove_review,
            #[cfg(feature = "games")]
            games::games_minecraft_instance_remove_apply,
            #[cfg(feature = "games")]
            games::games_minecraft_lifecycle_discard,
            #[cfg(feature = "games")]
            games::games_minecraft_pack_review,
            #[cfg(feature = "games")]
            games::games_minecraft_pack_install,
            #[cfg(feature = "games")]
            games::games_minecraft_pack_cancel,
            #[cfg(feature = "games")]
            games::games_minecraft_pack_discard,
            #[cfg(feature = "games")]
            games::games_minecraft_runtime_state,
            #[cfg(feature = "games")]
            games::games_minecraft_runtime_review,
            #[cfg(feature = "games")]
            games::games_minecraft_runtime_install,
            #[cfg(feature = "games")]
            games::games_minecraft_runtime_cancel,
            #[cfg(feature = "games")]
            games::games_minecraft_runtime_discard,
            #[cfg(feature = "games")]
            games::games_minecraft_java_state,
            #[cfg(feature = "games")]
            games::games_minecraft_java_review,
            #[cfg(feature = "games")]
            games::games_minecraft_java_select,
            #[cfg(feature = "games")]
            games::games_minecraft_java_memory,
            #[cfg(feature = "games")]
            games::games_minecraft_java_install,
            #[cfg(feature = "games")]
            games::games_minecraft_java_discard,
            #[cfg(feature = "games")]
            games::games_minecraft_launch_state,
            #[cfg(feature = "games")]
            games::games_minecraft_launch,
            #[cfg(feature = "games")]
            games::games_connect_steam_account,
            #[cfg(feature = "games")]
            games::games_refresh_steam_account,
            #[cfg(feature = "games")]
            games::games_disconnect_steam_account,
            #[cfg(feature = "games")]
            games::games_steam_achievements,
            #[cfg(feature = "games")]
            games::games_read_local_achievements,
            #[cfg(feature = "games")]
            games::games_apply_local_achievements,
            #[cfg(feature = "games")]
            games::games_discard_local_achievements,
            #[cfg(feature = "games")]
            games::games_install_steam,
            #[cfg(feature = "games")]
            games::games_list_transfers,
            #[cfg(feature = "games")]
            games::games_transfer_settings,
            #[cfg(feature = "games")]
            games::games_transfer_storage,
            #[cfg(feature = "games")]
            games::games_download_locations,
            #[cfg(feature = "games")]
            games::games_set_transfer_bandwidth,
            #[cfg(feature = "games")]
            games::games_source_public_review,
            #[cfg(feature = "games")]
            games::games_source_public_prepare,
            #[cfg(feature = "games")]
            games::games_source_public_prepare_batch,
            #[cfg(feature = "games")]
            games::games_source_public_cancel_batch,
            #[cfg(feature = "games")]
            games::games_hydra_import_review,
            #[cfg(feature = "games")]
            games::games_hydra_import_cancel,
            #[cfg(feature = "games")]
            games::games_cloud_list,
            #[cfg(feature = "games")]
            games::games_cloud_download,
            #[cfg(feature = "games")]
            games::games_cloud_resolve_link,
            #[cfg(feature = "games")]
            games::games_cloud_host_check,
            #[cfg(feature = "games")]
            games::games_cloud_ad_prepare,
            #[cfg(feature = "games")]
            games::games_cloud_ad_status,
            #[cfg(feature = "games")]
            games::games_cloud_web_create,
            #[cfg(feature = "games")]
            games::games_cloud_web_list,
            #[cfg(feature = "games")]
            games::games_cloud_web_status,
            #[cfg(feature = "games")]
            games::games_cloud_web_download,
            #[cfg(feature = "games")]
            games::games_cloud_web_find,
            #[cfg(feature = "games")]
            games::games_cloud_pm_create,
            #[cfg(feature = "games")]
            games::games_cloud_pm_list,
            #[cfg(feature = "games")]
            games::games_cloud_pm_status,
            #[cfg(feature = "games")]
            games::games_cloud_pm_download,
            #[cfg(feature = "games")]
            games::games_cloud_pm_retry,
            #[cfg(feature = "games")]
            games::games_modrinth,
            #[cfg(feature = "games")]
            games::games_mod_workspace,
            #[cfg(feature = "games")]
            games::games_review_mods,
            #[cfg(feature = "games")]
            games::games_install_mods,
            #[cfg(feature = "games")]
            games::games_mod_action,
            #[cfg(feature = "games")]
            games::games_cancel_mods,
            #[cfg(feature = "games")]
            games::games_discard_mods,
            #[cfg(feature = "games")]
            games::games_list_torrents,
            #[cfg(feature = "games")]
            games::games_inspect_torrent,
            #[cfg(feature = "games")]
            games::games_cancel_torrent_inspection,
            #[cfg(feature = "games")]
            games::games_discard_torrent,
            #[cfg(feature = "games")]
            games::games_start_torrent,
            #[cfg(feature = "games")]
            games::games_torrent_action,
            #[cfg(feature = "games")]
            games::games_seed_torrent,
            #[cfg(feature = "games")]
            games::games_list_save_snapshots,
            #[cfg(feature = "games")]
            games::games_validate_custom_launch,
            #[cfg(feature = "games")]
            games::games_game_shortcuts,
            #[cfg(feature = "games")]
            games::games_allow_game_execution,
            #[cfg(feature = "games")]
            games::games_custom_running,
            #[cfg(feature = "games")]
            games::games_custom_history,
            #[cfg(feature = "games")]
            games::games_validate_custom_artwork,
            #[cfg(feature = "games")]
            games::games_launch_custom,
            #[cfg(feature = "games")]
            games::games_create_save_snapshot,
            #[cfg(feature = "games")]
            games::games_prepare_save_restore,
            #[cfg(feature = "games")]
            games::games_restore_save_snapshot,
            #[cfg(feature = "games")]
            games::games_cancel_save_operation,
            #[cfg(feature = "games")]
            games::games_discard_save_restore,
            #[cfg(feature = "games")]
            games::games_source_browser_choose,
            #[cfg(feature = "games")]
            games::games_source_browser_close,
            #[cfg(feature = "games")]
            games::games_source_verify,
            #[cfg(feature = "games")]
            games::games_source_verify_cancel,
            #[cfg(feature = "games")]
            games::games_source_verified_fetch,
            #[cfg(feature = "games")]
            games::games_source_http_fetch,
            #[cfg(feature = "games")]
            games::games_source_http_cancel,
            #[cfg(feature = "games")]
            games::games_add_transfer,
            #[cfg(feature = "games")]
            games::games_add_transfer_batch,
            #[cfg(feature = "games")]
            games::games_transfer_action,
            #[cfg(feature = "games")]
            games::games_relink_transfer,
            #[cfg(feature = "games")]
            games::games_download_patch,
            #[cfg(feature = "games")]
            games::games_cancel_patch_download,
            #[cfg(feature = "games")]
            games::games_match_patch_sources,
            #[cfg(feature = "games")]
            games::games_prepare_patch,
            #[cfg(feature = "games")]
            games::games_write_patch,
            #[cfg(feature = "games")]
            games::games_discard_patch,
            #[cfg(feature = "games")]
            games::games_scan_roms,
            #[cfg(feature = "games")]
            games::games_find_emulators,
            #[cfg(feature = "games")]
            games::games_validate_emulator,
            #[cfg(feature = "games")]
            games::games_emulation_running,
            #[cfg(feature = "games")]
            games::games_launch_emulated,
            #[cfg(feature = "games")]
            games::games_retro_status,
            #[cfg(feature = "games")]
            games::games_retro_start,
            #[cfg(feature = "games")]
            games::games_retro_close,
            #[cfg(feature = "games")]
            games::games_launch_steam,
            #[cfg(feature = "games")]
            games::library_management::games_manage_steam,
            #[cfg(feature = "games")]
            games::library_management::games_manage_launcher,
            #[cfg(feature = "games")]
            games::library_management::games_open_installed_apps,
            privacy::privacy_status,
            privacy::privacy_set_enabled,
            set_maximize_clamp,
            monitors::list_monitors,
            monitors::move_main_to_monitor,
            crash_report::take_startup_crash_report,
            fonts::install_sub_font,
            fonts::remove_sub_font,
            fonts::list_sub_fonts,
            ebook_tts::ebook_tts_synthesize,
            ebook_tts::ebook_tts_cancel,
            ebook_tts::ebook_tts_voices,
            harbor_flush_done,
            harbor_startup_ready,
            close_aux_windows,
            desktop_notify::send_clickable_notification,
            installer_handoff::handoff_probe,
            installer_handoff::handoff_stage,
            installer_handoff::handoff_launch,
            installer_handoff::handoff_confirm,
            installer_handoff::handoff_save_backup,
            installer_handoff::modify_probe,
            installer_handoff::modify_open,
            install_features::install_features,
            native_module::native_module_call,
            power::power_inhibit,
            harbor_set_webview_memory_low,
            harbor_set_webview_visible,
            harbor_set_context_menu,
            harbor_ack_frame_context,
            harbor_try_suspend_webview,
            harbor_resume_webview,
            save_text_file,
            subsync::moviehash::compute_moviehash,
            subsync::sync_subtitle,
            subsync::scorer::subsync_score_transform,
            subsync::scorer::subsync_preflight_candidates,
            subsync::torrent_sync::torrent_sync_availability,
            subsync::torrent_sync::torrent_sync_subtitle,
            subsync::torrent_sync::torrent_score_transform,
            subsync::audio_tracks::audio_probe_tracks,
            subsync::fingerprint::compute_chromaprint,
            subsync::asr::asr_transcribe_windows,
            subsync::asr::asr_verify,
            sub_extract::subtitle_extract,
            sub_extract::subtitle_extract_ass,
            cast_server::stop_stremio_sidecar,
            cast_server::cast_server_stop,
            web_server::web_serve_start,
            web_server::web_serve_stop,
            web_server::web_serve_status,
            web_server::remote_ws_broadcast,
            web_server::remote_ws_client_count,
            anime4k::anime4k_download,
            anime4k::anime4k_dir,
            asr_model::asr_ensure_model,
            asr_model::asr_model_path,
            shaders::shader_download,
            shaders::shader_dir,
            svp::svp_status,
            svp::svp_launch,
            svp::svp_ensure_running,
            svp::svp_apply,
            settings_store::settings_read,
            settings_store::settings_write,
            settings_store::secrets_read,
            settings_store::secrets_write,
            media_server::media_server_request,
            proc_mem::harbor_process_memory,
            diagnostics::diagnostics_collect,
            diagnostics::diagnostics_cleanup,
            trailer::fetch_trailer,
            trailer::resolve_youtube_stream,
            #[cfg(feature = "music")]
            music::music_health,
            #[cfg(feature = "music")]
            music::music_source_candidates,
            #[cfg(feature = "music")]
            music::music_spotify_status,
            #[cfg(feature = "music")]
            music::music_spotify_connect,
            #[cfg(feature = "music")]
            music::music_spotify_device_start,
            #[cfg(feature = "music")]
            music::music_spotify_device_poll,
            #[cfg(feature = "music")]
            music::music_spotify_device_cancel,
            #[cfg(feature = "music")]
            music::music_spotify_browse_connect,
            #[cfg(feature = "music")]
            music::music_spotify_disconnect,
            #[cfg(feature = "music")]
            music::music_spotify_devices,
            #[cfg(feature = "music")]
            music::music_spotify_set_device,
            #[cfg(feature = "music")]
            music::music_spotify_device,
            #[cfg(feature = "music")]
            music::music_spotify_library_page,
            #[cfg(feature = "music")]
            music::music_spotify_create_playlist,
            #[cfg(feature = "music")]
            music::music_spotify_add_to_playlist,
            #[cfg(feature = "music")]
            music::music_spotify_remove_from_playlist,
            #[cfg(feature = "music")]
            music::music_spotify_rename_playlist,
            #[cfg(feature = "music")]
            music::music_spotify_set_playlist_cover,
            #[cfg(feature = "music")]
            music::music_lastfm_auth,
            #[cfg(feature = "music")]
            music::music_lastfm_complete_auth,
            #[cfg(feature = "music")]
            music::music_lastfm_status,
            #[cfg(feature = "music")]
            music::run_connector_worker,
            #[cfg(feature = "music")]
            music::music_search,
            #[cfg(feature = "music")]
            music::music_resolve_stream,
            #[cfg(feature = "music")]
            music::music_db_init,
            #[cfg(feature = "music")]
            music::music_track_upsert,
            #[cfg(feature = "music")]
            music::music_track_get,
            #[cfg(feature = "music")]
            music::music_resolve_cached,
            #[cfg(feature = "music")]
            music::music_get_liked,
            #[cfg(feature = "music")]
            music::music_set_liked,
            #[cfg(feature = "music")]
            music::music_get_recents,
            #[cfg(feature = "music")]
            music::music_add_recent,
            #[cfg(feature = "music")]
            music::music_get_queue,
            #[cfg(feature = "music")]
            music::music_set_queue,
            #[cfg(feature = "music")]
            music::music_list_albums,
            #[cfg(feature = "music")]
            music::music_list_artists,
            #[cfg(feature = "music")]
            music::music_list_playlists,
            #[cfg(feature = "music")]
            music::music_create_playlist,
            #[cfg(feature = "music")]
            music::music_add_to_playlist,
            #[cfg(feature = "music")]
            music::music_add_tracks_to_playlist,
            #[cfg(feature = "music")]
            music::music_rename_playlist,
            #[cfg(feature = "music")]
            music::music_delete_playlist,
            #[cfg(feature = "music")]
            music::music_reorder_playlist,
            #[cfg(feature = "music")]
            music::music_remove_from_playlist,
            #[cfg(feature = "music")]
            music::music_import_m3u,
            #[cfg(feature = "music")]
            music::music_export_m3u,
            #[cfg(feature = "music")]
            music::music_play_track,
            #[cfg(feature = "music")]
            music::music_spotify_preload,
            #[cfg(feature = "music")]
            music::music_engine_pause,
            #[cfg(feature = "music")]
            music::music_paused_for_video,
            #[cfg(feature = "music")]
            music::music_resume_after_video,
            #[cfg(feature = "music")]
            music::music_engine_seek,
            #[cfg(feature = "music")]
            music::music_deck_loop,
            #[cfg(feature = "music")]
            music::music_deck_scratch,
            #[cfg(feature = "music")]
            music::music_prewarm_track,
            #[cfg(feature = "music")]
            music::music_scratch_window,
            #[cfg(feature = "music")]
            music::music_scratch_hold,
            #[cfg(feature = "music")]
            music::music_cable_status,
            #[cfg(feature = "music")]
            music::music_cable_create,
            #[cfg(feature = "music")]
            music::music_cable_destroy,
            #[cfg(feature = "music")]
            music::music_deck_play,
            #[cfg(feature = "music")]
            music::music_deck_pause,
            #[cfg(feature = "music")]
            music::music_deck_seek,
            #[cfg(feature = "music")]
            music::music_deck_volume,
            #[cfg(feature = "music")]
            music::music_deck_stop,
            #[cfg(feature = "music")]
            music::music_deck_states,
            #[cfg(feature = "music")]
            music::music_deck_primary,
            #[cfg(feature = "music")]
            music::music_deck_crossfade,
            #[cfg(feature = "music")]
            music::music_deck_crossfade_get,
            #[cfg(feature = "music")]
            music::music_fx_set,
            #[cfg(feature = "music")]
            music::music_fx_clear,
            #[cfg(feature = "music")]
            music::music_fx_get,
            #[cfg(feature = "music")]
            music::music_engine_set_volume,
            #[cfg(feature = "music")]
            music::music_audio_devices,
            #[cfg(feature = "music")]
            music::music_audio_settings_get,
            #[cfg(feature = "music")]
            music::music_audio_meter_set_enabled,
            #[cfg(feature = "music")]
            music::music_audio_meter_snapshot,
            #[cfg(feature = "music")]
            music::music_audio_settings_set,
            #[cfg(feature = "music")]
            music::music_export_filtered,
            #[cfg(feature = "music")]
            music::music_broadcast_targets,
            #[cfg(feature = "music")]
            music::music_broadcast_start,
            #[cfg(feature = "music")]
            music::music_broadcast_stop,
            #[cfg(feature = "music")]
            music::music_broadcast_status,
            #[cfg(feature = "music")]
            dj_deck::dj_deck_open,
            #[cfg(feature = "music")]
            dj_deck::dj_deck_close,
            #[cfg(feature = "music")]
            music::music_engine_stop,
            #[cfg(feature = "music")]
            music::music_engine_state,
            #[cfg(feature = "music")]
            music::music_home_rows,
            #[cfg(feature = "music")]
            music::music_browse_connector,
            #[cfg(feature = "music")]
            music::music_album_tracks,
            #[cfg(feature = "music")]
            music::music_artist_top,
            #[cfg(feature = "music")]
            music::music_artist_catalog,
            #[cfg(feature = "music")]
            music::music_artist_rows,
            #[cfg(feature = "music")]
            music::music_catalog_playlist_tracks,
            #[cfg(feature = "music")]
            music::music_station_tracks,
            #[cfg(feature = "music")]
            music::music_search_typed,
            #[cfg(feature = "music")]
            music::music_video_stream,
            #[cfg(feature = "music")]
            music::music_search_videos,
            #[cfg(feature = "music")]
            music::music_search_video_page,
            #[cfg(feature = "music")]
            music::music_connections,
            #[cfg(feature = "music")]
            music::music_connect,
            #[cfg(feature = "music")]
            music::music_disconnect,
            #[cfg(feature = "music")]
            music::music_local_scan,
            #[cfg(feature = "music")]
            music::music_local_collection,
            temp_prune::temp_usage_bytes,
            temp_prune::temp_clear,
            download::download_start,
            download::download_cancel,
            download_files::download_file_info,
            download_files::download_delete_file,
            download_files::harbor_download_dir,
            stream_proxy::proxy_register,
            streams::resolve_playback_redirect,
            stream_proxy::proxy_unregister,
            stream_proxy::proxy_gc_idle,
            cf_relay::cf_list_accounts,
            cf_relay::cf_deploy_relay,
            cf_relay::cf_delete_relay,
            cf_relay::cf_relay_status,
            mpv::mpv_probe,
            mpv::mpv_start,
            external_player::external_player_start,
            external_player::external_player_command,
            external_player::external_player_stop,
            mpv::mpv_command,
            mpv::mpv_set_property,
            mpv::mpv_get_property,
            mpv::mpv_get_property_list,
            mpv::mpv_vo_passes,
            mpv::mpv_audio_devices,
            mpv::mpv_set_geometry,
            mpv::mpv_force_below,
            mpv::mpv_export_log,
            mpv::mpv_set_hdr_stage,
            mpv::display_hdr_active,
            webview_helpers::webview_reapply_transparency,
            mpv::mpv_on_pip_changed,
            mpv::mpv_screenshot_data_url,
            mpv::mpv_save_screenshot,
            mpv::mpv_gif_start,
            mpv::mpv_gif_stop,
            mpv::mpv_gif_abort,
            mpv::mpv_clip_save,
            captions::captions_open,
            captions::captions_close,
            captions::captions_push,
            captions::captions_window_is_open,
            captions::captions_request_state,
            modal_overlay::modal_overlay_open,
            modal_overlay::modal_overlay_close,
            modal_overlay::modal_overlay_emit_result,
            modal_overlay::modal_overlay_emit_state,
            modal_overlay::modal_overlay_emit_action,
            modal_overlay::modal_overlay_sync,
            modal_overlay::modal_overlay_get_pending,
            hdr_overlay::hdr_overlay_open,
            hdr_overlay::hdr_overlay_show,
            hdr_overlay::hdr_overlay_close,
            hdr_overlay::hdr_overlay_hide,
            hdr_overlay::hdr_overlay_sync,
            hdr_overlay::hdr_overlay_emit_props,
            hdr_overlay::hdr_overlay_emit_action,
            mpv::mpv_sub_add,
            mpv::mpv_sub_remove,
            mpv::sub_download,
            mpv::mpv_stop,
            mpv::mpv_release_media,
            mpv::mpv_restore_media_surface,
            pip::pip_open,
            pip::pip_get_session,
            pip::pip_close,
            pip::pip_publish_state,
            pip::window_pip_enter,
            pip::window_pip_exit,
            pip_window::pip_window_enter,
            pip_window::pip_window_exit,
            pip_window::pip_window_restore,
            pip_window::pip_window_fit,
            pip_window::pip_window_active,
            fullscreen::window_fullscreen_enter,
            fullscreen::window_fullscreen_exit,
            browser::browser_open,
            browser::browser_close,
            #[cfg(feature = "music")]
            ytmusic::ytmusic_open,
            #[cfg(feature = "music")]
            ytmusic::ytmusic_close,
            #[cfg(feature = "music")]
            ytmusic::ytmusic_is_open,
            #[cfg(windows)]
            #[cfg(feature = "music")]
            ytmusic::ytmusic_embed,
            #[cfg(windows)]
            #[cfg(feature = "music")]
            ytmusic::ytmusic_set_geometry,
            #[cfg(windows)]
            #[cfg(feature = "music")]
            ytmusic::ytmusic_unembed,
            #[cfg(windows)]
            #[cfg(feature = "music")]
            ytmusic::ytmusic_set_visible,
            thumbs::thumbs_set_url,
            thumbs::thumbs_spawn_eager,
            thumbs::thumbs_get,
            thumbs::thumbs_stop,
            dvr::dvr_start,
            dvr::dvr_stop,
            dvr::dvr_list,
            dvr::dvr_default_dir,
            dvr::dvr_reveal,
            multiview::multiview_open,
            multiview::multiview_prespawn,
            multiview::multiview_geometry,
            multiview::multiview_audio_focus,
            multiview::multiview_close,
            multiview::multiview_visibility,
            multiview::multiview_stop_all,
            http_fetch::harbor_fetch,
            http_fetch::harbor_upload,
            http_fetch::clear_thumb_cache,
            http_fetch::thumb_cache_size,
            http_fetch::cached_thumb_path,
            subtitle_credentials::subtitle_credential_bind,
            subtitle_credentials::subtitle_credentials_clear,
            cf_solver::cf_report,
            discord_rp::discord_set_presence,
            discord_rp::discord_clear,
            media_controls::media_controls_update,
            media_controls::media_controls_music_state,
            media_controls::media_controls_music_art,
            media_controls::media_controls_seeked,
            media_controls::media_controls_clear,
            gamepad::gamepad_list,
            gamepad::gamepad_set_enabled,
            gamepad::gamepad_set_background_input,
            discord_rp::discord_set_enabled,
            cast::cast_discover,
            harbor_lan::harbor_lan_identity,
            harbor_lan::harbor_lan_advertise,
            harbor_lan::harbor_lan_stop_advertise,
            harbor_lan::harbor_lan_discover,
            dlna::lan_ip,
            cast::cast_load,
            cast::cast_play,
            cast::cast_pause,
            cast::cast_seek,
            cast::cast_stop,
            cast::cast_status,
            cast_server::cast_server_status,
            cast_server::cast_server_restart,
            torrent_engine::torrent_engine_status,
            torrent_engine::torrent_engine_set_enabled,
            torrent_engine::torrent_engine_add,
            torrent_engine::torrent_engine_select,
            torrent_engine::torrent_engine_select_set,
            torrent_engine::torrent_engine_stats,
            torrent_engine::torrent_engine_list,
            torrent_engine::torrent_engine_pause,
            torrent_engine::torrent_engine_resume,
            torrent_engine::torrent_engine_remove,
            torrent_engine::torrent_engine_selftest,
            torrent_engine::torrent_engine_restart,
            torrent_engine::torrent_engine_hard_reset,
            torrent_engine::torrent_engine_set_options,
            transcode::cast_ffmpeg_present,
            streams::streams_run_pipeline,
            streams::streams_parse,
            streams::streams_core_version,
            local_lib::harbor_scan_folder,
            tray::tray_set_prefs,
            tray::tray_set_custom_themes,
            #[cfg(windows)]
            tray_popup::tray_popup_publish,
            #[cfg(windows)]
            tray_popup::tray_popup_snapshot,
            #[cfg(windows)]
            tray_popup::tray_popup_present,
            #[cfg(windows)]
            tray_popup::tray_popup_dismiss,
            #[cfg(windows)]
            tray_popup::tray_popup_submenu,
            #[cfg(windows)]
            tray_popup::tray_popup_action,
            stremio_auth::stremio_auth_start,
            song_id::recognize_now_playing,
            song_id::recognize_now_playing_ai,
            app_icon::set_app_icon,
            deeplink_set_stremio,
            deeplink_is_stremio_registered,
            harbor_take_pending_file,
        ]))
        .build(context)
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            if matches!(event, tauri::RunEvent::Exit) {
                shutdown_services(app_handle);
            }
        });
}
