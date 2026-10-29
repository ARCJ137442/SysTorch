//! Durable human Choice control plane; never blocks or impersonates an upstream attempt.
mod sessions;
mod store;
#[cfg(test)]
mod tests;
pub mod vault;

use crate::{auth, tokens, AppState};
use axum::{
    extract::{DefaultBodyLimit, Path, Query, State},
    http::{header, HeaderMap, HeaderValue, StatusCode},
    middleware,
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use jev_protocol::{
    Answer as JevAnswer, BoxAnswer, BoxCoordinates, Criteria, CriterionValue, Instructions,
    JevRequest, NoulAnswer, NoulKind, Question, RequestAsset,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;

const OWNER: &str = "local-owner";
const MAX_BODY: usize = 64 * 1024;
const RETENTION: i64 = 7 * 86400;
const CAPACITY: i64 = 10000;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[cfg_attr(
    feature = "ts-rs",
    derive(::ts_rs::TS),
    ts(export, export_to = "../../../../ui/src/generated/")
)]
#[serde(deny_unknown_fields)]
pub struct Choice {
    pub id: String,
    pub label: String,
}

/// Deprecated M1 input type. New code uses the shared Jev `Question` union below.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[cfg_attr(
    feature = "ts-rs",
    derive(::ts_rs::TS),
    ts(export, export_to = "../../../../ui/src/generated/")
)]
#[serde(deny_unknown_fields)]
pub struct ChoiceQuestion {
    pub r#type: String,
    pub instructions: Value,
    pub criteria: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[cfg_attr(
    feature = "ts-rs",
    derive(::ts_rs::TS),
    ts(export, export_to = "../../../../ui/src/generated/")
)]
#[serde(deny_unknown_fields)]
pub struct Submission {
    /// TypeSafe-compatible core fields. Together these form the canonical
    /// SysTorch request surface; legacy M1 fields below remain read-compatible.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts-rs", ts(optional))]
    pub model: Option<String>,
    #[serde(
        default,
        deserialize_with = "deserialize_present_value",
        skip_serializing_if = "Option::is_none"
    )]
    #[cfg_attr(feature = "ts-rs", ts(optional))]
    pub state: Option<Value>,
    pub entry: String,
    pub idempotency_key: String,
    /// Legacy single-question mirror. For a multi-question request this must
    /// equal the first question selected by `question_order`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts-rs", ts(optional))]
    pub question: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts-rs", ts(optional))]
    pub context: Option<Value>,
    /// Legacy Choice mirror. Empty when the first typed question is not Choice.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts-rs", ts(optional))]
    pub choices: Option<Vec<Choice>>,
    /// TypeSafe/Jev questions keyed by stable question ID.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts-rs", ts(optional))]
    pub questions: Option<BTreeMap<String, Question>>,
    /// Stable UI sequence for the `questions` map. If omitted, IDs are ordered
    /// lexically. This extension is ignored by TypeSafe-compatible projection.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts-rs", ts(optional))]
    pub question_order: Option<Vec<String>>,
    /// Asset metadata/references encrypted with this task; raw uploaded bytes
    /// remain in the encrypted asset table and are linked by stable ID.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts-rs", ts(optional))]
    pub assets: Option<BTreeMap<String, RequestAsset>>,
    /// Namespaced SysTorch/provider extensions. TypeSafe projection removes
    /// these unless the selected adapter explicitly supports them.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts-rs", ts(optional))]
    pub extensions: Option<BTreeMap<String, Value>>,
    #[serde(default = "default_ttl")]
    #[cfg_attr(feature = "ts-rs", ts(type = "number"))]
    pub ttl_seconds: i64,
}

impl Submission {
    /// Project the SysTorch task envelope onto the TypeSafe-compatible Jev
    /// request. Lifecycle/idempotency/order fields are intentionally omitted.
    pub(super) fn jev_projection(&self) -> Option<JevRequest> {
        let model = self.model.clone().unwrap_or_else(|| self.entry.clone());
        let state = self
            .state
            .clone()
            .or_else(|| self.context.clone())
            .unwrap_or(Value::Null);
        let questions = match &self.questions {
            Some(questions) => questions.clone(),
            None => BTreeMap::from([("choice".into(), question(self, "choice")?)]),
        };
        Some(JevRequest {
            model,
            state,
            questions,
            assets: self.assets.clone(),
            extensions: self.extensions.clone(),
            extra: BTreeMap::new(),
        })
    }
}

fn deserialize_present_value<'de, D>(
    deserializer: D,
) -> std::result::Result<Option<Value>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    Value::deserialize(deserializer).map(Some)
}

fn default_ttl() -> i64 {
    86400
}

fn json_body<T>(
    body: std::result::Result<Json<T>, axum::extract::rejection::JsonRejection>,
) -> Result<T> {
    body.map(|Json(value)| value).map_err(|error| {
        if error.status()==StatusCode::PAYLOAD_TOO_LARGE { fault(StatusCode::PAYLOAD_TOO_LARGE,"decision_too_large","Keep the complete JSON request within 64 KiB.") }
        else { fault(StatusCode::UNPROCESSABLE_ENTITY,"invalid_decision_json","Send application/json with the documented fields and types; unknown fields and unsupported media are rejected.") }
    })
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[cfg_attr(
    feature = "ts-rs",
    derive(::ts_rs::TS),
    ts(export, export_to = "../../../../ui/src/generated/")
)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum Observation {
    Answered {
        choice_id: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[cfg_attr(feature = "ts-rs", ts(optional))]
        note: Option<String>,
    },
    Declined {
        reason: String,
    },
    Conditional {
        choice_id: String,
        condition: String,
    },
    Noul {
        value: bool,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[cfg_attr(feature = "ts-rs", ts(optional))]
        note: Option<String>,
    },
    Score {
        /// TypeSafe level index; levels are zero-based in the ordered criteria list.
        level_index: u8,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[cfg_attr(feature = "ts-rs", ts(optional))]
        note: Option<String>,
    },
    Box {
        top: f64,
        bottom: f64,
        left: f64,
        right: f64,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[cfg_attr(feature = "ts-rs", ts(optional))]
        note: Option<String>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(
    feature = "ts-rs",
    derive(::ts_rs::TS),
    ts(export, export_to = "../../../../ui/src/generated/")
)]
#[serde(deny_unknown_fields)]
pub struct AnswerSubmission {
    #[cfg_attr(feature = "ts-rs", ts(type = "number"))]
    pub revision: i64,
    /// Optional question ID for a legacy one-answer submission. Omitted means
    /// the legacy `choice` question.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts-rs", ts(optional))]
    pub question_id: Option<String>,
    /// Legacy one-answer body, retained for existing M1 clients.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts-rs", ts(optional))]
    pub observation: Option<Observation>,
    /// Atomic answer batch. Each ID must belong to the submitted question map.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts-rs", ts(optional))]
    pub observations: Option<BTreeMap<String, Observation>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(
    feature = "ts-rs",
    derive(::ts_rs::TS),
    ts(export, export_to = "../../../../ui/src/generated/")
)]
pub struct Task {
    pub id: String,
    pub caller: String,
    pub assignee: String,
    #[cfg_attr(feature = "ts-rs", ts(type = "number"))]
    pub revision: i64,
    pub status: String,
    #[cfg_attr(feature = "ts-rs", ts(type = "number"))]
    pub created_at: i64,
    #[cfg_attr(feature = "ts-rs", ts(type = "number"))]
    pub deadline: i64,
    #[cfg_attr(feature = "ts-rs", ts(type = "number"))]
    pub updated_at: i64,
    pub request: Submission,
    pub observation: Option<Observation>,
    /// Per-question accepted observations. Empty/missing means legacy M1 data.
    #[serde(default)]
    pub observations: BTreeMap<String, Observation>,
    pub projection_policy: String,
    pub previous_requests: Vec<Submission>,
    pub clarifications: Vec<String>,
}

pub(super) fn ordered_question_ids(request: &Submission) -> Vec<String> {
    if let Some(questions) = &request.questions {
        if let Some(order) = &request.question_order {
            return order.clone();
        }
        return questions.keys().cloned().collect();
    }
    vec!["choice".into()]
}

pub(super) fn question_choices(request: &Submission, question_id: &str) -> Option<Vec<Choice>> {
    if let Some(questions) = &request.questions {
        let Question::Choice { criteria, .. } = questions.get(question_id)? else {
            return None;
        };
        let Criteria::Map(criteria) = criteria else {
            return None;
        };
        return Some(
            criteria
                .iter()
                .map(|(id, value)| Choice {
                    id: id.clone(),
                    label: match value {
                        CriterionValue::Text(text) => text.clone(),
                        CriterionValue::Null => id.clone(),
                        other => serde_json::to_string(other).unwrap_or_else(|_| id.clone()),
                    },
                })
                .collect(),
        );
    }
    (question_id == "choice")
        .then(|| request.choices.clone())
        .flatten()
}

pub(super) fn question(request: &Submission, question_id: &str) -> Option<Question> {
    if let Some(questions) = &request.questions {
        return questions.get(question_id).cloned();
    }
    if question_id != "choice" {
        return None;
    }
    let question = request.question.as_ref()?;
    let choices = request.choices.as_ref()?;
    let criteria = choices
        .iter()
        .map(|choice| {
            (
                choice.id.clone(),
                CriterionValue::Text(choice.label.clone()),
            )
        })
        .collect();
    Some(Question::Choice {
        instructions: Instructions::Text(question.clone()),
        criteria: Criteria::Map(criteria),
    })
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Revision {
    revision: i64,
    question: String,
    context: Value,
    choices: Vec<Choice>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Clarification {
    revision: i64,
    question: String,
}

#[derive(Debug)]
pub(super) struct Fault(StatusCode, &'static str, &'static str);
impl IntoResponse for Fault {
    fn into_response(self) -> Response {
        (
            self.0,
            Json(serde_json::json!({"code": self.1, "error": self.2})),
        )
            .into_response()
    }
}
type Result<T> = std::result::Result<T, Fault>;
fn fault(status: StatusCode, code: &'static str, message: &'static str) -> Fault {
    Fault(status, code, message)
}
fn internal(_: impl std::fmt::Display) -> Fault {
    // Payloads, credentials and SQL details must never leak into diagnostics.
    fault(StatusCode::INTERNAL_SERVER_ERROR,"decision_storage_unavailable","Decision storage could not be read or committed. Check disk space and restore the matching database and owner key; retry with the same idempotency key.")
}
fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("system clock")
        .as_secs() as i64
}

fn identity(state: &AppState, headers: &HeaderMap) -> Result<String> {
    let token = auth::bearer_token(headers).ok_or_else(|| {
        fault(
            StatusCode::UNAUTHORIZED,
            "decision_auth_required",
            "Use a managed caller token, or open the native app as its local owner.",
        )
    })?;
    let vault = vault::Vault::open(&state.config_path, false).map_err(internal)?;
    let conn = state.db_conn.lock().map_err(internal)?;
    let caller = if auth::ct_eq(token.as_bytes(), vault.owner_token().as_bytes()) {
        OWNER.to_string()
    } else {
        tokens::lookup_secret(&conn, token)
            .map_err(internal)?
            .map(|v| v.id)
            .ok_or_else(|| {
                fault(
                    StatusCode::UNAUTHORIZED,
                    "decision_auth_required",
                    "The caller token is absent, disabled or invalid. Check access management.",
                )
            })?
    };
    validate_key(&conn, &vault).map_err(internal)?;
    Ok(caller)
}

pub fn initialize(conn: &rusqlite::Connection, config: &std::path::Path) -> anyhow::Result<()> {
    let count: i64 = conn.query_row("SELECT count(*) FROM decision_tasks", [], |r| r.get(0))?;
    let vault = vault::Vault::open(config, count == 0)?;
    validate_key(conn, &vault)
}

fn validate_key(conn: &rusqlite::Connection, vault: &vault::Vault) -> anyhow::Result<()> {
    // Refuse a mismatched key before accepting more tasks after a restore, even
    // if the key file changes while this daemon is already running.
    let sample: Option<(String, Vec<u8>)> = {
        use rusqlite::OptionalExtension;
        conn.query_row(
            "SELECT id,payload FROM decision_tasks WHERE length(payload)>0 LIMIT 1",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?
    };
    if let Some((id, payload)) = sample {
        vault.open_payload(&id, &payload)?;
    }
    Ok(())
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/v1/systorch/identity", get(whoami))
        .route("/v1/systorch/decisions", post(create).get(list))
        .route(
            "/v1/systorch/decisions/:id/assets/:asset_id",
            get(task_asset),
        )
        .route("/v1/systorch/decisions/:id", get(read).delete(erase))
        .route("/v1/systorch/decisions/:id/answers", post(answer))
        .route("/v1/systorch/decisions/:id/cancel", post(cancel))
        .route("/v1/systorch/decisions/:id/revisions", post(revise))
        .route("/v1/systorch/decisions/:id/clarifications", post(clarify))
        .route("/v1/systorch/decisions/:id/result", get(result))
        .layer(DefaultBodyLimit::max(MAX_BODY))
        .layer(middleware::map_response(no_store))
        .merge(sessions::routes())
}

async fn no_store(mut response: Response) -> Response {
    // JSON contains private questions/observations. Do not let browser/WebView
    // disk caches undermine encrypted storage or replay stale authorization.
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    response
}

async fn whoami(State(state): State<AppState>, headers: HeaderMap) -> Result<Json<Value>> {
    let id = identity(&state, &headers)?;
    Ok(Json(
        serde_json::json!({"id":id,"can_answer":id==OWNER,"entry":"human:owner","retention_seconds":RETENTION}),
    ))
}
async fn create(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: std::result::Result<Json<Submission>, axum::extract::rejection::JsonRejection>,
) -> Result<Response> {
    let caller = identity(&state, &headers)?;
    let mut conn = state.db_conn.lock().map_err(internal)?;
    let vault = vault::Vault::open(&state.config_path, false).map_err(internal)?;
    let (task, created) = store::create(&mut conn, &vault, &caller, json_body(body)?, now())?;
    Ok((
        if created {
            StatusCode::ACCEPTED
        } else {
            StatusCode::OK
        },
        Json(task),
    )
        .into_response())
}
#[derive(Deserialize)]
struct Page {
    #[serde(default)]
    offset: u32,
}
async fn list(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(page): Query<Page>,
) -> Result<Json<Vec<Task>>> {
    let caller = identity(&state, &headers)?;
    let conn = state.db_conn.lock().map_err(internal)?;
    let vault = vault::Vault::open(&state.config_path, false).map_err(internal)?;
    store::list(&conn, &vault, &caller, page.offset, now()).map(Json)
}
async fn read(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<Task>> {
    let caller = identity(&state, &headers)?;
    let conn = state.db_conn.lock().map_err(internal)?;
    let vault = vault::Vault::open(&state.config_path, false).map_err(internal)?;
    store::read(&conn, &vault, &caller, &id, now()).map(Json)
}

async fn task_asset(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((id, asset_id)): Path<(String, String)>,
) -> Result<Response> {
    let caller = identity(&state, &headers)?;
    let conn = state.db_conn.lock().map_err(internal)?;
    let vault = vault::Vault::open(&state.config_path, false).map_err(internal)?;
    // Task authorization is the authority for this scoped media read. The raw
    // asset endpoint remains owner-scoped; this route cannot enumerate assets.
    store::read(&conn, &vault, &caller, &id, now())?;
    crate::assets::download_for_task(&state, &conn, &id, &asset_id)
        .map_err(|error| fault(error.0, error.1, error.2))
}

async fn answer(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    body: std::result::Result<Json<AnswerSubmission>, axum::extract::rejection::JsonRejection>,
) -> Result<Json<Task>> {
    let caller = identity(&state, &headers)?;
    if caller != OWNER {
        return Err(fault(StatusCode::FORBIDDEN,"answer_not_assigned","Only the assigned local owner can answer this task. A caller or admin role is not an answer permission."));
    }
    let mut conn = state.db_conn.lock().map_err(internal)?;
    let vault = vault::Vault::open(&state.config_path, false).map_err(internal)?;
    store::answer(&mut conn, &vault, &id, json_body(body)?, now()).map(Json)
}
async fn cancel(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<Task>> {
    let caller = identity(&state, &headers)?;
    let mut conn = state.db_conn.lock().map_err(internal)?;
    let vault = vault::Vault::open(&state.config_path, false).map_err(internal)?;
    store::cancel(&mut conn, &vault, &caller, &id, now()).map(Json)
}
async fn erase(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<StatusCode> {
    let caller = identity(&state, &headers)?;
    let mut conn = state.db_conn.lock().map_err(internal)?;
    store::erase(&mut conn, &caller, &id, now())?;
    Ok(StatusCode::NO_CONTENT)
}
async fn revise(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    body: std::result::Result<Json<Revision>, axum::extract::rejection::JsonRejection>,
) -> Result<Json<Task>> {
    let caller = identity(&state, &headers)?;
    let body = json_body(body)?;
    let mut conn = state.db_conn.lock().map_err(internal)?;
    let vault = vault::Vault::open(&state.config_path, false).map_err(internal)?;
    store::edit(&mut conn,&vault,&caller,&id,body.revision,now(),|task| {
        if task.caller!=caller { return Err(fault(StatusCode::FORBIDDEN,"revision_not_owned","Only the submitting caller may revise the facts; a responder may request clarification.")); }
        if task.request.questions.is_some() {
            return Err(fault(StatusCode::UNPROCESSABLE_ENTITY,"multi_question_revision_unsupported","A multi-question task cannot be revised as a single question. Submit a new message so its question IDs and answer mapping remain intact."));
        }
        let mut next=task.request.clone();
        next.model=None; next.state=None; next.question=Some(body.question); next.context=Some(body.context); next.choices=Some(body.choices);
        next.questions=None; next.question_order=None; next.extensions=None;
        store::validate(&next)?;
        task.previous_requests.push(std::mem::replace(&mut task.request,next));
        task.revision+=1;
        Ok(())
    }).map(Json)
}
async fn clarify(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    body: std::result::Result<Json<Clarification>, axum::extract::rejection::JsonRejection>,
) -> Result<Json<Task>> {
    if identity(&state, &headers)? != OWNER {
        return Err(fault(
            StatusCode::FORBIDDEN,
            "answer_not_assigned",
            "Only the assigned responder can request clarification.",
        ));
    }
    let body = json_body(body)?;
    if body.question.trim().is_empty() || body.question.len() > 4096 {
        return Err(fault(
            StatusCode::BAD_REQUEST,
            "invalid_clarification",
            "Enter a clarification question within 4096 bytes.",
        ));
    }
    let mut conn = state.db_conn.lock().map_err(internal)?;
    let vault = vault::Vault::open(&state.config_path, false).map_err(internal)?;
    store::edit(
        &mut conn,
        &vault,
        OWNER,
        &id,
        body.revision,
        now(),
        |task| {
            if !task.clarifications.contains(&body.question) {
                task.clarifications.push(body.question);
            }
            Ok(())
        },
    )
    .map(Json)
}
async fn result(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Response> {
    let caller = identity(&state, &headers)?;
    let conn = state.db_conn.lock().map_err(internal)?;
    let vault = vault::Vault::open(&state.config_path, false).map_err(internal)?;
    let task = store::read(&conn, &vault, &caller, &id, now())?;
    if task.status == "pending" {
        return Ok((
            StatusCode::ACCEPTED,
            Json(serde_json::json!({"id":id,"status":"pending","deadline":task.deadline})),
        )
            .into_response());
    }
    let response = project_decision_result(&task)?;
    Ok(Json(response).into_response())
}

fn project_decision_result(task: &Task) -> Result<jev_protocol::JevResponse> {
    let mut answers = BTreeMap::new();
    for question_id in ordered_question_ids(&task.request) {
        let question = question(&task.request, &question_id)
            .ok_or_else(|| internal("task question is missing its schema"))?;
        let observation = task.observations.get(&question_id).or_else(|| {
            (question_id == "choice")
                .then_some(task.observation.as_ref())
                .flatten()
        });
        let Some(observation) = observation else {
            return Err(fault(
                StatusCode::GONE,
                "decision_terminal",
                "The task has no complete answer set. Read the task before retrying.",
            ));
        };
        let answer = match (&question, observation) {
            (Question::Choice { .. }, Observation::Answered { choice_id, .. }) => {
                let choices = question_choices(&task.request, &question_id)
                    .ok_or_else(|| internal("Choice question has no option map"))?;
                let distribution: BTreeMap<_, _> = choices
                    .into_iter()
                    .map(|choice| {
                        (
                            choice.id.clone(),
                            if choice.id == *choice_id { 1.0 } else { 0.0 },
                        )
                    })
                    .collect();
                JevAnswer::Choice {
                    choice: choice_id.clone(),
                    probabilities: distribution,
                    confidence: 1.0,
                }
            }
            (Question::Noul { .. }, Observation::Noul { value, .. }) => {
                JevAnswer::Noul(NoulAnswer {
                    kind: NoulKind::Noul,
                    noul: Some(if *value { 1.0 } else { 0.0 }),
                    probability: None,
                })
            }
            (
                Question::Score {
                    criteria: Criteria::List(levels),
                    ..
                },
                Observation::Score { level_index, .. },
            ) => {
                let legend: BTreeMap<_, _> = levels
                    .iter()
                    .enumerate()
                    .map(|(index, level)| {
                        Ok((
                            index.to_string(),
                            serde_json::to_value(level).map_err(internal)?,
                        ))
                    })
                    .collect::<Result<_>>()?;
                let probabilities = levels
                    .iter()
                    .enumerate()
                    .map(|(index, _)| {
                        (
                            index.to_string(),
                            if index == usize::from(*level_index) {
                                1.0
                            } else {
                                0.0
                            },
                        )
                    })
                    .collect();
                JevAnswer::Score {
                    score: f64::from(*level_index),
                    legend: Some(serde_json::to_value(legend).map_err(internal)?),
                    probabilities,
                    confidence: 1.0,
                }
            }
            (
                Question::Box { .. },
                Observation::Box {
                    top,
                    bottom,
                    left,
                    right,
                    ..
                },
            ) => JevAnswer::Box(BoxAnswer {
                kind: "box".into(),
                coordinates: BoxCoordinates {
                    top: *top,
                    bottom: *bottom,
                    left: *left,
                    right: *right,
                },
                confidence: 1.0,
            }),
            (_, Observation::Conditional { .. }) => {
                return Err(fault(StatusCode::UNPROCESSABLE_ENTITY,"conditional_not_projectable","A conditional human answer cannot be represented by the strict Jev answer for this question. Read the task observation; do not treat it as unconditional approval."));
            }
            (_, Observation::Declined { .. }) => {
                return Err(fault(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "decision_declined",
                    "The human declined to answer. No selection or fallback result was invented.",
                ));
            }
            _ => {
                return Err(fault(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "answer_type_mismatch",
                    "The saved human observation does not match the request question type.",
                ));
            }
        };
        answers.insert(question_id, serde_json::to_value(answer).map_err(internal)?);
    }
    let model = task.request.model.as_deref().unwrap_or("human:owner");
    serde_json::from_value(serde_json::json!({"model":model,"answers":answers,"upstream_calls":0,"latency_ms":null,"cost_usd":null})).map_err(internal)
}
