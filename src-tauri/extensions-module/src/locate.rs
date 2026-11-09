use std::path::{Path, PathBuf};
use std::process::Stdio;

pub(crate) struct Jvm {
    pub exe: PathBuf,
    pub source: String,
}

fn java_name() -> &'static str {
    if cfg!(windows) {
        "java.exe"
    } else {
        "java"
    }
}

fn java_under(home: &Path) -> Option<PathBuf> {
    [
        home.join("bin").join(java_name()),
        home.join("Contents")
            .join("Home")
            .join("bin")
            .join(java_name()),
    ]
    .into_iter()
    .find(|p| p.is_file())
}

// An archive, an installer, or a runtime cross staged on Windows can arrive without the exec bit,
// and a launcher that has lost it cannot start. Restore it, and fall through to the next candidate
// if even that is refused, rather than spawning something that is certain to fail.
#[cfg(unix)]
fn launchable(exe: PathBuf) -> Option<PathBuf> {
    use std::os::unix::fs::PermissionsExt;
    let mut perms = std::fs::metadata(&exe).ok()?.permissions();
    if perms.mode() & 0o111 != 0 {
        return Some(exe);
    }
    perms.set_mode(0o755);
    std::fs::set_permissions(&exe, perms).ok()?;
    Some(exe)
}

#[cfg(not(unix))]
fn launchable(exe: PathBuf) -> Option<PathBuf> {
    Some(exe)
}

fn bundled_runtime(app: &Path) -> Option<PathBuf> {
    roots(app)
        .into_iter()
        .find_map(|root| java_under(&root.join("runtime")))
        .and_then(launchable)
}

fn runnable(exe: &Path) -> bool {
    let mut cmd = std::process::Command::new(exe);
    cmd.arg("-version")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000);
    }
    matches!(cmd.status(), Ok(status) if status.success())
}

pub(crate) fn resolve_jvm(app: &Path) -> Result<Jvm, String> {
    if let Some(exe) = bundled_runtime(app) {
        let source = format!("bundled runtime, {}", exe.display());
        return Ok(Jvm { exe, source });
    }
    if let Some(raw) = std::env::var_os("HARBOR_JAVA") {
        let configured = PathBuf::from(&raw);
        let found = if configured.is_file() {
            Some(configured.clone())
        } else {
            java_under(&configured)
        };
        return match found {
            Some(exe) => {
                let source = format!("HARBOR_JAVA, {}", exe.display());
                Ok(Jvm { exe, source })
            }
            None => Err(format!(
                "HARBOR_JAVA points at {} but there is no java there. Set it to a Java 17 or newer directory, or to the java program itself.",
                configured.display()
            )),
        };
    }
    if let Some(home) = std::env::var_os("JAVA_HOME") {
        if let Some(exe) = java_under(Path::new(&home)) {
            let source = format!("JAVA_HOME, {}", exe.display());
            return Ok(Jvm { exe, source });
        }
    }
    let on_path = PathBuf::from(java_name());
    if runnable(&on_path) {
        return Ok(Jvm {
            exe: on_path,
            source: "java on PATH".into(),
        });
    }
    Err("Harbor could not find a Java runtime, which extensions need. Install Java 17 or newer, or set HARBOR_JAVA to a copy you already have, then try again.".into())
}

pub(crate) struct Layout {
    pub jar: PathBuf,
    pub libs: Vec<PathBuf>,
    pub dex_tools: Option<PathBuf>,
}

fn layout_at(root: &Path) -> Option<Layout> {
    let jar = [
        root.join("capstan.jar"),
        root.join("out").join("capstan.jar"),
    ]
    .into_iter()
    .find(|p| p.is_file())?;
    let mut libs: Vec<PathBuf> = Vec::new();
    if let Ok(entries) = std::fs::read_dir(root.join("libs")) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) == Some("jar") {
                libs.push(path);
            }
        }
    }
    libs.sort();
    // A build flattens the converter to dex-tools/, a checkout keeps it where its own tools expect.
    let dex_tools = [
        root.join("dex-tools"),
        root.join("tools").join("dex-tools").join("lib"),
    ]
    .into_iter()
    .find(|p| p.is_dir());
    Some(Layout {
        jar,
        libs,
        dex_tools,
    })
}

// The module owns its runtime directory; installed builds never search a checkout.
fn roots(root: &Path) -> Vec<PathBuf> {
    vec![root.to_path_buf()]
}

pub(crate) fn resolve_layout(app: &Path) -> Result<Layout, String> {
    roots(app)
        .iter()
        .find_map(|root| layout_at(root))
        .ok_or_else(|| "The extension runtime is missing from this install. Reinstall Harbor, or build the layer with tools/build.sh if you are running from source.".into())
}
