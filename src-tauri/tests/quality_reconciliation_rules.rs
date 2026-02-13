mod common;

use common::{cleanup_fixture, connect_test_db, create_fixture, insert_message};
use coreagent_lib::feedback_service::{FeedbackService, SubmitFeedbackRequest};
use sea_orm::{ConnectionTrait, DbBackend, Statement};
use std::collections::HashMap;
use uuid::Uuid;

async fn read_reconciliation(
    db: &sea_orm::DatabaseConnection,
    message_id: Uuid,
) -> Result<(String, f64, f64, f64, f64), String> {
    let row = db
        .query_one(Statement::from_sql_and_values(
            DbBackend::Postgres,
            r#"
                SELECT
                    provenance,
                    effective_tone_score,
                    effective_verbosity_score,
                    effective_helpfulness_score,
                    effective_accuracy_score
                FROM message_quality_reconciliation
                WHERE message_id = $1::uuid
                LIMIT 1
            "#,
            vec![message_id.into()],
        ))
        .await
        .map_err(|e| format!("Failed querying reconciliation row: {e}"))?
        .ok_or_else(|| "Missing reconciliation row".to_string())?;

    let provenance = row
        .try_get::<String>("", "provenance")
        .map_err(|e| format!("Failed decoding provenance: {e}"))?;
    let tone = row
        .try_get::<f64>("", "effective_tone_score")
        .map_err(|e| format!("Failed decoding tone score: {e}"))?;
    let verbosity = row
        .try_get::<f64>("", "effective_verbosity_score")
        .map_err(|e| format!("Failed decoding verbosity score: {e}"))?;
    let helpfulness = row
        .try_get::<f64>("", "effective_helpfulness_score")
        .map_err(|e| format!("Failed decoding helpfulness score: {e}"))?;
    let accuracy = row
        .try_get::<f64>("", "effective_accuracy_score")
        .map_err(|e| format!("Failed decoding accuracy score: {e}"))?;

    Ok((provenance, tone, verbosity, helpfulness, accuracy))
}

#[tokio::test]
async fn reconciliation_policy_scenarios_cover_provenance_modes() -> Result<(), String> {
    let Some(db) = connect_test_db().await else {
        return Ok(());
    };
    let fixture = create_fixture(&db, "quality-reconciliation").await?;

    // 1) agent-only label with no user ratings
    let agent_only_message = Uuid::new_v4();
    insert_message(
        &db,
        agent_only_message,
        fixture.conversation_id,
        "assistant",
        "Agent-only quality scenario.",
        Some(fixture.user_message_id),
    )
    .await?;
    FeedbackService::score_assistant_message_quality(&db, agent_only_message).await?;

    // 2) weighted blend with label + user ratings
    let weighted_message = Uuid::new_v4();
    insert_message(
        &db,
        weighted_message,
        fixture.conversation_id,
        "assistant",
        "Weighted blend quality scenario.",
        Some(fixture.user_message_id),
    )
    .await?;
    let mut weighted_dimensions = HashMap::new();
    weighted_dimensions.insert("tone".to_string(), "down".to_string());
    weighted_dimensions.insert("accuracy".to_string(), "up".to_string());
    FeedbackService::submit_feedback(
        &db,
        SubmitFeedbackRequest {
            message_id: weighted_message.to_string(),
            user_id: fixture.user_id.to_string(),
            feedback_type: "negative".to_string(),
            feedback_category: Some("tone".to_string()),
            notes: Some("blend".to_string()),
            dimension_ratings: Some(weighted_dimensions),
        },
    )
    .await?;

    // 3) user-only override: user message has ratings, no assistant label.
    let user_override_message = Uuid::new_v4();
    insert_message(
        &db,
        user_override_message,
        fixture.conversation_id,
        "user",
        "User-only signal scenario.",
        Some(fixture.assistant_message_id),
    )
    .await?;
    let mut user_only_dimensions = HashMap::new();
    user_only_dimensions.insert("verbosity".to_string(), "up".to_string());
    FeedbackService::submit_feedback(
        &db,
        SubmitFeedbackRequest {
            message_id: user_override_message.to_string(),
            user_id: fixture.user_id.to_string(),
            feedback_type: "neutral".to_string(),
            feedback_category: None,
            notes: Some("user override".to_string()),
            dimension_ratings: Some(user_only_dimensions),
        },
    )
    .await?;

    // 4) fallback case: no quality labels and no dimension ratings.
    let fallback_message = Uuid::new_v4();
    insert_message(
        &db,
        fallback_message,
        fixture.conversation_id,
        "user",
        "Fallback scenario without labels or dimensions.",
        Some(user_override_message),
    )
    .await?;
    FeedbackService::submit_feedback(
        &db,
        SubmitFeedbackRequest {
            message_id: fallback_message.to_string(),
            user_id: fixture.user_id.to_string(),
            feedback_type: "neutral".to_string(),
            feedback_category: None,
            notes: Some("fallback".to_string()),
            dimension_ratings: None,
        },
    )
    .await?;

    let (agent_only_provenance, a_tone, a_verbosity, a_helpfulness, a_accuracy) =
        read_reconciliation(&db, agent_only_message).await?;
    assert_eq!(agent_only_provenance, "agent_only");

    let (weighted_provenance, w_tone, w_verbosity, w_helpfulness, w_accuracy) =
        read_reconciliation(&db, weighted_message).await?;
    assert_eq!(weighted_provenance, "weighted_blend");

    let (user_override_provenance, u_tone, u_verbosity, u_helpfulness, u_accuracy) =
        read_reconciliation(&db, user_override_message).await?;
    assert_eq!(user_override_provenance, "user_override");

    let (fallback_provenance, f_tone, f_verbosity, f_helpfulness, f_accuracy) =
        read_reconciliation(&db, fallback_message).await?;
    assert_eq!(fallback_provenance, "heuristic_fallback");

    for value in [
        a_tone,
        a_verbosity,
        a_helpfulness,
        a_accuracy,
        w_tone,
        w_verbosity,
        w_helpfulness,
        w_accuracy,
        u_tone,
        u_verbosity,
        u_helpfulness,
        u_accuracy,
        f_tone,
        f_verbosity,
        f_helpfulness,
        f_accuracy,
    ] {
        assert!(
            (0.0..=1.0).contains(&value),
            "reconciliation score out of range: {value}"
        );
    }

    cleanup_fixture(&db, &fixture).await;
    Ok(())
}
