use tauri::{Builder, Wry};

#[cfg(windows)]
fn lock_window_size(window: &tauri::WebviewWindow) {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetWindowLongPtrW, SetWindowLongPtrW, GWL_STYLE, WS_THICKFRAME,
    };
    let handle = match window.hwnd() {
        Ok(h) => h.0 as isize,
        Err(_) => return,
    };
    unsafe {
        let style = GetWindowLongPtrW(handle as _, GWL_STYLE);
        SetWindowLongPtrW(handle as _, GWL_STYLE, style & !(WS_THICKFRAME as isize));
    }
}

#[cfg(not(windows))]
fn lock_window_size(_window: &tauri::WebviewWindow) {}

pub fn builder() -> Builder<Wry> {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            use tauri::Manager;
            if let Some(window) = app.get_webview_window("main") {
                if let Some(monitor) = window.current_monitor()? {
                    let work = monitor.work_area();
                    let dpi = monitor.scale_factor();
                    let width = 1028.0_f64.min(f64::from(work.size.width) / dpi);
                    let height = 632.0_f64.min(f64::from(work.size.height) / dpi);
                    window.set_size(tauri::LogicalSize::new(width, height))?;
                    window.set_position(tauri::PhysicalPosition::new(
                        work.position.x + ((f64::from(work.size.width) - width * dpi) / 2.0).round() as i32,
                        work.position.y + ((f64::from(work.size.height) - height * dpi) / 2.0).round() as i32,
                    ))?;
                }
                lock_window_size(&window);
            }
            Ok(())
        })
}
