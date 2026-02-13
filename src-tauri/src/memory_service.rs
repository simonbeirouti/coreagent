use sea_orm::{ConnectionTrait, DatabaseBackend, DatabaseConnection, Statement};
use serde::{Deserialize, Serialize};
use std::time::Instant;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SimilarMessage {
    pub message_id: Uuid,
    pub conversation_id: Uuid,
    pub role: String,
    pub content: String,
    pub similarity: f32,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryRetrievalQualitySummary {
    pub total_events: i64,
    pub hit_rate: f32,
    pub no_hit_rate: f32,
    pub avg_result_count: f32,
    pub avg_top_similarity: f32,
    pub avg_similarity: f32,
    pub p95_latency_ms: f32,
    pub last_retrieval_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryRetrievalTimeseriesPoint {
    pub date: String,
    pub hit_count: i32,
    pub no_hit_count: i32,
    pub hit_rate: f32,
    pub avg_top_similarity: f32,
    pub p95_latency_ms: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RetrievalEvalResult {
    pub queries_tested: i32,
    pub hit_count: i32,
    pub hit_rate: f32,
    pub avg_top_similarity: f32,
    pub generated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RetrievalQualityValidation {
    pub sample_size: i64,
    pub hit_rate: f32,
    pub avg_top_similarity: f32,
    pub p95_latency_ms: f32,
    pub hit_rate_stddev: f32,
    pub judged_precision: Option<f32>,
    pub quality_score: f32,
    pub passes_guardrails: bool,
    pub reasons: Vec<String>,
    pub source_mix: serde_json::Value,
    pub confidence_target: f32,
    pub confidence_scored_sample_size: i64,
    pub confidence_above_target_count: i64,
    pub confidence_above_target_ratio: f32,
    pub evaluated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RetrievalTuningDecision {
    pub created_at: String,
    pub status: String,
    pub previous_threshold: f32,
    pub next_threshold: f32,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RetrievalTuningStatus {
    pub current_threshold: f32,
    pub min_threshold: f32,
    pub max_threshold: f32,
    pub auto_tune_enabled: bool,
    pub cooldown_minutes: i32,
    pub last_tuned_at: Option<String>,
    pub last_decision_reason: Option<String>,
    pub quality: RetrievalQualityValidation,
    pub recent_decisions: Vec<RetrievalTuningDecision>,
}

#[derive(Debug, Clone)]
struct RetrievalTuningState {
    similarity_threshold: f32,
    min_threshold: f32,
    max_threshold: f32,
    last_tuned_at: Option<chrono::DateTime<chrono::Utc>>,
    last_decision_reason: Option<String>,
}

pub struct MemoryService;

impl MemoryService {
    const DEFAULT_SIMILARITY_THRESHOLD: f32 = 0.70;
    const DEFAULT_MIN_SIMILARITY_THRESHOLD: f32 = 0.55;
    const DEFAULT_MAX_SIMILARITY_THRESHOLD: f32 = 0.90;
    const AUTO_TUNE_COOLDOWN_MINUTES: i64 = 30;
    const AUTO_TUNE_WINDOW_DAYS: i32 = 7;
    const AUTO_TUNE_MIN_EVENTS: i64 = 24;
    const AUTO_TUNE_STEP: f32 = 0.02;
    const QUALITY_CONFIDENCE_TARGET: f32 = 0.70;

    fn retrieval_telemetry_enabled() -> bool {
        std::env::var("RETRIEVAL_TELEMETRY")
            .ok()
            .map(|v| matches!(v.trim().to_ascii_lowercase().as_str(), "1" | "true" | "yes" | "on"))
            .unwrap_or(true)
    }

    fn retrieval_auto_tune_enabled() -> bool {
        std::env::var("RETRIEVAL_AUTO_TUNE")
            .ok()
            .map(|v| matches!(v.trim().to_ascii_lowercase().as_str(), "1" | "true" | "yes" | "on"))
            .unwrap_or(true)
    }

    fn compact_search_text(text: &str) -> String {
        text.chars()
            .filter(|c| c.is_ascii_alphanumeric())
            .flat_map(|c| c.to_lowercase())
            .collect()
    }

    fn to_vector_literal(values: &[f32]) -> String {
        format!(
            "[{}]",
            values
                .iter()
                .map(|v| v.to_string())
                .collect::<Vec<_>>()
                .join(",")
        )
    }

    async fn get_or_create_tuning_state(
        db: &DatabaseConnection,
        agent_id: Uuid,
    ) -> Result<RetrievalTuningState, String> {
        let select_sql = r#"
            SELECT
                similarity_threshold,
                min_threshold,
                max_threshold,
                last_tuned_at,
                last_decision_reason
            FROM retrieval_tuning_state
            WHERE agent_id = $1::uuid
        "#;
        if let Some(row) = db
            .query_one(Statement::from_sql_and_values(
                DatabaseBackend::Postgres,
                select_sql,
                vec![agent_id.into()],
            ))
            .await
            .map_err(|e| format!("Failed loading retrieval tuning state: {e}"))?
        {
            return Ok(RetrievalTuningState {
                similarity_threshold: row
                    .try_get::<f64>("", "similarity_threshold")
                    .map_err(|e| format!("Failed decoding tuning similarity_threshold: {e}"))?
                    as f32,
                min_threshold: row
                    .try_get::<f64>("", "min_threshold")
                    .map_err(|e| format!("Failed decoding tuning min_threshold: {e}"))?
                    as f32,
                max_threshold: row
                    .try_get::<f64>("", "max_threshold")
                    .map_err(|e| format!("Failed decoding tuning max_threshold: {e}"))?
                    as f32,
                last_tuned_at: row
                    .try_get::<Option<chrono::DateTime<chrono::FixedOffset>>>("", "last_tuned_at")
                    .map_err(|e| format!("Failed decoding tuning last_tuned_at: {e}"))?
                    .map(|v| v.with_timezone(&chrono::Utc)),
                last_decision_reason: row
                    .try_get::<Option<String>>("", "last_decision_reason")
                    .map_err(|e| format!("Failed decoding tuning last_decision_reason: {e}"))?,
            });
        }

        db.execute(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            r#"
                INSERT INTO retrieval_tuning_state (
                    agent_id,
                    similarity_threshold,
                    min_threshold,
                    max_threshold,
                    updated_at
                )
                VALUES ($1::uuid, $2::float, $3::float, $4::float, NOW())
                ON CONFLICT (agent_id) DO NOTHING
            "#,
            vec![
                agent_id.into(),
                (Self::DEFAULT_SIMILARITY_THRESHOLD as f64).into(),
                (Self::DEFAULT_MIN_SIMILARITY_THRESHOLD as f64).into(),
                (Self::DEFAULT_MAX_SIMILARITY_THRESHOLD as f64).into(),
            ],
        ))
        .await
        .map_err(|e| format!("Failed initializing retrieval tuning state: {e}"))?;

        let row = db
            .query_one(Statement::from_sql_and_values(
                DatabaseBackend::Postgres,
                select_sql,
                vec![agent_id.into()],
            ))
            .await
            .map_err(|e| format!("Failed reloading retrieval tuning state: {e}"))?
            .ok_or_else(|| "Retrieval tuning state initialization returned no row".to_string())?;

        Ok(RetrievalTuningState {
            similarity_threshold: row
                .try_get::<f64>("", "similarity_threshold")
                .map_err(|e| format!("Failed decoding tuning similarity_threshold: {e}"))?
                as f32,
            min_threshold: row
                .try_get::<f64>("", "min_threshold")
                .map_err(|e| format!("Failed decoding tuning min_threshold: {e}"))?
                as f32,
            max_threshold: row
                .try_get::<f64>("", "max_threshold")
                .map_err(|e| format!("Failed decoding tuning max_threshold: {e}"))?
                as f32,
            last_tuned_at: row
                .try_get::<Option<chrono::DateTime<chrono::FixedOffset>>>("", "last_tuned_at")
                .map_err(|e| format!("Failed decoding tuning last_tuned_at: {e}"))?
                .map(|v| v.with_timezone(&chrono::Utc)),
            last_decision_reason: row
                .try_get::<Option<String>>("", "last_decision_reason")
                .map_err(|e| format!("Failed decoding tuning last_decision_reason: {e}"))?,
        })
    }

    async fn persist_tuning_event(
        db: &DatabaseConnection,
        agent_id: Uuid,
        previous_threshold: f32,
        next_threshold: f32,
        status: &str,
        reason: Option<&str>,
        quality_summary: serde_json::Value,
        guardrail_flags: serde_json::Value,
    ) -> Result<(), String> {
        db.execute(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            r#"
                INSERT INTO retrieval_tuning_events (
                    id,
                    agent_id,
                    previous_threshold,
                    next_threshold,
                    status,
                    reason,
                    quality_summary,
                    guardrail_flags,
                    created_at
                )
                VALUES (
                    gen_random_uuid(),
                    $1::uuid,
                    $2::float,
                    $3::float,
                    $4::text,
                    $5::text,
                    $6::jsonb,
                    $7::jsonb,
                    NOW()
                )
            "#,
            vec![
                agent_id.into(),
                (previous_threshold as f64).into(),
                (next_threshold as f64).into(),
                status.to_string().into(),
                reason.map(|v| v.to_string()).into(),
                quality_summary.to_string().into(),
                guardrail_flags.to_string().into(),
            ],
        ))
        .await
        .map_err(|e| format!("Failed persisting retrieval tuning event: {e}"))?;
        Ok(())
    }

    async fn evaluate_retrieval_quality_window(
        db: &DatabaseConnection,
        agent_id: Uuid,
        days: i32,
    ) -> Result<RetrievalQualityValidation, String> {
        let days = days.clamp(1, 30);
        let summary_sql = r#"
            SELECT
                COUNT(*)::bigint AS sample_size,
                COALESCE(AVG(CASE WHEN result_count > 0 THEN 1.0 ELSE 0.0 END), 0)::float AS hit_rate,
                COALESCE(AVG(top_similarity), 0)::float AS avg_top_similarity,
                COALESCE(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latency_ms), 0)::float AS p95_latency_ms,
                COALESCE(AVG(CASE WHEN mrj.judgment_type = 'positive' THEN 1.0 WHEN mrj.judgment_type = 'negative' THEN 0.0 ELSE NULL END), NULL)::float AS judged_precision
            FROM memory_retrieval_events mre
            LEFT JOIN memory_retrieval_judgments mrj ON mrj.event_id = mre.id
            WHERE mre.agent_id = $1::uuid
              AND mre.created_at >= NOW() - (($2::int || ' days')::interval)
        "#;
        let summary_row = db
            .query_one(Statement::from_sql_and_values(
                DatabaseBackend::Postgres,
                summary_sql,
                vec![agent_id.into(), days.into()],
            ))
            .await
            .map_err(|e| format!("Failed evaluating retrieval quality summary: {e}"))?
            .ok_or_else(|| "No retrieval quality summary row returned".to_string())?;

        let stddev_sql = r#"
            WITH day_hits AS (
                SELECT
                    date_trunc('day', created_at) AS day,
                    AVG(CASE WHEN result_count > 0 THEN 1.0 ELSE 0.0 END) AS hit_rate
                FROM memory_retrieval_events
                WHERE agent_id = $1::uuid
                  AND created_at >= NOW() - (($2::int || ' days')::interval)
                GROUP BY date_trunc('day', created_at)
            )
            SELECT COALESCE(STDDEV_SAMP(hit_rate), 0)::float AS hit_rate_stddev
            FROM day_hits
        "#;
        let stddev_row = db
            .query_one(Statement::from_sql_and_values(
                DatabaseBackend::Postgres,
                stddev_sql,
                vec![agent_id.into(), days.into()],
            ))
            .await
            .map_err(|e| format!("Failed evaluating retrieval hit-rate stability: {e}"))?
            .ok_or_else(|| "No retrieval hit-rate stability row returned".to_string())?;

        let sample_size = summary_row
            .try_get::<i64>("", "sample_size")
            .map_err(|e| format!("Failed decoding quality sample_size: {e}"))?;
        let hit_rate = summary_row
            .try_get::<f64>("", "hit_rate")
            .map_err(|e| format!("Failed decoding quality hit_rate: {e}"))? as f32;
        let avg_top_similarity = summary_row
            .try_get::<f64>("", "avg_top_similarity")
            .map_err(|e| format!("Failed decoding quality avg_top_similarity: {e}"))? as f32;
        let p95_latency_ms = summary_row
            .try_get::<f64>("", "p95_latency_ms")
            .map_err(|e| format!("Failed decoding quality p95_latency_ms: {e}"))? as f32;
        let judged_precision = summary_row
            .try_get::<Option<f64>>("", "judged_precision")
            .map_err(|e| format!("Failed decoding quality judged_precision: {e}"))?
            .map(|v| v as f32);
        let hit_rate_stddev = stddev_row
            .try_get::<f64>("", "hit_rate_stddev")
            .map_err(|e| format!("Failed decoding quality hit_rate_stddev: {e}"))? as f32;
        let source_row = db
            .query_one(Statement::from_sql_and_values(
                DatabaseBackend::Postgres,
                r#"
                    SELECT
                        COUNT(*) FILTER (WHERE provenance = 'user_override')::bigint AS user_override_count,
                        COUNT(*) FILTER (WHERE provenance = 'weighted_blend')::bigint AS weighted_blend_count,
                        COUNT(*) FILTER (WHERE provenance = 'agent_only')::bigint AS agent_only_count,
                        COUNT(*) FILTER (WHERE provenance = 'heuristic_fallback')::bigint AS heuristic_fallback_count
                    FROM message_quality_reconciliation
                    WHERE agent_id = $1::uuid
                      AND updated_at >= NOW() - (($2::int || ' days')::interval)
                "#,
                vec![agent_id.into(), days.into()],
            ))
            .await
            .map_err(|e| format!("Failed loading quality source mix: {e}"))?
            .ok_or_else(|| "No quality source mix row returned".to_string())?;
        let source_mix = serde_json::json!({
            "user_override_count": source_row
                .try_get::<i64>("", "user_override_count")
                .map_err(|e| format!("Failed decoding quality source user_override_count: {e}"))?,
            "weighted_blend_count": source_row
                .try_get::<i64>("", "weighted_blend_count")
                .map_err(|e| format!("Failed decoding quality source weighted_blend_count: {e}"))?,
            "agent_only_count": source_row
                .try_get::<i64>("", "agent_only_count")
                .map_err(|e| format!("Failed decoding quality source agent_only_count: {e}"))?,
            "heuristic_fallback_count": source_row
                .try_get::<i64>("", "heuristic_fallback_count")
                .map_err(|e| format!("Failed decoding quality source heuristic_fallback_count: {e}"))?,
        });
        let confidence_target = Self::QUALITY_CONFIDENCE_TARGET;
        let confidence_row = db
            .query_one(Statement::from_sql_and_values(
                DatabaseBackend::Postgres,
                r#"
                    SELECT
                        COUNT(*) FILTER (
                            WHERE status IN ('scored', 'reconciled')
                        )::bigint AS confidence_scored_sample_size,
                        COUNT(*) FILTER (
                            WHERE status IN ('scored', 'reconciled')
                              AND confidence >= $3::float
                        )::bigint AS confidence_above_target_count
                    FROM message_quality_labels
                    WHERE agent_id = $1::uuid
                      AND updated_at >= NOW() - (($2::int || ' days')::interval)
                "#,
                vec![
                    agent_id.into(),
                    days.into(),
                    (confidence_target as f64).into(),
                ],
            ))
            .await
            .map_err(|e| format!("Failed loading confidence coverage metrics: {e}"))?
            .ok_or_else(|| "No confidence coverage row returned".to_string())?;
        let confidence_scored_sample_size = confidence_row
            .try_get::<i64>("", "confidence_scored_sample_size")
            .map_err(|e| format!("Failed decoding confidence scored sample size: {e}"))?;
        let confidence_above_target_count = confidence_row
            .try_get::<i64>("", "confidence_above_target_count")
            .map_err(|e| format!("Failed decoding confidence above-target count: {e}"))?;
        let confidence_above_target_ratio = if confidence_scored_sample_size > 0 {
            (confidence_above_target_count as f32 / confidence_scored_sample_size as f32).clamp(0.0, 1.0)
        } else {
            0.0
        };

        let latency_score = if p95_latency_ms <= 180.0 {
            1.0
        } else if p95_latency_ms >= 600.0 {
            0.0
        } else {
            1.0 - ((p95_latency_ms - 180.0) / 420.0)
        };
        let stability_score = (1.0 - (hit_rate_stddev / 0.30)).clamp(0.0, 1.0);
        let precision_score = judged_precision.unwrap_or(0.60).clamp(0.0, 1.0);
        let quality_score = (
            (hit_rate.clamp(0.0, 1.0) * 0.35)
                + (avg_top_similarity.clamp(0.0, 1.0) * 0.30)
                + (latency_score * 0.20)
                + (stability_score * 0.10)
                + (precision_score * 0.05)
        )
        .clamp(0.0, 1.0);

        let mut reasons = Vec::new();
        if sample_size < Self::AUTO_TUNE_MIN_EVENTS {
            reasons.push("insufficient_sample_size".to_string());
        }
        if hit_rate < 0.35 {
            reasons.push("low_hit_rate".to_string());
        }
        if avg_top_similarity < 0.75 {
            reasons.push("low_top_similarity".to_string());
        }
        if p95_latency_ms > 500.0 {
            reasons.push("high_latency".to_string());
        }
        if hit_rate_stddev > 0.18 {
            reasons.push("unstable_hit_rate".to_string());
        }
        if let Some(precision) = judged_precision {
            if precision < 0.45 {
                reasons.push("low_judged_precision".to_string());
            }
        }
        let passes_guardrails = reasons.is_empty();

        Ok(RetrievalQualityValidation {
            sample_size,
            hit_rate,
            avg_top_similarity,
            p95_latency_ms,
            hit_rate_stddev,
            judged_precision,
            quality_score,
            passes_guardrails,
            reasons,
            source_mix,
            confidence_target,
            confidence_scored_sample_size,
            confidence_above_target_count,
            confidence_above_target_ratio,
            evaluated_at: chrono::Utc::now().to_rfc3339(),
        })
    }

    async fn run_auto_tuning_cycle(
        db: &DatabaseConnection,
        agent_id: Uuid,
    ) -> Result<(), String> {
        if !Self::retrieval_auto_tune_enabled() {
            return Ok(());
        }
        let state = Self::get_or_create_tuning_state(db, agent_id).await?;
        let quality = Self::evaluate_retrieval_quality_window(db, agent_id, Self::AUTO_TUNE_WINDOW_DAYS).await?;

        let mut guardrail_flags = serde_json::json!({
            "cooldown_minutes": Self::AUTO_TUNE_COOLDOWN_MINUTES,
            "sample_size": quality.sample_size,
            "passes_quality_guardrails": quality.passes_guardrails,
            "quality_reasons": quality.reasons,
        });
        if let Some(last_tuned_at) = state.last_tuned_at {
            let since = chrono::Utc::now() - last_tuned_at;
            if since < chrono::Duration::minutes(Self::AUTO_TUNE_COOLDOWN_MINUTES) {
                let reason = "cooldown_active";
                guardrail_flags["minutes_since_last_tuned"] = serde_json::json!(since.num_minutes());
                Self::persist_tuning_event(
                    db,
                    agent_id,
                    state.similarity_threshold,
                    state.similarity_threshold,
                    "skipped",
                    Some(reason),
                    serde_json::to_value(&quality).unwrap_or_else(|_| serde_json::json!({})),
                    guardrail_flags,
                )
                .await?;
                return Ok(());
            }
        }
        if quality.sample_size < Self::AUTO_TUNE_MIN_EVENTS || !quality.passes_guardrails {
            let reason = "quality_guardrail_blocked";
            Self::persist_tuning_event(
                db,
                agent_id,
                state.similarity_threshold,
                state.similarity_threshold,
                "skipped",
                Some(reason),
                serde_json::to_value(&quality).unwrap_or_else(|_| serde_json::json!({})),
                guardrail_flags,
            )
            .await?;
            return Ok(());
        }

        let mut direction: f32 = 0.0;
        let mut reason = "steady_state";
        if quality.hit_rate < 0.45 && quality.avg_top_similarity < 0.84 {
            direction = -Self::AUTO_TUNE_STEP;
            reason = "improve_recall";
        } else if quality.hit_rate > 0.82
            && quality.avg_top_similarity > 0.90
            && quality.judged_precision.unwrap_or(0.60) > 0.55
        {
            direction = Self::AUTO_TUNE_STEP;
            reason = "improve_precision";
        }
        if direction.abs() < f32::EPSILON {
            Self::persist_tuning_event(
                db,
                agent_id,
                state.similarity_threshold,
                state.similarity_threshold,
                "skipped",
                Some(reason),
                serde_json::to_value(&quality).unwrap_or_else(|_| serde_json::json!({})),
                guardrail_flags,
            )
            .await?;
            return Ok(());
        }

        let next_threshold = (state.similarity_threshold + direction)
            .clamp(state.min_threshold, state.max_threshold);
        let status = if (next_threshold - state.similarity_threshold).abs() < f32::EPSILON {
            "skipped"
        } else {
            "applied"
        };
        Self::persist_tuning_event(
            db,
            agent_id,
            state.similarity_threshold,
            next_threshold,
            status,
            Some(reason),
            serde_json::to_value(&quality).unwrap_or_else(|_| serde_json::json!({})),
            guardrail_flags.clone(),
        )
        .await?;
        if status == "applied" {
            db.execute(Statement::from_sql_and_values(
                DatabaseBackend::Postgres,
                r#"
                    UPDATE retrieval_tuning_state
                    SET
                        similarity_threshold = $2::float,
                        last_tuned_at = NOW(),
                        last_decision_reason = $3::text,
                        updated_at = NOW()
                    WHERE agent_id = $1::uuid
                "#,
                vec![
                    agent_id.into(),
                    (next_threshold as f64).into(),
                    reason.to_string().into(),
                ],
            ))
            .await
            .map_err(|e| format!("Failed applying retrieval threshold tuning update: {e}"))?;
            eprintln!(
                "[MEMORY] Auto-tuned similarity threshold: agent_id={} previous={} next={} reason={}",
                agent_id, state.similarity_threshold, next_threshold, reason
            );
        }

        Ok(())
    }

    pub async fn get_retrieval_tuning_status(
        db: &DatabaseConnection,
        agent_id: Uuid,
    ) -> Result<RetrievalTuningStatus, String> {
        let state = Self::get_or_create_tuning_state(db, agent_id).await?;
        let quality = Self::evaluate_retrieval_quality_window(db, agent_id, Self::AUTO_TUNE_WINDOW_DAYS).await?;
        let rows = db
            .query_all(Statement::from_sql_and_values(
                DatabaseBackend::Postgres,
                r#"
                    SELECT
                        created_at::text AS created_at,
                        status,
                        previous_threshold,
                        next_threshold,
                        reason
                    FROM retrieval_tuning_events
                    WHERE agent_id = $1::uuid
                    ORDER BY created_at DESC
                    LIMIT 8
                "#,
                vec![agent_id.into()],
            ))
            .await
            .map_err(|e| format!("Failed loading retrieval tuning decision history: {e}"))?;
        let mut recent_decisions = Vec::with_capacity(rows.len());
        for row in rows {
            recent_decisions.push(RetrievalTuningDecision {
                created_at: row
                    .try_get("", "created_at")
                    .map_err(|e| format!("Failed decoding tuning decision created_at: {e}"))?,
                status: row
                    .try_get("", "status")
                    .map_err(|e| format!("Failed decoding tuning decision status: {e}"))?,
                previous_threshold: row
                    .try_get::<f64>("", "previous_threshold")
                    .map_err(|e| format!("Failed decoding tuning decision previous_threshold: {e}"))?
                    as f32,
                next_threshold: row
                    .try_get::<f64>("", "next_threshold")
                    .map_err(|e| format!("Failed decoding tuning decision next_threshold: {e}"))?
                    as f32,
                reason: row
                    .try_get::<Option<String>>("", "reason")
                    .map_err(|e| format!("Failed decoding tuning decision reason: {e}"))?,
            });
        }

        Ok(RetrievalTuningStatus {
            current_threshold: state.similarity_threshold,
            min_threshold: state.min_threshold,
            max_threshold: state.max_threshold,
            auto_tune_enabled: Self::retrieval_auto_tune_enabled(),
            cooldown_minutes: Self::AUTO_TUNE_COOLDOWN_MINUTES as i32,
            last_tuned_at: state.last_tuned_at.map(|v| v.to_rfc3339()),
            last_decision_reason: state.last_decision_reason,
            quality,
            recent_decisions,
        })
    }

    pub async fn generate_embedding(text: &str) -> Result<Vec<f32>, String> {
        let api_key = std::env::var("OPENAI_API_KEY")
            .map_err(|_| "OPENAI_API_KEY is not set; cannot generate embeddings".to_string())?;

        let client = reqwest::Client::new();
        let response = client
            .post("https://api.openai.com/v1/embeddings")
            .bearer_auth(api_key)
            .header("Content-Type", "application/json")
            .json(&serde_json::json!({
                "model": "text-embedding-3-small",
                "input": text
            }))
            .send()
            .await
            .map_err(|e| format!("Embedding request failed: {e}"))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(format!("Embedding request failed ({status}): {body}"));
        }

        let body: serde_json::Value = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse embedding response: {e}"))?;

        let embedding = body
            .get("data")
            .and_then(|v| v.as_array())
            .and_then(|arr| arr.first())
            .and_then(|v| v.get("embedding"))
            .and_then(|v| v.as_array())
            .ok_or_else(|| "Embedding response missing data[0].embedding".to_string())?;

        let mut out = Vec::with_capacity(embedding.len());
        for item in embedding {
            let value = item
                .as_f64()
                .ok_or_else(|| "Embedding contains non-numeric value".to_string())?;
            out.push(value as f32);
        }
        Ok(out)
    }

    pub async fn store_message_embedding(
        db: &DatabaseConnection,
        message_id: Uuid,
        embedding: &[f32],
    ) -> Result<(), String> {
        let vector_literal = Self::to_vector_literal(embedding);
        let embedding_json = serde_json::to_string(embedding)
            .map_err(|e| format!("Failed to serialize embedding json: {e}"))?;

        let sql = r#"
            INSERT INTO message_embeddings (id, message_id, embedding, embedding_json, created_at)
            VALUES (gen_random_uuid(), $1::uuid, $2::vector, $3::jsonb, NOW())
            ON CONFLICT (message_id)
            DO UPDATE SET
                embedding = EXCLUDED.embedding,
                embedding_json = EXCLUDED.embedding_json
        "#;

        db.execute(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            sql,
            vec![
                message_id.into(),
                vector_literal.into(),
                embedding_json.into(),
            ],
        ))
        .await
        .map_err(|e| format!("Failed to store embedding: {e}"))?;

        Ok(())
    }

    pub async fn embed_message_content(
        db: &DatabaseConnection,
        message_id: Uuid,
        content: &str,
    ) -> Result<(), String> {
        if content.trim().is_empty() {
            return Ok(());
        }

        let embedding = Self::generate_embedding(content).await?;
        Self::store_message_embedding(db, message_id, &embedding).await
    }

    pub async fn search_similar_messages(
        db: &DatabaseConnection,
        query: &str,
        agent_id: Uuid,
        current_conversation_id: Option<Uuid>,
        limit: usize,
    ) -> Result<Vec<SimilarMessage>, String> {
        Self::search_similar_messages_internal(
            db,
            query,
            agent_id,
            current_conversation_id,
            limit,
            false,
        )
        .await
    }

    async fn search_similar_messages_internal(
        db: &DatabaseConnection,
        query: &str,
        agent_id: Uuid,
        current_conversation_id: Option<Uuid>,
        limit: usize,
        used_in_response: bool,
    ) -> Result<Vec<SimilarMessage>, String> {
        let started = Instant::now();
        let tuning_state = Self::get_or_create_tuning_state(db, agent_id).await?;
        let similarity_threshold = tuning_state
            .similarity_threshold
            .clamp(tuning_state.min_threshold, tuning_state.max_threshold);
        let query_embedding = Self::generate_embedding(query).await?;
        let vector_literal = Self::to_vector_literal(&query_embedding);
        let text_match_pattern = format!("%{}%", query);
        let compact_query = Self::compact_search_text(query);
        let compact_text_match_pattern = format!("%{}%", compact_query);

        let sql = r#"
            SELECT
                m.id AS message_id,
                m.conversation_id,
                m.role,
                m.content,
                COALESCE((1 - (me.embedding <=> $1::vector))::float, 0.0) AS similarity,
                m.created_at::text AS created_at
            FROM messages m
            JOIN conversations c ON c.id = m.conversation_id
            LEFT JOIN message_embeddings me ON m.id = me.message_id
            WHERE c.agent_id = $2::uuid
              AND ($3::uuid IS NULL OR m.conversation_id <> $3::uuid)
              AND m.role IN ('user', 'assistant')
              AND (
                (me.embedding IS NOT NULL AND (1 - (me.embedding <=> $1::vector)) >= $7::float)
                OR m.content ILIKE $5
                OR regexp_replace(lower(m.content), '[^a-z0-9]+', '', 'g') LIKE $6
              )
            ORDER BY
              CASE
                WHEN m.content ILIKE $5 THEN 0
                WHEN regexp_replace(lower(m.content), '[^a-z0-9]+', '', 'g') LIKE $6 THEN 1
                ELSE 2
              END,
              me.embedding <=> $1::vector NULLS LAST,
              m.created_at DESC
            LIMIT $4
        "#;

        let rows = db
            .query_all(Statement::from_sql_and_values(
                DatabaseBackend::Postgres,
                sql,
                vec![
                    vector_literal.into(),
                    agent_id.into(),
                    current_conversation_id.into(),
                    (limit as i64).into(),
                    text_match_pattern.into(),
                    compact_text_match_pattern.into(),
                    (similarity_threshold as f64).into(),
                ],
            ))
            .await
            .map_err(|e| format!("Failed to search similar messages: {e}"))?;

        let mut out = Vec::with_capacity(rows.len());
        for row in rows {
            let similarity = row
                .try_get::<Option<f64>>("", "similarity")
                .map_err(|e| format!("Failed to decode similarity: {e}"))?
                .unwrap_or(0.0) as f32;

            out.push(SimilarMessage {
                message_id: row
                    .try_get("", "message_id")
                    .map_err(|e| format!("Failed to decode message_id: {e}"))?,
                conversation_id: row
                    .try_get("", "conversation_id")
                    .map_err(|e| format!("Failed to decode conversation_id: {e}"))?,
                role: row
                    .try_get("", "role")
                    .map_err(|e| format!("Failed to decode role: {e}"))?,
                content: row
                    .try_get("", "content")
                    .map_err(|e| format!("Failed to decode content: {e}"))?,
                similarity,
                created_at: row
                    .try_get("", "created_at")
                    .map_err(|e| format!("Failed to decode created_at: {e}"))?,
            });
        }

        let result_count = out.len() as i32;
        let top_similarity = out
            .iter()
            .map(|m| m.similarity)
            .max_by(|a, b| a.total_cmp(b))
            .unwrap_or(0.0);
        let avg_similarity = if out.is_empty() {
            0.0
        } else {
            out.iter().map(|m| m.similarity).sum::<f32>() / out.len() as f32
        };
        let selected_memory_ids = serde_json::to_string(
            &out.iter()
                .map(|m| m.message_id.to_string())
                .collect::<Vec<String>>(),
        )
        .unwrap_or_else(|_| "[]".to_string());
        let fingerprint = if compact_query.is_empty() {
            "empty".to_string()
        } else {
            compact_query.chars().take(64).collect::<String>()
        };
        let latency_ms = started.elapsed().as_millis() as i32;
        let insert_sql = r#"
            INSERT INTO memory_retrieval_events (
                id,
                agent_id,
                conversation_id,
                query_fingerprint,
                query_length,
                similarity_threshold,
                max_results,
                result_count,
                top_similarity,
                avg_similarity,
                latency_ms,
                selected_memory_ids,
                used_in_response,
                retrieval_mode,
                created_at
            )
            VALUES (
                gen_random_uuid(),
                $1::uuid,
                $2::uuid,
                $3::text,
                $4::int,
                $5::float,
                $6::int,
                $7::int,
                $8::float,
                $9::float,
                $10::int,
                $11::jsonb,
                $12::bool,
                'semantic_hybrid',
                NOW()
            )
        "#;
        if Self::retrieval_telemetry_enabled() {
            if let Err(err) = db
                .execute(Statement::from_sql_and_values(
                    DatabaseBackend::Postgres,
                    insert_sql,
                    vec![
                        agent_id.into(),
                        current_conversation_id.into(),
                        fingerprint.into(),
                        (query.chars().count() as i32).into(),
                        (similarity_threshold as f64).into(),
                        (limit as i32).into(),
                        result_count.into(),
                        (top_similarity as f64).into(),
                        (avg_similarity as f64).into(),
                        latency_ms.into(),
                        selected_memory_ids.into(),
                        used_in_response.into(),
                    ],
                ))
                .await
            {
                eprintln!("[MEMORY] Failed to persist retrieval telemetry: {}", err);
            }
            if let Err(err) = Self::run_auto_tuning_cycle(db, agent_id).await {
                eprintln!(
                    "[MEMORY] Failed to run retrieval auto-tuning cycle for agent {}: {}",
                    agent_id, err
                );
            }
        }

        Ok(out)
    }

    pub async fn get_relevant_context(
        db: &DatabaseConnection,
        query: &str,
        agent_id: Uuid,
        current_conversation_id: Option<Uuid>,
    ) -> Result<Vec<String>, String> {
        let matches = Self::search_similar_messages_internal(
            db,
            query,
            agent_id,
            current_conversation_id,
            4,
            true,
        )
        .await?;

        let contexts = matches
            .into_iter()
            .map(|m| format!("[Memory {:.2}] {}: {}", m.similarity, m.role, m.content))
            .collect::<Vec<_>>();
        Ok(contexts)
    }

    pub async fn get_retrieval_quality_summary(
        db: &DatabaseConnection,
        agent_id: Uuid,
        days: i32,
    ) -> Result<MemoryRetrievalQualitySummary, String> {
        let days = days.clamp(1, 90);
        let sql = r#"
            SELECT
                COUNT(*)::bigint AS total_events,
                COUNT(*) FILTER (WHERE result_count = 0)::bigint AS no_hit_events,
                COALESCE(AVG(result_count), 0)::float AS avg_result_count,
                COALESCE(AVG(top_similarity), 0)::float AS avg_top_similarity,
                COALESCE(AVG(avg_similarity), 0)::float AS avg_similarity,
                COALESCE(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latency_ms), 0)::float AS p95_latency_ms,
                MAX(created_at)::text AS last_retrieval_at
            FROM memory_retrieval_events
            WHERE agent_id = $1::uuid
              AND created_at >= NOW() - (($2::int || ' days')::interval)
        "#;
        let row = db
            .query_one(Statement::from_sql_and_values(
                DatabaseBackend::Postgres,
                sql,
                vec![agent_id.into(), days.into()],
            ))
            .await
            .map_err(|e| format!("Failed loading retrieval quality summary: {e}"))?
            .ok_or_else(|| "No retrieval summary row returned".to_string())?;

        let total_events = row
            .try_get::<i64>("", "total_events")
            .map_err(|e| format!("Failed decoding total_events: {e}"))?;
        let no_hit_events = row
            .try_get::<i64>("", "no_hit_events")
            .map_err(|e| format!("Failed decoding no_hit_events: {e}"))?;
        let hit_rate = if total_events <= 0 {
            0.0
        } else {
            ((total_events - no_hit_events) as f32 / total_events as f32).clamp(0.0, 1.0)
        };
        let no_hit_rate = if total_events <= 0 {
            0.0
        } else {
            (no_hit_events as f32 / total_events as f32).clamp(0.0, 1.0)
        };

        Ok(MemoryRetrievalQualitySummary {
            total_events,
            hit_rate,
            no_hit_rate,
            avg_result_count: row
                .try_get::<f64>("", "avg_result_count")
                .map_err(|e| format!("Failed decoding avg_result_count: {e}"))?
                as f32,
            avg_top_similarity: row
                .try_get::<f64>("", "avg_top_similarity")
                .map_err(|e| format!("Failed decoding avg_top_similarity: {e}"))?
                as f32,
            avg_similarity: row
                .try_get::<f64>("", "avg_similarity")
                .map_err(|e| format!("Failed decoding avg_similarity: {e}"))?
                as f32,
            p95_latency_ms: row
                .try_get::<f64>("", "p95_latency_ms")
                .map_err(|e| format!("Failed decoding p95_latency_ms: {e}"))?
                as f32,
            last_retrieval_at: row
                .try_get::<Option<String>>("", "last_retrieval_at")
                .map_err(|e| format!("Failed decoding last_retrieval_at: {e}"))?,
        })
    }

    pub async fn get_retrieval_quality_timeseries(
        db: &DatabaseConnection,
        agent_id: Uuid,
        days: i32,
    ) -> Result<Vec<MemoryRetrievalTimeseriesPoint>, String> {
        let days = days.clamp(1, 90);
        let sql = r#"
            WITH day_bins AS (
                SELECT generate_series(
                    date_trunc('day', NOW()) - (($2::int - 1 || ' days')::interval),
                    date_trunc('day', NOW()),
                    interval '1 day'
                ) AS day
            ),
            day_events AS (
                SELECT
                    date_trunc('day', created_at) AS day,
                    COUNT(*) FILTER (WHERE result_count > 0) AS hit_count,
                    COUNT(*) FILTER (WHERE result_count = 0) AS no_hit_count,
                    AVG(top_similarity) AS avg_top_similarity,
                    PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latency_ms) AS p95_latency_ms
                FROM memory_retrieval_events
                WHERE agent_id = $1::uuid
                  AND created_at >= NOW() - (($2::int || ' days')::interval)
                GROUP BY date_trunc('day', created_at)
            )
            SELECT
                to_char(day_bins.day::date, 'YYYY-MM-DD') AS date,
                COALESCE(day_events.hit_count, 0)::int AS hit_count,
                COALESCE(day_events.no_hit_count, 0)::int AS no_hit_count,
                COALESCE(day_events.avg_top_similarity, 0)::float AS avg_top_similarity,
                COALESCE(day_events.p95_latency_ms, 0)::float AS p95_latency_ms
            FROM day_bins
            LEFT JOIN day_events ON day_events.day = day_bins.day
            ORDER BY day_bins.day ASC
        "#;

        let rows = db
            .query_all(Statement::from_sql_and_values(
                DatabaseBackend::Postgres,
                sql,
                vec![agent_id.into(), days.into()],
            ))
            .await
            .map_err(|e| format!("Failed loading retrieval quality timeseries: {e}"))?;

        let mut out = Vec::with_capacity(rows.len());
        for row in rows {
            let hit_count = row
                .try_get::<i32>("", "hit_count")
                .map_err(|e| format!("Failed decoding hit_count: {e}"))?;
            let no_hit_count = row
                .try_get::<i32>("", "no_hit_count")
                .map_err(|e| format!("Failed decoding no_hit_count: {e}"))?;
            let total = hit_count + no_hit_count;
            let hit_rate = if total <= 0 {
                0.0
            } else {
                (hit_count as f32 / total as f32).clamp(0.0, 1.0)
            };

            out.push(MemoryRetrievalTimeseriesPoint {
                date: row
                    .try_get("", "date")
                    .map_err(|e| format!("Failed decoding date: {e}"))?,
                hit_count,
                no_hit_count,
                hit_rate,
                avg_top_similarity: row
                    .try_get::<f64>("", "avg_top_similarity")
                    .map_err(|e| format!("Failed decoding avg_top_similarity: {e}"))?
                    as f32,
                p95_latency_ms: row
                    .try_get::<f64>("", "p95_latency_ms")
                    .map_err(|e| format!("Failed decoding p95_latency_ms: {e}"))?
                    as f32,
            });
        }
        Ok(out)
    }

    pub async fn run_retrieval_eval(
        db: &DatabaseConnection,
        agent_id: Uuid,
        sample_size: i32,
    ) -> Result<RetrievalEvalResult, String> {
        let sample_size = sample_size.clamp(5, 100);
        let seed_sql = r#"
            SELECT m.content, m.conversation_id
            FROM messages m
            JOIN conversations c ON c.id = m.conversation_id
            LEFT JOIN message_embeddings me ON me.message_id = m.id
            WHERE c.agent_id = $1::uuid
              AND m.role = 'user'
              AND me.embedding IS NOT NULL
              AND length(trim(m.content)) > 16
            ORDER BY m.created_at DESC
            LIMIT $2
        "#;
        let seed_rows = db
            .query_all(Statement::from_sql_and_values(
                DatabaseBackend::Postgres,
                seed_sql,
                vec![agent_id.into(), (sample_size as i64).into()],
            ))
            .await
            .map_err(|e| format!("Failed to load retrieval eval seed queries: {e}"))?;

        let mut queries_tested = 0_i32;
        let mut hit_count = 0_i32;
        let mut top_similarity_sum = 0.0_f32;

        for row in seed_rows {
            let query: String = row
                .try_get("", "content")
                .map_err(|e| format!("Failed decoding eval seed content: {e}"))?;
            let conversation_id: Uuid = row
                .try_get("", "conversation_id")
                .map_err(|e| format!("Failed decoding eval seed conversation_id: {e}"))?;

            let matches = Self::search_similar_messages_internal(
                db,
                &query,
                agent_id,
                Some(conversation_id),
                5,
                false,
            )
            .await
            .unwrap_or_default();
            queries_tested += 1;
            if let Some(best) = matches
                .iter()
                .map(|m| m.similarity)
                .max_by(|a, b| a.total_cmp(b))
            {
                hit_count += 1;
                top_similarity_sum += best;
            }
        }

        let hit_rate = if queries_tested <= 0 {
            0.0
        } else {
            (hit_count as f32 / queries_tested as f32).clamp(0.0, 1.0)
        };
        let avg_top_similarity = if hit_count <= 0 {
            0.0
        } else {
            top_similarity_sum / hit_count as f32
        };

        Ok(RetrievalEvalResult {
            queries_tested,
            hit_count,
            hit_rate,
            avg_top_similarity,
            generated_at: chrono::Utc::now().to_rfc3339(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::MemoryService;

    #[test]
    fn vector_literal_is_pgvector_compatible() {
        let literal = MemoryService::to_vector_literal(&[0.5, -1.25, 2.0]);
        assert_eq!(literal, "[0.5,-1.25,2]");
    }
}

