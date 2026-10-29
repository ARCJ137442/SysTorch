use super::*;
use base64::{engine::general_purpose::STANDARD, Engine as _};
use jev_protocol::{Criteria, Instructions, Question};
use rusqlite::{params, Connection, OptionalExtension};

#[derive(Serialize)]
struct CanonicalDigest<'a> {
    entry: &'a str,
    idempotency_key: &'a str,
    ttl_seconds: i64,
    question_order: Vec<String>,
    jev_request: jev_protocol::JevRequest,
}

#[derive(Clone, Serialize)]
#[serde(deny_unknown_fields)]
struct LegacyChoiceQuestionDigest {
    r#type: String,
    instructions: Value,
    criteria: std::collections::BTreeMap<String, String>,
}

/// This struct intentionally preserves the old M1 serde field order and Choice DTO.
/// It is used only to recognize idempotent retries stored by earlier candidates.
#[derive(Serialize)]
struct LegacySubmissionDigest {
    entry: String,
    idempotency_key: String,
    question: String,
    context: Value,
    choices: Vec<Choice>,
    #[serde(skip_serializing_if = "Option::is_none")]
    questions: Option<std::collections::BTreeMap<String, LegacyChoiceQuestionDigest>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    question_order: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    assets: Option<std::collections::BTreeMap<String, RequestAsset>>,
    ttl_seconds: i64,
}

pub(super) fn idempotency_digests(
    request: &Submission,
    vault: &vault::Vault,
) -> Result<(String, Vec<String>)> {
    let projection = request.jev_projection().ok_or_else(|| {
        fault(
            StatusCode::BAD_REQUEST,
            "incomplete_typesafe_request",
            "The task does not contain a complete TypeSafe-compatible request core.",
        )
    })?;
    let canonical = CanonicalDigest {
        entry: &request.entry,
        idempotency_key: &request.idempotency_key,
        ttl_seconds: request.ttl_seconds,
        question_order: super::ordered_question_ids(request),
        jev_request: projection,
    };
    let canonical_bytes = serde_json::to_vec(&canonical).map_err(internal)?;
    let canonical_digest = vault.digest(&canonical_bytes);

    let legacy_questions = request.questions.as_ref().and_then(|questions| {
        questions
            .iter()
            .map(|(id, question)| {
                let Question::Choice {
                    instructions,
                    criteria: Criteria::Map(criteria),
                } = question
                else {
                    return None;
                };
                let criteria = criteria
                    .iter()
                    .map(|(key, value)| match value {
                        jev_protocol::CriterionValue::Text(text) => {
                            Some((key.clone(), text.clone()))
                        }
                        _ => None,
                    })
                    .collect::<Option<std::collections::BTreeMap<_, _>>>()?;
                Some((
                    id.clone(),
                    LegacyChoiceQuestionDigest {
                        r#type: "choice".into(),
                        instructions: serde_json::to_value(instructions).ok()?,
                        criteria,
                    },
                ))
            })
            .collect::<Option<std::collections::BTreeMap<_, _>>>()
    });
    let first_id = super::ordered_question_ids(request).first().cloned();
    let first_question = first_id
        .as_deref()
        .and_then(|id| super::question(request, id));
    let legacy_question = request.question.clone().or_else(|| {
        first_question.as_ref().map(|question| match question {
            Question::Choice { instructions, .. }
            | Question::Score { instructions, .. }
            | Question::Noul { instructions, .. }
            | Question::Box { instructions } => question_text(instructions),
        })
    });
    let legacy_choices = request.choices.clone().or_else(|| {
        first_id
            .as_deref()
            .and_then(|id| super::question_choices(request, id))
    });
    let mut legacy_digests = Vec::new();
    if let (Some(question), Some(choices)) = (legacy_question, legacy_choices) {
        let context = request
            .context
            .clone()
            .or_else(|| request.state.clone())
            .unwrap_or(Value::Null);
        let build = |questions, question_order| LegacySubmissionDigest {
            entry: request.entry.clone(),
            idempotency_key: request.idempotency_key.clone(),
            question: question.clone(),
            context: context.clone(),
            choices: choices.clone(),
            questions,
            question_order,
            assets: request.assets.clone(),
            ttl_seconds: request.ttl_seconds,
        };
        if let Some(questions) = legacy_questions {
            for order in [request.question_order.clone(), None] {
                let bytes =
                    serde_json::to_vec(&build(Some(questions.clone()), order)).map_err(internal)?;
                legacy_digests.push(vault.digest(&bytes));
            }
        }
        if request
            .questions
            .as_ref()
            .is_none_or(|questions| questions.len() == 1 && questions.contains_key("choice"))
        {
            let bytes = serde_json::to_vec(&build(None, None)).map_err(internal)?;
            legacy_digests.push(vault.digest(&bytes));
        }
    }
    legacy_digests.sort();
    legacy_digests.dedup();
    Ok((canonical_digest, legacy_digests))
}

fn question_text(instructions: &Instructions) -> String {
    match instructions {
        Instructions::Text(text) => text.clone(),
        Instructions::Object(object) => object
            .get("text")
            .and_then(Value::as_str)
            .map(str::to_owned)
            .unwrap_or_else(|| serde_json::to_string(instructions).unwrap_or_default()),
        Instructions::Array(_) => serde_json::to_string(instructions).unwrap_or_default(),
    }
}

fn validate_question(id: &str, question: &Question) -> Result<()> {
    let instructions = match question {
        Question::Choice { instructions, .. }
        | Question::Score { instructions, .. }
        | Question::Noul { instructions, .. }
        | Question::Box { instructions } => instructions,
    };
    let text = question_text(instructions);
    let serialized = serde_json::to_vec(instructions).map_err(internal)?;
    if id.trim().is_empty() || id.len() > 128 || text.trim().is_empty() || serialized.len() > 8192 {
        return Err(fault(
            StatusCode::BAD_REQUEST,
            "invalid_question",
            "Each question needs a stable ID and nonempty instructions no larger than 8192 bytes.",
        ));
    }
    let valid = match question {
        Question::Choice {
            criteria: Criteria::Map(criteria),
            ..
        } => (2..=255).contains(&criteria.len()),
        Question::Score {
            criteria: Criteria::List(levels),
            ..
        } => (2..=10).contains(&levels.len()),
        Question::Noul { criteria: None, .. } | Question::Box { .. } => true,
        Question::Noul {
            criteria: Some(Criteria::Bool { .. }),
            ..
        } => true,
        Question::Noul {
            criteria: Some(Criteria::Map(criteria)),
            ..
        } => criteria.len() == 2 && criteria.contains_key("true") && criteria.contains_key("false"),
        _ => false,
    };
    if !valid {
        return Err(fault(
            StatusCode::BAD_REQUEST,
            "unsupported_question_shape",
            "Choice requires 2–255 options, Score requires 2–10 ordered levels, Noul requires an optional true/false pair, and Box takes no criteria.",
        ));
    }
    Ok(())
}

fn contains_asset_reference(value: &Value, reference: &str) -> bool {
    match value {
        Value::Object(object) => {
            let explicit = object
                .get("_systorch")
                .and_then(Value::as_object)
                .and_then(|metadata| metadata.get("assets"))
                .and_then(Value::as_array)
                .is_some_and(|assets| assets.iter().any(|asset| asset.as_str() == Some(reference)));
            explicit
                || object
                    .values()
                    .any(|child| contains_asset_reference(child, reference))
        }
        Value::Array(items) => items
            .iter()
            .any(|child| contains_asset_reference(child, reference)),
        _ => false,
    }
}

fn validate_box_images(request: &Submission, questions: &BTreeMap<String, Question>) -> Result<()> {
    let state = request
        .state
        .as_ref()
        .or(request.context.as_ref())
        .cloned()
        .unwrap_or(Value::Null);
    for (question_id, question) in questions {
        let Question::Box { instructions } = question else {
            continue;
        };
        let question_content = serde_json::to_value(instructions).map_err(internal)?;
        let has_referenced_image = request.assets.as_ref().is_some_and(|assets| {
            assets.iter().any(|(reference, asset)| {
                asset.r#type == "image"
                    && (contains_asset_reference(&state, reference)
                        || contains_asset_reference(&question_content, reference))
            })
        });
        if !has_referenced_image {
            return Err(fault(
                StatusCode::UNPROCESSABLE_ENTITY,
                "box_requires_image",
                "A Box question must reference an image in its own instructions or shared state.",
            ));
        }
        if question_id.is_empty() {
            return Err(fault(
                StatusCode::BAD_REQUEST,
                "invalid_question",
                "A Box question needs a stable question ID.",
            ));
        }
    }
    Ok(())
}

fn validate_assets(request: &Submission) -> Result<()> {
    let Some(assets) = &request.assets else {
        return Ok(());
    };
    if assets.is_empty() || assets.len() > 128 {
        return Err(fault(
            StatusCode::BAD_REQUEST,
            "invalid_assets",
            "A message with assets must register 1–128 distinct references.",
        ));
    }
    let mut total_inline = 0usize;
    let empty_state = Value::Null;
    let state = request
        .state
        .as_ref()
        .or(request.context.as_ref())
        .unwrap_or(&empty_state);
    let content =
        serde_json::to_value((state, &request.questions, &request.question)).map_err(internal)?;
    crate::assets::validate_asset_references(&content, assets)
        .map_err(|error| fault(error.0, error.1, error.2))?;
    for (reference, asset) in assets {
        if reference.is_empty()
            || reference.len() > 1024
            || asset.r#type.trim().is_empty()
            || asset.r#type.len() > 64
            || asset
                .filename
                .as_ref()
                .is_some_and(|name| name.is_empty() || name.len() > 255)
            || asset
                .mime_type
                .as_ref()
                .is_some_and(|mime| mime.is_empty() || mime.len() > 255)
            || asset
                .format
                .as_ref()
                .is_some_and(|format| format.is_empty() || format.len() > 32)
        {
            return Err(fault(StatusCode::BAD_REQUEST, "invalid_asset_reference", "Each asset needs a stable ID, media type, optional bounded metadata, and at least one reference in shared context or a question."));
        }
        match (&asset.data_base64, &asset.asset_id) {
            (Some(_), Some(_)) | (None, None) => {
                return Err(fault(
                    StatusCode::BAD_REQUEST,
                    "invalid_asset_source",
                    "Provide exactly one of inline data_base64 or an uploaded asset_id.",
                ))
            }
            (Some(encoded), None) => {
                if encoded.starts_with("data:") {
                    return Err(fault(
                        StatusCode::BAD_REQUEST,
                        "invalid_asset_base64",
                        "Inline data_base64 must omit the data URL prefix.",
                    ));
                }
                let data = STANDARD.decode(encoded).map_err(|_| {
                    fault(
                        StatusCode::BAD_REQUEST,
                        "invalid_asset_base64",
                        "The asset data_base64 value is malformed.",
                    )
                })?;
                if data.is_empty() || data.len() > 64 * 1024 * 1024 {
                    return Err(fault(
                        StatusCode::PAYLOAD_TOO_LARGE,
                        "asset_too_large",
                        "Keep each decoded asset at or below 64 MiB.",
                    ));
                }
                total_inline = total_inline.saturating_add(data.len());
            }
            (None, Some(asset_id)) if asset_id.is_empty() || asset_id.len() > 128 => {
                return Err(fault(
                    StatusCode::BAD_REQUEST,
                    "invalid_asset_id",
                    "The uploaded asset ID is invalid.",
                ));
            }
            (None, Some(_)) => (),
        }
    }
    if total_inline > 64 * 1024 * 1024 {
        return Err(fault(
            StatusCode::PAYLOAD_TOO_LARGE,
            "assets_too_large",
            "Keep inline assets in one message at or below 64 MiB decoded.",
        ));
    }
    Ok(())
}

fn maintain(conn: &Connection, now: i64) -> Result<()> {
    conn.execute("UPDATE decision_tasks SET status='expired',updated_at=deadline WHERE status='pending' AND deadline<=?1",[now]).map_err(internal)?;
    conn.execute("UPDATE decision_tasks SET payload=x'' WHERE status!='pending' AND updated_at<=?1 AND length(payload)>0",[now-RETENTION]).map_err(internal)?;
    conn.execute(
        "DELETE FROM decision_task_assets WHERE task_id IN (SELECT id FROM decision_tasks WHERE length(payload)=0)",
        [],
    )
    .map_err(internal)?;
    crate::assets::cleanup_expired_assets(conn, now)
        .map_err(|error| fault(error.0, error.1, error.2))?;
    Ok(())
}

pub(super) fn validate(request: &Submission) -> Result<()> {
    if request.entry != "human:owner"
        || request.idempotency_key.is_empty()
        || request.idempotency_key.len() > 128
        || !(1..=7 * 86400).contains(&request.ttl_seconds)
        || request
            .model
            .as_ref()
            .is_some_and(|model| model.trim().is_empty() || model.len() > 1024)
        || request
            .state
            .as_ref()
            .zip(request.context.as_ref())
            .is_some_and(|(state, legacy_context)| state != legacy_context)
    {
        return Err(fault(StatusCode::BAD_REQUEST,"invalid_decision","Use entry human:owner, a valid model, a consistent TypeSafe state/legacy context, an idempotency key (1–128 bytes) and a deadline of 1 second to 7 days."));
    }
    let canonical = request.model.is_some() || request.state.is_some();
    if canonical
        && (request.model.is_none() || request.state.is_none() || request.questions.is_none())
    {
        return Err(fault(
            StatusCode::BAD_REQUEST,
            "incomplete_typesafe_request",
            "The canonical request requires model, state and questions together.",
        ));
    }
    if !canonical && (request.question.is_none() || request.choices.is_none()) {
        return Err(fault(
            StatusCode::BAD_REQUEST,
            "invalid_legacy_request",
            "Provide a complete model/state/questions request or the deprecated question/context/choices M1 shape.",
        ));
    }
    if let Some(questions) = &request.questions {
        if !(1..=32).contains(&questions.len()) {
            return Err(fault(
                StatusCode::BAD_REQUEST,
                "invalid_questions",
                "A durable task must contain 1–32 questions.",
            ));
        }
        for (id, question) in questions {
            validate_question(id, question)?;
        }
        validate_box_images(request, questions)?;
        let order = super::ordered_question_ids(request);
        let unique: std::collections::HashSet<_> = order.iter().collect();
        if order.len() != questions.len()
            || unique.len() != questions.len()
            || order.iter().any(|id| !questions.contains_key(id))
        {
            return Err(fault(
                StatusCode::BAD_REQUEST,
                "invalid_question_order",
                "question_order must list every question ID exactly once.",
            ));
        }
        let first_id = order.first().expect("nonempty validated question map");
        let first = &questions[first_id];
        let first_text = match first {
            Question::Choice { instructions, .. }
            | Question::Score { instructions, .. }
            | Question::Noul { instructions, .. }
            | Question::Box { instructions } => question_text(instructions),
        };
        let question_mirror_matches = request
            .question
            .as_ref()
            .is_none_or(|legacy_question| first_text == *legacy_question);
        let choices_mirror_matches = match (&request.choices, first) {
            (None, _) => true,
            (Some(choices), Question::Choice { .. }) => {
                let expected: std::collections::BTreeMap<_, _> =
                    super::question_choices(request, first_id)
                        .unwrap_or_default()
                        .into_iter()
                        .map(|choice| (choice.id, choice.label))
                        .collect();
                let actual: std::collections::BTreeMap<_, _> = choices
                    .iter()
                    .map(|choice| (choice.id.clone(), choice.label.clone()))
                    .collect();
                choices.len() == actual.len() && expected == actual
            }
            (Some(choices), _) => choices.is_empty(),
        };
        if !question_mirror_matches || !choices_mirror_matches {
            return Err(fault(
                StatusCode::BAD_REQUEST,
                "legacy_question_mirror_mismatch",
                "If legacy question/choices mirrors are present, they must agree with the first ordered question and its Choice options.",
            ));
        }
    } else {
        if request.question_order.is_some() {
            return Err(fault(
                StatusCode::BAD_REQUEST,
                "question_order_without_questions",
                "question_order requires a questions map.",
            ));
        }
        let question = request.question.as_deref().unwrap_or_default();
        if question.trim().is_empty() || question.len() > 8192 {
            return Err(fault(
                StatusCode::BAD_REQUEST,
                "invalid_question",
                "Enter nonempty instructions no larger than 8192 bytes.",
            ));
        }
        let choices = request
            .choices
            .as_ref()
            .expect("legacy shape checked above");
        if !(2..=32).contains(&choices.len())
            || choices.iter().any(|choice| {
                choice.id.is_empty()
                    || choice.id.len() > 64
                    || choice.label.trim().is_empty()
                    || choice.label.len() > 4096
            })
            || request
                .choices
                .as_ref()
                .into_iter()
                .flatten()
                .map(|choice| &choice.id)
                .collect::<std::collections::HashSet<_>>()
                .len()
                != choices.len()
        {
            return Err(fault(
                StatusCode::BAD_REQUEST,
                "invalid_choices",
                "A legacy single Choice task needs 2–32 unique candidates with nonempty labels no larger than 4096 bytes.",
            ));
        }
    }
    let projection = request.jev_projection().ok_or_else(|| {
        fault(
            StatusCode::BAD_REQUEST,
            "incomplete_typesafe_request",
            "The SysTorch task must project to a valid TypeSafe model/state/questions request.",
        )
    })?;
    if projection.model.trim().is_empty() || projection.questions.is_empty() {
        return Err(fault(
            StatusCode::BAD_REQUEST,
            "incomplete_typesafe_request",
            "The projected Jev request needs a model and at least one question.",
        ));
    }
    validate_assets(request)?;
    let bytes = serde_json::to_vec(&request).map_err(internal)?;
    if bytes.len() > MAX_BODY {
        return Err(fault(StatusCode::PAYLOAD_TOO_LARGE,"decision_too_large","Keep the complete request within 64 KiB; upload larger media through the asset endpoint."));
    }
    Ok(())
}

pub(super) fn create(
    conn: &mut Connection,
    vault: &vault::Vault,
    caller: &str,
    request: Submission,
    now: i64,
) -> Result<(Task, bool)> {
    validate(&request)?;
    let (digest, legacy_digests) = idempotency_digests(&request, vault)?;
    let key_digest = vault.digest(request.idempotency_key.as_bytes());
    maintain(conn, now)?;
    let tx = conn
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(internal)?;
    let old: Option<(String,String)> = tx.query_row("SELECT id,digest FROM decision_tasks WHERE caller=?1 AND entry=?2 AND idempotency_key=?3",params![caller,request.entry,key_digest],|r|Ok((r.get(0)?,r.get(1)?))).optional().map_err(internal)?;
    if let Some((id, old_digest)) = old {
        let digest_matches = if old_digest == digest || legacy_digests.contains(&old_digest) {
            true
        } else {
            read(&tx, vault, caller, &id, now)
                .ok()
                .and_then(|old_task| idempotency_digests(&old_task.request, vault).ok())
                .is_some_and(|(old_canonical, _)| old_canonical == digest)
        };
        if !digest_matches {
            return Err(fault(StatusCode::CONFLICT,"idempotency_conflict","This key already identifies another request. Retry the original body, or use a new key for a new decision."));
        }
        return read(&tx, vault, caller, &id, now).map(|t| (t, false));
    }
    let total: i64 = tx
        .query_row("SELECT count(*) FROM decision_tasks", [], |r| r.get(0))
        .map_err(internal)?;
    if total >= CAPACITY {
        return Err(fault(StatusCode::TOO_MANY_REQUESTS,"decision_capacity","The personal queue has reached its 10,000-task limit. No task was accepted or evicted. Archive this data directory before beginning a new queue."));
    }
    let mut random = [0; 16];
    getrandom::getrandom(&mut random).map_err(internal)?;
    let id = format!(
        "choice_{}",
        random
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect::<String>()
    );
    let task = Task {
        id: id.clone(),
        caller: caller.into(),
        assignee: OWNER.into(),
        revision: 1,
        status: "pending".into(),
        created_at: now,
        deadline: now + request.ttl_seconds,
        updated_at: now,
        request,
        observation: None,
        observations: BTreeMap::new(),
        projection_policy: "human-choice-one-hot/v1".into(),
        previous_requests: vec![],
        clarifications: vec![],
    };
    let sealed = vault
        .seal(&id, &serde_json::to_vec(&task).map_err(internal)?)
        .map_err(internal)?;
    tx.execute("INSERT INTO decision_tasks(id,caller,entry,idempotency_key,digest,status,revision,created_at,deadline,updated_at,payload) VALUES(?1,?2,?3,?4,?5,'pending',1,?6,?7,?6,?8)",params![id,caller,task.request.entry,key_digest,digest,now,task.deadline,sealed]).map_err(internal)?;
    crate::assets::attach_assets_to_task(
        &tx,
        caller,
        &id,
        task.deadline + RETENTION,
        task.request.assets.as_ref(),
    )
    .map_err(|error| fault(error.0, error.1, error.2))?;
    tx.commit().map_err(internal)?;
    Ok((task, true))
}

pub(super) fn read(
    conn: &Connection,
    vault: &vault::Vault,
    caller: &str,
    id: &str,
    now: i64,
) -> Result<Task> {
    maintain(conn, now)?;
    let row: Option<(String, String, i64, Vec<u8>)> = conn
        .query_row(
            "SELECT caller,status,updated_at,payload FROM decision_tasks WHERE id=?1",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .optional()
        .map_err(internal)?;
    let Some((owner, status, updated, payload)) = row else {
        return Err(fault(
            StatusCode::NOT_FOUND,
            "decision_not_found",
            "No accessible task has this ID.",
        ));
    };
    if caller != OWNER && caller != owner {
        return Err(fault(
            StatusCode::NOT_FOUND,
            "decision_not_found",
            "No accessible task has this ID.",
        ));
    }
    if payload.is_empty() {
        return Err(fault(StatusCode::GONE,"decision_erased","The task content was erased or passed its seven-day terminal retention window. The idempotency tombstone prevents replay."));
    }
    let mut task: Task =
        serde_json::from_slice(&vault.open_payload(id, &payload).map_err(internal)?)
            .map_err(internal)?;
    if task.caller != owner || task.id != id {
        return Err(internal("metadata mismatch"));
    }
    task.status = status;
    task.updated_at = updated;
    Ok(task)
}

pub(super) fn list(
    conn: &Connection,
    vault: &vault::Vault,
    caller: &str,
    offset: u32,
    now: i64,
) -> Result<Vec<Task>> {
    maintain(conn, now)?;
    let mut stmt = conn.prepare("SELECT id FROM decision_tasks WHERE (caller=?1 OR ?1='local-owner') AND length(payload)>0 ORDER BY CASE status WHEN 'pending' THEN 0 ELSE 1 END,created_at DESC,id LIMIT 25 OFFSET ?2").map_err(internal)?;
    let ids: Vec<String> = stmt
        .query_map(params![caller, offset], |r| r.get(0))
        .map_err(internal)?
        .collect::<rusqlite::Result<_>>()
        .map_err(internal)?;
    ids.iter()
        .map(|id| read(conn, vault, caller, id, now))
        .collect()
}

pub(super) fn answer(
    conn: &mut Connection,
    vault: &vault::Vault,
    id: &str,
    body: AnswerSubmission,
    now: i64,
) -> Result<Task> {
    let incoming = match (body.observation, body.observations, body.question_id) {
        (Some(observation), None, question_id) => {
            [(question_id.unwrap_or_else(|| "choice".into()), observation)]
                .into_iter()
                .collect::<std::collections::BTreeMap<_, _>>()
        }
        (None, Some(observations), None)
            if !observations.is_empty() && observations.len() <= 32 =>
        {
            observations
        }
        _ => {
            return Err(fault(
                StatusCode::BAD_REQUEST,
                "invalid_answer_shape",
                "Send either one observation with an optional question_id, or a nonempty observations map.",
            ));
        }
    };
    maintain(conn, now)?;
    let tx = conn
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(internal)?;
    let mut task = read(&tx, vault, OWNER, id, now)?;
    if body.revision != task.revision {
        return Err(fault(StatusCode::CONFLICT,"revision_conflict","The answer refers to another request revision. Reload the task and review its facts before answering."));
    }
    let question_ids = super::ordered_question_ids(&task.request);
    let mut all_are_replays = true;
    for (question_id, observation) in &incoming {
        let Some(question) = super::question(&task.request, question_id) else {
            return Err(fault(
                StatusCode::BAD_REQUEST,
                "unknown_question",
                "Answer only a question included in this task.",
            ));
        };
        if let Some(previous) = task.observations.get(question_id).or_else(|| {
            (question_ids.len() == 1 && question_id == "choice")
                .then_some(task.observation.as_ref())
                .flatten()
        }) {
            if previous == observation {
                continue;
            }
            return Err(fault(
                StatusCode::CONFLICT,
                "answer_conflict",
                "This question already has a different accepted answer.",
            ));
        }
        all_are_replays = false;
        match observation {
            Observation::Answered { choice_id, note } => {
                let Some(choices) = super::question_choices(&task.request, question_id) else {
                    return Err(fault(
                        StatusCode::UNPROCESSABLE_ENTITY,
                        "answer_type_mismatch",
                        "A Choice answer can only answer a Choice question.",
                    ));
                };
                if !choices.iter().any(|choice| &choice.id == choice_id) {
                    return Err(fault(
                        StatusCode::BAD_REQUEST,
                        "unknown_choice",
                        "Select a candidate from this question.",
                    ));
                }
                if note.as_ref().is_some_and(|note| note.len() > 4096) {
                    return Err(fault(
                        StatusCode::BAD_REQUEST,
                        "invalid_note",
                        "Keep the optional answer note within 4096 bytes.",
                    ));
                }
            }
            Observation::Conditional {
                choice_id,
                condition,
            } => {
                let Some(choices) = super::question_choices(&task.request, question_id) else {
                    return Err(fault(
                        StatusCode::UNPROCESSABLE_ENTITY,
                        "answer_type_mismatch",
                        "A conditional Choice answer can only answer a Choice question.",
                    ));
                };
                if !choices.iter().any(|choice| &choice.id == choice_id) {
                    return Err(fault(
                        StatusCode::BAD_REQUEST,
                        "unknown_choice",
                        "Select a candidate from this question.",
                    ));
                }
                if condition.trim().is_empty() || condition.len() > 4096 {
                    return Err(fault(StatusCode::BAD_REQUEST, "invalid_condition", "Give a condition within 4096 bytes; this will not produce unconditional approval."));
                }
            }
            Observation::Declined { reason } if reason.trim().is_empty() || reason.len() > 4096 => {
                return Err(fault(
                    StatusCode::BAD_REQUEST,
                    "invalid_reason",
                    "Give a refusal reason within 4096 bytes.",
                ));
            }
            Observation::Declined { .. } => (),
            Observation::Noul { note, .. }
                if note.as_ref().is_some_and(|note| note.len() > 4096) =>
            {
                return Err(fault(
                    StatusCode::BAD_REQUEST,
                    "invalid_note",
                    "Keep the optional answer note within 4096 bytes.",
                ));
            }
            Observation::Noul { .. } if matches!(&question, Question::Noul { .. }) => (),
            Observation::Noul { .. } => {
                return Err(fault(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "answer_type_mismatch",
                    "A Noul answer can only answer a Noul question.",
                ));
            }
            Observation::Score { level_index, note } => {
                if note.as_ref().is_some_and(|note| note.len() > 4096) {
                    return Err(fault(
                        StatusCode::BAD_REQUEST,
                        "invalid_note",
                        "Keep the optional answer note within 4096 bytes.",
                    ));
                }
                match &question {
                    Question::Score {
                        criteria: Criteria::List(levels),
                        ..
                    } if usize::from(*level_index) < levels.len() => (),
                    Question::Score { .. } => {
                        return Err(fault(
                            StatusCode::BAD_REQUEST,
                            "score_level_out_of_range",
                            "Choose a level that exists in the ordered Score criteria.",
                        ));
                    }
                    _ => {
                        return Err(fault(
                            StatusCode::UNPROCESSABLE_ENTITY,
                            "answer_type_mismatch",
                            "A Score answer can only answer a Score question.",
                        ));
                    }
                }
            }
            Observation::Box {
                top,
                bottom,
                left,
                right,
                note,
            } => {
                if note.as_ref().is_some_and(|note| note.len() > 4096) {
                    return Err(fault(
                        StatusCode::BAD_REQUEST,
                        "invalid_note",
                        "Keep the optional answer note within 4096 bytes.",
                    ));
                }
                if !matches!(question, Question::Box { .. }) {
                    return Err(fault(
                        StatusCode::UNPROCESSABLE_ENTITY,
                        "answer_type_mismatch",
                        "A Box answer can only answer a Box question.",
                    ));
                }
                if [*top, *bottom, *left, *right]
                    .iter()
                    .any(|edge| !edge.is_finite() || !(0.0..=1.0).contains(edge))
                    || top >= bottom
                    || left >= right
                {
                    return Err(fault(
                        StatusCode::BAD_REQUEST,
                        "invalid_box_coordinates",
                        "Box edges must be finite fractions in [0,1], with top < bottom and left < right.",
                    ));
                }
            }
        }
    }
    if all_are_replays {
        return Ok(task);
    }
    if task.status != "pending" {
        return Err(fault(StatusCode::CONFLICT,"decision_closed","Another answer, cancellation or deadline already closed this task. Reload the accepted result; your draft was not submitted."));
    }
    task.observations.extend(incoming);
    let complete = question_ids
        .iter()
        .all(|id| task.observations.contains_key(id));
    if question_ids.len() == 1 && question_ids[0] == "choice" {
        task.observation = task.observations.get("choice").cloned();
    }
    task.status = if complete { "completed" } else { "pending" }.into();
    task.updated_at = now;
    let sealed = vault
        .seal(id, &serde_json::to_vec(&task).map_err(internal)?)
        .map_err(internal)?;
    let changed = tx.execute("UPDATE decision_tasks SET status=?2,updated_at=?3,payload=?4 WHERE id=?1 AND status='pending' AND revision=?5 AND deadline>?3",params![id,task.status,now,sealed,body.revision]).map_err(internal)?;
    if changed != 1 {
        return Err(fault(
            StatusCode::CONFLICT,
            "decision_closed",
            "The task expired or changed before this answer could be saved.",
        ));
    }
    tx.commit().map_err(internal)?;
    Ok(task)
}

pub(super) fn cancel(
    conn: &mut Connection,
    vault: &vault::Vault,
    caller: &str,
    id: &str,
    now: i64,
) -> Result<Task> {
    maintain(conn, now)?;
    let tx = conn
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(internal)?;
    let mut task = read(&tx, vault, caller, id, now)?;
    if task.status == "cancelled" {
        return Ok(task);
    }
    if task.status != "pending" {
        return Err(fault(
            StatusCode::CONFLICT,
            "decision_closed",
            "Only a pending task can be cancelled; viewing or closing the page never cancels it.",
        ));
    }
    tx.execute("UPDATE decision_tasks SET status='cancelled',updated_at=?2 WHERE id=?1 AND status='pending'",params![id,now]).map_err(internal)?;
    tx.commit().map_err(internal)?;
    task.status = "cancelled".into();
    task.updated_at = now;
    Ok(task)
}

pub(super) fn edit(
    conn: &mut Connection,
    vault: &vault::Vault,
    caller: &str,
    id: &str,
    revision: i64,
    now: i64,
    change: impl FnOnce(&mut Task) -> Result<()>,
) -> Result<Task> {
    maintain(conn, now)?;
    let tx = conn
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(internal)?;
    let mut task = read(&tx, vault, caller, id, now)?;
    if task.status != "pending" || task.revision != revision {
        return Err(fault(
            StatusCode::CONFLICT,
            "revision_conflict",
            "This task is closed or has changed. Reload before submitting.",
        ));
    }
    change(&mut task)?;
    let bytes = serde_json::to_vec(&task).map_err(internal)?;
    if bytes.len() > 256 * 1024 {
        return Err(fault(StatusCode::PAYLOAD_TOO_LARGE,"revision_capacity","The revision history reached 256 KiB. Cancel and submit a new task rather than discarding prior facts."));
    }
    task.updated_at = now;
    let sealed = vault.seal(id, &bytes).map_err(internal)?;
    tx.execute(
        "UPDATE decision_tasks SET revision=?2,updated_at=?3,payload=?4 WHERE id=?1",
        params![id, task.revision, now, sealed],
    )
    .map_err(internal)?;
    tx.commit().map_err(internal)?;
    Ok(task)
}

pub(super) fn erase(conn: &mut Connection, caller: &str, id: &str, now: i64) -> Result<()> {
    maintain(conn, now)?;
    let tx = conn
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(internal)?;
    let status: Option<String> = tx
        .query_row(
            "SELECT status FROM decision_tasks WHERE id=?1 AND (caller=?2 OR ?2='local-owner')",
            params![id, caller],
            |r| r.get(0),
        )
        .optional()
        .map_err(internal)?;
    match status.as_deref() {
        None => Err(fault(
            StatusCode::NOT_FOUND,
            "decision_not_found",
            "No accessible task has this ID.",
        )),
        Some("pending") => Err(fault(
            StatusCode::CONFLICT,
            "decision_pending",
            "Cancel this pending task explicitly before erasing its content.",
        )),
        _ => {
            tx.execute("UPDATE decision_tasks SET payload=x'' WHERE id=?1", [id])
                .map_err(internal)?;
            crate::assets::detach_task_assets(&tx, id)
                .map_err(|error| fault(error.0, error.1, error.2))?;
            tx.commit().map_err(internal)?;
            Ok(())
        }
    }
}
