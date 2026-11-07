use serde_json::Value;

/// Match Harbor's supported UI language codes, rather than the Windows locale.
/// The app saves its active profile's settings to the same settings.json file.
fn saved_ui_language(contents: &str) -> Option<&'static str> {
    let settings: Value = serde_json::from_str(contents).ok()?;
    let raw = settings.get("uiLanguage")?.as_str()?.trim();
    // Match Harbor's normalizeLanguage() behavior for a regional language code.
    let base = raw.split(['-', '_']).next()?.to_ascii_lowercase();
    match base.as_str() {
        "en" => Some("en"),
        "ar" => Some("ar"),
        "de" => Some("de"),
        "es" => Some("es"),
        "fr" => Some("fr"),
        "hi" => Some("hi"),
        "id" => Some("id"),
        "it" => Some("it"),
        "ja" => Some("ja"),
        "ko" => Some("ko"),
        "pl" => Some("pl"),
        "pt" => Some("pt"),
        "ru" => Some("ru"),
        "tr" => Some("tr"),
        "vi" => Some("vi"),
        "zh" => Some("zh"),
        _ => None,
    }
}

/// Returns the language configured in an *installed* copy of Harbor.
/// This is a read-only best-effort lookup; a fresh install or an unavailable
/// settings file leaves Shipyard's normal English default intact.
#[tauri::command]
pub fn installed_harbor_language() -> Option<String> {
    // Do not take a stale settings file to mean Harbor is still installed.
    crate::install::scan_uninstall_roots()?;
    let roaming = std::env::var_os("APPDATA")?;
    let path = std::path::PathBuf::from(roaming)
        .join("app.harbor")
        .join("settings.json");
    let contents = std::fs::read_to_string(path).ok()?;
    saved_ui_language(&contents).map(str::to_owned)
}

#[cfg(test)]
mod tests {
    use super::saved_ui_language;

    #[test]
    fn reads_existing_harbor_ui_language() {
        assert_eq!(saved_ui_language(r#"{"uiLanguage":"ja","region":"JP"}"#), Some("ja"));
        assert_eq!(saved_ui_language(r#"{"uiLanguage":"hi"}"#), Some("hi"));
        assert_eq!(saved_ui_language(r#"{"uiLanguage":"pt-BR"}"#), Some("pt"));
        assert_eq!(saved_ui_language(r#"{"uiLanguage":"FR_fr"}"#), Some("fr"));
        assert_eq!(saved_ui_language(r#"{"uiLanguage":"en"}"#), Some("en"));
    }

    #[test]
    fn unavailable_or_invalid_settings_do_not_override_english() {
        assert_eq!(saved_ui_language("not-json"), None);
        assert_eq!(saved_ui_language(r#"{}"#), None);
        assert_eq!(saved_ui_language(r#"{"uiLanguage":null}"#), None);
        assert_eq!(saved_ui_language(r#"{"uiLanguage":"xx"}"#), None);
        assert_eq!(saved_ui_language(r#"{"uiLanguage":42}"#), None);
    }
}
