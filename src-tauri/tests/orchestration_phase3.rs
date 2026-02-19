mod common;

use chrono::Utc;
use common::{cleanup_fixture, connect_test_db, create_fixture};
use coreagent_lib::orchestration_service::{
    CreateAgentDelegationRequest, CreateOrchestrationRunRequest, CreateOrchestrationTaskRequest,
    OrchestrationService, RecordDelegationRequest, UpsertHeartbeatRequest,
    UpsertOrchestrationMemoryRequest,
};
use sea_orm::{ConnectionTrait, DbBackend, Statement};
use uuid::Uuid;

#[tokio::test]
async fn orchestration_phase3_lifecycle_policy_and_memory_flow() -> Result<(), String> {
    let Some(db) = connect_test_db().await else {
        return Ok(());
    };
    let fixture = create_fixture(&db, "orchestration-phase3").await?;

    let child_agent_id = Uuid::new_v4();
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
            child_agent_id.into(),
            fixture.user_id.into(),
            format!("child-agent-{}", fixture.run_id).into(),
            "child persona".to_string().into(),
            Utc::now().into(),
        ],
    ))
    .await
    .map_err(|e| format!("Failed inserting child agent fixture: {e}"))?;

    let delegation = OrchestrationService::create_agent_delegation(
        &db,
        CreateAgentDelegationRequest {
            parent_agent_id: fixture.agent_id.to_string(),
            child_agent_id: child_agent_id.to_string(),
            role: "researcher".to_string(),
            ownership_scope: Some("delegated".to_string()),
            created_by_user_id: fixture.user_id.to_string(),
        },
    )
    .await?;
    assert_eq!(delegation.child_agent_id, child_agent_id);

    let run = OrchestrationService::create_run(
        &db,
        CreateOrchestrationRunRequest {
            parent_agent_id: fixture.agent_id.to_string(),
            owner_user_id: fixture.user_id.to_string(),
            title: "Phase 3 run".to_string(),
            objective: "Exercise orchestration lifecycle".to_string(),
            priority: Some("normal".to_string()),
        },
    )
    .await?;

    let created_task = OrchestrationService::create_task(
        &db,
        CreateOrchestrationTaskRequest {
            run_id: run.id.to_string(),
            parent_task_id: None,
            owner_agent_id: child_agent_id.to_string(),
            title: "Collect evidence".to_string(),
            description: Some("Gather source material".to_string()),
            task_order: Some(0),
            idempotency_key: Some("collect-evidence".to_string()),
            max_retries: Some(3),
        },
    )
    .await?;

    let blocked_delegation = OrchestrationService::record_delegation(
        &db,
        RecordDelegationRequest {
            run_id: run.id.to_string(),
            task_id: created_task.id.to_string(),
            from_agent_id: fixture.agent_id.to_string(),
            to_agent_id: Uuid::new_v4().to_string(),
            policy_decision: "allowed".to_string(),
            policy_reason: None,
            required_role: Some("researcher".to_string()),
            action_category: Some("research".to_string()),
            required_ability_keys: Some(vec![]),
            handoff_payload: None,
        },
    )
    .await;
    assert!(blocked_delegation.is_err());
    assert!(blocked_delegation
        .err()
        .unwrap_or_default()
        .contains("DELEGATION_POLICY_BLOCKED"));

    let recorded_delegation = OrchestrationService::record_delegation(
        &db,
        RecordDelegationRequest {
            run_id: run.id.to_string(),
            task_id: created_task.id.to_string(),
            from_agent_id: fixture.agent_id.to_string(),
            to_agent_id: child_agent_id.to_string(),
            policy_decision: "allowed".to_string(),
            policy_reason: Some("role compatible".to_string()),
            required_role: Some("researcher".to_string()),
            action_category: Some("research".to_string()),
            required_ability_keys: Some(vec![]),
            handoff_payload: Some(serde_json::json!({"kind": "handoff"})),
        },
    )
    .await?;
    assert_eq!(recorded_delegation.policy_decision, "allowed");

    let _ = OrchestrationService::update_task_status(
        &db,
        created_task.id.to_string(),
        "planned".to_string(),
        None,
    )
    .await?;
    let _ = OrchestrationService::update_task_status(
        &db,
        created_task.id.to_string(),
        "in_progress".to_string(),
        None,
    )
    .await?;

    let _heartbeat = OrchestrationService::upsert_heartbeat(
        &db,
        UpsertHeartbeatRequest {
            run_id: run.id.to_string(),
            task_id: created_task.id.to_string(),
            agent_id: child_agent_id.to_string(),
            status: "running".to_string(),
            progress: 0.4,
            summary: Some("started".to_string()),
        },
    )
    .await?;

    let _ = OrchestrationService::update_task_status(
        &db,
        created_task.id.to_string(),
        "failed".to_string(),
        Some("provider_timeout".to_string()),
    )
    .await?;
    let retried_task = OrchestrationService::retry_task(
        &db,
        created_task.id.to_string(),
        fixture.agent_id.to_string(),
    )
    .await?;
    assert_eq!(retried_task.status, "waiting");
    assert!(retried_task.next_retry_at.is_some());

    let memory = OrchestrationService::upsert_memory(
        &db,
        UpsertOrchestrationMemoryRequest {
            run_id: run.id.to_string(),
            task_id: Some(created_task.id.to_string()),
            agent_id: child_agent_id.to_string(),
            scope: "shared_run".to_string(),
            key: "summary".to_string(),
            summary: Some("shared memory".to_string()),
            payload: Some(serde_json::json!({"summary": "shared memory"})),
        },
    )
    .await?;

    let visible_memories = OrchestrationService::list_memories(
        &db,
        run.id.to_string(),
        fixture.agent_id.to_string(),
        None,
    )
    .await?;
    assert!(visible_memories.iter().any(|item| item.id == memory.id));

    let promoted_memory = OrchestrationService::promote_memory_to_parent_visible(
        &db,
        memory.id.to_string(),
        fixture.agent_id.to_string(),
    )
    .await?;
    assert_eq!(promoted_memory.scope, "parent_visible");

    db.execute(Statement::from_sql_and_values(
        DbBackend::Postgres,
        r#"
            UPDATE orchestration_tasks
            SET status = 'in_progress', last_heartbeat_at = NOW() - INTERVAL '20 minutes'
            WHERE id = $1::uuid
        "#,
        vec![created_task.id.into()],
    ))
    .await
    .map_err(|e| format!("Failed forcing stale heartbeat for test: {e}"))?;

    let stale_tasks = OrchestrationService::list_stale_tasks(&db, run.id, 10).await?;
    assert!(stale_tasks
        .iter()
        .any(|item| item.task_id == created_task.id));

    let _ = OrchestrationService::update_run_status(
        &db,
        run.id.to_string(),
        "planned".to_string(),
        None,
    )
    .await?;
    let schedule = OrchestrationService::set_schedule(&db, run.id.to_string(), true, 1).await?;
    assert!(schedule.enabled);

    db.execute(Statement::from_sql_and_values(
        DbBackend::Postgres,
        r#"
            UPDATE orchestration_schedules
            SET next_run_at = NOW() - INTERVAL '1 minute'
            WHERE run_id = $1::uuid
        "#,
        vec![run.id.into()],
    ))
    .await
    .map_err(|e| format!("Failed forcing due schedule for test: {e}"))?;

    let processed = OrchestrationService::run_scheduler_tick(&db).await?;
    assert!(processed >= 1);

    let _ = db
        .execute(Statement::from_sql_and_values(
            DbBackend::Postgres,
            "DELETE FROM agents WHERE id = $1::uuid",
            vec![child_agent_id.into()],
        ))
        .await;
    cleanup_fixture(&db, &fixture).await;
    Ok(())
}
