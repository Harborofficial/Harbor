use std::path::PathBuf;

use serde::Serialize;

const MARKER: &str = "harbor-install.json";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallFeatures {
    plugins: bool,
    games: bool,
    music: bool,
    ebook: bool,
    manga: bool,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct InstallMarker {
    disabled_features: Option<Vec<String>>,
}

/// The managed installer records what it left out in a marker beside the executable. No marker,
/// no key or a marker that does not parse enables every compiled feature: that is every NSIS
/// install, dev run, and platform the managed installer does not cover.
fn disabled_features() -> Vec<String> {
    let Some(directory) = std::env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(PathBuf::from))
    else {
        return Vec::new();
    };
    let Ok(text) = std::fs::read_to_string(directory.join(MARKER)) else {
        return Vec::new();
    };
    let Ok(marker) = serde_json::from_str::<InstallMarker>(&text) else {
        return Vec::new();
    };
    marker.disabled_features.unwrap_or_default()
}

#[tauri::command]
pub fn install_features() -> InstallFeatures {
    let disabled = disabled_features();
    let on = |key: &str| !disabled.iter().any(|off| off == key);
    InstallFeatures {
        plugins: cfg!(feature = "plugins") && on("plugins"),
        games: cfg!(feature = "games") && on("games"),
        music: cfg!(feature = "music") && on("music"),
        ebook: on("ebook"),
        manga: on("manga"),
    }
}

#[cfg(all(desktop, feature = "plugins"))]
pub(crate) fn require_plugins() -> Result<(), String> {
    if install_features().plugins {
        Ok(())
    } else {
        Err("Plugins are disabled for this installation. Use Modify installation in Settings to enable them.".into())
    }
}

#[cfg(desktop)]
pub(crate) fn games_enabled() -> bool {
    install_features().games
}

#[cfg(desktop)]
pub(crate) fn music_enabled() -> bool {
    install_features().music
}

#[cfg(desktop)]
pub(crate) fn is_music_command(command: &str) -> bool {
    command.starts_with("music_")
        || command.starts_with("ytmusic_")
        || command.starts_with("dj_deck_")
        || command == "run_connector_worker"
}

#[cfg(all(test, desktop))]
mod tests {
    use super::is_music_command;

    #[test]
    fn music_boundary_covers_auxiliary_windows_and_workers() {
        for command in [
            "music_play_track",
            "music_spotify_connect",
            "ytmusic_embed",
            "dj_deck_open",
            "run_connector_worker",
        ] {
            assert!(is_music_command(command), "{command}");
        }
    }

    #[test]
    fn video_and_shared_media_commands_remain_in_core() {
        for command in [
            "fetch_trailer",
            "resolve_youtube_stream",
            "mpv_load",
            "media_controls_update",
            "recognize_now_playing",
            "install_features",
        ] {
            assert!(!is_music_command(command), "{command}");
        }
    }
}
