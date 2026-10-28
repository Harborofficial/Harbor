use std::fs;
use std::path::{Path, PathBuf};

pub(crate) fn validate_install_dir(path: &Path) -> Result<(), String> {
    if !path.is_absolute() || path.parent().is_none() {
        return Err("Choose an absolute Harbor installation folder.".into());
    }
    for ancestor in path.ancestors() {
        if let Ok(metadata) = fs::symlink_metadata(ancestor) {
            #[cfg(windows)]
            let linked = {
                use std::os::windows::fs::MetadataExt;
                metadata.file_attributes() & 0x400 != 0
            };
            #[cfg(not(windows))]
            let linked = metadata.file_type().is_symlink();
            if linked {
                return Err("Choose a Harbor installation folder outside linked directories.".into());
            }
        }
    }
    if path.exists() {
        let canonical = path.canonicalize().map_err(|e| e.to_string())?;
        let me = std::env::current_exe().map_err(|e| e.to_string())?;
        if me.starts_with(&canonical) {
            return Err("Run Shipyard from outside the Harbor installation folder to clean install.".into());
        }
        let mut entries = fs::read_dir(path).map_err(|e| e.to_string())?;
        if entries.next().is_some() && !path.join("harbor.exe").is_file() {
            return Err(format!("{} is not a Harbor installation. Choose an empty folder or the existing Harbor folder.", path.display()));
        }
    }
    Ok(())
}

// Never follow directory links: a cache or installed component can point outside Harbor.
pub(crate) fn remove_owned_tree(path: &Path) -> Result<(), String> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(e) => return Err(format!("Cannot inspect {}: {e}", path.display())),
    };
    #[cfg(windows)]
    let (linked, directory) = {
        use std::os::windows::fs::MetadataExt;
        (metadata.file_attributes() & 0x400 != 0, metadata.file_attributes() & 0x10 != 0)
    };
    #[cfg(not(windows))]
    let (linked, directory) = (metadata.file_type().is_symlink(), metadata.is_dir());

    let result = if directory && !linked {
        for entry in fs::read_dir(path).map_err(|e| format!("Cannot read {}: {e}", path.display()))? {
            remove_owned_tree(&entry.map_err(|e| e.to_string())?.path())?;
        }
        fs::remove_dir(path)
    } else if directory {
        fs::remove_dir(path)
    } else {
        fs::remove_file(path)
    };
    result.map_err(|e| format!("Cannot remove {}: {e}. Close Harbor and try again.", path.display()))
}

pub(crate) fn data_paths() -> Result<Vec<PathBuf>, String> {
    let mut paths = Vec::new();
    for var in ["APPDATA", "LOCALAPPDATA"] {
        let base = std::env::var_os(var).ok_or_else(|| format!("{var} is unavailable; cannot clear Harbor data."))?;
        let base = PathBuf::from(base);
        if !base.is_absolute() {
            return Err(format!("{var} must be an absolute path."));
        }
        paths.push(base.join("app.harbor"));
    }
    for name in ["harbor-trailers", "harbor-ytdlp", "harbor-subs", "harbor-castsubs", "harbor-thumbs", "harbor-notify-posters"] {
        paths.push(std::env::temp_dir().join(name));
    }
    Ok(paths)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cleanup_removes_nested_data_but_preserves_neighbors() {
        let root = std::env::temp_dir().join(format!("shipyard-clean-test-{}", std::process::id()));
        let owned = root.join("app.harbor");
        fs::create_dir_all(owned.join("settings")).unwrap();
        fs::write(owned.join("settings/config.json"), b"old").unwrap();
        fs::write(root.join("keep.txt"), b"keep").unwrap();
        remove_owned_tree(&owned).unwrap();
        remove_owned_tree(&owned).unwrap();
        assert!(!owned.exists());
        assert!(root.join("keep.txt").exists());
        assert!(validate_install_dir(&root).is_err());
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn cleanup_does_not_follow_directory_junctions() {
        let root = std::env::temp_dir().join(format!("shipyard-link-test-{}", std::process::id()));
        let owned = root.join("app.harbor");
        let outside = root.join("media");
        fs::create_dir_all(&owned).unwrap();
        fs::create_dir_all(&outside).unwrap();
        fs::write(outside.join("keep.txt"), b"keep").unwrap();
        let status = std::process::Command::new("cmd")
            .args(["/C", "mklink", "/J"])
            .arg(owned.join("linked"))
            .arg(&outside)
            .status().unwrap();
        assert!(status.success());
        assert!(validate_install_dir(&owned.join("linked")).is_err());
        remove_owned_tree(&owned).unwrap();
        assert!(outside.join("keep.txt").exists());
        fs::remove_dir_all(root).unwrap();
    }
}
