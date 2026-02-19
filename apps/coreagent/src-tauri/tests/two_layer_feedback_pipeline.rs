mod common;

use common::{cleanup_fixture, connect_test_db, create_fixture};
use coreagent_lib::feedback_service::{FeedbackService, SubmitFeedbackRequest};
use sea_orm::{ConnectionTrait, DbBackend, Statement};
use std::collections::HashMap;

#[tokio::test]
async fn feedback_write_read_reconcile_and_adaptation_cycle_smoke() -> Result<(), String> {
    let Some(db) = connect_test_db().await else {
        return Ok(());
    };

    let fixture = create_fixture(&db, "two-layer-pipeline").await?;

    let mut dimension_ratings = HashMap::new();
    dimension_ratings.insert("tone".to_string(), "up".to_string());
    dimension_ratings.insert("helpfulness".to_string(), "down".to_string());

    let request = SubmitFeedbackRequest {
        message_id: fixture.assistant_message_id.to_string(),
        user_id: fixture.user_id.to_string(),
        feedback_type: "positive".to_string(),
        feedback_category: Some("helpfulness".to_string()),
        notes: Some("test feedback pipeline".to_string()),
        dimension_ratings: Some(dimension_ratings),
    };

    FeedbackService::submit_feedback(&db, request).await?;

    let ratings_row = db
        .query_one(Statement::from_sql_and_values(
            DbBackend::Postgres,
            r#"
                SELECT COUNT(*)::bigint AS rating_count
                FROM message_quality_user_ratings
                WHERE message_id = $1::uuid
            "#,
            vec![fixture.assistant_message_id.into()],
        ))
        .await
        .map_err(|e| format!("Failed querying ratings count: {e}"))?
        .ok_or_else(|| "Missing ratings count row".to_string())?;
    let rating_count = ratings_row
        .try_get::<i64>("", "rating_count")
        .map_err(|e| format!("Failed decoding rating_count: {e}"))?;
    assert!(
        rating_count >= 2,
        "expected >=2 dimension ratings, got {rating_count}"
    );

    let reconciliation_row = db
        .query_one(Statement::from_sql_and_values(
            DbBackend::Postgres,
            r#"
                SELECT provenance, source_mix
                FROM message_quality_reconciliation
                WHERE message_id = $1::uuid
                LIMIT 1
            "#,
            vec![fixture.assistant_message_id.into()],
        ))
        .await
        .map_err(|e| format!("Failed querying reconciliation row: {e}"))?
        .ok_or_else(|| "Missing reconciliation row".to_string())?;

    let provenance = reconciliation_row
        .try_get::<String>("", "provenance")
        .map_err(|e| format!("Failed decoding provenance: {e}"))?;
    let source_mix: serde_json::Value = reconciliation_row
        .try_get("", "source_mix")
        .map_err(|e| format!("Failed decoding source_mix: {e}"))?;

    assert!(
        matches!(
            provenance.as_str(),
            "weighted_blend" | "agent_only" | "user_override" | "heuristic_fallback"
        ),
        "unexpected provenance value: {provenance}"
    );
    assert!(source_mix.is_object(), "source_mix should be JSON object");

    let dimensions = FeedbackService::get_conversation_dimension_feedback(
        &db,
        fixture.conversation_id.to_string(),
        fixture.user_id.to_string(),
    )
    .await?;
    let assistant_dimensions = dimensions
        .get(&fixture.assistant_message_id.to_string())
        .ok_or_else(|| {
            "missing assistant message dimensions in conversation payload".to_string()
        })?;
    assert!(assistant_dimensions.contains_key("tone"));

    let cycle = FeedbackService::run_adaptation_cycle(&db, fixture.agent_id).await?;
    let cycle = cycle.ok_or_else(|| "expected adaptation cycle result, got none".to_string())?;
    assert!(
        matches!(cycle.status.as_str(), "skipped" | "applied"),
        "unexpected adaptation status: {}",
        cycle.status
    );

    cleanup_fixture(&db, &fixture).await;
    Ok(())
}
