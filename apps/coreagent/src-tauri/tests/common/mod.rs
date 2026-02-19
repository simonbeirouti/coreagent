use chrono::Utc;
use sea_orm::{
    ConnectOptions, ConnectionTrait, Database, DatabaseConnection, DbBackend, Statement,
};
use std::{env, time::Duration};
use uuid::Uuid;

#[allow(dead_code)]
#[derive(Debug, Clone)]
pub struct TestFixture {
    pub run_id: String,
    pub user_id: Uuid,
    pub agent_id: Uuid,
    pub conversation_id: Uuid,
    pub user_message_id: Uuid,
    pub assistant_message_id: Uuid,
}

pub async fn connect_test_db() -> Option<DatabaseConnection> {
    dotenv::dotenv().ok();
    let database_url = match env::var("DATABASE_URL") {
        Ok(value) => value,
        Err(_) => {
            eprintln!("[tests] DATABASE_URL not set, skipping integration test.");
            return None;
        }
    };

    let mut options = ConnectOptions::new(database_url);
    options
        .max_connections(2)
        .min_connections(1)
        .connect_timeout(Duration::from_secs(8))
        .acquire_timeout(Duration::from_secs(8))
        .idle_timeout(Duration::from_secs(8))
        .max_lifetime(Duration::from_secs(120))
        .sqlx_logging(false)
        .map_sqlx_postgres_opts(|pg_opts| pg_opts.statement_cache_capacity(0));

    match Database::connect(options).await {
        Ok(db) => Some(db),
        Err(err) => {
            eprintln!("[tests] Failed to connect to database: {err}");
            None
        }
    }
}

pub async fn create_fixture(
    db: &DatabaseConnection,
    test_name: &str,
) -> Result<TestFixture, String> {
    let run_id = format!("{}-{}", test_name, Uuid::new_v4());
    let now = Utc::now();

    let user_id_row = db
        .query_one(Statement::from_string(
            DbBackend::Postgres,
            r#"
                SELECT user_id
                FROM agents
                ORDER BY created_at DESC
                LIMIT 1
            "#
            .to_string(),
        ))
        .await
        .map_err(|e| format!("Failed querying existing user_id for fixture: {e}"))?
        .ok_or_else(|| {
            "No existing agents found to source a valid user_id for tests".to_string()
        })?;
    let user_id: Uuid = user_id_row
        .try_get("", "user_id")
        .map_err(|e| format!("Failed decoding fixture user_id: {e}"))?;

    let agent_id = Uuid::new_v4();
    let conversation_id = Uuid::new_v4();
    let user_message_id = Uuid::new_v4();
    let assistant_message_id = Uuid::new_v4();

    db.execute(Statement::from_sql_and_values(
        DbBackend::Postgres,
        r#"
            INSERT INTO agents (
                id, user_id, name, persona, provider_type, model_id, state, created_at, updated_at
            )
            VALUES (
                $1::uuid, $2::uuid, $3::text, $4::text, 'openai', 'gpt-4o-mini', 'active', $5::timestamptz, $5::timestamptz
            )
        "#,
        vec![
            agent_id.into(),
            user_id.into(),
            format!("test-agent-{run_id}").into(),
            "test persona".to_string().into(),
            now.into(),
        ],
    ))
    .await
    .map_err(|e| format!("Failed inserting test agent: {e}"))?;

    db.execute(Statement::from_sql_and_values(
        DbBackend::Postgres,
        r#"
            INSERT INTO conversations (
                id, agent_id, user_id, title, created_at, updated_at
            )
            VALUES (
                $1::uuid, $2::uuid, $3::uuid, $4::text, $5::timestamptz, $5::timestamptz
            )
        "#,
        vec![
            conversation_id.into(),
            agent_id.into(),
            user_id.into(),
            format!("test-conversation-{run_id}").into(),
            now.into(),
        ],
    ))
    .await
    .map_err(|e| format!("Failed inserting test conversation: {e}"))?;

    insert_message(
        db,
        user_message_id,
        conversation_id,
        "user",
        "Can you summarize this test scenario?",
        None,
    )
    .await?;

    insert_message(
        db,
        assistant_message_id,
        conversation_id,
        "assistant",
        "Sure, here is a concise summary for the reliability test.",
        Some(user_message_id),
    )
    .await?;

    Ok(TestFixture {
        run_id,
        user_id,
        agent_id,
        conversation_id,
        user_message_id,
        assistant_message_id,
    })
}

pub async fn insert_message(
    db: &DatabaseConnection,
    message_id: Uuid,
    conversation_id: Uuid,
    role: &str,
    content: &str,
    parent_id: Option<Uuid>,
) -> Result<(), String> {
    db.execute(Statement::from_sql_and_values(
        DbBackend::Postgres,
        r#"
            INSERT INTO messages (
                id, conversation_id, role, content, message_type, metadata, created_at, parent_id
            )
            VALUES (
                $1::uuid, $2::uuid, $3::text, $4::text, 'text', '{}'::jsonb, NOW(), $5::uuid
            )
        "#,
        vec![
            message_id.into(),
            conversation_id.into(),
            role.to_string().into(),
            content.to_string().into(),
            parent_id.into(),
        ],
    ))
    .await
    .map_err(|e| format!("Failed inserting message fixture: {e}"))?;
    Ok(())
}

pub async fn cleanup_fixture(db: &DatabaseConnection, fixture: &TestFixture) {
    let cleanup_statements = [
        ("DELETE FROM retrieval_tuning_events WHERE agent_id = $1::uuid", vec![fixture.agent_id.into()]),
        ("DELETE FROM retrieval_tuning_state WHERE agent_id = $1::uuid", vec![fixture.agent_id.into()]),
        ("DELETE FROM memory_retrieval_judgments WHERE event_id IN (SELECT id FROM memory_retrieval_events WHERE agent_id = $1::uuid)", vec![fixture.agent_id.into()]),
        ("DELETE FROM memory_retrieval_events WHERE agent_id = $1::uuid", vec![fixture.agent_id.into()]),
        ("DELETE FROM adaptation_cycles WHERE agent_id = $1::uuid", vec![fixture.agent_id.into()]),
        ("DELETE FROM personality_adjustments WHERE agent_id = $1::uuid", vec![fixture.agent_id.into()]),
        ("DELETE FROM trait_state WHERE agent_id = $1::uuid", vec![fixture.agent_id.into()]),
        ("DELETE FROM message_quality_reconciliation WHERE agent_id = $1::uuid", vec![fixture.agent_id.into()]),
        ("DELETE FROM message_quality_user_ratings WHERE agent_id = $1::uuid", vec![fixture.agent_id.into()]),
        ("DELETE FROM message_quality_labels WHERE agent_id = $1::uuid", vec![fixture.agent_id.into()]),
        ("DELETE FROM message_feedback WHERE message_id IN (SELECT id FROM messages WHERE conversation_id = $1::uuid)", vec![fixture.conversation_id.into()]),
        ("DELETE FROM message_embeddings WHERE message_id IN (SELECT id FROM messages WHERE conversation_id = $1::uuid)", vec![fixture.conversation_id.into()]),
        ("DELETE FROM messages WHERE conversation_id = $1::uuid", vec![fixture.conversation_id.into()]),
        ("DELETE FROM conversations WHERE id = $1::uuid", vec![fixture.conversation_id.into()]),
        ("DELETE FROM agent_abilities WHERE agent_id = $1::uuid", vec![fixture.agent_id.into()]),
        ("DELETE FROM agents WHERE id = $1::uuid", vec![fixture.agent_id.into()]),
    ];

    for (sql, values) in cleanup_statements {
        if let Err(err) = db
            .execute(Statement::from_sql_and_values(
                DbBackend::Postgres,
                sql,
                values,
            ))
            .await
        {
            eprintln!("[tests] Cleanup warning ({}): {}", fixture.run_id, err);
        }
    }
}
