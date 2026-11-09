# Modular Music in Shipyard (experimental, 24 October 2026)

## Installation model

Shipyard uses **one** `harbor.exe`, never two interchangeable full builds. Its optional `components/music/` directory contains a versioned native sidecar, `harbor-music-module.exe`, and `music-module.json`. The installer buckets those files under Music, excludes them when Music is unchecked, and removes them via Modify/Repair without deleting the application's user data.

The separate native Music process owns local MPV playback, two decks, audio DSP/settings, meters, eight-band spectrum, source header handling, virtual-device broadcast mirroring, tag reading, M3U parsing, and Spotify Premium audio playback. The core retains the existing Music commands, connector registration/account management, Spotify/Last.fm secret storage and library databases; this preserves application identity and user data.

## Component build

Run `pnpm shipyard:modules` to build the sidecar core, the separate Music module, the optional Games engine and Extensions runtime, and a **single** Shipyard installer. The core is compiled with `--no-default-features --features games,plugins,music,music-sidecar,tauri/custom-protocol`; this excludes the legacy native MPV Music engine and legacy Spotify audio output player from Harbor. The official Shipyard release workflow uses the same command. `pnpm shipyard` remains the local legacy-Music fallback.

The packaging process sets `HARBOR_MUSIC_CORE_EXE`, `HARBOR_MUSIC_MODULE_DIR` and `HARBOR_MUSIC_MODULE_EXPERIMENTAL=1`. Both inputs and the Music manifest must match Harbor's version and ABI. The payload verifier compares hashes, confirms the optional module exists, and rejects a second Harbor executable.

## Data compatibility

Installed Music bytes are removable, but `music.db`, profile music databases, `secrets.json`, `music-audio.json`, `settings.json`, `spotify/` and WebView local storage are not components and must survive removal, repair and reinstallation.

## Verified checks

- Both the sidecar-mode and original Harbor source compile.
- The native Music module has passed 43 Rust tests, including DSP/FFT tests.
- The versioned native IPC protocol passes a silent native playback exercise with virtual broadcast, pause/seek, metering and events.
- Shipyard feature-selection and data preservation tests have passed.
- The frontend production build and Music installation-availability tests have passed.
- The modular installer has passed an install/repair exercise with Music checked and unchecked.
- Spotify Premium playback has been verified end to end on the installed sidecar build.

## Still required before production enablement

A full Windows app-level regression with YouTube Music, local folders, DJ decks, taskbar/media keys and virtual devices is still needed, along with update/rollback testing on installed versions. A silent module smoke test **does not** substitute for that. The optional frontend Music bundle remains within the core's web assets (lazy imported, not physically removed when Music is unchecked). Thus this phase makes the **native** implementation removable, not every byte of Music code or frontend resources. The Shipyard download itself always includes optional payloads because installation is offline.

## Native extraction groundwork

Games and Extensions now have independent Cargo features (`games` and `plugins`), enabled by default. A `--no-default-features` core excludes their Rust modules and command registrations as well as Music; Games-only dependencies are optional. The Music sidecar build explicitly retains Games and Extensions. The installation marker also blocks Games commands and its startup preparation when Games is disabled.

Games currently has a compile-time boundary, not a separately installable native module. Extensions now has its own native runtime module; see EXTENSIONS-MODULARITY.md. Further Games and Music extraction must supply versioned module interfaces, startup/shutdown and event forwarding while preserving existing data paths. Shared video services remain in core. No additional full Harbor executable is packaged.
