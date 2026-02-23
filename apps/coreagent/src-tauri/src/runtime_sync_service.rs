use crate::auth::AuthState;
use crate::skills_registry_client::SkillsRegistryClient;
use rand::Rng;
use sea_orm::{ConnectionTrait, DatabaseBackend, DatabaseConnection, Statement};
use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};

const SYNC_STATE_KEY: &str = "default";
const SOFT_STALE_MS: i64 = 2 * 60 * 1000;
const HARD_STALE_MS: i64 = 10 * 60 * 1000;
const CONTROL_SYNC_SECONDS: i64 = 30;
const FOREGROUND_SYNC_SECONDS: i64 = 60;
const BACKGROUND_SYNC_SECONDS: i64 = 5 * 60;
const MAX_BACKOFF_SECONDS: i64 = 5 * 60;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeSyncFreshness {
    Fresh,
    SoftStale,
    HardStale,
}

impl RuntimeSyncFreshness {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Fresh => "fresh",
            Self::SoftStale => "soft_stale",
            Self::HardStale => "hard_stale",
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeSyncDiagnostics {
    pub freshness: String,
    pub app_is_foreground: bool,
    pub cursor: Option<String>,
    pub last_success_at_ms: Option<i64>,
    pub last_attempt_at_ms: Option<i64>,
    pub last_control_sync_at_ms: Option<i64>,
    pub last_app_sync_at_ms: Option<i64>,
    pub next_retry_at_ms: Option<i64>,
    pub consecutive_failures: i32,
    pub next_backoff_seconds: i32,
    pub last_error: Option<String>,
}

#[derive(Clone, Debug)]
pub struct RuntimeSyncRunResult {
    pub attempted: bool,
    pub advisories_changed: bool,
    pub diagnostics: RuntimeSyncDiagnostics,
}

#[derive(Debug)]
struct AdvisorySyncStateRow {
    cursor: Option<String>,
    last_success_at_ms: Option<i64>,
    last_attempt_at_ms: Option<i64>,
    last_control_sync_at_ms: Option<i64>,
    last_app_sync_at_ms: Option<i64>,
    next_retry_at_ms: Option<i64>,
    consecutive_failures: i32,
    next_backoff_seconds: i32,
    last_error: Option<String>,
}

#[derive(Default)]
pub struct RuntimeSyncAppState {
    is_foreground: AtomicBool,
}

impl RuntimeSyncAppState {
    pub fn set_foreground(&self, value: bool) {
        self.is_foreground.store(value, Ordering::Relaxed);
    }

    pub fn is_foreground(&self) -> bool {
        self.is_foreground.load(Ordering::Relaxed)
    }
}

pub async fn ensure_runtime_sync_state_schema(db: &DatabaseConnection) -> Result<(), String> {
    db.execute(Statement::from_string(
        DatabaseBackend::Postgres,
        r#"
        CREATE TABLE IF NOT EXISTS advisory_sync_state (
            state_key TEXT PRIMARY KEY,
            cursor TEXT,
            last_success_at TIMESTAMPTZ,
            last_attempt_at TIMESTAMPTZ,
            last_control_sync_at TIMESTAMPTZ,
            last_app_sync_at TIMESTAMPTZ,
            next_retry_at TIMESTAMPTZ,
            consecutive_failures INTEGER NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
            next_backoff_seconds INTEGER NOT NULL DEFAULT 0 CHECK (next_backoff_seconds >= 0),
            last_error TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        "#,
    ))
    .await
    .map_err(|error| format!("Failed ensuring advisory sync schema: {error}"))?;

    db.execute(Statement::from_sql_and_values(
        DatabaseBackend::Postgres,
        r#"
        INSERT INTO advisory_sync_state (state_key)
        VALUES ($1::text)
        ON CONFLICT (state_key) DO NOTHING
        "#,
        vec![SYNC_STATE_KEY.to_string().into()],
    ))
    .await
    .map_err(|error| format!("Failed ensuring advisory sync state row: {error}"))?;

    Ok(())
}

pub fn classify_runtime_sync_freshness(last_success_at_ms: Option<i64>, now_ms: i64) -> RuntimeSyncFreshness {
    match last_success_at_ms {
        None => RuntimeSyncFreshness::HardStale,
        Some(last_success) => {
            let elapsed = now_ms.saturating_sub(last_success);
            if elapsed < SOFT_STALE_MS {
                RuntimeSyncFreshness::Fresh
            } else if elapsed < HARD_STALE_MS {
                RuntimeSyncFreshness::SoftStale
            } else {
                RuntimeSyncFreshness::HardStale
            }
        }
    }
}

pub async fn get_runtime_sync_diagnostics(
    db: &DatabaseConnection,
    app_state: &RuntimeSyncAppState,
) -> Result<RuntimeSyncDiagnostics, String> {
    ensure_runtime_sync_state_schema(db).await?;
    let row = load_state_row(db).await?;
    Ok(to_diagnostics(row, app_state.is_foreground()))
}

pub async fn trigger_runtime_sync(
    db: &DatabaseConnection,
    auth_state: &AuthState,
    app_state: &RuntimeSyncAppState,
    reason: &str,
) -> Result<RuntimeSyncRunResult, String> {
    run_sync_kind(db, auth_state, app_state, SyncKind::Immediate(reason.to_string()), true).await
}

pub async fn run_control_sync_tick(
    db: &DatabaseConnection,
    auth_state: &AuthState,
    app_state: &RuntimeSyncAppState,
) -> Result<RuntimeSyncRunResult, String> {
    run_sync_kind(db, auth_state, app_state, SyncKind::Control, false).await
}

pub async fn run_app_sync_tick(
    db: &DatabaseConnection,
    auth_state: &AuthState,
    app_state: &RuntimeSyncAppState,
) -> Result<RuntimeSyncRunResult, String> {
    run_sync_kind(db, auth_state, app_state, SyncKind::App, false).await
}

pub fn next_control_sleep_ms() -> u64 {
    let mut rng = rand::thread_rng();
    let jitter_ms: i64 = rng.gen_range(0..=2_500);
    ((CONTROL_SYNC_SECONDS * 1000) + jitter_ms) as u64
}

pub fn next_app_sleep_ms(app_is_foreground: bool) -> u64 {
    let base_seconds = if app_is_foreground {
        FOREGROUND_SYNC_SECONDS
    } else {
        BACKGROUND_SYNC_SECONDS
    };
    let mut rng = rand::thread_rng();
    let jitter_ms: i64 = rng.gen_range(0..=4_000);
    ((base_seconds * 1000) + jitter_ms) as u64
}

enum SyncKind {
    Control,
    App,
    Immediate(String),
}

async fn run_sync_kind(
    db: &DatabaseConnection,
    auth_state: &AuthState,
    app_state: &RuntimeSyncAppState,
    sync_kind: SyncKind,
    force: bool,
) -> Result<RuntimeSyncRunResult, String> {
    ensure_runtime_sync_state_schema(db).await?;
    let state = load_state_row(db).await?;
    let now_ms = chrono::Utc::now().timestamp_millis();

    if !force {
        if let Some(next_retry_at_ms) = state.next_retry_at_ms {
            if next_retry_at_ms > now_ms {
                return Ok(RuntimeSyncRunResult {
                    attempted: false,
                    advisories_changed: false,
                    diagnostics: to_diagnostics(state, app_state.is_foreground()),
                });
            }
        }
        if !is_due_for_kind(&state, now_ms, &sync_kind, app_state.is_foreground()) {
            return Ok(RuntimeSyncRunResult {
                attempted: false,
                advisories_changed: false,
                diagnostics: to_diagnostics(state, app_state.is_foreground()),
            });
        }
    }

    let token = SkillsRegistryClient::resolve_access_token(auth_state)?;
    let client = SkillsRegistryClient::from_env()?;
    let (cursor, changed) = poll_advisories(&client, &token, state.cursor.clone()).await?;
    write_success_state(db, &sync_kind, cursor.clone()).await?;

    let diagnostics = get_runtime_sync_diagnostics(db, app_state).await?;
    if changed {
        eprintln!(
            "[RUNTIME_SYNC] sync kind={} applied new advisory data",
            sync_kind_label(&sync_kind)
        );
    }

    Ok(RuntimeSyncRunResult {
        attempted: true,
        advisories_changed: changed,
        diagnostics: RuntimeSyncDiagnostics { cursor, ..diagnostics },
    })
}

fn is_due_for_kind(
    state: &AdvisorySyncStateRow,
    now_ms: i64,
    kind: &SyncKind,
    app_is_foreground: bool,
) -> bool {
    match kind {
        SyncKind::Control => is_due(state.last_control_sync_at_ms, now_ms, CONTROL_SYNC_SECONDS),
        SyncKind::App => {
            let cadence = if app_is_foreground {
                FOREGROUND_SYNC_SECONDS
            } else {
                BACKGROUND_SYNC_SECONDS
            };
            is_due(state.last_app_sync_at_ms, now_ms, cadence)
        }
        SyncKind::Immediate(_) => true,
    }
}

fn is_due(last_sync_ms: Option<i64>, now_ms: i64, cadence_seconds: i64) -> bool {
    match last_sync_ms {
        None => true,
        Some(last_sync) => now_ms.saturating_sub(last_sync) >= cadence_seconds * 1000,
    }
}

fn sync_kind_label(kind: &SyncKind) -> String {
    match kind {
        SyncKind::Control => "control".to_string(),
        SyncKind::App => "app".to_string(),
        SyncKind::Immediate(reason) => format!("immediate:{reason}"),
    }
}

async fn poll_advisories(
    client: &SkillsRegistryClient,
    token: &str,
    start_cursor: Option<String>,
) -> Result<(Option<String>, bool), String> {
    let mut cursor = start_cursor;
    let mut advisories_changed = false;
    for _ in 0..10 {
        let response = client
            .advisory_feed(token, cursor.clone(), Some(200))
            .await?;
        if !response.data.is_empty() {
            advisories_changed = true;
        }
        let next_cursor = response.page.next_cursor.clone();
        let should_stop = !response.page.has_more || next_cursor == cursor;
        cursor = next_cursor;
        if should_stop {
            break;
        }
    }
    Ok((cursor, advisories_changed))
}

async fn load_state_row(db: &DatabaseConnection) -> Result<AdvisorySyncStateRow, String> {
    let row = db
        .query_one(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            r#"
            SELECT
                cursor,
                (EXTRACT(EPOCH FROM last_success_at) * 1000)::bigint AS last_success_at_ms,
                (EXTRACT(EPOCH FROM last_attempt_at) * 1000)::bigint AS last_attempt_at_ms,
                (EXTRACT(EPOCH FROM last_control_sync_at) * 1000)::bigint AS last_control_sync_at_ms,
                (EXTRACT(EPOCH FROM last_app_sync_at) * 1000)::bigint AS last_app_sync_at_ms,
                (EXTRACT(EPOCH FROM next_retry_at) * 1000)::bigint AS next_retry_at_ms,
                consecutive_failures,
                next_backoff_seconds,
                last_error
            FROM advisory_sync_state
            WHERE state_key = $1::text
            LIMIT 1
            "#,
            vec![SYNC_STATE_KEY.to_string().into()],
        ))
        .await
        .map_err(|error| format!("Failed loading advisory sync state: {error}"))?
        .ok_or_else(|| "Advisory sync state row is missing.".to_string())?;

    Ok(AdvisorySyncStateRow {
        cursor: row
            .try_get("", "cursor")
            .map_err(|error| format!("Failed decoding advisory sync cursor: {error}"))?,
        last_success_at_ms: row
            .try_get("", "last_success_at_ms")
            .map_err(|error| format!("Failed decoding last_success_at_ms: {error}"))?,
        last_attempt_at_ms: row
            .try_get("", "last_attempt_at_ms")
            .map_err(|error| format!("Failed decoding last_attempt_at_ms: {error}"))?,
        last_control_sync_at_ms: row
            .try_get("", "last_control_sync_at_ms")
            .map_err(|error| format!("Failed decoding last_control_sync_at_ms: {error}"))?,
        last_app_sync_at_ms: row
            .try_get("", "last_app_sync_at_ms")
            .map_err(|error| format!("Failed decoding last_app_sync_at_ms: {error}"))?,
        next_retry_at_ms: row
            .try_get("", "next_retry_at_ms")
            .map_err(|error| format!("Failed decoding next_retry_at_ms: {error}"))?,
        consecutive_failures: row
            .try_get("", "consecutive_failures")
            .map_err(|error| format!("Failed decoding consecutive_failures: {error}"))?,
        next_backoff_seconds: row
            .try_get("", "next_backoff_seconds")
            .map_err(|error| format!("Failed decoding next_backoff_seconds: {error}"))?,
        last_error: row
            .try_get("", "last_error")
            .map_err(|error| format!("Failed decoding last_error: {error}"))?,
    })
}

async fn write_success_state(
    db: &DatabaseConnection,
    kind: &SyncKind,
    cursor: Option<String>,
) -> Result<(), String> {
    let (control_sql, app_sql) = match kind {
        SyncKind::Control => ("last_control_sync_at = NOW(),", ""),
        SyncKind::App => ("", "last_app_sync_at = NOW(),"),
        SyncKind::Immediate(_) => ("last_control_sync_at = NOW(),", "last_app_sync_at = NOW(),"),
    };
    db.execute(Statement::from_sql_and_values(
        DatabaseBackend::Postgres,
        format!(
            r#"
            UPDATE advisory_sync_state
            SET
                cursor = $1::text,
                last_success_at = NOW(),
                last_attempt_at = NOW(),
                {control_sql}
                {app_sql}
                next_retry_at = NULL,
                consecutive_failures = 0,
                next_backoff_seconds = 0,
                last_error = NULL,
                updated_at = NOW()
            WHERE state_key = $2::text
            "#
        ),
        vec![cursor.into(), SYNC_STATE_KEY.to_string().into()],
    ))
    .await
    .map_err(|error| format!("Failed writing advisory sync success state: {error}"))?;
    Ok(())
}

pub async fn write_failure_state(
    db: &DatabaseConnection,
    reason: &str,
) -> Result<RuntimeSyncDiagnostics, String> {
    ensure_runtime_sync_state_schema(db).await?;
    let state = load_state_row(db).await?;
    let next_failures = state.consecutive_failures.saturating_add(1);
    let next_backoff_seconds = calculate_next_backoff_seconds(next_failures);
    let jitter_seconds: i64 = rand::thread_rng().gen_range(0..=3);
    let retry_seconds = i64::from(next_backoff_seconds) + jitter_seconds;

    db.execute(Statement::from_sql_and_values(
        DatabaseBackend::Postgres,
        r#"
        UPDATE advisory_sync_state
        SET
            last_attempt_at = NOW(),
            next_retry_at = NOW() + ($1::text || ' seconds')::interval,
            consecutive_failures = $2::integer,
            next_backoff_seconds = $3::integer,
            last_error = $4::text,
            updated_at = NOW()
        WHERE state_key = $5::text
        "#,
        vec![
            retry_seconds.to_string().into(),
            next_failures.into(),
            next_backoff_seconds.into(),
            reason.to_string().into(),
            SYNC_STATE_KEY.to_string().into(),
        ],
    ))
    .await
    .map_err(|error| format!("Failed writing advisory sync failure state: {error}"))?;

    let app_state = RuntimeSyncAppState::default();
    get_runtime_sync_diagnostics(db, &app_state).await
}

fn calculate_next_backoff_seconds(consecutive_failures: i32) -> i32 {
    let exponent = consecutive_failures.clamp(1, 6) - 1;
    let computed = 5_i64.saturating_mul(1_i64 << exponent);
    computed.min(MAX_BACKOFF_SECONDS) as i32
}

fn to_diagnostics(state: AdvisorySyncStateRow, app_is_foreground: bool) -> RuntimeSyncDiagnostics {
    let now_ms = chrono::Utc::now().timestamp_millis();
    let freshness = classify_runtime_sync_freshness(state.last_success_at_ms, now_ms);
    RuntimeSyncDiagnostics {
        freshness: freshness.as_str().to_string(),
        app_is_foreground,
        cursor: state.cursor,
        last_success_at_ms: state.last_success_at_ms,
        last_attempt_at_ms: state.last_attempt_at_ms,
        last_control_sync_at_ms: state.last_control_sync_at_ms,
        last_app_sync_at_ms: state.last_app_sync_at_ms,
        next_retry_at_ms: state.next_retry_at_ms,
        consecutive_failures: state.consecutive_failures,
        next_backoff_seconds: state.next_backoff_seconds,
        last_error: state.last_error,
    }
}

#[cfg(test)]
mod tests {
    use super::{
        BACKGROUND_SYNC_SECONDS, FOREGROUND_SYNC_SECONDS, RuntimeSyncFreshness,
        calculate_next_backoff_seconds, classify_runtime_sync_freshness, is_due,
    };

    #[test]
    fn classify_runtime_sync_freshness_uses_expected_windows() {
        let now_ms = 10 * 60 * 1000;
        assert!(matches!(
            classify_runtime_sync_freshness(Some(now_ms - 30_000), now_ms),
            RuntimeSyncFreshness::Fresh
        ));
        assert!(matches!(
            classify_runtime_sync_freshness(Some(now_ms - (3 * 60 * 1000)), now_ms),
            RuntimeSyncFreshness::SoftStale
        ));
        assert!(matches!(
            classify_runtime_sync_freshness(Some(now_ms - (15 * 60 * 1000)), now_ms),
            RuntimeSyncFreshness::HardStale
        ));
        assert!(matches!(
            classify_runtime_sync_freshness(None, now_ms),
            RuntimeSyncFreshness::HardStale
        ));
    }

    #[test]
    fn backoff_is_exponential_and_capped() {
        assert_eq!(calculate_next_backoff_seconds(1), 5);
        assert_eq!(calculate_next_backoff_seconds(2), 10);
        assert_eq!(calculate_next_backoff_seconds(3), 20);
        assert_eq!(calculate_next_backoff_seconds(4), 40);
        assert_eq!(calculate_next_backoff_seconds(12), 300);
    }

    #[test]
    fn due_check_respects_cadence() {
        let now_ms = 200_000;
        assert!(is_due(None, now_ms, FOREGROUND_SYNC_SECONDS));
        assert!(!is_due(
            Some(now_ms - (FOREGROUND_SYNC_SECONDS * 1000) + 1),
            now_ms,
            FOREGROUND_SYNC_SECONDS
        ));
        assert!(is_due(
            Some(now_ms - (BACKGROUND_SYNC_SECONDS * 1000)),
            now_ms,
            BACKGROUND_SYNC_SECONDS
        ));
    }
}
