use serde_json::{json, Value};
use tauri::AppHandle;

async fn clearance(app: AppHandle, params: &Value) -> Result<Value, String> {
    let url = params
        .get("url")
        .and_then(Value::as_str)
        .ok_or("Browser service requires a URL")?;
    let parsed = tauri::Url::parse(url).map_err(|e| e.to_string())?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err("Browser service requires HTTP or HTTPS".into());
    }
    let host = parsed.host_str().ok_or("Browser service URL has no host")?;
    if let Some((cookie, user_agent)) = crate::cf_solver::cf_cached(host) {
        return Ok(json!({ "cookie": cookie, "userAgent": user_agent }));
    }
    crate::cf_solver::cf_fetch(app, url.to_string()).await?;
    let (cookie, user_agent) = crate::cf_solver::cf_cached(host)
        .ok_or("Browser service did not obtain a clearance cookie")?;
    Ok(json!({ "cookie": cookie, "userAgent": user_agent }))
}

pub(super) async fn serve(app: AppHandle, frame: Value, allowed: &[&str]) -> Value {
    let id = frame.get("id").cloned().unwrap_or(Value::Null);
    let service = frame.get("service").and_then(Value::as_str).unwrap_or("");
    let result = if !allowed.contains(&service) {
        Err("Module is not permitted to use this host service".to_string())
    } else {
        match service {
            "browser.clearance" => tokio::time::timeout(
                std::time::Duration::from_secs(120),
                clearance(app, &frame["params"]),
            )
            .await
            .unwrap_or_else(|_| Err("Browser service timed out".into())),
            _ => Err("Unknown host service".into()),
        }
    };
    match result {
        Ok(value) => json!({ "id": id, "result": value }),
        Err(error) => json!({ "id": id, "error": error }),
    }
}
