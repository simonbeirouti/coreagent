#![allow(dead_code)]
#![allow(clippy::too_many_arguments)]
#![allow(clippy::single_component_path_imports)]
#![allow(clippy::collapsible_match)]
#![allow(clippy::manual_range_contains)]
#![allow(clippy::redundant_closure)]

pub mod ability_service;
pub mod agent_service;
pub mod ai_client;
pub mod audio_service;
pub mod auth;
pub mod conversation_service;
pub mod db;
pub mod entities;
pub mod feedback_service;
pub mod file_read_service;
pub mod input_sanitizer;
pub mod memory_service;
pub mod orchestration_service;
pub mod perception_tracker;
pub mod rig_runtime;
pub mod runtime_sync_service;
pub mod skills_registry_client;
pub mod user_profile_service;
pub mod vision_service;

use ability_service::AbilityService;
use agent_service::{AgentService, CreateAgentRequest, UpdateAgentRequest};
use ai_client::AiClient;
use audio_service::{AudioService, RecordingResult};
use auth::{AuthState, SessionData};
use conversation_service::{ConversationService, CreateConversationRequest, TranscriptEntry};
use feedback_service::{
    AdaptationCycleData, FeedbackService, SubmitFeedbackRequest, TraitStateData,
};
use memory_service::{
    MemoryRetrievalQualitySummary, MemoryRetrievalTimeseriesPoint, MemoryService,
    RetrievalEvalResult, RetrievalTuningStatus, SimilarMessage,
};
use orchestration_service::{
    AgentDelegationData, AssignmentReviewData, CreateAgentDelegationRequest,
    CreateOrchestrationRunRequest, CreateOrchestrationTaskRequest, OrchestrationDiagnostics,
    OrchestrationHeartbeatData, OrchestrationEventData, OrchestrationMemoryData,
    OrchestrationRunData, OrchestrationScheduleData, OrchestrationService,
    OrchestrationTaskData, OrchestrationTaskDetailData, OrchestrationTaskFeedbackData,
    RecordDelegationRequest, UpsertHeartbeatRequest, UpsertOrchestrationMemoryRequest,
};
use perception_tracker::{PerceptionStat, PerceptionTracker};
use user_profile_service::UserProfileService;
use serde::{Deserialize, Serialize};
use sea_orm::{ConnectionTrait, DatabaseConnection, Statement};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use skills_registry_client::{
    AdvisoryFeedResponse, AdminArtifactUploadInput, AdminArtifactUploadResponse,
    AdminPublishSkillResponse, AdminSkillPreflightInput, AdminSkillPreflightResponse,
    AdminSkillPreflightStatusResponse,
    AdminSkillReviewInput, AdminSkillReviewResponse, AssignSkillInput, CreateRuntimeRunInput,
    InstallSkillInput, InstalledSkill, PermissionProfile, RegistryAgentSkill, RegistryAssignResponse,
    RegistryInstallResponse, RegistryPinResponse, RegistrySkillDetails, RegistrySkillSummary,
    RegistrySkillVersion, RegistryUninstallResponse, RuntimeExecutionMode, RuntimeHandshake,
    RuntimeRunSummary, SkillsRegistryClient,
};
use tauri::{ipc::Channel, Emitter, Manager};
use vision_service::{ScreenshotResult, VisionService};
use std::process::Command;
use std::path::Path;
use std::thread;
use std::time::Duration;
use tokio::time::sleep;
use runtime_sync_service::{
    RuntimeSyncAppState, RuntimeSyncDiagnostics, RuntimeSyncFreshness,
    ensure_runtime_sync_state_schema, get_runtime_sync_diagnostics,
    next_app_sleep_ms, next_control_sleep_ms, run_app_sync_tick, run_control_sync_tick,
    trigger_runtime_sync, write_failure_state,
};

const HANDSHAKE_CACHE_TTL_MS: i64 = 2 * 60 * 1000;
const CORE_RUNTIME_TOOL_KEYS: [&str; 6] = [
    "memory_retrieval",
    "vision_screenshot",
    "vision_analysis",
    "audio_transcription",
    "voice_synthesis",
    "attachment_read",
];

#[derive(Clone, Debug)]
struct CachedRuntimeHandshake {
    handshake: RuntimeHandshake,
    cached_at_ms: i64,
}

#[derive(Default)]
struct RuntimeHandshakeCacheState {
    by_skill_version: Arc<RwLock<HashMap<String, CachedRuntimeHandshake>>>,
}

impl RuntimeHandshakeCacheState {
    async fn get(&self, key: &str) -> Option<CachedRuntimeHandshake> {
        self.by_skill_version.read().await.get(key).cloned()
    }

    async fn put(&self, key: String, entry: CachedRuntimeHandshake) {
        self.by_skill_version.write().await.insert(key, entry);
    }

    async fn clear(&self) {
        self.by_skill_version.write().await.clear();
    }
}

fn runtime_handshake_cache_key(skill_id: &str, version: &str) -> String {
    format!("{skill_id}::{version}")
}

async fn ensure_tool_enabled(
    db: &DatabaseConnection,
    agent_id: &str,
    implementation_key: &str,
    auth_state: &AuthState,
    runtime_sync_state: &RuntimeSyncAppState,
    handshake_cache: &RuntimeHandshakeCacheState,
) -> Result<(), String> {
    let agent_uuid =
        uuid::Uuid::parse_str(agent_id).map_err(|e| format!("Invalid agent ID: {}", e))?;
    let runtime_tools = AbilityService::resolve_agent_runtime_tools(db, agent_uuid).await?;
    let enabled = runtime_tools
        .iter()
        .find(|tool| tool.implementation_key == implementation_key)
        .map(|tool| tool.enabled)
        .unwrap_or(true);

    if enabled {
        if is_core_tool_key(implementation_key) {
            return Ok(());
        }
        enforce_registry_runtime_gate(
            db,
            agent_id,
            implementation_key,
            auth_state,
            runtime_sync_state,
            handshake_cache,
        )
        .await
    } else {
        Err(format!(
            "Tool '{}' is disabled for this agent. Enable it from agent tools settings.",
            implementation_key
        ))
    }
}

fn is_core_tool_key(implementation_key: &str) -> bool {
    matches!(
        implementation_key,
        "memory_retrieval"
            | "vision_screenshot"
            | "vision_analysis"
            | "audio_transcription"
            | "voice_synthesis"
            | "attachment_read"
    )
}

fn parse_semver(value: &str) -> Option<(u64, u64, u64)> {
    let base = value.trim().split('-').next()?.split('+').next()?;
    let mut parts = base.split('.');
    let major = parts.next()?.parse::<u64>().ok()?;
    let minor = parts.next().unwrap_or("0").parse::<u64>().ok()?;
    let patch = parts.next().unwrap_or("0").parse::<u64>().ok()?;
    Some((major, minor, patch))
}

fn semver_outside_range(
    current: &str,
    min_version: Option<&str>,
    max_version: Option<&str>,
) -> Option<String> {
    let current_semver = parse_semver(current)?;
    if let Some(min) = min_version.and_then(parse_semver) {
        if current_semver < min {
            return Some(format!(
                "current app version {current} is below minimum supported version {}.{}.{}",
                min.0, min.1, min.2
            ));
        }
    }
    if let Some(max) = max_version.and_then(parse_semver) {
        if current_semver > max {
            return Some(format!(
                "current app version {current} is above maximum supported version {}.{}.{}",
                max.0, max.1, max.2
            ));
        }
    }
    None
}

fn is_runnable_install_state(state: Option<&str>) -> bool {
    matches!(state, Some("installed" | "ready"))
}

fn is_not_found_runtime_error(error: &str) -> bool {
    let normalized = error.to_ascii_lowercase();
    normalized.contains("(404)")
        || normalized.contains("not found")
        || normalized.contains("unknown skill")
}

fn is_local_runtime_unavailable_error(error: &str) -> bool {
    let normalized = error.to_ascii_lowercase();
    normalized.contains("local_docker")
        || normalized.contains("local docker")
        || normalized.contains("docker")
        || normalized.contains("daemon")
        || normalized.contains("connection refused")
        || normalized.contains("connection reset")
        || normalized.contains("is unavailable")
        || normalized.contains("runner unavailable")
        || normalized.contains("(503)")
}

fn validate_runtime_handshake_response(handshake: &RuntimeHandshake) -> Result<(), String> {
    if handshake.artifact.digest.trim().is_empty() {
        return Err("Registry runtime handshake missing artifact digest.".to_string());
    }
    if handshake.artifact.signature.trim().is_empty() {
        return Err("Registry runtime handshake missing artifact signature.".to_string());
    }
    if handshake.policy.status != "approved" {
        return Err(format!(
            "Skill runtime blocked: policy status is '{}'.",
            handshake.policy.status
        ));
    }
    if !handshake.install.installed {
        return Err("Skill runtime blocked: skill is not installed.".to_string());
    }
    if !is_runnable_install_state(handshake.install.install_state.as_deref()) {
        return Err("Skill runtime blocked: install state is not runnable.".to_string());
    }
    if handshake.force_disable.required {
        return Err(
            handshake
                .force_disable
                .reason
                .clone()
                .unwrap_or_else(|| "Skill runtime blocked by registry force-disable.".to_string()),
        );
    }
    if let Ok(app_runtime_version) = std::env::var("APP_RUNTIME_VERSION") {
        if !app_runtime_version.trim().is_empty() {
            let compatibility = &handshake.runtime.compatibility;
            if let Some(reason) = semver_outside_range(
                &app_runtime_version,
                compatibility.min_app_version.as_deref(),
                compatibility.max_app_version.as_deref(),
            ) {
                return Err(format!("Skill runtime blocked by compatibility range: {reason}"));
            }
        }
    }
    Ok(())
}

async fn enforce_registry_runtime_gate(
    db: &DatabaseConnection,
    agent_id: &str,
    implementation_key: &str,
    auth_state: &AuthState,
    runtime_sync_state: &RuntimeSyncAppState,
    handshake_cache: &RuntimeHandshakeCacheState,
) -> Result<(), String> {
    if CORE_RUNTIME_TOOL_KEYS.contains(&implementation_key) {
        return Ok(());
    }

    let client = SkillsRegistryClient::from_env()?;
    let token = SkillsRegistryClient::resolve_access_token(auth_state)?;
    let assigned = client.list_agent_skills(&token, agent_id).await?;
    let Some(skill) = assigned
        .into_iter()
        .find(|entry| entry.implementation_key == implementation_key)
    else {
        // Not a registry-managed tool assignment for this agent.
        return Ok(());
    };

    let diagnostics = get_runtime_sync_diagnostics(db, runtime_sync_state).await?;
    if diagnostics.freshness == RuntimeSyncFreshness::HardStale.as_str() {
        return Err(
            "Registry-managed runtime execution is temporarily blocked: advisory sync is hard-stale (>10m). Retry after sync recovers."
                .to_string(),
        );
    }
    if diagnostics.freshness == RuntimeSyncFreshness::SoftStale.as_str() {
        eprintln!(
            "[RUNTIME_SYNC] soft-stale advisory state detected (agent_id={}, implementation_key={})",
            agent_id, implementation_key
        );
    }

    if !is_runnable_install_state(skill.install_state.as_deref()) {
        return Err(format!(
            "Skill runtime blocked: registry install state is '{}'.",
            skill.install_state.unwrap_or_else(|| "unknown".to_string())
        ));
    }
    let Some(version) = skill.pinned_version else {
        return Err("Skill runtime blocked: no pinned registry version found.".to_string());
    };

    let cache_key = runtime_handshake_cache_key(&skill.skill_id, &version);
    let now_ms = chrono::Utc::now().timestamp_millis();
    if let Some(cached) = handshake_cache.get(&cache_key).await {
        let age_ms = now_ms.saturating_sub(cached.cached_at_ms);
        if age_ms < HANDSHAKE_CACHE_TTL_MS {
            return validate_runtime_handshake_response(&cached.handshake);
        }
    }

    match client.runtime_handshake(&token, &skill.skill_id, &version).await {
        Ok(handshake) => {
            validate_runtime_handshake_response(&handshake)?;
            handshake_cache
                .put(
                    cache_key,
                    CachedRuntimeHandshake {
                        handshake,
                        cached_at_ms: now_ms,
                    },
                )
                .await;
            Ok(())
        }
        Err(error) => {
            if diagnostics.freshness == RuntimeSyncFreshness::SoftStale.as_str() {
                if let Some(cached) = handshake_cache.get(&cache_key).await {
                    eprintln!(
                        "[RUNTIME_GATE] handshake refresh failed in soft-stale mode; using cached handshake: {}",
                        error
                    );
                    return validate_runtime_handshake_response(&cached.handshake);
                }
            }
            Err(error)
        }
    }
}

async fn ensure_registry_mutations_allowed(
    db: &DatabaseConnection,
    runtime_sync_state: &RuntimeSyncAppState,
    operation: &str,
) -> Result<(), String> {
    let diagnostics = get_runtime_sync_diagnostics(db, runtime_sync_state).await?;
    if diagnostics.freshness == RuntimeSyncFreshness::SoftStale.as_str()
        || diagnostics.freshness == RuntimeSyncFreshness::HardStale.as_str()
    {
        return Err(format!(
            "Registry update '{operation}' blocked while sync is degraded (freshness={}). Core tools remain available; retry after sync recovers.",
            diagnostics.freshness
        ));
    }
    Ok(())
}

fn execution_mode_from_preferences(preferences: &Value) -> RuntimeExecutionMode {
    match preferences
        .get("runtime_execution_mode")
        .and_then(|value| value.as_str())
        .unwrap_or("remote")
    {
        "local_docker" => RuntimeExecutionMode::LocalDocker,
        _ => RuntimeExecutionMode::Remote,
    }
}

async fn resolve_agent_execution_mode(
    db: &DatabaseConnection,
    agent_id: &str,
    auth_state: &AuthState,
) -> Result<RuntimeExecutionMode, String> {
    let session = auth_state
        .get_session()
        .ok_or_else(|| "No authenticated session found.".to_string())?;
    let session_user_id = uuid::Uuid::parse_str(&session.user_id)
        .map_err(|e| format!("Invalid session user ID: {e}"))?;

    let agent = AgentService::get_agent(db, agent_id.to_string()).await?;
    if agent.user_id != session_user_id {
        return Err("Agent does not belong to the authenticated user.".to_string());
    }

    let profile = UserProfileService::get_profile(db, agent.user_id.to_string())
        .await?
        .unwrap_or_else(|| user_profile_service::UserProfileData {
            id: uuid::Uuid::new_v4(),
            user_id: agent.user_id,
            preferences: serde_json::json!({}),
            habits: serde_json::json!({}),
            work_patterns: serde_json::json!({}),
            email: None,
            language: "en".to_string(),
            ai_response_language: "en".to_string(),
            notifications_enabled: true,
            analytics_enabled: false,
            created_at: chrono::Utc::now(),
            updated_at: chrono::Utc::now(),
        });
    let mode = execution_mode_from_preferences(&profile.preferences);
    eprintln!(
        "[RUNTIME_MODE] resolved mode={} agent_id={} user_id={}",
        match mode {
            RuntimeExecutionMode::Remote => "remote",
            RuntimeExecutionMode::LocalDocker => "local_docker",
        },
        agent_id,
        agent.user_id
    );
    Ok(mode)
}

async fn run_direct_runtime_skill(
    client: &SkillsRegistryClient,
    token: &str,
    agent_id: String,
    implementation_key: String,
    skill_id: String,
    version: String,
    input: Option<Value>,
    execution_mode: RuntimeExecutionMode,
    app: &tauri::AppHandle,
    client_run_id: Option<&str>,
) -> Result<DirectRuntimeToolRunResult, String> {
    let emit_progress = |message: String,
                         run_id: Option<String>,
                         status: Option<String>,
                         sequence: usize| {
        if let Some(client_run_id) = client_run_id {
            let _ = app.emit(
                "direct-runtime-tool-progress",
                DirectRuntimeToolProgressEvent {
                    client_run_id: client_run_id.to_string(),
                    implementation_key: implementation_key.clone(),
                    run_id,
                    status,
                    message,
                    sequence,
                    timestamp_ms: chrono::Utc::now().timestamp_millis(),
                },
            );
        }
    };

    let parsed_input = input.unwrap_or_else(|| serde_json::json!({}));
    let mut resolved_skill_id = skill_id.clone();
    let mut resolved_version = version.clone();
    let mut effective_execution_mode = execution_mode;
    let mut fallback_from: Option<RuntimeExecutionMode> = None;
    let base_run_input = CreateRuntimeRunInput {
        skill_id: resolved_skill_id.clone(),
        version: resolved_version.clone(),
        agent_id: Some(agent_id),
        input: parsed_input.clone(),
        execution_mode,
        timeout_seconds: 120,
    };
    let run = match client
        .create_runtime_run(token, base_run_input.clone())
        .await
    {
        Ok(run) => run,
        Err(error) if is_not_found_runtime_error(&error) => {
            let installed_skills = client.list_installed_skills(token).await?;
            let mapped = installed_skills
                .into_iter()
                .find(|entry| {
                    entry.implementation_key == implementation_key
                        && is_runnable_install_state(Some(entry.install_state.as_str()))
                })
                .ok_or_else(|| {
                    format!(
                        "Runtime tool '{implementation_key}' is not mapped to a runnable installed skill."
                    )
                })?;
            let fallback_version = mapped
                .pinned_version
                .clone()
                .unwrap_or_else(|| "latest".to_string());
            resolved_skill_id = mapped.skill_id.clone();
            resolved_version = fallback_version.clone();
            client
                .create_runtime_run(
                    token,
                    CreateRuntimeRunInput {
                        skill_id: resolved_skill_id.clone(),
                        version: resolved_version.clone(),
                        ..base_run_input
                    },
                )
                .await?
        }
        Err(error)
            if execution_mode == RuntimeExecutionMode::LocalDocker
                && is_local_runtime_unavailable_error(&error) =>
        {
            emit_progress(
                format!(
                    "Local Docker runtime unavailable; retrying in remote mode. Reason: {}",
                    error
                ),
                None,
                Some("running".to_string()),
                0,
            );
            fallback_from = Some(RuntimeExecutionMode::LocalDocker);
            effective_execution_mode = RuntimeExecutionMode::Remote;
            client
                .create_runtime_run(
                    token,
                    CreateRuntimeRunInput {
                        execution_mode: RuntimeExecutionMode::Remote,
                        ..base_run_input.clone()
                    },
                )
                .await
                .map_err(|remote_error| {
                    format!(
                        "Local Docker runtime unavailable ({error}); remote fallback failed: {remote_error}"
                    )
                })?
        }
        Err(error) => return Err(error),
    };

    emit_progress(
        format!(
            "Runtime run job received (skillId={}, executionMode={:?}).",
            resolved_skill_id, effective_execution_mode
        ),
        Some(run.run_id.clone()),
        Some("running".to_string()),
        0,
    );

    let mut cursor = 0usize;
    let mut log_messages = Vec::new();
    let mut final_run: RuntimeRunSummary = run.clone();
    let mut sequence = 1usize;
    for _ in 0..240 {
        if let Ok(events) = client
            .list_runtime_run_events(token, &run.run_id, cursor, 200)
            .await
        {
            let event_count = events.data.len();
            for event in events.data {
                if let Some(message) = event.message {
                    emit_progress(
                        message.clone(),
                        Some(run.run_id.clone()),
                        Some("running".to_string()),
                        sequence,
                    );
                    sequence += 1;
                    log_messages.push(message);
                }
            }
            cursor = events
                .page
                .next_cursor
                .as_deref()
                .and_then(|value| value.parse::<usize>().ok())
                .unwrap_or_else(|| cursor.saturating_add(event_count));
        }

        let current = client.get_runtime_run(token, &run.run_id).await?;
        let terminal = matches!(
            current.status.as_str(),
            "succeeded" | "failed" | "timed_out" | "cancelled"
        );
        final_run = current;
        if terminal {
            break;
        }
        sleep(Duration::from_millis(500)).await;
    }

    emit_progress(
        format!("Runtime run {}.", final_run.status),
        Some(final_run.run_id.clone()),
        Some(final_run.status.clone()),
        sequence,
    );

    Ok(DirectRuntimeToolRunResult {
        implementation_key,
        skill_id: resolved_skill_id,
        version: resolved_version,
        execution_mode: effective_execution_mode,
        fallback_from,
        run_id: final_run.run_id,
        status: final_run.status,
        output: final_run.output,
        error: final_run.error.map(|value| serde_json::json!(value)),
        log_messages,
    })
}

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
async fn set_session(
    session: SessionData,
    state: tauri::State<'_, AuthState>,
    db: tauri::State<'_, DatabaseConnection>,
    runtime_sync_state: tauri::State<'_, RuntimeSyncAppState>,
    handshake_cache: tauri::State<'_, RuntimeHandshakeCacheState>,
) -> Result<(), String> {
    state.set_session(session);

    // Best-effort startup bootstrap: warm installed-skills state once the backend
    // has an authenticated session, then run an immediate advisory sync.
    if let Ok(token) = SkillsRegistryClient::resolve_access_token(state.inner()) {
        if let Ok(client) = SkillsRegistryClient::from_env() {
            if let Err(error) = client.list_installed_skills(&token).await {
                eprintln!(
                    "[RUNTIME_SYNC] set_session bootstrap installed-skills sync failed: {}",
                    error
                );
            }
        }
    }

    match trigger_runtime_sync(
        &db,
        state.inner(),
        runtime_sync_state.inner(),
        "auth_session_set_bootstrap",
    )
    .await
    {
        Ok(run) => {
            if run.advisories_changed {
                handshake_cache.inner().clear().await;
            }
        }
        Err(error) => {
            eprintln!("[RUNTIME_SYNC] set_session bootstrap sync failed: {}", error);
            let _ = write_failure_state(&db, &error).await;
        }
    }

    Ok(())
}

#[tauri::command]
fn clear_session(state: tauri::State<AuthState>) -> Result<(), String> {
    state.clear_session();
    Ok(())
}

#[tauri::command]
fn verify_session(user_id: String, state: tauri::State<AuthState>) -> Result<bool, String> {
    match state.get_session() {
        Some(session) => Ok(session.user_id == user_id),
        None => Ok(false),
    }
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct SkillReviewPayload {
    review_status: String,
    summary: String,
    trusted_badge_eligible: bool,
    checks: Option<Value>,
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct SkillPreflightPayload {
    title: String,
    skill_id: Option<String>,
    ai_input: Option<String>,
    script_artifact_digest: String,
    example_artifact_digest: String,
    mode: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SkillsGraphSuggestionRequest {
    graph_json: Value,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SkillsGraphSuggestionEdge {
    source: String,
    target: String,
    label: String,
    rationale: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SkillsGraphSuggestionsResponse {
    proposed_nodes: Vec<Value>,
    proposed_edges: Vec<SkillsGraphSuggestionEdge>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SkillsGraphSnapshotResponse {
    owner_type: String,
    owner_id: String,
    version: i32,
    graph_json: Value,
    updated_at: Option<String>,
}

#[tauri::command]
async fn list_registry_skills(
    query: Option<String>,
    trusted_only: Option<bool>,
    auth_state: tauri::State<'_, AuthState>,
) -> Result<Vec<RegistrySkillSummary>, String> {
    let client = SkillsRegistryClient::from_env()?;
    let token = SkillsRegistryClient::resolve_access_token(&auth_state)?;
    client.list_skills(&token, query, trusted_only).await
}

#[tauri::command]
async fn list_registry_permission_profiles(
    auth_state: tauri::State<'_, AuthState>,
) -> Result<Vec<PermissionProfile>, String> {
    let client = SkillsRegistryClient::from_env()?;
    let token = SkillsRegistryClient::resolve_access_token(&auth_state)?;
    client.list_permission_profiles(&token).await
}

#[tauri::command]
async fn upload_registry_skill_artifact(
    artifact_base64: String,
    digest: Option<String>,
) -> Result<AdminArtifactUploadResponse, String> {
    let client = SkillsRegistryClient::from_env()?;
    let admin_token = SkillsRegistryClient::resolve_admin_token()?;
    client
        .upload_admin_artifact(
            &admin_token,
            AdminArtifactUploadInput {
                artifact_base64,
                digest,
            },
        )
        .await
}

#[tauri::command]
async fn dry_run_publish_registry_skill(
    payload: Value,
) -> Result<AdminPublishSkillResponse, String> {
    let client = SkillsRegistryClient::from_env()?;
    let admin_token = SkillsRegistryClient::resolve_admin_token()?;
    client
        .dry_run_publish_admin_skill(&admin_token, payload)
        .await
}

#[tauri::command]
async fn publish_registry_skill(payload: Value) -> Result<AdminPublishSkillResponse, String> {
    let client = SkillsRegistryClient::from_env()?;
    let admin_token = SkillsRegistryClient::resolve_admin_token()?;
    client.publish_admin_skill(&admin_token, payload).await
}

#[tauri::command]
async fn preflight_registry_skill(
    payload: SkillPreflightPayload,
) -> Result<AdminSkillPreflightResponse, String> {
    let client = SkillsRegistryClient::from_env()?;
    let admin_token = SkillsRegistryClient::resolve_admin_token()?;
    client
        .preflight_admin_skill(
            &admin_token,
            AdminSkillPreflightInput {
                title: payload.title,
                skill_id: payload.skill_id,
                ai_input: payload.ai_input,
                script_artifact_digest: payload.script_artifact_digest,
                example_artifact_digest: payload.example_artifact_digest,
                mode: payload.mode.unwrap_or_else(|| "local_docker".to_string()),
            },
        )
        .await
}

#[tauri::command]
async fn start_preflight_registry_skill(
    payload: SkillPreflightPayload,
) -> Result<AdminSkillPreflightStatusResponse, String> {
    let client = SkillsRegistryClient::from_env()?;
    let admin_token = SkillsRegistryClient::resolve_admin_token()?;
    client
        .start_preflight_admin_skill(
            &admin_token,
            AdminSkillPreflightInput {
                title: payload.title,
                skill_id: payload.skill_id,
                ai_input: payload.ai_input,
                script_artifact_digest: payload.script_artifact_digest,
                example_artifact_digest: payload.example_artifact_digest,
                mode: payload.mode.unwrap_or_else(|| "local_docker".to_string()),
            },
        )
        .await
}

#[tauri::command]
async fn get_preflight_registry_skill(run_id: String) -> Result<AdminSkillPreflightStatusResponse, String> {
    let client = SkillsRegistryClient::from_env()?;
    let admin_token = SkillsRegistryClient::resolve_admin_token()?;
    client.get_preflight_admin_skill(&admin_token, &run_id).await
}

#[tauri::command]
async fn review_registry_skill(
    skill_id: String,
    version: String,
    review: SkillReviewPayload,
) -> Result<AdminSkillReviewResponse, String> {
    let client = SkillsRegistryClient::from_env()?;
    let admin_token = SkillsRegistryClient::resolve_admin_token()?;
    client
        .review_admin_skill(
            &admin_token,
            &skill_id,
            &version,
            AdminSkillReviewInput {
                review_status: review.review_status,
                summary: review.summary,
                trusted_badge_eligible: review.trusted_badge_eligible,
                checks: review.checks.unwrap_or_else(|| serde_json::json!({})),
            },
        )
        .await
}

#[tauri::command]
async fn get_registry_skill(
    skill_id: String,
    auth_state: tauri::State<'_, AuthState>,
) -> Result<RegistrySkillDetails, String> {
    let client = SkillsRegistryClient::from_env()?;
    let token = SkillsRegistryClient::resolve_access_token(&auth_state)?;
    client.get_skill(&token, &skill_id).await
}

#[tauri::command]
async fn get_registry_skill_version(
    skill_id: String,
    version: String,
    auth_state: tauri::State<'_, AuthState>,
) -> Result<RegistrySkillVersion, String> {
    let client = SkillsRegistryClient::from_env()?;
    let token = SkillsRegistryClient::resolve_access_token(&auth_state)?;
    client.get_skill_version(&token, &skill_id, &version).await
}

#[tauri::command]
async fn list_installed_skills(
    auth_state: tauri::State<'_, AuthState>,
) -> Result<Vec<InstalledSkill>, String> {
    let client = SkillsRegistryClient::from_env()?;
    let token = SkillsRegistryClient::resolve_access_token(&auth_state)?;
    client.list_installed_skills(&token).await
}

#[tauri::command]
async fn install_registry_skill(
    skill_id: String,
    version: Option<String>,
    auto_update: Option<bool>,
    install_config: Option<serde_json::Value>,
    auth_state: tauri::State<'_, AuthState>,
    db: tauri::State<'_, DatabaseConnection>,
    runtime_sync_state: tauri::State<'_, RuntimeSyncAppState>,
    handshake_cache: tauri::State<'_, RuntimeHandshakeCacheState>,
) -> Result<RegistryInstallResponse, String> {
    ensure_registry_mutations_allowed(&db, runtime_sync_state.inner(), "install_registry_skill")
        .await?;
    let client = SkillsRegistryClient::from_env()?;
    let token = SkillsRegistryClient::resolve_access_token(&auth_state)?;
    let input = InstallSkillInput {
        version,
        auto_update: auto_update.unwrap_or(true),
        install_config: install_config.unwrap_or_else(|| serde_json::json!({})),
    };
    let response = client.install_skill(&token, &skill_id, input).await?;
    handshake_cache.inner().clear().await;
    if let Err(error) = trigger_runtime_sync(
        &db,
        &auth_state,
        runtime_sync_state.inner(),
        "install_registry_skill",
    )
    .await
    {
        let _ = write_failure_state(&db, &error).await;
    }
    Ok(response)
}

#[tauri::command]
async fn uninstall_registry_skill(
    skill_id: String,
    auth_state: tauri::State<'_, AuthState>,
    db: tauri::State<'_, DatabaseConnection>,
    runtime_sync_state: tauri::State<'_, RuntimeSyncAppState>,
    handshake_cache: tauri::State<'_, RuntimeHandshakeCacheState>,
) -> Result<RegistryUninstallResponse, String> {
    ensure_registry_mutations_allowed(
        &db,
        runtime_sync_state.inner(),
        "uninstall_registry_skill",
    )
    .await?;
    let client = SkillsRegistryClient::from_env()?;
    let token = SkillsRegistryClient::resolve_access_token(&auth_state)?;
    let response = client.uninstall_skill(&token, &skill_id).await?;
    handshake_cache.inner().clear().await;
    if let Err(error) = trigger_runtime_sync(
        &db,
        &auth_state,
        runtime_sync_state.inner(),
        "uninstall_registry_skill",
    )
    .await
    {
        let _ = write_failure_state(&db, &error).await;
    }
    Ok(response)
}

#[tauri::command]
async fn pin_registry_skill_version(
    skill_id: String,
    version: String,
    auth_state: tauri::State<'_, AuthState>,
    db: tauri::State<'_, DatabaseConnection>,
    runtime_sync_state: tauri::State<'_, RuntimeSyncAppState>,
    handshake_cache: tauri::State<'_, RuntimeHandshakeCacheState>,
) -> Result<RegistryPinResponse, String> {
    ensure_registry_mutations_allowed(
        &db,
        runtime_sync_state.inner(),
        "pin_registry_skill_version",
    )
    .await?;
    let client = SkillsRegistryClient::from_env()?;
    let token = SkillsRegistryClient::resolve_access_token(&auth_state)?;
    let response = client.pin_skill_version(&token, &skill_id, version).await?;
    handshake_cache.inner().clear().await;
    if let Err(error) = trigger_runtime_sync(
        &db,
        &auth_state,
        runtime_sync_state.inner(),
        "pin_registry_skill_version",
    )
    .await
    {
        let _ = write_failure_state(&db, &error).await;
    }
    Ok(response)
}

#[tauri::command]
async fn assign_registry_skill(
    skill_id: String,
    agent_id: String,
    enabled: Option<bool>,
    config: Option<serde_json::Value>,
    auth_state: tauri::State<'_, AuthState>,
    db: tauri::State<'_, DatabaseConnection>,
    runtime_sync_state: tauri::State<'_, RuntimeSyncAppState>,
    handshake_cache: tauri::State<'_, RuntimeHandshakeCacheState>,
) -> Result<RegistryAssignResponse, String> {
    ensure_registry_mutations_allowed(&db, runtime_sync_state.inner(), "assign_registry_skill")
        .await?;
    let client = SkillsRegistryClient::from_env()?;
    let token = SkillsRegistryClient::resolve_access_token(&auth_state)?;
    let input = AssignSkillInput {
        agent_id,
        enabled: enabled.unwrap_or(true),
        config: config.unwrap_or_else(|| serde_json::json!({})),
    };
    let response = client.assign_skill(&token, &skill_id, input).await?;
    handshake_cache.inner().clear().await;
    if let Err(error) = trigger_runtime_sync(
        &db,
        &auth_state,
        runtime_sync_state.inner(),
        "assign_registry_skill",
    )
    .await
    {
        let _ = write_failure_state(&db, &error).await;
    }
    Ok(response)
}

#[tauri::command]
async fn list_agent_registry_skills(
    agent_id: String,
    auth_state: tauri::State<'_, AuthState>,
) -> Result<Vec<RegistryAgentSkill>, String> {
    let client = SkillsRegistryClient::from_env()?;
    let token = SkillsRegistryClient::resolve_access_token(&auth_state)?;
    client.list_agent_skills(&token, &agent_id).await
}

#[tauri::command]
async fn sync_skill_advisories(
    cursor: Option<String>,
    limit: Option<i32>,
    auth_state: tauri::State<'_, AuthState>,
    db: tauri::State<'_, DatabaseConnection>,
    runtime_sync_state: tauri::State<'_, RuntimeSyncAppState>,
    handshake_cache: tauri::State<'_, RuntimeHandshakeCacheState>,
) -> Result<AdvisoryFeedResponse, String> {
    let client = SkillsRegistryClient::from_env()?;
    let token = SkillsRegistryClient::resolve_access_token(&auth_state)?;
    let response = client.advisory_feed(&token, cursor, limit).await?;
    if !response.data.is_empty() {
        handshake_cache.inner().clear().await;
    }
    if let Err(error) = trigger_runtime_sync(
        &db,
        &auth_state,
        runtime_sync_state.inner(),
        "sync_skill_advisories",
    )
    .await
    {
        let _ = write_failure_state(&db, &error).await;
    }
    Ok(response)
}

#[tauri::command]
async fn validate_skill_runtime(
    skill_id: String,
    version: String,
    auth_state: tauri::State<'_, AuthState>,
    db: tauri::State<'_, DatabaseConnection>,
    runtime_sync_state: tauri::State<'_, RuntimeSyncAppState>,
    handshake_cache: tauri::State<'_, RuntimeHandshakeCacheState>,
) -> Result<RuntimeHandshake, String> {
    let diagnostics = get_runtime_sync_diagnostics(&db, runtime_sync_state.inner()).await?;
    if diagnostics.freshness == RuntimeSyncFreshness::HardStale.as_str() {
        return Err(
            "Runtime validation blocked: advisory sync is hard-stale (>10m). Trigger sync and retry."
                .to_string(),
        );
    }
    let client = SkillsRegistryClient::from_env()?;
    let token = SkillsRegistryClient::resolve_access_token(&auth_state)?;
    let cache_key = runtime_handshake_cache_key(&skill_id, &version);
    if let Some(cached) = handshake_cache.inner().get(&cache_key).await {
        let age_ms = chrono::Utc::now()
            .timestamp_millis()
            .saturating_sub(cached.cached_at_ms);
        if age_ms < HANDSHAKE_CACHE_TTL_MS {
            validate_runtime_handshake_response(&cached.handshake)?;
            return Ok(cached.handshake);
        }
    }
    let handshake = client.runtime_handshake(&token, &skill_id, &version).await?;
    validate_runtime_handshake_response(&handshake)?;
    handshake_cache
        .inner()
        .put(
            cache_key,
            CachedRuntimeHandshake {
                handshake: handshake.clone(),
                cached_at_ms: chrono::Utc::now().timestamp_millis(),
            },
        )
        .await;
    Ok(handshake)
}

#[tauri::command]
async fn get_runtime_sync_diagnostics_command(
    db: tauri::State<'_, DatabaseConnection>,
    runtime_sync_state: tauri::State<'_, RuntimeSyncAppState>,
) -> Result<RuntimeSyncDiagnostics, String> {
    get_runtime_sync_diagnostics(&db, runtime_sync_state.inner()).await
}

#[tauri::command]
async fn trigger_runtime_sync_command(
    reason: Option<String>,
    db: tauri::State<'_, DatabaseConnection>,
    auth_state: tauri::State<'_, AuthState>,
    runtime_sync_state: tauri::State<'_, RuntimeSyncAppState>,
    handshake_cache: tauri::State<'_, RuntimeHandshakeCacheState>,
) -> Result<RuntimeSyncDiagnostics, String> {
    let run = trigger_runtime_sync(
        &db,
        &auth_state,
        runtime_sync_state.inner(),
        reason
            .as_deref()
            .unwrap_or("manual_runtime_sync_trigger"),
    )
    .await
    .inspect_err(|error| {
        eprintln!("[RUNTIME_SYNC] immediate sync failed: {}", error);
    })?;

    if run.advisories_changed {
        handshake_cache.inner().clear().await;
    }
    Ok(run.diagnostics)
}

#[tauri::command]
fn set_runtime_sync_app_visibility(
    is_foreground: bool,
    runtime_sync_state: tauri::State<'_, RuntimeSyncAppState>,
) -> Result<(), String> {
    runtime_sync_state.set_foreground(is_foreground);
    Ok(())
}

#[tauri::command]
async fn run_agent_runtime_tool(
    agent_id: String,
    implementation_key: String,
    input: Option<serde_json::Value>,
    client_run_id: Option<String>,
    db: tauri::State<'_, DatabaseConnection>,
    auth_state: tauri::State<'_, AuthState>,
    runtime_sync_state: tauri::State<'_, RuntimeSyncAppState>,
    handshake_cache: tauri::State<'_, RuntimeHandshakeCacheState>,
    app: tauri::AppHandle,
) -> Result<DirectRuntimeToolRunResult, String> {
    ensure_tool_enabled(
        &db,
        &agent_id,
        &implementation_key,
        auth_state.inner(),
        runtime_sync_state.inner(),
        handshake_cache.inner(),
    )
    .await?;

    let agent_uuid =
        uuid::Uuid::parse_str(&agent_id).map_err(|e| format!("Invalid agent ID: {}", e))?;
    let runtime_tools = AbilityService::resolve_agent_runtime_tools(&db, agent_uuid).await?;
    let tool = runtime_tools
        .into_iter()
        .find(|entry| entry.implementation_key == implementation_key && entry.enabled)
        .ok_or_else(|| {
            format!(
                "Tool '{}' is not enabled for this agent.",
                implementation_key
            )
        })?;

    let skill_id = tool
        .config
        .get("skill_id")
        .or_else(|| tool.config.get("skillId"))
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(&implementation_key)
        .to_string();
    let version = tool
        .config
        .get("version")
        .or_else(|| tool.config.get("skill_version"))
        .or_else(|| tool.config.get("skillVersion"))
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("latest")
        .to_string();

    let execution_mode = resolve_agent_execution_mode(&db, &agent_id, auth_state.inner()).await?;

    let token = SkillsRegistryClient::resolve_access_token(&auth_state)?;
    let client = SkillsRegistryClient::from_env()?;

    let result = run_direct_runtime_skill(
        &client,
        &token,
        agent_id,
        implementation_key,
        skill_id,
        version,
        input,
        execution_mode,
        &app,
        client_run_id.as_deref(),
    )
    .await;

    if result.is_ok() {
        if let Ok(sync_result) = trigger_runtime_sync(
            &db,
            &auth_state,
            runtime_sync_state.inner(),
            "run_agent_runtime_tool",
        )
        .await
        {
            if sync_result.advisories_changed {
                handshake_cache.inner().clear().await;
            }
        }
    }

    if let (Err(error), Some(client_run_id)) = (&result, &client_run_id) {
        let _ = app.emit(
            "direct-runtime-tool-progress",
            DirectRuntimeToolProgressEvent {
                client_run_id: client_run_id.clone(),
                implementation_key: "unknown".to_string(),
                run_id: None,
                status: Some("failed".to_string()),
                message: error.clone(),
                sequence: 0,
                timestamp_ms: chrono::Utc::now().timestamp_millis(),
            },
        );
    }

    result
}

#[tauri::command]
async fn run_registry_skill_direct(
    agent_id: String,
    skill_id: String,
    input: Option<serde_json::Value>,
    client_run_id: Option<String>,
    db: tauri::State<'_, DatabaseConnection>,
    auth_state: tauri::State<'_, AuthState>,
    runtime_sync_state: tauri::State<'_, RuntimeSyncAppState>,
    handshake_cache: tauri::State<'_, RuntimeHandshakeCacheState>,
    app: tauri::AppHandle,
) -> Result<DirectRuntimeToolRunResult, String> {
    let diagnostics = get_runtime_sync_diagnostics(&db, runtime_sync_state.inner()).await?;
    if diagnostics.freshness == RuntimeSyncFreshness::HardStale.as_str() {
        return Err(
            "Registry-managed runtime execution is temporarily blocked: advisory sync is hard-stale (>10m). Retry after sync recovers."
                .to_string(),
        );
    }
    let execution_mode = resolve_agent_execution_mode(&db, &agent_id, auth_state.inner()).await?;
    let token = SkillsRegistryClient::resolve_access_token(&auth_state)?;
    let client = SkillsRegistryClient::from_env()?;
    let installed_skills = client.list_installed_skills(&token).await?;

    let installed = installed_skills
        .into_iter()
        .find(|entry| entry.skill_id == skill_id)
        .ok_or_else(|| format!("Skill '{skill_id}' is not installed for this user."))?;

    if !is_runnable_install_state(Some(installed.install_state.as_str())) {
        return Err(format!(
            "Skill '{skill_id}' install state is '{}'.",
            installed.install_state
        ));
    }

    let version = installed
        .pinned_version
        .clone()
        .unwrap_or_else(|| "latest".to_string());

    let result = run_direct_runtime_skill(
        &client,
        &token,
        agent_id,
        installed.implementation_key,
        installed.skill_id,
        version,
        input,
        execution_mode,
        &app,
        client_run_id.as_deref(),
    )
    .await;

    if result.is_ok() {
        if let Ok(sync_result) = trigger_runtime_sync(
            &db,
            &auth_state,
            runtime_sync_state.inner(),
            "run_registry_skill_direct",
        )
        .await
        {
            if sync_result.advisories_changed {
                handshake_cache.inner().clear().await;
            }
        }
    }

    if let (Err(error), Some(client_run_id)) = (&result, &client_run_id) {
        let _ = app.emit(
            "direct-runtime-tool-progress",
            DirectRuntimeToolProgressEvent {
                client_run_id: client_run_id.clone(),
                implementation_key: "unknown".to_string(),
                run_id: None,
                status: Some("failed".to_string()),
                message: error.clone(),
                sequence: 0,
                timestamp_ms: chrono::Utc::now().timestamp_millis(),
            },
        );
    }

    result
}

// Agent commands
#[derive(Debug, Serialize, Deserialize)]
struct ProviderModelInfo {
    id: String,
    provider: String,
    display_name: String,
}

#[derive(Debug, Deserialize)]
struct OpenAiModelListResponse {
    data: Vec<OpenAiModelEntry>,
}

#[derive(Debug, Deserialize)]
struct OpenAiModelEntry {
    id: String,
}

#[derive(Debug, Deserialize)]
struct AnthropicModelListResponse {
    data: Vec<AnthropicModelEntry>,
}

#[derive(Debug, Deserialize)]
struct AnthropicModelEntry {
    id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct OrchestrationProjectData {
    id: uuid::Uuid,
    owner_user_id: uuid::Uuid,
    manager_agent_id: uuid::Uuid,
    run_id: uuid::Uuid,
    manager_conversation_id: Option<uuid::Uuid>,
    name: String,
    objective: String,
    status: String,
    manager_agent_name: String,
    manager_model_id: String,
    created_at: String,
    updated_at: String,
}

#[derive(Debug, Clone, Deserialize)]
struct CreateOrchestrationProjectRequest {
    manager_agent_id: String,
    name: String,
    objective: String,
    priority: Option<String>,
}

fn provider_model_fallback(provider_type: &str) -> Vec<ProviderModelInfo> {
    match provider_type {
        "openai" => vec![
            ProviderModelInfo {
                id: "gpt-5".to_string(),
                provider: "openai".to_string(),
                display_name: "gpt-5".to_string(),
            },
            ProviderModelInfo {
                id: "gpt-5-mini".to_string(),
                provider: "openai".to_string(),
                display_name: "gpt-5-mini".to_string(),
            },
            ProviderModelInfo {
                id: "gpt-5-nano".to_string(),
                provider: "openai".to_string(),
                display_name: "gpt-5-nano".to_string(),
            },
            ProviderModelInfo {
                id: "gpt-4.1".to_string(),
                provider: "openai".to_string(),
                display_name: "gpt-4.1".to_string(),
            },
        ],
        "anthropic" => vec![
            ProviderModelInfo {
                id: "claude-sonnet-4-5".to_string(),
                provider: "anthropic".to_string(),
                display_name: "claude-sonnet-4-5".to_string(),
            },
            ProviderModelInfo {
                id: "claude-sonnet-4".to_string(),
                provider: "anthropic".to_string(),
                display_name: "claude-sonnet-4".to_string(),
            },
            ProviderModelInfo {
                id: "claude-haiku-4-5".to_string(),
                provider: "anthropic".to_string(),
                display_name: "claude-haiku-4-5".to_string(),
            },
        ],
        _ => vec![],
    }
}

fn normalize_provider_model_list(
    provider_type: &str,
    raw_ids: Vec<String>,
) -> Vec<ProviderModelInfo> {
    let mut ids: Vec<String> = raw_ids
        .into_iter()
        .map(|id| id.trim().to_string())
        .filter(|id| {
            if provider_type == "openai" {
                id.starts_with("gpt-")
            } else {
                id.starts_with("claude")
            }
        })
        .collect();
    ids.sort();
    ids.dedup();
    ids.into_iter()
        .map(|id| ProviderModelInfo {
            display_name: id.clone(),
            id,
            provider: provider_type.to_string(),
        })
        .collect()
}

#[tauri::command]
async fn list_provider_models(provider_type: String) -> Result<Vec<ProviderModelInfo>, String> {
    let provider = provider_type.to_ascii_lowercase();
    if provider != "openai" && provider != "anthropic" {
        return Err("Unsupported provider type. Expected openai or anthropic.".to_string());
    }

    let client = reqwest::Client::new();
    let fetch_result: Result<Vec<ProviderModelInfo>, String> = if provider == "openai" {
        let api_key = std::env::var("OPENAI_API_KEY")
            .map_err(|_| "OPENAI_API_KEY not set in environment".to_string())?;
        let response = client
            .get("https://api.openai.com/v1/models")
            .header("Authorization", format!("Bearer {}", api_key))
            .send()
            .await
            .map_err(|error| format!("Failed fetching OpenAI models: {}", error))?;
        if !response.status().is_success() {
            return Err(format!(
                "OpenAI model listing failed with status {}",
                response.status()
            ));
        }
        let payload: OpenAiModelListResponse = response
            .json()
            .await
            .map_err(|error| format!("Invalid OpenAI models response: {}", error))?;
        Ok(normalize_provider_model_list(
            "openai",
            payload.data.into_iter().map(|entry| entry.id).collect(),
        ))
    } else {
        let api_key = std::env::var("ANTHROPIC_API_KEY")
            .map_err(|_| "ANTHROPIC_API_KEY not set in environment".to_string())?;
        let response = client
            .get("https://api.anthropic.com/v1/models")
            .header("x-api-key", api_key)
            .header("anthropic-version", "2023-06-01")
            .send()
            .await
            .map_err(|error| format!("Failed fetching Anthropic models: {}", error))?;
        if !response.status().is_success() {
            return Err(format!(
                "Anthropic model listing failed with status {}",
                response.status()
            ));
        }
        let payload: AnthropicModelListResponse = response
            .json()
            .await
            .map_err(|error| format!("Invalid Anthropic models response: {}", error))?;
        Ok(normalize_provider_model_list(
            "anthropic",
            payload.data.into_iter().map(|entry| entry.id).collect(),
        ))
    };

    match fetch_result {
        Ok(models) if !models.is_empty() => Ok(models),
        Ok(_) => Ok(provider_model_fallback(&provider)),
        Err(error) => {
            eprintln!("[MODELS] provider model listing fallback for {}: {}", provider, error);
            Ok(provider_model_fallback(&provider))
        }
    }
}

#[tauri::command]
async fn create_agent(
    request: CreateAgentRequest,
    db: tauri::State<'_, DatabaseConnection>,
) -> Result<agent_service::AgentData, String> {
    AgentService::create_agent(&db, request).await
}

#[tauri::command]
async fn list_agents(
    user_id: String,
    db: tauri::State<'_, DatabaseConnection>,
) -> Result<Vec<agent_service::AgentData>, String> {
    AgentService::list_agents(&db, user_id).await.map_err(|e| {
        eprintln!("[ERROR] list_agents failed: {}", e);
        e
    })
}

#[tauri::command]
async fn get_agent(
    agent_id: String,
    db: tauri::State<'_, DatabaseConnection>,
) -> Result<agent_service::AgentData, String> {
    AgentService::get_agent(&db, agent_id).await
}

#[tauri::command]
async fn update_agent(
    agent_id: String,
    updates: UpdateAgentRequest,
    db: tauri::State<'_, DatabaseConnection>,
) -> Result<agent_service::AgentData, String> {
    AgentService::update_agent(&db, agent_id, updates).await
}

#[tauri::command]
async fn delete_agent(
    agent_id: String,
    db: tauri::State<'_, DatabaseConnection>,
) -> Result<(), String> {
    AgentService::delete_agent(&db, agent_id).await
}

#[tauri::command]
async fn send_message_to_agent(
    agent_id: String,
    message: String,
    db: tauri::State<'_, DatabaseConnection>,
    ai_client: tauri::State<'_, AiClient>,
    auth_state: tauri::State<'_, AuthState>,
) -> Result<String, String> {
    // Simple one-shot message without conversation history
    let access_token = SkillsRegistryClient::resolve_access_token(&auth_state).ok();
    AgentService::send_message_to_agent(
        &db,
        agent_id,
        message,
        vec![],
        None,
        access_token.as_deref(),
        &ai_client,
    )
    .await
}

// Conversation commands
#[tauri::command]
async fn create_conversation(
    request: CreateConversationRequest,
    db: tauri::State<'_, DatabaseConnection>,
) -> Result<conversation_service::ConversationData, String> {
    ConversationService::create_conversation(&db, request).await
}

#[tauri::command]
async fn list_conversations(
    agent_id: String,
    db: tauri::State<'_, DatabaseConnection>,
) -> Result<Vec<conversation_service::ConversationData>, String> {
    ConversationService::list_conversations(&db, agent_id).await
}

#[tauri::command]
async fn get_conversation(
    conversation_id: String,
    db: tauri::State<'_, DatabaseConnection>,
) -> Result<conversation_service::ConversationData, String> {
    ConversationService::get_conversation(&db, conversation_id).await
}

#[tauri::command]
async fn get_conversation_messages(
    conversation_id: String,
    db: tauri::State<'_, DatabaseConnection>,
) -> Result<Vec<conversation_service::MessageData>, String> {
    ConversationService::get_conversation_messages(&db, conversation_id).await
}

#[tauri::command]
async fn send_message(
    conversation_id: String,
    content: String,
    image_base64: Option<String>,
    db: tauri::State<'_, DatabaseConnection>,
    ai_client: tauri::State<'_, AiClient>,
    auth_state: tauri::State<'_, AuthState>,
) -> Result<conversation_service::MessageData, String> {
    let access_token = SkillsRegistryClient::resolve_access_token(&auth_state).ok();
    let response =
        ConversationService::send_message(
            &db,
            conversation_id,
            content,
            image_base64,
            access_token.as_deref(),
            &ai_client,
        )
        .await?;
    // Track as a core conversation skill usage (best-effort).
    if let Ok(conversation) =
        ConversationService::get_conversation(&db, response.conversation_id.to_string()).await
    {
        let _ =
            AbilityService::track_ability_usage(&db, conversation.agent_id, "conversation", true)
                .await;
    }
    Ok(response)
}

#[tauri::command]
async fn send_message_streaming(
    conversation_id: String,
    content: String,
    image_base64: Option<String>,
    on_event: Channel<ai_client::StreamEvent>,
    db: tauri::State<'_, DatabaseConnection>,
    ai_client: tauri::State<'_, AiClient>,
    auth_state: tauri::State<'_, AuthState>,
) -> Result<conversation_service::MessageData, String> {
    let access_token = SkillsRegistryClient::resolve_access_token(&auth_state).ok();
    let response = ConversationService::send_message_streaming(
        &db,
        conversation_id,
        content,
        image_base64,
        access_token.as_deref(),
        on_event,
        &ai_client,
    )
    .await?;
    if let Ok(conversation) =
        ConversationService::get_conversation(&db, response.conversation_id.to_string()).await
    {
        let _ =
            AbilityService::track_ability_usage(&db, conversation.agent_id, "conversation", true)
                .await;
    }
    Ok(response)
}

#[tauri::command]
async fn update_conversation_title(
    conversation_id: String,
    title: Option<String>,
    db: tauri::State<'_, DatabaseConnection>,
) -> Result<conversation_service::ConversationData, String> {
    ConversationService::update_conversation_title(&db, conversation_id, title).await
}

#[tauri::command]
async fn generate_conversation_title(
    conversation_id: String,
    first_message: String,
    db: tauri::State<'_, DatabaseConnection>,
    ai_client: tauri::State<'_, AiClient>,
) -> Result<conversation_service::ConversationData, String> {
    ConversationService::generate_and_update_conversation_title(
        &db,
        conversation_id,
        first_message,
        &ai_client,
    )
    .await
}

#[tauri::command]
async fn save_voice_transcript(
    conversation_id: String,
    entries: Vec<TranscriptEntry>,
    db: tauri::State<'_, DatabaseConnection>,
) -> Result<Vec<conversation_service::MessageData>, String> {
    ConversationService::save_voice_transcript(&db, conversation_id, entries).await
}

#[tauri::command]
async fn delete_conversation(
    conversation_id: String,
    db: tauri::State<'_, DatabaseConnection>,
) -> Result<(), String> {
    ConversationService::delete_conversation(&db, conversation_id).await
}

#[tauri::command]
async fn delete_message(
    message_id: String,
    db: tauri::State<'_, DatabaseConnection>,
) -> Result<Vec<String>, String> {
    let deleted_ids = ConversationService::delete_message(&db, message_id).await?;
    // Convert UUIDs to strings for frontend
    Ok(deleted_ids.iter().map(|id| id.to_string()).collect())
}

#[tauri::command]
async fn edit_message(
    message_id: String,
    new_content: String,
    image_base64: Option<String>,
    db: tauri::State<'_, DatabaseConnection>,
    ai_client: tauri::State<'_, AiClient>,
    auth_state: tauri::State<'_, AuthState>,
) -> Result<
    (
        conversation_service::MessageData,
        conversation_service::MessageData,
    ),
    String,
> {
    let access_token = SkillsRegistryClient::resolve_access_token(&auth_state).ok();
    let result =
        ConversationService::edit_message(
            &db,
            message_id,
            new_content,
            image_base64,
            access_token.as_deref(),
            &ai_client,
        )
        .await?;
    if let Ok(conversation) =
        ConversationService::get_conversation(&db, result.0.conversation_id.to_string()).await
    {
        let _ =
            AbilityService::track_ability_usage(&db, conversation.agent_id, "conversation", true)
                .await;
    }
    Ok(result)
}

#[tauri::command]
async fn edit_message_streaming(
    message_id: String,
    new_content: String,
    image_base64: Option<String>,
    on_event: Channel<ai_client::StreamEvent>,
    db: tauri::State<'_, DatabaseConnection>,
    ai_client: tauri::State<'_, AiClient>,
    auth_state: tauri::State<'_, AuthState>,
) -> Result<
    (
        conversation_service::MessageData,
        conversation_service::MessageData,
    ),
    String,
> {
    let access_token = SkillsRegistryClient::resolve_access_token(&auth_state).ok();
    let result = ConversationService::edit_message_streaming(
        &db,
        message_id,
        new_content,
        image_base64,
        access_token.as_deref(),
        on_event,
        &ai_client,
    )
    .await?;
    if let Ok(conversation) =
        ConversationService::get_conversation(&db, result.0.conversation_id.to_string()).await
    {
        let _ =
            AbilityService::track_ability_usage(&db, conversation.agent_id, "conversation", true)
                .await;
    }
    Ok(result)
}

// Vision commands
#[tauri::command]
async fn capture_screenshot(
    agent_id: String,
    db: tauri::State<'_, DatabaseConnection>,
    auth_state: tauri::State<'_, AuthState>,
    runtime_sync_state: tauri::State<'_, RuntimeSyncAppState>,
    handshake_cache: tauri::State<'_, RuntimeHandshakeCacheState>,
    ai_client: tauri::State<'_, AiClient>,
    _app: tauri::AppHandle,
) -> Result<ScreenshotResult, String> {
    ensure_tool_enabled(
        &db,
        &agent_id,
        "vision_screenshot",
        auth_state.inner(),
        runtime_sync_state.inner(),
        handshake_cache.inner(),
    )
    .await?;
    let vision_service = VisionService::new(&ai_client);
    let result = vision_service.capture_screenshot().await?;

    // Track usage
    PerceptionTracker::track_usage(&db, &agent_id, "vision", "screenshot", None).await?;
    let agent_uuid =
        uuid::Uuid::parse_str(&agent_id).map_err(|e| format!("Invalid agent ID: {}", e))?;
    let _ = AbilityService::track_ability_usage(&db, agent_uuid, "vision_screenshot", true).await;

    // Note: Perception logging is done separately via log_screenshot_perception
    // after the frontend uploads the file to Supabase Storage

    Ok(result)
}

#[tauri::command]
async fn log_screenshot_perception(
    agent_id: String,
    storage_path: String,
    conversation_id: Option<String>,
    db: tauri::State<'_, DatabaseConnection>,
) -> Result<(), String> {
    // Log perception data with the actual uploaded storage path
    PerceptionTracker::log_perception(
        &db,
        &agent_id,
        conversation_id.as_deref(),
        "screenshot",
        &storage_path,
        None, // No analysis result yet
        None, // No duration for screenshots
    )
    .await?;

    Ok(())
}

#[tauri::command]
async fn analyze_image(
    agent_id: String,
    image_base64: String,
    prompt: Option<String>,
    db: tauri::State<'_, DatabaseConnection>,
    auth_state: tauri::State<'_, AuthState>,
    runtime_sync_state: tauri::State<'_, RuntimeSyncAppState>,
    handshake_cache: tauri::State<'_, RuntimeHandshakeCacheState>,
    ai_client: tauri::State<'_, AiClient>,
) -> Result<String, String> {
    ensure_tool_enabled(
        &db,
        &agent_id,
        "vision_analysis",
        auth_state.inner(),
        runtime_sync_state.inner(),
        handshake_cache.inner(),
    )
    .await?;
    let vision_service = VisionService::new(&ai_client);
    let analysis = vision_service
        .analyze_image_base64(&image_base64, prompt)
        .await?;

    // Track usage
    PerceptionTracker::track_usage(&db, &agent_id, "vision", "analyze", None).await?;
    let agent_uuid =
        uuid::Uuid::parse_str(&agent_id).map_err(|e| format!("Invalid agent ID: {}", e))?;
    let _ = AbilityService::track_ability_usage(&db, agent_uuid, "vision_analysis", true).await;

    Ok(analysis)
}

// Audio commands
#[tauri::command]
async fn start_recording(
    agent_id: String,
    db: tauri::State<'_, DatabaseConnection>,
    auth_state: tauri::State<'_, AuthState>,
    runtime_sync_state: tauri::State<'_, RuntimeSyncAppState>,
    handshake_cache: tauri::State<'_, RuntimeHandshakeCacheState>,
) -> Result<(), String> {
    ensure_tool_enabled(
        &db,
        &agent_id,
        "audio_transcription",
        auth_state.inner(),
        runtime_sync_state.inner(),
        handshake_cache.inner(),
    )
    .await?;
    // Track usage when starting recording
    PerceptionTracker::track_usage(&db, &agent_id, "audio", "start_recording", None).await?;

    // The actual recording start is handled by the frontend plugin
    Ok(())
}

#[tauri::command]
async fn stop_recording(
    _agent_id: String,
    _db: tauri::State<'_, DatabaseConnection>,
    _ai_client: tauri::State<'_, AiClient>,
    _app: tauri::AppHandle,
) -> Result<RecordingResult, String> {
    // This would get audio data from the mic recorder plugin
    // For now, return a placeholder - actual implementation needs frontend integration
    Err(
        "Audio recording stop not yet implemented - requires frontend plugin integration"
            .to_string(),
    )
}

#[tauri::command]
async fn transcribe_audio(
    agent_id: String,
    audio_base64: String,
    db: tauri::State<'_, DatabaseConnection>,
    auth_state: tauri::State<'_, AuthState>,
    runtime_sync_state: tauri::State<'_, RuntimeSyncAppState>,
    handshake_cache: tauri::State<'_, RuntimeHandshakeCacheState>,
    ai_client: tauri::State<'_, AiClient>,
) -> Result<String, String> {
    ensure_tool_enabled(
        &db,
        &agent_id,
        "audio_transcription",
        auth_state.inner(),
        runtime_sync_state.inner(),
        handshake_cache.inner(),
    )
    .await?;
    let audio_service = AudioService::new(&ai_client);

    // Simple transcription - audio upload/logging is handled by frontend
    let transcription = audio_service.transcribe_base64(&audio_base64, None).await?;

    // Track usage
    PerceptionTracker::track_usage(&db, &agent_id, "audio", "transcribe", None).await?;
    let agent_uuid =
        uuid::Uuid::parse_str(&agent_id).map_err(|e| format!("Invalid agent ID: {}", e))?;
    let _ = AbilityService::track_ability_usage(&db, agent_uuid, "audio_transcription", true).await;

    Ok(transcription)
}

#[tauri::command]
async fn log_audio_perception(
    agent_id: String,
    storage_path: String,
    transcription: Option<String>,
    duration_ms: Option<i32>,
    conversation_id: Option<String>,
    db: tauri::State<'_, DatabaseConnection>,
) -> Result<(), String> {
    // Track usage
    PerceptionTracker::track_usage(&db, &agent_id, "audio", "upload", None).await?;

    // Build analysis result with transcription if provided
    let analysis_result = transcription.map(|text| serde_json::json!({ "text": text }));

    // Log perception data with the storage path from frontend upload
    PerceptionTracker::log_perception(
        &db,
        &agent_id,
        conversation_id.as_deref(),
        "transcription",
        &storage_path,
        analysis_result,
        duration_ms,
    )
    .await?;

    Ok(())
}

#[tauri::command]
async fn text_to_speech(
    agent_id: String,
    text: String,
    voice: Option<String>,
    db: tauri::State<'_, DatabaseConnection>,
    auth_state: tauri::State<'_, AuthState>,
    runtime_sync_state: tauri::State<'_, RuntimeSyncAppState>,
    handshake_cache: tauri::State<'_, RuntimeHandshakeCacheState>,
    ai_client: tauri::State<'_, AiClient>,
) -> Result<String, String> {
    ensure_tool_enabled(
        &db,
        &agent_id,
        "voice_synthesis",
        auth_state.inner(),
        runtime_sync_state.inner(),
        handshake_cache.inner(),
    )
    .await?;
    let audio_service = AudioService::new(&ai_client);
    let audio_base64 = audio_service.text_to_speech_base64(&text, voice).await?;

    // Track usage
    PerceptionTracker::track_usage(&db, &agent_id, "audio", "tts", None).await?;
    let agent_uuid =
        uuid::Uuid::parse_str(&agent_id).map_err(|e| format!("Invalid agent ID: {}", e))?;
    let _ = AbilityService::track_ability_usage(&db, agent_uuid, "voice_synthesis", true).await;

    Ok(audio_base64)
}

// File reading command for audio files
#[tauri::command]
async fn read_audio_file(file_path: String) -> Result<String, String> {
    use base64::{engine::general_purpose, Engine as _};

    let bytes =
        std::fs::read(&file_path).map_err(|e| format!("Failed to read audio file: {}", e))?;

    Ok(general_purpose::STANDARD.encode(&bytes))
}

// OpenAI Realtime API token generation for Voice Chat feature (GA version)
#[tauri::command]
async fn get_realtime_session_token(voice: Option<String>) -> Result<String, String> {
    use serde_json::json;

    let api_key = std::env::var("OPENAI_API_KEY")
        .map_err(|_| "OPENAI_API_KEY environment variable not set".to_string())?;

    let voice_setting = voice.unwrap_or_else(|| "alloy".to_string());

    let client = reqwest::Client::new();

    // Use the GA endpoint: /v1/realtime/client_secrets
    let response = client
        .post("https://api.openai.com/v1/realtime/client_secrets")
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .json(&json!({
            "session": {
                "type": "realtime",
                "model": "gpt-realtime",
                "audio": {
                    "output": {
                        "voice": voice_setting
                    }
                }
            }
        }))
        .send()
        .await
        .map_err(|e| format!("Failed to request realtime session: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let error_text = response.text().await.unwrap_or_default();
        return Err(format!(
            "Realtime session request failed with status {}: {}",
            status, error_text
        ));
    }

    let body: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse realtime session response: {}", e))?;

    // The GA response has the token directly in "value" field
    let token = body
        .get("value")
        .and_then(|v| v.as_str())
        .ok_or_else(|| format!("No value in response: {:?}", body))?;

    Ok(token.to_string())
}

#[derive(Debug, Serialize)]
struct LocalDockerRuntimeStatus {
    available: bool,
    daemon_reachable: bool,
    image_present: bool,
    image: String,
    docker_version: Option<String>,
    message: String,
}

#[derive(Debug, Serialize)]
struct LocalDockerRuntimePrepareStatus {
    available: bool,
    daemon_reachable: bool,
    image_present: bool,
    image: String,
    docker_version: Option<String>,
    message: String,
    image_pulled: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DirectRuntimeToolRunResult {
    implementation_key: String,
    skill_id: String,
    version: String,
    execution_mode: RuntimeExecutionMode,
    fallback_from: Option<RuntimeExecutionMode>,
    run_id: String,
    status: String,
    output: Option<Value>,
    error: Option<Value>,
    log_messages: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DirectRuntimeToolProgressEvent {
    client_run_id: String,
    implementation_key: String,
    run_id: Option<String>,
    status: Option<String>,
    message: String,
    sequence: usize,
    timestamp_ms: i64,
}

fn resolve_docker_binary() -> Result<String, String> {
    let mut candidates: Vec<String> = Vec::new();

    if let Ok(configured) = std::env::var("COREAGENT_DOCKER_BIN") {
        let trimmed = configured.trim();
        if !trimmed.is_empty() {
            candidates.push(trimmed.to_string());
        }
    }

    candidates.push("/opt/homebrew/bin/docker".to_string());
    candidates.push("/usr/local/bin/docker".to_string());
    candidates.push("/Applications/Docker.app/Contents/Resources/bin/docker".to_string());
    candidates.push("docker".to_string());

    let mut attempted: Vec<String> = Vec::new();
    for candidate in candidates {
        if candidate == "docker" {
            match Command::new("docker").arg("--version").output() {
                Ok(output) if output.status.success() => return Ok("docker".to_string()),
                Ok(_) => attempted.push("docker (on PATH)".to_string()),
                Err(_) => attempted.push("docker (on PATH)".to_string()),
            }
            continue;
        }

        if Path::new(&candidate).exists() {
            return Ok(candidate);
        }
        attempted.push(candidate);
    }

    Err(format!(
        "Docker CLI was not found. Tried: {}. Install Docker Desktop and ensure docker is available.",
        attempted.join(", ")
    ))
}

fn collect_runtime_prepare_images(primary_image: &str) -> Vec<String> {
    let mut images: Vec<String> = vec![primary_image.trim().to_string()];
    if let Ok(value) = std::env::var("RUNTIME_LOCAL_DOCKER_IMAGE_PROFILES") {
        for entry in value.split(',').map(str::trim).filter(|entry| !entry.is_empty()) {
            let Some((_, image)) = entry.split_once('=') else {
                continue;
            };
            let trimmed = image.trim();
            if !trimmed.is_empty() {
                images.push(trimmed.to_string());
            }
        }
    }
    // Keep python runtime warm for coreagent.py.* skills when no profile map is configured.
    images.push("python:3.12-alpine".to_string());
    images.sort();
    images.dedup();
    images
}

fn run_docker_command(docker_bin: &str, args: &[&str]) -> Result<String, String> {
    let output = Command::new(docker_bin)
        .args(args)
        .output()
        .map_err(|e| format!("Failed to run docker command '{} {}': {}", docker_bin, args.join(" "), e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            format!("Docker command failed: '{} {}'", docker_bin, args.join(" "))
        } else {
            stderr
        });
    }

    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn check_local_docker_runtime_sync(image: String) -> LocalDockerRuntimeStatus {
    let image_to_use = if image.trim().is_empty() {
        "node:20-alpine".to_string()
    } else {
        image.trim().to_string()
    };

    let docker_bin = match resolve_docker_binary() {
        Ok(path) => path,
        Err(message) => {
            return LocalDockerRuntimeStatus {
                available: false,
                daemon_reachable: false,
                image_present: false,
                image: image_to_use,
                docker_version: None,
                message,
            }
        }
    };

    let version_result = run_docker_command(&docker_bin, &["--version"]);
    if let Err(error_message) = version_result {
        return LocalDockerRuntimeStatus {
            available: false,
            daemon_reachable: false,
            image_present: false,
            image: image_to_use,
            docker_version: None,
            message: format!(
                "Docker CLI was resolved at '{}' but could not be executed: {}",
                docker_bin, error_message
            ),
        };
    }

    let daemon_result = run_docker_command(&docker_bin, &["info", "--format", "{{.ServerVersion}}"]);
    let daemon_version = daemon_result.ok();
    if daemon_version.is_none() {
        return LocalDockerRuntimeStatus {
            available: true,
            daemon_reachable: false,
            image_present: false,
            image: image_to_use,
            docker_version: version_result.ok().map(|v| format!("{} ({})", v, docker_bin)),
            message: "Open docker in background".to_string(),
        };
    }

    let image_present = run_docker_command(&docker_bin, &["image", "inspect", &image_to_use]).is_ok();

    LocalDockerRuntimeStatus {
        available: true,
        daemon_reachable: true,
        image_present,
        image: image_to_use,
        docker_version: daemon_version.map(|v| format!("{} ({})", v, docker_bin)),
        message: if image_present {
            "Docker is running".to_string()
        } else {
            "Docker ready but local runtime image is missing.".to_string()
        },
    }
}

#[tauri::command]
async fn check_local_docker_runtime(image: Option<String>) -> Result<LocalDockerRuntimeStatus, String> {
    let target_image = image.unwrap_or_else(|| "node:20-alpine".to_string());
    tauri::async_runtime::spawn_blocking(move || check_local_docker_runtime_sync(target_image))
        .await
        .map_err(|e| format!("Docker runtime check task failed: {}", e))
}

#[tauri::command]
async fn prepare_local_docker_runtime(
    image: Option<String>,
) -> Result<LocalDockerRuntimePrepareStatus, String> {
    let target_image = image.unwrap_or_else(|| "node:20-alpine".to_string());
    tauri::async_runtime::spawn_blocking(move || {
        let docker_bin = resolve_docker_binary()?;
        let status = check_local_docker_runtime_sync(target_image.clone());
        if !status.available {
            return Err(status.message);
        }
        if !status.daemon_reachable {
            #[cfg(target_os = "macos")]
            {
                let _ = Command::new("open").args(["-a", "Docker"]).status();
                for _ in 0..20 {
                    thread::sleep(Duration::from_secs(1));
                    if run_docker_command(&docker_bin, &["info", "--format", "{{.ServerVersion}}"]).is_ok() {
                        break;
                    }
                }
            }
            let post_start_status = check_local_docker_runtime_sync(target_image.clone());
            if !post_start_status.daemon_reachable {
                return Err(post_start_status.message);
            }
        }

        let mut image_pulled = false;
        let mut resolved_status = check_local_docker_runtime_sync(target_image.clone());
        if !resolved_status.image_present {
            run_docker_command(&docker_bin, &["pull", &target_image])
                .map_err(|e| format!("Failed to pull Docker image '{}' via '{}': {}", target_image, docker_bin, e))?;
            image_pulled = true;
            resolved_status = check_local_docker_runtime_sync(target_image.clone());
        }

        for image in collect_runtime_prepare_images(&target_image) {
            if image == target_image {
                continue;
            }
            if run_docker_command(&docker_bin, &["image", "inspect", &image]).is_ok() {
                continue;
            }
            run_docker_command(&docker_bin, &["pull", &image])
                .map_err(|e| format!("Failed to pull Docker image '{}' via '{}': {}", image, docker_bin, e))?;
            image_pulled = true;
        }

        Ok(LocalDockerRuntimePrepareStatus {
            available: resolved_status.available,
            daemon_reachable: resolved_status.daemon_reachable,
            image_present: resolved_status.image_present,
            image: resolved_status.image,
            docker_version: resolved_status.docker_version,
            message: "Docker is running".to_string(),
            image_pulled,
        })
    })
    .await
    .map_err(|e| format!("Docker runtime prepare task failed: {}", e))?
}

// Stats command
#[tauri::command]
async fn get_perception_stats(
    agent_id: String,
    db: tauri::State<'_, DatabaseConnection>,
) -> Result<Vec<PerceptionStat>, String> {
    PerceptionTracker::get_stats(&db, &agent_id).await
}

fn resolve_skills_graph_owner(
    auth_state: &AuthState,
    owner_type: String,
    owner_id: Option<String>,
) -> Result<(String, uuid::Uuid, uuid::Uuid), String> {
    let session = auth_state
        .get_session()
        .ok_or_else(|| "No authenticated session found.".to_string())?;
    let session_user_id = uuid::Uuid::parse_str(&session.user_id)
        .map_err(|e| format!("Invalid session user ID: {e}"))?;
    let normalized_owner_type = owner_type.trim().to_ascii_lowercase();

    match normalized_owner_type.as_str() {
        "user" => {
            let resolved_owner = owner_id
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty())
                .unwrap_or_else(|| session.user_id.clone());
            let owner_uuid = uuid::Uuid::parse_str(&resolved_owner)
                .map_err(|e| format!("Invalid ownerId for user graph: {e}"))?;
            if owner_uuid != session_user_id {
                return Err("User graph access denied for this owner.".to_string());
            }
            Ok((normalized_owner_type, owner_uuid, session_user_id))
        }
        "team" => {
            let resolved_owner = owner_id
                .ok_or_else(|| "team ownerId is required.".to_string())?
                .trim()
                .to_string();
            let owner_uuid = uuid::Uuid::parse_str(&resolved_owner)
                .map_err(|e| format!("Invalid ownerId for team graph: {e}"))?;
            Ok((normalized_owner_type, owner_uuid, session_user_id))
        }
        "agent" => {
            let resolved_owner = owner_id
                .ok_or_else(|| "agent ownerId is required.".to_string())?
                .trim()
                .to_string();
            let owner_uuid = uuid::Uuid::parse_str(&resolved_owner)
                .map_err(|e| format!("Invalid ownerId for agent graph: {e}"))?;
            Ok((normalized_owner_type, owner_uuid, session_user_id))
        }
        _ => Err("ownerType must be either 'user', 'team', or 'agent'.".to_string()),
    }
}

fn resolve_session_user_uuid(auth_state: &AuthState) -> Result<uuid::Uuid, String> {
    let session = auth_state
        .get_session()
        .ok_or_else(|| "No authenticated session found.".to_string())?;
    uuid::Uuid::parse_str(&session.user_id).map_err(|e| format!("Invalid session user ID: {e}"))
}

async fn ensure_orchestration_run_owned_by_session(
    db: &DatabaseConnection,
    run_id: &str,
    session_user_id: uuid::Uuid,
) -> Result<(), String> {
    let run_id =
        uuid::Uuid::parse_str(run_id).map_err(|e| format!("Invalid run ID: {e}"))?;
    let row = db
        .query_one(Statement::from_sql_and_values(
            db.get_database_backend(),
            r#"
                SELECT 1
                FROM orchestration_runs
                WHERE id = $1::uuid
                  AND owner_user_id = $2::uuid
                LIMIT 1
            "#,
            vec![run_id.into(), session_user_id.into()],
        ))
        .await
        .map_err(|e| format!("Failed validating orchestration run ownership: {e}"))?;
    if row.is_none() {
        return Err("Orchestration run is not owned by the authenticated session.".to_string());
    }
    Ok(())
}

async fn ensure_orchestration_task_owned_by_session(
    db: &DatabaseConnection,
    task_id: &str,
    session_user_id: uuid::Uuid,
) -> Result<(), String> {
    let task_id =
        uuid::Uuid::parse_str(task_id).map_err(|e| format!("Invalid task ID: {e}"))?;
    let row = db
        .query_one(Statement::from_sql_and_values(
            db.get_database_backend(),
            r#"
                SELECT 1
                FROM orchestration_tasks t
                JOIN orchestration_runs r ON r.id = t.run_id
                WHERE t.id = $1::uuid
                  AND r.owner_user_id = $2::uuid
                LIMIT 1
            "#,
            vec![task_id.into(), session_user_id.into()],
        ))
        .await
        .map_err(|e| format!("Failed validating orchestration task ownership: {e}"))?;
    if row.is_none() {
        return Err("Orchestration task is not owned by the authenticated session.".to_string());
    }
    Ok(())
}

async fn ensure_orchestration_memory_owned_by_session(
    db: &DatabaseConnection,
    memory_id: &str,
    session_user_id: uuid::Uuid,
) -> Result<(), String> {
    let memory_id =
        uuid::Uuid::parse_str(memory_id).map_err(|e| format!("Invalid memory ID: {e}"))?;
    let row = db
        .query_one(Statement::from_sql_and_values(
            db.get_database_backend(),
            r#"
                SELECT 1
                FROM orchestration_memories m
                JOIN orchestration_runs r ON r.id = m.run_id
                WHERE m.id = $1::uuid
                  AND r.owner_user_id = $2::uuid
                LIMIT 1
            "#,
            vec![memory_id.into(), session_user_id.into()],
        ))
        .await
        .map_err(|e| format!("Failed validating orchestration memory ownership: {e}"))?;
    if row.is_none() {
        return Err("Orchestration memory is not owned by the authenticated session.".to_string());
    }
    Ok(())
}

fn map_project_row(
    row: sea_orm::QueryResult,
) -> Result<OrchestrationProjectData, String> {
    let id: uuid::Uuid = row
        .try_get("", "id")
        .map_err(|e| format!("Failed decoding project id: {e}"))?;
    let owner_user_id: uuid::Uuid = row
        .try_get("", "owner_user_id")
        .map_err(|e| format!("Failed decoding project owner_user_id: {e}"))?;
    let manager_agent_id: uuid::Uuid = row
        .try_get("", "manager_agent_id")
        .map_err(|e| format!("Failed decoding project manager_agent_id: {e}"))?;
    let run_id: uuid::Uuid = row
        .try_get("", "run_id")
        .map_err(|e| format!("Failed decoding project run_id: {e}"))?;
    let manager_conversation_id: Option<uuid::Uuid> = row
        .try_get("", "manager_conversation_id")
        .map_err(|e| format!("Failed decoding project manager_conversation_id: {e}"))?;
    let name: String = row
        .try_get("", "name")
        .map_err(|e| format!("Failed decoding project name: {e}"))?;
    let objective: String = row
        .try_get("", "objective")
        .map_err(|e| format!("Failed decoding project objective: {e}"))?;
    let status: String = row
        .try_get("", "status")
        .map_err(|e| format!("Failed decoding project status: {e}"))?;
    let manager_agent_name: String = row
        .try_get("", "manager_agent_name")
        .map_err(|e| format!("Failed decoding project manager_agent_name: {e}"))?;
    let manager_model_id: String = row
        .try_get("", "manager_model_id")
        .map_err(|e| format!("Failed decoding project manager_model_id: {e}"))?;
    let created_at: String = row
        .try_get("", "created_at")
        .map_err(|e| format!("Failed decoding project created_at: {e}"))?;
    let updated_at: String = row
        .try_get("", "updated_at")
        .map_err(|e| format!("Failed decoding project updated_at: {e}"))?;

    Ok(OrchestrationProjectData {
        id,
        owner_user_id,
        manager_agent_id,
        run_id,
        manager_conversation_id,
        name,
        objective,
        status,
        manager_agent_name,
        manager_model_id,
        created_at,
        updated_at,
    })
}

async fn get_project_by_id_for_owner(
    db: &DatabaseConnection,
    project_id: uuid::Uuid,
    owner_user_id: uuid::Uuid,
) -> Result<Option<OrchestrationProjectData>, String> {
    let row = db
        .query_one(Statement::from_sql_and_values(
            db.get_database_backend(),
            r#"
                SELECT
                    p.id,
                    p.owner_user_id,
                    p.manager_agent_id,
                    p.root_run_id AS run_id,
                    p.manager_conversation_id,
                    p.name,
                    p.objective,
                    p.status,
                    a.name AS manager_agent_name,
                    a.model_id AS manager_model_id,
                    p.created_at::text AS created_at,
                    p.updated_at::text AS updated_at
                FROM orchestration_projects p
                JOIN agents a ON a.id = p.manager_agent_id
                WHERE p.id = $1::uuid
                  AND p.owner_user_id = $2::uuid
                LIMIT 1
            "#,
            vec![project_id.into(), owner_user_id.into()],
        ))
        .await
        .map_err(|e| format!("Failed loading project by id: {e}"))?;

    match row {
        Some(row) => Ok(Some(map_project_row(row)?)),
        None => Ok(None),
    }
}

#[tauri::command]
async fn load_skills_graph(
    owner_type: String,
    owner_id: Option<String>,
    auth_state: tauri::State<'_, AuthState>,
    db: tauri::State<'_, DatabaseConnection>,
) -> Result<SkillsGraphSnapshotResponse, String> {
    let (resolved_owner_type, resolved_owner_id, session_user_id) =
        resolve_skills_graph_owner(auth_state.inner(), owner_type, owner_id)?;
    let row = db
        .query_one(Statement::from_sql_and_values(
            db.get_database_backend(),
            r#"
                SELECT
                  owner_type,
                  owner_id,
                  version,
                  graph_jsonb,
                  updated_at::text AS updated_at
                FROM skills_graphs
                WHERE owner_type = $1::text
                  AND owner_id = $2::uuid
                  AND (
                    (owner_type = 'user' AND owner_id = $3::uuid)
                    OR (owner_type = 'team' AND created_by_user_id = $3::uuid)
                    OR (
                      owner_type = 'agent'
                      AND EXISTS (
                        SELECT 1
                        FROM agents a
                        WHERE a.id = owner_id
                          AND a.user_id = $3::uuid
                      )
                    )
                  )
                LIMIT 1
            "#,
            vec![
                resolved_owner_type.clone().into(),
                resolved_owner_id.into(),
                session_user_id.into(),
            ],
        ))
        .await
        .map_err(|e| format!("Failed loading skills graph: {e}"))?;

    if let Some(row) = row {
        let graph_json: Value = row
            .try_get("", "graph_jsonb")
            .map_err(|e| format!("Failed decoding graph_jsonb: {e}"))?;
        let version: i32 = row
            .try_get("", "version")
            .map_err(|e| format!("Failed decoding version: {e}"))?;
        let updated_at: Option<String> = row
            .try_get("", "updated_at")
            .map_err(|e| format!("Failed decoding updated_at: {e}"))?;
        return Ok(SkillsGraphSnapshotResponse {
            owner_type: resolved_owner_type,
            owner_id: resolved_owner_id.to_string(),
            version,
            graph_json,
            updated_at,
        });
    }

    Ok(SkillsGraphSnapshotResponse {
        owner_type: resolved_owner_type,
        owner_id: resolved_owner_id.to_string(),
        version: 0,
        graph_json: serde_json::json!({ "nodes": [], "edges": [], "viewport": {} }),
        updated_at: None,
    })
}

#[tauri::command]
async fn save_skills_graph(
    owner_type: String,
    owner_id: Option<String>,
    graph_json: Value,
    auth_state: tauri::State<'_, AuthState>,
    db: tauri::State<'_, DatabaseConnection>,
) -> Result<SkillsGraphSnapshotResponse, String> {
    let (resolved_owner_type, resolved_owner_id, session_user_id) =
        resolve_skills_graph_owner(auth_state.inner(), owner_type, owner_id)?;

    if resolved_owner_type == "agent" {
        let allowed = db
            .query_one(Statement::from_sql_and_values(
                db.get_database_backend(),
                r#"
                    SELECT 1
                    FROM agents
                    WHERE id = $1::uuid
                      AND user_id = $2::uuid
                    LIMIT 1
                "#,
                vec![resolved_owner_id.into(), session_user_id.into()],
            ))
            .await
            .map_err(|e| format!("Failed validating agent ownership for graph save: {e}"))?
            .is_some();
        if !allowed {
            return Err("Agent graph access denied for this owner.".to_string());
        }
    }

    let row = db
        .query_one(Statement::from_sql_and_values(
            db.get_database_backend(),
            r#"
                INSERT INTO skills_graphs (
                  id,
                  owner_type,
                  owner_id,
                  graph_jsonb,
                  version,
                  created_by_user_id,
                  created_at,
                  updated_at
                )
                VALUES (
                  gen_random_uuid(),
                  $1::text,
                  $2::uuid,
                  $3::jsonb,
                  1,
                  $4::uuid,
                  NOW(),
                  NOW()
                )
                ON CONFLICT (owner_type, owner_id)
                DO UPDATE SET
                  graph_jsonb = EXCLUDED.graph_jsonb,
                  version = skills_graphs.version + 1,
                  updated_at = NOW()
                RETURNING
                  owner_type,
                  owner_id,
                  version,
                  graph_jsonb,
                  updated_at::text AS updated_at
            "#,
            vec![
                resolved_owner_type.clone().into(),
                resolved_owner_id.into(),
                graph_json.into(),
                session_user_id.into(),
            ],
        ))
        .await
        .map_err(|e| format!("Failed saving skills graph: {e}"))?
        .ok_or_else(|| "No row returned after saving skills graph.".to_string())?;

    let saved_graph_json: Value = row
        .try_get("", "graph_jsonb")
        .map_err(|e| format!("Failed decoding saved graph_jsonb: {e}"))?;
    let version: i32 = row
        .try_get("", "version")
        .map_err(|e| format!("Failed decoding saved version: {e}"))?;
    let updated_at: Option<String> = row
        .try_get("", "updated_at")
        .map_err(|e| format!("Failed decoding saved updated_at: {e}"))?;

    Ok(SkillsGraphSnapshotResponse {
        owner_type: resolved_owner_type,
        owner_id: resolved_owner_id.to_string(),
        version,
        graph_json: saved_graph_json,
        updated_at,
    })
}

#[tauri::command]
async fn suggest_skills_graph_connections(
    request: SkillsGraphSuggestionRequest,
) -> Result<SkillsGraphSuggestionsResponse, String> {
    let nodes = request
        .graph_json
        .get("nodes")
        .and_then(|value| value.as_array())
        .cloned()
        .unwrap_or_default();
    let edges = request
        .graph_json
        .get("edges")
        .and_then(|value| value.as_array())
        .cloned()
        .unwrap_or_default();

    let mut existing_pairs = std::collections::HashSet::new();
    for edge in edges {
        let source = edge.get("source").and_then(|value| value.as_str());
        let target = edge.get("target").and_then(|value| value.as_str());
        if let (Some(source), Some(target)) = (source, target) {
            existing_pairs.insert(format!("{source}->{target}"));
        }
    }

    let mut proposed_edges = Vec::new();
    for pair in nodes.windows(2) {
        let source = pair[0].get("id").and_then(|value| value.as_str());
        let target = pair[1].get("id").and_then(|value| value.as_str());
        let source_label = pair[0]
            .get("data")
            .and_then(|value| value.get("label"))
            .and_then(|value| value.as_str())
            .unwrap_or("source skill");
        let target_label = pair[1]
            .get("data")
            .and_then(|value| value.get("label"))
            .and_then(|value| value.as_str())
            .unwrap_or("target skill");
        if let (Some(source), Some(target)) = (source, target) {
            let key = format!("{source}->{target}");
            if existing_pairs.contains(&key) {
                continue;
            }
            proposed_edges.push(SkillsGraphSuggestionEdge {
                source: source.to_string(),
                target: target.to_string(),
                label: "related".to_string(),
                rationale: format!(
                    "Suggested link between '{}' and '{}' based on adjacency in the current graph.",
                    source_label, target_label
                ),
            });
        }
    }

    Ok(SkillsGraphSuggestionsResponse {
        proposed_nodes: Vec::new(),
        proposed_edges,
    })
}

// User profile commands
#[tauri::command]
async fn get_user_profile(
    user_id: String,
    db: tauri::State<'_, DatabaseConnection>,
) -> Result<user_profile_service::UserProfileData, String> {
    user_profile_service::UserProfileService::get_or_create_profile(&db, user_id).await
}

#[tauri::command]
async fn update_user_profile(
    user_id: String,
    updates: user_profile_service::UpdateUserProfileRequest,
    db: tauri::State<'_, DatabaseConnection>,
) -> Result<user_profile_service::UserProfileData, String> {
    user_profile_service::UserProfileService::update_profile(&db, user_id, updates).await
}

#[tauri::command]
async fn list_agent_abilities(
    agent_id: String,
    db: tauri::State<'_, DatabaseConnection>,
) -> Result<Vec<ability_service::AgentAbilityData>, String> {
    AbilityService::list_agent_abilities(&db, agent_id).await
}

#[tauri::command]
async fn list_agent_tool_settings(
    agent_id: String,
    db: tauri::State<'_, DatabaseConnection>,
) -> Result<Vec<ability_service::AgentToolSettingData>, String> {
    AbilityService::list_agent_tool_settings(&db, agent_id).await
}

#[tauri::command]
async fn set_agent_ability_enabled(
    agent_id: String,
    implementation_key: String,
    enabled: bool,
    db: tauri::State<'_, DatabaseConnection>,
) -> Result<ability_service::AgentToolSettingData, String> {
    AbilityService::set_agent_ability_enabled(&db, agent_id, implementation_key, enabled).await
}

#[tauri::command]
async fn update_agent_ability_config(
    agent_id: String,
    implementation_key: String,
    config: serde_json::Value,
    db: tauri::State<'_, DatabaseConnection>,
) -> Result<ability_service::AgentToolSettingData, String> {
    AbilityService::update_agent_ability_config(&db, agent_id, implementation_key, config).await
}

#[tauri::command]
async fn get_agent_skill_ratings(
    agent_id: String,
    db: tauri::State<'_, DatabaseConnection>,
) -> Result<Vec<ability_service::SkillPerformanceRatingData>, String> {
    AbilityService::get_agent_skill_ratings(&db, agent_id).await
}

#[tauri::command]
async fn get_agent_skill_rating_trends(
    agent_id: String,
    days: Option<i32>,
    db: tauri::State<'_, DatabaseConnection>,
) -> Result<Vec<ability_service::SkillRatingTrendSeries>, String> {
    AbilityService::get_agent_skill_rating_trends(&db, agent_id, days.unwrap_or(14)).await
}

#[tauri::command]
async fn get_relevant_memories(
    agent_id: String,
    query: String,
    conversation_id: Option<String>,
    db: tauri::State<'_, DatabaseConnection>,
) -> Result<Vec<SimilarMessage>, String> {
    let agent_uuid =
        uuid::Uuid::parse_str(&agent_id).map_err(|e| format!("Invalid agent ID: {}", e))?;
    let conversation_uuid = conversation_id
        .map(|id| uuid::Uuid::parse_str(&id))
        .transpose()
        .map_err(|e| format!("Invalid conversation ID: {}", e))?;
    println!(
        "[MEMORY] Search request for agent={} conversation={:?} query='{}'",
        agent_uuid, conversation_uuid, query
    );

    let memories =
        MemoryService::search_similar_messages(&db, &query, agent_uuid, conversation_uuid, 10)
            .await
            .map_err(|e| {
                eprintln!("[MEMORY] Search failed: {}", e);
                e
            })?;

    println!("[MEMORY] Search returned {} matches", memories.len());
    let _ = AbilityService::track_ability_usage(&db, agent_uuid, "memory_retrieval", true).await;
    Ok(memories)
}

#[tauri::command]
async fn get_agent_retrieval_quality_summary(
    agent_id: String,
    days: Option<i32>,
    db: tauri::State<'_, DatabaseConnection>,
) -> Result<MemoryRetrievalQualitySummary, String> {
    let agent_uuid =
        uuid::Uuid::parse_str(&agent_id).map_err(|e| format!("Invalid agent ID: {}", e))?;
    MemoryService::get_retrieval_quality_summary(&db, agent_uuid, days.unwrap_or(14)).await
}

#[tauri::command]
async fn get_agent_retrieval_quality_timeseries(
    agent_id: String,
    days: Option<i32>,
    db: tauri::State<'_, DatabaseConnection>,
) -> Result<Vec<MemoryRetrievalTimeseriesPoint>, String> {
    let agent_uuid =
        uuid::Uuid::parse_str(&agent_id).map_err(|e| format!("Invalid agent ID: {}", e))?;
    MemoryService::get_retrieval_quality_timeseries(&db, agent_uuid, days.unwrap_or(14)).await
}

#[tauri::command]
async fn run_agent_retrieval_eval(
    agent_id: String,
    sample_size: Option<i32>,
    db: tauri::State<'_, DatabaseConnection>,
) -> Result<RetrievalEvalResult, String> {
    let agent_uuid =
        uuid::Uuid::parse_str(&agent_id).map_err(|e| format!("Invalid agent ID: {}", e))?;
    MemoryService::run_retrieval_eval(&db, agent_uuid, sample_size.unwrap_or(20)).await
}

#[tauri::command]
async fn get_agent_retrieval_tuning_status(
    agent_id: String,
    db: tauri::State<'_, DatabaseConnection>,
) -> Result<RetrievalTuningStatus, String> {
    let agent_uuid =
        uuid::Uuid::parse_str(&agent_id).map_err(|e| format!("Invalid agent ID: {}", e))?;
    MemoryService::get_retrieval_tuning_status(&db, agent_uuid).await
}

#[tauri::command]
async fn submit_message_feedback(
    request: SubmitFeedbackRequest,
    db: tauri::State<'_, DatabaseConnection>,
) -> Result<(), String> {
    let submit_started = std::time::Instant::now();
    let message_id = uuid::Uuid::parse_str(&request.message_id)
        .map_err(|e| format!("Invalid message_id: {e}"))?;
    FeedbackService::submit_feedback(&db, request).await?;
    eprintln!(
        "[FEEDBACK] submit_message_feedback write completed in {}ms",
        submit_started.elapsed().as_millis()
    );

    // Run adaptation best-effort in the background so UI is unblocked.
    let db_for_task = (*db).clone();
    tauri::async_runtime::spawn(async move {
        let adaptation_started = std::time::Instant::now();
        let agent_id = match FeedbackService::resolve_agent_id_for_message(&db_for_task, message_id).await
        {
            Ok(agent_id) => agent_id,
            Err(err) => {
                eprintln!(
                    "[FEEDBACK] Background adaptation skipped: failed to resolve message context: {}",
                    err
                );
                return;
            }
        };

        if let Err(err) = FeedbackService::run_adaptation_cycle(&db_for_task, agent_id).await
        {
            eprintln!(
                "[FEEDBACK] Adaptive cycle execution failed for agent {}: {}",
                agent_id, err
            );
            return;
        }

        eprintln!(
            "[FEEDBACK] Background adaptation completed for agent {} in {}ms",
            agent_id,
            adaptation_started.elapsed().as_millis()
        );
    });

    Ok(())
}

#[tauri::command]
async fn get_agent_feedback_stats(
    agent_id: String,
    db: tauri::State<'_, DatabaseConnection>,
) -> Result<feedback_service::FeedbackStats, String> {
    FeedbackService::get_feedback_stats(&db, agent_id).await
}

#[tauri::command]
async fn get_agent_feedback_monthly(
    agent_id: String,
    db: tauri::State<'_, DatabaseConnection>,
) -> Result<Vec<feedback_service::FeedbackMonthlyData>, String> {
    FeedbackService::get_feedback_monthly(&db, agent_id).await
}

#[tauri::command]
async fn get_conversation_feedback(
    conversation_id: String,
    user_id: String,
    db: tauri::State<'_, DatabaseConnection>,
) -> Result<std::collections::HashMap<String, String>, String> {
    FeedbackService::get_conversation_feedback(&db, conversation_id, user_id).await
}

#[tauri::command]
async fn get_conversation_dimension_feedback(
    conversation_id: String,
    user_id: String,
    db: tauri::State<'_, DatabaseConnection>,
) -> Result<std::collections::HashMap<String, std::collections::HashMap<String, String>>, String> {
    FeedbackService::get_conversation_dimension_feedback(&db, conversation_id, user_id).await
}

#[tauri::command]
async fn analyze_agent_feedback_patterns(
    agent_id: String,
    db: tauri::State<'_, DatabaseConnection>,
) -> Result<Vec<feedback_service::PersonalityAdjustmentData>, String> {
    FeedbackService::analyze_feedback_patterns(&db, agent_id).await
}

#[tauri::command]
async fn get_agent_trait_state(
    agent_id: String,
    db: tauri::State<'_, DatabaseConnection>,
) -> Result<TraitStateData, String> {
    FeedbackService::get_trait_state(&db, agent_id).await
}

#[tauri::command]
async fn set_agent_adaptation_enabled(
    agent_id: String,
    enabled: bool,
    db: tauri::State<'_, DatabaseConnection>,
) -> Result<TraitStateData, String> {
    FeedbackService::set_adaptation_enabled(&db, agent_id, enabled).await
}

#[tauri::command]
async fn revert_agent_last_adaptation_cycle(
    agent_id: String,
    db: tauri::State<'_, DatabaseConnection>,
) -> Result<Option<AdaptationCycleData>, String> {
    FeedbackService::revert_last_adaptation_cycle(&db, agent_id).await
}

#[tauri::command]
async fn list_personality_adjustments(
    agent_id: String,
    db: tauri::State<'_, DatabaseConnection>,
) -> Result<Vec<feedback_service::PersonalityAdjustmentData>, String> {
    FeedbackService::list_personality_adjustments(&db, agent_id).await
}

#[tauri::command]
async fn create_orchestration_project(
    request: CreateOrchestrationProjectRequest,
    auth_state: tauri::State<'_, AuthState>,
    db: tauri::State<'_, DatabaseConnection>,
) -> Result<OrchestrationProjectData, String> {
    let session_user_id = resolve_session_user_uuid(auth_state.inner())?;
    let manager_agent_id = uuid::Uuid::parse_str(request.manager_agent_id.trim())
        .map_err(|e| format!("Invalid manager agent ID: {e}"))?;
    let name = request.name.trim();
    let objective = request.objective.trim();

    if name.is_empty() {
        return Err("Project name is required.".to_string());
    }
    if objective.is_empty() {
        return Err("Project objective is required.".to_string());
    }

    let manager_is_owned = db
        .query_one(Statement::from_sql_and_values(
            db.get_database_backend(),
            r#"
                SELECT 1
                FROM agents
                WHERE id = $1::uuid
                  AND user_id = $2::uuid
                LIMIT 1
            "#,
            vec![manager_agent_id.into(), session_user_id.into()],
        ))
        .await
        .map_err(|e| format!("Failed validating manager ownership: {e}"))?
        .is_some();

    if !manager_is_owned {
        return Err("Manager agent is not owned by the authenticated session.".to_string());
    }

    let run = OrchestrationService::create_run(
        &db,
        CreateOrchestrationRunRequest {
            parent_agent_id: manager_agent_id.to_string(),
            title: name.to_string(),
            objective: objective.to_string(),
            priority: request.priority,
        },
        session_user_id,
    )
    .await?;

    let row = db
        .query_one(Statement::from_sql_and_values(
            db.get_database_backend(),
            r#"
                INSERT INTO orchestration_projects (
                    id,
                    owner_user_id,
                    manager_agent_id,
                    root_run_id,
                    name,
                    objective,
                    status,
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
                    'active',
                    NOW(),
                    NOW()
                )
                RETURNING id
            "#,
            vec![
                session_user_id.into(),
                manager_agent_id.into(),
                run.id.into(),
                name.to_string().into(),
                objective.to_string().into(),
            ],
        ))
        .await
        .map_err(|e| format!("Failed creating orchestration project: {e}"))?
        .ok_or_else(|| "No project row returned after create.".to_string())?;

    let project_id: uuid::Uuid = row
        .try_get("", "id")
        .map_err(|e| format!("Failed decoding created project id: {e}"))?;

    db.execute(Statement::from_sql_and_values(
        db.get_database_backend(),
        r#"
            INSERT INTO orchestration_project_selections (
                user_id,
                project_id,
                created_at,
                updated_at
            )
            VALUES ($1::uuid, $2::uuid, NOW(), NOW())
            ON CONFLICT (user_id)
            DO UPDATE SET
                project_id = EXCLUDED.project_id,
                updated_at = NOW()
        "#,
        vec![session_user_id.into(), project_id.into()],
    ))
    .await
    .map_err(|e| format!("Failed setting current orchestration project: {e}"))?;

    get_project_by_id_for_owner(&db, project_id, session_user_id)
        .await?
        .ok_or_else(|| "Created project could not be reloaded.".to_string())
}

#[tauri::command]
async fn list_orchestration_projects(
    auth_state: tauri::State<'_, AuthState>,
    db: tauri::State<'_, DatabaseConnection>,
) -> Result<Vec<OrchestrationProjectData>, String> {
    let session_user_id = resolve_session_user_uuid(auth_state.inner())?;
    let rows = db
        .query_all(Statement::from_sql_and_values(
            db.get_database_backend(),
            r#"
                SELECT
                    p.id,
                    p.owner_user_id,
                    p.manager_agent_id,
                    p.root_run_id AS run_id,
                    p.manager_conversation_id,
                    p.name,
                    p.objective,
                    p.status,
                    a.name AS manager_agent_name,
                    a.model_id AS manager_model_id,
                    p.created_at::text AS created_at,
                    p.updated_at::text AS updated_at
                FROM orchestration_projects p
                JOIN agents a ON a.id = p.manager_agent_id
                WHERE p.owner_user_id = $1::uuid
                ORDER BY p.created_at DESC
            "#,
            vec![session_user_id.into()],
        ))
        .await
        .map_err(|e| format!("Failed listing orchestration projects: {e}"))?;

    rows.into_iter().map(map_project_row).collect()
}

#[tauri::command]
async fn get_current_orchestration_project(
    auth_state: tauri::State<'_, AuthState>,
    db: tauri::State<'_, DatabaseConnection>,
) -> Result<Option<OrchestrationProjectData>, String> {
    let session_user_id = resolve_session_user_uuid(auth_state.inner())?;
    let selection = db
        .query_one(Statement::from_sql_and_values(
            db.get_database_backend(),
            r#"
                SELECT project_id
                FROM orchestration_project_selections
                WHERE user_id = $1::uuid
                LIMIT 1
            "#,
            vec![session_user_id.into()],
        ))
        .await
        .map_err(|e| format!("Failed loading project selection: {e}"))?;

    if let Some(selection) = selection {
        let project_id: Option<uuid::Uuid> = selection
            .try_get("", "project_id")
            .map_err(|e| format!("Failed decoding selected project id: {e}"))?;
        if let Some(project_id) = project_id {
            return get_project_by_id_for_owner(&db, project_id, session_user_id).await;
        }
    }

    let latest = db
        .query_one(Statement::from_sql_and_values(
            db.get_database_backend(),
            r#"
                SELECT id
                FROM orchestration_projects
                WHERE owner_user_id = $1::uuid
                ORDER BY created_at DESC
                LIMIT 1
            "#,
            vec![session_user_id.into()],
        ))
        .await
        .map_err(|e| format!("Failed loading fallback project: {e}"))?;

    let Some(latest) = latest else {
        return Ok(None);
    };

    let project_id: uuid::Uuid = latest
        .try_get("", "id")
        .map_err(|e| format!("Failed decoding fallback project id: {e}"))?;

    db.execute(Statement::from_sql_and_values(
        db.get_database_backend(),
        r#"
            INSERT INTO orchestration_project_selections (
                user_id,
                project_id,
                created_at,
                updated_at
            )
            VALUES ($1::uuid, $2::uuid, NOW(), NOW())
            ON CONFLICT (user_id)
            DO UPDATE SET
                project_id = EXCLUDED.project_id,
                updated_at = NOW()
        "#,
        vec![session_user_id.into(), project_id.into()],
    ))
    .await
    .map_err(|e| format!("Failed setting fallback current project: {e}"))?;

    get_project_by_id_for_owner(&db, project_id, session_user_id).await
}

#[tauri::command]
async fn set_current_orchestration_project(
    project_id: String,
    auth_state: tauri::State<'_, AuthState>,
    db: tauri::State<'_, DatabaseConnection>,
) -> Result<Option<OrchestrationProjectData>, String> {
    let session_user_id = resolve_session_user_uuid(auth_state.inner())?;
    let project_uuid =
        uuid::Uuid::parse_str(project_id.trim()).map_err(|e| format!("Invalid project ID: {e}"))?;

    let existing = get_project_by_id_for_owner(&db, project_uuid, session_user_id).await?;
    if existing.is_none() {
        return Err("Project is not owned by the authenticated session.".to_string());
    }

    db.execute(Statement::from_sql_and_values(
        db.get_database_backend(),
        r#"
            INSERT INTO orchestration_project_selections (
                user_id,
                project_id,
                created_at,
                updated_at
            )
            VALUES ($1::uuid, $2::uuid, NOW(), NOW())
            ON CONFLICT (user_id)
            DO UPDATE SET
                project_id = EXCLUDED.project_id,
                updated_at = NOW()
        "#,
        vec![session_user_id.into(), project_uuid.into()],
    ))
    .await
    .map_err(|e| format!("Failed setting current project: {e}"))?;

    get_project_by_id_for_owner(&db, project_uuid, session_user_id).await
}

async fn ensure_project_manager_conversation_for_owner(
    db: &DatabaseConnection,
    project: &OrchestrationProjectData,
    owner_user_id: uuid::Uuid,
) -> Result<conversation_service::ConversationData, String> {
    if let Some(conversation_id) = project.manager_conversation_id {
        if let Ok(existing) = ConversationService::get_conversation(db, conversation_id.to_string()).await {
            if existing.agent_id == project.manager_agent_id && existing.user_id == owner_user_id {
                return Ok(existing);
            }
        }

        db.execute(Statement::from_sql_and_values(
            db.get_database_backend(),
            r#"
                UPDATE orchestration_projects
                SET manager_conversation_id = NULL,
                    updated_at = NOW()
                WHERE id = $1::uuid
                  AND owner_user_id = $2::uuid
            "#,
            vec![project.id.into(), owner_user_id.into()],
        ))
        .await
        .map_err(|e| format!("Failed clearing stale manager conversation binding: {e}"))?;
    }

    let conversation = ConversationService::create_conversation(
        db,
        CreateConversationRequest {
            agent_id: project.manager_agent_id.to_string(),
            user_id: owner_user_id.to_string(),
            title: Some(format!("Project manager: {}", project.name)),
        },
    )
    .await?;

    db.execute(Statement::from_sql_and_values(
        db.get_database_backend(),
        r#"
            UPDATE orchestration_projects
            SET manager_conversation_id = $1::uuid,
                updated_at = NOW()
            WHERE id = $2::uuid
              AND owner_user_id = $3::uuid
        "#,
        vec![
            conversation.id.into(),
            project.id.into(),
            owner_user_id.into(),
        ],
    ))
    .await
    .map_err(|e| format!("Failed binding project manager conversation: {e}"))?;

    Ok(conversation)
}

async fn build_project_manager_context(
    db: &DatabaseConnection,
    project: &OrchestrationProjectData,
) -> Result<String, String> {
    let run_row = db
        .query_one(Statement::from_sql_and_values(
            db.get_database_backend(),
            r#"
                SELECT status
                FROM orchestration_runs
                WHERE id = $1::uuid
                LIMIT 1
            "#,
            vec![project.run_id.into()],
        ))
        .await
        .map_err(|e| format!("Failed loading project run status: {e}"))?;
    let run_status = run_row
        .and_then(|row| row.try_get::<String>("", "status").ok())
        .unwrap_or_else(|| "unknown".to_string());

    let counts_row = db
        .query_one(Statement::from_sql_and_values(
            db.get_database_backend(),
            r#"
                SELECT
                    COUNT(*) FILTER (WHERE status IN ('queued', 'planned', 'waiting'))::bigint AS backlog_count,
                    COUNT(*) FILTER (WHERE status = 'in_progress')::bigint AS in_progress_count,
                    COUNT(*) FILTER (WHERE status = 'completed')::bigint AS completed_count,
                    COUNT(*) FILTER (WHERE status IN ('failed', 'cancelled'))::bigint AS blocked_count
                FROM orchestration_tasks
                WHERE run_id = $1::uuid
            "#,
            vec![project.run_id.into()],
        ))
        .await
        .map_err(|e| format!("Failed loading project task counters: {e}"))?
        .ok_or_else(|| "Could not load project task counters.".to_string())?;

    let backlog_count: i64 = counts_row
        .try_get("", "backlog_count")
        .map_err(|e| format!("Failed decoding backlog_count: {e}"))?;
    let in_progress_count: i64 = counts_row
        .try_get("", "in_progress_count")
        .map_err(|e| format!("Failed decoding in_progress_count: {e}"))?;
    let completed_count: i64 = counts_row
        .try_get("", "completed_count")
        .map_err(|e| format!("Failed decoding completed_count: {e}"))?;
    let blocked_count: i64 = counts_row
        .try_get("", "blocked_count")
        .map_err(|e| format!("Failed decoding blocked_count: {e}"))?;

    let recent_rows = db
        .query_all(Statement::from_sql_and_values(
            db.get_database_backend(),
            r#"
                SELECT
                    t.title,
                    t.status,
                    a.name AS owner_agent_name
                FROM orchestration_tasks t
                JOIN agents a ON a.id = t.owner_agent_id
                WHERE t.run_id = $1::uuid
                ORDER BY t.updated_at DESC
                LIMIT 5
            "#,
            vec![project.run_id.into()],
        ))
        .await
        .map_err(|e| format!("Failed loading recent project tasks: {e}"))?;

    let recent_tasks = recent_rows
        .into_iter()
        .map(|row| {
            let title: String = row.try_get("", "title").unwrap_or_else(|_| "Untitled task".to_string());
            let status: String = row.try_get("", "status").unwrap_or_else(|_| "unknown".to_string());
            let owner_agent_name: String =
                row.try_get("", "owner_agent_name").unwrap_or_else(|_| "unknown".to_string());
            format!("- {title} ({status}, owner: {owner_agent_name})")
        })
        .collect::<Vec<_>>();

    let recent_tasks_block = if recent_tasks.is_empty() {
        "- none yet".to_string()
    } else {
        recent_tasks.join("\n")
    };

    Ok(format!(
        "project_id: {}\nproject_name: {}\nobjective: {}\nmanager_agent: {}\nrun_id: {}\nrun_status: {}\nbacklog_count: {}\nin_progress_count: {}\ncompleted_count: {}\nblocked_count: {}\nrecent_tasks:\n{}",
        project.id,
        project.name,
        project.objective,
        project.manager_agent_name,
        project.run_id,
        run_status,
        backlog_count,
        in_progress_count,
        completed_count,
        blocked_count,
        recent_tasks_block
    ))
}

#[tauri::command]
async fn ensure_project_manager_conversation(
    project_id: String,
    auth_state: tauri::State<'_, AuthState>,
    db: tauri::State<'_, DatabaseConnection>,
) -> Result<conversation_service::ConversationData, String> {
    let session_user_id = resolve_session_user_uuid(auth_state.inner())?;
    let project_uuid =
        uuid::Uuid::parse_str(project_id.trim()).map_err(|e| format!("Invalid project ID: {e}"))?;
    let project = get_project_by_id_for_owner(&db, project_uuid, session_user_id)
        .await?
        .ok_or_else(|| "Project is not owned by the authenticated session.".to_string())?;
    ensure_project_manager_conversation_for_owner(&db, &project, session_user_id).await
}

#[tauri::command]
async fn send_project_manager_message(
    project_id: String,
    content: String,
    auth_state: tauri::State<'_, AuthState>,
    db: tauri::State<'_, DatabaseConnection>,
    ai_client: tauri::State<'_, AiClient>,
) -> Result<conversation_service::MessageData, String> {
    let session_user_id = resolve_session_user_uuid(auth_state.inner())?;
    let trimmed_content = content.trim();
    if trimmed_content.is_empty() {
        return Err("Message content cannot be empty.".to_string());
    }

    let project_uuid =
        uuid::Uuid::parse_str(project_id.trim()).map_err(|e| format!("Invalid project ID: {e}"))?;
    let project = get_project_by_id_for_owner(&db, project_uuid, session_user_id)
        .await?
        .ok_or_else(|| "Project is not owned by the authenticated session.".to_string())?;

    let conversation =
        ensure_project_manager_conversation_for_owner(&db, &project, session_user_id).await?;
    let context_block = build_project_manager_context(&db, &project).await?;
    let access_token = SkillsRegistryClient::resolve_access_token(&auth_state).ok();

    let context_message = format!(
        "[ProjectManagementContext]\n{}\n[/ProjectManagementContext]\nRespond specifically about this project and ask clarifying questions when needed.",
        context_block
    );

    db.execute(Statement::from_sql_and_values(
        db.get_database_backend(),
        r#"
            INSERT INTO messages (
                id,
                conversation_id,
                role,
                content,
                message_type,
                metadata,
                created_at,
                parent_id
            )
            VALUES (
                gen_random_uuid(),
                $1::uuid,
                'system',
                $2::text,
                'text',
                '{"internal": true, "project_context": true}'::jsonb,
                NOW(),
                NULL
            )
        "#,
        vec![conversation.id.into(), context_message.into()],
    ))
    .await
    .map_err(|e| format!("Failed writing project context system message: {e}"))?;

    let response = ConversationService::send_message(
        &db,
        conversation.id.to_string(),
        trimmed_content.to_string(),
        None,
        access_token.as_deref(),
        &ai_client,
    )
    .await?;

    let _ =
        AbilityService::track_ability_usage(&db, conversation.agent_id, "conversation", true)
            .await;
    Ok(response)
}

#[tauri::command]
async fn create_orchestration_run(
    request: CreateOrchestrationRunRequest,
    auth_state: tauri::State<'_, AuthState>,
    db: tauri::State<'_, DatabaseConnection>,
) -> Result<OrchestrationRunData, String> {
    let session_user_id = resolve_session_user_uuid(auth_state.inner())?;
    OrchestrationService::create_run(&db, request, session_user_id).await
}

#[tauri::command]
async fn create_agent_delegation(
    request: CreateAgentDelegationRequest,
    auth_state: tauri::State<'_, AuthState>,
    db: tauri::State<'_, DatabaseConnection>,
) -> Result<AgentDelegationData, String> {
    let session_user_id = resolve_session_user_uuid(auth_state.inner())?;
    OrchestrationService::create_agent_delegation(&db, request, session_user_id).await
}

#[tauri::command]
async fn list_agent_delegations(
    parent_agent_id: String,
    db: tauri::State<'_, DatabaseConnection>,
) -> Result<Vec<AgentDelegationData>, String> {
    OrchestrationService::list_agent_delegations(&db, parent_agent_id).await
}

#[tauri::command]
async fn revoke_agent_delegation(
    delegation_id: String,
    auth_state: tauri::State<'_, AuthState>,
    db: tauri::State<'_, DatabaseConnection>,
) -> Result<AgentDelegationData, String> {
    let session_user_id = resolve_session_user_uuid(auth_state.inner())?;
    OrchestrationService::revoke_agent_delegation(&db, delegation_id, session_user_id).await
}

#[tauri::command]
async fn list_orchestration_runs(
    parent_agent_id: String,
    status_filter: Option<String>,
    page: Option<i64>,
    per_page: Option<i64>,
    db: tauri::State<'_, DatabaseConnection>,
) -> Result<Vec<OrchestrationRunData>, String> {
    OrchestrationService::list_runs(&db, parent_agent_id, status_filter, page, per_page).await
}

#[tauri::command]
async fn get_orchestration_run(
    run_id: String,
    db: tauri::State<'_, DatabaseConnection>,
) -> Result<OrchestrationRunData, String> {
    OrchestrationService::get_run(&db, run_id).await
}

#[tauri::command]
async fn update_orchestration_run_status(
    run_id: String,
    status: String,
    last_error: Option<String>,
    auth_state: tauri::State<'_, AuthState>,
    db: tauri::State<'_, DatabaseConnection>,
) -> Result<OrchestrationRunData, String> {
    let session_user_id = resolve_session_user_uuid(auth_state.inner())?;
    ensure_orchestration_run_owned_by_session(&db, &run_id, session_user_id).await?;
    OrchestrationService::update_run_status(&db, run_id, status, last_error).await
}

#[tauri::command]
async fn create_orchestration_task(
    request: CreateOrchestrationTaskRequest,
    auth_state: tauri::State<'_, AuthState>,
    db: tauri::State<'_, DatabaseConnection>,
) -> Result<OrchestrationTaskData, String> {
    let session_user_id = resolve_session_user_uuid(auth_state.inner())?;
    ensure_orchestration_run_owned_by_session(&db, &request.run_id, session_user_id).await?;
    OrchestrationService::create_task(&db, request).await
}

#[tauri::command]
async fn list_orchestration_tasks(
    run_id: String,
    db: tauri::State<'_, DatabaseConnection>,
) -> Result<Vec<OrchestrationTaskData>, String> {
    OrchestrationService::list_tasks(&db, run_id).await
}

#[tauri::command]
async fn get_orchestration_task_detail(
    task_id: String,
    db: tauri::State<'_, DatabaseConnection>,
) -> Result<OrchestrationTaskDetailData, String> {
    OrchestrationService::get_task_detail(&db, task_id).await
}

#[tauri::command]
async fn list_orchestration_events(
    run_id: String,
    limit: Option<i64>,
    db: tauri::State<'_, DatabaseConnection>,
) -> Result<Vec<OrchestrationEventData>, String> {
    OrchestrationService::list_events(&db, run_id, limit).await
}

#[tauri::command]
async fn review_orchestration_task_assignment(
    task_id: String,
    required_ability_keys: Option<Vec<String>>,
    preferred_role: Option<String>,
    auth_state: tauri::State<'_, AuthState>,
    db: tauri::State<'_, DatabaseConnection>,
) -> Result<AssignmentReviewData, String> {
    let session_user_id = resolve_session_user_uuid(auth_state.inner())?;
    ensure_orchestration_task_owned_by_session(&db, &task_id, session_user_id).await?;
    OrchestrationService::review_task_assignment(
        &db,
        task_id,
        required_ability_keys,
        preferred_role,
    )
    .await
}

#[tauri::command]
async fn auto_assign_orchestration_task(
    task_id: String,
    requested_by_agent_id: Option<String>,
    required_ability_keys: Option<Vec<String>>,
    preferred_role: Option<String>,
    auth_state: tauri::State<'_, AuthState>,
    db: tauri::State<'_, DatabaseConnection>,
) -> Result<OrchestrationTaskData, String> {
    let session_user_id = resolve_session_user_uuid(auth_state.inner())?;
    ensure_orchestration_task_owned_by_session(&db, &task_id, session_user_id).await?;
    OrchestrationService::auto_assign_task(
        &db,
        task_id,
        requested_by_agent_id,
        required_ability_keys,
        preferred_role,
    )
    .await
}

#[tauri::command]
async fn update_orchestration_task_status(
    task_id: String,
    status: String,
    failure_reason: Option<String>,
    auth_state: tauri::State<'_, AuthState>,
    db: tauri::State<'_, DatabaseConnection>,
) -> Result<OrchestrationTaskData, String> {
    let session_user_id = resolve_session_user_uuid(auth_state.inner())?;
    ensure_orchestration_task_owned_by_session(&db, &task_id, session_user_id).await?;
    OrchestrationService::update_task_status(&db, task_id, status, failure_reason).await
}

#[tauri::command]
async fn submit_orchestration_task_feedback(
    task_id: String,
    verdict: String,
    notes: Option<String>,
    requested_by_agent_id: String,
    auth_state: tauri::State<'_, AuthState>,
    db: tauri::State<'_, DatabaseConnection>,
) -> Result<OrchestrationTaskFeedbackData, String> {
    let session_user_id = resolve_session_user_uuid(auth_state.inner())?;
    OrchestrationService::submit_task_feedback(
        &db,
        task_id,
        verdict,
        notes,
        session_user_id,
        requested_by_agent_id,
    )
    .await
}

#[tauri::command]
async fn skip_orchestration_task(
    task_id: String,
    requested_by_agent_id: String,
    reason: Option<String>,
    auth_state: tauri::State<'_, AuthState>,
    db: tauri::State<'_, DatabaseConnection>,
) -> Result<OrchestrationTaskData, String> {
    let session_user_id = resolve_session_user_uuid(auth_state.inner())?;
    ensure_orchestration_task_owned_by_session(&db, &task_id, session_user_id).await?;
    OrchestrationService::skip_task(&db, task_id, requested_by_agent_id, reason).await
}

#[tauri::command]
async fn retry_orchestration_task(
    task_id: String,
    requested_by_agent_id: String,
    auth_state: tauri::State<'_, AuthState>,
    db: tauri::State<'_, DatabaseConnection>,
) -> Result<OrchestrationTaskData, String> {
    let session_user_id = resolve_session_user_uuid(auth_state.inner())?;
    ensure_orchestration_task_owned_by_session(&db, &task_id, session_user_id).await?;
    OrchestrationService::retry_task(&db, task_id, requested_by_agent_id).await
}

#[tauri::command]
async fn reassign_orchestration_task(
    task_id: String,
    new_owner_agent_id: String,
    requested_by_agent_id: String,
    reason: Option<String>,
    required_ability_keys: Option<Vec<String>>,
    auth_state: tauri::State<'_, AuthState>,
    db: tauri::State<'_, DatabaseConnection>,
) -> Result<OrchestrationTaskData, String> {
    let session_user_id = resolve_session_user_uuid(auth_state.inner())?;
    ensure_orchestration_task_owned_by_session(&db, &task_id, session_user_id).await?;
    OrchestrationService::reassign_task(
        &db,
        task_id,
        new_owner_agent_id,
        requested_by_agent_id,
        reason,
        required_ability_keys,
    )
    .await
}

#[tauri::command]
async fn record_orchestration_delegation(
    request: RecordDelegationRequest,
    auth_state: tauri::State<'_, AuthState>,
    db: tauri::State<'_, DatabaseConnection>,
) -> Result<orchestration_service::OrchestrationDelegationData, String> {
    let session_user_id = resolve_session_user_uuid(auth_state.inner())?;
    ensure_orchestration_run_owned_by_session(&db, &request.run_id, session_user_id).await?;
    OrchestrationService::record_delegation(&db, request).await
}

#[tauri::command]
async fn upsert_orchestration_heartbeat(
    request: UpsertHeartbeatRequest,
    auth_state: tauri::State<'_, AuthState>,
    db: tauri::State<'_, DatabaseConnection>,
) -> Result<OrchestrationHeartbeatData, String> {
    let session_user_id = resolve_session_user_uuid(auth_state.inner())?;
    ensure_orchestration_run_owned_by_session(&db, &request.run_id, session_user_id).await?;
    OrchestrationService::upsert_heartbeat(&db, request).await
}

#[tauri::command]
async fn upsert_orchestration_memory(
    request: UpsertOrchestrationMemoryRequest,
    auth_state: tauri::State<'_, AuthState>,
    db: tauri::State<'_, DatabaseConnection>,
) -> Result<OrchestrationMemoryData, String> {
    let session_user_id = resolve_session_user_uuid(auth_state.inner())?;
    ensure_orchestration_run_owned_by_session(&db, &request.run_id, session_user_id).await?;
    OrchestrationService::upsert_memory(&db, request).await
}

#[tauri::command]
async fn list_orchestration_memories(
    run_id: String,
    viewer_agent_id: String,
    scope_filter: Option<String>,
    db: tauri::State<'_, DatabaseConnection>,
) -> Result<Vec<OrchestrationMemoryData>, String> {
    OrchestrationService::list_memories(&db, run_id, viewer_agent_id, scope_filter).await
}

#[tauri::command]
async fn promote_orchestration_memory(
    memory_id: String,
    requested_by_agent_id: String,
    auth_state: tauri::State<'_, AuthState>,
    db: tauri::State<'_, DatabaseConnection>,
) -> Result<OrchestrationMemoryData, String> {
    let session_user_id = resolve_session_user_uuid(auth_state.inner())?;
    ensure_orchestration_memory_owned_by_session(&db, &memory_id, session_user_id).await?;
    OrchestrationService::promote_memory_to_parent_visible(&db, memory_id, requested_by_agent_id)
        .await
}

#[tauri::command]
async fn pause_orchestration_run(
    run_id: String,
    auth_state: tauri::State<'_, AuthState>,
    db: tauri::State<'_, DatabaseConnection>,
) -> Result<OrchestrationRunData, String> {
    let session_user_id = resolve_session_user_uuid(auth_state.inner())?;
    ensure_orchestration_run_owned_by_session(&db, &run_id, session_user_id).await?;
    OrchestrationService::update_run_status(&db, run_id, "paused".to_string(), None).await
}

#[tauri::command]
async fn resume_orchestration_run(
    run_id: String,
    auth_state: tauri::State<'_, AuthState>,
    db: tauri::State<'_, DatabaseConnection>,
) -> Result<OrchestrationRunData, String> {
    let session_user_id = resolve_session_user_uuid(auth_state.inner())?;
    ensure_orchestration_run_owned_by_session(&db, &run_id, session_user_id).await?;
    OrchestrationService::update_run_status(&db, run_id, "in_progress".to_string(), None).await
}

#[tauri::command]
async fn cancel_orchestration_run(
    run_id: String,
    auth_state: tauri::State<'_, AuthState>,
    db: tauri::State<'_, DatabaseConnection>,
) -> Result<OrchestrationRunData, String> {
    let session_user_id = resolve_session_user_uuid(auth_state.inner())?;
    ensure_orchestration_run_owned_by_session(&db, &run_id, session_user_id).await?;
    OrchestrationService::update_run_status(&db, run_id, "cancelled".to_string(), None).await
}

#[tauri::command]
async fn set_orchestration_schedule(
    run_id: String,
    enabled: bool,
    interval_minutes: Option<i32>,
    auth_state: tauri::State<'_, AuthState>,
    db: tauri::State<'_, DatabaseConnection>,
) -> Result<OrchestrationScheduleData, String> {
    let session_user_id = resolve_session_user_uuid(auth_state.inner())?;
    ensure_orchestration_run_owned_by_session(&db, &run_id, session_user_id).await?;
    OrchestrationService::set_schedule(&db, run_id, enabled, interval_minutes.unwrap_or(15)).await
}

#[tauri::command]
async fn get_orchestration_diagnostics(
    run_id: String,
    stale_after_minutes: Option<i64>,
    db: tauri::State<'_, DatabaseConnection>,
) -> Result<OrchestrationDiagnostics, String> {
    OrchestrationService::get_diagnostics(&db, run_id, stale_after_minutes).await
}

#[tauri::command]
async fn run_orchestration_scheduler_tick(
    db: tauri::State<'_, DatabaseConnection>,
) -> Result<i64, String> {
    OrchestrationService::run_scheduler_tick(&db).await
}

#[tauri::command]
async fn recover_orchestration_runs(
    db: tauri::State<'_, DatabaseConnection>,
) -> Result<i64, String> {
    OrchestrationService::recover_incomplete_runs(&db).await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Load environment variables from .env file
    dotenv::dotenv().ok();

    tauri::Builder::default()
        .manage(AuthState::new())
        .manage(RuntimeSyncAppState::default())
        .manage(RuntimeHandshakeCacheState::default())
        .setup(|app| {
            let runtime_sync_state = app.state::<RuntimeSyncAppState>();
            runtime_sync_state.set_foreground(true);
            // Initialize database connection at startup
            tauri::async_runtime::block_on(async {
                match db::init_db().await {
                    Ok(db_conn) => {
                        if let Err(err) = AbilityService::initialize_core_abilities(&db_conn).await
                        {
                            eprintln!("[APP] Failed to initialize core abilities: {}", err);
                        }
                        if let Err(err) =
                            OrchestrationService::recover_incomplete_runs(&db_conn).await
                        {
                            eprintln!("[ORCHESTRATION] Startup recovery failed: {}", err);
                        }
                        if let Err(err) = ensure_runtime_sync_state_schema(&db_conn).await {
                            eprintln!("[RUNTIME_SYNC] Failed to ensure sync schema: {}", err);
                        }
                        app.manage(db_conn.clone());
                        let db_for_scheduler = db_conn.clone();
                        tauri::async_runtime::spawn(async move {
                            loop {
                                if let Err(err) =
                                    OrchestrationService::run_scheduler_tick(&db_for_scheduler)
                                        .await
                                {
                                    eprintln!("[ORCHESTRATION] Scheduler tick failed: {}", err);
                                }
                                tokio::time::sleep(tokio::time::Duration::from_secs(60)).await;
                            }
                        });

                        let app_handle_control = app.handle().clone();
                        tauri::async_runtime::spawn(async move {
                            loop {
                                let auth_state = app_handle_control.state::<AuthState>();
                                if auth_state.get_session().is_some() {
                                    let db_state = app_handle_control.state::<DatabaseConnection>();
                                    let runtime_state =
                                        app_handle_control.state::<RuntimeSyncAppState>();
                                    let handshake_cache =
                                        app_handle_control.state::<RuntimeHandshakeCacheState>();
                                    match run_control_sync_tick(
                                        &db_state,
                                        &auth_state,
                                        runtime_state.inner(),
                                    )
                                    .await
                                    {
                                        Ok(run) => {
                                            if run.advisories_changed {
                                                handshake_cache.inner().clear().await;
                                            }
                                        }
                                        Err(error) => {
                                            eprintln!(
                                                "[RUNTIME_SYNC] control sync tick failed: {}",
                                                error
                                            );
                                            let _ = write_failure_state(&db_state, &error).await;
                                        }
                                    }
                                }
                                tokio::time::sleep(tokio::time::Duration::from_millis(
                                    next_control_sleep_ms(),
                                ))
                                .await;
                            }
                        });

                        let app_handle_app = app.handle().clone();
                        tauri::async_runtime::spawn(async move {
                            loop {
                                let auth_state = app_handle_app.state::<AuthState>();
                                let runtime_state = app_handle_app.state::<RuntimeSyncAppState>();
                                if auth_state.get_session().is_some() {
                                    let db_state = app_handle_app.state::<DatabaseConnection>();
                                    let handshake_cache =
                                        app_handle_app.state::<RuntimeHandshakeCacheState>();
                                    match run_app_sync_tick(
                                        &db_state,
                                        &auth_state,
                                        runtime_state.inner(),
                                    )
                                    .await
                                    {
                                        Ok(run) => {
                                            if run.advisories_changed {
                                                handshake_cache.inner().clear().await;
                                            }
                                        }
                                        Err(error) => {
                                            eprintln!("[RUNTIME_SYNC] app sync tick failed: {}", error);
                                            let _ = write_failure_state(&db_state, &error).await;
                                        }
                                    }
                                }
                                tokio::time::sleep(tokio::time::Duration::from_millis(
                                    next_app_sleep_ms(runtime_state.is_foreground()),
                                ))
                                .await;
                            }
                        });

                        println!("[APP] Database connection initialized successfully");
                    }
                    Err(e) => {
                        eprintln!("[APP] Failed to initialize database: {:?}", e);
                        return Err(Box::new(e) as Box<dyn std::error::Error>);
                    }
                }

                // Initialize AI client
                match ai_client::create_ai_client() {
                    Ok(client) => {
                        app.manage(client);
                        println!("[APP] AI client initialized successfully");
                        Ok(())
                    }
                    Err(e) => {
                        eprintln!("[APP] Failed to initialize AI client: {}", e);
                        eprintln!("[APP] AI features will be unavailable");
                        // Don't fail the app if AI client fails, just continue without it
                        // We'll create a dummy client for development
                        Ok(())
                    }
                }
            })
        })
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_mic_recorder::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            set_session,
            clear_session,
            verify_session,
            list_registry_skills,
            list_registry_permission_profiles,
            upload_registry_skill_artifact,
            dry_run_publish_registry_skill,
            publish_registry_skill,
            preflight_registry_skill,
            start_preflight_registry_skill,
            get_preflight_registry_skill,
            review_registry_skill,
            get_registry_skill,
            get_registry_skill_version,
            list_installed_skills,
            install_registry_skill,
            uninstall_registry_skill,
            pin_registry_skill_version,
            assign_registry_skill,
            list_agent_registry_skills,
            sync_skill_advisories,
            validate_skill_runtime,
            get_runtime_sync_diagnostics_command,
            trigger_runtime_sync_command,
            set_runtime_sync_app_visibility,
            run_agent_runtime_tool,
            run_registry_skill_direct,
            list_provider_models,
            create_agent,
            list_agents,
            get_agent,
            update_agent,
            delete_agent,
            send_message_to_agent,
            create_conversation,
            list_conversations,
            get_conversation,
            get_conversation_messages,
            send_message,
            send_message_streaming,
            update_conversation_title,
            generate_conversation_title,
            save_voice_transcript,
            delete_conversation,
            delete_message,
            edit_message,
            edit_message_streaming,
            // Perception commands
            capture_screenshot,
            log_screenshot_perception,
            analyze_image,
            start_recording,
            stop_recording,
            transcribe_audio,
            log_audio_perception,
            text_to_speech,
            read_audio_file,
            get_perception_stats,
            load_skills_graph,
            save_skills_graph,
            suggest_skills_graph_connections,
            // User profile commands
            get_user_profile,
            update_user_profile,
            check_local_docker_runtime,
            prepare_local_docker_runtime,
            // Skill tracking + memory + feedback
            list_agent_abilities,
            list_agent_tool_settings,
            set_agent_ability_enabled,
            update_agent_ability_config,
            get_agent_skill_ratings,
            get_agent_skill_rating_trends,
            get_relevant_memories,
            get_agent_retrieval_quality_summary,
            get_agent_retrieval_quality_timeseries,
            run_agent_retrieval_eval,
            get_agent_retrieval_tuning_status,
            submit_message_feedback,
            get_agent_feedback_stats,
            get_agent_feedback_monthly,
            get_conversation_feedback,
            get_conversation_dimension_feedback,
            analyze_agent_feedback_patterns,
            get_agent_trait_state,
            set_agent_adaptation_enabled,
            revert_agent_last_adaptation_cycle,
            list_personality_adjustments,
            // Orchestration commands
            create_orchestration_project,
            list_orchestration_projects,
            get_current_orchestration_project,
            set_current_orchestration_project,
            ensure_project_manager_conversation,
            send_project_manager_message,
            create_orchestration_run,
            create_agent_delegation,
            list_agent_delegations,
            revoke_agent_delegation,
            list_orchestration_runs,
            get_orchestration_run,
            update_orchestration_run_status,
            create_orchestration_task,
            list_orchestration_tasks,
            get_orchestration_task_detail,
            list_orchestration_events,
            review_orchestration_task_assignment,
            auto_assign_orchestration_task,
            update_orchestration_task_status,
            submit_orchestration_task_feedback,
            skip_orchestration_task,
            retry_orchestration_task,
            reassign_orchestration_task,
            record_orchestration_delegation,
            upsert_orchestration_heartbeat,
            upsert_orchestration_memory,
            list_orchestration_memories,
            promote_orchestration_memory,
            pause_orchestration_run,
            resume_orchestration_run,
            cancel_orchestration_run,
            set_orchestration_schedule,
            get_orchestration_diagnostics,
            run_orchestration_scheduler_tick,
            recover_orchestration_runs,
            // Realtime voice chat
            get_realtime_session_token
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::validate_runtime_handshake_response;
    use crate::skills_registry_client::{
        RuntimeArtifact, RuntimeCompatibility, RuntimeForceDisable, RuntimeHandshake,
        RuntimeInstallState, RuntimePolicy, RuntimeSpec,
    };

    fn baseline_handshake() -> RuntimeHandshake {
        RuntimeHandshake {
            skill_id: "coreagent.test.skill".to_string(),
            implementation_key: "coreagent.test.skill".to_string(),
            name: "Test Skill".to_string(),
            version: "1.0.0".to_string(),
            install: RuntimeInstallState {
                install_id: Some("install-id".to_string()),
                installed: true,
                install_state: Some("ready".to_string()),
                auto_update: Some(true),
                pinned_version: Some("1.0.0".to_string()),
                install_config: serde_json::json!({}),
            },
            runtime: RuntimeSpec {
                runtime_type: "command".to_string(),
                entrypoint: "run.sh".to_string(),
                compatibility: RuntimeCompatibility {
                    min_app_version: None,
                    max_app_version: None,
                },
            },
            artifact: RuntimeArtifact {
                uri: Some("artifact://sha256/test".to_string()),
                digest: "a".repeat(64),
                signature: "hmac-sha256.signature".to_string(),
                signature_algorithm: "hmac-sha256".to_string(),
            },
            policy: RuntimePolicy {
                status: "approved".to_string(),
                risk_level: "low".to_string(),
            },
            permissions: vec![],
            force_disable: RuntimeForceDisable {
                required: false,
                reason: None,
                advisory: None,
            },
        }
    }

    #[test]
    fn handshake_validation_accepts_runnable_handshake() {
        let handshake = baseline_handshake();
        assert!(validate_runtime_handshake_response(&handshake).is_ok());
    }

    #[test]
    fn handshake_validation_rejects_missing_digest() {
        let mut handshake = baseline_handshake();
        handshake.artifact.digest = "".to_string();
        let result = validate_runtime_handshake_response(&handshake);
        assert!(result.is_err());
        assert!(result.err().unwrap_or_default().contains("artifact digest"));
    }

    #[test]
    fn handshake_validation_rejects_unapproved_policy() {
        let mut handshake = baseline_handshake();
        handshake.policy.status = "pending".to_string();
        let result = validate_runtime_handshake_response(&handshake);
        assert!(result.is_err());
        assert!(result
            .err()
            .unwrap_or_default()
            .contains("policy status is 'pending'"));
    }

    #[test]
    fn handshake_validation_rejects_non_runnable_install_state() {
        let mut handshake = baseline_handshake();
        handshake.install.install_state = Some("resolving".to_string());
        let result = validate_runtime_handshake_response(&handshake);
        assert!(result.is_err());
        assert!(result
            .err()
            .unwrap_or_default()
            .contains("install state is not runnable"));
    }

    #[test]
    fn handshake_validation_rejects_force_disable() {
        let mut handshake = baseline_handshake();
        handshake.force_disable.required = true;
        handshake.force_disable.reason = Some("revoked by advisory".to_string());
        let result = validate_runtime_handshake_response(&handshake);
        assert!(result.is_err());
        assert_eq!(result.err().unwrap_or_default(), "revoked by advisory");
    }
}
