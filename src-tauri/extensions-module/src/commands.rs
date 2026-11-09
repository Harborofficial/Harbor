use serde_json::{json, Map, Value};

pub struct Request {
    pub method: &'static str,
    pub params: Value,
    pub replay_safe: bool,
}

fn string(args: &Value, key: &str, out: &mut Map<String, Value>) -> Result<(), String> {
    let value = args
        .get(key)
        .and_then(Value::as_str)
        .ok_or_else(|| format!("Missing or invalid {key}"))?;
    out.insert(key.into(), json!(value));
    Ok(())
}

pub fn prepare(command: &str, args: &Value) -> Result<Request, String> {
    if !args.is_object() {
        return Err("Extension arguments must be an object".into());
    }
    let (method, required, optional, replay_safe): (&str, &[&str], &[&str], bool) = match command {
        "capstan_ping" => ("ping", &[], &[], true),
        "capstan_install" => ("install", &["path"], &[], false),
        "capstan_uninstall" => ("uninstall", &["id"], &[], false),
        "capstan_extensions" => ("extensions", &[], &[], true),
        "capstan_providers" => ("providers", &[], &[], true),
        "capstan_search" => ("search", &["providerId", "query"], &["page", "quick"], true),
        "capstan_load" => ("load", &["providerId", "url"], &[], true),
        "capstan_load_links" => ("loadLinks", &["providerId", "data"], &["isCasting"], true),
        "capstan_catalogue" => ("catalogue", &["providerId"], &[], true),
        "capstan_catalogue_page" => ("cataloguePage", &["providerId", "row"], &["page"], true),
        _ => return Err("Unknown extension command".into()),
    };
    let mut params = Map::new();
    for key in required {
        string(args, key, &mut params)?;
    }
    for key in optional {
        if let Some(value) = args.get(key).filter(|v| !v.is_null()) {
            let valid = if *key == "page" {
                value.as_u64().is_some_and(|v| v <= u32::MAX as u64)
            } else {
                value.is_boolean()
            };
            if !valid {
                return Err(format!("Invalid {key}"));
            }
            params.insert((*key).into(), value.clone());
        }
    }
    Ok(Request {
        method,
        params: Value::Object(params),
        replay_safe,
    })
}

pub fn unwrap_frame(frame: Value) -> Result<Value, String> {
    if frame.get("ok").and_then(Value::as_bool) == Some(true) {
        return Ok(frame.get("result").cloned().unwrap_or_else(|| json!({})));
    }
    let code = frame["error"]["code"].as_str().unwrap_or("extension_error");
    let message = frame["error"]["message"]
        .as_str()
        .unwrap_or("the extension bridge refused the request");
    Err(format!("{code}: {message}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn preserves_command_parameter_contract() {
        let r = prepare(
            "capstan_load_links",
            &json!({"providerId":"p","data":"d","isCasting":true,"ignored":1}),
        )
        .unwrap();
        assert_eq!(r.method, "loadLinks");
        assert_eq!(
            r.params,
            json!({"providerId":"p","data":"d","isCasting":true})
        );
        let r = prepare(
            "capstan_catalogue_page",
            &json!({"providerId":"p","row":"r","page":null}),
        )
        .unwrap();
        assert_eq!(r.params, json!({"providerId":"p","row":"r"}));
    }
    #[test]
    fn rejects_invalid_arguments_and_commands() {
        for (cmd, args) in [
            (
                "capstan_search",
                json!({"providerId":"p","query":"q","page":-1}),
            ),
            (
                "capstan_search",
                json!({"providerId":"p","query":"q","quick":"yes"}),
            ),
            ("capstan_install", json!({})),
            ("shutdown", json!({})),
            ("capstan_ping", Value::Null),
        ] {
            assert!(prepare(cmd, &args).is_err());
        }
    }
    #[test]
    fn mutations_are_not_replayed() {
        assert!(
            !prepare("capstan_install", &json!({"path":"a"}))
                .unwrap()
                .replay_safe
        );
        assert!(
            !prepare("capstan_uninstall", &json!({"id":"a"}))
                .unwrap()
                .replay_safe
        );
        assert!(
            prepare("capstan_providers", &json!({}))
                .unwrap()
                .replay_safe
        );
    }
    #[test]
    fn preserves_extension_error_codes_and_empty_results() {
        assert_eq!(unwrap_frame(json!({"ok":true})).unwrap(), json!({}));
        assert_eq!(
            unwrap_frame(
                json!({"ok":false,"error":{"code":"provider_missing","message":"missing"}})
            )
            .unwrap_err(),
            "provider_missing: missing"
        );
    }
}
