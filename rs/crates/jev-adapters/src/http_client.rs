//! Shared proxy boundary for upstream calls, probes and service readiness.

/// Public destinations keep reqwest's configured proxy discovery. Loopback
/// services always connect directly: a proxy's error response cannot prove
/// that a local model is actually listening.
pub fn client_builder(base: &str) -> reqwest::ClientBuilder {
    let builder = reqwest::Client::builder();
    if is_loopback_url(base) {
        builder.no_proxy()
    } else {
        builder
    }
}

fn is_loopback_url(base: &str) -> bool {
    let Ok(url) = reqwest::Url::parse(base) else {
        return false;
    };
    let Some(host) = url.host_str() else {
        return false;
    };
    if host == "localhost" || host.ends_with(".localhost") {
        return true;
    }
    match host.trim_matches(['[', ']']).parse::<std::net::IpAddr>() {
        Ok(std::net::IpAddr::V4(ip)) => ip.is_loopback(),
        Ok(std::net::IpAddr::V6(ip)) => {
            ip.is_loopback() || ip.to_ipv4_mapped().is_some_and(|ip| ip.is_loopback())
        }
        Err(_) => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn loopback_boundary_includes_ipv4_ipv6_and_localhost_but_not_public_hosts() {
        for base in [
            "http://127.0.0.1:18765/v1/systemone",
            "http://127.42.0.2:11435",
            "http://[::1]:18765/health",
            "http://[::ffff:127.0.0.1]:18765",
            "http://LOCALHOST:18765",
            "http://model.localhost:18765",
        ] {
            assert!(
                is_loopback_url(base),
                "local service must bypass proxy: {base}"
            );
        }
        for base in [
            "https://api.typesafe.ai/v1/systemone",
            "https://localhost.example.com",
            "http://192.168.1.10:18765",
            "http://[2001:db8::1]:18765",
            "invalid url",
        ] {
            assert!(
                !is_loopback_url(base),
                "keep configured proxy policy: {base}"
            );
        }
    }
}
