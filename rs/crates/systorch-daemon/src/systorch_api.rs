//! Canonical SysTorch request envelope at the gateway boundary.
//!
//! The frozen TypeSafe-compatible `model/state/questions` core is flattened
//! beside SysTorch-owned presentation metadata. The daemon consumes that
//! metadata before routing, so the upstream adapter only sees the request
//! semantics it can preserve.

use jev_protocol::JevRequest;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[cfg_attr(
    feature = "ts-rs",
    derive(::ts_rs::TS),
    ts(export, export_to = "../../../../ui/src/generated/")
)]
pub struct SysTorchRequest {
    #[serde(flatten)]
    #[cfg_attr(feature = "ts-rs", ts(flatten))]
    pub request: JevRequest,
    /// Stable UI order for the question map. It is not part of TypeSafe's
    /// request semantics and is removed before the adapter boundary.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts-rs", ts(optional))]
    pub question_order: Option<Vec<String>>,
}

impl SysTorchRequest {
    /// Validate the UI-order extension and return its TypeSafe-compatible core.
    ///
    /// When omitted, callers may use lexical question-ID order. When present,
    /// every question must appear exactly once; silently dropping or inventing
    /// IDs would make the returned answer map ambiguous to the caller.
    pub fn into_request(self) -> Result<JevRequest, &'static str> {
        if let Some(order) = &self.question_order {
            let expected: HashSet<&str> =
                self.request.questions.keys().map(String::as_str).collect();
            let actual: HashSet<&str> = order.iter().map(String::as_str).collect();
            if order.len() != expected.len() || actual.len() != order.len() || actual != expected {
                return Err("question_order must list each question ID exactly once");
            }
        }
        Ok(self.request)
    }
}

#[cfg(test)]
mod tests {
    use super::SysTorchRequest;
    use serde_json::json;

    fn body(order: serde_json::Value) -> serde_json::Value {
        json!({
            "model": "entry-model",
            "state": {"text": "synthetic"},
            "questions": {
                "first": {"type": "noul", "instructions": "first"},
                "second": {"type": "choice", "instructions": "second", "criteria": {"a": "A", "b": "B"}}
            },
            "question_order": order,
            "extensions": {"vendor_hint": {"preserve": true}},
            "future_top_level": "preserved by the compatibility core"
        })
    }

    #[test]
    fn request_order_is_consumed_and_type_safe_core_is_preserved() {
        let parsed: SysTorchRequest = serde_json::from_value(body(json!(["second", "first"])))
            .expect("canonical SysTorch request parses");
        let request = parsed.into_request().expect("valid order");
        assert_eq!(request.questions.len(), 2);
        assert_eq!(request.extensions.unwrap()["vendor_hint"]["preserve"], true);
        assert_eq!(
            request.extra["future_top_level"],
            "preserved by the compatibility core"
        );
        assert!(!request.extra.contains_key("question_order"));
    }

    #[test]
    fn request_order_rejects_missing_duplicate_and_unknown_ids() {
        for invalid in [
            json!(["first"]),
            json!(["first", "first"]),
            json!(["first", "unknown"]),
        ] {
            let parsed: SysTorchRequest = serde_json::from_value(body(invalid)).unwrap();
            assert_eq!(
                parsed.into_request().unwrap_err(),
                "question_order must list each question ID exactly once"
            );
        }
    }

    #[test]
    fn question_order_is_optional_for_non_ui_callers() {
        let mut value = body(json!(["first", "second"]));
        value.as_object_mut().unwrap().remove("question_order");
        let parsed: SysTorchRequest = serde_json::from_value(value).unwrap();
        assert!(parsed.into_request().is_ok());
    }
}
