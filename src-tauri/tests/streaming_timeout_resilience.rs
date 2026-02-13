mod common;

use common::{cleanup_fixture, connect_test_db, create_fixture};
use coreagent_lib::feedback_service::{FeedbackService, SubmitFeedbackRequest};
use sea_orm::{ConnectionTrait, DbBackend, Statement};
use std::collections::HashMap;

#[tokio::test]
async fn failure_path_is_predictable_and_system_remains_writable() -> Result<(), String> {
    let Some(db) = connect_test_db().await else {
        return Ok(());
    };
    let fixture = create_fixture(&db, "failure-path-resilience").await?;

    let invalid_message_request = SubmitFeedbackRequest {
        message_id: "not-a-uuid".to_string(),
        user_id: fixture.user_id.to_string(),
        feedback_type: "positive".to_string(),
        feedback_category: Some("helpfulness".to_string()),
        notes: Some("invalid message id".to_string()),
        dimension_ratings: None,
    };
    let err = FeedbackService::submit_feedback(&db, invalid_message_request)
        .await
        .expect_err("invalid message id should fail");
    assert!(
        err.contains("Invalid message_id"),
        "expected predictable parse error, got: {err}"
    );

    let mut ratings = HashMap::new();
    ratings.insert("helpfulness".to_string(), "up".to_string());
    let valid_request = SubmitFeedbackRequest {
        message_id: fixture.assistant_message_id.to_string(),
        user_id: fixture.user_id.to_string(),
        feedback_type: "positive".to_string(),
        feedback_category: Some("helpfulness".to_string()),
        notes: Some("post-error write should work".to_string()),
        dimension_ratings: Some(ratings),
    };
    FeedbackService::submit_feedback(&db, valid_request).await?;

    let row = db
        .query_one(Statement::from_sql_and_values(
            DbBackend::Postgres,
            r#"
                SELECT COUNT(*)::bigint AS n
                FROM message_quality_reconciliation
                WHERE message_id = $1::uuid
            "#,
            vec![fixture.assistant_message_id.into()],
        ))
        .await
        .map_err(|e| format!("Failed querying reconciliation row count: {e}"))?
        .ok_or_else(|| "Missing reconciliation count row".to_string())?;
    let count = row
        .try_get::<i64>("", "n")
        .map_err(|e| format!("Failed decoding reconciliation count: {e}"))?;
    assert_eq!(count, 1, "expected reconciliation row to exist after recovery write");

    cleanup_fixture(&db, &fixture).await;
    Ok(())
}
