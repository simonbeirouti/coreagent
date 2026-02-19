mod common;

use common::{cleanup_fixture, connect_test_db, create_fixture};
use sea_orm::{ConnectionTrait, DbBackend, Statement};

#[tokio::test]
async fn migration_and_policy_sanity_checks() -> Result<(), String> {
    let Some(db) = connect_test_db().await else {
        return Ok(());
    };
    let fixture = create_fixture(&db, "migration-policy").await?;

    let required_tables = [
        "message_feedback",
        "message_quality_labels",
        "message_quality_user_ratings",
        "message_quality_reconciliation",
        "trait_state",
        "adaptation_cycles",
        "personality_adjustments",
        "retrieval_tuning_state",
        "retrieval_tuning_events",
        "agent_delegations",
        "orchestration_runs",
        "orchestration_tasks",
        "orchestration_task_attempts",
        "orchestration_delegations",
        "orchestration_events",
        "orchestration_heartbeats",
        "orchestration_memories",
        "orchestration_schedules",
    ];

    for table in required_tables {
        let row = db
            .query_one(Statement::from_sql_and_values(
                DbBackend::Postgres,
                r#"
                    SELECT COUNT(*)::bigint AS n
                    FROM information_schema.tables
                    WHERE table_schema = 'public' AND table_name = $1::text
                "#,
                vec![table.to_string().into()],
            ))
            .await
            .map_err(|e| format!("Failed checking table existence ({table}): {e}"))?
            .ok_or_else(|| format!("Missing row while checking table existence ({table})"))?;
        let count = row
            .try_get::<i64>("", "n")
            .map_err(|e| format!("Failed decoding table existence count ({table}): {e}"))?;
        assert_eq!(count, 1, "required table not found: {table}");
    }

    let duplicate_insert = db
        .execute(Statement::from_sql_and_values(
            DbBackend::Postgres,
            r#"
                INSERT INTO message_quality_user_ratings (
                    id, message_id, agent_id, user_id, dimension, rating, created_at, updated_at
                )
                VALUES
                    (gen_random_uuid(), $1::uuid, $2::uuid, $3::uuid, 'tone', 'up', NOW(), NOW()),
                    (gen_random_uuid(), $1::uuid, $2::uuid, $3::uuid, 'tone', 'down', NOW(), NOW())
            "#,
            vec![
                fixture.assistant_message_id.into(),
                fixture.agent_id.into(),
                fixture.user_id.into(),
            ],
        ))
        .await;
    assert!(
        duplicate_insert.is_err(),
        "expected unique constraint violation on (message_id, user_id, dimension)"
    );

    let invalid_rating_insert = db
        .execute(Statement::from_sql_and_values(
            DbBackend::Postgres,
            r#"
                INSERT INTO message_quality_user_ratings (
                    id, message_id, agent_id, user_id, dimension, rating, created_at, updated_at
                )
                VALUES (gen_random_uuid(), $1::uuid, $2::uuid, $3::uuid, 'tone', 'invalid_rating', NOW(), NOW())
            "#,
            vec![
                fixture.assistant_message_id.into(),
                fixture.agent_id.into(),
                fixture.user_id.into(),
            ],
        ))
        .await;
    assert!(
        invalid_rating_insert.is_err(),
        "expected check/enum constraint on rating"
    );

    let invalid_score_insert = db
        .execute(Statement::from_sql_and_values(
            DbBackend::Postgres,
            r#"
                INSERT INTO message_quality_labels (
                    id, message_id, agent_id, tone_score, verbosity_score, helpfulness_score, accuracy_score,
                    confidence, orchestrator_version, status, rationale, created_at, updated_at
                )
                VALUES (
                    gen_random_uuid(), $1::uuid, $2::uuid, 1.5, 0.5, 0.5, 0.5,
                    0.7, 'test_v1', 'scored', '{}'::jsonb, NOW(), NOW()
                )
            "#,
            vec![fixture.user_message_id.into(), fixture.agent_id.into()],
        ))
        .await;
    assert!(
        invalid_score_insert.is_err(),
        "expected score bounds constraint on labels"
    );

    let policies_row = db
        .query_one(Statement::from_sql_and_values(
            DbBackend::Postgres,
            r#"
                SELECT COUNT(*)::bigint AS n
                FROM pg_policies
                WHERE schemaname = 'public'
                  AND tablename IN (
                    'message_feedback',
                    'message_quality_labels',
                    'message_quality_user_ratings',
                    'message_quality_reconciliation'
                  )
            "#,
            vec![],
        ))
        .await
        .map_err(|e| format!("Failed querying pg_policies: {e}"))?
        .ok_or_else(|| "Missing pg_policies count row".to_string())?;
    let _policy_count = policies_row
        .try_get::<i64>("", "n")
        .map_err(|e| format!("Failed decoding pg_policies count: {e}"))?;

    cleanup_fixture(&db, &fixture).await;
    Ok(())
}
