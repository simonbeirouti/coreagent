use sea_orm::{ConnectionTrait, DatabaseBackend, DatabaseConnection, Statement};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrchestrationRunData {
    pub id: Uuid,
    pub parent_agent_id: Uuid,
    pub owner_user_id: Uuid,
    pub title: String,
    pub objective: String,
    pub status: String,
    pub priority: String,
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
    pub last_error: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CreateOrchestrationRunRequest {
    pub parent_agent_id: String,
    pub owner_user_id: String,
    pub title: String,
    pub objective: String,
    pub priority: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrchestrationTaskData {
    pub id: Uuid,
    pub run_id: Uuid,
    pub parent_task_id: Option<Uuid>,
    pub owner_agent_id: Uuid,
    pub title: String,
    pub description: Option<String>,
    pub status: String,
    pub task_order: i32,
    pub idempotency_key: Option<String>,
    pub attempt_count: i32,
    pub max_retries: i32,
    pub next_retry_at: Option<String>,
    pub last_failure_reason: Option<String>,
    pub last_heartbeat_at: Option<String>,
    pub heartbeat_status: Option<String>,
    pub heartbeat_progress: f32,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CreateOrchestrationTaskRequest {
    pub run_id: String,
    pub parent_task_id: Option<String>,
    pub owner_agent_id: String,
    pub title: String,
    pub description: Option<String>,
    pub task_order: Option<i32>,
    pub idempotency_key: Option<String>,
    pub max_retries: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrchestrationDelegationData {
    pub id: Uuid,
    pub run_id: Uuid,
    pub task_id: Uuid,
    pub from_agent_id: Uuid,
    pub to_agent_id: Uuid,
    pub policy_decision: String,
    pub policy_reason: Option<String>,
    pub handoff_payload: serde_json::Value,
    pub created_at: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct RecordDelegationRequest {
    pub run_id: String,
    pub task_id: String,
    pub from_agent_id: String,
    pub to_agent_id: String,
    pub policy_decision: String,
    pub policy_reason: Option<String>,
    pub required_role: Option<String>,
    pub action_category: Option<String>,
    pub required_ability_keys: Option<Vec<String>>,
    pub handoff_payload: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrchestrationHeartbeatData {
    pub id: Uuid,
    pub run_id: Uuid,
    pub task_id: Uuid,
    pub agent_id: Uuid,
    pub status: String,
    pub progress: f32,
    pub summary: Option<String>,
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct UpsertHeartbeatRequest {
    pub run_id: String,
    pub task_id: String,
    pub agent_id: String,
    pub status: String,
    pub progress: f32,
    pub summary: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrchestrationScheduleData {
    pub id: Uuid,
    pub run_id: Uuid,
    pub enabled: bool,
    pub interval_minutes: i32,
    pub next_run_at: Option<String>,
    pub last_run_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StaleTaskData {
    pub task_id: Uuid,
    pub title: String,
    pub status: String,
    pub last_heartbeat_at: Option<String>,
    pub minutes_since_heartbeat: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrchestrationDiagnostics {
    pub run: OrchestrationRunData,
    pub task_counts_by_status: HashMap<String, i64>,
    pub stale_tasks: Vec<StaleTaskData>,
    pub latest_heartbeat_at: Option<String>,
    pub schedule: Option<OrchestrationScheduleData>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentDelegationData {
    pub id: Uuid,
    pub parent_agent_id: Uuid,
    pub child_agent_id: Uuid,
    pub role: String,
    pub ownership_scope: String,
    pub is_active: bool,
    pub created_by_user_id: Uuid,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CreateAgentDelegationRequest {
    pub parent_agent_id: String,
    pub child_agent_id: String,
    pub role: String,
    pub ownership_scope: Option<String>,
    pub created_by_user_id: String,
    pub required_ability_keys: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrchestrationMemoryData {
    pub id: Uuid,
    pub run_id: Uuid,
    pub task_id: Option<Uuid>,
    pub agent_id: Uuid,
    pub scope: String,
    pub key: String,
    pub summary: Option<String>,
    pub payload: serde_json::Value,
    pub promoted_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct UpsertOrchestrationMemoryRequest {
    pub run_id: String,
    pub task_id: Option<String>,
    pub agent_id: String,
    pub scope: String,
    pub key: String,
    pub summary: Option<String>,
    pub payload: Option<serde_json::Value>,
}

pub struct OrchestrationService;

#[derive(Debug, Clone)]
struct PolicyRejection {
    code: &'static str,
    reason: String,
}

impl OrchestrationService {
    const MAX_RETRY_BACKOFF_SECONDS: i64 = 15 * 60;
    const DEFAULT_RETRY_BACKOFF_SECONDS: i64 = 5;

    fn is_valid_status(status: &str) -> bool {
        matches!(
            status,
            "queued"
                | "planned"
                | "in_progress"
                | "waiting"
                | "completed"
                | "failed"
                | "cancelled"
                | "paused"
        )
    }

    fn is_valid_role(role: &str) -> bool {
        matches!(
            role,
            "planner" | "researcher" | "executor" | "reviewer" | "custom"
        )
    }

    fn is_valid_scope(scope: &str) -> bool {
        matches!(scope, "private" | "shared_run" | "parent_visible")
    }

    fn is_valid_action_category(action_category: &str) -> bool {
        matches!(
            action_category,
            "planning" | "research" | "execution" | "review" | "synthesis" | "custom"
        )
    }

    fn next_retry_backoff_seconds(next_attempt_number: i32) -> i64 {
        let exponent = (next_attempt_number - 1).clamp(0, 10);
        let multiplier = 2_i64.saturating_pow(exponent as u32);
        (Self::DEFAULT_RETRY_BACKOFF_SECONDS * multiplier).clamp(0, Self::MAX_RETRY_BACKOFF_SECONDS)
    }

    fn build_attempt_idempotency_key(task_id: Uuid, attempt_number: i32) -> String {
        format!("task:{task_id}:attempt:{attempt_number}")
    }

    fn transition_error_message(kind: &str, current: &str, next: &str) -> String {
        format!("INVALID_STATUS_TRANSITION::{kind}::{current}->{next}")
    }

    fn validate_transition(current: &str, next: &str) -> bool {
        if current == next {
            return true;
        }
        matches!(
            (current, next),
            ("queued", "planned")
                | ("queued", "cancelled")
                | ("planned", "in_progress")
                | ("planned", "cancelled")
                | ("planned", "paused")
                | ("in_progress", "waiting")
                | ("in_progress", "completed")
                | ("in_progress", "failed")
                | ("in_progress", "cancelled")
                | ("in_progress", "paused")
                | ("waiting", "in_progress")
                | ("waiting", "failed")
                | ("waiting", "cancelled")
                | ("waiting", "paused")
                | ("paused", "in_progress")
                | ("paused", "cancelled")
                | ("failed", "queued")
                | ("failed", "cancelled")
        )
    }

    async fn log_event(
        db: &DatabaseConnection,
        run_id: Uuid,
        task_id: Option<Uuid>,
        event_type: &str,
        severity: &str,
        payload: serde_json::Value,
    ) -> Result<(), String> {
        db.execute(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            r#"
                INSERT INTO orchestration_events (
                    id,
                    run_id,
                    task_id,
                    event_type,
                    severity,
                    payload,
                    created_at
                )
                VALUES (
                    gen_random_uuid(),
                    $1::uuid,
                    $2::uuid,
                    $3::text,
                    $4::text,
                    $5::jsonb,
                    NOW()
                )
            "#,
            vec![
                run_id.into(),
                task_id.into(),
                event_type.to_string().into(),
                severity.to_string().into(),
                payload.to_string().into(),
            ],
        ))
        .await
        .map_err(|e| format!("Failed inserting orchestration event ({event_type}): {e}"))?;
        Ok(())
    }

    async fn ensure_parent_agent_ownership(
        db: &DatabaseConnection,
        parent_agent_id: Uuid,
        owner_user_id: Uuid,
    ) -> Result<(), String> {
        let row = db
            .query_one(Statement::from_sql_and_values(
                DatabaseBackend::Postgres,
                r#"
                    SELECT 1
                    FROM agents
                    WHERE id = $1::uuid
                      AND user_id = $2::uuid
                    LIMIT 1
                "#,
                vec![parent_agent_id.into(), owner_user_id.into()],
            ))
            .await
            .map_err(|e| format!("Failed validating parent agent ownership: {e}"))?;
        if row.is_none() {
            return Err("Parent agent does not belong to owner user".to_string());
        }
        Ok(())
    }

    fn decode_run(row: &sea_orm::QueryResult) -> Result<OrchestrationRunData, String> {
        Ok(OrchestrationRunData {
            id: row
                .try_get("", "id")
                .map_err(|e| format!("Failed decoding run id: {e}"))?,
            parent_agent_id: row
                .try_get("", "parent_agent_id")
                .map_err(|e| format!("Failed decoding parent_agent_id: {e}"))?,
            owner_user_id: row
                .try_get("", "owner_user_id")
                .map_err(|e| format!("Failed decoding owner_user_id: {e}"))?,
            title: row
                .try_get("", "title")
                .map_err(|e| format!("Failed decoding run title: {e}"))?,
            objective: row
                .try_get("", "objective")
                .map_err(|e| format!("Failed decoding run objective: {e}"))?,
            status: row
                .try_get("", "status")
                .map_err(|e| format!("Failed decoding run status: {e}"))?,
            priority: row
                .try_get("", "priority")
                .map_err(|e| format!("Failed decoding run priority: {e}"))?,
            started_at: row
                .try_get("", "started_at")
                .map_err(|e| format!("Failed decoding started_at: {e}"))?,
            completed_at: row
                .try_get("", "completed_at")
                .map_err(|e| format!("Failed decoding completed_at: {e}"))?,
            last_error: row
                .try_get("", "last_error")
                .map_err(|e| format!("Failed decoding last_error: {e}"))?,
            created_at: row
                .try_get("", "created_at")
                .map_err(|e| format!("Failed decoding created_at: {e}"))?,
            updated_at: row
                .try_get("", "updated_at")
                .map_err(|e| format!("Failed decoding updated_at: {e}"))?,
        })
    }

    fn decode_task(row: &sea_orm::QueryResult) -> Result<OrchestrationTaskData, String> {
        let heartbeat_progress = row
            .try_get::<f64>("", "heartbeat_progress")
            .map_err(|e| format!("Failed decoding heartbeat_progress: {e}"))?
            as f32;
        Ok(OrchestrationTaskData {
            id: row
                .try_get("", "id")
                .map_err(|e| format!("Failed decoding task id: {e}"))?,
            run_id: row
                .try_get("", "run_id")
                .map_err(|e| format!("Failed decoding task run_id: {e}"))?,
            parent_task_id: row
                .try_get("", "parent_task_id")
                .map_err(|e| format!("Failed decoding parent_task_id: {e}"))?,
            owner_agent_id: row
                .try_get("", "owner_agent_id")
                .map_err(|e| format!("Failed decoding owner_agent_id: {e}"))?,
            title: row
                .try_get("", "title")
                .map_err(|e| format!("Failed decoding task title: {e}"))?,
            description: row
                .try_get("", "description")
                .map_err(|e| format!("Failed decoding task description: {e}"))?,
            status: row
                .try_get("", "status")
                .map_err(|e| format!("Failed decoding task status: {e}"))?,
            task_order: row
                .try_get("", "task_order")
                .map_err(|e| format!("Failed decoding task_order: {e}"))?,
            idempotency_key: row
                .try_get("", "idempotency_key")
                .map_err(|e| format!("Failed decoding idempotency_key: {e}"))?,
            attempt_count: row
                .try_get("", "attempt_count")
                .map_err(|e| format!("Failed decoding attempt_count: {e}"))?,
            max_retries: row
                .try_get("", "max_retries")
                .map_err(|e| format!("Failed decoding max_retries: {e}"))?,
            next_retry_at: row
                .try_get("", "next_retry_at")
                .map_err(|e| format!("Failed decoding next_retry_at: {e}"))?,
            last_failure_reason: row
                .try_get("", "last_failure_reason")
                .map_err(|e| format!("Failed decoding last_failure_reason: {e}"))?,
            last_heartbeat_at: row
                .try_get("", "last_heartbeat_at")
                .map_err(|e| format!("Failed decoding last_heartbeat_at: {e}"))?,
            heartbeat_status: row
                .try_get("", "heartbeat_status")
                .map_err(|e| format!("Failed decoding heartbeat_status: {e}"))?,
            heartbeat_progress,
            created_at: row
                .try_get("", "created_at")
                .map_err(|e| format!("Failed decoding created_at: {e}"))?,
            updated_at: row
                .try_get("", "updated_at")
                .map_err(|e| format!("Failed decoding updated_at: {e}"))?,
        })
    }

    fn decode_agent_delegation(row: &sea_orm::QueryResult) -> Result<AgentDelegationData, String> {
        Ok(AgentDelegationData {
            id: row
                .try_get("", "id")
                .map_err(|e| format!("Failed decoding agent delegation id: {e}"))?,
            parent_agent_id: row
                .try_get("", "parent_agent_id")
                .map_err(|e| format!("Failed decoding parent_agent_id: {e}"))?,
            child_agent_id: row
                .try_get("", "child_agent_id")
                .map_err(|e| format!("Failed decoding child_agent_id: {e}"))?,
            role: row
                .try_get("", "role")
                .map_err(|e| format!("Failed decoding delegation role: {e}"))?,
            ownership_scope: row
                .try_get("", "ownership_scope")
                .map_err(|e| format!("Failed decoding ownership_scope: {e}"))?,
            is_active: row
                .try_get("", "is_active")
                .map_err(|e| format!("Failed decoding is_active: {e}"))?,
            created_by_user_id: row
                .try_get("", "created_by_user_id")
                .map_err(|e| format!("Failed decoding created_by_user_id: {e}"))?,
            created_at: row
                .try_get("", "created_at")
                .map_err(|e| format!("Failed decoding created_at: {e}"))?,
            updated_at: row
                .try_get("", "updated_at")
                .map_err(|e| format!("Failed decoding updated_at: {e}"))?,
        })
    }

    fn decode_delegation(
        row: &sea_orm::QueryResult,
    ) -> Result<OrchestrationDelegationData, String> {
        Ok(OrchestrationDelegationData {
            id: row
                .try_get("", "id")
                .map_err(|e| format!("Failed decoding delegation id: {e}"))?,
            run_id: row
                .try_get("", "run_id")
                .map_err(|e| format!("Failed decoding delegation run_id: {e}"))?,
            task_id: row
                .try_get("", "task_id")
                .map_err(|e| format!("Failed decoding delegation task_id: {e}"))?,
            from_agent_id: row
                .try_get("", "from_agent_id")
                .map_err(|e| format!("Failed decoding delegation from_agent_id: {e}"))?,
            to_agent_id: row
                .try_get("", "to_agent_id")
                .map_err(|e| format!("Failed decoding delegation to_agent_id: {e}"))?,
            policy_decision: row
                .try_get("", "policy_decision")
                .map_err(|e| format!("Failed decoding delegation policy_decision: {e}"))?,
            policy_reason: row
                .try_get("", "policy_reason")
                .map_err(|e| format!("Failed decoding delegation policy_reason: {e}"))?,
            handoff_payload: row
                .try_get("", "handoff_payload")
                .map_err(|e| format!("Failed decoding delegation handoff_payload: {e}"))?,
            created_at: row
                .try_get("", "created_at")
                .map_err(|e| format!("Failed decoding delegation created_at: {e}"))?,
        })
    }

    fn decode_memory(row: &sea_orm::QueryResult) -> Result<OrchestrationMemoryData, String> {
        Ok(OrchestrationMemoryData {
            id: row
                .try_get("", "id")
                .map_err(|e| format!("Failed decoding memory id: {e}"))?,
            run_id: row
                .try_get("", "run_id")
                .map_err(|e| format!("Failed decoding memory run_id: {e}"))?,
            task_id: row
                .try_get("", "task_id")
                .map_err(|e| format!("Failed decoding memory task_id: {e}"))?,
            agent_id: row
                .try_get("", "agent_id")
                .map_err(|e| format!("Failed decoding memory agent_id: {e}"))?,
            scope: row
                .try_get("", "scope")
                .map_err(|e| format!("Failed decoding memory scope: {e}"))?,
            key: row
                .try_get("", "key")
                .map_err(|e| format!("Failed decoding memory key: {e}"))?,
            summary: row
                .try_get("", "summary")
                .map_err(|e| format!("Failed decoding memory summary: {e}"))?,
            payload: row
                .try_get("", "payload")
                .map_err(|e| format!("Failed decoding memory payload: {e}"))?,
            promoted_at: row
                .try_get("", "promoted_at")
                .map_err(|e| format!("Failed decoding memory promoted_at: {e}"))?,
            created_at: row
                .try_get("", "created_at")
                .map_err(|e| format!("Failed decoding memory created_at: {e}"))?,
            updated_at: row
                .try_get("", "updated_at")
                .map_err(|e| format!("Failed decoding memory updated_at: {e}"))?,
        })
    }

    fn decode_schedule(row: &sea_orm::QueryResult) -> Result<OrchestrationScheduleData, String> {
        Ok(OrchestrationScheduleData {
            id: row
                .try_get("", "id")
                .map_err(|e| format!("Failed decoding schedule id: {e}"))?,
            run_id: row
                .try_get("", "run_id")
                .map_err(|e| format!("Failed decoding schedule run_id: {e}"))?,
            enabled: row
                .try_get("", "enabled")
                .map_err(|e| format!("Failed decoding schedule enabled: {e}"))?,
            interval_minutes: row
                .try_get("", "interval_minutes")
                .map_err(|e| format!("Failed decoding schedule interval_minutes: {e}"))?,
            next_run_at: row
                .try_get("", "next_run_at")
                .map_err(|e| format!("Failed decoding schedule next_run_at: {e}"))?,
            last_run_at: row
                .try_get("", "last_run_at")
                .map_err(|e| format!("Failed decoding schedule last_run_at: {e}"))?,
            created_at: row
                .try_get("", "created_at")
                .map_err(|e| format!("Failed decoding schedule created_at: {e}"))?,
            updated_at: row
                .try_get("", "updated_at")
                .map_err(|e| format!("Failed decoding schedule updated_at: {e}"))?,
        })
    }

    pub async fn create_run(
        db: &DatabaseConnection,
        request: CreateOrchestrationRunRequest,
    ) -> Result<OrchestrationRunData, String> {
        let parent_agent_id = Uuid::parse_str(&request.parent_agent_id)
            .map_err(|e| format!("Invalid parent_agent_id: {e}"))?;
        let owner_user_id = Uuid::parse_str(&request.owner_user_id)
            .map_err(|e| format!("Invalid owner_user_id: {e}"))?;
        if request.title.trim().is_empty() {
            return Err("title cannot be empty".to_string());
        }
        if request.objective.trim().is_empty() {
            return Err("objective cannot be empty".to_string());
        }

        let priority = request.priority.unwrap_or_else(|| "normal".to_string());
        if !matches!(priority.as_str(), "low" | "normal" | "high") {
            return Err("priority must be one of: low, normal, high".to_string());
        }

        Self::ensure_parent_agent_ownership(db, parent_agent_id, owner_user_id).await?;

        let row = db
            .query_one(Statement::from_sql_and_values(
                DatabaseBackend::Postgres,
                r#"
                    INSERT INTO orchestration_runs (
                        id,
                        parent_agent_id,
                        owner_user_id,
                        title,
                        objective,
                        status,
                        priority,
                        created_at,
                        updated_at
                    )
                    VALUES (
                        gen_random_uuid(),
                        $1::uuid,
                        $2::uuid,
                        $3::text,
                        $4::text,
                        'queued',
                        $5::text,
                        NOW(),
                        NOW()
                    )
                    RETURNING
                        id,
                        parent_agent_id,
                        owner_user_id,
                        title,
                        objective,
                        status,
                        priority,
                        started_at::text AS started_at,
                        completed_at::text AS completed_at,
                        last_error,
                        created_at::text AS created_at,
                        updated_at::text AS updated_at
                "#,
                vec![
                    parent_agent_id.into(),
                    owner_user_id.into(),
                    request.title.trim().to_string().into(),
                    request.objective.trim().to_string().into(),
                    priority.into(),
                ],
            ))
            .await
            .map_err(|e| format!("Failed creating orchestration run: {e}"))?
            .ok_or_else(|| "No row returned while creating orchestration run".to_string())?;

        let run = Self::decode_run(&row)?;
        Self::log_event(
            db,
            run.id,
            None,
            "run_created",
            "info",
            serde_json::json!({
                "run_id": run.id,
                "parent_agent_id": run.parent_agent_id,
                "priority": run.priority,
            }),
        )
        .await?;
        Ok(run)
    }

    pub async fn list_runs(
        db: &DatabaseConnection,
        parent_agent_id: String,
    ) -> Result<Vec<OrchestrationRunData>, String> {
        let parent_agent_id = Uuid::parse_str(&parent_agent_id)
            .map_err(|e| format!("Invalid parent_agent_id: {e}"))?;
        let rows = db
            .query_all(Statement::from_sql_and_values(
                DatabaseBackend::Postgres,
                r#"
                    SELECT
                        id,
                        parent_agent_id,
                        owner_user_id,
                        title,
                        objective,
                        status,
                        priority,
                        started_at::text AS started_at,
                        completed_at::text AS completed_at,
                        last_error,
                        created_at::text AS created_at,
                        updated_at::text AS updated_at
                    FROM orchestration_runs
                    WHERE parent_agent_id = $1::uuid
                    ORDER BY updated_at DESC
                "#,
                vec![parent_agent_id.into()],
            ))
            .await
            .map_err(|e| format!("Failed listing orchestration runs: {e}"))?;

        let mut out = Vec::with_capacity(rows.len());
        for row in rows {
            out.push(Self::decode_run(&row)?);
        }
        Ok(out)
    }

    pub async fn get_run(
        db: &DatabaseConnection,
        run_id: String,
    ) -> Result<OrchestrationRunData, String> {
        let run_id = Uuid::parse_str(&run_id).map_err(|e| format!("Invalid run_id: {e}"))?;
        let row = db
            .query_one(Statement::from_sql_and_values(
                DatabaseBackend::Postgres,
                r#"
                    SELECT
                        id,
                        parent_agent_id,
                        owner_user_id,
                        title,
                        objective,
                        status,
                        priority,
                        started_at::text AS started_at,
                        completed_at::text AS completed_at,
                        last_error,
                        created_at::text AS created_at,
                        updated_at::text AS updated_at
                    FROM orchestration_runs
                    WHERE id = $1::uuid
                    LIMIT 1
                "#,
                vec![run_id.into()],
            ))
            .await
            .map_err(|e| format!("Failed loading orchestration run: {e}"))?
            .ok_or_else(|| "Orchestration run not found".to_string())?;
        Self::decode_run(&row)
    }

    pub async fn update_run_status(
        db: &DatabaseConnection,
        run_id: String,
        status: String,
        last_error: Option<String>,
    ) -> Result<OrchestrationRunData, String> {
        let run_id = Uuid::parse_str(&run_id).map_err(|e| format!("Invalid run_id: {e}"))?;
        if !Self::is_valid_status(&status) {
            return Err("Invalid status transition target".to_string());
        }
        let current = Self::get_run(db, run_id.to_string()).await?;
        if !Self::validate_transition(&current.status, &status) {
            return Err(Self::transition_error_message(
                "run",
                current.status.as_str(),
                status.as_str(),
            ));
        }
        let row = db
            .query_one(Statement::from_sql_and_values(
                DatabaseBackend::Postgres,
                r#"
                    UPDATE orchestration_runs
                    SET
                        status = $2::text,
                        started_at = CASE
                            WHEN $2::text = 'in_progress' AND started_at IS NULL THEN NOW()
                            ELSE started_at
                        END,
                        completed_at = CASE
                            WHEN $2::text IN ('completed', 'failed', 'cancelled') THEN NOW()
                            ELSE completed_at
                        END,
                        last_error = $3::text,
                        updated_at = NOW()
                    WHERE id = $1::uuid
                    RETURNING
                        id,
                        parent_agent_id,
                        owner_user_id,
                        title,
                        objective,
                        status,
                        priority,
                        started_at::text AS started_at,
                        completed_at::text AS completed_at,
                        last_error,
                        created_at::text AS created_at,
                        updated_at::text AS updated_at
                "#,
                vec![run_id.into(), status.into(), last_error.into()],
            ))
            .await
            .map_err(|e| format!("Failed updating orchestration run status: {e}"))?
            .ok_or_else(|| "No row returned while updating orchestration run status".to_string())?;
        let run = Self::decode_run(&row)?;
        Self::log_event(
            db,
            run.id,
            None,
            "run_status_updated",
            if run.status == "failed" {
                "warning"
            } else {
                "info"
            },
            serde_json::json!({
                "run_id": run.id,
                "from_status": current.status,
                "to_status": run.status,
                "last_error": run.last_error,
            }),
        )
        .await?;
        Ok(run)
    }

    pub async fn create_task(
        db: &DatabaseConnection,
        request: CreateOrchestrationTaskRequest,
    ) -> Result<OrchestrationTaskData, String> {
        let run_id =
            Uuid::parse_str(&request.run_id).map_err(|e| format!("Invalid run_id: {e}"))?;
        let owner_agent_id = Uuid::parse_str(&request.owner_agent_id)
            .map_err(|e| format!("Invalid owner_agent_id: {e}"))?;
        if request.title.trim().is_empty() {
            return Err("title cannot be empty".to_string());
        }
        let parent_task_id = request
            .parent_task_id
            .map(|value| Uuid::parse_str(&value))
            .transpose()
            .map_err(|e| format!("Invalid parent_task_id: {e}"))?;
        let max_retries = request.max_retries.unwrap_or(3).clamp(0, 10);
        let task_order = request.task_order.unwrap_or(0);
        let run_parent_agent_id = Self::get_run_parent_agent_id(db, run_id).await?;
        if owner_agent_id != run_parent_agent_id {
            Self::evaluate_delegation_policy(
                db,
                run_id,
                run_parent_agent_id,
                owner_agent_id,
                None,
                Some("execution"),
                &HashSet::new(),
            )
            .await
            .map_err(|rejection| {
                format!(
                    "DELEGATION_POLICY_BLOCKED::{}::{}",
                    rejection.code, rejection.reason
                )
            })?;
        }

        let row = db
            .query_one(Statement::from_sql_and_values(
                DatabaseBackend::Postgres,
                r#"
                    INSERT INTO orchestration_tasks (
                        id,
                        run_id,
                        parent_task_id,
                        owner_agent_id,
                        title,
                        description,
                        status,
                        task_order,
                        idempotency_key,
                        max_retries,
                        created_at,
                        updated_at
                    )
                    VALUES (
                        gen_random_uuid(),
                        $1::uuid,
                        $2::uuid,
                        $3::uuid,
                        $4::text,
                        $5::text,
                        'queued',
                        $6::int,
                        $7::text,
                        $8::int,
                        NOW(),
                        NOW()
                    )
                    RETURNING
                        id,
                        run_id,
                        parent_task_id,
                        owner_agent_id,
                        title,
                        description,
                        status,
                        task_order,
                        idempotency_key,
                        attempt_count,
                        max_retries,
                        next_retry_at::text AS next_retry_at,
                        last_failure_reason,
                        last_heartbeat_at::text AS last_heartbeat_at,
                        heartbeat_status,
                        heartbeat_progress,
                        created_at::text AS created_at,
                        updated_at::text AS updated_at
                "#,
                vec![
                    run_id.into(),
                    parent_task_id.into(),
                    owner_agent_id.into(),
                    request.title.trim().to_string().into(),
                    request
                        .description
                        .map(|value| value.trim().to_string())
                        .into(),
                    task_order.into(),
                    request
                        .idempotency_key
                        .map(|value| value.trim().to_string())
                        .into(),
                    max_retries.into(),
                ],
            ))
            .await
            .map_err(|e| format!("Failed creating orchestration task: {e}"))?
            .ok_or_else(|| "No row returned while creating orchestration task".to_string())?;

        let task = Self::decode_task(&row)?;
        Self::log_event(
            db,
            task.run_id,
            Some(task.id),
            "task_created",
            "info",
            serde_json::json!({
                "task_id": task.id,
                "owner_agent_id": task.owner_agent_id,
                "status": task.status,
            }),
        )
        .await?;
        Ok(task)
    }

    pub async fn list_tasks(
        db: &DatabaseConnection,
        run_id: String,
    ) -> Result<Vec<OrchestrationTaskData>, String> {
        let run_id = Uuid::parse_str(&run_id).map_err(|e| format!("Invalid run_id: {e}"))?;
        let rows = db
            .query_all(Statement::from_sql_and_values(
                DatabaseBackend::Postgres,
                r#"
                    SELECT
                        id,
                        run_id,
                        parent_task_id,
                        owner_agent_id,
                        title,
                        description,
                        status,
                        task_order,
                        idempotency_key,
                        attempt_count,
                        max_retries,
                        next_retry_at::text AS next_retry_at,
                        last_failure_reason,
                        last_heartbeat_at::text AS last_heartbeat_at,
                        heartbeat_status,
                        heartbeat_progress,
                        created_at::text AS created_at,
                        updated_at::text AS updated_at
                    FROM orchestration_tasks
                    WHERE run_id = $1::uuid
                    ORDER BY task_order ASC, created_at ASC
                "#,
                vec![run_id.into()],
            ))
            .await
            .map_err(|e| format!("Failed listing orchestration tasks: {e}"))?;

        let mut out = Vec::with_capacity(rows.len());
        for row in rows {
            out.push(Self::decode_task(&row)?);
        }
        Ok(out)
    }

    pub async fn update_task_status(
        db: &DatabaseConnection,
        task_id: String,
        status: String,
        failure_reason: Option<String>,
    ) -> Result<OrchestrationTaskData, String> {
        let task_id = Uuid::parse_str(&task_id).map_err(|e| format!("Invalid task_id: {e}"))?;
        if !Self::is_valid_status(&status) {
            return Err("Invalid task status transition target".to_string());
        }

        let current_row = db
            .query_one(Statement::from_sql_and_values(
                DatabaseBackend::Postgres,
                r#"
                    SELECT status
                    FROM orchestration_tasks
                    WHERE id = $1::uuid
                    LIMIT 1
                "#,
                vec![task_id.into()],
            ))
            .await
            .map_err(|e| format!("Failed loading current task status: {e}"))?
            .ok_or_else(|| "Task not found".to_string())?;

        let current_status: String = current_row
            .try_get("", "status")
            .map_err(|e| format!("Failed decoding current task status: {e}"))?;
        if !Self::validate_transition(&current_status, &status) {
            return Err(Self::transition_error_message(
                "task",
                current_status.as_str(),
                status.as_str(),
            ));
        }
        let normalized_failure_reason = if status == "failed" {
            Some(
                failure_reason
                    .unwrap_or_else(|| "task_failed_unknown".to_string())
                    .trim()
                    .to_string(),
            )
        } else {
            None
        };

        let row = db
            .query_one(Statement::from_sql_and_values(
                DatabaseBackend::Postgres,
                r#"
                    UPDATE orchestration_tasks
                    SET
                        status = $2::text,
                        last_failure_reason = CASE
                            WHEN $2::text = 'failed' THEN $3::text
                            ELSE last_failure_reason
                        END,
                        next_retry_at = CASE
                            WHEN $2::text IN ('queued', 'in_progress', 'completed', 'cancelled') THEN NULL
                            ELSE next_retry_at
                        END,
                        updated_at = NOW()
                    WHERE id = $1::uuid
                    RETURNING
                        id,
                        run_id,
                        parent_task_id,
                        owner_agent_id,
                        title,
                        description,
                        status,
                        task_order,
                        idempotency_key,
                        attempt_count,
                        max_retries,
                        next_retry_at::text AS next_retry_at,
                        last_failure_reason,
                        last_heartbeat_at::text AS last_heartbeat_at,
                        heartbeat_status,
                        heartbeat_progress,
                        created_at::text AS created_at,
                        updated_at::text AS updated_at
                "#,
                vec![
                    task_id.into(),
                    status.clone().into(),
                    normalized_failure_reason.clone().into(),
                ],
            ))
            .await
            .map_err(|e| format!("Failed updating orchestration task status: {e}"))?
            .ok_or_else(|| "No row returned while updating task status".to_string())?;
        let task = Self::decode_task(&row)?;
        Self::log_event(
            db,
            task.run_id,
            Some(task.id),
            "task_status_updated",
            if task.status == "failed" {
                "warning"
            } else {
                "info"
            },
            serde_json::json!({
                "task_id": task.id,
                "from_status": current_status,
                "to_status": task.status,
                "failure_reason": normalized_failure_reason,
            }),
        )
        .await?;
        Ok(task)
    }

    pub async fn retry_task(
        db: &DatabaseConnection,
        task_id: String,
        requested_by_agent_id: String,
    ) -> Result<OrchestrationTaskData, String> {
        let task_id = Uuid::parse_str(&task_id).map_err(|e| format!("Invalid task_id: {e}"))?;
        let requested_by_agent_id = Uuid::parse_str(&requested_by_agent_id)
            .map_err(|e| format!("Invalid requested_by_agent_id: {e}"))?;
        let current_row = db
            .query_one(Statement::from_sql_and_values(
                DatabaseBackend::Postgres,
                r#"
                    SELECT
                        run_id,
                        status,
                        attempt_count,
                        max_retries
                    FROM orchestration_tasks
                    WHERE id = $1::uuid
                    LIMIT 1
                "#,
                vec![task_id.into()],
            ))
            .await
            .map_err(|e| format!("Failed loading task for retry: {e}"))?
            .ok_or_else(|| "Task not found".to_string())?;
        let run_id: Uuid = current_row
            .try_get("", "run_id")
            .map_err(|e| format!("Failed decoding retry run_id: {e}"))?;
        let status: String = current_row
            .try_get("", "status")
            .map_err(|e| format!("Failed decoding retry status: {e}"))?;
        let attempt_count: i32 = current_row
            .try_get("", "attempt_count")
            .map_err(|e| format!("Failed decoding retry attempt_count: {e}"))?;
        let max_retries: i32 = current_row
            .try_get("", "max_retries")
            .map_err(|e| format!("Failed decoding retry max_retries: {e}"))?;
        if status != "failed" {
            return Err(format!("RETRY_NOT_ALLOWED::status::{status}"));
        }
        let next_attempt_number = attempt_count + 1;
        if next_attempt_number > max_retries {
            return Err("RETRY_NOT_ALLOWED::budget_exhausted".to_string());
        }
        let backoff_seconds = Self::next_retry_backoff_seconds(next_attempt_number);

        let row = db
            .query_one(Statement::from_sql_and_values(
                DatabaseBackend::Postgres,
                r#"
                    UPDATE orchestration_tasks
                    SET
                        status = 'waiting',
                        attempt_count = $2::int,
                        next_retry_at = NOW() + (($3::bigint || ' seconds')::interval),
                        updated_at = NOW()
                    WHERE id = $1::uuid
                    RETURNING
                        id,
                        run_id,
                        parent_task_id,
                        owner_agent_id,
                        title,
                        description,
                        status,
                        task_order,
                        idempotency_key,
                        attempt_count,
                        max_retries,
                        next_retry_at::text AS next_retry_at,
                        last_failure_reason,
                        last_heartbeat_at::text AS last_heartbeat_at,
                        heartbeat_status,
                        heartbeat_progress,
                        created_at::text AS created_at,
                        updated_at::text AS updated_at
                "#,
                vec![
                    task_id.into(),
                    next_attempt_number.into(),
                    backoff_seconds.into(),
                ],
            ))
            .await
            .map_err(|e| format!("Failed retrying orchestration task: {e}"))?
            .ok_or_else(|| "Task cannot be retried".to_string())?;

        let task = Self::decode_task(&row)?;
        let attempt_idempotency_key =
            Self::build_attempt_idempotency_key(task.id, task.attempt_count);
        db.execute(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            r#"
                INSERT INTO orchestration_task_attempts (
                    id,
                    run_id,
                    task_id,
                    attempt_number,
                    attempt_idempotency_key,
                    executor_agent_id,
                    status,
                    backoff_seconds,
                    created_at,
                    started_at
                )
                VALUES (
                    gen_random_uuid(),
                    $1::uuid,
                    $2::uuid,
                    $3::int,
                    $4::text,
                    $5::uuid,
                    'scheduled',
                    $6::int,
                    NOW(),
                    NOW()
                )
            "#,
            vec![
                task.run_id.into(),
                task.id.into(),
                task.attempt_count.into(),
                attempt_idempotency_key.into(),
                requested_by_agent_id.into(),
                (backoff_seconds as i32).into(),
            ],
        ))
        .await
        .map_err(|e| format!("Failed creating orchestration retry attempt: {e}"))?;
        Self::log_event(
            db,
            run_id,
            Some(task.id),
            "task_retry_scheduled",
            "warning",
            serde_json::json!({
                "task_id": task.id,
                "attempt_number": task.attempt_count,
                "backoff_seconds": backoff_seconds,
                "requested_by_agent_id": requested_by_agent_id,
            }),
        )
        .await?;
        Ok(task)
    }

    async fn get_run_parent_agent_id(
        db: &DatabaseConnection,
        run_id: Uuid,
    ) -> Result<Uuid, String> {
        let row = db
            .query_one(Statement::from_sql_and_values(
                DatabaseBackend::Postgres,
                r#"
                    SELECT parent_agent_id
                    FROM orchestration_runs
                    WHERE id = $1::uuid
                    LIMIT 1
                "#,
                vec![run_id.into()],
            ))
            .await
            .map_err(|e| format!("Failed loading run parent_agent_id: {e}"))?
            .ok_or_else(|| "Run not found".to_string())?;
        row.try_get("", "parent_agent_id")
            .map_err(|e| format!("Failed decoding run parent_agent_id: {e}"))
    }

    async fn get_enabled_ability_keys_for_agent(
        db: &DatabaseConnection,
        agent_id: Uuid,
    ) -> Result<HashSet<String>, String> {
        let rows = db
            .query_all(Statement::from_sql_and_values(
                DatabaseBackend::Postgres,
                r#"
                    SELECT ab.implementation_key
                    FROM agent_abilities aa
                    JOIN abilities ab ON ab.id = aa.ability_id
                    WHERE aa.agent_id = $1::uuid
                      AND aa.enabled = true
                "#,
                vec![agent_id.into()],
            ))
            .await
            .map_err(|e| format!("Failed loading enabled ability keys: {e}"))?;
        let mut keys = HashSet::new();
        for row in rows {
            let key: String = row
                .try_get("", "implementation_key")
                .map_err(|e| format!("Failed decoding implementation_key: {e}"))?;
            keys.insert(key);
        }
        Ok(keys)
    }

    async fn load_active_delegation_role(
        db: &DatabaseConnection,
        parent_agent_id: Uuid,
        child_agent_id: Uuid,
    ) -> Result<Option<String>, String> {
        let row = db
            .query_one(Statement::from_sql_and_values(
                DatabaseBackend::Postgres,
                r#"
                    SELECT role
                    FROM agent_delegations
                    WHERE parent_agent_id = $1::uuid
                      AND child_agent_id = $2::uuid
                      AND is_active = true
                    LIMIT 1
                "#,
                vec![parent_agent_id.into(), child_agent_id.into()],
            ))
            .await
            .map_err(|e| format!("Failed loading active delegation role: {e}"))?;
        if let Some(row) = row {
            return row
                .try_get("", "role")
                .map(Some)
                .map_err(|e| format!("Failed decoding delegation role: {e}"));
        }
        Ok(None)
    }

    async fn evaluate_delegation_policy(
        db: &DatabaseConnection,
        run_id: Uuid,
        from_agent_id: Uuid,
        to_agent_id: Uuid,
        required_role: Option<&str>,
        action_category: Option<&str>,
        required_ability_keys: &HashSet<String>,
    ) -> Result<(), PolicyRejection> {
        let parent_agent_id =
            Self::get_run_parent_agent_id(db, run_id)
                .await
                .map_err(|reason| PolicyRejection {
                    code: "RUN_NOT_FOUND",
                    reason,
                })?;
        if let Some(category) = action_category {
            if !Self::is_valid_action_category(category) {
                return Err(PolicyRejection {
                    code: "ACTION_CATEGORY_INVALID",
                    reason: format!("Unsupported action category: {category}"),
                });
            }
        }

        let from_is_parent = from_agent_id == parent_agent_id;
        if !from_is_parent {
            let active_role = Self::load_active_delegation_role(db, parent_agent_id, from_agent_id)
                .await
                .map_err(|reason| PolicyRejection {
                    code: "POLICY_EVALUATION_FAILED",
                    reason,
                })?;
            if active_role.is_none() {
                return Err(PolicyRejection {
                    code: "SOURCE_AGENT_NOT_DELEGATED",
                    reason: "Source agent is not an active delegated sub-agent for this run"
                        .to_string(),
                });
            }
        }

        let target_role = if to_agent_id == parent_agent_id {
            Some("planner".to_string())
        } else {
            Self::load_active_delegation_role(db, parent_agent_id, to_agent_id)
                .await
                .map_err(|reason| PolicyRejection {
                    code: "POLICY_EVALUATION_FAILED",
                    reason,
                })?
        };
        let Some(target_role) = target_role else {
            return Err(PolicyRejection {
                code: "TARGET_AGENT_NOT_DELEGATED",
                reason: "Target agent is not an active delegated sub-agent for this run"
                    .to_string(),
            });
        };
        if let Some(expected_role) = required_role {
            if !Self::is_valid_role(expected_role) {
                return Err(PolicyRejection {
                    code: "ROLE_INVALID",
                    reason: format!("Unsupported required role: {expected_role}"),
                });
            }
            if target_role != expected_role {
                return Err(PolicyRejection {
                    code: "ROLE_MISMATCH",
                    reason: format!("Delegation target role '{target_role}' does not match required role '{expected_role}'"),
                });
            }
        }
        if !required_ability_keys.is_empty() {
            let enabled = Self::get_enabled_ability_keys_for_agent(db, to_agent_id)
                .await
                .map_err(|reason| PolicyRejection {
                    code: "POLICY_EVALUATION_FAILED",
                    reason,
                })?;
            let missing: Vec<String> = required_ability_keys
                .iter()
                .filter(|key| !enabled.contains(key.as_str()))
                .cloned()
                .collect();
            if !missing.is_empty() {
                return Err(PolicyRejection {
                    code: "CAPABILITY_MISMATCH",
                    reason: format!(
                        "Target agent missing required capabilities: {}",
                        missing.join(",")
                    ),
                });
            }
        }
        Ok(())
    }

    pub async fn create_agent_delegation(
        db: &DatabaseConnection,
        request: CreateAgentDelegationRequest,
    ) -> Result<AgentDelegationData, String> {
        let parent_agent_id = Uuid::parse_str(&request.parent_agent_id)
            .map_err(|e| format!("Invalid parent_agent_id: {e}"))?;
        let child_agent_id = Uuid::parse_str(&request.child_agent_id)
            .map_err(|e| format!("Invalid child_agent_id: {e}"))?;
        let created_by_user_id = Uuid::parse_str(&request.created_by_user_id)
            .map_err(|e| format!("Invalid created_by_user_id: {e}"))?;
        if parent_agent_id == child_agent_id {
            return Err("Cannot delegate an agent to itself".to_string());
        }
        if !Self::is_valid_role(request.role.as_str()) {
            return Err(
                "role must be one of: planner, researcher, executor, reviewer, custom".to_string(),
            );
        }
        let ownership_scope = request
            .ownership_scope
            .unwrap_or_else(|| "delegated".to_string());
        if !matches!(
            ownership_scope.as_str(),
            "delegated" | "shared" | "observer"
        ) {
            return Err("ownership_scope must be one of: delegated, shared, observer".to_string());
        }

        let membership_row = db
            .query_one(Statement::from_sql_and_values(
                DatabaseBackend::Postgres,
                r#"
                    SELECT
                        SUM(CASE WHEN id = $1::uuid AND user_id = $3::uuid THEN 1 ELSE 0 END)::int AS parent_owned,
                        SUM(CASE WHEN id = $2::uuid AND user_id = $3::uuid THEN 1 ELSE 0 END)::int AS child_owned
                    FROM agents
                    WHERE id IN ($1::uuid, $2::uuid)
                "#,
                vec![
                    parent_agent_id.into(),
                    child_agent_id.into(),
                    created_by_user_id.into(),
                ],
            ))
            .await
            .map_err(|e| format!("Failed validating delegation ownership: {e}"))?
            .ok_or_else(|| "Failed validating delegation ownership".to_string())?;
        let parent_owned: i32 = membership_row
            .try_get("", "parent_owned")
            .map_err(|e| format!("Failed decoding parent_owned: {e}"))?;
        let child_owned: i32 = membership_row
            .try_get("", "child_owned")
            .map_err(|e| format!("Failed decoding child_owned: {e}"))?;
        if parent_owned != 1 || child_owned != 1 {
            return Err(
                "Both parent and child agents must belong to the creating user".to_string(),
            );
        }
        let required_ability_keys: HashSet<String> = request
            .required_ability_keys
            .clone()
            .unwrap_or_default()
            .into_iter()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .collect();
        if !required_ability_keys.is_empty() {
            let enabled = Self::get_enabled_ability_keys_for_agent(db, child_agent_id).await?;
            let missing: Vec<String> = required_ability_keys
                .iter()
                .filter(|key| !enabled.contains(key.as_str()))
                .cloned()
                .collect();
            if !missing.is_empty() {
                return Err(format!(
                    "Delegation blocked: child agent is missing required abilities: {}",
                    missing.join(",")
                ));
            }
        }

        let row = db
            .query_one(Statement::from_sql_and_values(
                DatabaseBackend::Postgres,
                r#"
                    INSERT INTO agent_delegations (
                        id,
                        parent_agent_id,
                        child_agent_id,
                        role,
                        ownership_scope,
                        is_active,
                        created_by_user_id,
                        created_at,
                        updated_at
                    )
                    VALUES (
                        gen_random_uuid(),
                        $1::uuid,
                        $2::uuid,
                        $3::text,
                        $4::text,
                        true,
                        $5::uuid,
                        NOW(),
                        NOW()
                    )
                    ON CONFLICT (parent_agent_id, child_agent_id)
                    DO UPDATE SET
                        role = EXCLUDED.role,
                        ownership_scope = EXCLUDED.ownership_scope,
                        is_active = true,
                        updated_at = NOW()
                    RETURNING
                        id,
                        parent_agent_id,
                        child_agent_id,
                        role,
                        ownership_scope,
                        is_active,
                        created_by_user_id,
                        created_at::text AS created_at,
                        updated_at::text AS updated_at
                "#,
                vec![
                    parent_agent_id.into(),
                    child_agent_id.into(),
                    request.role.trim().to_string().into(),
                    ownership_scope.into(),
                    created_by_user_id.into(),
                ],
            ))
            .await
            .map_err(|e| format!("Failed upserting agent delegation: {e}"))?
            .ok_or_else(|| "No row returned while upserting agent delegation".to_string())?;
        Self::decode_agent_delegation(&row)
    }

    pub async fn list_agent_delegations(
        db: &DatabaseConnection,
        parent_agent_id: String,
    ) -> Result<Vec<AgentDelegationData>, String> {
        let parent_agent_id = Uuid::parse_str(&parent_agent_id)
            .map_err(|e| format!("Invalid parent_agent_id: {e}"))?;
        let rows = db
            .query_all(Statement::from_sql_and_values(
                DatabaseBackend::Postgres,
                r#"
                    SELECT
                        id,
                        parent_agent_id,
                        child_agent_id,
                        role,
                        ownership_scope,
                        is_active,
                        created_by_user_id,
                        created_at::text AS created_at,
                        updated_at::text AS updated_at
                    FROM agent_delegations
                    WHERE parent_agent_id = $1::uuid
                    ORDER BY is_active DESC, updated_at DESC
                "#,
                vec![parent_agent_id.into()],
            ))
            .await
            .map_err(|e| format!("Failed listing agent delegations: {e}"))?;
        let mut out = Vec::with_capacity(rows.len());
        for row in rows {
            out.push(Self::decode_agent_delegation(&row)?);
        }
        Ok(out)
    }

    pub async fn reassign_task(
        db: &DatabaseConnection,
        task_id: String,
        new_owner_agent_id: String,
        requested_by_agent_id: String,
        reason: Option<String>,
        required_ability_keys: Option<Vec<String>>,
    ) -> Result<OrchestrationTaskData, String> {
        let task_id = Uuid::parse_str(&task_id).map_err(|e| format!("Invalid task_id: {e}"))?;
        let new_owner_agent_id = Uuid::parse_str(&new_owner_agent_id)
            .map_err(|e| format!("Invalid new_owner_agent_id: {e}"))?;
        let requested_by_agent_id = Uuid::parse_str(&requested_by_agent_id)
            .map_err(|e| format!("Invalid requested_by_agent_id: {e}"))?;

        let current_row = db
            .query_one(Statement::from_sql_and_values(
                DatabaseBackend::Postgres,
                r#"
                    SELECT run_id, owner_agent_id
                    FROM orchestration_tasks
                    WHERE id = $1::uuid
                    LIMIT 1
                "#,
                vec![task_id.into()],
            ))
            .await
            .map_err(|e| format!("Failed loading task for reassignment: {e}"))?
            .ok_or_else(|| "Task not found".to_string())?;
        let run_id: Uuid = current_row
            .try_get("", "run_id")
            .map_err(|e| format!("Failed decoding run_id for reassignment: {e}"))?;
        let previous_owner_agent_id: Uuid = current_row
            .try_get("", "owner_agent_id")
            .map_err(|e| format!("Failed decoding owner_agent_id for reassignment: {e}"))?;
        let required_ability_keys_set: HashSet<String> = required_ability_keys
            .unwrap_or_default()
            .into_iter()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .collect();
        Self::evaluate_delegation_policy(
            db,
            run_id,
            requested_by_agent_id,
            new_owner_agent_id,
            None,
            Some("execution"),
            &required_ability_keys_set,
        )
        .await
        .map_err(|rejection| {
            format!(
                "DELEGATION_POLICY_BLOCKED::{}::{}",
                rejection.code, rejection.reason
            )
        })?;

        let row = db
            .query_one(Statement::from_sql_and_values(
                DatabaseBackend::Postgres,
                r#"
                    UPDATE orchestration_tasks
                    SET
                        owner_agent_id = $2::uuid,
                        updated_at = NOW()
                    WHERE id = $1::uuid
                    RETURNING
                        id,
                        run_id,
                        parent_task_id,
                        owner_agent_id,
                        title,
                        description,
                        status,
                        task_order,
                        idempotency_key,
                        attempt_count,
                        max_retries,
                        next_retry_at::text AS next_retry_at,
                        last_failure_reason,
                        last_heartbeat_at::text AS last_heartbeat_at,
                        heartbeat_status,
                        heartbeat_progress,
                        created_at::text AS created_at,
                        updated_at::text AS updated_at
                "#,
                vec![task_id.into(), new_owner_agent_id.into()],
            ))
            .await
            .map_err(|e| format!("Failed reassigning orchestration task: {e}"))?
            .ok_or_else(|| "No row returned while reassigning task".to_string())?;
        let task = Self::decode_task(&row)?;
        Self::log_event(
            db,
            run_id,
            Some(task.id),
            "task_reassigned",
            "info",
            serde_json::json!({
                "task_id": task.id,
                "from_owner_agent_id": previous_owner_agent_id,
                "to_owner_agent_id": new_owner_agent_id,
                "requested_by_agent_id": requested_by_agent_id,
                "reason": reason,
                "required_ability_keys": required_ability_keys_set,
            }),
        )
        .await?;
        Ok(task)
    }

    pub async fn record_delegation(
        db: &DatabaseConnection,
        request: RecordDelegationRequest,
    ) -> Result<OrchestrationDelegationData, String> {
        let run_id =
            Uuid::parse_str(&request.run_id).map_err(|e| format!("Invalid run_id: {e}"))?;
        let task_id =
            Uuid::parse_str(&request.task_id).map_err(|e| format!("Invalid task_id: {e}"))?;
        let from_agent_id = Uuid::parse_str(&request.from_agent_id)
            .map_err(|e| format!("Invalid from_agent_id: {e}"))?;
        let to_agent_id = Uuid::parse_str(&request.to_agent_id)
            .map_err(|e| format!("Invalid to_agent_id: {e}"))?;
        if !matches!(
            request.policy_decision.as_str(),
            "allowed" | "blocked" | "manual_override"
        ) {
            return Err(
                "policy_decision must be one of: allowed, blocked, manual_override".to_string(),
            );
        }
        let required_role = request.required_role.as_deref();
        let action_category = request.action_category.as_deref();
        let required_ability_keys: HashSet<String> = request
            .required_ability_keys
            .clone()
            .unwrap_or_default()
            .into_iter()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .collect();
        let policy_check = Self::evaluate_delegation_policy(
            db,
            run_id,
            from_agent_id,
            to_agent_id,
            required_role,
            action_category,
            &required_ability_keys,
        )
        .await;

        let (policy_decision, policy_reason) = match policy_check {
            Ok(()) => ("allowed".to_string(), request.policy_reason.clone()),
            Err(rejection) => {
                let payload = serde_json::json!({
                    "run_id": run_id,
                    "task_id": task_id,
                    "from_agent_id": from_agent_id,
                    "to_agent_id": to_agent_id,
                    "policy_code": rejection.code,
                    "policy_reason": rejection.reason,
                    "action_category": action_category,
                    "required_role": required_role,
                    "required_ability_keys": required_ability_keys,
                });
                Self::log_event(
                    db,
                    run_id,
                    Some(task_id),
                    "delegation_policy_blocked",
                    "warning",
                    payload,
                )
                .await?;
                if request.policy_decision == "manual_override" {
                    (
                        "manual_override".to_string(),
                        Some(format!(
                            "{}::{}{}",
                            rejection.code,
                            rejection.reason,
                            request
                                .policy_reason
                                .as_ref()
                                .map(|value| format!("::{}", value))
                                .unwrap_or_default()
                        )),
                    )
                } else {
                    return Err(format!(
                        "DELEGATION_POLICY_BLOCKED::{}::{}",
                        rejection.code, rejection.reason
                    ));
                }
            }
        };

        let handoff_payload = request
            .handoff_payload
            .unwrap_or_else(|| serde_json::json!({}));
        let row = db
            .query_one(Statement::from_sql_and_values(
                DatabaseBackend::Postgres,
                r#"
                    INSERT INTO orchestration_delegations (
                        id,
                        run_id,
                        task_id,
                        from_agent_id,
                        to_agent_id,
                        policy_decision,
                        policy_reason,
                        handoff_payload,
                        created_at
                    )
                    VALUES (
                        gen_random_uuid(),
                        $1::uuid,
                        $2::uuid,
                        $3::uuid,
                        $4::uuid,
                        $5::text,
                        $6::text,
                        $7::jsonb,
                        NOW()
                    )
                    RETURNING
                        id,
                        run_id,
                        task_id,
                        from_agent_id,
                        to_agent_id,
                        policy_decision,
                        policy_reason,
                        handoff_payload,
                        created_at::text AS created_at
                "#,
                vec![
                    run_id.into(),
                    task_id.into(),
                    from_agent_id.into(),
                    to_agent_id.into(),
                    policy_decision.clone().into(),
                    policy_reason.clone().into(),
                    handoff_payload.to_string().into(),
                ],
            ))
            .await
            .map_err(|e| format!("Failed recording orchestration delegation: {e}"))?
            .ok_or_else(|| "No row returned while recording delegation".to_string())?;
        let delegation = Self::decode_delegation(&row)?;
        Self::log_event(
            db,
            run_id,
            Some(task_id),
            "delegation_policy_decision",
            if policy_decision == "allowed" {
                "info"
            } else {
                "warning"
            },
            serde_json::json!({
                "policy_decision": policy_decision,
                "policy_reason": policy_reason,
                "from_agent_id": from_agent_id,
                "to_agent_id": to_agent_id,
                "required_role": required_role,
                "action_category": action_category,
                "required_ability_keys": required_ability_keys,
            }),
        )
        .await?;
        Ok(delegation)
    }

    pub async fn upsert_heartbeat(
        db: &DatabaseConnection,
        request: UpsertHeartbeatRequest,
    ) -> Result<OrchestrationHeartbeatData, String> {
        let run_id =
            Uuid::parse_str(&request.run_id).map_err(|e| format!("Invalid run_id: {e}"))?;
        let task_id =
            Uuid::parse_str(&request.task_id).map_err(|e| format!("Invalid task_id: {e}"))?;
        let agent_id =
            Uuid::parse_str(&request.agent_id).map_err(|e| format!("Invalid agent_id: {e}"))?;
        let progress = request.progress.clamp(0.0, 1.0);

        let row = db
            .query_one(Statement::from_sql_and_values(
                DatabaseBackend::Postgres,
                r#"
                    INSERT INTO orchestration_heartbeats (
                        id,
                        run_id,
                        task_id,
                        agent_id,
                        status,
                        progress,
                        summary,
                        updated_at
                    )
                    VALUES (
                        gen_random_uuid(),
                        $1::uuid,
                        $2::uuid,
                        $3::uuid,
                        $4::text,
                        $5::float,
                        $6::text,
                        NOW()
                    )
                    ON CONFLICT (run_id, task_id, agent_id)
                    DO UPDATE SET
                        status = EXCLUDED.status,
                        progress = EXCLUDED.progress,
                        summary = EXCLUDED.summary,
                        updated_at = NOW()
                    RETURNING
                        id,
                        run_id,
                        task_id,
                        agent_id,
                        status,
                        progress,
                        summary,
                        updated_at::text AS updated_at
                "#,
                vec![
                    run_id.into(),
                    task_id.into(),
                    agent_id.into(),
                    request.status.clone().into(),
                    (progress as f64).into(),
                    request.summary.clone().into(),
                ],
            ))
            .await
            .map_err(|e| format!("Failed upserting orchestration heartbeat: {e}"))?
            .ok_or_else(|| "No row returned while upserting heartbeat".to_string())?;

        db.execute(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            r#"
                UPDATE orchestration_tasks
                SET
                    last_heartbeat_at = NOW(),
                    heartbeat_status = $2::text,
                    heartbeat_progress = $3::float,
                    updated_at = NOW()
                WHERE id = $1::uuid
            "#,
            vec![
                task_id.into(),
                request.status.into(),
                (progress as f64).into(),
            ],
        ))
        .await
        .map_err(|e| format!("Failed updating task heartbeat projections: {e}"))?;

        Ok(OrchestrationHeartbeatData {
            id: row
                .try_get("", "id")
                .map_err(|e| format!("Failed decoding heartbeat id: {e}"))?,
            run_id: row
                .try_get("", "run_id")
                .map_err(|e| format!("Failed decoding heartbeat run_id: {e}"))?,
            task_id: row
                .try_get("", "task_id")
                .map_err(|e| format!("Failed decoding heartbeat task_id: {e}"))?,
            agent_id: row
                .try_get("", "agent_id")
                .map_err(|e| format!("Failed decoding heartbeat agent_id: {e}"))?,
            status: row
                .try_get("", "status")
                .map_err(|e| format!("Failed decoding heartbeat status: {e}"))?,
            progress: row
                .try_get::<f64>("", "progress")
                .map_err(|e| format!("Failed decoding heartbeat progress: {e}"))?
                as f32,
            summary: row
                .try_get("", "summary")
                .map_err(|e| format!("Failed decoding heartbeat summary: {e}"))?,
            updated_at: row
                .try_get("", "updated_at")
                .map_err(|e| format!("Failed decoding heartbeat updated_at: {e}"))?,
        })
    }

    pub async fn upsert_memory(
        db: &DatabaseConnection,
        request: UpsertOrchestrationMemoryRequest,
    ) -> Result<OrchestrationMemoryData, String> {
        let run_id =
            Uuid::parse_str(&request.run_id).map_err(|e| format!("Invalid run_id: {e}"))?;
        let task_id = request
            .task_id
            .as_ref()
            .map(|value| Uuid::parse_str(value))
            .transpose()
            .map_err(|e| format!("Invalid task_id: {e}"))?;
        let agent_id =
            Uuid::parse_str(&request.agent_id).map_err(|e| format!("Invalid agent_id: {e}"))?;
        if !Self::is_valid_scope(request.scope.as_str()) {
            return Err("scope must be one of: private, shared_run, parent_visible".to_string());
        }
        if request.key.trim().is_empty() {
            return Err("key cannot be empty".to_string());
        }

        let row = db
            .query_one(Statement::from_sql_and_values(
                DatabaseBackend::Postgres,
                r#"
                    INSERT INTO orchestration_memories (
                        id,
                        run_id,
                        task_id,
                        agent_id,
                        scope,
                        key,
                        summary,
                        payload,
                        promoted_at,
                        created_at,
                        updated_at
                    )
                    VALUES (
                        gen_random_uuid(),
                        $1::uuid,
                        $2::uuid,
                        $3::uuid,
                        $4::text,
                        $5::text,
                        $6::text,
                        $7::jsonb,
                        CASE WHEN $4::text = 'parent_visible' THEN NOW() ELSE NULL END,
                        NOW(),
                        NOW()
                    )
                    ON CONFLICT (run_id, agent_id, scope, key)
                    DO UPDATE SET
                        task_id = EXCLUDED.task_id,
                        summary = EXCLUDED.summary,
                        payload = EXCLUDED.payload,
                        promoted_at = CASE
                            WHEN EXCLUDED.scope = 'parent_visible'
                                THEN COALESCE(orchestration_memories.promoted_at, NOW())
                            ELSE orchestration_memories.promoted_at
                        END,
                        updated_at = NOW()
                    RETURNING
                        id,
                        run_id,
                        task_id,
                        agent_id,
                        scope,
                        key,
                        summary,
                        payload,
                        promoted_at::text AS promoted_at,
                        created_at::text AS created_at,
                        updated_at::text AS updated_at
                "#,
                vec![
                    run_id.into(),
                    task_id.into(),
                    agent_id.into(),
                    request.scope.trim().to_string().into(),
                    request.key.trim().to_string().into(),
                    request.summary.map(|value| value.trim().to_string()).into(),
                    request
                        .payload
                        .unwrap_or_else(|| serde_json::json!({}))
                        .to_string()
                        .into(),
                ],
            ))
            .await
            .map_err(|e| format!("Failed upserting orchestration memory: {e}"))?
            .ok_or_else(|| "No row returned while upserting orchestration memory".to_string())?;
        let memory = Self::decode_memory(&row)?;
        Self::log_event(
            db,
            run_id,
            task_id,
            "memory_upserted",
            "info",
            serde_json::json!({
                "memory_id": memory.id,
                "scope": memory.scope,
                "key": memory.key,
                "agent_id": memory.agent_id,
            }),
        )
        .await?;
        Ok(memory)
    }

    pub async fn list_memories(
        db: &DatabaseConnection,
        run_id: String,
        viewer_agent_id: String,
        scope_filter: Option<String>,
    ) -> Result<Vec<OrchestrationMemoryData>, String> {
        let run_id = Uuid::parse_str(&run_id).map_err(|e| format!("Invalid run_id: {e}"))?;
        let viewer_agent_id = Uuid::parse_str(&viewer_agent_id)
            .map_err(|e| format!("Invalid viewer_agent_id: {e}"))?;
        let normalized_scope_filter = scope_filter.unwrap_or_else(|| "all".to_string());
        if normalized_scope_filter != "all"
            && !Self::is_valid_scope(normalized_scope_filter.as_str())
        {
            return Err(
                "scope_filter must be one of: all, private, shared_run, parent_visible".to_string(),
            );
        }

        let rows = db
            .query_all(Statement::from_sql_and_values(
                DatabaseBackend::Postgres,
                r#"
                    SELECT
                        id,
                        run_id,
                        task_id,
                        agent_id,
                        scope,
                        key,
                        summary,
                        payload,
                        promoted_at::text AS promoted_at,
                        created_at::text AS created_at,
                        updated_at::text AS updated_at
                    FROM orchestration_memories
                    WHERE run_id = $1::uuid
                      AND (
                          ($3::text = 'all' AND (
                              scope IN ('shared_run', 'parent_visible')
                              OR (scope = 'private' AND agent_id = $2::uuid)
                          ))
                          OR ($3::text = 'private' AND scope = 'private' AND agent_id = $2::uuid)
                          OR ($3::text = 'shared_run' AND scope = 'shared_run')
                          OR ($3::text = 'parent_visible' AND scope = 'parent_visible')
                      )
                    ORDER BY created_at DESC
                "#,
                vec![
                    run_id.into(),
                    viewer_agent_id.into(),
                    normalized_scope_filter.into(),
                ],
            ))
            .await
            .map_err(|e| format!("Failed listing orchestration memories: {e}"))?;
        let mut out = Vec::with_capacity(rows.len());
        for row in rows {
            out.push(Self::decode_memory(&row)?);
        }
        Ok(out)
    }

    pub async fn promote_memory_to_parent_visible(
        db: &DatabaseConnection,
        memory_id: String,
        requested_by_agent_id: String,
    ) -> Result<OrchestrationMemoryData, String> {
        let memory_id =
            Uuid::parse_str(&memory_id).map_err(|e| format!("Invalid memory_id: {e}"))?;
        let requested_by_agent_id = Uuid::parse_str(&requested_by_agent_id)
            .map_err(|e| format!("Invalid requested_by_agent_id: {e}"))?;
        let context_row = db
            .query_one(Statement::from_sql_and_values(
                DatabaseBackend::Postgres,
                r#"
                    SELECT run_id
                    FROM orchestration_memories
                    WHERE id = $1::uuid
                    LIMIT 1
                "#,
                vec![memory_id.into()],
            ))
            .await
            .map_err(|e| format!("Failed loading memory context: {e}"))?
            .ok_or_else(|| "Memory not found".to_string())?;
        let run_id: Uuid = context_row
            .try_get("", "run_id")
            .map_err(|e| format!("Failed decoding memory run_id: {e}"))?;
        let parent_agent_id = Self::get_run_parent_agent_id(db, run_id).await?;
        if requested_by_agent_id != parent_agent_id {
            let has_delegation =
                Self::load_active_delegation_role(db, parent_agent_id, requested_by_agent_id)
                    .await?;
            if has_delegation.is_none() {
                return Err("MEMORY_PROMOTION_DENIED::requester_not_in_run_topology".to_string());
            }
        }
        let row = db
            .query_one(Statement::from_sql_and_values(
                DatabaseBackend::Postgres,
                r#"
                    UPDATE orchestration_memories
                    SET
                        scope = 'parent_visible',
                        promoted_at = COALESCE(promoted_at, NOW()),
                        updated_at = NOW()
                    WHERE id = $1::uuid
                    RETURNING
                        id,
                        run_id,
                        task_id,
                        agent_id,
                        scope,
                        key,
                        summary,
                        payload,
                        promoted_at::text AS promoted_at,
                        created_at::text AS created_at,
                        updated_at::text AS updated_at
                "#,
                vec![memory_id.into()],
            ))
            .await
            .map_err(|e| format!("Failed promoting orchestration memory: {e}"))?
            .ok_or_else(|| "No row returned while promoting memory".to_string())?;
        let memory = Self::decode_memory(&row)?;
        Self::log_event(
            db,
            run_id,
            memory.task_id,
            "memory_promoted",
            "info",
            serde_json::json!({
                "memory_id": memory.id,
                "requested_by_agent_id": requested_by_agent_id,
                "new_scope": memory.scope,
            }),
        )
        .await?;
        Ok(memory)
    }

    pub async fn list_stale_tasks(
        db: &DatabaseConnection,
        run_id: Uuid,
        stale_after_minutes: i64,
    ) -> Result<Vec<StaleTaskData>, String> {
        let stale_after_minutes = stale_after_minutes.clamp(1, 1440);
        let rows = db
            .query_all(Statement::from_sql_and_values(
                DatabaseBackend::Postgres,
                r#"
                    SELECT
                        t.id AS task_id,
                        t.title,
                        t.status,
                        t.last_heartbeat_at::text AS last_heartbeat_at,
                        CASE
                            WHEN t.last_heartbeat_at IS NULL THEN $2::bigint
                            ELSE GREATEST(
                                0,
                                FLOOR(EXTRACT(EPOCH FROM (NOW() - t.last_heartbeat_at)) / 60)
                            )::bigint
                        END AS minutes_since_heartbeat
                    FROM orchestration_tasks t
                    WHERE t.run_id = $1::uuid
                      AND t.status IN ('in_progress', 'waiting')
                      AND (
                        t.last_heartbeat_at IS NULL
                        OR t.last_heartbeat_at < NOW() - (($2::bigint || ' minutes')::interval)
                      )
                    ORDER BY t.last_heartbeat_at NULLS FIRST, t.updated_at ASC
                "#,
                vec![run_id.into(), stale_after_minutes.into()],
            ))
            .await
            .map_err(|e| format!("Failed listing stale orchestration tasks: {e}"))?;

        let mut out = Vec::with_capacity(rows.len());
        for row in rows {
            out.push(StaleTaskData {
                task_id: row
                    .try_get("", "task_id")
                    .map_err(|e| format!("Failed decoding stale task_id: {e}"))?,
                title: row
                    .try_get("", "title")
                    .map_err(|e| format!("Failed decoding stale title: {e}"))?,
                status: row
                    .try_get("", "status")
                    .map_err(|e| format!("Failed decoding stale status: {e}"))?,
                last_heartbeat_at: row
                    .try_get("", "last_heartbeat_at")
                    .map_err(|e| format!("Failed decoding stale last_heartbeat_at: {e}"))?,
                minutes_since_heartbeat: row
                    .try_get("", "minutes_since_heartbeat")
                    .map_err(|e| format!("Failed decoding stale minutes_since_heartbeat: {e}"))?,
            });
        }
        Ok(out)
    }

    pub async fn set_schedule(
        db: &DatabaseConnection,
        run_id: String,
        enabled: bool,
        interval_minutes: i32,
    ) -> Result<OrchestrationScheduleData, String> {
        let run_id = Uuid::parse_str(&run_id).map_err(|e| format!("Invalid run_id: {e}"))?;
        let interval_minutes = interval_minutes.clamp(1, 1440);
        let row = db
            .query_one(Statement::from_sql_and_values(
                DatabaseBackend::Postgres,
                r#"
                    INSERT INTO orchestration_schedules (
                        id,
                        run_id,
                        enabled,
                        interval_minutes,
                        next_run_at,
                        created_at,
                        updated_at
                    )
                    VALUES (
                        gen_random_uuid(),
                        $1::uuid,
                        $2::bool,
                        $3::int,
                        CASE WHEN $2::bool THEN NOW() + (($3::int || ' minutes')::interval) ELSE NULL END,
                        NOW(),
                        NOW()
                    )
                    ON CONFLICT (run_id)
                    DO UPDATE SET
                        enabled = EXCLUDED.enabled,
                        interval_minutes = EXCLUDED.interval_minutes,
                        next_run_at = CASE
                            WHEN EXCLUDED.enabled THEN NOW() + ((EXCLUDED.interval_minutes || ' minutes')::interval)
                            ELSE NULL
                        END,
                        updated_at = NOW()
                    RETURNING
                        id,
                        run_id,
                        enabled,
                        interval_minutes,
                        next_run_at::text AS next_run_at,
                        last_run_at::text AS last_run_at,
                        created_at::text AS created_at,
                        updated_at::text AS updated_at
                "#,
                vec![run_id.into(), enabled.into(), interval_minutes.into()],
            ))
            .await
            .map_err(|e| format!("Failed setting orchestration schedule: {e}"))?
            .ok_or_else(|| "No row returned while setting orchestration schedule".to_string())?;
        let schedule = Self::decode_schedule(&row)?;
        Self::log_event(
            db,
            schedule.run_id,
            None,
            "schedule_updated",
            "info",
            serde_json::json!({
                "enabled": schedule.enabled,
                "interval_minutes": schedule.interval_minutes,
                "next_run_at": schedule.next_run_at,
            }),
        )
        .await?;
        Ok(schedule)
    }

    pub async fn get_schedule(
        db: &DatabaseConnection,
        run_id: Uuid,
    ) -> Result<Option<OrchestrationScheduleData>, String> {
        let row = db
            .query_one(Statement::from_sql_and_values(
                DatabaseBackend::Postgres,
                r#"
                    SELECT
                        id,
                        run_id,
                        enabled,
                        interval_minutes,
                        next_run_at::text AS next_run_at,
                        last_run_at::text AS last_run_at,
                        created_at::text AS created_at,
                        updated_at::text AS updated_at
                    FROM orchestration_schedules
                    WHERE run_id = $1::uuid
                    LIMIT 1
                "#,
                vec![run_id.into()],
            ))
            .await
            .map_err(|e| format!("Failed loading orchestration schedule: {e}"))?;
        if let Some(row) = row {
            return Ok(Some(Self::decode_schedule(&row)?));
        }
        Ok(None)
    }

    pub async fn get_diagnostics(
        db: &DatabaseConnection,
        run_id: String,
        stale_after_minutes: Option<i64>,
    ) -> Result<OrchestrationDiagnostics, String> {
        let run_id = Uuid::parse_str(&run_id).map_err(|e| format!("Invalid run_id: {e}"))?;
        let run = Self::get_run(db, run_id.to_string()).await?;
        let rows = db
            .query_all(Statement::from_sql_and_values(
                DatabaseBackend::Postgres,
                r#"
                    SELECT status, COUNT(*)::bigint AS count
                    FROM orchestration_tasks
                    WHERE run_id = $1::uuid
                    GROUP BY status
                "#,
                vec![run_id.into()],
            ))
            .await
            .map_err(|e| format!("Failed loading orchestration task status counts: {e}"))?;

        let mut task_counts_by_status = HashMap::new();
        for row in rows {
            let status: String = row
                .try_get("", "status")
                .map_err(|e| format!("Failed decoding diagnostics status: {e}"))?;
            let count: i64 = row
                .try_get("", "count")
                .map_err(|e| format!("Failed decoding diagnostics count: {e}"))?;
            task_counts_by_status.insert(status, count);
        }

        let stale_tasks =
            Self::list_stale_tasks(db, run_id, stale_after_minutes.unwrap_or(10)).await?;

        let heartbeat_row = db
            .query_one(Statement::from_sql_and_values(
                DatabaseBackend::Postgres,
                r#"
                    SELECT MAX(updated_at)::text AS latest_heartbeat_at
                    FROM orchestration_heartbeats
                    WHERE run_id = $1::uuid
                "#,
                vec![run_id.into()],
            ))
            .await
            .map_err(|e| format!("Failed loading latest orchestration heartbeat: {e}"))?;
        let latest_heartbeat_at = if let Some(row) = heartbeat_row {
            row.try_get("", "latest_heartbeat_at")
                .map_err(|e| format!("Failed decoding latest_heartbeat_at: {e}"))?
        } else {
            None
        };

        let schedule = Self::get_schedule(db, run_id).await?;
        Ok(OrchestrationDiagnostics {
            run,
            task_counts_by_status,
            stale_tasks,
            latest_heartbeat_at,
            schedule,
        })
    }

    async fn release_due_retries(db: &DatabaseConnection, limit: i64) -> Result<i64, String> {
        let rows = db
            .query_all(Statement::from_sql_and_values(
                DatabaseBackend::Postgres,
                r#"
                    WITH due_tasks AS (
                        SELECT id
                        FROM orchestration_tasks
                        WHERE status = 'waiting'
                          AND next_retry_at IS NOT NULL
                          AND next_retry_at <= NOW()
                        ORDER BY next_retry_at ASC
                        LIMIT $1::bigint
                    )
                    UPDATE orchestration_tasks t
                    SET
                        status = 'queued',
                        next_retry_at = NULL,
                        updated_at = NOW()
                    FROM due_tasks d
                    WHERE t.id = d.id
                    RETURNING t.id AS task_id, t.run_id, t.attempt_count
                "#,
                vec![limit.clamp(1, 500).into()],
            ))
            .await
            .map_err(|e| format!("Failed releasing due retries: {e}"))?;
        for row in &rows {
            let run_id: Uuid = row
                .try_get("", "run_id")
                .map_err(|e| format!("Failed decoding retry release run_id: {e}"))?;
            let task_id: Uuid = row
                .try_get("", "task_id")
                .map_err(|e| format!("Failed decoding retry release task_id: {e}"))?;
            let attempt_count: i32 = row
                .try_get("", "attempt_count")
                .map_err(|e| format!("Failed decoding retry release attempt_count: {e}"))?;
            Self::log_event(
                db,
                run_id,
                Some(task_id),
                "task_retry_released",
                "info",
                serde_json::json!({
                    "task_id": task_id,
                    "attempt_count": attempt_count,
                }),
            )
            .await?;
        }
        Ok(rows.len() as i64)
    }

    pub async fn recover_incomplete_runs(db: &DatabaseConnection) -> Result<i64, String> {
        let rows = db
            .query_all(Statement::from_sql_and_values(
                DatabaseBackend::Postgres,
                r#"
                    SELECT id, status
                    FROM orchestration_runs
                    WHERE status IN ('planned', 'in_progress', 'waiting', 'paused')
                      AND completed_at IS NULL
                    ORDER BY updated_at DESC
                    LIMIT 100
                "#,
                vec![],
            ))
            .await
            .map_err(|e| format!("Failed loading incomplete runs for recovery: {e}"))?;
        for row in &rows {
            let run_id: Uuid = row
                .try_get("", "id")
                .map_err(|e| format!("Failed decoding recovery run_id: {e}"))?;
            let status: String = row
                .try_get("", "status")
                .map_err(|e| format!("Failed decoding recovery run status: {e}"))?;
            Self::log_event(
                db,
                run_id,
                None,
                "run_recovered_after_restart",
                "info",
                serde_json::json!({
                    "run_id": run_id,
                    "status": status,
                }),
            )
            .await?;
        }
        let _ = Self::release_due_retries(db, 100).await?;
        Ok(rows.len() as i64)
    }

    pub async fn run_scheduler_tick(db: &DatabaseConnection) -> Result<i64, String> {
        let released_retries = Self::release_due_retries(db, 100).await?;
        let due_rows = db
            .query_all(Statement::from_sql_and_values(
                DatabaseBackend::Postgres,
                r#"
                    SELECT
                        s.run_id
                    FROM orchestration_schedules s
                    JOIN orchestration_runs r ON r.id = s.run_id
                    WHERE s.enabled = true
                      AND s.next_run_at IS NOT NULL
                      AND s.next_run_at <= NOW()
                      AND r.status IN ('planned', 'in_progress', 'waiting')
                    ORDER BY s.next_run_at ASC
                    LIMIT 50
                "#,
                vec![],
            ))
            .await
            .map_err(|e| format!("Failed loading due orchestration schedules: {e}"))?;

        let stale_rows = db
            .query_all(Statement::from_sql_and_values(
                DatabaseBackend::Postgres,
                r#"
                    SELECT
                        t.id AS task_id,
                        t.run_id,
                        CASE
                            WHEN t.last_heartbeat_at IS NULL THEN 10::bigint
                            ELSE GREATEST(
                                0,
                                FLOOR(EXTRACT(EPOCH FROM (NOW() - t.last_heartbeat_at)) / 60)
                            )::bigint
                        END AS minutes_since_heartbeat
                    FROM orchestration_tasks t
                    JOIN orchestration_runs r ON r.id = t.run_id
                    WHERE r.status IN ('planned', 'in_progress', 'waiting')
                      AND t.status IN ('in_progress', 'waiting')
                      AND (
                          t.last_heartbeat_at IS NULL
                          OR t.last_heartbeat_at < NOW() - INTERVAL '10 minutes'
                      )
                    ORDER BY t.last_heartbeat_at NULLS FIRST, t.updated_at ASC
                    LIMIT 50
                "#,
                vec![],
            ))
            .await
            .map_err(|e| format!("Failed loading stale tasks during scheduler tick: {e}"))?;
        for stale_row in stale_rows {
            let run_id: Uuid = stale_row
                .try_get("", "run_id")
                .map_err(|e| format!("Failed decoding stale run_id: {e}"))?;
            let task_id: Uuid = stale_row
                .try_get("", "task_id")
                .map_err(|e| format!("Failed decoding stale task_id: {e}"))?;
            let minutes_since_heartbeat: i64 = stale_row
                .try_get("", "minutes_since_heartbeat")
                .map_err(|e| format!("Failed decoding stale minutes_since_heartbeat: {e}"))?;
            Self::log_event(
                db,
                run_id,
                Some(task_id),
                "stale_task_detected",
                "warning",
                serde_json::json!({
                    "task_id": task_id,
                    "minutes_since_heartbeat": minutes_since_heartbeat,
                }),
            )
            .await?;
        }

        let mut processed: i64 = released_retries;
        for row in due_rows {
            let run_id: Uuid = row
                .try_get("", "run_id")
                .map_err(|e| format!("Failed decoding scheduler run_id: {e}"))?;

            let counts_rows = db
                .query_all(Statement::from_sql_and_values(
                    DatabaseBackend::Postgres,
                    r#"
                        SELECT status, COUNT(*)::bigint AS count
                        FROM orchestration_tasks
                        WHERE run_id = $1::uuid
                        GROUP BY status
                    "#,
                    vec![run_id.into()],
                ))
                .await
                .map_err(|e| format!("Failed loading scheduler task counts: {e}"))?;
            let mut counts = serde_json::Map::new();
            for item in counts_rows {
                let status: String = item
                    .try_get("", "status")
                    .map_err(|e| format!("Failed decoding scheduler status: {e}"))?;
                let count: i64 = item
                    .try_get("", "count")
                    .map_err(|e| format!("Failed decoding scheduler count: {e}"))?;
                counts.insert(status, serde_json::json!(count));
            }

            db.execute(Statement::from_sql_and_values(
                DatabaseBackend::Postgres,
                r#"
                    INSERT INTO orchestration_events (
                        id,
                        run_id,
                        task_id,
                        event_type,
                        severity,
                        payload,
                        created_at
                    )
                    VALUES (
                        gen_random_uuid(),
                        $1::uuid,
                        NULL,
                        'scheduled_update',
                        'info',
                        $2::jsonb,
                        NOW()
                    )
                "#,
                vec![
                    run_id.into(),
                    serde_json::json!({
                        "kind": "scheduled_run_summary",
                        "task_counts": counts
                    })
                    .to_string()
                    .into(),
                ],
            ))
            .await
            .map_err(|e| format!("Failed inserting scheduler event: {e}"))?;

            db.execute(Statement::from_sql_and_values(
                DatabaseBackend::Postgres,
                r#"
                    UPDATE orchestration_schedules
                    SET
                        last_run_at = NOW(),
                        next_run_at = NOW() + ((interval_minutes || ' minutes')::interval),
                        updated_at = NOW()
                    WHERE run_id = $1::uuid
                "#,
                vec![run_id.into()],
            ))
            .await
            .map_err(|e| format!("Failed updating orchestration schedule next_run_at: {e}"))?;

            processed += 1;
        }

        let _ = db
            .query_one(Statement::from_sql_and_values(
                DatabaseBackend::Postgres,
                "SELECT purge_old_orchestration_events($1::int) AS deleted_count",
                vec![30.into()],
            ))
            .await
            .map_err(|e| format!("Failed running orchestration events retention purge: {e}"))?;

        Ok(processed)
    }
}

#[cfg(test)]
mod tests {
    use super::OrchestrationService;

    #[test]
    fn retry_backoff_is_exponential_and_capped() {
        assert_eq!(OrchestrationService::next_retry_backoff_seconds(1), 5);
        assert_eq!(OrchestrationService::next_retry_backoff_seconds(2), 10);
        assert_eq!(OrchestrationService::next_retry_backoff_seconds(3), 20);
        assert_eq!(OrchestrationService::next_retry_backoff_seconds(4), 40);
        assert_eq!(OrchestrationService::next_retry_backoff_seconds(9), 900);
        assert_eq!(OrchestrationService::next_retry_backoff_seconds(20), 900);
    }

    #[test]
    fn validates_run_task_transitions() {
        assert!(OrchestrationService::validate_transition(
            "queued", "planned"
        ));
        assert!(OrchestrationService::validate_transition(
            "planned",
            "in_progress"
        ));
        assert!(OrchestrationService::validate_transition(
            "failed", "queued"
        ));
        assert!(!OrchestrationService::validate_transition(
            "completed",
            "in_progress"
        ));
        assert!(!OrchestrationService::validate_transition(
            "queued",
            "completed"
        ));
    }

    #[test]
    fn validates_role_scope_and_action_categories() {
        assert!(OrchestrationService::is_valid_role("planner"));
        assert!(OrchestrationService::is_valid_role("custom"));
        assert!(!OrchestrationService::is_valid_role("owner"));

        assert!(OrchestrationService::is_valid_scope("private"));
        assert!(OrchestrationService::is_valid_scope("shared_run"));
        assert!(!OrchestrationService::is_valid_scope("global"));

        assert!(OrchestrationService::is_valid_action_category("research"));
        assert!(OrchestrationService::is_valid_action_category("custom"));
        assert!(!OrchestrationService::is_valid_action_category(
            "delete_all"
        ));
    }
}
