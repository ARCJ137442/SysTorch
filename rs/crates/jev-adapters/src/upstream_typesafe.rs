//! Native TypeSafe SystemOne HTTP upstream and TypeSafe-compatible local services.
//!
//! `base` is the complete SystemOne endpoint URL, for example
//! `https://api.typesafe.ai/v1/systemone` or `http://127.0.0.1:8000/v1/systemone`.
//! Requests and successful responses use the Jev protocol directly.

use base64::{engine::general_purpose::STANDARD, Engine as _};
use jev_core::adapter::UpstreamAdapter;
use jev_core::upstream::{Capabilities, JevError, QuestionType};
use jev_protocol::{JevRequest, JevResponse};
use reqwest::Client;
use serde_json::{json, Map, Value};
use std::time::Duration;

pub const TYPESAFE_OFFICIAL_BASE: &str = "https://api.typesafe.ai/v1/systemone";
pub const TYPESAFE_CAPABILITIES: Capabilities = Capabilities {
    question_types: &[
        QuestionType::Choice,
        QuestionType::Score,
        QuestionType::Noul,
        QuestionType::Box,
        QuestionType::Box,
    ],
    has_confidence: true,
    has_usage: true,
    noul_via_boolean: false,
    retryable_status: &[408, 429, 500, 502, 503, 504, 529],
};

pub struct TypeSafeUpstream {
    id: String,
    base: String,
    api_key: Option<String>,
    forward_extensions: bool,
    http: Client,
}

impl TypeSafeUpstream {
    pub fn new(base: String, api_key: Option<String>) -> Result<Self, JevError> {
        Self::new_with_id_and_options("typesafe".into(), base, api_key, false)
    }

    pub fn new_with_id(
        id: String,
        base: String,
        api_key: Option<String>,
    ) -> Result<Self, JevError> {
        Self::new_with_id_and_options(id, base, api_key, false)
    }

    /// Construct a TypeSafe-compatible upstream with explicit extension forwarding.
    ///
    /// `forward_extensions` is opt-in because the official TypeSafe endpoint is
    /// text-only. Enabled providers must be a gateway or local implementation
    /// that documents the extension keys it accepts.
    pub fn new_with_id_and_options(
        id: String,
        base: String,
        api_key: Option<String>,
        forward_extensions: bool,
    ) -> Result<Self, JevError> {
        let http = crate::http_client::client_builder(&base)
            .timeout(Duration::from_secs(120))
            .connect_timeout(Duration::from_secs(10))
            .build()
            .map_err(|e| JevError::Config {
                upstream_id: id.clone(),
                message: format!("reqwest build failed: {e}"),
            })?;
        Ok(Self {
            id,
            base,
            api_key: api_key.filter(|key| !key.is_empty()),
            forward_extensions,
            http,
        })
    }
}

#[async_trait::async_trait]
impl UpstreamAdapter for TypeSafeUpstream {
    fn id(&self) -> &str {
        &self.id
    }

    fn capabilities(&self) -> Capabilities {
        TYPESAFE_CAPABILITIES
    }

    fn supports_asset_type(&self, asset_type: &str) -> bool {
        asset_type == "image"
            || (self.forward_extensions && !asset_type.trim().is_empty() && asset_type.len() <= 64)
    }

    async fn evaluate(&self, req: JevRequest) -> Result<JevResponse, JevError> {
        let extension_keys = extension_keys(&req);
        let (payload, needs_images_header) =
            request_payload(&self.id, req, self.forward_extensions)?;
        let mut builder = self.http.post(&self.base).json(&payload);
        if needs_images_header {
            builder = builder.header("TypeSafe-Danger-Zone-Images", "true");
        }
        if let Some(key) = self.api_key.as_deref() {
            builder = builder.bearer_auth(key);
        }

        let resp = builder.send().await.map_err(|e| {
            if e.is_timeout() {
                JevError::Timeout {
                    upstream_id: self.id.clone(),
                }
            } else {
                JevError::Network {
                    upstream_id: self.id.clone(),
                    message: e.to_string(),
                }
            }
        })?;

        let status = resp.status();
        let raw_bytes = resp.bytes().await.map_err(|e| JevError::Network {
            upstream_id: self.id.clone(),
            message: format!("read body: {e}"),
        })?;

        if !status.is_success() {
            return Err(JevError::Upstream {
                upstream_id: self.id.clone(),
                status: status.as_u16(),
                body: String::from_utf8_lossy(&raw_bytes).to_string(),
                retryable: self.capabilities().is_retryable_status(status.as_u16()),
            });
        }

        let raw = serde_json::from_slice::<serde_json::Value>(&raw_bytes).map_err(|e| {
            JevError::BadResponse {
                upstream_id: self.id.clone(),
                message: format!("parse TypeSafe SystemOne response: {e}"),
            }
        })?;
        if let Some(answers) = raw.get("answers").and_then(serde_json::Value::as_object) {
            for (question_id, answer) in answers {
                if answer.get("type").and_then(serde_json::Value::as_str) == Some("score")
                    && !has_typesafe_score_legend(answer)
                {
                    return Err(JevError::BadResponse {
                        upstream_id: self.id.clone(),
                        message: format!(
                            "answer '{question_id}' has missing or invalid TypeSafe score legend"
                        ),
                    });
                }
            }
        }

        let mut response =
            serde_json::from_value::<JevResponse>(raw).map_err(|e| JevError::BadResponse {
                upstream_id: self.id.clone(),
                message: format!("parse TypeSafe SystemOne response: {e}"),
            })?;
        if !extension_keys.is_empty() {
            response.extra.insert(
                "jev_switch".into(),
                serde_json::json!({
                    "request_extensions": {
                        "received": extension_keys,
                        "provider_disposition": if self.forward_extensions { "forwarded" } else { "stripped" },
                    }
                }),
            );
        }
        Ok(response)
    }
}

fn extension_keys(req: &JevRequest) -> Vec<String> {
    let mut keys = std::collections::BTreeSet::new();
    keys.extend(req.extra.keys().cloned());
    if let Some(extensions) = &req.extensions {
        keys.extend(extensions.keys().cloned());
    }
    keys.into_iter().collect()
}

fn request_payload(
    upstream_id: &str,
    req: JevRequest,
    forward_extensions: bool,
) -> Result<(Value, bool), JevError> {
    let mut extensions = req.extra.clone();
    for (key, value) in req.extensions.clone().unwrap_or_default() {
        if extensions.insert(key.clone(), value).is_some() {
            return Err(JevError::Config {
                upstream_id: upstream_id.to_string(),
                message: format!("duplicate request extension key '{key}'"),
            });
        }
    }
    let asset_projection = project_assets(upstream_id, req.assets.as_ref(), forward_extensions)?;
    let has_box_question = req
        .questions
        .values()
        .any(|question| matches!(question, jev_protocol::Question::Box { .. }));
    if has_box_question && !asset_projection.has_image {
        return Err(JevError::Capability {
            upstream_id: upstream_id.to_string(),
            detail: "format mismatch: TypeSafe Box questions require an image asset".into(),
        });
    }
    let needs_images_header = asset_projection.needs_images_header || has_box_question;
    let mut payload = serde_json::to_value(req).map_err(|error| JevError::Config {
        upstream_id: upstream_id.to_string(),
        message: format!("serialize TypeSafe SystemOne request: {error}"),
    })?;
    let Some(object) = payload.as_object_mut() else {
        return Err(JevError::Config {
            upstream_id: upstream_id.to_string(),
            message: "serialized TypeSafe request was not an object".into(),
        });
    };
    // Remove every unknown field first. This makes the default path safe even
    // when a caller sent a provider-specific field directly at the top level.
    for key in extensions.keys() {
        object.remove(key);
    }
    object.remove("extensions");
    if let Some(assets) = asset_projection.assets {
        object.insert("assets".into(), Value::Object(assets));
    } else {
        object.remove("assets");
    }
    if !forward_extensions {
        return Ok((payload, needs_images_header));
    }
    for (key, value) in extensions {
        if matches!(
            key.as_str(),
            "model" | "state" | "questions" | "assets" | "extensions"
        ) {
            return Err(JevError::Config {
                upstream_id: upstream_id.to_string(),
                message: format!("extension key '{key}' conflicts with the Jev request contract"),
            });
        }
        if object.insert(key.clone(), value).is_some() {
            return Err(JevError::Config {
                upstream_id: upstream_id.to_string(),
                message: format!("extension key '{key}' conflicts with an existing request field"),
            });
        }
    }
    Ok((payload, needs_images_header))
}

#[derive(Debug)]
pub(crate) struct ProjectedAssets {
    pub(crate) assets: Option<Map<String, Value>>,
    pub(crate) needs_images_header: bool,
    pub(crate) has_image: bool,
}

pub(crate) fn project_assets(
    upstream_id: &str,
    assets: Option<&std::collections::BTreeMap<String, jev_protocol::RequestAsset>>,
    forward_extensions: bool,
) -> Result<ProjectedAssets, JevError> {
    let Some(assets) = assets.filter(|assets| !assets.is_empty()) else {
        return Ok(ProjectedAssets {
            assets: None,
            needs_images_header: false,
            has_image: false,
        });
    };
    let mut projected = Map::new();
    let mut needs_images_header = false;
    let mut has_image = false;
    let mut total_image_bytes = 0usize;
    for (reference, asset) in assets {
        if reference.trim().is_empty() || reference.len() > 1024 {
            return Err(JevError::Config {
                upstream_id: upstream_id.to_string(),
                message: "asset reference must be nonempty and at most 1024 bytes".into(),
            });
        }
        if asset.asset_id.is_some() {
            return Err(JevError::Config {
                upstream_id: upstream_id.to_string(),
                message: "unresolved SysTorch asset reference reached the TypeSafe adapter".into(),
            });
        }
        let Some(encoded) = asset.data_base64.as_deref() else {
            return Err(JevError::Config {
                upstream_id: upstream_id.to_string(),
                message: format!("asset '{reference}' has no inline data after gateway resolution"),
            });
        };
        let bytes = STANDARD.decode(encoded).map_err(|_| JevError::Config {
            upstream_id: upstream_id.to_string(),
            message: format!("asset '{reference}' has invalid base64 data"),
        })?;
        if bytes.is_empty() || bytes.len() > 64 * 1024 * 1024 {
            return Err(JevError::Capability {
                upstream_id: upstream_id.to_string(),
                detail: format!("format mismatch: asset '{reference}' has an unsupported size"),
            });
        }
        if asset.r#type == "image" {
            if bytes.len() > 16 * 1024 * 1024 {
                return Err(JevError::Capability {
                    upstream_id: upstream_id.to_string(),
                    detail: format!(
                        "format mismatch: TypeSafe image asset '{reference}' exceeds 16 MiB"
                    ),
                });
            }
            total_image_bytes = total_image_bytes.saturating_add(bytes.len());
            if total_image_bytes > 32 * 1024 * 1024 {
                return Err(JevError::Capability {
                    upstream_id: upstream_id.to_string(),
                    detail:
                        "format mismatch: TypeSafe image assets exceed the 32 MiB request limit"
                            .into(),
                });
            }
            let detected = image_format_and_dimensions(&bytes).ok_or_else(|| JevError::Capability {
                upstream_id: upstream_id.to_string(),
                detail: format!("format mismatch: image asset '{reference}' is not a valid PNG or JPEG header"),
            })?;
            let format = asset
                .format
                .as_deref()
                .or_else(|| {
                    asset.mime_type.as_deref().and_then(|mime| match mime {
                        "image/png" => Some("png"),
                        "image/jpeg" | "image/jpg" => Some("jpg"),
                        _ => None,
                    })
                })
                .unwrap_or(detected.0);
            let format = match format {
                "jpeg" => "jpg",
                "jpg" | "png" => format,
                _ => {
                    return Err(JevError::Capability {
                        upstream_id: upstream_id.to_string(),
                        detail: format!(
                            "format mismatch: image asset '{reference}' must be PNG or JPEG"
                        ),
                    });
                }
            };
            if format != detected.0 {
                return Err(JevError::Capability {
                    upstream_id: upstream_id.to_string(),
                    detail: format!("format mismatch: image asset '{reference}' format does not match its bytes"),
                });
            }
            if asset.mime_type.as_deref().is_some_and(|mime| {
                !matches!(
                    (format, mime),
                    ("png", "image/png") | ("jpg", "image/jpeg" | "image/jpg")
                )
            }) {
                return Err(JevError::Capability {
                    upstream_id: upstream_id.to_string(),
                    detail: format!(
                        "format mismatch: image asset '{reference}' MIME and format disagree"
                    ),
                });
            }
            let (width, height) = (detected.1, detected.2);
            if width < 280 || height < 280 || width > 1568 || height > 1568 {
                return Err(JevError::Capability {
                    upstream_id: upstream_id.to_string(),
                    detail: format!("format mismatch: TypeSafe image asset '{reference}' dimensions must be between 280 and 1568 pixels on each side"),
                });
            }
            needs_images_header = true;
            has_image = true;
            projected.insert(
                reference.clone(),
                json!({ "type":"image", "format":format, "data_base64":encoded }),
            );
        } else if forward_extensions {
            // An explicitly configured TypeSafe-compatible local endpoint may
            // implement audio/video/file assets. Preserve its complete descriptor.
            projected.insert(
                reference.clone(),
                serde_json::to_value(asset).map_err(|error| JevError::Config {
                    upstream_id: upstream_id.to_string(),
                    message: format!("serialize provider asset: {error}"),
                })?,
            );
        } else {
            return Err(JevError::Capability {
                upstream_id: upstream_id.to_string(),
                detail: format!("format mismatch: TypeSafe official projection does not support asset type '{}'", asset.r#type),
            });
        }
    }
    Ok(ProjectedAssets {
        assets: Some(projected),
        needs_images_header,
        has_image,
    })
}

/// Read only the format and dimensions needed to validate the TypeSafe image
/// projection. The original bytes remain unchanged; no lossy resize is applied.
fn image_format_and_dimensions(bytes: &[u8]) -> Option<(&'static str, u32, u32)> {
    const PNG_SIGNATURE: &[u8; 8] = b"\x89PNG\r\n\x1a\n";
    if bytes.starts_with(PNG_SIGNATURE) && bytes.get(12..16) == Some(b"IHDR") {
        let width = u32::from_be_bytes(bytes.get(16..20)?.try_into().ok()?);
        let height = u32::from_be_bytes(bytes.get(20..24)?.try_into().ok()?);
        return (width > 0 && height > 0).then_some(("png", width, height));
    }

    if !bytes.starts_with(&[0xff, 0xd8]) {
        return None;
    }
    let mut cursor = 2usize;
    while cursor < bytes.len() {
        while bytes.get(cursor) == Some(&0xff) {
            cursor += 1;
        }
        let marker = *bytes.get(cursor)?;
        cursor += 1;
        if marker == 0xd9 || marker == 0xda {
            return None;
        }
        if matches!(marker, 0x01 | 0xd0..=0xd7) {
            continue;
        }
        let length = usize::from(u16::from_be_bytes(
            bytes.get(cursor..cursor + 2)?.try_into().ok()?,
        ));
        if length < 2 || cursor.checked_add(length)? > bytes.len() {
            return None;
        }
        if matches!(marker, 0xc0..=0xc3 | 0xc5..=0xc7 | 0xc9..=0xcb | 0xcd..=0xcf) {
            let height = u32::from(u16::from_be_bytes(
                bytes.get(cursor + 3..cursor + 5)?.try_into().ok()?,
            ));
            let width = u32::from(u16::from_be_bytes(
                bytes.get(cursor + 5..cursor + 7)?.try_into().ok()?,
            ));
            return (width > 0 && height > 0).then_some(("jpg", width, height));
        }
        cursor += length;
    }
    None
}

fn has_typesafe_score_legend(answer: &serde_json::Value) -> bool {
    let Some(legend) = answer.get("legend").and_then(serde_json::Value::as_object) else {
        return false;
    };
    let Some(probabilities) = answer
        .get("probabilities")
        .and_then(serde_json::Value::as_object)
    else {
        return false;
    };
    !probabilities.is_empty()
        && legend.len() == probabilities.len()
        && legend.iter().all(|(level, description)| {
            description.is_string() && probabilities.contains_key(level)
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use jev_protocol::{Answer, Criteria, CriterionValue, Instructions, Question, Usage};
    use serde_json::json;
    use std::collections::BTreeMap;
    use wiremock::matchers::{body_json, header, method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    fn complete_request() -> JevRequest {
        let questions = BTreeMap::from([
            (
                "choice".into(),
                Question::Choice {
                    instructions: Instructions::Array(vec![
                        json!("choose one"),
                        json!({"detail": "structured"}),
                    ]),
                    criteria: Criteria::Map(BTreeMap::from([
                        ("A".into(), "first".into()),
                        (
                            "B".into(),
                            CriterionValue::Object(BTreeMap::from([(
                                "label".into(),
                                json!("second"),
                            )])),
                        ),
                        (
                            "C".into(),
                            CriterionValue::Array(vec![json!("third"), json!({"nested": true})]),
                        ),
                        ("D".into(), CriterionValue::Null),
                    ])),
                },
            ),
            (
                "noul".into(),
                Question::Noul {
                    instructions: "is it true?".into(),
                    criteria: None,
                },
            ),
            (
                "score".into(),
                Question::Score {
                    instructions: Instructions::Object(BTreeMap::from([
                        ("prompt".into(), json!("rate this")),
                        ("context".into(), json!(["structured"])),
                    ])),
                    criteria: Criteria::List(vec![
                        "low".into(),
                        CriterionValue::Object(BTreeMap::from([("level".into(), json!(2))])),
                        CriterionValue::Array(vec![json!("high"), json!("certain")]),
                    ]),
                },
            ),
        ]);
        JevRequest {
            model: "jev-latest".into(),
            state: json!({"text": "hello"}),
            questions,
            assets: None,
            extensions: Default::default(),
            extra: Default::default(),
        }
    }

    fn png_fixture(width: u32, height: u32) -> Vec<u8> {
        let mut bytes = vec![0; 24];
        bytes[..8].copy_from_slice(b"\x89PNG\r\n\x1a\n");
        bytes[12..16].copy_from_slice(b"IHDR");
        bytes[16..20].copy_from_slice(&width.to_be_bytes());
        bytes[20..24].copy_from_slice(&height.to_be_bytes());
        bytes
    }

    fn png_asset(bytes: &[u8]) -> jev_protocol::RequestAsset {
        jev_protocol::RequestAsset {
            r#type: "image".into(),
            format: Some("png".into()),
            mime_type: Some("image/png".into()),
            filename: Some("fixture.png".into()),
            data_base64: Some(STANDARD.encode(bytes)),
            asset_id: None,
        }
    }

    #[tokio::test]
    async fn region_denial_preserves_status_and_is_not_retryable() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/v1/systemone"))
            .respond_with(ResponseTemplate::new(451).set_body_json(json!({
                "title": "Typesafe is not available in your region.",
                "status": 451
            })))
            .expect(1)
            .mount(&server)
            .await;
        let upstream =
            TypeSafeUpstream::new(format!("{}/v1/systemone", server.uri()), None).unwrap();
        let error = upstream.evaluate(complete_request()).await.unwrap_err();
        assert_eq!(error.http_status(), 451);
        assert!(!error.retryable());
        assert!(matches!(error, JevError::Upstream { status: 451, body, .. }
            if body.contains("not available in your region")));
    }

    #[tokio::test]
    async fn sends_official_systemone_request_and_parses_all_answer_variants() {
        let server = MockServer::start().await;
        let request = complete_request();
        Mock::given(method("POST"))
            .and(path("/v1/systemone"))
            .and(header("authorization", "Bearer test-typesafe-key"))
            .and(body_json(json!({
                "model": "jev-latest",
                "state": {"text": "hello"},
                "questions": {
                    "choice": {"type": "choice", "instructions": ["choose one", {"detail": "structured"}], "criteria": {"A": "first", "B": {"label": "second"}, "C": ["third", {"nested": true}], "D": null}},
                    "noul": {"type": "noul", "instructions": "is it true?"},
                    "score": {"type": "score", "instructions": {"prompt": "rate this", "context": ["structured"]}, "criteria": ["low", {"level": 2}, ["high", "certain"]]}
                }
            })))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "model": "jev-latest",
                "answers": {
                    "choice": {"type": "choice", "choice": "A", "probabilities": {"A": 0.8, "B": 0.2}, "confidence": 0.8},
                    "noul": {"type": "noul", "noul": 0.91},
                    "score": {"type": "score", "score": 1.5, "legend": {"1": "low", "2": "high"}, "probabilities": {"1": 0.5, "2": 0.5}, "confidence": 0.7}
                },
                "usage": {"input_tokens": 42, "output_tokens": 3}
            })))
            .expect(1)
            .mount(&server)
            .await;

        let upstream = TypeSafeUpstream::new(
            format!("{}/v1/systemone", server.uri()),
            Some("test-typesafe-key".into()),
        )
        .unwrap();
        let response = upstream.evaluate(request).await.unwrap();

        assert_eq!(response.model.as_deref(), Some("jev-latest"));
        assert!(matches!(response.answers["choice"], Answer::Choice { .. }));
        assert!(matches!(response.answers["noul"], Answer::Noul(_)));
        let Answer::Score { score, legend, .. } = &response.answers["score"] else {
            panic!("expected score answer");
        };
        assert_eq!(*score, 1.5);
        assert_eq!(legend.as_ref(), Some(&json!({"1": "low", "2": "high"})));
        assert_eq!(
            response.usage,
            Some(Usage {
                input_tokens: Some(42),
                output_tokens: Some(3),
                reasoning_tokens: None,
            })
        );
        assert_eq!(server.received_requests().await.unwrap().len(), 1);
    }

    #[tokio::test]
    async fn local_typesafe_compatible_endpoint_needs_no_api_key() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/v1/systemone"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({"answers": {}})))
            .expect(1)
            .mount(&server)
            .await;

        let upstream =
            TypeSafeUpstream::new(format!("{}/v1/systemone", server.uri()), None).unwrap();
        upstream.evaluate(complete_request()).await.unwrap();

        let requests = server.received_requests().await.unwrap();
        assert_eq!(requests.len(), 1);
        assert!(!requests[0].headers.contains_key("authorization"));
    }

    #[tokio::test]
    async fn image_projection_keeps_typed_reference_and_adds_required_header() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/v1/systemone"))
            .and(header("TypeSafe-Danger-Zone-Images", "true"))
            .and(body_json(json!({
                "model": "jev-latest",
                "state": {"text":"inspect", "media":["image_fixture"]},
                "questions": {
                    "choice": {"type":"choice", "instructions":["choose one", {"detail":"structured"}], "criteria":{"A":"first", "B":{"label":"second"}, "C":["third", {"nested":true}], "D":null}},
                    "noul": {"type":"noul", "instructions":"is it true?"},
                    "score": {"type":"score", "instructions":{"context":["structured"], "prompt":"rate this"}, "criteria":["low", {"level":2}, ["high", "certain"]]}
                },
                "assets": {
                    "image_fixture": {"type":"image", "format":"png", "data_base64": STANDARD.encode(png_fixture(300, 300))}
                }
            })))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({"answers": {}})))
            .expect(1)
            .mount(&server)
            .await;

        let mut request = complete_request();
        request.state = json!({"text":"inspect", "media":["image_fixture"]});
        request.assets = Some(BTreeMap::from([(
            "image_fixture".into(),
            png_asset(&png_fixture(300, 300)),
        )]));
        let upstream =
            TypeSafeUpstream::new(format!("{}/v1/systemone", server.uri()), None).unwrap();
        upstream.evaluate(request).await.unwrap();
        let captured = server.received_requests().await.unwrap();
        assert_eq!(captured.len(), 1);
        assert_eq!(
            captured[0]
                .headers
                .get("TypeSafe-Danger-Zone-Images")
                .unwrap(),
            "true"
        );
        let body: Value = serde_json::from_slice(&captured[0].body).unwrap();
        assert_eq!(body["assets"]["image_fixture"]["format"], "png");
        assert!(body["assets"]["image_fixture"].get("asset_id").is_none());
        assert!(body["assets"]["image_fixture"].get("mime_type").is_none());
    }

    #[tokio::test]
    async fn typesafe_box_question_requires_image_and_projects_box_answer() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/v1/systemone"))
            .and(header("TypeSafe-Danger-Zone-Images", "true"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "answers": {"box": {"type":"box", "box":{"top":0.1,"bottom":0.8,"left":0.2,"right":0.9}, "confidence":0.75}}
            })))
            .expect(1)
            .mount(&server)
            .await;
        let mut request = complete_request();
        request.questions = BTreeMap::from([(
            "box".into(),
            Question::Box {
                instructions: "locate the chart".into(),
            },
        )]);
        request.state = json!({"text":"find region", "media":["image_fixture"]});
        request.assets = Some(BTreeMap::from([(
            "image_fixture".into(),
            png_asset(&png_fixture(300, 300)),
        )]));

        let upstream =
            TypeSafeUpstream::new(format!("{}/v1/systemone", server.uri()), None).unwrap();
        let response = upstream.evaluate(request).await.unwrap();
        assert!(matches!(response.answers["box"], Answer::Box(_)));
    }

    #[test]
    fn type_safe_image_projection_rejects_mime_spoof_and_out_of_range_dimensions() {
        let bytes = png_fixture(300, 300);
        let mut spoofed = png_asset(&bytes);
        spoofed.mime_type = Some("image/jpeg".into());
        let error = project_assets(
            "typesafe",
            Some(&BTreeMap::from([("img".into(), spoofed)])),
            false,
        )
        .unwrap_err();
        assert!(error.to_string().contains("MIME and format disagree"));

        let too_small = png_asset(&png_fixture(200, 300));
        let error = project_assets(
            "typesafe",
            Some(&BTreeMap::from([("img".into(), too_small)])),
            false,
        )
        .unwrap_err();
        assert!(error.to_string().contains("dimensions"));
    }

    #[test]
    fn non_image_assets_require_explicit_compatible_endpoint_and_preserve_the_descriptor() {
        let adapter = TypeSafeUpstream::new_with_id_and_options(
            "local-typesafe-compatible".into(),
            "http://127.0.0.1:9/v1/systemone".into(),
            None,
            true,
        )
        .unwrap();
        for (kind, format, mime, filename) in [
            ("audio", "wav", "audio/wav", "voice.wav"),
            ("video", "mp4", "video/mp4", "clip.mp4"),
            ("file", "pdf", "application/pdf", "report.pdf"),
        ] {
            let reference = format!("{kind}_ref");
            let asset = jev_protocol::RequestAsset {
                r#type: kind.into(),
                format: Some(format.into()),
                mime_type: Some(mime.into()),
                filename: Some(filename.into()),
                data_base64: Some("AAECAw==".into()),
                asset_id: None,
            };
            let assets = BTreeMap::from([(reference.clone(), asset.clone())]);

            let official = project_assets("typesafe", Some(&assets), false).unwrap_err();
            assert!(official
                .to_string()
                .contains(&format!("does not support asset type '{kind}'")));

            let local = project_assets("local-typesafe-compatible", Some(&assets), true).unwrap();
            assert!(!local.has_image);
            assert_eq!(
                local.assets.unwrap()[&reference],
                serde_json::to_value(asset).unwrap(),
                "compatible endpoint receives the complete {kind} descriptor"
            );
            assert!(adapter.supports_asset_type(kind));
        }
    }

    #[tokio::test]
    async fn extension_forwarding_is_opt_in_and_flattens_media_for_compatible_gateways() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/v1/systemone"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({"answers": {}})))
            .expect(1)
            .mount(&server)
            .await;

        let mut request = complete_request();
        request.extensions.get_or_insert_default().insert(
            "media".into(),
            json!([{"type":"image","data":"data:image/png;base64,AA=="}]),
        );
        let upstream = TypeSafeUpstream::new_with_id_and_options(
            "multimodal-gateway".into(),
            format!("{}/v1/systemone", server.uri()),
            None,
            true,
        )
        .unwrap();
        let response = upstream.evaluate(request).await.unwrap();
        assert_eq!(
            response.extra["jev_switch"]["request_extensions"]["provider_disposition"],
            "forwarded"
        );

        let requests = server.received_requests().await.unwrap();
        let body: serde_json::Value = serde_json::from_slice(&requests[0].body).unwrap();
        assert_eq!(body["media"][0]["type"], "image");
        assert!(body.get("extensions").is_none());
    }

    #[tokio::test]
    async fn extension_payload_is_stripped_for_official_compatible_defaults() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/v1/systemone"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({"answers": {}})))
            .expect(1)
            .mount(&server)
            .await;

        let mut request = complete_request();
        request
            .extensions
            .get_or_insert_default()
            .insert("media".into(), json!([]));
        let upstream =
            TypeSafeUpstream::new(format!("{}/v1/systemone", server.uri()), None).unwrap();
        let response = upstream.evaluate(request).await.unwrap();
        assert_eq!(
            response.extra["jev_switch"]["request_extensions"]["provider_disposition"],
            "stripped"
        );

        let requests = server.received_requests().await.unwrap();
        let body: serde_json::Value = serde_json::from_slice(&requests[0].body).unwrap();
        assert!(body.get("media").is_none());
        assert!(body.get("extensions").is_none());
    }

    #[tokio::test]
    async fn score_answer_requires_a_matching_string_legend_map() {
        let invalid_legends = [
            None,
            Some(json!(null)),
            Some(json!(["low"])),
            Some(json!({"1": 1})),
            Some(json!({"other": "low"})),
        ];
        for legend in invalid_legends {
            let server = MockServer::start().await;
            let mut score = json!({
                "type": "score",
                "score": 1.0,
                "probabilities": {"1": 1.0},
                "confidence": 1.0
            });
            if let Some(legend) = legend {
                score["legend"] = legend;
            }
            Mock::given(method("POST"))
                .and(path("/v1/systemone"))
                .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                    "answers": {"score": score}
                })))
                .expect(1)
                .mount(&server)
                .await;

            let upstream =
                TypeSafeUpstream::new(format!("{}/v1/systemone", server.uri()), None).unwrap();
            let error = upstream.evaluate(complete_request()).await.unwrap_err();
            assert!(matches!(
                error,
                JevError::BadResponse { message, .. }
                    if message.contains("invalid TypeSafe score legend")
            ));
        }
    }

    #[test]
    fn capabilities_match_native_typesafe_and_retry_documented_rate_limits() {
        assert!(TYPESAFE_CAPABILITIES.supports(QuestionType::Choice));
        assert!(TYPESAFE_CAPABILITIES.supports(QuestionType::Score));
        assert!(TYPESAFE_CAPABILITIES.supports(QuestionType::Noul));
        assert!(TYPESAFE_CAPABILITIES.supports(QuestionType::Box));
        const {
            assert!(TYPESAFE_CAPABILITIES.has_confidence);
            assert!(TYPESAFE_CAPABILITIES.has_usage);
        }
        assert!(TYPESAFE_CAPABILITIES.is_retryable_status(429));
        assert!(TYPESAFE_CAPABILITIES.is_retryable_status(529));
        assert!(!TYPESAFE_CAPABILITIES.is_retryable_status(401));
        assert_eq!(
            TYPESAFE_OFFICIAL_BASE,
            "https://api.typesafe.ai/v1/systemone"
        );
    }
}
