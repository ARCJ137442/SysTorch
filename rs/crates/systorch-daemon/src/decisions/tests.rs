use super::*;
use jev_protocol::{CriterionValue, Instructions};
use rusqlite::Connection;
use std::collections::BTreeMap;

fn fixture() -> (Connection, vault::Vault) {
    let conn = Connection::open_in_memory().unwrap();
    crate::db::init_database(&conn).unwrap();
    let root = std::env::temp_dir().join(format!(
        "systorch-m1-unit-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    std::fs::create_dir(&root).unwrap();
    let key = vault::Vault::open(&root.join("providers.toml"), true).unwrap();
    std::fs::remove_file(root.join("systorch-owner.key")).unwrap();
    std::fs::remove_dir(root).unwrap();
    (conn, key)
}
fn submission() -> Submission {
    Submission {
        model: None,
        state: None,
        entry: "human:owner".into(),
        idempotency_key: "test".into(),
        question: Some("Take a break?".into()),
        context: Some(serde_json::json!({"private":"fixture-only-secret"})),
        choices: Some(vec![
            Choice {
                id: "yes".into(),
                label: "Break".into(),
            },
            Choice {
                id: "no".into(),
                label: "Continue".into(),
            },
        ]),
        questions: None,
        question_order: None,
        assets: None,
        extensions: None,
        ttl_seconds: 60,
    }
}
fn answer(choice: &str) -> AnswerSubmission {
    AnswerSubmission {
        revision: 1,
        question_id: None,
        observation: Some(Observation::Answered {
            choice_id: choice.into(),
            note: None,
        }),
        observations: None,
    }
}

fn multi_submission() -> Submission {
    let first_criteria = [
        (
            "review".into(),
            CriterionValue::Text("Review the plan".into()),
        ),
        ("test".into(), CriterionValue::Text("Run a test".into())),
    ]
    .into();
    let second_criteria = [
        ("fix".into(), CriterionValue::Text("Fix it now".into())),
        (
            "monitor".into(),
            CriterionValue::Text("Record and monitor".into()),
        ),
    ]
    .into();
    let first = Question::Choice {
        instructions: Instructions::Text("Which first step?".into()),
        criteria: Criteria::Map(first_criteria),
    };
    let second = Question::Choice {
        instructions: Instructions::Text("How should risk be handled?".into()),
        criteria: Criteria::Map(second_criteria),
    };
    let first_choices = first.criteria().unwrap().clone();
    let Criteria::Map(criteria) = first_choices else {
        unreachable!();
    };
    let first_choices = criteria
        .iter()
        .map(|(id, label)| Choice {
            id: id.clone(),
            label: match label {
                CriterionValue::Text(text) => text.clone(),
                _ => unreachable!(),
            },
        })
        .collect();
    Submission {
        model: None,
        state: None,
        entry: "human:owner".into(),
        idempotency_key: "multi-test".into(),
        question: Some("Which first step?".into()),
        context: Some(serde_json::json!({"private":"multi-fixture"})),
        choices: Some(first_choices),
        questions: Some([("question-a".into(), first), ("question-b".into(), second)].into()),
        question_order: Some(vec!["question-a".into(), "question-b".into()]),
        assets: None,
        extensions: None,
        ttl_seconds: 60,
    }
}

fn request_asset(asset_id: &str) -> RequestAsset {
    RequestAsset {
        r#type: "image".into(),
        format: Some("png".into()),
        mime_type: Some("image/png".into()),
        filename: Some("fixture.png".into()),
        data_base64: None,
        asset_id: Some(asset_id.into()),
    }
}

fn insert_encrypted_asset(
    conn: &Connection,
    vault: &vault::Vault,
    id: &str,
    owner: &str,
    bytes: &[u8],
    expires_at: i64,
) {
    let created_at = expires_at - 100;
    let payload = vault.seal(id, bytes).unwrap();
    let digest = vault.digest(bytes);
    conn.execute(
        "INSERT INTO systorch_assets(id,owner_id,mime_type,byte_length,digest,created_at,expires_at,payload) VALUES(?1,?2,'image/png',?3,?4,?5,?6,?7)",
        rusqlite::params![id, owner, bytes.len() as i64, digest, created_at, expires_at, payload],
    )
    .unwrap();
}

fn answer_batch(answers: &[(&str, &str)]) -> AnswerSubmission {
    AnswerSubmission {
        revision: 1,
        question_id: None,
        observation: None,
        observations: Some(
            answers
                .iter()
                .map(|(question, choice)| {
                    (
                        (*question).into(),
                        Observation::Answered {
                            choice_id: (*choice).into(),
                            note: None,
                        },
                    )
                })
                .collect(),
        ),
    }
}

#[test]
fn duplicate_and_conflicting_submission_and_answers_are_atomic() {
    let (mut conn, vault) = fixture();
    let (task, created) = store::create(&mut conn, &vault, "caller", submission(), 100).unwrap();
    assert!(created);
    let (duplicate, created) =
        store::create(&mut conn, &vault, "caller", submission(), 110).unwrap();
    assert!(!created);
    assert_eq!(task.id, duplicate.id);
    assert_eq!(duplicate.deadline, 160);
    let (_, legacy_digests) = store::idempotency_digests(&task.request, &vault).unwrap();
    let prior_candidate_digest = legacy_digests.first().expect("legacy format is recognized");
    conn.execute(
        "UPDATE decision_tasks SET digest=?1 WHERE id=?2",
        rusqlite::params![prior_candidate_digest, task.id],
    )
    .unwrap();
    let mut canonical_retry = submission();
    let canonical_question = super::question(&canonical_retry, "choice").unwrap();
    canonical_retry.model = Some("human:owner".into());
    canonical_retry.state = canonical_retry.context.take();
    canonical_retry.question = None;
    canonical_retry.choices = None;
    canonical_retry.questions = Some(BTreeMap::from([("choice".into(), canonical_question)]));
    canonical_retry.question_order = Some(vec!["choice".into()]);
    let (cross_format_duplicate, created) =
        store::create(&mut conn, &vault, "caller", canonical_retry, 115).unwrap();
    assert!(
        !created,
        "legacy and canonical TypeSafe-compatible bodies share one idempotency identity"
    );
    assert_eq!(cross_format_duplicate.id, task.id);
    let mut changed = submission();
    changed.question = Some("Different".into());
    assert_eq!(
        store::create(&mut conn, &vault, "caller", changed, 110)
            .unwrap_err()
            .0,
        StatusCode::CONFLICT
    );
    assert_eq!(
        store::read(&conn, &vault, "other", &task.id, 110)
            .unwrap_err()
            .0,
        StatusCode::NOT_FOUND
    );
    let accepted = store::answer(&mut conn, &vault, &task.id, answer("yes"), 120).unwrap();
    assert_eq!(
        store::answer(&mut conn, &vault, &task.id, answer("yes"), 130)
            .unwrap()
            .updated_at,
        accepted.updated_at
    );
    assert_eq!(
        store::answer(&mut conn, &vault, &task.id, answer("no"), 130)
            .unwrap_err()
            .0,
        StatusCode::CONFLICT
    );
    assert_eq!(
        store::read(&conn, &vault, "caller", &task.id, 130)
            .unwrap()
            .observation,
        accepted.observation
    );
}

#[test]
fn decision_asset_links_are_owner_scoped_atomic_and_released_on_erase() {
    let (mut conn, vault) = fixture();
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64;
    insert_encrypted_asset(
        &conn,
        &vault,
        "asset-owned",
        "caller",
        b"fixture bytes",
        now + 300,
    );

    let mut body = submission();
    body.idempotency_key = "asset-link".into();
    body.context = Some(serde_json::json!({"_systorch":{"assets":["image_ref"]}}));
    body.assets = Some(BTreeMap::from([(
        "image_ref".into(),
        request_asset("asset-owned"),
    )]));
    let (task, created) = store::create(&mut conn, &vault, "caller", body, now).unwrap();
    assert!(created);
    assert_eq!(
        task.request.assets.as_ref().unwrap()["image_ref"]
            .asset_id
            .as_deref(),
        Some("asset-owned")
    );

    let linked: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM decision_task_assets WHERE task_id=?1 AND asset_id='asset-owned')",
        [&task.id],
        |row| row.get(0),
    ).unwrap();
    assert!(
        linked,
        "the encrypted task and asset ownership link commit together"
    );

    store::answer(&mut conn, &vault, &task.id, answer("yes"), now + 1).unwrap();
    store::erase(&mut conn, "caller", &task.id, now + 2).unwrap();
    let remains: bool = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM systorch_assets WHERE id='asset-owned')",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert!(
        !remains,
        "erasing the task releases an otherwise unused asset"
    );
}

#[test]
fn decision_asset_link_rejects_another_callers_asset_without_partial_task() {
    let (mut conn, vault) = fixture();
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64;
    insert_encrypted_asset(
        &conn,
        &vault,
        "asset-private",
        "caller-a",
        b"private",
        now + 300,
    );
    let mut body = submission();
    body.idempotency_key = "cross-owner-asset".into();
    body.context = Some(serde_json::json!({"_systorch":{"assets":["image_ref"]}}));
    body.assets = Some(BTreeMap::from([(
        "image_ref".into(),
        request_asset("asset-private"),
    )]));

    let error = store::create(&mut conn, &vault, "caller-b", body, now).unwrap_err();
    assert_eq!(error.0, StatusCode::NOT_FOUND);
    let count: i64 = conn
        .query_row("SELECT count(*) FROM decision_tasks", [], |row| row.get(0))
        .unwrap();
    let links: i64 = conn
        .query_row("SELECT count(*) FROM decision_task_assets", [], |row| {
            row.get(0)
        })
        .unwrap();
    assert_eq!(
        count, 0,
        "a rejected asset reference must roll back the task row"
    );
    assert_eq!(
        links, 0,
        "a rejected asset reference must not leave an orphan link"
    );
}

#[test]
fn asset_reference_validation_requires_an_exact_reference_not_a_substring() {
    let assets = BTreeMap::from([("image_ref".into(), request_asset("uploaded"))]);
    assert!(crate::assets::validate_asset_references(
        &serde_json::json!({"text":"mention image_ref in this sentence"}),
        &assets,
    )
    .is_err());
    assert!(crate::assets::validate_asset_references(
        &serde_json::json!({"media":["image_ref"]}),
        &assets,
    )
    .is_ok());
}

#[test]
fn exact_deadline_cancellation_retention_and_no_replay() {
    let (mut conn, vault) = fixture();
    let (task, _) = store::create(&mut conn, &vault, "caller", submission(), 100).unwrap();
    assert_eq!(
        store::answer(&mut conn, &vault, &task.id, answer("yes"), 160)
            .unwrap_err()
            .0,
        StatusCode::CONFLICT
    );
    assert_eq!(
        store::read(&conn, &vault, "caller", &task.id, 160)
            .unwrap()
            .status,
        "expired"
    );
    assert_eq!(
        store::read(&conn, &vault, "caller", &task.id, 160 + RETENTION)
            .unwrap_err()
            .0,
        StatusCode::GONE
    );
    assert_eq!(
        store::create(&mut conn, &vault, "caller", submission(), 160 + RETENTION)
            .unwrap_err()
            .0,
        StatusCode::GONE
    );
    let mut second = submission();
    second.idempotency_key = "cancel".into();
    let (task, _) = store::create(&mut conn, &vault, "caller", second, 200).unwrap();
    assert_eq!(
        store::erase(&mut conn, "caller", &task.id, 201)
            .unwrap_err()
            .0,
        StatusCode::CONFLICT
    );
    store::cancel(&mut conn, &vault, "caller", &task.id, 201).unwrap();
    assert_eq!(
        store::answer(&mut conn, &vault, &task.id, answer("yes"), 202)
            .unwrap_err()
            .0,
        StatusCode::CONFLICT
    );
    store::erase(&mut conn, "caller", &task.id, 202).unwrap();
    assert_eq!(
        store::read(&conn, &vault, "caller", &task.id, 202)
            .unwrap_err()
            .0,
        StatusCode::GONE
    );
}

#[test]
fn ciphertext_binding_and_failed_commit_preserve_pending() {
    let (mut conn, vault) = fixture();
    let (task, _) = store::create(&mut conn, &vault, "caller", submission(), 100).unwrap();
    let sealed: Vec<u8> = conn
        .query_row(
            "SELECT payload FROM decision_tasks WHERE id=?1",
            [&task.id],
            |r| r.get(0),
        )
        .unwrap();
    assert!(!sealed
        .windows(b"fixture-only-secret".len())
        .any(|w| w == b"fixture-only-secret"));
    assert!(vault.open_payload("other-id", &sealed).is_err());
    let (_, other_key) = fixture();
    assert!(other_key.open_payload(&task.id, &sealed).is_err());
    conn.execute_batch("CREATE TRIGGER fail_answer BEFORE UPDATE OF payload ON decision_tasks WHEN NEW.status='completed' BEGIN SELECT RAISE(ABORT,'fixture disk error'); END;").unwrap();
    assert_eq!(
        store::answer(&mut conn, &vault, &task.id, answer("yes"), 120)
            .unwrap_err()
            .0,
        StatusCode::INTERNAL_SERVER_ERROR
    );
    assert_eq!(
        store::read(&conn, &vault, "caller", &task.id, 120)
            .unwrap()
            .status,
        "pending"
    );
    conn.execute_batch("DROP TRIGGER fail_answer;").unwrap();
    store::answer(&mut conn, &vault, &task.id, answer("yes"), 121).unwrap();
}

#[test]
fn revised_facts_reject_late_answer_and_preserve_original_evidence() {
    let (mut conn, vault) = fixture();
    let (task, _) = store::create(&mut conn, &vault, "caller", submission(), 100).unwrap();
    store::edit(&mut conn, &vault, "caller", &task.id, 1, 110, |t| {
        t.previous_requests.push(t.request.clone());
        t.request.question = Some("Updated question".into());
        t.revision += 1;
        Ok(())
    })
    .unwrap();
    assert_eq!(
        store::answer(&mut conn, &vault, &task.id, answer("yes"), 120)
            .unwrap_err()
            .1,
        "revision_conflict"
    );
    let latest = store::read(&conn, &vault, "caller", &task.id, 120).unwrap();
    assert_eq!(latest.revision, 2);
    assert_eq!(
        latest.previous_requests[0].question.as_deref(),
        Some("Take a break?")
    );
    assert_eq!(latest.deadline, 160);
}

#[test]
fn full_queue_rejects_before_acceptance_without_evicting_pending() {
    let (mut conn, vault) = fixture();
    let (task, _) = store::create(&mut conn, &vault, "caller", submission(), 100).unwrap();
    conn.execute_batch("WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<9999) INSERT INTO decision_tasks(id,caller,entry,idempotency_key,digest,status,revision,created_at,deadline,updated_at,payload) SELECT 'tombstone-'||x,'fixture','human:owner','key-'||x,'digest','cancelled',1,100,160,100,x'' FROM n;").unwrap();
    let mut next = submission();
    next.idempotency_key = "new".into();
    assert_eq!(
        store::create(&mut conn, &vault, "caller", next, 110)
            .unwrap_err()
            .0,
        StatusCode::TOO_MANY_REQUESTS
    );
    assert_eq!(
        store::read(&conn, &vault, "caller", &task.id, 110)
            .unwrap()
            .status,
        "pending"
    );
    assert_eq!(
        conn.query_row("SELECT count(*) FROM decision_tasks", [], |r| r
            .get::<_, i64>(0))
            .unwrap(),
        10000
    );
}

#[test]
fn durable_multi_question_task_accepts_partial_idempotent_and_atomic_answer_batches() {
    let (mut conn, vault) = fixture();
    let (task, created) =
        store::create(&mut conn, &vault, "caller", multi_submission(), 100).unwrap();
    assert!(created);
    assert_eq!(task.request.question.as_deref(), Some("Which first step?"));

    let invalid = answer_batch(&[("question-a", "review"), ("missing", "fix")]);
    assert_eq!(
        store::answer(&mut conn, &vault, &task.id, invalid, 110)
            .unwrap_err()
            .1,
        "unknown_question"
    );
    assert!(store::read(&conn, &vault, "caller", &task.id, 110)
        .unwrap()
        .observations
        .is_empty());

    let first = store::answer(
        &mut conn,
        &vault,
        &task.id,
        answer_batch(&[("question-a", "review")]),
        120,
    )
    .unwrap();
    assert_eq!(first.status, "pending");
    assert_eq!(first.observations.len(), 1);
    assert_eq!(first.observation, None);
    let replay = store::answer(
        &mut conn,
        &vault,
        &task.id,
        answer_batch(&[("question-a", "review")]),
        130,
    )
    .unwrap();
    assert_eq!(replay.updated_at, first.updated_at);
    assert_eq!(
        store::answer(
            &mut conn,
            &vault,
            &task.id,
            answer_batch(&[("question-a", "test")]),
            131
        )
        .unwrap_err()
        .1,
        "answer_conflict"
    );

    let completed = store::answer(
        &mut conn,
        &vault,
        &task.id,
        answer_batch(&[("question-b", "monitor")]),
        140,
    )
    .unwrap();
    assert_eq!(completed.status, "completed");
    assert_eq!(completed.observations.len(), 2);
    let restored = store::read(&conn, &vault, "caller", &task.id, 141).unwrap();
    assert_eq!(
        restored.observations["question-a"],
        Observation::Answered {
            choice_id: "review".into(),
            note: None
        }
    );
    assert_eq!(
        restored.observations["question-b"],
        Observation::Answered {
            choice_id: "monitor".into(),
            note: None
        }
    );
    let projected = super::project_decision_result(&restored).unwrap();
    assert_eq!(projected.answers.len(), 2);
    assert!(
        matches!(projected.answers["question-a"], jev_protocol::Answer::Choice { ref choice, .. } if choice == "review")
    );
    assert!(
        matches!(projected.answers["question-b"], jev_protocol::Answer::Choice { ref choice, .. } if choice == "monitor")
    );
}

#[test]
fn multi_question_submission_requires_a_consistent_order_and_legacy_mirror() {
    let mut request = multi_submission();
    let wire = serde_json::to_value(&request).unwrap();
    let decoded: Submission = serde_json::from_value(wire).unwrap();
    store::validate(&decoded).unwrap();
    request.question_order = Some(vec!["question-b".into(), "question-a".into()]);
    assert_eq!(
        store::validate(&request).unwrap_err().1,
        "legacy_question_mirror_mismatch"
    );
    request.question_order = Some(vec!["question-a".into(), "question-a".into()]);
    assert_eq!(
        store::validate(&request).unwrap_err().1,
        "invalid_question_order"
    );
}

#[test]
fn durable_multitype_answers_are_type_checked_and_projected_without_guessing() {
    let (mut conn, vault) = fixture();
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64;
    let route = Question::Choice {
        instructions: Instructions::Text("Which route?".into()),
        criteria: Criteria::Map(
            [
                ("local".into(), CriterionValue::Text("Use local".into())),
                ("cloud".into(), CriterionValue::Text("Use cloud".into())),
            ]
            .into(),
        ),
    };
    let noul = Question::Noul {
        instructions: Instructions::Text("Is the local option ready?".into()),
        criteria: Some(Criteria::Bool {
            r#true: CriterionValue::Text("Ready".into()),
            r#false: CriterionValue::Text("Not ready".into()),
        }),
    };
    let score = Question::Score {
        instructions: Instructions::Text("How severe is the issue?".into()),
        criteria: Criteria::List(vec![
            CriterionValue::Text("Cosmetic".into()),
            CriterionValue::Text("Workaround exists".into()),
            CriterionValue::Text("Blocking".into()),
        ]),
    };
    let box_question = Question::Box {
        instructions: Instructions::Object(
            [
                (
                    "text".into(),
                    serde_json::json!("Mark the relevant region."),
                ),
                (
                    "_systorch".into(),
                    serde_json::json!({"assets":["box_image"]}),
                ),
            ]
            .into(),
        ),
    };
    let questions = BTreeMap::from([
        ("route".into(), route),
        ("ready".into(), noul),
        ("severity".into(), score),
        ("region".into(), box_question),
    ]);
    insert_encrypted_asset(
        &conn,
        &vault,
        "box-image",
        "caller",
        b"synthetic image bytes",
        now + RETENTION + 3600,
    );
    let request = Submission {
        model: Some("human:owner".into()),
        state: Some(serde_json::json!({"fixture":"synthetic"})),
        entry: "human:owner".into(),
        idempotency_key: "all-question-types".into(),
        question: None,
        context: None,
        choices: None,
        questions: Some(questions),
        question_order: Some(vec![
            "route".into(),
            "ready".into(),
            "severity".into(),
            "region".into(),
        ]),
        assets: Some(BTreeMap::from([(
            "box_image".into(),
            request_asset("box-image"),
        )])),
        extensions: Some(BTreeMap::from([(
            "systorch_media_mode".into(),
            serde_json::json!({"preserve":true}),
        )])),
        ttl_seconds: 60,
    };
    let mut box_without_image = request.clone();
    box_without_image.assets = None;
    assert_eq!(
        store::validate(&box_without_image).unwrap_err().1,
        "box_requires_image"
    );
    let projection = request.jev_projection().unwrap();
    assert_eq!(projection.model, "human:owner");
    assert_eq!(projection.state, serde_json::json!({"fixture":"synthetic"}));
    assert_eq!(projection.questions.len(), 4);
    assert_eq!(
        projection.extensions.as_ref().unwrap()["systorch_media_mode"],
        serde_json::json!({"preserve":true})
    );
    let projected_wire = serde_json::to_value(projection).unwrap();
    for systorch_field in ["entry", "idempotency_key", "question_order", "ttl_seconds"] {
        assert!(
            projected_wire.get(systorch_field).is_none(),
            "SysTorch lifecycle field leaked into TypeSafe projection: {systorch_field}"
        );
    }
    let (task, created) = store::create(&mut conn, &vault, "caller", request, now).unwrap();
    assert!(created);
    let mut observations = BTreeMap::new();
    observations.insert(
        "route".into(),
        Observation::Answered {
            choice_id: "cloud".into(),
            note: None,
        },
    );
    observations.insert(
        "ready".into(),
        Observation::Noul {
            value: true,
            note: None,
        },
    );
    observations.insert(
        "severity".into(),
        Observation::Score {
            level_index: 2,
            note: None,
        },
    );
    observations.insert(
        "region".into(),
        Observation::Box {
            top: 0.1,
            bottom: 0.8,
            left: 0.2,
            right: 0.9,
            note: None,
        },
    );
    let answer_body = AnswerSubmission {
        revision: 1,
        question_id: None,
        observation: None,
        observations: Some(observations),
    };

    let mut mismatched = answer_body.clone();
    mismatched.observations.as_mut().unwrap().insert(
        "ready".into(),
        Observation::Score {
            level_index: 1,
            note: None,
        },
    );
    assert_eq!(
        store::answer(&mut conn, &vault, &task.id, mismatched, now + 10)
            .unwrap_err()
            .1,
        "answer_type_mismatch"
    );
    assert!(store::read(&conn, &vault, "caller", &task.id, now + 10)
        .unwrap()
        .observations
        .is_empty());

    let mut invalid_box = answer_body.clone();
    invalid_box.observations.as_mut().unwrap().insert(
        "region".into(),
        Observation::Box {
            top: 0.8,
            bottom: 0.2,
            left: 0.2,
            right: 0.9,
            note: None,
        },
    );
    assert_eq!(
        store::answer(&mut conn, &vault, &task.id, invalid_box, now + 10)
            .unwrap_err()
            .1,
        "invalid_box_coordinates"
    );

    let completed = store::answer(&mut conn, &vault, &task.id, answer_body, now + 20).unwrap();
    assert_eq!(completed.status, "completed");
    let projected = super::project_decision_result(&completed).unwrap();
    assert!(
        matches!(projected.answers["route"], jev_protocol::Answer::Choice { ref choice, .. } if choice == "cloud")
    );
    assert!(
        matches!(projected.answers["ready"], jev_protocol::Answer::Noul(ref answer) if answer.noul == Some(1.0))
    );
    assert!(
        matches!(projected.answers["severity"], jev_protocol::Answer::Score { score, ref legend, ref probabilities, confidence } if score == 2.0 && legend.as_ref() == Some(&serde_json::json!({"0":"Cosmetic","1":"Workaround exists","2":"Blocking"})) && probabilities.get("2") == Some(&1.0) && confidence == 1.0)
    );
    assert!(
        matches!(projected.answers["region"], jev_protocol::Answer::Box(ref answer) if answer.coordinates.top == 0.1 && answer.coordinates.bottom == 0.8 && answer.coordinates.left == 0.2 && answer.coordinates.right == 0.9)
    );
}

#[test]
fn canonical_request_preserves_explicit_null_state_in_typesafe_projection() {
    let request: Submission = serde_json::from_value(serde_json::json!({
        "model":"human:owner",
        "state":null,
        "entry":"human:owner",
        "idempotency_key":"null-state",
        "ttl_seconds":60,
        "questions":{"ready":{"type":"noul","instructions":"Is this ready?"}}
    }))
    .unwrap();
    store::validate(&request).unwrap();
    let projected = request.jev_projection().unwrap();
    assert_eq!(projected.state, Value::Null);
    assert_eq!(projected.model, "human:owner");
}

#[test]
fn pre_multi_question_task_and_answer_json_remain_readable() {
    let legacy = serde_json::json!({
        "id": "choice_legacy",
        "caller": "caller",
        "assignee": "local-owner",
        "revision": 1,
        "status": "pending",
        "created_at": 100,
        "deadline": 160,
        "updated_at": 100,
        "request": {
            "entry": "human:owner",
            "idempotency_key": "legacy-key",
            "question": "Take a break?",
            "context": null,
            "choices": [{"id":"yes","label":"Break"},{"id":"no","label":"Continue"}],
            "ttl_seconds": 60
        },
        "observation": null,
        "projection_policy": "human-choice-one-hot/v1",
        "previous_requests": [],
        "clarifications": []
    });
    let task: Task = serde_json::from_value(legacy).unwrap();
    assert!(task.request.questions.is_none());
    assert!(task.request.question_order.is_none());
    assert!(task.observations.is_empty());
    assert_eq!(super::ordered_question_ids(&task.request), vec!["choice"]);

    let old_answer: AnswerSubmission = serde_json::from_value(serde_json::json!({
        "revision": 1,
        "observation": {"kind":"answered","choice_id":"yes"}
    }))
    .unwrap();
    assert_eq!(old_answer.question_id, None);
    assert!(old_answer.observations.is_none());
    assert_eq!(
        old_answer.observation,
        Some(Observation::Answered {
            choice_id: "yes".into(),
            note: None
        })
    );

    let multi_answer: AnswerSubmission = serde_json::from_value(serde_json::json!({
        "revision": 1,
        "observations": {
            "question-a": {"kind":"answered","choice_id":"review"},
            "question-b": {"kind":"answered","choice_id":"fix"}
        }
    }))
    .unwrap();
    assert_eq!(multi_answer.observations.unwrap().len(), 2);
}
