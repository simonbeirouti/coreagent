mod common;

use common::{cleanup_fixture, connect_test_db, create_fixture, insert_message};
use coreagent_lib::memory_service::MemoryService;
use sea_orm::{ConnectionTrait, DbBackend, Statement};
use uuid::Uuid;

#[tokio::test]
async fn retrieval_status_exposes_source_mix_confidence_and_guardrail_reasons() -> Result<(), String>
{
    let Some(db) = connect_test_db().await else {
        return Ok(());
    };
    let fixture = create_fixture(&db, "retrieval-provenance").await?;

    let mut message_ids = vec![fixture.assistant_message_id];
    for idx in 0..4 {
        let message_id = Uuid::new_v4();
        insert_message(
            &db,
            message_id,
            fixture.conversation_id,
            "assistant",
            &format!("retrieval provenance fixture message {idx}"),
            Some(fixture.user_message_id),
        )
        .await?;
        message_ids.push(message_id);
    }

    let provenances = [
        "user_override",
        "weighted_blend",
        "agent_only",
        "heuristic_fallback",
        "user_override",
    ];
    for (message_id, provenance) in message_ids.iter().zip(provenances.iter()) {
        db.execute(Statement::from_sql_and_values(
            DbBackend::Postgres,
            r#"
                INSERT INTO message_quality_reconciliation (
                    id, message_id, agent_id, effective_tone_score, effective_verbosity_score,
                    effective_helpfulness_score, effective_accuracy_score, source_mix, provenance, created_at, updated_at
                )
                VALUES (
                    gen_random_uuid(), $1::uuid, $2::uuid, 0.62, 0.58, 0.66, 0.61, '{}'::jsonb, $3::text, NOW(), NOW()
                )
                ON CONFLICT (message_id) DO UPDATE SET
                    provenance = EXCLUDED.provenance,
                    updated_at = NOW()
            "#,
            vec![(*message_id).into(), fixture.agent_id.into(), (*provenance).to_string().into()],
        ))
        .await
        .map_err(|e| format!("Failed inserting reconciliation fixture row: {e}"))?;
    }

    let confidences = [0.95_f64, 0.80_f64, 0.40_f64, 0.71_f64, 0.20_f64];
    for (message_id, confidence) in message_ids.iter().zip(confidences.iter()) {
        db.execute(Statement::from_sql_and_values(
            DbBackend::Postgres,
            r#"
                INSERT INTO message_quality_labels (
                    id, message_id, agent_id, tone_score, verbosity_score, helpfulness_score, accuracy_score,
                    confidence, orchestrator_version, status, rationale, created_at, updated_at
                )
                VALUES (
                    gen_random_uuid(), $1::uuid, $2::uuid, 0.6, 0.6, 0.6, 0.6,
                    $3::float, 'test_v1', 'scored', '{}'::jsonb, NOW(), NOW()
                )
                ON CONFLICT (message_id) DO UPDATE SET
                    confidence = EXCLUDED.confidence,
                    status = EXCLUDED.status,
                    updated_at = NOW()
            "#,
            vec![(*message_id).into(), fixture.agent_id.into(), (*confidence).into()],
        ))
        .await
        .map_err(|e| format!("Failed inserting quality label fixture row: {e}"))?;
    }

    db.execute(Statement::from_sql_and_values(
        DbBackend::Postgres,
        r#"
            INSERT INTO retrieval_tuning_state (
                agent_id, similarity_threshold, min_threshold, max_threshold, updated_at
            )
            VALUES ($1::uuid, 0.70, 0.55, 0.90, NOW())
            ON CONFLICT (agent_id) DO NOTHING
        "#,
        vec![fixture.agent_id.into()],
    ))
    .await
    .map_err(|e| format!("Failed inserting retrieval tuning state fixture row: {e}"))?;

    db.execute(Statement::from_sql_and_values(
        DbBackend::Postgres,
        r#"
            INSERT INTO retrieval_tuning_events (
                id, agent_id, previous_threshold, next_threshold, status, reason, quality_summary, guardrail_flags, created_at
            )
            VALUES
                (gen_random_uuid(), $1::uuid, 0.70, 0.68, 'applied', 'improve_recall', '{}'::jsonb, '{}'::jsonb, NOW() - interval '2 minute'),
                (gen_random_uuid(), $1::uuid, 0.68, 0.68, 'skipped', 'quality_guardrail_blocked', '{}'::jsonb, '{}'::jsonb, NOW() - interval '1 minute')
        "#,
        vec![fixture.agent_id.into()],
    ))
    .await
    .map_err(|e| format!("Failed inserting tuning event fixture rows: {e}"))?;

    let status = MemoryService::get_retrieval_tuning_status(&db, fixture.agent_id).await?;
    let source_mix = status.quality.source_mix;

    assert_eq!(
        source_mix
            .get("user_override_count")
            .and_then(|v| v.as_i64())
            .unwrap_or_default(),
        2
    );
    assert_eq!(
        source_mix
            .get("weighted_blend_count")
            .and_then(|v| v.as_i64())
            .unwrap_or_default(),
        1
    );
    assert_eq!(
        source_mix
            .get("agent_only_count")
            .and_then(|v| v.as_i64())
            .unwrap_or_default(),
        1
    );
    assert_eq!(
        source_mix
            .get("heuristic_fallback_count")
            .and_then(|v| v.as_i64())
            .unwrap_or_default(),
        1
    );

    assert!(
        status.quality.confidence_scored_sample_size >= 5,
        "expected confidence sample size >= 5"
    );
    assert!(
        status.quality.confidence_above_target_count >= 2,
        "expected at least two above-target confidence labels"
    );
    assert!(
        status.quality.confidence_above_target_ratio >= 0.0
            && status.quality.confidence_above_target_ratio <= 1.0
    );

    assert!(
        status
            .recent_decisions
            .iter()
            .any(|decision| decision.status == "applied" || decision.status == "skipped"),
        "expected tuning decisions in payload"
    );
    assert!(
        !status.quality.reasons.is_empty(),
        "expected guardrail reasons when quality checks fail sample requirements"
    );

    cleanup_fixture(&db, &fixture).await;
    Ok(())
}
