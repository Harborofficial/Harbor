# Removable native Extensions runtime

The Extensions native runtime now lives in `capstan/harbor-extensions-module.exe` on Windows (without `.exe` on other platforms), alongside its versioned `extensions-module.json`, Capstan JAR, libraries, converter, and Java runtime. Harbor retains the command/IPC adapter, module validation and access to the shared browser challenge solver. JVM discovery, launch configuration and extension execution no longer have an in-core fallback.

Shipyard already assigns the entire `capstan/` directory to the `plugins` component. Excluding or removing Extensions therefore removes the native module and its runtime together. This uses one Harbor executable and the existing single installer. Frontend tab assets remain embedded; this change concerns the native runtime.

The existing `app_data_dir()/capstan` directory is passed unchanged to the module. Component removal never owns that directory. Extension archives, configuration and WebView data remain available when the component is reinstalled.

## Build and validation

`node scripts/capstan-stage.mjs` builds and stages the native module for the selected target along with the existing runtime. `node scripts/build-extensions-module.mjs` rebuilds just the module on the host platform when Capstan is already staged. Harbor and the module must have matching package versions.

Both Harbor and packaging validate the module's ABI, application version and SHA-256. Packaging also validates the target. Release builds look only in installed resource locations, not nearby source checkouts. The module waits for the host to attach its process lifetime guard before starting Java.

Windows validation completed:

- Harbor Rust compilation and standalone module release build.
- Staged module startup and Capstan protocol ping.
- Native module protocol, EOF shutdown, rejected ABI/version, missing runtime and startup handshake checks.
- Remove/reinstall exercise using a temporary installation and preserved data directory.
- Installer pruning test covering the module, manifest, JAR and Java runtime while retaining user data and Harbor core.
- Packaging manifest validation and existing disabled-plugin behavior tests.

No Linux build was run. Full installed-app provider playback and a newly assembled Shipyard installer still need end-to-end validation before release. No installed application or real user data was changed.
