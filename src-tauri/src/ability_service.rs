use sea_orm::{
    ActiveModelTrait, ActiveValue, ColumnTrait, ConnectionTrait, DatabaseBackend, DatabaseConnection,
    EntityTrait, QueryFilter, Set, Statement,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use uuid::Uuid;

use crate::entities::{abilities, agent_abilities, perception_stats};
use crate::feedback_service::FeedbackService;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentAbilityData {
    pub id: Uuid,
    pub agent_id: Uuid,
    pub ability_id: Uuid,
    pub ability_name: String,
    pub implementation_key: String,
    pub category: String,
    pub usage_count: i32,
    pub success_count: i32,
    pub proficiency: f64,
    pub last_used_at: Option<chrono::DateTime<chrono::Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillPerformanceRatingData {
    pub skill_key: String,
    pub skill_name: String,
    pub rating: f32,
    pub quality_score: f32,
    pub engagement_score: f32,
    pub feedback_score: f32,
    pub confidence_score: f32,
    pub usage_count: i32,
    pub ability_usage_count: i32,
    pub perception_usage_count: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillRatingTrendPoint {
    pub timestamp: String,
    pub rating: f32,
    pub quality_score: f32,
    pub engagement_score: f32,
    pub feedback_score: f32,
    pub confidence_score: f32,
    pub usage_count: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillRatingTrendSeries {
    pub skill_key: String,
    pub skill_name: String,
    pub points: Vec<SkillRatingTrendPoint>,
}

#[derive(Debug, Clone)]
struct AbilityComponent<'a> {
    implementation_key: &'a str,
    weight: f32,
}

#[derive(Debug, Clone)]
struct SkillDefinition<'a> {
    skill_key: &'a str,
    skill_name: &'a str,
    ability_components: Vec<AbilityComponent<'a>>,
    perception_feature_type: Option<&'a str>,
}

pub struct AbilityService;

impl AbilityService {
    fn identity_trends_enabled() -> bool {
        std::env::var("IDENTITY_TRENDS")
            .ok()
            .map(|v| matches!(v.trim().to_ascii_lowercase().as_str(), "1" | "true" | "yes" | "on"))
            .unwrap_or(true)
    }

    async fn persist_skill_rating_snapshots(
        db: &DatabaseConnection,
        agent_id: Uuid,
        ratings: &[SkillPerformanceRatingData],
    ) -> Result<(), String> {
        let sql = r#"
            INSERT INTO skill_rating_snapshots (
                id,
                agent_id,
                skill_key,
                skill_name,
                rating,
                quality_score,
                engagement_score,
                feedback_score,
                confidence_score,
                usage_count,
                ability_usage_count,
                perception_usage_count,
                snapshot_at
            )
            VALUES (
                gen_random_uuid(),
                $1::uuid,
                $2::text,
                $3::text,
                $4::float,
                $5::float,
                $6::float,
                $7::float,
                $8::float,
                $9::int,
                $10::int,
                $11::int,
                NOW()
            )
        "#;

        for rating in ratings {
            db.execute(Statement::from_sql_and_values(
                DatabaseBackend::Postgres,
                sql,
                vec![
                    agent_id.into(),
                    rating.skill_key.clone().into(),
                    rating.skill_name.clone().into(),
                    rating.rating.into(),
                    rating.quality_score.into(),
                    rating.engagement_score.into(),
                    rating.feedback_score.into(),
                    rating.confidence_score.into(),
                    rating.usage_count.into(),
                    rating.ability_usage_count.into(),
                    rating.perception_usage_count.into(),
                ],
            ))
            .await
            .map_err(|e| format!("Failed persisting skill rating snapshot {}: {e}", rating.skill_key))?;
        }
        Ok(())
    }

    fn calculate_proficiency(success_count: i32, usage_count: i32) -> f64 {
        if usage_count <= 0 {
            return 0.0;
        }
        (success_count as f64 / usage_count as f64).clamp(0.0, 1.0)
    }

    fn skill_definitions<'a>() -> Vec<SkillDefinition<'a>> {
        vec![
            SkillDefinition {
                skill_key: "chat",
                skill_name: "Chat",
                ability_components: vec![
                    AbilityComponent {
                        implementation_key: "conversation",
                        weight: 0.8,
                    },
                    AbilityComponent {
                        implementation_key: "memory_retrieval",
                        weight: 0.2,
                    },
                ],
                perception_feature_type: None,
            },
            SkillDefinition {
                skill_key: "voice",
                skill_name: "Voice",
                ability_components: vec![
                    AbilityComponent {
                        implementation_key: "audio_transcription",
                        weight: 0.5,
                    },
                    AbilityComponent {
                        implementation_key: "voice_synthesis",
                        weight: 0.5,
                    },
                ],
                perception_feature_type: Some("audio"),
            },
            SkillDefinition {
                skill_key: "screenshot",
                skill_name: "Screenshot",
                ability_components: vec![
                    AbilityComponent {
                        implementation_key: "vision_screenshot",
                        weight: 0.7,
                    },
                    AbilityComponent {
                        implementation_key: "vision_analysis",
                        weight: 0.3,
                    },
                ],
                perception_feature_type: Some("vision"),
            },
        ]
    }

    fn normalize_usage(usage_count: i32) -> f32 {
        if usage_count <= 0 {
            return 0.0;
        }
        let usage = usage_count.max(0) as f32;
        let denominator = (1.0_f32 + 20.0_f32).ln();
        ((1.0 + usage).ln() / denominator).clamp(0.0, 1.0)
    }

    fn confidence_from_usage(usage_count: i32) -> f32 {
        if usage_count <= 0 {
            return 0.0;
        }
        let usage = usage_count.max(0) as f32;
        (usage / (usage + 10.0)).clamp(0.0, 1.0)
    }

    fn feedback_score(positive: i64, negative: i64) -> f32 {
        let directional_total = positive + negative;
        if directional_total < 3 {
            return 0.5;
        }
        (positive as f32 / directional_total as f32).clamp(0.0, 1.0)
    }

    fn weighted_quality(
        ability_map: &HashMap<String, AgentAbilityData>,
        components: &[AbilityComponent<'_>],
    ) -> (f32, i32) {
        let mut weighted_sum = 0.0_f32;
        let mut weight_sum = 0.0_f32;
        let mut usage_count = 0_i32;

        for component in components {
            let weight = component.weight.max(0.0);
            weight_sum += weight;
            if let Some(ability) = ability_map.get(component.implementation_key) {
                weighted_sum += ability.proficiency.clamp(0.0, 1.0) as f32 * weight;
                usage_count += ability.usage_count.max(0);
            }
        }

        if weight_sum <= 0.0 {
            return (0.0, usage_count);
        }
        ((weighted_sum / weight_sum).clamp(0.0, 1.0), usage_count)
    }

    fn compute_rating(
        quality_score: f32,
        engagement_score: f32,
        feedback_score: f32,
        confidence_score: f32,
    ) -> f32 {
        let base =
            (0.6 * quality_score.clamp(0.0, 1.0))
                + (0.2 * engagement_score.clamp(0.0, 1.0))
                + (0.2 * feedback_score.clamp(0.0, 1.0));
        let confidence_multiplier = 0.7 + 0.3 * confidence_score.clamp(0.0, 1.0);
        (100.0 * base * confidence_multiplier).clamp(0.0, 100.0)
    }

    pub async fn initialize_core_abilities(db: &DatabaseConnection) -> Result<(), String> {
        let defaults = vec![
            (
                "Conversation",
                "General text conversation handling",
                "communication",
                "conversation",
            ),
            (
                "Vision Screenshot",
                "Capture and analyze screenshots",
                "perception",
                "vision_screenshot",
            ),
            (
                "Vision Analysis",
                "Analyze user-provided images",
                "perception",
                "vision_analysis",
            ),
            (
                "Audio Transcription",
                "Transcribe voice to text",
                "communication",
                "audio_transcription",
            ),
            (
                "Voice Synthesis",
                "Generate audio responses",
                "communication",
                "voice_synthesis",
            ),
            (
                "Memory Retrieval",
                "Semantic memory lookup for prior context",
                "memory",
                "memory_retrieval",
            ),
        ];

        for (name, description, category, implementation_key) in defaults {
            let exists = abilities::Entity::find()
                .filter(abilities::Column::Name.eq(name))
                .one(db)
                .await
                .map_err(|e| format!("Failed checking ability existence: {e}"))?;

            if exists.is_none() {
                let model = abilities::ActiveModel {
                    id: ActiveValue::Set(Uuid::new_v4()),
                    name: ActiveValue::Set(name.to_string()),
                    description: ActiveValue::Set(Some(description.to_string())),
                    category: ActiveValue::Set(category.to_string()),
                    implementation_key: ActiveValue::Set(implementation_key.to_string()),
                    is_premium: ActiveValue::Set(false),
                    parameters_schema: ActiveValue::Set(serde_json::json!({})),
                    created_at: ActiveValue::Set(chrono::Utc::now().into()),
                };

                model
                    .insert(db)
                    .await
                    .map_err(|e| format!("Failed seeding ability {name}: {e}"))?;
            }
        }

        Ok(())
    }

    pub async fn track_ability_usage(
        db: &DatabaseConnection,
        agent_id: Uuid,
        implementation_key: &str,
        success: bool,
    ) -> Result<(), String> {
        let ability = abilities::Entity::find()
            .filter(abilities::Column::ImplementationKey.eq(implementation_key))
            .one(db)
            .await
            .map_err(|e| format!("Failed to find ability {implementation_key}: {e}"))?
            .ok_or_else(|| format!("Ability not found: {implementation_key}"))?;

        let existing = agent_abilities::Entity::find()
            .filter(agent_abilities::Column::AgentId.eq(agent_id))
            .filter(agent_abilities::Column::AbilityId.eq(ability.id))
            .one(db)
            .await
            .map_err(|e| format!("Failed to query agent ability: {e}"))?;

        match existing {
            Some(model) => {
                let usage_count = model.usage_count + 1;
                let success_count = model.success_count + if success { 1 } else { 0 };
                let proficiency = Self::calculate_proficiency(success_count, usage_count);

                let mut active: agent_abilities::ActiveModel = model.into();
                active.usage_count = Set(usage_count);
                active.success_count = Set(success_count);
                active.proficiency = Set(proficiency);
                active.last_used_at = Set(Some(chrono::Utc::now().into()));
                active
                    .update(db)
                    .await
                    .map_err(|e| format!("Failed updating agent ability usage: {e}"))?;
            }
            None => {
                let usage_count = 1;
                let success_count = if success { 1 } else { 0 };
                let proficiency = Self::calculate_proficiency(success_count, usage_count);

                let model = agent_abilities::ActiveModel {
                    id: ActiveValue::Set(Uuid::new_v4()),
                    agent_id: ActiveValue::Set(agent_id),
                    ability_id: ActiveValue::Set(ability.id),
                    acquired_at: ActiveValue::Set(chrono::Utc::now().into()),
                    usage_count: ActiveValue::Set(usage_count),
                    success_count: ActiveValue::Set(success_count),
                    proficiency: ActiveValue::Set(proficiency),
                    last_used_at: ActiveValue::Set(Some(chrono::Utc::now().into())),
                };
                model
                    .insert(db)
                    .await
                    .map_err(|e| format!("Failed creating agent ability usage: {e}"))?;
            }
        }

        Ok(())
    }

    pub async fn list_agent_abilities(
        db: &DatabaseConnection,
        agent_id: String,
    ) -> Result<Vec<AgentAbilityData>, String> {
        let agent_id = Uuid::parse_str(&agent_id).map_err(|e| format!("Invalid agent ID: {e}"))?;
        let links = agent_abilities::Entity::find()
            .filter(agent_abilities::Column::AgentId.eq(agent_id))
            .all(db)
            .await
            .map_err(|e| format!("Failed listing agent abilities: {e}"))?;

        let mut results = Vec::with_capacity(links.len());
        for link in links {
            let ability = abilities::Entity::find_by_id(link.ability_id)
                .one(db)
                .await
                .map_err(|e| format!("Failed fetching ability details: {e}"))?;
            if let Some(ability) = ability {
                results.push(AgentAbilityData {
                    id: link.id,
                    agent_id: link.agent_id,
                    ability_id: link.ability_id,
                    ability_name: ability.name,
                    implementation_key: ability.implementation_key,
                    category: ability.category,
                    usage_count: link.usage_count,
                    success_count: link.success_count,
                    proficiency: link.proficiency,
                    last_used_at: link.last_used_at.map(|v| v.into()),
                });
            }
        }

        results.sort_by(|a, b| b.proficiency.total_cmp(&a.proficiency));
        Ok(results)
    }

    pub async fn get_agent_skill_ratings(
        db: &DatabaseConnection,
        agent_id: String,
    ) -> Result<Vec<SkillPerformanceRatingData>, String> {
        let agent_uuid = Uuid::parse_str(&agent_id).map_err(|e| format!("Invalid agent ID: {e}"))?;
        let abilities = Self::list_agent_abilities(db, agent_id.clone()).await.unwrap_or_else(|err| {
            eprintln!(
                "[RATING] Failed to load agent abilities for {}: {}",
                agent_id, err
            );
            Vec::new()
        });
        let ability_map: HashMap<String, AgentAbilityData> = abilities
            .into_iter()
            .map(|ability| (ability.implementation_key.clone(), ability))
            .collect();

        let perception_rows = perception_stats::Entity::find()
            .filter(perception_stats::Column::AgentId.eq(agent_uuid))
            .all(db)
            .await
            .unwrap_or_else(|err| {
                eprintln!(
                    "[RATING] Failed loading perception stats for {}: {}",
                    agent_id, err
                );
                Vec::new()
            });
        let mut perception_usage_by_feature = HashMap::<String, i32>::new();
        for row in perception_rows {
            *perception_usage_by_feature
                .entry(row.feature_type)
                .or_insert(0) += row.usage_count.max(0);
        }

        let feedback_score = match FeedbackService::get_feedback_stats(db, agent_id.clone()).await {
            Ok(feedback) => Self::feedback_score(feedback.positive, feedback.negative),
            Err(err) => {
                eprintln!(
                    "[RATING] Failed loading feedback stats for {}: {}. Using neutral fallback.",
                    agent_id, err
                );
                0.5
            }
        };

        let mut ratings = Vec::new();
        for definition in Self::skill_definitions() {
            let (quality_score, ability_usage_count) =
                Self::weighted_quality(&ability_map, &definition.ability_components);

            let perception_usage_count = definition
                .perception_feature_type
                .and_then(|feature| perception_usage_by_feature.get(feature).copied())
                .unwrap_or(0);

            // Use the stronger signal between ability and perception counters to avoid
            // double-counting the same event across two tracking systems.
            let usage_count = ability_usage_count.max(perception_usage_count);
            let engagement_score = Self::normalize_usage(usage_count);
            let confidence_score = Self::confidence_from_usage(usage_count);
            let rating =
                Self::compute_rating(quality_score, engagement_score, feedback_score, confidence_score);

            ratings.push(SkillPerformanceRatingData {
                skill_key: definition.skill_key.to_string(),
                skill_name: definition.skill_name.to_string(),
                rating,
                quality_score,
                engagement_score,
                feedback_score,
                confidence_score,
                usage_count,
                ability_usage_count,
                perception_usage_count,
            });
        }

        ratings.sort_by(|a, b| b.rating.total_cmp(&a.rating));
        if Self::identity_trends_enabled() {
            if let Err(err) = Self::persist_skill_rating_snapshots(db, agent_uuid, &ratings).await {
                eprintln!(
                    "[RATING] Failed persisting skill rating snapshots for {}: {}",
                    agent_id, err
                );
            }
        }
        Ok(ratings)
    }

    pub async fn get_agent_skill_rating_trends(
        db: &DatabaseConnection,
        agent_id: String,
        days: i32,
    ) -> Result<Vec<SkillRatingTrendSeries>, String> {
        let agent_uuid = Uuid::parse_str(&agent_id).map_err(|e| format!("Invalid agent ID: {e}"))?;
        let days = days.clamp(1, 90);
        let sql = r#"
            SELECT
                skill_key,
                skill_name,
                rating,
                quality_score,
                engagement_score,
                feedback_score,
                confidence_score,
                usage_count,
                snapshot_at::text AS snapshot_at
            FROM skill_rating_snapshots
            WHERE agent_id = $1::uuid
              AND snapshot_at >= NOW() - (($2::int || ' days')::interval)
            ORDER BY skill_key ASC, snapshot_at ASC
        "#;

        let rows = db
            .query_all(Statement::from_sql_and_values(
                DatabaseBackend::Postgres,
                sql,
                vec![agent_uuid.into(), days.into()],
            ))
            .await
            .map_err(|e| format!("Failed loading skill rating trends: {e}"))?;

        let mut grouped: HashMap<String, SkillRatingTrendSeries> = HashMap::new();
        for row in rows {
            let skill_key: String = row
                .try_get("", "skill_key")
                .map_err(|e| format!("Failed decoding trend skill_key: {e}"))?;
            let skill_name: String = row
                .try_get("", "skill_name")
                .map_err(|e| format!("Failed decoding trend skill_name: {e}"))?;
            let rating = row
                .try_get::<f64>("", "rating")
                .map_err(|e| format!("Failed decoding trend rating: {e}"))? as f32;
            let quality_score = row
                .try_get::<f64>("", "quality_score")
                .map_err(|e| format!("Failed decoding trend quality_score: {e}"))? as f32;
            let engagement_score = row
                .try_get::<f64>("", "engagement_score")
                .map_err(|e| format!("Failed decoding trend engagement_score: {e}"))? as f32;
            let feedback_score = row
                .try_get::<f64>("", "feedback_score")
                .map_err(|e| format!("Failed decoding trend feedback_score: {e}"))? as f32;
            let confidence_score = row
                .try_get::<f64>("", "confidence_score")
                .map_err(|e| format!("Failed decoding trend confidence_score: {e}"))? as f32;
            let usage_count = row
                .try_get::<i32>("", "usage_count")
                .map_err(|e| format!("Failed decoding trend usage_count: {e}"))?;
            let timestamp: String = row
                .try_get("", "snapshot_at")
                .map_err(|e| format!("Failed decoding trend snapshot_at: {e}"))?;

            let entry = grouped
                .entry(skill_key.clone())
                .or_insert_with(|| SkillRatingTrendSeries {
                    skill_key: skill_key.clone(),
                    skill_name: skill_name.clone(),
                    points: Vec::new(),
                });
            entry.points.push(SkillRatingTrendPoint {
                timestamp,
                rating,
                quality_score,
                engagement_score,
                feedback_score,
                confidence_score,
                usage_count,
            });
        }

        let mut out = grouped.into_values().collect::<Vec<_>>();
        out.sort_by(|a, b| a.skill_key.cmp(&b.skill_key));
        Ok(out)
    }
}

#[cfg(test)]
mod tests {
    use super::AbilityService;

    #[test]
    fn proficiency_handles_zero_usage() {
        assert_eq!(AbilityService::calculate_proficiency(0, 0), 0.0);
    }

    #[test]
    fn proficiency_is_ratio() {
        assert_eq!(AbilityService::calculate_proficiency(3, 4), 0.75);
    }

    #[test]
    fn normalize_usage_is_bounded() {
        assert_eq!(AbilityService::normalize_usage(0), 0.0);
        assert!(AbilityService::normalize_usage(10) > 0.0);
        assert!(AbilityService::normalize_usage(10_000) <= 1.0);
    }

    #[test]
    fn confidence_increases_with_usage() {
        let low = AbilityService::confidence_from_usage(2);
        let high = AbilityService::confidence_from_usage(25);
        assert!(high > low);
    }

    #[test]
    fn rating_stays_in_bounds() {
        let low = AbilityService::compute_rating(0.0, 0.0, 0.0, 0.0);
        let high = AbilityService::compute_rating(1.0, 1.0, 1.0, 1.0);
        assert!((0.0..=100.0).contains(&low));
        assert!((0.0..=100.0).contains(&high));
    }
}

