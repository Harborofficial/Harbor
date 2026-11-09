//! Keep Steam's Gamescope Vulkan WSI layer out of Harbor's in-process libmpv.
//! External mpv is a separate process and still needs the original setting for HDR.

use std::ffi::{OsStr, OsString};
use std::process::Command;
use std::sync::OnceLock;

const GAMESCOPE_WSI: &str = "ENABLE_GAMESCOPE_WSI";
static EXTERNAL_MPV_WSI: OnceLock<OsString> = OnceLock::new();

/// Call before GTK, Vulkan, or worker threads initialize in the Harbor process.
pub fn prepare() {
    let Some(value) = std::env::var_os(GAMESCOPE_WSI) else {
        return;
    };
    if value != "1" {
        return;
    }
    let _ = EXTERNAL_MPV_WSI.set(value);
    std::env::remove_var(GAMESCOPE_WSI);
    eprintln!("[harbor::gamescope] disabled Gamescope Vulkan WSI for embedded playback; external mpv will retain it");
}

fn apply_external_wsi(cmd: &mut Command, value: Option<&OsStr>) {
    if let Some(value) = value {
        cmd.env(GAMESCOPE_WSI, value);
    }
}

/// Restore Steam's original WSI setting only for the external mpv child.
pub fn configure_external_mpv(cmd: &mut Command) {
    apply_external_wsi(cmd, EXTERNAL_MPV_WSI.get().map(OsString::as_os_str));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn external_player_can_restore_gamescope_wsi() {
        let mut cmd = Command::new("mpv");
        apply_external_wsi(&mut cmd, Some(OsStr::new("1")));
        assert!(cmd
            .get_envs()
            .any(|(key, value)| { key == GAMESCOPE_WSI && value == Some(OsStr::new("1")) }));
    }

    #[test]
    fn external_player_without_gamescope_override_is_unchanged() {
        let mut cmd = Command::new("mpv");
        apply_external_wsi(&mut cmd, None);
        assert!(cmd.get_envs().next().is_none());
    }
}
