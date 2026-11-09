use super::*;

struct Fixture(PathBuf);
impl Fixture {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!(
            "harbor-group-delete-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&root).unwrap();
        Self(root)
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

#[test]
fn only_regular_files_are_eligible_for_file_deletion() {
    let fixture = Fixture::new();
    let file = fixture.0.join("game.zip");
    fs::write(&file, "data").unwrap();
    assert!(owned_file(&file).is_ok());
    assert!(owned_file(&fixture.0.join("missing.zip")).is_ok());
    assert!(owned_file(&fixture.0).is_err());
    assert!(file.exists()); // The review has no destructive side effects.
}

#[test]
fn ordinary_directories_can_be_reviewed_without_removing_them() {
    let fixture = Fixture::new();
    let dir = fixture.0.join("torrent-folder");
    fs::create_dir(&dir).unwrap();
    fs::write(dir.join(".harbor-torrent"), "test").unwrap();
    fs::create_dir(dir.join("nested")).unwrap();
    fs::write(dir.join("nested").join("game.bin"), "data").unwrap();
    assert!(owned_tree(&dir).is_ok());
    assert!(dir.join("nested").join("game.bin").exists());
}

#[cfg(unix)]
#[test]
fn symlinks_inside_torrent_folders_are_rejected() {
    use std::os::unix::fs::symlink;
    let fixture = Fixture::new();
    let target = fixture.0.join("outside");
    fs::create_dir(&target).unwrap();
    let root = fixture.0.join("torrent");
    fs::create_dir(&root).unwrap();
    symlink(&target, root.join("link")).unwrap();
    assert!(owned_tree(&root).is_err());
}

#[cfg(windows)]
#[test]
fn windows_file_junctions_and_symlinks_are_rejected() {
    use std::os::windows::fs::symlink_file;
    let fixture = Fixture::new();
    let target = fixture.0.join("outside.txt");
    fs::write(&target, "outside").unwrap();
    if symlink_file(&target, fixture.0.join("shortcut")).is_ok() {
        assert!(owned_file(&fixture.0.join("shortcut")).is_err());
    }
}

#[test]
fn group_identity_uses_actual_game_or_batch_and_keeps_unrelated_files_separate() {
    use super::super::download_metadata::DownloadGame;
    let game = DownloadGame {
        id: "steam:123".into(),
        name: "Example".into(),
        artwork: None,
        logo: None,
        source_name: None,
        content_kind: None,
    };
    let same = group_key(Some(&game), Some("batch-a"), "direct", "file-a");
    assert_eq!(same, group_key(Some(&game), None, "torrent", "file-b"));
    let another = DownloadGame {
        id: "steam:456".into(),
        ..game.clone()
    };
    assert_ne!(same, group_key(Some(&another), None, "direct", "file-a"));
    let patch = DownloadGame {
        content_kind: Some("patch".into()),
        ..game
    };
    assert_ne!(same, group_key(Some(&patch), None, "direct", "file-a"));
    assert_eq!(
        group_key(None, Some("a"), "direct", "one"),
        group_key(None, Some("a"), "direct", "two")
    );
    assert_ne!(
        group_key(None, Some("a"), "direct", "one"),
        group_key(None, Some("b"), "direct", "one")
    );
    assert_ne!(
        group_key(None, None, "direct", "one"),
        group_key(None, None, "torrent", "one")
    );
}
