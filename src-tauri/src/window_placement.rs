//! Windows main-window placement. The generic window-state plugin does not validate
//! saved bounds against the current taskbar/work area and also observes temporary
//! fullscreen and borderless resize events. Keep normal geometry separately.
#![cfg(windows)]

use serde::{Deserialize, Serialize};
use std::{
    path::PathBuf,
    sync::{Mutex, OnceLock},
    time::{Duration, Instant},
};
use tauri::{Manager, PhysicalPosition, PhysicalSize, WebviewWindow, WindowEvent};

const DEBOUNCE: Duration = Duration::from_millis(550);
const TRANSITION_GRACE: Duration = Duration::from_millis(2500);
const DEFAULT_W: f64 = 1280.0;
const DEFAULT_H: f64 = 800.0;

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq)]
struct Geometry {
    x: i32,
    y: i32,
    width: u32, // inner physical pixels
    height: u32,
    maximized: bool,
    // Only set following a native, user-initiated drag/resize. A matching work
    // area is required on restore so disconnected/rearranged monitors recover.
    #[serde(default)]
    intentional_partial_area: Option<WorkRect>,
    // A maximized window has a separate display target: its last normal
    // position can be on another monitor (e.g. after Win+Shift+Arrow).
    #[serde(default)]
    maximized_monitor: Option<WorkRect>,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq)]
struct WorkRect {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    scale_milli: u32,
}

struct Memory {
    path: PathBuf,
    geometry: Option<Geometry>,
    revision: u64,
    suspended_until: Instant,
    borderless_active: bool,
    user_placement_pending: bool,
    user_placement_deadline: Option<Instant>,
}

static MEMORY: OnceLock<Mutex<Memory>> = OnceLock::new();

#[derive(Clone, Copy, Debug)]
struct WorkArea {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    scale: f64,
    primary: bool,
}

impl WorkArea {
    fn right(self) -> i64 {
        i64::from(self.x) + i64::from(self.width)
    }
    fn bottom(self) -> i64 {
        i64::from(self.y) + i64::from(self.height)
    }
    fn rect(self) -> WorkRect {
        WorkRect {
            x: self.x,
            y: self.y,
            width: self.width,
            height: self.height,
            scale_milli: (self.scale * 1000.0).round() as u32,
        }
    }
}

fn overlap(x: i32, y: i32, width: u32, height: u32, area: WorkArea) -> i64 {
    let left = i64::from(x).max(i64::from(area.x));
    let top = i64::from(y).max(i64::from(area.y));
    let right = (i64::from(x) + i64::from(width)).min(area.right());
    let bottom = (i64::from(y) + i64::from(height)).min(area.bottom());
    (right - left).max(0) * (bottom - top).max(0)
}

fn pick_area(areas: &[WorkArea], geometry: Option<Geometry>) -> Option<WorkArea> {
    let primary = areas
        .iter()
        .find(|area| area.primary)
        .copied()
        .or_else(|| areas.first().copied())?;
    let Some(geo) = geometry else {
        return Some(primary);
    };
    let best = areas
        .iter()
        .copied()
        .max_by_key(|area| overlap(geo.x, geo.y, geo.width, geo.height, *area))?;
    if overlap(geo.x, geo.y, geo.width, geo.height, best) == 0 {
        Some(primary)
    } else {
        Some(best)
    }
}

fn legacy_maximized_monitor(areas: &[WorkArea], x: i32, y: i32) -> Option<WorkArea> {
    // Win32 places the maximized outer frame a few pixels outside the work
    // area. Sample an inset point to identify the display reliably.
    let px = i64::from(x) + 64;
    let py = i64::from(y) + 64;
    areas.iter().copied().find(|area| {
        px >= i64::from(area.x)
            && px < area.right()
            && py >= i64::from(area.y)
            && py < area.bottom()
    })
}

fn active_monitor_area(window: &WebviewWindow) -> Option<WorkArea> {
    let areas = work_areas(window);
    let position = window.outer_position().ok()?;
    let size = window.outer_size().ok()?;
    areas
        .into_iter()
        .max_by_key(|area| overlap(position.x, position.y, size.width, size.height, *area))
}

fn restored_area(
    areas: &[WorkArea],
    saved: Option<Geometry>,
    frame: (u32, u32),
) -> Option<WorkArea> {
    saved
        .filter(|geometry| geometry.maximized)
        .and_then(|geometry| geometry.maximized_monitor)
        .and_then(|rect| areas.iter().copied().find(|area| area.rect() == rect))
        .or_else(|| saved.and_then(|geometry| intentional_area(geometry, areas, frame)))
        .or_else(|| pick_area(areas, saved))
}

fn normal_bounds_for_maximized_target(
    saved: Option<Geometry>,
    area: WorkArea,
    areas: &[WorkArea],
) -> Option<Geometry> {
    let mut geometry = saved?;
    if geometry.maximized
        && geometry.maximized_monitor == Some(area.rect())
        && pick_area(areas, Some(geometry)).is_some_and(|normal| normal.rect() != area.rect())
    {
        // The window was maximized on a different display from the one that
        // owns its previous normal bounds. Seed the new monitor with a normal
        // position there, so the OS maximizes (and later restores) on it.
        geometry.x = (i64::from(area.x)
            + (i64::from(area.width) - i64::from(geometry.width)).max(0) / 2)
            as i32;
        geometry.y = (i64::from(area.y)
            + (i64::from(area.height) - i64::from(geometry.height)).max(0) / 2)
            as i32;
        geometry.intentional_partial_area = None;
    }
    Some(geometry)
}

fn work_areas(window: &WebviewWindow) -> Vec<WorkArea> {
    use windows::Win32::Foundation::POINT;
    use windows::Win32::Graphics::Gdi::{
        GetMonitorInfoW, MonitorFromPoint, MONITORINFO, MONITOR_DEFAULTTONEAREST,
    };
    let Ok(monitors) = window.available_monitors() else {
        return Vec::new();
    };
    let primary_pos = window
        .primary_monitor()
        .ok()
        .flatten()
        .map(|m| *m.position());
    monitors
        .into_iter()
        .filter_map(|monitor| {
            let origin = monitor.position();
            let size = monitor.size();
            let scale = monitor.scale_factor();
            if !scale.is_finite() || scale <= 0.0 || size.width == 0 || size.height == 0 {
                return None;
            }
            let point = POINT {
                x: origin.x.saturating_add((size.width / 2) as i32),
                y: origin.y.saturating_add((size.height / 2) as i32),
            };
            let handle = unsafe { MonitorFromPoint(point, MONITOR_DEFAULTTONEAREST) };
            let mut info = MONITORINFO {
                cbSize: std::mem::size_of::<MONITORINFO>() as u32,
                ..Default::default()
            };
            if !unsafe { GetMonitorInfoW(handle, &mut info) }.as_bool() {
                return None;
            }
            let work = info.rcWork;
            let width = (work.right - work.left).max(0) as u32;
            let height = (work.bottom - work.top).max(0) as u32;
            (width > 0 && height > 0).then_some(WorkArea {
                x: work.left,
                y: work.top,
                width,
                height,
                scale,
                primary: Some(*origin) == primary_pos,
            })
        })
        .collect()
}

/// Very large sizes are usually corrupted Win32 unsigned dimensions (e.g.
/// 65507x57116), not intentional user window placements.
fn sane_dimensions(geometry: Geometry, areas: &[WorkArea]) -> bool {
    let max_w = areas.iter().map(|a| a.width).max().unwrap_or(0);
    let max_h = areas.iter().map(|a| a.height).max().unwrap_or(0);
    geometry.width >= 200
        && geometry.height >= 200
        && geometry.width <= max_w.saturating_mul(2).max(640)
        && geometry.height <= max_h.saturating_mul(2).max(480)
}

fn clamp(value: i64, start: i64, end: i64) -> i32 {
    value.clamp(start, end.max(start)) as i32
}

fn clamp_geometry(
    geometry: Option<Geometry>,
    area: WorkArea,
    frame_width: u32,
    frame_height: u32,
) -> Geometry {
    // Physical frame offsets matter even for an undecorated Windows window.
    let max_w = area.width.saturating_sub(frame_width).max(1);
    let max_h = area.height.saturating_sub(frame_height).max(1);
    let default_w = (DEFAULT_W * area.scale).round() as u32;
    let default_h = (DEFAULT_H * area.scale).round() as u32;
    let inner_w = geometry.map_or(default_w, |geo| geo.width).clamp(1, max_w);
    let inner_h = geometry.map_or(default_h, |geo| geo.height).clamp(1, max_h);
    let outer_w = i64::from(inner_w) + i64::from(frame_width);
    let outer_h = i64::from(inner_h) + i64::from(frame_height);
    let (x, y) = if let Some(saved) = geometry {
        (
            clamp(
                i64::from(saved.x),
                i64::from(area.x),
                area.right() - outer_w,
            ),
            clamp(
                i64::from(saved.y),
                i64::from(area.y),
                area.bottom() - outer_h,
            ),
        )
    } else {
        (
            (i64::from(area.x) + (i64::from(area.width) - outer_w) / 2) as i32,
            (i64::from(area.y) + (i64::from(area.height) - outer_h) / 2) as i32,
        )
    };
    Geometry {
        x,
        y,
        width: inner_w,
        height: inner_h,
        maximized: geometry.is_some_and(|g| g.maximized),
        intentional_partial_area: None,
        maximized_monitor: None,
    }
}

/// A reachable titlebar is the safety boundary for intentional off-screen
/// placement. The user may put part of the body beneath the taskbar or beyond
/// an edge, but must keep a usable drag strip on the selected display.
fn reachable_partial(geometry: Geometry, area: WorkArea, frame: (u32, u32)) -> bool {
    let outer_w = i64::from(geometry.width) + i64::from(frame.0);
    let visible_left = i64::from(geometry.x).max(i64::from(area.x));
    let visible_right = (i64::from(geometry.x) + outer_w).min(area.right());
    let visible_width = (visible_right - visible_left).max(0);
    let title_top = i64::from(geometry.y);
    let title_bottom = title_top + 48;
    let title_visible = (title_bottom.min(area.bottom()) - title_top.max(i64::from(area.y))).max(0);
    visible_width >= 240.min(outer_w) && title_visible >= 40
}

fn intentional_area(geometry: Geometry, areas: &[WorkArea], frame: (u32, u32)) -> Option<WorkArea> {
    let rect = geometry.intentional_partial_area?;
    areas
        .iter()
        .copied()
        .find(|area| area.rect() == rect && reachable_partial(geometry, *area, frame))
}

fn entirely_in_work_area(geometry: Geometry, area: WorkArea, frame: (u32, u32)) -> bool {
    i64::from(geometry.x) >= i64::from(area.x)
        && i64::from(geometry.y) >= i64::from(area.y)
        && i64::from(geometry.x) + i64::from(geometry.width) + i64::from(frame.0) <= area.right()
        && i64::from(geometry.y) + i64::from(geometry.height) + i64::from(frame.1) <= area.bottom()
}

fn frame_insets(window: &WebviewWindow) -> (u32, u32) {
    match (window.outer_size(), window.inner_size()) {
        (Ok(outer), Ok(inner)) => (
            outer.width.saturating_sub(inner.width),
            outer.height.saturating_sub(inner.height),
        ),
        _ => (0, 0),
    }
}

fn relax_minimum(window: &WebviewWindow, area: WorkArea, frame: (u32, u32)) {
    let max_w = area.width.saturating_sub(frame.0) as f64 / area.scale;
    let max_h = area.height.saturating_sub(frame.1) as f64 / area.scale;
    if max_w > 0.0 && max_h > 0.0 {
        let _ = window.set_min_size(Some(tauri::LogicalSize::new(
            960.0_f64.min(max_w),
            600.0_f64.min(max_h),
        )));
    }
}

fn apply_geometry(window: &WebviewWindow, saved: Option<Geometry>, area: WorkArea) -> Geometry {
    if window.is_maximized().unwrap_or(false) {
        let _ = window.unmaximize();
    }
    let frame = frame_insets(window);
    relax_minimum(window, area, frame);
    let keep_partial = saved.is_some_and(|geo| {
        geo.intentional_partial_area == Some(area.rect()) && reachable_partial(geo, area, frame)
    });
    let target = if keep_partial {
        saved.unwrap()
    } else {
        clamp_geometry(saved, area, frame.0, frame.1)
    };
    let _ = window.set_size(PhysicalSize::new(target.width, target.height));
    // Query again after a resize; Windows might enforce a new frame or min size.
    let actual = window.outer_size().ok();
    let outer_w = actual.map_or(target.width + frame.0, |s| s.width);
    let outer_h = actual.map_or(target.height + frame.1, |s| s.height);
    let x = if keep_partial {
        target.x
    } else {
        clamp(
            i64::from(target.x),
            i64::from(area.x),
            area.right() - i64::from(outer_w),
        )
    };
    let y = if keep_partial {
        target.y
    } else {
        clamp(
            i64::from(target.y),
            i64::from(area.y),
            area.bottom() - i64::from(outer_h),
        )
    };
    let _ = window.set_position(PhysicalPosition::new(x, y));
    Geometry { x, y, ..target }
}

fn load_saved(path: &PathBuf) -> Option<Geometry> {
    let bytes = std::fs::read(path).ok()?;
    serde_json::from_slice(&bytes).ok()
}

fn migrate_plugin_state(app: &tauri::AppHandle) -> Option<Geometry> {
    // Only installed builds import the old shared file; dev builds must never
    // overwrite/borrow the installed app's window position.
    if cfg!(debug_assertions) {
        return None;
    }
    let path = app.path().app_config_dir().ok()?.join(".window-state.json");
    let data: serde_json::Value = serde_json::from_slice(&std::fs::read(path).ok()?).ok()?;
    let state = data.get("main")?;
    let n = |key: &str| -> Option<i64> { state.get(key)?.as_i64() };
    let maximized = state
        .get("maximized")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    // The old plugin stores the maximized screen origin in x/y and the last
    // normal placement in prev_x/prev_y. Only use the latter when maximized.
    let x = if maximized {
        n("prev_x").or_else(|| n("x"))?
    } else {
        n("x")?
    };
    let y = if maximized {
        n("prev_y").or_else(|| n("y"))?
    } else {
        n("y")?
    };
    let maximized_monitor = if maximized {
        let maximized_x = i32::try_from(n("x")?).ok()?;
        let maximized_y = i32::try_from(n("y")?).ok()?;
        app.get_webview_window("main").and_then(|window| {
            let areas = work_areas(&window);
            legacy_maximized_monitor(&areas, maximized_x, maximized_y).map(|area| area.rect())
        })
    } else {
        None
    };
    Some(Geometry {
        x: i32::try_from(x).ok()?,
        y: i32::try_from(y).ok()?,
        width: u32::try_from(n("width")?).ok()?,
        height: u32::try_from(n("height")?).ok()?,
        maximized,
        intentional_partial_area: None,
        maximized_monitor,
    })
}

fn persist(path: &PathBuf, value: Geometry) {
    let Some(parent) = path.parent() else { return };
    if let Err(err) = std::fs::create_dir_all(parent) {
        eprintln!("[harbor::window] cannot create window state directory: {err}");
        return;
    }
    let temp = path.with_extension("json.tmp");
    let bytes = match serde_json::to_vec_pretty(&value) {
        Ok(bytes) => bytes,
        Err(_) => return,
    };
    if let Err(err) = std::fs::write(&temp, bytes).and_then(|_| std::fs::rename(&temp, path)) {
        eprintln!("[harbor::window] cannot persist main-window placement: {err}");
    }
}

fn write_cached() {
    let Some(lock) = MEMORY.get() else { return };
    let memory = lock.lock().unwrap();
    if let Some(value) = memory.geometry {
        persist(&memory.path, value);
    }
}

fn capture(window: &WebviewWindow, normalize: bool) {
    let Some(lock) = MEMORY.get() else { return };
    let suppressed = {
        let memory = lock.lock().unwrap();
        Instant::now() < memory.suspended_until || memory.borderless_active
    };
    if suppressed
        || window.is_fullscreen().unwrap_or(false)
        || window.is_minimized().unwrap_or(false)
    {
        return;
    }
    let maximized = window.is_maximized().unwrap_or(false);
    if maximized {
        // The normal bounds may still refer to the original display, but
        // a maximized window can be transferred to another monitor without
        // ever becoming normal (Windows Win+Shift+Arrow and Snap layouts).
        let monitor = active_monitor_area(window).map(|area| area.rect());
        let mut memory = lock.lock().unwrap();
        if let Some(ref mut geometry) = memory.geometry {
            geometry.maximized = true;
            if let Some(monitor) = monitor {
                geometry.maximized_monitor = Some(monitor);
            }
        }
        memory.user_placement_pending = false;
        memory.user_placement_deadline = None;
        drop(memory);
        write_cached();
        return;
    }
    let areas = work_areas(window);
    if areas.is_empty() {
        return;
    }
    let (Ok(pos), Ok(size)) = (window.outer_position(), window.inner_size()) else {
        return;
    };
    let mut current = Geometry {
        x: pos.x,
        y: pos.y,
        width: size.width,
        height: size.height,
        maximized: false,
        intentional_partial_area: None,
        maximized_monitor: None,
    };
    // Ignore transient fullscreen/borderless dimensions even when a taskbar is
    // set to auto-hide. The frontend explicitly pauses capture for transitions.
    if !sane_dimensions(current, &areas) {
        return;
    }
    let frame = frame_insets(window);
    let saved_partial = {
        let memory = lock.lock().unwrap();
        memory.geometry.filter(|saved| {
            saved.intentional_partial_area.is_some()
                && (saved.x, saved.y, saved.width, saved.height)
                    == (current.x, current.y, current.width, current.height)
        })
    };
    let Some(area) = saved_partial
        .and_then(|saved| intentional_area(saved, &areas, frame))
        .or_else(|| pick_area(&areas, Some(current)))
    else {
        return;
    };
    // Off-screen placement is only an opt-in from a completed native mouse
    // drag/resize. Subsequent focus events may preserve that exact placement,
    // but unrelated programmatic position changes cannot acquire the opt-in.
    let (user_moved, same_saved_partial) = {
        let memory = lock.lock().unwrap();
        let matching = memory.geometry.is_some_and(|saved| {
            saved.intentional_partial_area == Some(area.rect())
                && (saved.x, saved.y, saved.width, saved.height)
                    == (current.x, current.y, current.width, current.height)
        });
        (
            memory.user_placement_pending
                && memory
                    .user_placement_deadline
                    .is_some_and(|deadline| Instant::now() <= deadline),
            matching,
        )
    };
    let partial = !entirely_in_work_area(current, area, frame);
    let keep_partial =
        partial && reachable_partial(current, area, frame) && (user_moved || same_saved_partial);
    if keep_partial {
        current.intentional_partial_area = Some(area.rect());
    }
    let normalized = if keep_partial {
        current
    } else {
        clamp_geometry(Some(current), area, frame.0, frame.1)
    };
    let next = if normalize && normalized != current {
        apply_geometry(window, Some(normalized), area)
    } else {
        // Never persist accidental clipped/oversized transient states.
        if normalized != current {
            return;
        }
        current
    };
    let mut memory = lock.lock().unwrap();
    memory.geometry = Some(next);
    memory.user_placement_pending = false;
    memory.user_placement_deadline = None;
    drop(memory);
    write_cached();
}

fn schedule(window: WebviewWindow) {
    let Some(lock) = MEMORY.get() else { return };
    let revision = {
        let mut memory = lock.lock().unwrap();
        memory.revision = memory.revision.wrapping_add(1);
        memory.revision
    };
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(DEBOUNCE).await;
            let Some(lock) = MEMORY.get() else { return };
            let ready = {
                let memory = lock.lock().unwrap();
                memory.revision == revision && Instant::now() >= memory.suspended_until
            };
            if !ready {
                let still_latest = lock.lock().unwrap().revision == revision;
                if !still_latest {
                    return;
                }
                continue;
            }
            // Keep interactive dragging smooth: only snap/normalize after
            // WM_EXITSIZEMOVE, never while the user is holding the window.
            if crate::MAIN_IN_SIZE_MOVE.load(std::sync::atomic::Ordering::Relaxed) {
                continue;
            }
            capture(&window, true);
            return;
        }
    });
}

// Called only by the native WM_EXITSIZEMOVE path, never by app-driven moves.
pub fn mark_user_placement_complete() {
    if let Some(memory) = MEMORY.get() {
        let mut memory = memory.lock().unwrap();
        memory.user_placement_pending = true;
        // Without a resize/move event to consume the signal, it must not
        // authorize unrelated programmatic moves later in the session.
        memory.user_placement_deadline = Some(Instant::now() + Duration::from_secs(3));
    }
}

pub fn pause_for_transition(app: &tauri::AppHandle, record_before: bool) {
    if record_before {
        if let Some(window) = app.get_webview_window("main") {
            capture(&window, false);
        }
    }
    if let Some(lock) = MEMORY.get() {
        let mut memory = lock.lock().unwrap();
        memory.suspended_until = Instant::now() + TRANSITION_GRACE;
        memory.user_placement_pending = false;
        memory.user_placement_deadline = None;
    }
}

#[tauri::command]
pub fn window_geometry_pause(
    app: tauri::AppHandle,
    record_before: Option<bool>,
    borderless_active: Option<bool>,
) {
    pause_for_transition(&app, record_before.unwrap_or(false));
    if let (Some(lock), Some(active)) = (MEMORY.get(), borderless_active) {
        lock.lock().unwrap().borderless_active = active;
    }
}

pub fn install(app: &tauri::AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let Ok(config_dir) = app.path().app_config_dir() else {
        return;
    };
    let filename = if cfg!(debug_assertions) {
        ".main-window-state.dev.json"
    } else {
        ".main-window-state.json"
    };
    let path = config_dir.join(filename);
    let areas = work_areas(&window);
    let saved = load_saved(&path).or_else(|| migrate_plugin_state(app));
    let valid = saved.filter(|geometry| sane_dimensions(*geometry, &areas));
    let frame = frame_insets(&window);
    // If a user deliberately left a window partly outside a monitor, use
    // that same work area only while the display layout still matches.
    let area = restored_area(&areas, valid, frame);
    let restored = if let Some(area) = area {
        let normal_position = normal_bounds_for_maximized_target(valid, area, &areas);
        let mut result = apply_geometry(&window, normal_position, area);
        if valid.is_some_and(|geo| geo.maximized) {
            let _ = window.maximize();
            result.maximized = true;
            result.maximized_monitor = Some(area.rect());
        }
        Some(result)
    } else {
        // If the display isn't available yet, preserve existing app startup
        // behavior and avoid writing unusable geometry.
        crate::display_fit::fit_to_monitor(&window);
        None
    };
    let _ = MEMORY.set(Mutex::new(Memory {
        path,
        geometry: restored,
        revision: 0,
        suspended_until: Instant::now(),
        borderless_active: false,
        user_placement_pending: false,
        user_placement_deadline: None,
    }));
    // Persist a migrated / repaired placement without altering the old plugin
    // file; that file can still contain legacy entries for other windows.
    write_cached();
    let observed = window.clone();
    window.on_window_event(move |event| match event {
        WindowEvent::Moved(_)
        | WindowEvent::Resized(_)
        | WindowEvent::ScaleFactorChanged { .. }
        | WindowEvent::Focused(true) => schedule(observed.clone()),
        WindowEvent::CloseRequested { .. } => capture(&observed, false),
        _ => {}
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn area(x: i32, y: i32, w: u32, h: u32, primary: bool) -> WorkArea {
        WorkArea {
            x,
            y,
            width: w,
            height: h,
            scale: 1.0,
            primary,
        }
    }

    #[test]
    fn rejects_unsigned_corruption() {
        let areas = [area(0, 0, 2560, 1392, true)];
        assert!(!sane_dimensions(
            Geometry {
                x: -14,
                y: -14,
                width: 65507,
                height: 57116,
                maximized: false,
                intentional_partial_area: None,
                maximized_monitor: None,
            },
            &areas
        ));
    }

    #[test]
    fn taskbar_clipping_moves_window_inside_work_area() {
        let work = area(0, 0, 2560, 1392, true);
        let saved = Geometry {
            x: -7,
            y: 0,
            width: 1278,
            height: 1390,
            maximized: false,
            intentional_partial_area: None,
            maximized_monitor: None,
        };
        let fixed = clamp_geometry(Some(saved), work, 16, 16);
        assert_eq!(fixed.x, 0);
        assert_eq!(fixed.height, 1376);
        assert!(i64::from(fixed.y) + i64::from(fixed.height) + 16 <= work.bottom());
    }

    #[test]
    fn secondary_monitor_negative_coordinates_are_preserved() {
        let secondary = area(-1920, 351, 1920, 1032, false);
        let primary = area(0, 0, 2560, 1392, true);
        let saved = Geometry {
            x: -1550,
            y: 400,
            width: 1100,
            height: 800,
            maximized: false,
            intentional_partial_area: None,
            maximized_monitor: None,
        };
        let chosen = pick_area(&[primary, secondary], Some(saved)).unwrap();
        assert_eq!(chosen.x, -1920);
        let fixed = clamp_geometry(Some(saved), chosen, 16, 16);
        assert_eq!((fixed.x, fixed.y), (-1550, 400));
    }

    #[test]
    fn missing_monitor_falls_back_to_primary() {
        let primary = area(0, 0, 2560, 1392, true);
        let saved = Geometry {
            x: 3800,
            y: -1700,
            width: 1200,
            height: 750,
            maximized: false,
            intentional_partial_area: None,
            maximized_monitor: None,
        };
        let chosen = pick_area(&[primary], Some(saved)).unwrap();
        let fixed = clamp_geometry(Some(saved), chosen, 16, 16);
        assert_eq!(chosen.x, 0);
        assert_eq!(fixed.x, 1344);
        assert_eq!(fixed.y, 0);
    }

    #[test]
    fn maximized_flag_survives_normal_placement_sanitization() {
        let work = area(0, 0, 2560, 1392, true);
        let saved = Geometry {
            x: 200,
            y: 250,
            width: 1200,
            height: 800,
            maximized: true,
            intentional_partial_area: None,
            maximized_monitor: None,
        };
        let fixed = clamp_geometry(Some(saved), work, 16, 16);
        assert!(fixed.maximized);
        assert_eq!((fixed.x, fixed.y), (200, 250));
    }

    #[test]
    fn intentional_partial_position_keeps_reachable_titlebar() {
        let work = area(0, 0, 1920, 1032, true);
        let geometry = Geometry {
            x: -600,
            y: 200,
            width: 1100,
            height: 800,
            maximized: false,
            intentional_partial_area: Some(work.rect()),
            maximized_monitor: None,
        };
        assert!(reachable_partial(geometry, work, (16, 16)));
        assert!(intentional_area(geometry, &[work], (16, 16)).is_some());
        // Legacy and accidental placements still take the strict recovery path.
        assert_eq!(clamp_geometry(Some(geometry), work, 16, 16).x, 0);
        assert!(intentional_area(
            Geometry {
                intentional_partial_area: None,
                ..geometry
            },
            &[work],
            (16, 16)
        )
        .is_none());
    }

    #[test]
    fn unreachable_titlebar_is_not_preserved_even_when_user_placed() {
        let work = area(0, 0, 1920, 1032, true);
        let template = Geometry {
            x: 1740,
            y: 100,
            width: 1100,
            height: 800,
            maximized: false,
            intentional_partial_area: Some(work.rect()),
            maximized_monitor: None,
        };
        assert!(!reachable_partial(template, work, (16, 16)));
        assert!(intentional_area(template, &[work], (16, 16)).is_none());
        assert!(!reachable_partial(
            Geometry {
                x: -200,
                y: -30,
                ..template
            },
            work,
            (16, 16)
        ));
        assert!(!reachable_partial(
            Geometry {
                x: -200,
                y: 1000,
                ..template
            },
            work,
            (16, 16)
        ));
    }

    #[test]
    fn changed_display_layout_invalidates_intentional_partial_placement() {
        let work = area(0, 0, 1920, 1032, true);
        let geometry = Geometry {
            x: -400,
            y: 100,
            width: 1200,
            height: 700,
            maximized: false,
            intentional_partial_area: Some(work.rect()),
            maximized_monitor: None,
        };
        assert!(intentional_area(geometry, &[work], (16, 16)).is_some());
        let changed_taskbar = area(0, 0, 1920, 984, true);
        assert!(intentional_area(geometry, &[changed_taskbar], (16, 16)).is_none());
        let mut changed_scale = work;
        changed_scale.scale = 1.25;
        assert!(intentional_area(geometry, &[changed_scale], (16, 16)).is_none());
    }

    #[test]
    fn older_saved_files_default_to_no_partial_offscreen_permission() {
        let old = r#"{"x":-500,"y":200,"width":1200,"height":700,"maximized":false}"#;
        let parsed: Geometry = serde_json::from_str(old).unwrap();
        assert_eq!(parsed.intentional_partial_area, None);
        assert_eq!(parsed.maximized_monitor, None);
    }

    #[test]
    fn maximized_window_remembers_secondary_monitor_independently_of_normal_bounds() {
        let primary = area(0, 0, 2560, 1392, true);
        let secondary = area(-1920, 351, 1920, 1032, false);
        let monitors = [primary, secondary];
        // Last normal bounds were on the primary, but Windows moved the
        // maximized window to the other monitor without restoring it.
        let saved = Geometry {
            x: 640,
            y: 296,
            width: 1280,
            height: 890,
            maximized: true,
            intentional_partial_area: None,
            maximized_monitor: Some(secondary.rect()),
        };
        let target = restored_area(&monitors, Some(saved), (16, 16)).unwrap();
        assert_eq!(target.rect(), secondary.rect());
        let prepared = normal_bounds_for_maximized_target(Some(saved), target, &monitors).unwrap();
        assert_eq!(prepared.x, -1600);
        assert_eq!(prepared.y, 422);
        assert!(entirely_in_work_area(prepared, secondary, (16, 16)));
    }

    #[test]
    fn old_plugin_maximized_coordinates_identify_secondary_monitor() {
        let primary = area(0, 0, 2560, 1392, true);
        let secondary = area(-1920, 351, 1920, 1032, false);
        let monitors = [primary, secondary];
        assert_eq!(
            legacy_maximized_monitor(&monitors, -1928, 343)
                .unwrap()
                .rect(),
            secondary.rect()
        );
        assert_eq!(
            legacy_maximized_monitor(&monitors, -8, -8).unwrap().rect(),
            primary.rect()
        );
    }

    #[test]
    fn nonmaximized_secondary_position_stays_on_secondary() {
        let primary = area(0, 0, 2560, 1392, true);
        let secondary = area(-1920, 351, 1920, 1032, false);
        let monitors = [primary, secondary];
        let saved = Geometry {
            x: -1620,
            y: 440,
            width: 1050,
            height: 760,
            maximized: false,
            intentional_partial_area: None,
            maximized_monitor: None,
        };
        let target = restored_area(&monitors, Some(saved), (16, 16)).unwrap();
        assert_eq!(target.rect(), secondary.rect());
        let prepared = normal_bounds_for_maximized_target(Some(saved), target, &monitors).unwrap();
        assert_eq!(prepared.x, saved.x);
        assert_eq!(prepared.y, saved.y);
    }

    #[test]
    fn disconnected_maximized_monitor_recovers_using_saved_normal_bounds() {
        let primary = area(0, 0, 2560, 1392, true);
        let disconnected = area(-1920, 351, 1920, 1032, false);
        let saved = Geometry {
            x: 450,
            y: 100,
            width: 1100,
            height: 750,
            maximized: true,
            intentional_partial_area: None,
            maximized_monitor: Some(disconnected.rect()),
        };
        let target = restored_area(&[primary], Some(saved), (16, 16)).unwrap();
        assert_eq!(target.rect(), primary.rect());
    }
}
