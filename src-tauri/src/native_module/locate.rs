use super::ModuleSpec;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

#[derive(serde::Deserialize)]
struct Manifest {
    kind: String,
    abi: u32,
    version: String,
    sha256: String,
}

// Where the staged directory can be, on every platform Harbor ships to. resource_dir() is the
// answer for an installed app: the executable's own directory on Windows, /usr/lib/<app> or the
// AppImage mount on Linux, Contents/Resources inside the bundle on macOS. The rest are walked
// because that function resolves to a path that does not exist when the app runs from a cargo
// target directory, which is every macOS and Linux dev run. macOS keeps resources one level up
// from the executable rather than beside it, so those two spellings are listed by hand.
fn roots(app: &AppHandle, spec: &ModuleSpec) -> Vec<PathBuf> {
    let mut roots: Vec<PathBuf> = Vec::new();
    if let Ok(res) = app.path().resource_dir() {
        roots.push(res.join("resources").join(spec.directory));
        roots.push(res.join(spec.directory));
        roots.push(res);
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            roots.push(dir.to_path_buf());
            roots.push(dir.join(spec.directory));
            roots.push(dir.join("resources").join(spec.directory));
            let bundle = dir.join("..").join("Resources");
            roots.push(bundle.join("resources").join(spec.directory));
            roots.push(bundle.join(spec.directory));
            roots.push(bundle);
            #[cfg(debug_assertions)]
            for ancestor in dir.ancestors().take(6) {
                roots.push(ancestor.join("src-tauri/resources").join(spec.directory));
            }
        }
    }
    roots
}

pub(super) fn resolve_module(app: &AppHandle, spec: &ModuleSpec) -> Result<PathBuf, String> {
    let name = if cfg!(windows) {
        format!("{}.exe", spec.executable)
    } else {
        spec.executable.to_string()
    };
    for root in roots(app, spec) {
        let exe = root.join(&name);
        if !exe.is_file() {
            continue;
        }
        let manifest: Manifest = serde_json::from_slice(
            &std::fs::read(root.join(spec.manifest))
                .map_err(|e| format!("Native module manifest: {e}"))?,
        )
        .map_err(|e| format!("Native module manifest: {e}"))?;
        if manifest.kind != spec.kind
            || manifest.abi != spec.abi
            || manifest.version != env!("CARGO_PKG_VERSION")
        {
            return Err("Native module version is incompatible. Repair this installation.".into());
        }
        use sha2::{Digest, Sha256};
        let bytes = std::fs::read(&exe).map_err(|e| format!("Native module: {e}"))?;
        if format!("{:x}", Sha256::digest(bytes)) != manifest.sha256 {
            return Err("Native module checksum mismatch. Repair this installation.".into());
        }
        return Ok(exe);
    }
    Err("The Native module is missing. Use Modify installation to add this component.".into())
}
