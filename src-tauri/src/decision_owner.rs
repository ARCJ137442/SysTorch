//! A native-only credential bridge. HTTP loopback is never an answer identity.
fn owner_window_allowed(label: &str, url: &tauri::Url) -> bool {
    let port = if cfg!(feature = "m1-preview") {
        11436
    } else {
        11435
    };
    let local_http =
        url.scheme() == "http" && url.host_str() == Some("127.0.0.1") && url.port() == Some(port);
    let bundled = (matches!(url.scheme(), "http" | "https")
        && url.host_str() == Some("tauri.localhost")
        && url.port().is_none())
        || (url.scheme() == "tauri" && url.host_str() == Some("localhost"));
    label == "main" && (local_http || bundled)
}

#[tauri::command]
pub fn decision_owner_token(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    base: String,
) -> Result<String, String> {
    use tauri::Manager;
    let url = window
        .url()
        .map_err(|_| "Cannot verify the requesting window")?;
    if !owner_window_allowed(window.label(), &url) {
        return Err(
            "Owner credentials are available only to the local main application window".into(),
        );
    }
    let target = tauri::Url::parse(&base).map_err(|_| "Invalid owned gateway origin")?;
    #[cfg(target_os = "android")]
    let owned_port = super::android_gateway::gateway_status(app.state())
        .bind
        .and_then(|bind| bind.parse::<std::net::SocketAddr>().ok())
        .map(|address| address.port())
        .ok_or("Start the bundled gateway before retrieving its owner credential")?;
    #[cfg(not(target_os = "android"))]
    let owned_port = if cfg!(feature = "m1-preview") {
        11436
    } else {
        11435
    };
    if target.scheme() != "http"
        || !matches!(target.host_str(), Some("127.0.0.1") | Some("localhost"))
        || target.port() != Some(owned_port)
    {
        return Err("The selected API address is not this application's owned gateway; use a caller token for other gateways".into());
    }
    #[cfg(target_os = "android")]
    let config = app
        .path()
        .app_data_dir()
        .map_err(|_| "Cannot locate application data")?
        .join("providers.toml");
    #[cfg(not(target_os = "android"))]
    let config = app
        .state::<super::ShellState>()
        .config_dir
        .join("providers.toml");
    let bytes = std::fs::read(config.with_file_name("systorch-owner.key"))
        .map_err(|_| "Start the bundled M1 gateway before opening the decision desk")?;
    if bytes.len() != 64 {
        return Err(
            "Owner credential file is invalid; restore the matching key and database".into(),
        );
    }
    Ok(format!(
        "st_owner_{}",
        bytes[32..]
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect::<String>()
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn owner_bridge_rejects_external_origins_and_other_windows() {
        let local = tauri::Url::parse(if cfg!(feature = "m1-preview") {
            "http://127.0.0.1:11436/#/desk"
        } else {
            "http://127.0.0.1:11435/#/desk"
        })
        .unwrap();
        assert!(owner_window_allowed("main", &local));
        assert!(!owner_window_allowed("other", &local));
        assert!(owner_window_allowed(
            "main",
            &tauri::Url::parse("http://tauri.localhost/#/desk").unwrap()
        ));
        for url in [
            "https://example.test/",
            "http://127.0.0.1:5173/",
            "http://tauri.localhost:8080/",
            "http://127.0.0.1.evil.test:11436/",
        ] {
            assert!(!owner_window_allowed(
                "main",
                &tauri::Url::parse(url).unwrap()
            ));
        }
    }
}
