//! Verify that the listener is a compatible SysTorch daemon before opening its UI.

use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::time::Duration;

#[derive(Debug, PartialEq)]
pub enum RuntimeProbe {
    Ready,
    Unavailable,
    Occupied(String),
}

pub fn probe(address: SocketAddr) -> RuntimeProbe {
    let Ok(mut stream) = TcpStream::connect_timeout(&address, Duration::from_millis(300)) else {
        return RuntimeProbe::Unavailable;
    };
    let timeout = Some(Duration::from_millis(800));
    let _ = stream.set_read_timeout(timeout);
    let _ = stream.set_write_timeout(timeout);
    if write!(
        stream,
        "GET /health HTTP/1.1\r\nHost: {address}\r\nConnection: close\r\n\r\n"
    )
    .is_err()
    {
        return RuntimeProbe::Occupied("端口已占用，但无法读取服务身份".into());
    }
    let mut response = Vec::new();
    if stream.take(16 * 1024).read_to_end(&mut response).is_err() {
        return RuntimeProbe::Occupied("端口已占用，服务身份探测超时或连接中断".into());
    }
    validate_response(&response, env!("CARGO_PKG_VERSION"))
}

fn validate_response(response: &[u8], expected_version: &str) -> RuntimeProbe {
    let Some(header_end) = response.windows(4).position(|part| part == b"\r\n\r\n") else {
        return RuntimeProbe::Occupied("端口已占用，但未返回有效的健康响应".into());
    };
    let headers = String::from_utf8_lossy(&response[..header_end]);
    if headers
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        != Some("200")
    {
        return RuntimeProbe::Occupied("端口已占用，但服务未就绪".into());
    }
    let Ok(body) = serde_json::from_slice::<serde_json::Value>(&response[header_end + 4..]) else {
        return RuntimeProbe::Occupied("端口已占用，健康响应不是 SysTorch 服务身份数据".into());
    };
    let brand_matches = body["brand"] == "SysTorch" || body["product"] == "jev-switch";
    if !brand_matches || body["status"] != "ok" {
        return RuntimeProbe::Occupied(
            "端口上的服务不是可识别的 SysTorch 内核，请检查已有服务".into(),
        );
    }
    if body["api_revision"].as_u64() != Some(1) || body["version"] != expected_version {
        return RuntimeProbe::Occupied(format!(
            "已有 SysTorch 内核与桌面版本 {expected_version} 不兼容，请更新或停止旧内核后重试"
        ));
    }
    // A local preview can share the release version with an older candidate.
    // Never attach this new shell to an old candidate's UI or owner capability.
    #[cfg(feature = "m1-preview")]
    if body["build_revision"].as_str() != Some(env!("SYSTORCH_BUILD_REVISION")) {
        return RuntimeProbe::Occupied("已有内核属于其他测试构建；请完整退出旧版（含托盘），再启动 SysTorch。配置与待回答任务会原位保留".into());
    }
    RuntimeProbe::Ready
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpListener;
    use std::thread;

    fn response(mut body: serde_json::Value) -> Vec<u8> {
        if body["build_revision"].is_null() {
            body["build_revision"] = env!("SYSTORCH_BUILD_REVISION").into();
        }
        format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n{body}").into_bytes()
    }

    #[test]
    fn accepts_matching_daemon_but_rejects_other_services_and_old_health_shape() {
        let health = serde_json::json!({"status":"ok", "product":"jev-switch", "version":env!("CARGO_PKG_VERSION"), "api_revision":1, "build_revision":null});
        assert_eq!(
            validate_response(&response(health.clone()), env!("CARGO_PKG_VERSION")),
            RuntimeProbe::Ready
        );
        let mut other = health;
        other["product"] = "another-app".into();
        assert!(matches!(
            validate_response(&response(other), env!("CARGO_PKG_VERSION")),
            RuntimeProbe::Occupied(_)
        ));
        assert!(matches!(
            validate_response(
                &response(serde_json::json!({"status":"ok", "version":env!("CARGO_PKG_VERSION")})),
                env!("CARGO_PKG_VERSION")
            ),
            RuntimeProbe::Occupied(_)
        ));
    }

    #[test]
    fn rejects_incompatible_versions_and_non_health_http_responses() {
        let health = serde_json::json!({"status":"ok", "product":"jev-switch", "version":env!("CARGO_PKG_VERSION"), "api_revision":2});
        assert!(matches!(
            validate_response(&response(health), env!("CARGO_PKG_VERSION")),
            RuntimeProbe::Occupied(_)
        ));
        let health = serde_json::json!({"status":"ok", "product":"jev-switch", "version":"0.3.0", "api_revision":1});
        assert!(matches!(
            validate_response(&response(health), env!("CARGO_PKG_VERSION")),
            RuntimeProbe::Occupied(_)
        ));
        let health = serde_json::json!({"status":"ok", "product":"jev-switch", "version":"0.4.1", "api_revision":1});
        assert!(matches!(
            validate_response(&response(health), "0.5.0"),
            RuntimeProbe::Occupied(_)
        ));
        assert!(matches!(
            validate_response(
                b"HTTP/1.1 200 OK\r\n\r\n<html>Old demo</html>",
                env!("CARGO_PKG_VERSION")
            ),
            RuntimeProbe::Occupied(_)
        ));
        assert!(matches!(
            validate_response(
                b"HTTP/1.1 503 Unavailable\r\n\r\n{}",
                env!("CARGO_PKG_VERSION")
            ),
            RuntimeProbe::Occupied(_)
        ));
    }

    #[test]
    fn probe_sends_health_request_and_accepts_matching_daemon_over_tcp() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let server = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = Vec::new();
            let mut chunk = [0; 256];
            while !request.windows(4).any(|part| part == b"\r\n\r\n") {
                let count = stream.read(&mut chunk).unwrap();
                assert_ne!(count, 0, "client closed before sending HTTP headers");
                request.extend_from_slice(&chunk[..count]);
            }
            assert!(request.starts_with(b"GET /health HTTP/1.1\r\n"));

            let body = serde_json::json!({
                "status": "ok",
                "product": "jev-switch",
                "version": env!("CARGO_PKG_VERSION"),
                "api_revision": 1,
                "build_revision": env!("SYSTORCH_BUILD_REVISION")
            })
            .to_string();
            write!(
                stream,
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                body.len(),
                body
            )
            .unwrap();
        });

        assert_eq!(probe(address), RuntimeProbe::Ready);
        server.join().unwrap();
    }

    #[cfg(feature = "m1-preview")]
    #[test]
    fn preview_rejects_an_older_same_version_build() {
        let health = serde_json::json!({"status":"ok", "product":"jev-switch", "version":env!("CARGO_PKG_VERSION"), "api_revision":1, "build_revision":"m1-local-20261024.1"});
        assert!(matches!(
            validate_response(&response(health), env!("CARGO_PKG_VERSION")),
            RuntimeProbe::Occupied(_)
        ));
    }
}
