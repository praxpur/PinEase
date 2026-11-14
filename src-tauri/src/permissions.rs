use tauri::Url;

pub fn is_trusted_url(value: &str, dev_url: Option<&str>) -> bool {
    let Ok(url) = Url::parse(value) else {
        return false;
    };
    if !url.username().is_empty() || url.password().is_some() {
        return false;
    }

    let scheme = url.scheme();
    let host = url.host_str();

    if matches!(scheme, "http" | "https") && host == Some("tauri.localhost") && url.port().is_none() {
        return true;
    }
    if scheme == "tauri" && host == Some("localhost") && url.port().is_none() {
        return true;
    }

    let Some(dev_raw) = dev_url.filter(|s| !s.trim().is_empty()) else {
        return false;
    };
    let Ok(dev) = Url::parse(dev_raw) else {
        return false;
    };
    if dev.scheme() != "http" {
        return false;
    }
    let Some(dev_host) = dev.host_str() else {
        return false;
    };
    if !matches!(dev_host, "localhost" | "127.0.0.1" | "[::1]") {
        return false;
    }

    url.scheme() == dev.scheme()
        && url.host_str() == dev.host_str()
        && url.port_or_known_default() == dev.port_or_known_default()
}

pub fn can_grant_webview_permission(uri: &str, kind: &str, dev_url: Option<&str>) -> bool {
    is_trusted_url(uri, dev_url) && kind == "camera"
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allows_tauri_origins_and_rejects_untrusted() {
        assert!(is_trusted_url("http://tauri.localhost/", None));
        assert!(is_trusted_url("https://tauri.localhost/settings", None));
        assert!(is_trusted_url("tauri://localhost/index.html", None));
        assert!(!is_trusted_url("http://tauri.localhost:8080/", None));
        assert!(!is_trusted_url("http://tauri.localhost.evil/", None));
        assert!(!is_trusted_url("https://example.com/", None));
        assert!(!is_trusted_url("http://user:pass@tauri.localhost/", None));
    }

    #[test]
    fn allows_only_explicit_localhost_dev_origin() {
        let dev = Some("http://localhost:5180/");
        assert!(is_trusted_url("http://localhost:5180/history", dev));
        assert!(!is_trusted_url("http://localhost:5181/", dev));
        assert!(!is_trusted_url("https://example.com/", Some("https://example.com/")));
    }

    #[test]
    fn permits_only_camera_on_trusted_origin() {
        assert!(can_grant_webview_permission("http://tauri.localhost/", "camera", None));
        assert!(!can_grant_webview_permission("http://tauri.localhost/", "microphone", None));
        assert!(!can_grant_webview_permission("http://tauri.localhost/", "notifications", None));
        assert!(!can_grant_webview_permission("https://example.com/", "camera", None));
    }
}
