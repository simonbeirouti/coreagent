use chrono::Datelike;
use sea_orm::{
    ActiveModelTrait, ActiveValue, ColumnTrait, ConnectionTrait, DatabaseBackend,
    DatabaseConnection, EntityTrait, QueryFilter, QueryOrder, Set, Statement,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use uuid::Uuid;

use crate::entities::{agents, message_feedback, personality_adjustments};

#[derive(Debug, Clone, Deserialize)]
pub struct SubmitFeedbackRequest {
    pub message_id: String,
    pub user_id: String,
    pub feedback_type: String,
    pub feedback_category: Option<String>,
    pub notes: Option<String>,
    #[serde(default)]
    pub dimension_ratings: Option<HashMap<String, String>>,
}

#[derive(Debug, Clone, Serialize)]
pub struct FeedbackStats {
    pub positive: i64,
    pub negative: i64,
    pub neutral: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct FeedbackMonthlyData {
    pub month: String,
    pub positive: i64,
    pub negative: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct PersonalityAdjustmentData {
    pub id: Uuid,
    pub agent_id: Uuid,
    pub trait_name: String,
    pub old_value: f64,
    pub new_value: f64,
    pub reason: Option<String>,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Clone, Serialize)]
pub struct TraitStateData {
    pub agent_id: Uuid,
    pub helpfulness: f32,
    pub formality: f32,
    pub verbosity: f32,
    pub proactivity: f32,
    pub creativity: f32,
    pub empathy: f32,
    pub adaptation_enabled: bool,
    pub updated_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Clone, Serialize)]
pub struct AdaptationCycleData {
    pub id: Uuid,
    pub agent_id: Uuid,
    pub sample_size: i32,
    pub status: String,
    pub reason: Option<String>,
    pub signal_summary: serde_json::Value,
    pub guardrail_flags: serde_json::Value,
    pub applied_changes: serde_json::Value,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Clone)]
struct CategorySignal {
    category: String,
    positive: i64,
    negative: i64,
    neutral: i64,
}

#[derive(Debug, Clone)]
struct DimensionSignal {
    sample_size: i64,
    tone_score: f32,
    verbosity_score: f32,
    helpfulness_score: f32,
    accuracy_score: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MessageQualityLabel {
    pub message_id: Uuid,
    pub agent_id: Uuid,
    pub tone_score: f32,
    pub verbosity_score: f32,
    pub helpfulness_score: f32,
    pub accuracy_score: f32,
    pub confidence: f32,
    pub orchestrator_version: String,
    pub status: String,
    pub rationale: serde_json::Value,
    pub updated_at: chrono::DateTime<chrono::Utc>,
}

pub struct FeedbackService;

#[derive(Debug, Clone)]
struct TraitBaseline {
    helpfulness: f32,
    formality: f32,
    verbosity: f32,
    proactivity: f32,
    creativity: f32,
    empathy: f32,
    source: String,
    version: String,
    context: serde_json::Value,
}

impl FeedbackService {
    const ADAPTATION_WINDOW_DAYS: i64 = 14;
    const ADAPTATION_MIN_TOTAL_FEEDBACK: i64 = 8;
    const ADAPTATION_MIN_DIRECTIONAL_FEEDBACK: i64 = 3;
    const ADAPTATION_STEP_MAX: f32 = 0.08;
    const AUTO_CATEGORY_FALLBACK_FACTOR: f32 = 0.35;
    const ORCHESTRATOR_BLEND_WEIGHT: f32 = 0.4;
    const USER_BLEND_WEIGHT: f32 = 0.6;

    fn adaptation_enabled() -> bool {
        std::env::var("ADAPTATION_AUTO")
            .ok()
            .map(|v| {
                matches!(
                    v.trim().to_ascii_lowercase().as_str(),
                    "1" | "true" | "yes" | "on"
                )
            })
            .unwrap_or(true)
    }

    fn clamp_trait(value: f32) -> f32 {
        value.clamp(0.0, 1.0)
    }

    fn bounded_adjust(base: f32, delta: f32, max_abs_delta: f32) -> f32 {
        Self::clamp_trait(base + delta.clamp(-max_abs_delta, max_abs_delta))
    }

    fn contains_any(haystack: &str, needles: &[&str]) -> bool {
        needles.iter().any(|needle| haystack.contains(needle))
    }

    fn trait_value_by_name(state: &TraitStateData, trait_name: &str) -> f32 {
        match trait_name {
            "helpfulness" => state.helpfulness,
            "formality" => state.formality,
            "verbosity" => state.verbosity,
            "proactivity" => state.proactivity,
            "creativity" => state.creativity,
            "empathy" => state.empathy,
            _ => 0.5,
        }
    }

    fn parse_dimension(name: &str) -> Option<&'static str> {
        match name.trim().to_ascii_lowercase().as_str() {
            "tone" => Some("tone"),
            "verbosity" => Some("verbosity"),
            "helpfulness" => Some("helpfulness"),
            "accuracy" => Some("accuracy"),
            _ => None,
        }
    }

    fn parse_rating_value(value: &str) -> Option<f32> {
        match value.trim().to_ascii_lowercase().as_str() {
            "up" => Some(1.0),
            "down" => Some(0.0),
            _ => None,
        }
    }

    fn score_text_signals(content: &str, positive_terms: &[&str], negative_terms: &[&str]) -> f32 {
        let text = content.to_ascii_lowercase();
        let pos = positive_terms.iter().filter(|t| text.contains(**t)).count() as f32;
        let neg = negative_terms.iter().filter(|t| text.contains(**t)).count() as f32;
        let score = 0.5 + ((pos - neg) * 0.08);
        score.clamp(0.0, 1.0)
    }

    fn heuristic_message_quality(
        assistant_content: &str,
        parent_content: &str,
    ) -> (f32, f32, f32, f32, f32, serde_json::Value) {
        let combined = format!("{} {}", assistant_content, parent_content);
        let tone = Self::score_text_signals(
            &combined,
            &["friendly", "supportive", "empathetic", "polite", "clear"],
            &["rude", "harsh", "dismissive", "aggressive"],
        );
        let verbosity = Self::score_text_signals(
            &combined,
            &["concise", "brief", "short", "summary"],
            &["verbose", "wordy", "long", "ramble"],
        );
        let helpfulness = Self::score_text_signals(
            &combined,
            &["helpful", "actionable", "steps", "solution", "guidance"],
            &["unhelpful", "vague", "unclear", "confusing"],
        );
        let accuracy = Self::score_text_signals(
            &combined,
            &["accurate", "factual", "verified", "correct"],
            &["wrong", "incorrect", "hallucinat", "mistake", "error"],
        );
        let confidence = 0.55;
        let rationale = serde_json::json!({
            "type": "heuristic",
            "source_fields": ["assistant_content", "parent_content"],
        });
        (
            tone,
            verbosity,
            helpfulness,
            accuracy,
            confidence,
            rationale,
        )
    }

    pub async fn resolve_agent_id_for_message(
        db: &DatabaseConnection,
        message_id: Uuid,
    ) -> Result<Uuid, String> {
        let row = db
            .query_one(Statement::from_sql_and_values(
                DatabaseBackend::Postgres,
                r#"
                    SELECT c.agent_id
                    FROM messages m
                    JOIN conversations c ON c.id = m.conversation_id
                    WHERE m.id = $1::uuid
                    LIMIT 1
                "#,
                vec![message_id.into()],
            ))
            .await
            .map_err(|e| format!("Failed resolving agent_id for message quality: {e}"))?
            .ok_or_else(|| "Message not found while resolving agent_id".to_string())?;
        row.try_get("", "agent_id")
            .map_err(|e| format!("Failed decoding resolved agent_id for message quality: {e}"))
    }

    async fn upsert_orchestrator_label(
        db: &DatabaseConnection,
        message_id: Uuid,
        agent_id: Uuid,
        tone_score: f32,
        verbosity_score: f32,
        helpfulness_score: f32,
        accuracy_score: f32,
        confidence: f32,
        orchestrator_version: &str,
        status: &str,
        rationale: serde_json::Value,
    ) -> Result<(), String> {
        db.execute(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            r#"
                INSERT INTO message_quality_labels (
                    id, message_id, agent_id, tone_score, verbosity_score, helpfulness_score, accuracy_score,
                    confidence, orchestrator_version, status, rationale, created_at, updated_at
                )
                VALUES (
                    gen_random_uuid(), $1::uuid, $2::uuid, $3::float, $4::float, $5::float, $6::float,
                    $7::float, $8::text, $9::text, $10::jsonb, NOW(), NOW()
                )
                ON CONFLICT (message_id)
                DO UPDATE SET
                    tone_score = EXCLUDED.tone_score,
                    verbosity_score = EXCLUDED.verbosity_score,
                    helpfulness_score = EXCLUDED.helpfulness_score,
                    accuracy_score = EXCLUDED.accuracy_score,
                    confidence = EXCLUDED.confidence,
                    orchestrator_version = EXCLUDED.orchestrator_version,
                    status = EXCLUDED.status,
                    rationale = EXCLUDED.rationale,
                    updated_at = NOW()
            "#,
            vec![
                message_id.into(),
                agent_id.into(),
                (tone_score as f64).into(),
                (verbosity_score as f64).into(),
                (helpfulness_score as f64).into(),
                (accuracy_score as f64).into(),
                (confidence as f64).into(),
                orchestrator_version.to_string().into(),
                status.to_string().into(),
                rationale.to_string().into(),
            ],
        ))
        .await
        .map_err(|e| format!("Failed upserting orchestrator quality label: {e}"))?;
        Ok(())
    }

    async fn upsert_user_dimension_ratings(
        db: &DatabaseConnection,
        message_id: Uuid,
        agent_id: Uuid,
        user_id: Uuid,
        notes: Option<&str>,
        dimension_ratings: &HashMap<String, String>,
    ) -> Result<(), String> {
        for (dimension_key, rating_key) in dimension_ratings {
            let Some(dimension) = Self::parse_dimension(dimension_key) else {
                continue;
            };
            let normalized_rating = match rating_key.trim().to_ascii_lowercase().as_str() {
                "up" => "up",
                "down" => "down",
                _ => continue,
            };
            db.execute(Statement::from_sql_and_values(
                DatabaseBackend::Postgres,
                r#"
                    INSERT INTO message_quality_user_ratings (
                        id, message_id, agent_id, user_id, dimension, rating, notes, created_at, updated_at
                    )
                    VALUES (
                        gen_random_uuid(), $1::uuid, $2::uuid, $3::uuid, $4::text, $5::text, $6::text, NOW(), NOW()
                    )
                    ON CONFLICT (message_id, user_id, dimension)
                    DO UPDATE SET
                        rating = EXCLUDED.rating,
                        notes = EXCLUDED.notes,
                        updated_at = NOW()
                "#,
                vec![
                    message_id.into(),
                    agent_id.into(),
                    user_id.into(),
                    dimension.to_string().into(),
                    normalized_rating.to_string().into(),
                    notes.map(|v| v.to_string()).into(),
                ],
            ))
            .await
            .map_err(|e| format!("Failed upserting user dimension rating ({dimension}): {e}"))?;
        }
        Ok(())
    }

    async fn reconcile_message_quality(
        db: &DatabaseConnection,
        message_id: Uuid,
        agent_id: Uuid,
    ) -> Result<(), String> {
        let label_row = db
            .query_one(Statement::from_sql_and_values(
                DatabaseBackend::Postgres,
                r#"
                    SELECT tone_score, verbosity_score, helpfulness_score, accuracy_score, confidence
                    FROM message_quality_labels
                    WHERE message_id = $1::uuid
                    LIMIT 1
                "#,
                vec![message_id.into()],
            ))
            .await
            .map_err(|e| format!("Failed loading orchestrator label for reconciliation: {e}"))?;
        let has_orchestrator_label = label_row.is_some();

        let mut effective = HashMap::from([
            ("tone".to_string(), 0.5_f32),
            ("verbosity".to_string(), 0.5_f32),
            ("helpfulness".to_string(), 0.5_f32),
            ("accuracy".to_string(), 0.5_f32),
        ]);
        let mut source_mix = serde_json::json!({});
        let mut provenance = "heuristic_fallback";

        if let Some(row) = label_row {
            let tone = row
                .try_get::<f64>("", "tone_score")
                .map_err(|e| format!("Failed decoding label tone_score: {e}"))?
                as f32;
            let verbosity = row
                .try_get::<f64>("", "verbosity_score")
                .map_err(|e| format!("Failed decoding label verbosity_score: {e}"))?
                as f32;
            let helpfulness = row
                .try_get::<f64>("", "helpfulness_score")
                .map_err(|e| format!("Failed decoding label helpfulness_score: {e}"))?
                as f32;
            let accuracy = row
                .try_get::<f64>("", "accuracy_score")
                .map_err(|e| format!("Failed decoding label accuracy_score: {e}"))?
                as f32;
            let confidence = row
                .try_get::<f64>("", "confidence")
                .map_err(|e| format!("Failed decoding label confidence: {e}"))?
                as f32;
            effective.insert("tone".to_string(), tone);
            effective.insert("verbosity".to_string(), verbosity);
            effective.insert("helpfulness".to_string(), helpfulness);
            effective.insert("accuracy".to_string(), accuracy);
            source_mix = serde_json::json!({
                "agent_confidence": confidence,
                "agent_weight": Self::ORCHESTRATOR_BLEND_WEIGHT
            });
            provenance = "agent_only";
        }

        let user_rows = db
            .query_all(Statement::from_sql_and_values(
                DatabaseBackend::Postgres,
                r#"
                    SELECT dimension, rating
                    FROM message_quality_user_ratings
                    WHERE message_id = $1::uuid
                "#,
                vec![message_id.into()],
            ))
            .await
            .map_err(|e| {
                format!("Failed loading user dimension ratings for reconciliation: {e}")
            })?;

        let mut user_count = 0_i32;
        for row in user_rows {
            let dimension: String = row
                .try_get("", "dimension")
                .map_err(|e| format!("Failed decoding user rating dimension: {e}"))?;
            let rating: String = row
                .try_get("", "rating")
                .map_err(|e| format!("Failed decoding user rating rating: {e}"))?;
            if let Some(user_value) = Self::parse_rating_value(&rating) {
                user_count += 1;
                let existing = effective.get(&dimension).copied().unwrap_or(0.5);
                let blended = ((existing * Self::ORCHESTRATOR_BLEND_WEIGHT)
                    + (user_value * Self::USER_BLEND_WEIGHT))
                    .clamp(0.0, 1.0);
                effective.insert(dimension, blended);
            }
        }
        if user_count > 0 {
            provenance = if has_orchestrator_label {
                "weighted_blend"
            } else {
                "user_override"
            };
            source_mix = serde_json::json!({
                "user_ratings": user_count,
                "user_weight": Self::USER_BLEND_WEIGHT,
                "agent_weight": if has_orchestrator_label { Self::ORCHESTRATOR_BLEND_WEIGHT } else { 0.0 }
            });
        }

        db.execute(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            r#"
                INSERT INTO message_quality_reconciliation (
                    id, message_id, agent_id, effective_tone_score, effective_verbosity_score,
                    effective_helpfulness_score, effective_accuracy_score, source_mix, provenance,
                    created_at, updated_at
                )
                VALUES (
                    gen_random_uuid(), $1::uuid, $2::uuid, $3::float, $4::float, $5::float, $6::float,
                    $7::jsonb, $8::text, NOW(), NOW()
                )
                ON CONFLICT (message_id)
                DO UPDATE SET
                    effective_tone_score = EXCLUDED.effective_tone_score,
                    effective_verbosity_score = EXCLUDED.effective_verbosity_score,
                    effective_helpfulness_score = EXCLUDED.effective_helpfulness_score,
                    effective_accuracy_score = EXCLUDED.effective_accuracy_score,
                    source_mix = EXCLUDED.source_mix,
                    provenance = EXCLUDED.provenance,
                    updated_at = NOW()
            "#,
            vec![
                message_id.into(),
                agent_id.into(),
                (effective.get("tone").copied().unwrap_or(0.5) as f64).into(),
                (effective.get("verbosity").copied().unwrap_or(0.5) as f64).into(),
                (effective.get("helpfulness").copied().unwrap_or(0.5) as f64).into(),
                (effective.get("accuracy").copied().unwrap_or(0.5) as f64).into(),
                source_mix.to_string().into(),
                provenance.to_string().into(),
            ],
        ))
        .await
        .map_err(|e| format!("Failed upserting message quality reconciliation: {e}"))?;

        db.execute(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            r#"
                UPDATE message_quality_labels
                SET status = 'reconciled', updated_at = NOW()
                WHERE message_id = $1::uuid
            "#,
            vec![message_id.into()],
        ))
        .await
        .map_err(|e| format!("Failed marking message quality label as reconciled: {e}"))?;
        Ok(())
    }

    pub async fn score_assistant_message_quality(
        db: &DatabaseConnection,
        message_id: Uuid,
    ) -> Result<(), String> {
        let row = db
            .query_one(Statement::from_sql_and_values(
                DatabaseBackend::Postgres,
                r#"
                    SELECT
                        m.content AS assistant_content,
                        m.role AS message_role,
                        c.agent_id AS agent_id,
                        COALESCE(parent.content, '') AS parent_content
                    FROM messages m
                    JOIN conversations c ON c.id = m.conversation_id
                    LEFT JOIN messages parent ON parent.id = m.parent_id
                    WHERE m.id = $1::uuid
                    LIMIT 1
                "#,
                vec![message_id.into()],
            ))
            .await
            .map_err(|e| format!("Failed loading message for orchestrator scoring: {e}"))?
            .ok_or_else(|| "Message not found for orchestrator scoring".to_string())?;

        let role: String = row
            .try_get("", "message_role")
            .map_err(|e| format!("Failed decoding message_role for orchestrator scoring: {e}"))?;
        if role != "assistant" {
            return Ok(());
        }
        let assistant_content: String = row.try_get("", "assistant_content").map_err(|e| {
            format!("Failed decoding assistant_content for orchestrator scoring: {e}")
        })?;
        let parent_content: String = row
            .try_get("", "parent_content")
            .map_err(|e| format!("Failed decoding parent_content for orchestrator scoring: {e}"))?;
        let agent_id: Uuid = row
            .try_get("", "agent_id")
            .map_err(|e| format!("Failed decoding agent_id for orchestrator scoring: {e}"))?;

        let (tone, verbosity, helpfulness, accuracy, confidence, rationale) =
            Self::heuristic_message_quality(&assistant_content, &parent_content);
        Self::upsert_orchestrator_label(
            db,
            message_id,
            agent_id,
            tone,
            verbosity,
            helpfulness,
            accuracy,
            confidence,
            "heuristic_v1",
            "scored",
            rationale,
        )
        .await?;
        Self::reconcile_message_quality(db, message_id, agent_id).await?;
        Ok(())
    }

    fn normalize_feedback_category(category: Option<String>) -> Option<String> {
        let normalized = category?
            .trim()
            .to_ascii_lowercase()
            .replace(['-', ' '], "_");
        let canonical = match normalized.as_str() {
            "helpfulness" | "accuracy" | "tone" | "verbosity" => normalized,
            _ => return None,
        };
        Some(canonical)
    }

    async fn load_feedback_context(
        db: &DatabaseConnection,
        message_id: Uuid,
    ) -> Result<(String, String), String> {
        let sql = r#"
            SELECT
                COALESCE(m.content, '') AS assistant_content,
                COALESCE(parent.content, '') AS parent_content
            FROM messages m
            LEFT JOIN messages parent ON parent.id = m.parent_id
            WHERE m.id = $1::uuid
            LIMIT 1
        "#;
        let row = db
            .query_one(Statement::from_sql_and_values(
                DatabaseBackend::Postgres,
                sql,
                vec![message_id.into()],
            ))
            .await
            .map_err(|e| {
                format!("Failed to load message context for feedback classification: {e}")
            })?
            .ok_or_else(|| "Message not found while classifying feedback".to_string())?;
        let assistant_content: String = row
            .try_get("", "assistant_content")
            .map_err(|e| format!("Failed decoding feedback context assistant_content: {e}"))?;
        let parent_content: String = row
            .try_get("", "parent_content")
            .map_err(|e| format!("Failed decoding feedback context parent_content: {e}"))?;
        Ok((assistant_content, parent_content))
    }

    fn infer_feedback_category(
        feedback_type: &str,
        notes: Option<&str>,
        assistant_content: &str,
        parent_content: &str,
    ) -> Option<String> {
        let normalized_type = feedback_type.trim().to_ascii_lowercase();
        let mut corpus = String::new();
        if let Some(n) = notes {
            corpus.push_str(n);
            corpus.push(' ');
        }
        corpus.push_str(assistant_content);
        corpus.push(' ');
        corpus.push_str(parent_content);
        let corpus = corpus.to_ascii_lowercase();
        if corpus.trim().is_empty() {
            return None;
        }

        let score = |needles: &[&str]| -> i32 {
            needles
                .iter()
                .map(|needle| if corpus.contains(needle) { 1 } else { 0 })
                .sum()
        };
        let mut candidates = [
            (
                "accuracy",
                score(&[
                    "accurate",
                    "accuracy",
                    "incorrect",
                    "wrong",
                    "factual",
                    "fact",
                    "hallucinat",
                    "mistake",
                    "error",
                ]),
            ),
            (
                "helpfulness",
                score(&[
                    "helpful",
                    "useful",
                    "actionable",
                    "guidance",
                    "steps",
                    "solve",
                    "solution",
                    "clarity",
                ]),
            ),
            (
                "tone",
                score(&[
                    "tone",
                    "rude",
                    "polite",
                    "friendly",
                    "harsh",
                    "empathetic",
                    "empathy",
                    "professional",
                    "formal",
                ]),
            ),
            (
                "verbosity",
                score(&[
                    "verbose",
                    "verbosity",
                    "too long",
                    "too short",
                    "concise",
                    "brief",
                    "wordy",
                    "length",
                ]),
            ),
        ];
        candidates.sort_by(|a, b| b.1.cmp(&a.1));
        let (top_category, top_score) = candidates.first().cloned().unwrap_or(("helpfulness", 0));
        if top_score > 0 {
            return Some(top_category.to_string());
        }

        // Fallback heuristic when no lexical signal is present.
        // Negative tends to map best to helpfulness dissatisfaction by default.
        // Neutral usually indicates style/tone mismatch over correctness.
        match normalized_type.as_str() {
            "negative" => Some("helpfulness".to_string()),
            "neutral" => Some("tone".to_string()),
            "positive" => Some("helpfulness".to_string()),
            _ => None,
        }
    }

    fn apply_keyword_preset(
        mut helpfulness: f32,
        mut formality: f32,
        mut verbosity: f32,
        mut proactivity: f32,
        mut creativity: f32,
        mut empathy: f32,
        keyword_space: &str,
    ) -> (f32, f32, f32, f32, f32, f32, Vec<&'static str>) {
        let mut matched = Vec::new();

        if Self::contains_any(keyword_space, &["concise", "brief", "short"]) {
            verbosity -= 0.18;
            proactivity -= 0.02;
            matched.push("concise");
        }
        if Self::contains_any(
            keyword_space,
            &["detailed", "thorough", "comprehensive", "deep"],
        ) {
            verbosity += 0.18;
            helpfulness += 0.05;
            matched.push("detailed");
        }
        if Self::contains_any(keyword_space, &["formal", "professional", "executive"]) {
            formality += 0.15;
            verbosity -= 0.05;
            matched.push("formal");
        }
        if Self::contains_any(
            keyword_space,
            &["friendly", "supportive", "coach", "mentor", "empathetic"],
        ) {
            empathy += 0.16;
            helpfulness += 0.10;
            matched.push("empathetic");
        }
        if Self::contains_any(
            keyword_space,
            &["creative", "brainstorm", "innovative", "ideation"],
        ) {
            creativity += 0.18;
            proactivity += 0.06;
            matched.push("creative");
        }
        if Self::contains_any(
            keyword_space,
            &["proactive", "initiative", "anticipate", "ownership"],
        ) {
            proactivity += 0.16;
            matched.push("proactive");
        }
        if Self::contains_any(
            keyword_space,
            &["analytical", "precise", "accuracy", "rigorous"],
        ) {
            formality += 0.08;
            proactivity += 0.08;
            creativity -= 0.04;
            matched.push("analytical");
        }

        (
            Self::clamp_trait(helpfulness),
            Self::clamp_trait(formality),
            Self::clamp_trait(verbosity),
            Self::clamp_trait(proactivity),
            Self::clamp_trait(creativity),
            Self::clamp_trait(empathy),
            matched,
        )
    }

    fn read_custom_baseline_from_constraints(
        constraints: &Option<serde_json::Value>,
    ) -> Option<(f32, f32, f32, f32, f32, f32)> {
        let baseline = constraints
            .as_ref()
            .and_then(|json| json.get("trait_baseline"))
            .and_then(|json| json.as_object())?;

        let read = |key: &str| -> Option<f32> {
            baseline
                .get(key)
                .and_then(|value| value.as_f64())
                .map(|value| value as f32)
                .map(Self::clamp_trait)
        };

        Some((
            read("helpfulness")?,
            read("formality")?,
            read("verbosity")?,
            read("proactivity")?,
            read("creativity")?,
            read("empathy")?,
        ))
    }

    fn build_hybrid_trait_baseline(agent: &agents::Model) -> TraitBaseline {
        let mut helpfulness = 0.5_f32;
        let mut formality = 0.5_f32;
        let mut verbosity = 0.5_f32;
        let mut proactivity = 0.5_f32;
        let mut creativity = 0.5_f32;
        let mut empathy = 0.5_f32;

        let mut preset_source = "keyword_preset";
        let mut preset_matched_keywords: Vec<&'static str> = Vec::new();
        if let Some((h, f, v, p, c, e)) =
            Self::read_custom_baseline_from_constraints(&agent.behavioral_constraints)
        {
            helpfulness = h;
            formality = f;
            verbosity = v;
            proactivity = p;
            creativity = c;
            empathy = e;
            preset_source = "custom_constraint_preset";
        } else {
            let keyword_space = format!(
                "{} {} {}",
                agent.persona.to_ascii_lowercase(),
                agent
                    .mission
                    .clone()
                    .unwrap_or_default()
                    .to_ascii_lowercase(),
                agent
                    .values
                    .clone()
                    .unwrap_or_default()
                    .join(" ")
                    .to_ascii_lowercase()
            );
            let (h, f, v, p, c, e, matched) = Self::apply_keyword_preset(
                helpfulness,
                formality,
                verbosity,
                proactivity,
                creativity,
                empathy,
                &keyword_space,
            );
            helpfulness = h;
            formality = f;
            verbosity = v;
            proactivity = p;
            creativity = c;
            empathy = e;
            preset_matched_keywords = matched;
        }

        let model_key = format!(
            "{}:{}",
            agent.provider_type.to_ascii_lowercase(),
            agent.model_id.to_ascii_lowercase()
        );
        let mut model_adjustments = serde_json::json!({});
        if model_key.contains("claude") || model_key.contains("anthropic") {
            helpfulness = Self::bounded_adjust(helpfulness, 0.02, 0.08);
            empathy = Self::bounded_adjust(empathy, 0.04, 0.08);
            verbosity = Self::bounded_adjust(verbosity, 0.03, 0.08);
            formality = Self::bounded_adjust(formality, 0.02, 0.08);
            model_adjustments = serde_json::json!({
                "helpfulness": 0.02,
                "empathy": 0.04,
                "verbosity": 0.03,
                "formality": 0.02
            });
        } else if model_key.contains("gpt-4o-mini") {
            helpfulness = Self::bounded_adjust(helpfulness, 0.01, 0.08);
            proactivity = Self::bounded_adjust(proactivity, 0.03, 0.08);
            verbosity = Self::bounded_adjust(verbosity, -0.03, 0.08);
            creativity = Self::bounded_adjust(creativity, 0.02, 0.08);
            model_adjustments = serde_json::json!({
                "helpfulness": 0.01,
                "proactivity": 0.03,
                "verbosity": -0.03,
                "creativity": 0.02
            });
        } else if model_key.contains("gpt-4o") || model_key.contains("openai") {
            helpfulness = Self::bounded_adjust(helpfulness, 0.02, 0.08);
            proactivity = Self::bounded_adjust(proactivity, 0.03, 0.08);
            creativity = Self::bounded_adjust(creativity, 0.03, 0.08);
            verbosity = Self::bounded_adjust(verbosity, -0.02, 0.08);
            model_adjustments = serde_json::json!({
                "helpfulness": 0.02,
                "proactivity": 0.03,
                "creativity": 0.03,
                "verbosity": -0.02
            });
        }

        TraitBaseline {
            helpfulness: Self::clamp_trait(helpfulness),
            formality: Self::clamp_trait(formality),
            verbosity: Self::clamp_trait(verbosity),
            proactivity: Self::clamp_trait(proactivity),
            creativity: Self::clamp_trait(creativity),
            empathy: Self::clamp_trait(empathy),
            source: "hybrid_v1".to_string(),
            version: "v1".to_string(),
            context: serde_json::json!({
                "preset_source": preset_source,
                "preset_keyword_matches": preset_matched_keywords,
                "provider_type": agent.provider_type,
                "model_id": agent.model_id,
                "model_adjustments": model_adjustments
            }),
        }
    }

    fn shift_month(year: i32, month: u32, delta: i32) -> (i32, u32) {
        let total_months = year * 12 + month as i32 - 1 + delta;
        let new_year = total_months.div_euclid(12);
        let new_month = (total_months.rem_euclid(12) + 1) as u32;
        (new_year, new_month)
    }

    fn negative_ratio(stats: &FeedbackStats) -> f32 {
        let total = stats.positive + stats.negative + stats.neutral;
        if total <= 0 {
            return 0.0;
        }
        stats.negative as f32 / total as f32
    }

    fn directional_score(positive: i64, negative: i64) -> Option<f32> {
        let directional_total = positive + negative;
        if directional_total < Self::ADAPTATION_MIN_DIRECTIONAL_FEEDBACK {
            return None;
        }
        Some((positive as f32 - negative as f32) / directional_total as f32)
    }

    pub async fn submit_feedback(
        db: &DatabaseConnection,
        request: SubmitFeedbackRequest,
    ) -> Result<(), String> {
        if !["positive", "negative", "neutral"].contains(&request.feedback_type.as_str()) {
            return Err("Invalid feedback_type".to_string());
        }

        let message_id =
            Uuid::parse_str(&request.message_id).map_err(|e| format!("Invalid message_id: {e}"))?;
        let user_id =
            Uuid::parse_str(&request.user_id).map_err(|e| format!("Invalid user_id: {e}"))?;
        let agent_id = Self::resolve_agent_id_for_message(db, message_id).await?;
        let normalized_category =
            Self::normalize_feedback_category(request.feedback_category.clone());
        let notes_for_quality = request.notes.clone();
        let effective_category = if normalized_category.is_some() {
            normalized_category
        } else {
            let (assistant_content, parent_content) =
                Self::load_feedback_context(db, message_id).await?;
            let inferred = Self::infer_feedback_category(
                &request.feedback_type,
                request.notes.as_deref(),
                &assistant_content,
                &parent_content,
            );
            if let Some(category) = inferred.as_ref() {
                eprintln!(
                    "[FEEDBACK] Auto-classified feedback category: message_id={} feedback_type={} category={}",
                    message_id, request.feedback_type, category
                );
            } else {
                eprintln!(
                    "[FEEDBACK] Feedback category unresolved, storing uncategorized: message_id={} feedback_type={}",
                    message_id, request.feedback_type
                );
            }
            inferred
        };

        let existing = message_feedback::Entity::find()
            .filter(message_feedback::Column::MessageId.eq(message_id))
            .filter(message_feedback::Column::UserId.eq(user_id))
            .one(db)
            .await
            .map_err(|e| format!("Failed to query feedback: {e}"))?;

        match existing {
            Some(model) => {
                let mut active: message_feedback::ActiveModel = model.into();
                active.feedback_type = Set(request.feedback_type.clone());
                active.feedback_category = Set(effective_category.clone());
                active.notes = Set(request.notes.clone());
                active.created_at = Set(chrono::Utc::now().into());
                active
                    .update(db)
                    .await
                    .map_err(|e| format!("Failed to update feedback: {e}"))?;
            }
            None => {
                let model = message_feedback::ActiveModel {
                    id: ActiveValue::Set(Uuid::new_v4()),
                    message_id: ActiveValue::Set(message_id),
                    user_id: ActiveValue::Set(user_id),
                    feedback_type: ActiveValue::Set(request.feedback_type),
                    feedback_category: ActiveValue::Set(effective_category),
                    notes: ActiveValue::Set(request.notes),
                    created_at: ActiveValue::Set(chrono::Utc::now().into()),
                };
                model
                    .insert(db)
                    .await
                    .map_err(|e| format!("Failed to save feedback: {e}"))?;
            }
        }

        if let Some(dimension_ratings) = request.dimension_ratings.as_ref() {
            Self::upsert_user_dimension_ratings(
                db,
                message_id,
                agent_id,
                user_id,
                notes_for_quality.as_deref(),
                dimension_ratings,
            )
            .await?;
        }
        // Hybrid timing: re-score on explicit user feedback to reconcile latest context.
        let _ = Self::score_assistant_message_quality(db, message_id).await;
        // Reconcile whenever user feedback arrives (hybrid timing).
        Self::reconcile_message_quality(db, message_id, agent_id).await?;

        Ok(())
    }

    async fn get_or_create_trait_state(
        db: &DatabaseConnection,
        agent_id: Uuid,
    ) -> Result<TraitStateData, String> {
        let select_sql = r#"
            SELECT
                agent_id,
                helpfulness,
                formality,
                verbosity,
                proactivity,
                creativity,
                empathy,
                adaptation_enabled,
                updated_at
            FROM trait_state
            WHERE agent_id = $1::uuid
        "#;

        let decode_row = |row: sea_orm::QueryResult| -> Result<TraitStateData, String> {
            Ok(TraitStateData {
                agent_id: row
                    .try_get("", "agent_id")
                    .map_err(|e| format!("Failed to decode trait_state.agent_id: {e}"))?,
                helpfulness: row
                    .try_get::<f64>("", "helpfulness")
                    .map_err(|e| format!("Failed to decode trait_state.helpfulness: {e}"))?
                    as f32,
                formality: row
                    .try_get::<f64>("", "formality")
                    .map_err(|e| format!("Failed to decode trait_state.formality: {e}"))?
                    as f32,
                verbosity: row
                    .try_get::<f64>("", "verbosity")
                    .map_err(|e| format!("Failed to decode trait_state.verbosity: {e}"))?
                    as f32,
                proactivity: row
                    .try_get::<f64>("", "proactivity")
                    .map_err(|e| format!("Failed to decode trait_state.proactivity: {e}"))?
                    as f32,
                creativity: row
                    .try_get::<f64>("", "creativity")
                    .map_err(|e| format!("Failed to decode trait_state.creativity: {e}"))?
                    as f32,
                empathy: row
                    .try_get::<f64>("", "empathy")
                    .map_err(|e| format!("Failed to decode trait_state.empathy: {e}"))?
                    as f32,
                adaptation_enabled: row
                    .try_get("", "adaptation_enabled")
                    .map_err(|e| format!("Failed to decode trait_state.adaptation_enabled: {e}"))?,
                updated_at: row
                    .try_get::<chrono::DateTime<chrono::FixedOffset>>("", "updated_at")
                    .map_err(|e| format!("Failed to decode trait_state.updated_at: {e}"))?
                    .with_timezone(&chrono::Utc),
            })
        };

        if let Some(row) = db
            .query_one(Statement::from_sql_and_values(
                DatabaseBackend::Postgres,
                select_sql,
                vec![agent_id.into()],
            ))
            .await
            .map_err(|e| format!("Failed to query trait state: {e}"))?
        {
            return decode_row(row);
        }

        let agent = agents::Entity::find_by_id(agent_id)
            .one(db)
            .await
            .map_err(|e| format!("Failed to load agent for trait baseline initialization: {e}"))?
            .ok_or_else(|| "Agent not found while initializing trait state".to_string())?;
        let baseline = Self::build_hybrid_trait_baseline(&agent);

        db.execute(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            r#"
                INSERT INTO trait_state (
                    agent_id,
                    helpfulness,
                    formality,
                    verbosity,
                    proactivity,
                    creativity,
                    empathy,
                    baseline_source,
                    baseline_version,
                    baseline_context
                )
                VALUES (
                    $1::uuid,
                    $2::float,
                    $3::float,
                    $4::float,
                    $5::float,
                    $6::float,
                    $7::float,
                    $8::text,
                    $9::text,
                    $10::jsonb
                )
                ON CONFLICT (agent_id) DO NOTHING
            "#,
            vec![
                agent_id.into(),
                (baseline.helpfulness as f64).into(),
                (baseline.formality as f64).into(),
                (baseline.verbosity as f64).into(),
                (baseline.proactivity as f64).into(),
                (baseline.creativity as f64).into(),
                (baseline.empathy as f64).into(),
                baseline.source.into(),
                baseline.version.into(),
                baseline.context.into(),
            ],
        ))
        .await
        .map_err(|e| format!("Failed to initialize trait state: {e}"))?;

        let row = db
            .query_one(Statement::from_sql_and_values(
                DatabaseBackend::Postgres,
                select_sql,
                vec![agent_id.into()],
            ))
            .await
            .map_err(|e| format!("Failed to query trait state after initialization: {e}"))?
            .ok_or_else(|| "Trait state initialization did not produce a row".to_string())?;
        decode_row(row)
    }

    async fn get_category_signals(
        db: &DatabaseConnection,
        agent_id: Uuid,
    ) -> Result<Vec<CategorySignal>, String> {
        let sql = r#"
            SELECT
                COALESCE(mf.feedback_category, 'uncategorized') AS category,
                COUNT(*) FILTER (WHERE mf.feedback_type = 'positive') AS positive,
                COUNT(*) FILTER (WHERE mf.feedback_type = 'negative') AS negative,
                COUNT(*) FILTER (WHERE mf.feedback_type = 'neutral') AS neutral
            FROM message_feedback mf
            JOIN messages m ON m.id = mf.message_id
            JOIN conversations c ON c.id = m.conversation_id
            WHERE c.agent_id = $1::uuid
              AND mf.created_at >= NOW() - (($2::int || ' days')::interval)
            GROUP BY COALESCE(mf.feedback_category, 'uncategorized')
        "#;

        let rows = db
            .query_all(Statement::from_sql_and_values(
                DatabaseBackend::Postgres,
                sql,
                vec![
                    agent_id.into(),
                    (Self::ADAPTATION_WINDOW_DAYS as i32).into(),
                ],
            ))
            .await
            .map_err(|e| format!("Failed to load category adaptation signals: {e}"))?;

        let mut out = Vec::with_capacity(rows.len());
        for row in rows {
            out.push(CategorySignal {
                category: row
                    .try_get("", "category")
                    .map_err(|e| format!("Failed decoding signal category: {e}"))?,
                positive: row
                    .try_get::<i64>("", "positive")
                    .map_err(|e| format!("Failed decoding signal positive: {e}"))?,
                negative: row
                    .try_get::<i64>("", "negative")
                    .map_err(|e| format!("Failed decoding signal negative: {e}"))?,
                neutral: row
                    .try_get::<i64>("", "neutral")
                    .map_err(|e| format!("Failed decoding signal neutral: {e}"))?,
            });
        }
        Ok(out)
    }

    async fn get_dimension_signal(
        db: &DatabaseConnection,
        agent_id: Uuid,
    ) -> Result<Option<DimensionSignal>, String> {
        let row = db
            .query_one(Statement::from_sql_and_values(
                DatabaseBackend::Postgres,
                r#"
                    SELECT
                        COUNT(*)::bigint AS sample_size,
                        COALESCE(AVG(mqr.effective_tone_score), 0)::float AS tone_score,
                        COALESCE(AVG(mqr.effective_verbosity_score), 0)::float AS verbosity_score,
                        COALESCE(AVG(mqr.effective_helpfulness_score), 0)::float AS helpfulness_score,
                        COALESCE(AVG(mqr.effective_accuracy_score), 0)::float AS accuracy_score
                    FROM message_quality_reconciliation mqr
                    WHERE mqr.agent_id = $1::uuid
                      AND mqr.updated_at >= NOW() - (($2::int || ' days')::interval)
                "#,
                vec![agent_id.into(), (Self::ADAPTATION_WINDOW_DAYS as i32).into()],
            ))
            .await
            .map_err(|e| format!("Failed loading dimension quality signals: {e}"))?;
        let Some(row) = row else {
            return Ok(None);
        };

        let sample_size = row
            .try_get::<i64>("", "sample_size")
            .map_err(|e| format!("Failed decoding dimension signal sample_size: {e}"))?;
        if sample_size <= 0 {
            return Ok(None);
        }
        Ok(Some(DimensionSignal {
            sample_size,
            tone_score: row
                .try_get::<f64>("", "tone_score")
                .map_err(|e| format!("Failed decoding dimension signal tone_score: {e}"))?
                as f32,
            verbosity_score: row
                .try_get::<f64>("", "verbosity_score")
                .map_err(|e| format!("Failed decoding dimension signal verbosity_score: {e}"))?
                as f32,
            helpfulness_score: row
                .try_get::<f64>("", "helpfulness_score")
                .map_err(|e| format!("Failed decoding dimension signal helpfulness_score: {e}"))?
                as f32,
            accuracy_score: row
                .try_get::<f64>("", "accuracy_score")
                .map_err(|e| format!("Failed decoding dimension signal accuracy_score: {e}"))?
                as f32,
        }))
    }

    async fn latest_applied_cycle_at(
        db: &DatabaseConnection,
        agent_id: Uuid,
    ) -> Result<Option<chrono::DateTime<chrono::Utc>>, String> {
        let sql = r#"
            SELECT created_at
            FROM adaptation_cycles
            WHERE agent_id = $1::uuid
              AND status = 'applied'
            ORDER BY created_at DESC
            LIMIT 1
        "#;

        let row = db
            .query_one(Statement::from_sql_and_values(
                DatabaseBackend::Postgres,
                sql,
                vec![agent_id.into()],
            ))
            .await
            .map_err(|e| format!("Failed to query latest adaptation cycle: {e}"))?;

        row.map(|r| {
            r.try_get::<chrono::DateTime<chrono::FixedOffset>>("", "created_at")
                .map(|v| v.with_timezone(&chrono::Utc))
        })
        .transpose()
        .map_err(|e| format!("Failed decoding latest adaptation cycle timestamp: {e}"))
    }

    async fn persist_adaptation_cycle(
        db: &DatabaseConnection,
        agent_id: Uuid,
        sample_size: i32,
        status: &str,
        reason: Option<&str>,
        signal_summary: serde_json::Value,
        guardrail_flags: serde_json::Value,
        applied_changes: serde_json::Value,
    ) -> Result<AdaptationCycleData, String> {
        let sql = r#"
            INSERT INTO adaptation_cycles (
                id,
                agent_id,
                window_started_at,
                window_ended_at,
                sample_size,
                signal_summary,
                guardrail_flags,
                applied_changes,
                status,
                reason,
                created_at
            )
            VALUES (
                gen_random_uuid(),
                $1::uuid,
                NOW() - (($2::int || ' days')::interval),
                NOW(),
                $3::int,
                $4::jsonb,
                $5::jsonb,
                $6::jsonb,
                $7::text,
                $8::text,
                NOW()
            )
            RETURNING id, agent_id, sample_size, status, reason, signal_summary, guardrail_flags, applied_changes, created_at
        "#;

        let row = db
            .query_one(Statement::from_sql_and_values(
                DatabaseBackend::Postgres,
                sql,
                vec![
                    agent_id.into(),
                    (Self::ADAPTATION_WINDOW_DAYS as i32).into(),
                    sample_size.into(),
                    signal_summary.to_string().into(),
                    guardrail_flags.to_string().into(),
                    applied_changes.to_string().into(),
                    status.to_string().into(),
                    reason.map(|v| v.to_string()).into(),
                ],
            ))
            .await
            .map_err(|e| format!("Failed to persist adaptation cycle: {e}"))?
            .ok_or_else(|| "Adaptation cycle insert returned no row".to_string())?;

        Ok(AdaptationCycleData {
            id: row
                .try_get("", "id")
                .map_err(|e| format!("Failed decoding adaptation_cycle.id: {e}"))?,
            agent_id: row
                .try_get("", "agent_id")
                .map_err(|e| format!("Failed decoding adaptation_cycle.agent_id: {e}"))?,
            sample_size: row
                .try_get::<i32>("", "sample_size")
                .map_err(|e| format!("Failed decoding adaptation_cycle.sample_size: {e}"))?,
            status: row
                .try_get("", "status")
                .map_err(|e| format!("Failed decoding adaptation_cycle.status: {e}"))?,
            reason: row
                .try_get::<Option<String>>("", "reason")
                .map_err(|e| format!("Failed decoding adaptation_cycle.reason: {e}"))?,
            signal_summary: row
                .try_get("", "signal_summary")
                .map_err(|e| format!("Failed decoding adaptation_cycle.signal_summary: {e}"))?,
            guardrail_flags: row
                .try_get("", "guardrail_flags")
                .map_err(|e| format!("Failed decoding adaptation_cycle.guardrail_flags: {e}"))?,
            applied_changes: row
                .try_get("", "applied_changes")
                .map_err(|e| format!("Failed decoding adaptation_cycle.applied_changes: {e}"))?,
            created_at: row
                .try_get::<chrono::DateTime<chrono::FixedOffset>>("", "created_at")
                .map_err(|e| format!("Failed decoding adaptation_cycle.created_at: {e}"))?
                .with_timezone(&chrono::Utc),
        })
    }

    pub async fn get_feedback_stats(
        db: &DatabaseConnection,
        agent_id: String,
    ) -> Result<FeedbackStats, String> {
        let agent_id = Uuid::parse_str(&agent_id).map_err(|e| format!("Invalid agent_id: {e}"))?;

        // Aggregate through messages -> conversations by agent
        let all = message_feedback::Entity::find()
            .find_also_related(crate::entities::messages::Entity)
            .all(db)
            .await
            .map_err(|e| format!("Failed to load feedback stats: {e}"))?;

        let mut stats = FeedbackStats {
            positive: 0,
            negative: 0,
            neutral: 0,
        };

        for (feedback, maybe_message) in all {
            let Some(message) = maybe_message else {
                continue;
            };
            let conversation =
                crate::entities::conversations::Entity::find_by_id(message.conversation_id)
                    .one(db)
                    .await
                    .map_err(|e| format!("Failed loading conversation for feedback: {e}"))?;
            if let Some(conversation) = conversation {
                if conversation.agent_id == agent_id {
                    match feedback.feedback_type.as_str() {
                        "positive" => stats.positive += 1,
                        "negative" => stats.negative += 1,
                        _ => stats.neutral += 1,
                    }
                }
            }
        }

        Ok(stats)
    }

    pub async fn get_conversation_feedback(
        db: &DatabaseConnection,
        conversation_id: String,
        user_id: String,
    ) -> Result<HashMap<String, String>, String> {
        let conversation_id = Uuid::parse_str(&conversation_id)
            .map_err(|e| format!("Invalid conversation_id: {e}"))?;
        let user_id = Uuid::parse_str(&user_id).map_err(|e| format!("Invalid user_id: {e}"))?;

        let rows = message_feedback::Entity::find()
            .filter(message_feedback::Column::UserId.eq(user_id))
            .find_also_related(crate::entities::messages::Entity)
            .all(db)
            .await
            .map_err(|e| format!("Failed to load conversation feedback: {e}"))?;

        let mut feedback_map = HashMap::new();
        for (feedback, maybe_message) in rows {
            let Some(message) = maybe_message else {
                continue;
            };
            if message.conversation_id == conversation_id {
                feedback_map.insert(message.id.to_string(), feedback.feedback_type);
            }
        }

        Ok(feedback_map)
    }

    pub async fn get_conversation_dimension_feedback(
        db: &DatabaseConnection,
        conversation_id: String,
        user_id: String,
    ) -> Result<HashMap<String, HashMap<String, String>>, String> {
        let conversation_id = Uuid::parse_str(&conversation_id)
            .map_err(|e| format!("Invalid conversation_id: {e}"))?;
        let user_id = Uuid::parse_str(&user_id).map_err(|e| format!("Invalid user_id: {e}"))?;

        let rows = db
            .query_all(Statement::from_sql_and_values(
                DatabaseBackend::Postgres,
                r#"
                    SELECT
                        m.id::text AS message_id,
                        mqur.dimension,
                        mqur.rating
                    FROM message_quality_user_ratings mqur
                    JOIN messages m ON m.id = mqur.message_id
                    WHERE m.conversation_id = $1::uuid
                      AND mqur.user_id = $2::uuid
                "#,
                vec![conversation_id.into(), user_id.into()],
            ))
            .await
            .map_err(|e| format!("Failed to load conversation dimension feedback: {e}"))?;

        let mut out: HashMap<String, HashMap<String, String>> = HashMap::new();
        for row in rows {
            let message_id: String = row
                .try_get("", "message_id")
                .map_err(|e| format!("Failed decoding conversation dimension message_id: {e}"))?;
            let dimension: String = row
                .try_get("", "dimension")
                .map_err(|e| format!("Failed decoding conversation dimension dimension: {e}"))?;
            let rating: String = row
                .try_get("", "rating")
                .map_err(|e| format!("Failed decoding conversation dimension rating: {e}"))?;
            out.entry(message_id).or_default().insert(dimension, rating);
        }
        Ok(out)
    }

    pub async fn get_feedback_monthly(
        db: &DatabaseConnection,
        agent_id: String,
    ) -> Result<Vec<FeedbackMonthlyData>, String> {
        let agent_id = Uuid::parse_str(&agent_id).map_err(|e| format!("Invalid agent_id: {e}"))?;
        let now = chrono::Utc::now();
        let base_year = now.year();
        let base_month = now.month();

        let all = message_feedback::Entity::find()
            .find_also_related(crate::entities::messages::Entity)
            .all(db)
            .await
            .map_err(|e| format!("Failed to load monthly feedback data: {e}"))?;

        let mut conversation_belongs_to_agent: HashMap<Uuid, bool> = HashMap::new();
        let mut month_counts: HashMap<(i32, u32), (i64, i64)> = HashMap::new();

        for (feedback, maybe_message) in all {
            let Some(message) = maybe_message else {
                continue;
            };

            let conversation_matches =
                if let Some(cached) = conversation_belongs_to_agent.get(&message.conversation_id) {
                    *cached
                } else {
                    let conversation =
                        crate::entities::conversations::Entity::find_by_id(message.conversation_id)
                            .one(db)
                            .await
                            .map_err(|e| {
                                format!("Failed loading conversation for monthly feedback: {e}")
                            })?;
                    let matches = conversation
                        .map(|conv| conv.agent_id == agent_id)
                        .unwrap_or(false);
                    conversation_belongs_to_agent.insert(message.conversation_id, matches);
                    matches
                };

            if !conversation_matches {
                continue;
            }

            let timestamp = feedback.created_at.with_timezone(&chrono::Utc);
            let key = (timestamp.year(), timestamp.month());
            let entry = month_counts.entry(key).or_insert((0, 0));

            match feedback.feedback_type.as_str() {
                "positive" => entry.0 += 1,
                "negative" => entry.1 += 1,
                _ => {}
            }
        }

        let mut result = Vec::new();
        for i in 0_i32..6_i32 {
            let delta = i - 5;
            let (year, month) = Self::shift_month(base_year, base_month, delta);
            let point = chrono::NaiveDate::from_ymd_opt(year, month, 1)
                .ok_or_else(|| format!("Invalid generated month: {year}-{month}"))?;
            let (positive, negative) = month_counts.get(&(year, month)).copied().unwrap_or((0, 0));

            result.push(FeedbackMonthlyData {
                month: point.format("%b %y").to_string(),
                positive,
                negative,
            });
        }

        Ok(result)
    }

    pub async fn analyze_feedback_patterns(
        db: &DatabaseConnection,
        agent_id: String,
    ) -> Result<Vec<PersonalityAdjustmentData>, String> {
        let agent_id = Uuid::parse_str(&agent_id).map_err(|e| format!("Invalid agent_id: {e}"))?;
        let _ = Self::run_adaptation_cycle(db, agent_id).await?;
        Self::list_personality_adjustments(db, agent_id.to_string()).await
    }

    pub async fn run_adaptation_cycle(
        db: &DatabaseConnection,
        agent_id: Uuid,
    ) -> Result<Option<AdaptationCycleData>, String> {
        if !Self::adaptation_enabled() {
            return Ok(None);
        }

        let trait_state = Self::get_or_create_trait_state(db, agent_id).await?;
        if !trait_state.adaptation_enabled {
            return Ok(None);
        }

        let stats = Self::get_feedback_stats(db, agent_id.to_string()).await?;
        let total = stats.positive + stats.negative + stats.neutral;
        if total < Self::ADAPTATION_MIN_TOTAL_FEEDBACK {
            let cycle = Self::persist_adaptation_cycle(
                db,
                agent_id,
                total as i32,
                "skipped",
                Some("insufficient_feedback"),
                serde_json::json!({
                    "positive": stats.positive,
                    "negative": stats.negative,
                    "neutral": stats.neutral
                }),
                serde_json::json!({ "min_total_feedback_required": Self::ADAPTATION_MIN_TOTAL_FEEDBACK }),
                serde_json::json!({}),
            )
            .await?;
            return Ok(Some(cycle));
        }

        if let Some(last_applied_at) = Self::latest_applied_cycle_at(db, agent_id).await? {
            let since = chrono::Utc::now() - last_applied_at;
            if since < chrono::Duration::minutes(30) {
                let cycle = Self::persist_adaptation_cycle(
                    db,
                    agent_id,
                    total as i32,
                    "skipped",
                    Some("cooldown_active"),
                    serde_json::json!({
                        "positive": stats.positive,
                        "negative": stats.negative,
                        "neutral": stats.neutral
                    }),
                    serde_json::json!({
                        "cooldown_minutes": 30,
                        "minutes_since_last_applied": since.num_minutes()
                    }),
                    serde_json::json!({}),
                )
                .await?;
                return Ok(Some(cycle));
            }
        }

        let category_signals = Self::get_category_signals(db, agent_id).await?;
        let dimension_signal = Self::get_dimension_signal(db, agent_id).await?;
        let mut signal_by_category: HashMap<String, (i64, i64, i64)> = HashMap::new();
        for signal in &category_signals {
            signal_by_category.insert(
                signal.category.clone(),
                (signal.positive, signal.negative, signal.neutral),
            );
        }

        let mut next_traits = serde_json::json!({
            "helpfulness": trait_state.helpfulness,
            "formality": trait_state.formality,
            "verbosity": trait_state.verbosity,
            "proactivity": trait_state.proactivity,
            "creativity": trait_state.creativity,
            "empathy": trait_state.empathy
        });
        let mut applied_changes = serde_json::Map::new();
        let step = Self::ADAPTATION_STEP_MAX;

        let apply_delta = |value: f32, delta: f32| -> f32 { Self::clamp_trait(value + delta) };

        let verbosity_signal = if let Some(dim) = dimension_signal.as_ref() {
            if dim.sample_size >= Self::ADAPTATION_MIN_DIRECTIONAL_FEEDBACK {
                Some(((dim.verbosity_score - 0.5) * 2.0).clamp(-1.0, 1.0))
            } else {
                None
            }
        } else {
            signal_by_category
                .get("verbosity")
                .and_then(|(p, n, _)| Self::directional_score(*p, *n))
        };
        if let Some(score) = verbosity_signal {
            let delta = (score * step).clamp(-step, step);
            let old = trait_state.verbosity;
            let new = apply_delta(old, delta);
            if (new - old).abs() >= 0.01 {
                next_traits["verbosity"] = serde_json::json!(new);
                applied_changes.insert(
                    "verbosity".to_string(),
                    serde_json::json!({
                        "old": old,
                        "new": new,
                        "delta": new - old,
                        "driver": "feedback_category:verbosity",
                        "directional_score": score
                    }),
                );
            }
        }

        let tone_signal = if let Some(dim) = dimension_signal.as_ref() {
            if dim.sample_size >= Self::ADAPTATION_MIN_DIRECTIONAL_FEEDBACK {
                Some(((dim.tone_score - 0.5) * 2.0).clamp(-1.0, 1.0))
            } else {
                None
            }
        } else {
            signal_by_category
                .get("tone")
                .and_then(|(p, n, _)| Self::directional_score(*p, *n))
        };
        if let Some(score) = tone_signal {
            let empathy_old = trait_state.empathy;
            let empathy_new = apply_delta(empathy_old, (-score * step).clamp(-step, step));
            if (empathy_new - empathy_old).abs() >= 0.01 {
                next_traits["empathy"] = serde_json::json!(empathy_new);
                applied_changes.insert(
                    "empathy".to_string(),
                    serde_json::json!({
                        "old": empathy_old,
                        "new": empathy_new,
                        "delta": empathy_new - empathy_old,
                        "driver": "feedback_category:tone",
                        "directional_score": score
                    }),
                );
            }

            let formality_old = trait_state.formality;
            let formality_new =
                apply_delta(formality_old, (score * (step * 0.5)).clamp(-step, step));
            if (formality_new - formality_old).abs() >= 0.01 {
                next_traits["formality"] = serde_json::json!(formality_new);
                applied_changes.insert(
                    "formality".to_string(),
                    serde_json::json!({
                        "old": formality_old,
                        "new": formality_new,
                        "delta": formality_new - formality_old,
                        "driver": "feedback_category:tone",
                        "directional_score": score
                    }),
                );
            }
        }

        let helpfulness_signal = if let Some(dim) = dimension_signal.as_ref() {
            if dim.sample_size >= Self::ADAPTATION_MIN_DIRECTIONAL_FEEDBACK {
                Some(((dim.helpfulness_score - 0.5) * 2.0).clamp(-1.0, 1.0))
            } else {
                None
            }
        } else {
            signal_by_category
                .get("helpfulness")
                .and_then(|(p, n, _)| Self::directional_score(*p, *n))
        };
        if let Some(score) = helpfulness_signal {
            let old = trait_state.helpfulness;
            let new = apply_delta(old, (score * step).clamp(-step, step));
            if (new - old).abs() >= 0.01 {
                next_traits["helpfulness"] = serde_json::json!(new);
                applied_changes.insert(
                    "helpfulness".to_string(),
                    serde_json::json!({
                        "old": old,
                        "new": new,
                        "delta": new - old,
                        "driver": "feedback_category:helpfulness",
                        "directional_score": score
                    }),
                );
            }
        }

        let accuracy_signal = if let Some(dim) = dimension_signal.as_ref() {
            if dim.sample_size >= Self::ADAPTATION_MIN_DIRECTIONAL_FEEDBACK {
                Some(((dim.accuracy_score - 0.5) * 2.0).clamp(-1.0, 1.0))
            } else {
                None
            }
        } else {
            signal_by_category
                .get("accuracy")
                .and_then(|(p, n, _)| Self::directional_score(*p, *n))
        };
        if let Some(score) = accuracy_signal {
            let proactivity_old = trait_state.proactivity;
            let proactivity_new =
                apply_delta(proactivity_old, (score * (step * 0.75)).clamp(-step, step));
            if (proactivity_new - proactivity_old).abs() >= 0.01 {
                next_traits["proactivity"] = serde_json::json!(proactivity_new);
                applied_changes.insert(
                    "proactivity".to_string(),
                    serde_json::json!({
                        "old": proactivity_old,
                        "new": proactivity_new,
                        "delta": proactivity_new - proactivity_old,
                        "driver": "feedback_category:accuracy",
                        "directional_score": score
                    }),
                );
            }

            let creativity_old = trait_state.creativity;
            let creativity_new =
                apply_delta(creativity_old, (score * (step * 0.5)).clamp(-step, step));
            if (creativity_new - creativity_old).abs() >= 0.01 {
                next_traits["creativity"] = serde_json::json!(creativity_new);
                applied_changes.insert(
                    "creativity".to_string(),
                    serde_json::json!({
                        "old": creativity_old,
                        "new": creativity_new,
                        "delta": creativity_new - creativity_old,
                        "driver": "feedback_category:accuracy",
                        "directional_score": score
                    }),
                );
            }
        }

        let uncategorized_signal = signal_by_category
            .get("uncategorized")
            .and_then(|(p, n, _)| Self::directional_score(*p, *n));
        if let Some(score) = uncategorized_signal {
            let scaled_step = step * Self::AUTO_CATEGORY_FALLBACK_FACTOR;

            let helpfulness_old = trait_state.helpfulness;
            let helpfulness_new = apply_delta(
                helpfulness_old,
                (score * scaled_step).clamp(-scaled_step, scaled_step),
            );
            if (helpfulness_new - helpfulness_old).abs() >= 0.01
                && !applied_changes.contains_key("helpfulness")
            {
                next_traits["helpfulness"] = serde_json::json!(helpfulness_new);
                applied_changes.insert(
                    "helpfulness".to_string(),
                    serde_json::json!({
                        "old": helpfulness_old,
                        "new": helpfulness_new,
                        "delta": helpfulness_new - helpfulness_old,
                        "driver": "feedback_category:uncategorized_fallback",
                        "directional_score": score
                    }),
                );
            }

            let proactivity_old = trait_state.proactivity;
            let proactivity_new = apply_delta(
                proactivity_old,
                (score * (scaled_step * 0.75)).clamp(-scaled_step, scaled_step),
            );
            if (proactivity_new - proactivity_old).abs() >= 0.01
                && !applied_changes.contains_key("proactivity")
            {
                next_traits["proactivity"] = serde_json::json!(proactivity_new);
                applied_changes.insert(
                    "proactivity".to_string(),
                    serde_json::json!({
                        "old": proactivity_old,
                        "new": proactivity_new,
                        "delta": proactivity_new - proactivity_old,
                        "driver": "feedback_category:uncategorized_fallback",
                        "directional_score": score
                    }),
                );
            }
        }

        let applied_changes_value = serde_json::Value::Object(applied_changes.clone());
        let status = if applied_changes.is_empty() {
            "skipped"
        } else {
            "applied"
        };
        let reason = if applied_changes.is_empty() {
            Some("no_significant_signal")
        } else {
            None
        };
        let cycle = Self::persist_adaptation_cycle(
            db,
            agent_id,
            total as i32,
            status,
            reason,
            serde_json::json!({
                "positive": stats.positive,
                "negative": stats.negative,
                "neutral": stats.neutral,
                "categories": signal_by_category,
                "dimension_signal": dimension_signal.as_ref().map(|dim| serde_json::json!({
                    "sample_size": dim.sample_size,
                    "tone_score": dim.tone_score,
                    "verbosity_score": dim.verbosity_score,
                    "helpfulness_score": dim.helpfulness_score,
                    "accuracy_score": dim.accuracy_score
                })),
                "recognized_category_count": signal_by_category
                    .keys()
                    .filter(|k| ["helpfulness", "accuracy", "tone", "verbosity"].contains(&k.as_str()))
                    .count(),
                "uncategorized_present": signal_by_category.contains_key("uncategorized")
            }),
            serde_json::json!({
                "min_total_feedback_required": Self::ADAPTATION_MIN_TOTAL_FEEDBACK,
                "min_directional_feedback_required": Self::ADAPTATION_MIN_DIRECTIONAL_FEEDBACK,
                "max_step": Self::ADAPTATION_STEP_MAX,
                "uncategorized_fallback_factor": Self::AUTO_CATEGORY_FALLBACK_FACTOR
            }),
            applied_changes_value.clone(),
        )
        .await?;

        eprintln!(
            "[FEEDBACK] Adaptation cycle result: agent_id={} status={} sample_size={} applied_changes={}",
            agent_id,
            status,
            total,
            applied_changes_value
        );

        if status == "applied" {
            let update_sql = r#"
                UPDATE trait_state
                SET
                    helpfulness = $2::float,
                    formality = $3::float,
                    verbosity = $4::float,
                    proactivity = $5::float,
                    creativity = $6::float,
                    empathy = $7::float,
                    updated_by_cycle_id = $8::uuid,
                    updated_at = NOW()
                WHERE agent_id = $1::uuid
            "#;

            db.execute(Statement::from_sql_and_values(
                DatabaseBackend::Postgres,
                update_sql,
                vec![
                    agent_id.into(),
                    next_traits["helpfulness"]
                        .as_f64()
                        .unwrap_or(trait_state.helpfulness as f64)
                        .into(),
                    next_traits["formality"]
                        .as_f64()
                        .unwrap_or(trait_state.formality as f64)
                        .into(),
                    next_traits["verbosity"]
                        .as_f64()
                        .unwrap_or(trait_state.verbosity as f64)
                        .into(),
                    next_traits["proactivity"]
                        .as_f64()
                        .unwrap_or(trait_state.proactivity as f64)
                        .into(),
                    next_traits["creativity"]
                        .as_f64()
                        .unwrap_or(trait_state.creativity as f64)
                        .into(),
                    next_traits["empathy"]
                        .as_f64()
                        .unwrap_or(trait_state.empathy as f64)
                        .into(),
                    cycle.id.into(),
                ],
            ))
            .await
            .map_err(|e| format!("Failed to update trait state after adaptation cycle: {e}"))?;

            for (trait_name, value) in applied_changes {
                let fallback = Self::trait_value_by_name(&trait_state, &trait_name);
                let old_value = value
                    .get("old")
                    .and_then(|v| v.as_f64())
                    .unwrap_or(fallback as f64);
                let new_value = value
                    .get("new")
                    .and_then(|v| v.as_f64())
                    .unwrap_or(fallback as f64);
                let reason = value
                    .get("driver")
                    .and_then(|v| v.as_str())
                    .map(|driver| format!("Adaptive cycle {} via {}", cycle.id, driver));

                let model = personality_adjustments::ActiveModel {
                    id: ActiveValue::Set(Uuid::new_v4()),
                    agent_id: ActiveValue::Set(agent_id),
                    trait_name: ActiveValue::Set(trait_name.clone()),
                    old_value: ActiveValue::Set(old_value),
                    new_value: ActiveValue::Set(new_value),
                    reason: ActiveValue::Set(reason),
                    created_at: ActiveValue::Set(chrono::Utc::now().into()),
                };

                model.insert(db).await.map_err(|e| {
                    format!("Failed to persist personality adjustment {trait_name}: {e}")
                })?;
            }

            if let Some(agent) = agents::Entity::find_by_id(agent_id)
                .one(db)
                .await
                .map_err(|e| format!("Failed to load agent for adaptive traits update: {e}"))?
            {
                let mut constraints = agent
                    .behavioral_constraints
                    .clone()
                    .unwrap_or_else(|| serde_json::json!({}));
                if !constraints.is_object() {
                    constraints = serde_json::json!({});
                }
                constraints["adaptive_traits"] = next_traits;

                let mut active: agents::ActiveModel = agent.into();
                active.behavioral_constraints = Set(Some(constraints));
                active.updated_at = Set(chrono::Utc::now().into());
                active.update(db).await.map_err(|e| {
                    format!("Failed to persist adaptive traits into agent constraints: {e}")
                })?;
            }
        }

        Ok(Some(cycle))
    }

    pub async fn get_trait_state(
        db: &DatabaseConnection,
        agent_id: String,
    ) -> Result<TraitStateData, String> {
        let agent_id = Uuid::parse_str(&agent_id).map_err(|e| format!("Invalid agent_id: {e}"))?;
        Self::get_or_create_trait_state(db, agent_id).await
    }

    pub async fn set_adaptation_enabled(
        db: &DatabaseConnection,
        agent_id: String,
        enabled: bool,
    ) -> Result<TraitStateData, String> {
        let agent_id = Uuid::parse_str(&agent_id).map_err(|e| format!("Invalid agent_id: {e}"))?;
        Self::get_or_create_trait_state(db, agent_id).await?;
        db.execute(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            "UPDATE trait_state SET adaptation_enabled = $2::bool, updated_at = NOW() WHERE agent_id = $1::uuid",
            vec![agent_id.into(), enabled.into()],
        ))
        .await
        .map_err(|e| format!("Failed updating adaptation_enabled flag: {e}"))?;
        Self::get_or_create_trait_state(db, agent_id).await
    }

    pub async fn revert_last_adaptation_cycle(
        db: &DatabaseConnection,
        agent_id: String,
    ) -> Result<Option<AdaptationCycleData>, String> {
        let agent_id = Uuid::parse_str(&agent_id).map_err(|e| format!("Invalid agent_id: {e}"))?;
        let row = db
            .query_one(Statement::from_sql_and_values(
                DatabaseBackend::Postgres,
                r#"
                    SELECT id, applied_changes
                    FROM adaptation_cycles
                    WHERE agent_id = $1::uuid
                      AND status = 'applied'
                    ORDER BY created_at DESC
                    LIMIT 1
                "#,
                vec![agent_id.into()],
            ))
            .await
            .map_err(|e| format!("Failed querying latest applied cycle for revert: {e}"))?;

        let Some(row) = row else {
            return Ok(None);
        };
        let cycle_id: Uuid = row
            .try_get("", "id")
            .map_err(|e| format!("Failed decoding cycle id for revert: {e}"))?;
        let applied_changes: serde_json::Value = row
            .try_get("", "applied_changes")
            .map_err(|e| format!("Failed decoding cycle changes for revert: {e}"))?;

        let mut state = Self::get_or_create_trait_state(db, agent_id).await?;
        if let Some(changes) = applied_changes.as_object() {
            for (trait_name, payload) in changes {
                let old_value = payload
                    .get("old")
                    .and_then(|v| v.as_f64())
                    .unwrap_or(Self::trait_value_by_name(&state, trait_name) as f64)
                    as f32;
                match trait_name.as_str() {
                    "helpfulness" => state.helpfulness = old_value,
                    "formality" => state.formality = old_value,
                    "verbosity" => state.verbosity = old_value,
                    "proactivity" => state.proactivity = old_value,
                    "creativity" => state.creativity = old_value,
                    "empathy" => state.empathy = old_value,
                    _ => {}
                }
            }
        }

        db.execute(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            r#"
                UPDATE trait_state
                SET
                    helpfulness = $2::float,
                    formality = $3::float,
                    verbosity = $4::float,
                    proactivity = $5::float,
                    creativity = $6::float,
                    empathy = $7::float,
                    updated_at = NOW()
                WHERE agent_id = $1::uuid
            "#,
            vec![
                agent_id.into(),
                state.helpfulness.into(),
                state.formality.into(),
                state.verbosity.into(),
                state.proactivity.into(),
                state.creativity.into(),
                state.empathy.into(),
            ],
        ))
        .await
        .map_err(|e| format!("Failed updating trait state during revert: {e}"))?;

        db.execute(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            "UPDATE adaptation_cycles SET status = 'reverted', reason = 'manual_revert' WHERE id = $1::uuid",
            vec![cycle_id.into()],
        ))
        .await
        .map_err(|e| format!("Failed marking adaptation cycle as reverted: {e}"))?;

        let reverted = Self::persist_adaptation_cycle(
            db,
            agent_id,
            0,
            "reverted",
            Some("manual_revert"),
            serde_json::json!({}),
            serde_json::json!({}),
            applied_changes,
        )
        .await?;
        Ok(Some(reverted))
    }

    pub async fn list_personality_adjustments(
        db: &DatabaseConnection,
        agent_id: String,
    ) -> Result<Vec<PersonalityAdjustmentData>, String> {
        let agent_id = Uuid::parse_str(&agent_id).map_err(|e| format!("Invalid agent_id: {e}"))?;
        let rows = personality_adjustments::Entity::find()
            .filter(personality_adjustments::Column::AgentId.eq(agent_id))
            .order_by_desc(personality_adjustments::Column::CreatedAt)
            .all(db)
            .await
            .map_err(|e| format!("Failed to list personality adjustments: {e}"))?;

        Ok(rows
            .into_iter()
            .map(|row| PersonalityAdjustmentData {
                id: row.id,
                agent_id: row.agent_id,
                trait_name: row.trait_name,
                old_value: row.old_value,
                new_value: row.new_value,
                reason: row.reason,
                created_at: row.created_at.into(),
            })
            .collect())
    }
}

#[cfg(test)]
mod tests {
    use super::{FeedbackService, FeedbackStats};

    #[test]
    fn negative_ratio_handles_zero() {
        let stats = FeedbackStats {
            positive: 0,
            negative: 0,
            neutral: 0,
        };
        assert_eq!(FeedbackService::negative_ratio(&stats), 0.0);
    }

    #[test]
    fn negative_ratio_calculates_fraction() {
        let stats = FeedbackStats {
            positive: 2,
            negative: 2,
            neutral: 1,
        };
        assert!((FeedbackService::negative_ratio(&stats) - 0.4).abs() < f32::EPSILON);
    }

    #[test]
    fn directional_score_requires_min_samples() {
        assert_eq!(FeedbackService::directional_score(1, 1), None);
        assert!(FeedbackService::directional_score(2, 1).is_some());
    }

    #[test]
    fn directional_score_respects_polarity() {
        let positive_lean = FeedbackService::directional_score(8, 2).unwrap_or(0.0);
        let negative_lean = FeedbackService::directional_score(2, 8).unwrap_or(0.0);
        assert!(positive_lean > 0.0);
        assert!(negative_lean < 0.0);
    }
}
