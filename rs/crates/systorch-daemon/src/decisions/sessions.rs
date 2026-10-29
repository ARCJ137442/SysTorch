//! Encrypted, caller-scoped history for ordinary model conversations.
//! This is separate from upstream call history and durable human Choice tasks.

use super::{fault, identity, internal, now, vault, OWNER};
use crate::{assets, AppState};
use axum::{
    extract::{DefaultBodyLimit, Path, Query, State},
    http::{header, HeaderMap, HeaderValue, StatusCode},
    middleware,
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use jev_protocol::{Instructions, JevRequest, JevResponse, Question};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;

const MAX_SESSION_BODY: usize = 8 * 1024 * 1024;
const MAX_MESSAGES: usize = 512;
const SESSION_CAPACITY: i64 = 10_000;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(
    feature = "ts-rs",
    derive(::ts_rs::TS),
    ts(export, export_to = "../../../../ui/src/generated/")
)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum StartMessage {
    Request {
        id: String,
        #[cfg_attr(feature = "ts-rs", ts(type = "number"))]
        created_at: i64,
        request: JevRequest,
        #[serde(default)]
        question_order: Vec<String>,
    },
    Response {
        id: String,
        #[cfg_attr(feature = "ts-rs", ts(type = "number"))]
        created_at: i64,
        reply_to: String,
        response: JevResponse,
    },
    Failure {
        id: String,
        #[cfg_attr(feature = "ts-rs", ts(type = "number"))]
        created_at: i64,
        reply_to: String,
        error_code: String,
        #[cfg_attr(feature = "ts-rs", ts(type = "number | null"))]
        status: Option<u16>,
        retryable: bool,
        request_id: Option<String>,
    },
}

impl StartMessage {
    fn id(&self) -> &str {
        match self {
            Self::Request { id, .. } | Self::Response { id, .. } | Self::Failure { id, .. } => id,
        }
    }

    fn created_at(&self) -> i64 {
        match self {
            Self::Request { created_at, .. }
            | Self::Response { created_at, .. }
            | Self::Failure { created_at, .. } => *created_at,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(
    feature = "ts-rs",
    derive(::ts_rs::TS),
    ts(export, export_to = "../../../../ui/src/generated/")
)]
#[serde(deny_unknown_fields)]
pub struct StartSessionSummary {
    pub id: String,
    #[cfg_attr(feature = "ts-rs", ts(type = "number"))]
    pub revision: i64,
    #[cfg_attr(feature = "ts-rs", ts(type = "number"))]
    pub created_at: i64,
    #[cfg_attr(feature = "ts-rs", ts(type = "number"))]
    pub updated_at: i64,
    pub pinned: bool,
    pub archived: bool,
    #[cfg_attr(feature = "ts-rs", ts(type = "number"))]
    pub last_read_at: i64,
    pub title: String,
    pub message_count: usize,
    pub has_unread_reply: bool,
    pub interrupted: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(
    feature = "ts-rs",
    derive(::ts_rs::TS),
    ts(export, export_to = "../../../../ui/src/generated/")
)]
#[serde(deny_unknown_fields)]
pub struct StartSession {
    pub summary: StartSessionSummary,
    pub messages: Vec<StartMessage>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(
    feature = "ts-rs",
    derive(::ts_rs::TS),
    ts(export, export_to = "../../../../ui/src/generated/")
)]
#[serde(deny_unknown_fields)]
pub struct AppendStartMessage {
    #[cfg_attr(feature = "ts-rs", ts(type = "number"))]
    pub expected_revision: i64,
    pub message: StartMessage,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(
    feature = "ts-rs",
    derive(::ts_rs::TS),
    ts(export, export_to = "../../../../ui/src/generated/")
)]
#[serde(deny_unknown_fields)]
pub struct PatchStartSession {
    #[cfg_attr(feature = "ts-rs", ts(type = "number"))]
    pub expected_revision: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts-rs", ts(optional))]
    pub pinned: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts-rs", ts(optional))]
    pub archived: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts-rs", ts(optional))]
    pub mark_read: Option<bool>,
}

#[derive(Serialize, Deserialize)]
struct Payload {
    schema_version: u32,
    messages: Vec<StartMessage>,
}

struct SessionMetadata<'a> {
    id: &'a str,
    revision: i64,
    created_at: i64,
    updated_at: i64,
    last_read_at: i64,
    pinned: bool,
    archived: bool,
}

#[derive(Deserialize, Default)]
struct Page {
    #[serde(default)]
    offset: u32,
    #[serde(default)]
    archived: bool,
}

pub(super) fn routes() -> Router<AppState> {
    Router::new()
        .route("/v1/systorch/sessions", get(list))
        .route("/v1/systorch/sessions/:id/messages", post(append))
        .route(
            "/v1/systorch/sessions/:id/assets/:asset_id",
            get(session_asset),
        )
        .route(
            "/v1/systorch/sessions/:id",
            get(read).patch(patch).delete(erase_handler),
        )
        .layer(DefaultBodyLimit::max(MAX_SESSION_BODY))
        .layer(middleware::map_response(no_store))
}

async fn no_store(mut response: Response) -> Response {
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    response
}

fn payload(
    conn: &Connection,
    key: &vault::Vault,
    caller: &str,
    id: &str,
) -> super::Result<(StartSession, bool, bool, i64, i64, i64)> {
    let row: Option<(String, i64, i64, i64, i64, Vec<u8>)> = conn
        .query_row(
            "SELECT caller,revision,created_at,updated_at,last_read_at,payload FROM systorch_start_sessions WHERE id=?1",
            [id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?, row.get(5)?)),
        )
        .optional()
        .map_err(internal)?;
    let Some((owner, revision, created_at, updated_at, last_read_at, encrypted)) = row else {
        return Err(fault(
            StatusCode::NOT_FOUND,
            "session_not_found",
            "No accessible chat has this ID.",
        ));
    };
    if caller != OWNER && caller != owner {
        return Err(fault(
            StatusCode::NOT_FOUND,
            "session_not_found",
            "No accessible chat has this ID.",
        ));
    }
    let clear = key.open_payload(id, &encrypted).map_err(internal)?;
    let data: Payload = serde_json::from_slice(&clear).map_err(internal)?;
    if data.schema_version != 1 {
        return Err(internal("unsupported chat payload version"));
    }
    let pinned: bool = conn
        .query_row(
            "SELECT pinned FROM systorch_start_sessions WHERE id=?1",
            [id],
            |row| row.get::<_, i64>(0).map(|v| v != 0),
        )
        .map_err(internal)?;
    let archived: bool = conn
        .query_row(
            "SELECT archived FROM systorch_start_sessions WHERE id=?1",
            [id],
            |row| row.get::<_, i64>(0).map(|v| v != 0),
        )
        .map_err(internal)?;
    let summary = summarize(
        SessionMetadata {
            id,
            revision,
            created_at,
            updated_at,
            last_read_at,
            pinned,
            archived,
        },
        &data.messages,
    );
    Ok((
        StartSession {
            summary,
            messages: data.messages,
        },
        pinned,
        archived,
        revision,
        updated_at,
        last_read_at,
    ))
}

fn summarize(metadata: SessionMetadata<'_>, messages: &[StartMessage]) -> StartSessionSummary {
    let first_request = messages.iter().find_map(|message| match message {
        StartMessage::Request {
            request,
            question_order,
            ..
        } => Some((request, question_order)),
        _ => None,
    });
    let title = first_request
        .and_then(|(request, order)| {
            order
                .first()
                .and_then(|id| request.questions.get(id))
                .or_else(|| request.questions.values().next())
                .map(question_text)
        })
        .unwrap_or_else(|| "New chat".into());
    let title = title.lines().next().unwrap_or_default().trim();
    let title = if title.is_empty() {
        "New chat".into()
    } else {
        title.chars().take(96).collect()
    };
    let answered_ids: std::collections::HashSet<&str> = messages
        .iter()
        .filter_map(|message| match message {
            StartMessage::Response { reply_to, .. } | StartMessage::Failure { reply_to, .. } => {
                Some(reply_to.as_str())
            }
            _ => None,
        })
        .collect();
    let latest_reply = messages
        .iter()
        .filter(|message| {
            matches!(
                message,
                StartMessage::Response { .. } | StartMessage::Failure { .. }
            )
        })
        .map(StartMessage::created_at)
        .max()
        .unwrap_or(0);
    let pending_request = messages.iter().any(|message| matches!(message, StartMessage::Request { id, .. } if !answered_ids.contains(id.as_str())));
    StartSessionSummary {
        id: metadata.id.into(),
        revision: metadata.revision,
        created_at: metadata.created_at,
        updated_at: metadata.updated_at,
        pinned: metadata.pinned,
        archived: metadata.archived,
        last_read_at: metadata.last_read_at,
        title,
        message_count: messages.len(),
        has_unread_reply: latest_reply > metadata.last_read_at,
        interrupted: pending_request,
    }
}

fn question_text(question: &Question) -> String {
    let instructions = match question {
        Question::Choice { instructions, .. }
        | Question::Score { instructions, .. }
        | Question::Noul { instructions, .. }
        | Question::Box { instructions } => instructions,
    };
    match instructions {
        Instructions::Text(text) => text.clone(),
        other => serde_json::to_value(other)
            .ok()
            .and_then(|v| v.get("text").and_then(Value::as_str).map(str::to_owned))
            .unwrap_or_else(|| serde_json::to_string(instructions).unwrap_or_default()),
    }
}

fn validate_id(id: &str) -> super::Result<()> {
    if !(12..=128).contains(&id.len())
        || !id.starts_with("start_")
        || !id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
    {
        return Err(fault(
            StatusCode::BAD_REQUEST,
            "invalid_session_id",
            "Use a stable start_ ID containing only ASCII letters, digits, dash or underscore.",
        ));
    }
    Ok(())
}

fn validate_message(message: &StartMessage) -> super::Result<()> {
    let id = message.id();
    if id.trim().is_empty() || id.len() > 128 {
        return Err(fault(
            StatusCode::BAD_REQUEST,
            "invalid_message_id",
            "Every chat message needs a stable ID no longer than 128 bytes.",
        ));
    }
    match message {
        StartMessage::Request {
            request,
            question_order,
            ..
        } => {
            if request.model.trim().is_empty()
                || request.questions.is_empty()
                || request.questions.len() > 32
            {
                return Err(fault(
                    StatusCode::BAD_REQUEST,
                    "invalid_chat_request",
                    "A chat request needs a model and 1–32 typed questions.",
                ));
            }
            if !question_order.is_empty() {
                let expected: std::collections::HashSet<_> = request.questions.keys().collect();
                let ordered: std::collections::HashSet<_> = question_order.iter().collect();
                if question_order.len() != request.questions.len()
                    || ordered.len() != question_order.len()
                    || ordered != expected
                {
                    return Err(fault(
                        StatusCode::BAD_REQUEST,
                        "invalid_question_order",
                        "question_order must list every question ID exactly once.",
                    ));
                }
            }
            if request.assets.as_ref().is_some_and(|assets| {
                assets
                    .values()
                    .any(|asset| asset.data_base64.is_some() || asset.asset_id.is_none())
            }) {
                return Err(fault(StatusCode::UNPROCESSABLE_ENTITY, "session_asset_not_persistent", "Persistent chat attachments must use uploaded asset IDs; inline media cannot be retained."));
            }
            if let Some(assets) = &request.assets {
                let content = serde_json::to_value(request).map_err(internal)?;
                assets::validate_asset_references(&content, assets)
                    .map_err(|error| fault(error.0, error.1, error.2))?;
            }
        }
        StartMessage::Response { reply_to, .. } | StartMessage::Failure { reply_to, .. } => {
            if reply_to.trim().is_empty() || reply_to.len() > 128 {
                return Err(fault(
                    StatusCode::BAD_REQUEST,
                    "invalid_reply_target",
                    "A reply must reference its user request message ID.",
                ));
            }
        }
    }
    let bytes = serde_json::to_vec(message).map_err(internal)?;
    if bytes.len() > MAX_SESSION_BODY {
        return Err(fault(
            StatusCode::PAYLOAD_TOO_LARGE,
            "chat_message_too_large",
            "Keep each persisted chat message below 8 MiB and upload media as assets.",
        ));
    }
    Ok(())
}

fn append_message(
    conn: &mut Connection,
    key: &vault::Vault,
    caller: &str,
    id: &str,
    body: AppendStartMessage,
    at: i64,
) -> super::Result<StartSession> {
    validate_id(id)?;
    validate_message(&body.message)?;
    if body.expected_revision < 0 {
        return Err(fault(
            StatusCode::BAD_REQUEST,
            "invalid_revision",
            "expected_revision must be a nonnegative integer.",
        ));
    }
    let tx = conn
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(internal)?;
    let existing: bool = tx
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM systorch_start_sessions WHERE id=?1)",
            [id],
            |row| row.get(0),
        )
        .map_err(internal)?;
    let mut data = if existing {
        let (session, _, _, revision, _, _) = payload(&tx, key, caller, id)?;
        if body.expected_revision != revision {
            if session.messages.iter().any(|message| {
                message.id() == body.message.id()
                    && serde_json::to_vec(message).ok() == serde_json::to_vec(&body.message).ok()
            }) {
                return Ok(session);
            }
            return Err(fault(
                StatusCode::CONFLICT,
                "session_revision_conflict",
                "This chat changed since it was loaded. Reload before appending.",
            ));
        }
        Payload {
            schema_version: 1,
            messages: session.messages,
        }
    } else {
        if body.expected_revision != 0 {
            return Err(fault(
                StatusCode::CONFLICT,
                "session_revision_conflict",
                "A new chat must start at revision 0.",
            ));
        }
        let count: i64 = tx
            .query_row(
                "SELECT count(*) FROM systorch_start_sessions WHERE caller=?1",
                [caller],
                |row| row.get(0),
            )
            .map_err(internal)?;
        if count >= SESSION_CAPACITY {
            return Err(fault(StatusCode::TOO_MANY_REQUESTS, "session_capacity", "This caller has reached the 10,000 chat limit. Delete chats before starting another."));
        }
        let key_digest = key.digest(id.as_bytes());
        let payload = Payload {
            schema_version: 1,
            messages: Vec::new(),
        };
        let encrypted = key
            .seal(id, &serde_json::to_vec(&payload).map_err(internal)?)
            .map_err(internal)?;
        tx.execute("INSERT INTO systorch_start_sessions(id,caller,idempotency_key,revision,created_at,updated_at,payload) VALUES(?1,?2,?3,0,?4,?4,?5)", params![id, caller, key_digest, at, encrypted]).map_err(|error| {
            if error.sqlite_error_code() == Some(rusqlite::ErrorCode::ConstraintViolation) {
                fault(StatusCode::CONFLICT, "session_id_conflict", "This chat ID already exists or was used by another caller.")
            } else { internal(error) }
        })?;
        payload
    };
    if data.messages.len() >= MAX_MESSAGES {
        return Err(fault(
            StatusCode::PAYLOAD_TOO_LARGE,
            "session_message_limit",
            "This chat has reached 512 messages. Start a new chat to continue.",
        ));
    }
    if data
        .messages
        .iter()
        .any(|message| message.id() == body.message.id())
    {
        return Err(fault(
            StatusCode::CONFLICT,
            "message_id_conflict",
            "This message ID already exists with different content.",
        ));
    }
    match &body.message {
        StartMessage::Request { .. } => {}
        StartMessage::Response { reply_to, .. } | StartMessage::Failure { reply_to, .. } => {
            let request_exists = data.messages.iter().any(
                |message| matches!(message, StartMessage::Request { id, .. } if id == reply_to),
            );
            let replied = data.messages.iter().any(|message| matches!(message, StartMessage::Response { reply_to: old, .. } | StartMessage::Failure { reply_to: old, .. } if old == reply_to));
            if !request_exists || replied {
                return Err(fault(StatusCode::CONFLICT, "invalid_reply_order", "A reply must target one existing user request that has not already received a result."));
            }
        }
    }
    if let StartMessage::Request { request, .. } = &body.message {
        assets::attach_assets_to_session(&tx, caller, id, request.assets.as_ref())
            .map_err(|error| fault(error.0, error.1, error.2))?;
    }
    data.messages.push(body.message);
    let serialized = serde_json::to_vec(&data).map_err(internal)?;
    if serialized.len() > MAX_SESSION_BODY {
        return Err(fault(
            StatusCode::PAYLOAD_TOO_LARGE,
            "session_capacity",
            "This chat has reached its encrypted payload limit. Start a new chat to continue.",
        ));
    }
    let encrypted = key.seal(id, &serialized).map_err(internal)?;
    let next_revision = body.expected_revision + 1;
    tx.execute("UPDATE systorch_start_sessions SET revision=?2,updated_at=?3,archived=0,payload=?4 WHERE id=?1", params![id, next_revision, at, encrypted]).map_err(internal)?;
    tx.commit().map_err(internal)?;
    let conn: &Connection = conn;
    payload(conn, key, caller, id).map(|value| value.0)
}

fn read_session(
    conn: &Connection,
    key: &vault::Vault,
    caller: &str,
    id: &str,
) -> super::Result<StartSession> {
    validate_id(id)?;
    payload(conn, key, caller, id).map(|value| value.0)
}

fn list_sessions(
    conn: &Connection,
    key: &vault::Vault,
    caller: &str,
    page: Page,
) -> super::Result<Vec<StartSessionSummary>> {
    let offset = page.offset.min(10_000);
    let mut stmt = conn.prepare("SELECT id FROM systorch_start_sessions WHERE (caller=?1 OR ?1='local-owner') AND archived=?2 ORDER BY pinned DESC,updated_at DESC,id LIMIT 25 OFFSET ?3").map_err(internal)?;
    let ids: Vec<String> = stmt
        .query_map(params![caller, page.archived, offset], |row| row.get(0))
        .map_err(internal)?
        .collect::<rusqlite::Result<_>>()
        .map_err(internal)?;
    ids.iter()
        .map(|id| payload(conn, key, caller, id).map(|value| value.0.summary))
        .collect()
}

fn update_state(
    conn: &mut Connection,
    key: &vault::Vault,
    caller: &str,
    id: &str,
    body: PatchStartSession,
    at: i64,
) -> super::Result<StartSession> {
    validate_id(id)?;
    if body.pinned.is_none() && body.archived.is_none() && body.mark_read != Some(true) {
        return Err(fault(
            StatusCode::BAD_REQUEST,
            "empty_session_patch",
            "Provide at least one session state change.",
        ));
    }
    let tx = conn
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(internal)?;
    let (session, _, _, revision, _, _) = payload(&tx, key, caller, id)?;
    if revision != body.expected_revision {
        return Err(fault(
            StatusCode::CONFLICT,
            "session_revision_conflict",
            "This chat changed since it was loaded. Reload before changing its state.",
        ));
    }
    tx.execute("UPDATE systorch_start_sessions SET pinned=COALESCE(?2,pinned),archived=COALESCE(?3,archived),last_read_at=CASE WHEN ?4=1 THEN ?5 ELSE last_read_at END,revision=revision+1,updated_at=CASE WHEN ?2 IS NOT NULL OR ?3 IS NOT NULL THEN ?5 ELSE updated_at END WHERE id=?1", params![id, body.pinned.map(|value| if value { 1_i64 } else { 0_i64 }), body.archived.map(|value| if value { 1_i64 } else { 0_i64 }), body.mark_read.map(|value| if value { 1_i64 } else { 0_i64 }), at]).map_err(internal)?;
    tx.commit().map_err(internal)?;
    read_session(conn, key, caller, id).map(|mut next| {
        if next.messages.is_empty() {
            next.summary = session.summary;
        }
        next
    })
}

fn erase_store(conn: &mut Connection, caller: &str, id: &str) -> super::Result<()> {
    validate_id(id)?;
    let tx = conn
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(internal)?;
    let owner: Option<String> = tx
        .query_row(
            "SELECT caller FROM systorch_start_sessions WHERE id=?1",
            [id],
            |row| row.get(0),
        )
        .optional()
        .map_err(internal)?;
    let Some(owner) = owner else {
        return Err(fault(
            StatusCode::NOT_FOUND,
            "session_not_found",
            "No accessible chat has this ID.",
        ));
    };
    if caller != OWNER && caller != owner {
        return Err(fault(
            StatusCode::NOT_FOUND,
            "session_not_found",
            "No accessible chat has this ID.",
        ));
    }
    assets::detach_session_assets(&tx, id).map_err(|error| fault(error.0, error.1, error.2))?;
    tx.execute("DELETE FROM systorch_start_sessions WHERE id=?1", [id])
        .map_err(internal)?;
    tx.commit().map_err(internal)
}

async fn list(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(page): Query<Page>,
) -> super::Result<Json<Vec<StartSessionSummary>>> {
    let caller = identity(&state, &headers)?;
    let conn = state.db_conn.lock().map_err(internal)?;
    let key = vault::Vault::open(&state.config_path, false).map_err(internal)?;
    list_sessions(&conn, &key, &caller, page).map(Json)
}

async fn append(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    body: std::result::Result<Json<AppendStartMessage>, axum::extract::rejection::JsonRejection>,
) -> super::Result<Response> {
    let caller = identity(&state, &headers)?;
    let body = body.map(|Json(value)| value).map_err(|error| {
        if error.status() == StatusCode::PAYLOAD_TOO_LARGE {
            fault(
                StatusCode::PAYLOAD_TOO_LARGE,
                "session_body_too_large",
                "Keep one chat write within 8 MiB and store attachments as assets.",
            )
        } else {
            fault(
                StatusCode::UNPROCESSABLE_ENTITY,
                "invalid_session_json",
                "Send a valid SysTorch chat message as JSON.",
            )
        }
    })?;
    let mut conn = state.db_conn.lock().map_err(internal)?;
    let key = vault::Vault::open(&state.config_path, false).map_err(internal)?;
    let revision = body.expected_revision;
    let created = revision == 0
        && !conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM systorch_start_sessions WHERE id=?1)",
                [&id],
                |row| row.get::<_, bool>(0),
            )
            .map_err(internal)?;
    let session = append_message(&mut conn, &key, &caller, &id, body, now())?;
    Ok((
        if created {
            StatusCode::CREATED
        } else {
            StatusCode::OK
        },
        Json(session),
    )
        .into_response())
}

async fn read(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> super::Result<Json<StartSession>> {
    let caller = identity(&state, &headers)?;
    let conn = state.db_conn.lock().map_err(internal)?;
    let key = vault::Vault::open(&state.config_path, false).map_err(internal)?;
    read_session(&conn, &key, &caller, &id).map(Json)
}

async fn patch(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    body: std::result::Result<Json<PatchStartSession>, axum::extract::rejection::JsonRejection>,
) -> super::Result<Json<StartSession>> {
    let caller = identity(&state, &headers)?;
    let body = body.map(|Json(value)| value).map_err(|_| {
        fault(
            StatusCode::UNPROCESSABLE_ENTITY,
            "invalid_session_patch",
            "Send a valid atomic session state patch.",
        )
    })?;
    let mut conn = state.db_conn.lock().map_err(internal)?;
    let key = vault::Vault::open(&state.config_path, false).map_err(internal)?;
    update_state(&mut conn, &key, &caller, &id, body, now()).map(Json)
}

async fn erase_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> super::Result<StatusCode> {
    let caller = identity(&state, &headers)?;
    let mut conn = state.db_conn.lock().map_err(internal)?;
    erase_store(&mut conn, &caller, &id)?;
    Ok(StatusCode::NO_CONTENT)
}

async fn session_asset(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((id, asset_id)): Path<(String, String)>,
) -> super::Result<Response> {
    let caller = identity(&state, &headers)?;
    let conn = state.db_conn.lock().map_err(internal)?;
    let key = vault::Vault::open(&state.config_path, false).map_err(internal)?;
    read_session(&conn, &key, &caller, &id)?;
    assets::download_for_session(&state, &conn, &id, &asset_id)
        .map_err(|error| fault(error.0, error.1, error.2))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> (Connection, vault::Vault, std::path::PathBuf) {
        let conn = Connection::open_in_memory().unwrap();
        crate::db::init_database(&conn).unwrap();
        let root = std::env::temp_dir().join(format!(
            "systorch-start-session-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir(&root).unwrap();
        let key = vault::Vault::open(&root.join("providers.toml"), true).unwrap();
        (conn, key, root)
    }

    fn request(id: &str) -> StartMessage {
        serde_json::from_value(serde_json::json!({
            "kind": "request",
            "id": id,
            "created_at": 100,
            "request": {
                "model": "fixture-model",
                "state": {"private": "START_SESSION_PRIVATE_SENTINEL"},
                "questions": {
                    "decision": {"type": "noul", "instructions": "Should this chat be durable?"}
                }
            }
        }))
        .unwrap()
    }

    fn response(reply_to: &str) -> StartMessage {
        serde_json::from_value(serde_json::json!({
            "kind": "response",
            "id": "reply-1",
            "created_at": 110,
            "reply_to": reply_to,
            "response": {
                "model": "fixture-model",
                "answers": {"decision": {"type": "noul", "noul": 0.8}},
                "upstream_calls": 1
            }
        }))
        .unwrap()
    }

    fn append(revision: i64, message: StartMessage) -> AppendStartMessage {
        AppendStartMessage {
            expected_revision: revision,
            message,
        }
    }

    #[test]
    fn chat_payload_is_encrypted_caller_scoped_and_cas_appended() {
        let (mut conn, key, root) = fixture();
        let first = append_message(
            &mut conn,
            &key,
            "caller-a",
            "start_00000001",
            append(0, request("request-1")),
            100,
        )
        .unwrap();
        assert_eq!(first.summary.revision, 1);
        assert_eq!(first.summary.title, "Should this chat be durable?");
        assert!(
            matches!(read_session(&conn, &key, "caller-b", &first.summary.id), Err(error) if error.0 == StatusCode::NOT_FOUND)
        );

        let encrypted: Vec<u8> = conn
            .query_row(
                "SELECT payload FROM systorch_start_sessions WHERE id=?1",
                [&first.summary.id],
                |row| row.get(0),
            )
            .unwrap();
        assert!(!String::from_utf8_lossy(&encrypted).contains("START_SESSION_PRIVATE_SENTINEL"));

        let complete = append_message(
            &mut conn,
            &key,
            "caller-a",
            &first.summary.id,
            append(1, response("request-1")),
            110,
        )
        .unwrap();
        assert_eq!(complete.summary.revision, 2);
        assert!(complete.summary.has_unread_reply);
        assert!(!complete.summary.interrupted);

        // A retried append is idempotent; a different write against a stale revision conflicts.
        let replay = append_message(
            &mut conn,
            &key,
            "caller-a",
            &first.summary.id,
            append(1, response("request-1")),
            120,
        )
        .unwrap();
        assert_eq!(replay.summary.revision, 2);
        assert!(
            matches!(append_message(&mut conn, &key, "caller-a", &first.summary.id, append(1, request("request-2")), 120), Err(error) if error.0 == StatusCode::CONFLICT)
        );

        let marked = update_state(
            &mut conn,
            &key,
            "caller-a",
            &first.summary.id,
            PatchStartSession {
                expected_revision: 2,
                pinned: Some(true),
                archived: Some(true),
                mark_read: Some(true),
            },
            130,
        )
        .unwrap();
        assert!(marked.summary.pinned && marked.summary.archived);
        assert!(!marked.summary.has_unread_reply);
        assert!(list_sessions(
            &conn,
            &key,
            "caller-a",
            Page {
                offset: 0,
                archived: false
            }
        )
        .unwrap()
        .is_empty());
        assert_eq!(
            list_sessions(
                &conn,
                &key,
                "caller-a",
                Page {
                    offset: 0,
                    archived: true
                }
            )
            .unwrap()
            .len(),
            1
        );

        erase_store(&mut conn, "caller-a", &first.summary.id).unwrap();
        assert!(
            matches!(read_session(&conn, &key, "caller-a", &first.summary.id), Err(error) if error.0 == StatusCode::NOT_FOUND)
        );
        std::fs::remove_file(root.join("systorch-owner.key")).unwrap();
        std::fs::remove_dir(root).unwrap();
    }

    #[test]
    fn response_requires_one_unanswered_request_and_failed_mutations_roll_back() {
        let (mut conn, key, root) = fixture();
        let id = "start_00000002";
        append_message(
            &mut conn,
            &key,
            "caller-a",
            id,
            append(0, request("request-1")),
            100,
        )
        .unwrap();
        assert!(
            matches!(append_message(&mut conn, &key, "caller-a", id, append(1, response("missing")), 110), Err(error) if error.0 == StatusCode::CONFLICT)
        );
        assert_eq!(
            read_session(&conn, &key, "caller-a", id)
                .unwrap()
                .summary
                .revision,
            1
        );
        append_message(
            &mut conn,
            &key,
            "caller-a",
            id,
            append(1, response("request-1")),
            120,
        )
        .unwrap();
        assert!(
            matches!(append_message(&mut conn, &key, "caller-a", id, append(2, response("request-1")), 130), Err(error) if error.0 == StatusCode::CONFLICT)
        );
        assert_eq!(
            read_session(&conn, &key, "caller-a", id)
                .unwrap()
                .summary
                .revision,
            2
        );
        std::fs::remove_file(root.join("systorch-owner.key")).unwrap();
        std::fs::remove_dir(root).unwrap();
    }
}
