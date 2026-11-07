//! Register a real Windows toast identity for the unpackaged development app.
//! notify-rust otherwise uses the system "Windows PowerShell" AUMID. A custom
//! identity without its matching Start Menu shortcut is silently discarded.
use std::{
    fs,
    path::{Path, PathBuf},
    sync::OnceLock,
};
use windows::{
    core::{Interface, HSTRING, PCWSTR, PWSTR},
    Win32::{
        Foundation::PROPERTYKEY,
        System::{
            Com::StructuredStorage::{
                PropVariantClear, PROPVARIANT, PROPVARIANT_0_0, PROPVARIANT_0_0_0,
            },
            Com::{
                CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize, IPersistFile,
                CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED, STGM_READ,
            },
            Variant::VT_LPWSTR,
        },
        UI::Shell::{
            FOLDERID_Programs, IShellLinkW, PropertiesSystem::IPropertyStore, SHGetKnownFolderPath,
            ShellLink, KF_FLAG_DEFAULT, SLGP_RAWPATH,
        },
    },
};

const DEV_ID: &str = "app.harbor.dev";
const SHORTCUT_DIR: &str = "Harbor Development";
const SHORTCUT_NAME: &str = "Harbor.lnk";
static DEV_IDENTITY: OnceLock<Option<String>> = OnceLock::new();

fn app_model_key() -> PROPERTYKEY {
    // PKEY_AppUserModel_ID, System.AppUserModel.ID, pid=5.
    PROPERTYKEY {
        fmtid: windows::core::GUID::from_u128(0x9f4c2855_9f79_4b39_a8d0_e1d42de1d5f3),
        pid: 5,
    }
}

struct Apartment;
impl Apartment {
    fn enter() -> windows::core::Result<Self> {
        unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED).ok()? };
        Ok(Self)
    }
}
impl Drop for Apartment {
    fn drop(&mut self) {
        unsafe { CoUninitialize() };
    }
}

fn programs() -> windows::core::Result<PathBuf> {
    let pointer = unsafe { SHGetKnownFolderPath(&FOLDERID_Programs, KF_FLAG_DEFAULT, None)? };
    let value = unsafe { pointer.to_string() }.map(PathBuf::from);
    unsafe { CoTaskMemFree(Some(pointer.0.cast())) };
    value.map_err(|error| {
        windows::core::Error::from(std::io::Error::new(std::io::ErrorKind::InvalidData, error))
    })
}

fn equivalent(left: &Path, right: &Path) -> bool {
    let normalize = |path: &Path| {
        let text = path.to_string_lossy();
        text.strip_prefix(r"\\?\")
            .unwrap_or(&text)
            .to_ascii_lowercase()
    };
    normalize(left) == normalize(right)
}

fn registered(path: &Path, exe: &Path) -> windows::core::Result<bool> {
    let link: IShellLinkW = unsafe { CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER)? };
    let persist: IPersistFile = link.cast()?;
    unsafe { persist.Load(&HSTRING::from(path.as_os_str()), STGM_READ)? };
    let mut buffer = vec![0u16; 32768];
    unsafe { link.GetPath(&mut buffer, std::ptr::null_mut(), SLGP_RAWPATH.0 as u32)? };
    let end = buffer
        .iter()
        .position(|value| *value == 0)
        .unwrap_or(buffer.len());
    let target = PathBuf::from(String::from_utf16_lossy(&buffer[..end]));
    let store: IPropertyStore = link.cast()?;
    let mut property = unsafe { store.GetValue(&app_model_key())? };
    let value = if unsafe { property.Anonymous.Anonymous.vt } == VT_LPWSTR {
        let ptr = unsafe { property.Anonymous.Anonymous.Anonymous.pwszVal };
        if ptr.is_null() {
            None
        } else {
            unsafe { PCWSTR(ptr.0).to_string().ok() }
        }
    } else {
        None
    };
    let _ = unsafe { PropVariantClear(&raw mut property) };
    Ok(equivalent(&target, exe) && value.as_deref() == Some(DEV_ID))
}

fn save(path: &Path, exe: &Path) -> windows::core::Result<()> {
    let link: IShellLinkW = unsafe { CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER)? };
    let executable = HSTRING::from(exe.as_os_str());
    unsafe {
        link.SetPath(&executable)?;
        if let Some(folder) = exe.parent() {
            link.SetWorkingDirectory(&HSTRING::from(folder.as_os_str()))?;
        }
        link.SetIconLocation(&executable, 0)?;
        link.SetDescription(&HSTRING::from("Harbor development notifications"))?;
    }
    let store: IPropertyStore = link.cast()?;
    let mut text: Vec<u16> = DEV_ID.encode_utf16().chain(Some(0)).collect();
    let mut property = PROPVARIANT::default();
    property.Anonymous.Anonymous = std::mem::ManuallyDrop::new(PROPVARIANT_0_0 {
        vt: VT_LPWSTR,
        wReserved1: 0,
        wReserved2: 0,
        wReserved3: 0,
        Anonymous: PROPVARIANT_0_0_0 {
            pwszVal: PWSTR(text.as_mut_ptr()),
        },
    });
    unsafe {
        store.SetValue(&app_model_key(), &property)?;
        store.Commit()?;
    }
    // The input string belongs to this stack frame. Do not PropVariantClear a
    // borrowed pointer; the property store has copied its value on SetValue.
    let persist: IPersistFile = link.cast()?;
    unsafe { persist.Save(&HSTRING::from(path.as_os_str()), true)? };
    Ok(())
}

fn register(exe: &Path) -> windows::core::Result<()> {
    let folder = programs()?.join(SHORTCUT_DIR);
    fs::create_dir_all(&folder).map_err(windows::core::Error::from)?;
    let shortcut = folder.join(SHORTCUT_NAME);
    if shortcut.exists() {
        if registered(&shortcut, exe)? {
            return Ok(());
        }
        // An existing shortcut is never overwritten: it might belong to a
        // different application, or a different Harbor working tree.
        return Err(windows::core::Error::from(std::io::Error::new(
            std::io::ErrorKind::AlreadyExists,
            "Harbor development notification shortcut is occupied",
        )));
    }
    let temporary = folder.join(format!(".harbor-toast-{}.lnk", uuid::Uuid::new_v4()));
    let result = (|| {
        save(&temporary, exe)?;
        unsafe {
            windows::Win32::Storage::FileSystem::MoveFileW(
                &HSTRING::from(temporary.as_os_str()),
                &HSTRING::from(shortcut.as_os_str()),
            )?;
        }
        if !registered(&shortcut, exe)? {
            return Err(windows::core::Error::from(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "Harbor development notification shortcut failed verification",
            )));
        }
        Ok(())
    })();
    let _ = fs::remove_file(temporary);
    result
}

/// Reuse only after the Windows shortcut has been registered successfully.
pub(super) fn app_id(exe: &Path) -> Option<String> {
    DEV_IDENTITY
        .get_or_init(|| {
            let path = exe.to_path_buf();
            // A dedicated STA allows COM shortcut registration even when the
            // invoking Tauri IPC thread already uses the MTA model.
            let result = std::thread::spawn(move || {
                let _apartment = Apartment::enter()?;
                register(&path)
            })
            .join();
            match result {
                Ok(Ok(())) => Some(DEV_ID.to_owned()),
                Ok(Err(error)) => {
                    eprintln!("[harbor::notify] development toast identity unavailable: {error}");
                    None
                }
                Err(_) => {
                    eprintln!(
                        "[harbor::notify] development toast identity initialization panicked"
                    );
                    None
                }
            }
        })
        .clone()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn app_model_property_key_matches_windows_documentation() {
        assert_eq!(app_model_key().pid, 5);
        assert_eq!(
            app_model_key().fmtid,
            windows::core::GUID::from_u128(0x9f4c2855_9f79_4b39_a8d0_e1d42de1d5f3)
        );
    }
    #[test]
    fn temporary_shortcut_carries_harbor_dev_identity_and_rejects_other_targets() {
        std::thread::spawn(|| {
            let _apartment = Apartment::enter().unwrap();
            let root =
                std::env::temp_dir().join(format!("harbor-notify-test-{}", uuid::Uuid::new_v4()));
            fs::create_dir_all(&root).unwrap();
            let shortcut = root.join("Harbor.lnk");
            let current = std::env::current_exe().unwrap();
            save(&shortcut, &current).unwrap();
            assert!(registered(&shortcut, &current).unwrap());
            assert!(!registered(&shortcut, &root.join("another.exe")).unwrap());
            fs::remove_dir_all(&root).unwrap();
        })
        .join()
        .unwrap();
    }
    #[test]
    fn windows_extended_prefix_does_not_change_shortcut_executable_identity() {
        assert!(equivalent(
            Path::new(r"\\?\C:\Harbor\harbor.exe"),
            Path::new(r"c:\harbor\HARBOR.exe")
        ));
        assert!(!equivalent(
            Path::new(r"C:\Other\harbor.exe"),
            Path::new(r"C:\Harbor\harbor.exe")
        ));
    }
}
