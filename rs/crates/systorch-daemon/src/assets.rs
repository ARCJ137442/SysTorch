//! Encrypted, caller-scoped asset storage for SysTorch requests.
//!
//! Asset IDs are local references, never public URLs or filesystem paths. Adapters
//! receive resolved bytes only after the request identity and asset owner match.
use crate::{auth, decisions::vault::Vault, tokens::CallerIdentity, AppState};
use axum::{
    body::{to_bytes, Body},
    extract::{Extension, Path, State},
    http::{header, HeaderMap, HeaderValue, StatusCode},
    middleware,
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use serde_json::json;
use std::collections::BTreeMap;

const LOCAL_OWNER: &str = "local-owner";
const MAX_ASSET_BYTES: usize = 64 * 1024 * 1024;
const MAX_ASSETS_PER_OWNER: i64 = 256 * 1024 * 1024;
const ASSET_RETENTION_SECONDS: i64 = 14 * 86400;

#[derive(Debug)]
pub(crate) struct AssetFault(
    pub(crate) StatusCode,
    pub(crate) &'static str,
    pub(crate) &'static str,
);

#[derive(Debug, Serialize)]
struct AssetReceipt {
    asset_id: String,
    mime_type: String,
    size_bytes: usize,
    expires_at: i64,
}

struct AssetRow {
    owner_id: String,
    mime_type: String,
    size_bytes: usize,
    digest: String,
    expires_at: i64,
    payload: Vec<u8>,
}

pub(crate) fn routes() -> Router<AppState> {
    Router::new()
        .route("/v1/systorch/assets", post(upload))
        .route("/v1/systorch/assets/:id", get(download).delete(delete))
        .layer(middleware::map_response(no_store))
}

async fn no_store(mut response: Response) -> Response {
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    response
}

fn fault(status: StatusCode, code: &'static str, message: &'static str) -> AssetFault {
    AssetFault(status, code, message)
}

pub(crate) fn error_response(error: AssetFault) -> Response {
    (error.0, Json(json!({ "code": error.1, "error": error.2 }))).into_response()
}

pub(crate) fn validate_asset_references(
    content: &serde_json::Value,
    assets: &BTreeMap<String, jev_protocol::RequestAsset>,
) -> Result<(), AssetFault> {
    if assets.is_empty() {
        return Err(fault(
            StatusCode::BAD_REQUEST,
            "asset_count_invalid",
            "Omit assets when a request has no attachments.",
        ));
    }
    for reference in assets.keys() {
        if !contains_exact_string(content, reference) {
            return Err(fault(
                StatusCode::BAD_REQUEST,
                "asset_reference_missing",
                "Every registered attachment must be referenced by its exact ID in shared context or a question.",
            ));
        }
    }
    Ok(())
}

fn contains_exact_string(value: &serde_json::Value, expected: &str) -> bool {
    match value {
        serde_json::Value::String(value) => value == expected,
        serde_json::Value::Array(values) => values
            .iter()
            .any(|value| contains_exact_string(value, expected)),
        serde_json::Value::Object(values) => values
            .values()
            .any(|value| contains_exact_string(value, expected)),
        _ => false,
    }
}

fn owner_id(
    state: &AppState,
    headers: &HeaderMap,
    caller: Option<&CallerIdentity>,
) -> Result<String, AssetFault> {
    if let Some(identity) = caller {
        return Ok(identity.id.clone());
    }
    if auth::current_mode(state) == crate::config::RunMode::Local {
        // Local mode intentionally trusts the same loopback/private peer that may
        // invoke `/v1/systemone` without a managed call token.
        return Ok(LOCAL_OWNER.into());
    }
    let Some(token) = auth::bearer_token(headers) else {
        return Err(fault(
            StatusCode::UNAUTHORIZED,
            "asset_auth_required",
            "Use a managed caller token to upload or read request assets.",
        ));
    };
    // Cloud mode's call-token middleware has already authenticated this bearer.
    // Legacy config tokens have no stable database ID, so scope their assets to a
    // non-reversible digest rather than storing the credential itself.
    use sha2::{Digest, Sha256};
    let digest = Sha256::digest(token.as_bytes());
    let suffix = digest
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    Ok(format!("legacy_{suffix}"))
}

pub(crate) fn request_owner_id(
    state: &AppState,
    headers: &HeaderMap,
    caller: Option<&CallerIdentity>,
) -> Result<String, AssetFault> {
    owner_id(state, headers, caller)
}

fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

fn new_id() -> Result<String, AssetFault> {
    let mut random = [0u8; 16];
    getrandom::getrandom(&mut random).map_err(|_| {
        fault(
            StatusCode::INTERNAL_SERVER_ERROR,
            "asset_id_unavailable",
            "Secure randomness is unavailable; the asset was not accepted.",
        )
    })?;
    let suffix = random
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    Ok(format!("asset_{suffix}"))
}

async fn upload(
    State(state): State<AppState>,
    headers: HeaderMap,
    caller: Option<Extension<CallerIdentity>>,
    body: Body,
) -> Response {
    let owner = match owner_id(
        &state,
        &headers,
        caller.as_ref().map(|Extension(caller)| caller),
    ) {
        Ok(owner) => owner,
        Err(error) => return error_response(error),
    };
    let mime_type = match headers
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(|value| {
            value
                .split(';')
                .next()
                .unwrap_or_default()
                .trim()
                .to_ascii_lowercase()
        }) {
        Some(value) if !value.is_empty() && value.len() <= 255 => value,
        _ => {
            return error_response(fault(
                StatusCode::BAD_REQUEST,
                "asset_mime_required",
                "Set a valid Content-Type for the attachment.",
            ))
        }
    };
    if headers
        .get(header::CONTENT_LENGTH)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<usize>().ok())
        .is_some_and(|size| size > MAX_ASSET_BYTES)
    {
        return error_response(fault(
            StatusCode::PAYLOAD_TOO_LARGE,
            "asset_too_large",
            "Keep one uploaded asset at or below 64 MiB.",
        ));
    }
    let data = match to_bytes(body, MAX_ASSET_BYTES).await {
        Ok(data) => data,
        Err(_) => {
            return error_response(fault(
                StatusCode::PAYLOAD_TOO_LARGE,
                "asset_too_large",
                "Keep one uploaded asset at or below 64 MiB.",
            ))
        }
    };
    if data.is_empty() {
        return error_response(fault(
            StatusCode::BAD_REQUEST,
            "asset_empty",
            "The selected attachment is empty.",
        ));
    }

    match store_asset(&state, &owner, &mime_type, &data) {
        Ok(receipt) => (StatusCode::CREATED, Json(receipt)).into_response(),
        Err(error) => error_response(error),
    }
}

fn store_asset(
    state: &AppState,
    owner: &str,
    mime_type: &str,
    data: &[u8],
) -> Result<AssetReceipt, AssetFault> {
    let id = new_id()?;
    let created_at = now();
    let expires_at = created_at + ASSET_RETENTION_SECONDS;
    let vault = Vault::open(&state.config_path, false).map_err(|_| {
        fault(
            StatusCode::INTERNAL_SERVER_ERROR,
            "asset_storage_unavailable",
            "Asset encryption is unavailable; the attachment was not accepted.",
        )
    })?;
    let digest = vault.digest(data);
    let payload = vault.seal(&id, data).map_err(|_| {
        fault(
            StatusCode::INTERNAL_SERVER_ERROR,
            "asset_storage_unavailable",
            "The attachment could not be encrypted and stored.",
        )
    })?;
    let mut conn = state.db_conn.lock().map_err(|_| {
        fault(
            StatusCode::INTERNAL_SERVER_ERROR,
            "asset_storage_unavailable",
            "Asset storage is temporarily unavailable.",
        )
    })?;
    let tx = conn
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(|_| {
            fault(
                StatusCode::INTERNAL_SERVER_ERROR,
                "asset_storage_unavailable",
                "Asset storage is temporarily unavailable.",
            )
        })?;
    tx.execute(
        "DELETE FROM systorch_assets WHERE expires_at<=?1 AND id NOT IN (SELECT asset_id FROM decision_task_assets) AND id NOT IN (SELECT asset_id FROM systorch_start_session_assets)",
        [created_at],
    )
    .map_err(|_| fault(StatusCode::INTERNAL_SERVER_ERROR, "asset_storage_unavailable", "Expired asset cleanup failed; the upload was not accepted."))?;
    let used: i64 = tx
        .query_row(
            "SELECT COALESCE(SUM(byte_length),0) FROM systorch_assets WHERE owner_id=?1 AND expires_at>?2",
            params![owner, created_at],
            |row| row.get(0),
        )
        .map_err(|_| fault(StatusCode::INTERNAL_SERVER_ERROR, "asset_storage_unavailable", "Asset quota could not be checked."))?;
    if used.saturating_add(data.len() as i64) > MAX_ASSETS_PER_OWNER {
        return Err(fault(StatusCode::TOO_MANY_REQUESTS, "asset_quota_exceeded", "This caller has reached its 256 MiB temporary asset quota. Remove unused drafts or wait for expired assets to be collected."));
    }
    tx.execute(
        "INSERT INTO systorch_assets(id,owner_id,mime_type,byte_length,digest,created_at,expires_at,payload) VALUES(?1,?2,?3,?4,?5,?6,?7,?8)",
        params![id, owner, mime_type, data.len() as i64, digest, created_at, expires_at, payload],
    )
    .map_err(|_| fault(StatusCode::INTERNAL_SERVER_ERROR, "asset_storage_unavailable", "The attachment could not be committed."))?;
    tx.commit().map_err(|_| {
        fault(
            StatusCode::INTERNAL_SERVER_ERROR,
            "asset_storage_unavailable",
            "The attachment could not be committed.",
        )
    })?;
    Ok(AssetReceipt {
        asset_id: id,
        mime_type: mime_type.into(),
        size_bytes: data.len(),
        expires_at,
    })
}

fn load_asset(conn: &Connection, id: &str) -> Result<Option<AssetRow>, AssetFault> {
    conn.query_row(
        "SELECT owner_id,mime_type,byte_length,digest,expires_at,payload FROM systorch_assets WHERE id=?1",
        [id],
        |row| {
            Ok(AssetRow {
                owner_id: row.get(0)?,
                mime_type: row.get(1)?,
                size_bytes: row.get::<_, i64>(2)?.max(0) as usize,
                digest: row.get(3)?,
                expires_at: row.get(4)?,
                payload: row.get(5)?,
            })
        },
    )
    .optional()
    .map_err(|_| {
        fault(
            StatusCode::INTERNAL_SERVER_ERROR,
            "asset_storage_unavailable",
            "Asset metadata could not be read.",
        )
    })
}

fn decrypt_asset(vault: &Vault, id: &str, row: &AssetRow) -> Result<Vec<u8>, AssetFault> {
    let bytes = vault.open_payload(id, &row.payload).map_err(|_| {
        fault(
            StatusCode::INTERNAL_SERVER_ERROR,
            "asset_storage_unavailable",
            "Asset verification failed; restore the matching data and owner key.",
        )
    })?;
    if bytes.len() != row.size_bytes || vault.digest(&bytes) != row.digest {
        return Err(fault(
            StatusCode::INTERNAL_SERVER_ERROR,
            "asset_storage_unavailable",
            "Asset integrity verification failed; the content was not returned.",
        ));
    }
    Ok(bytes)
}

pub(crate) fn resolve_request_assets(
    state: &AppState,
    owner: &str,
    assets: &mut Option<BTreeMap<String, jev_protocol::RequestAsset>>,
) -> Result<(), AssetFault> {
    let Some(assets) = assets else {
        return Ok(());
    };
    if assets.len() > 128 {
        return Err(fault(
            StatusCode::BAD_REQUEST,
            "asset_count_exceeded",
            "A request may reference at most 128 distinct assets.",
        ));
    }
    let mut total_bytes = 0usize;
    let needs_store = assets.values().any(|asset| asset.asset_id.is_some());
    let conn = if needs_store {
        Some(state.db_conn.lock().map_err(|_| {
            fault(
                StatusCode::INTERNAL_SERVER_ERROR,
                "asset_storage_unavailable",
                "Asset storage is temporarily unavailable.",
            )
        })?)
    } else {
        None
    };
    let vault = if needs_store {
        Some(Vault::open(&state.config_path, false).map_err(|_| {
            fault(
                StatusCode::INTERNAL_SERVER_ERROR,
                "asset_storage_unavailable",
                "Asset encryption is unavailable.",
            )
        })?)
    } else {
        None
    };
    for (reference, asset) in assets.iter_mut() {
        if reference.is_empty()
            || reference.len() > 1024
            || asset.r#type.trim().is_empty()
            || asset.r#type.len() > 64
        {
            return Err(fault(
                StatusCode::BAD_REQUEST,
                "asset_descriptor_invalid",
                "Each asset needs a stable reference and media type.",
            ));
        }
        match (&asset.data_base64, &asset.asset_id) {
            (Some(_), Some(_)) | (None, None) => {
                return Err(fault(
                    StatusCode::BAD_REQUEST,
                    "asset_descriptor_invalid",
                    "Provide exactly one of inline data_base64 or an uploaded asset_id.",
                ))
            }
            (Some(encoded), None) => {
                if encoded.starts_with("data:") {
                    return Err(fault(
                        StatusCode::BAD_REQUEST,
                        "asset_base64_invalid",
                        "data_base64 must contain standard base64 bytes without a data URL prefix.",
                    ));
                }
                let decoded = STANDARD.decode(encoded).map_err(|_| {
                    fault(
                        StatusCode::BAD_REQUEST,
                        "asset_base64_invalid",
                        "The asset data_base64 field is invalid.",
                    )
                })?;
                if decoded.is_empty() || decoded.len() > MAX_ASSET_BYTES {
                    return Err(fault(
                        StatusCode::PAYLOAD_TOO_LARGE,
                        "asset_too_large",
                        "Keep each decoded asset at or below 64 MiB.",
                    ));
                }
                total_bytes = total_bytes.saturating_add(decoded.len());
            }
            (None, Some(asset_id)) => {
                if asset_id.is_empty() || asset_id.len() > 128 {
                    return Err(fault(
                        StatusCode::BAD_REQUEST,
                        "asset_id_invalid",
                        "The uploaded asset ID is invalid.",
                    ));
                }
                let row = load_asset(
                    conn.as_ref()
                        .expect("reference assets require the asset store"),
                    asset_id,
                )?
                .ok_or_else(|| {
                    fault(
                        StatusCode::NOT_FOUND,
                        "asset_not_found",
                        "The attachment is missing or not accessible to this caller.",
                    )
                })?;
                if row.owner_id != owner && owner != LOCAL_OWNER {
                    return Err(fault(
                        StatusCode::NOT_FOUND,
                        "asset_not_found",
                        "The attachment is missing or not accessible to this caller.",
                    ));
                }
                if row.expires_at <= now() {
                    return Err(fault(
                        StatusCode::GONE,
                        "asset_expired",
                        "The uploaded attachment has expired; select it again before sending.",
                    ));
                }
                if asset
                    .mime_type
                    .as_ref()
                    .is_some_and(|mime| mime != &row.mime_type)
                {
                    return Err(fault(
                        StatusCode::BAD_REQUEST,
                        "asset_mime_mismatch",
                        "The request media type does not match the uploaded attachment.",
                    ));
                }
                let bytes = decrypt_asset(
                    vault
                        .as_ref()
                        .expect("reference assets require the owner vault"),
                    asset_id,
                    &row,
                )?;
                total_bytes = total_bytes.saturating_add(bytes.len());
                asset.mime_type = Some(row.mime_type);
                asset.data_base64 = Some(STANDARD.encode(bytes));
                asset.asset_id = None;
            }
        }
        if total_bytes > MAX_ASSET_BYTES {
            return Err(fault(
                StatusCode::PAYLOAD_TOO_LARGE,
                "assets_too_large",
                "Keep all assets in one request at or below 64 MiB decoded.",
            ));
        }
    }
    Ok(())
}

pub(crate) fn attach_assets_to_task(
    conn: &Connection,
    owner: &str,
    task_id: &str,
    keep_until: i64,
    assets: Option<&BTreeMap<String, jev_protocol::RequestAsset>>,
) -> Result<(), AssetFault> {
    let Some(assets) = assets else {
        return Ok(());
    };
    for asset in assets.values() {
        let Some(asset_id) = asset.asset_id.as_deref() else {
            continue;
        };
        let row = load_asset(conn, asset_id)?.ok_or_else(|| {
            fault(
                StatusCode::NOT_FOUND,
                "asset_not_found",
                "The attachment is missing or not accessible to this caller.",
            )
        })?;
        if row.owner_id != owner && owner != LOCAL_OWNER {
            return Err(fault(
                StatusCode::NOT_FOUND,
                "asset_not_found",
                "The attachment is missing or not accessible to this caller.",
            ));
        }
        if row.expires_at <= now() {
            return Err(fault(
                StatusCode::GONE,
                "asset_expired",
                "The uploaded attachment has expired; select it again before sending.",
            ));
        }
        if asset
            .mime_type
            .as_ref()
            .is_some_and(|mime| mime != &row.mime_type)
        {
            return Err(fault(
                StatusCode::BAD_REQUEST,
                "asset_mime_mismatch",
                "The request media type does not match the uploaded attachment.",
            ));
        }
        conn.execute(
            "INSERT OR IGNORE INTO decision_task_assets(task_id,asset_id) VALUES(?1,?2)",
            params![task_id, asset_id],
        )
        .map_err(|_| {
            fault(
                StatusCode::INTERNAL_SERVER_ERROR,
                "asset_storage_unavailable",
                "The decision's asset reference could not be saved.",
            )
        })?;
        conn.execute(
            "UPDATE systorch_assets SET expires_at=MAX(expires_at,?2) WHERE id=?1",
            params![asset_id, keep_until],
        )
        .map_err(|_| {
            fault(
                StatusCode::INTERNAL_SERVER_ERROR,
                "asset_storage_unavailable",
                "The decision's asset retention could not be extended.",
            )
        })?;
    }
    Ok(())
}

pub(crate) fn detach_task_assets(conn: &Connection, task_id: &str) -> Result<(), AssetFault> {
    let ids = {
        let mut stmt = conn
            .prepare("SELECT asset_id FROM decision_task_assets WHERE task_id=?1")
            .map_err(|_| {
                fault(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "asset_storage_unavailable",
                    "Decision asset references could not be read.",
                )
            })?;
        let rows = stmt
            .query_map([task_id], |row| row.get::<_, String>(0))
            .map_err(|_| {
                fault(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "asset_storage_unavailable",
                    "Decision asset references could not be read.",
                )
            })?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|_| {
                fault(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "asset_storage_unavailable",
                    "Decision asset references could not be read.",
                )
            })?;
        rows
    };
    conn.execute(
        "DELETE FROM decision_task_assets WHERE task_id=?1",
        [task_id],
    )
    .map_err(|_| {
        fault(
            StatusCode::INTERNAL_SERVER_ERROR,
            "asset_storage_unavailable",
            "Decision asset references could not be cleared.",
        )
    })?;
    for id in ids {
        conn.execute(
            "DELETE FROM systorch_assets WHERE id=?1 AND NOT EXISTS(SELECT 1 FROM decision_task_assets WHERE asset_id=?1) AND NOT EXISTS(SELECT 1 FROM systorch_start_session_assets WHERE asset_id=?1)",
            [&id],
        )
        .map_err(|_| fault(StatusCode::INTERNAL_SERVER_ERROR, "asset_storage_unavailable", "An unused decision asset could not be cleared."))?;
    }
    Ok(())
}

pub(crate) fn cleanup_expired_assets(conn: &Connection, at: i64) -> Result<(), AssetFault> {
    conn.execute(
        "DELETE FROM systorch_assets WHERE expires_at<=?1 AND NOT EXISTS(SELECT 1 FROM decision_task_assets WHERE asset_id=systorch_assets.id) AND NOT EXISTS(SELECT 1 FROM systorch_start_session_assets WHERE asset_id=systorch_assets.id)",
        [at],
    )
    .map_err(|_| fault(StatusCode::INTERNAL_SERVER_ERROR, "asset_storage_unavailable", "Expired asset cleanup failed."))?;
    Ok(())
}

pub(crate) fn attach_assets_to_session(
    conn: &Connection,
    owner: &str,
    session_id: &str,
    assets: Option<&BTreeMap<String, jev_protocol::RequestAsset>>,
) -> Result<(), AssetFault> {
    let Some(assets) = assets else {
        return Ok(());
    };
    for asset in assets.values() {
        let Some(asset_id) = asset.asset_id.as_deref() else {
            return Err(fault(StatusCode::UNPROCESSABLE_ENTITY, "session_asset_not_persistent", "Persistent chat attachments must be uploaded assets; inline media cannot be retained in a conversation record."));
        };
        let row = load_asset(conn, asset_id)?.ok_or_else(|| {
            fault(
                StatusCode::NOT_FOUND,
                "asset_not_found",
                "The attachment is missing or not accessible to this caller.",
            )
        })?;
        if row.owner_id != owner && owner != LOCAL_OWNER {
            return Err(fault(
                StatusCode::NOT_FOUND,
                "asset_not_found",
                "The attachment is missing or not accessible to this caller.",
            ));
        }
        if row.expires_at <= now() {
            return Err(fault(
                StatusCode::GONE,
                "asset_expired",
                "The uploaded attachment has expired; select it again before sending.",
            ));
        }
        if asset
            .mime_type
            .as_ref()
            .is_some_and(|mime| mime != &row.mime_type)
        {
            return Err(fault(
                StatusCode::BAD_REQUEST,
                "asset_mime_mismatch",
                "The request media type does not match the uploaded attachment.",
            ));
        }
        conn.execute(
            "INSERT OR IGNORE INTO systorch_start_session_assets(session_id,asset_id) VALUES(?1,?2)",
            params![session_id, asset_id],
        )
        .map_err(|_| fault(StatusCode::INTERNAL_SERVER_ERROR, "asset_storage_unavailable", "The chat attachment reference could not be saved."))?;
        conn.execute(
            "UPDATE systorch_assets SET expires_at=?2 WHERE id=?1",
            params![asset_id, i64::MAX],
        )
        .map_err(|_| {
            fault(
                StatusCode::INTERNAL_SERVER_ERROR,
                "asset_storage_unavailable",
                "The chat attachment retention could not be extended.",
            )
        })?;
    }
    Ok(())
}

pub(crate) fn detach_session_assets(conn: &Connection, session_id: &str) -> Result<(), AssetFault> {
    let ids: Vec<String> = {
        let mut stmt = conn
            .prepare("SELECT asset_id FROM systorch_start_session_assets WHERE session_id=?1")
            .map_err(|_| {
                fault(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "asset_storage_unavailable",
                    "Chat attachments could not be enumerated.",
                )
            })?;
        let rows = stmt
            .query_map([session_id], |row| row.get(0))
            .map_err(|_| {
                fault(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "asset_storage_unavailable",
                    "Chat attachments could not be enumerated.",
                )
            })?
            .collect::<rusqlite::Result<_>>()
            .map_err(|_| {
                fault(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "asset_storage_unavailable",
                    "Chat attachments could not be enumerated.",
                )
            })?;
        rows
    };
    conn.execute(
        "DELETE FROM systorch_start_session_assets WHERE session_id=?1",
        [session_id],
    )
    .map_err(|_| {
        fault(
            StatusCode::INTERNAL_SERVER_ERROR,
            "asset_storage_unavailable",
            "Chat attachments could not be detached.",
        )
    })?;
    for id in ids {
        conn.execute(
            "DELETE FROM systorch_assets WHERE id=?1 AND id NOT IN (SELECT asset_id FROM decision_task_assets) AND id NOT IN (SELECT asset_id FROM systorch_start_session_assets)",
            [&id],
        )
        .map_err(|_| fault(StatusCode::INTERNAL_SERVER_ERROR, "asset_storage_unavailable", "Unused chat attachments could not be released."))?;
    }
    Ok(())
}

async fn download(
    State(state): State<AppState>,
    headers: HeaderMap,
    caller: Option<Extension<CallerIdentity>>,
    Path(id): Path<String>,
) -> Response {
    let owner = match owner_id(
        &state,
        &headers,
        caller.as_ref().map(|Extension(caller)| caller),
    ) {
        Ok(owner) => owner,
        Err(error) => return error_response(error),
    };
    let conn = match state.db_conn.lock() {
        Ok(conn) => conn,
        Err(_) => {
            return error_response(fault(
                StatusCode::INTERNAL_SERVER_ERROR,
                "asset_storage_unavailable",
                "Asset storage is temporarily unavailable.",
            ))
        }
    };
    let row = match load_asset(&conn, &id) {
        Ok(Some(row)) => row,
        Ok(None) => {
            return error_response(fault(
                StatusCode::NOT_FOUND,
                "asset_not_found",
                "The attachment is missing or not accessible to this caller.",
            ))
        }
        Err(error) => return error_response(error),
    };
    if row.owner_id != owner && owner != LOCAL_OWNER {
        return error_response(fault(
            StatusCode::NOT_FOUND,
            "asset_not_found",
            "The attachment is missing or not accessible to this caller.",
        ));
    }
    if row.expires_at <= now() {
        return error_response(fault(
            StatusCode::GONE,
            "asset_expired",
            "The uploaded attachment has expired.",
        ));
    }
    let vault = match Vault::open(&state.config_path, false) {
        Ok(vault) => vault,
        Err(_) => {
            return error_response(fault(
                StatusCode::INTERNAL_SERVER_ERROR,
                "asset_storage_unavailable",
                "Asset encryption is unavailable.",
            ))
        }
    };
    let bytes = match decrypt_asset(&vault, &id, &row) {
        Ok(bytes) => bytes,
        Err(error) => return error_response(error),
    };
    asset_response(row.mime_type, bytes)
}

pub(crate) fn download_for_task(
    state: &AppState,
    conn: &Connection,
    task_id: &str,
    id: &str,
) -> Result<Response, AssetFault> {
    let linked: bool = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM decision_task_assets WHERE task_id=?1 AND asset_id=?2)",
            params![task_id, id],
            |row| row.get(0),
        )
        .map_err(|_| {
            fault(
                StatusCode::INTERNAL_SERVER_ERROR,
                "asset_storage_unavailable",
                "The task attachment link could not be checked.",
            )
        })?;
    if !linked {
        return Err(fault(
            StatusCode::NOT_FOUND,
            "asset_not_found",
            "No attachment belongs to this accessible task.",
        ));
    }
    let row = load_asset(conn, id)?.ok_or_else(|| {
        fault(
            StatusCode::NOT_FOUND,
            "asset_not_found",
            "The task attachment is missing or not accessible.",
        )
    })?;
    if row.expires_at <= now() {
        return Err(fault(
            StatusCode::GONE,
            "asset_expired",
            "The task attachment has expired.",
        ));
    }
    let vault = Vault::open(&state.config_path, false).map_err(|_| {
        fault(
            StatusCode::INTERNAL_SERVER_ERROR,
            "asset_storage_unavailable",
            "Asset encryption is unavailable.",
        )
    })?;
    let bytes = decrypt_asset(&vault, id, &row)?;
    Ok(asset_response(row.mime_type, bytes))
}

pub(crate) fn download_for_session(
    state: &AppState,
    conn: &Connection,
    session_id: &str,
    id: &str,
) -> Result<Response, AssetFault> {
    let linked: bool = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM systorch_start_session_assets WHERE session_id=?1 AND asset_id=?2)",
            params![session_id, id],
            |row| row.get(0),
        )
        .map_err(|_| fault(StatusCode::INTERNAL_SERVER_ERROR, "asset_storage_unavailable", "The chat attachment link could not be checked."))?;
    if !linked {
        return Err(fault(
            StatusCode::NOT_FOUND,
            "asset_not_found",
            "No attachment belongs to this accessible chat.",
        ));
    }
    let row = load_asset(conn, id)?.ok_or_else(|| {
        fault(
            StatusCode::NOT_FOUND,
            "asset_not_found",
            "The chat attachment is missing or not accessible.",
        )
    })?;
    if row.expires_at <= now() {
        return Err(fault(
            StatusCode::GONE,
            "asset_expired",
            "The chat attachment is no longer retained.",
        ));
    }
    let vault = Vault::open(&state.config_path, false).map_err(|_| {
        fault(
            StatusCode::INTERNAL_SERVER_ERROR,
            "asset_storage_unavailable",
            "Asset encryption is unavailable.",
        )
    })?;
    let bytes = decrypt_asset(&vault, id, &row)?;
    Ok(asset_response(row.mime_type, bytes))
}

fn asset_response(mime_type: String, bytes: Vec<u8>) -> Response {
    let inline = mime_type.starts_with("image/")
        || mime_type.starts_with("audio/")
        || mime_type.starts_with("video/");
    let mut builder = Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, mime_type)
        .header(header::CACHE_CONTROL, "no-store")
        .header("x-content-type-options", "nosniff");
    if !inline {
        builder = builder.header(header::CONTENT_DISPOSITION, "attachment");
    }
    builder.body(Body::from(bytes)).unwrap_or_else(|_| {
        error_response(fault(
            StatusCode::INTERNAL_SERVER_ERROR,
            "asset_storage_unavailable",
            "The attachment could not be returned.",
        ))
    })
}

async fn delete(
    State(state): State<AppState>,
    headers: HeaderMap,
    caller: Option<Extension<CallerIdentity>>,
    Path(id): Path<String>,
) -> Response {
    let owner = match owner_id(
        &state,
        &headers,
        caller.as_ref().map(|Extension(caller)| caller),
    ) {
        Ok(owner) => owner,
        Err(error) => return error_response(error),
    };
    let conn = match state.db_conn.lock() {
        Ok(conn) => conn,
        Err(_) => {
            return error_response(fault(
                StatusCode::INTERNAL_SERVER_ERROR,
                "asset_storage_unavailable",
                "Asset storage is temporarily unavailable.",
            ))
        }
    };
    let row = match load_asset(&conn, &id) {
        Ok(Some(row)) => row,
        Ok(None) => return StatusCode::NO_CONTENT.into_response(),
        Err(error) => return error_response(error),
    };
    if row.owner_id != owner && owner != LOCAL_OWNER {
        return error_response(fault(
            StatusCode::NOT_FOUND,
            "asset_not_found",
            "The attachment is missing or not accessible to this caller.",
        ));
    }
    let linked: bool = match conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM decision_task_assets WHERE asset_id=?1) OR EXISTS(SELECT 1 FROM systorch_start_session_assets WHERE asset_id=?1)",
        [&id],
        |row| row.get(0),
    ) {
        Ok(linked) => linked,
        Err(_) => {
            return error_response(fault(
                StatusCode::INTERNAL_SERVER_ERROR,
                "asset_storage_unavailable",
                "Asset references could not be checked.",
            ))
        }
    };
    if linked {
        return error_response(fault(StatusCode::CONFLICT, "asset_in_use", "This attachment belongs to saved conversation data. Delete its owning decision or chat before removing the asset."));
    }
    if conn
        .execute("DELETE FROM systorch_assets WHERE id=?1", [&id])
        .is_err()
    {
        return error_response(fault(
            StatusCode::INTERNAL_SERVER_ERROR,
            "asset_storage_unavailable",
            "The attachment could not be removed.",
        ));
    }
    StatusCode::NO_CONTENT.into_response()
}
