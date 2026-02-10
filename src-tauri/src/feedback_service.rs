use sea_orm::{
    ActiveModelTrait, ActiveValue, ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter,
    QueryOrder, Set,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::entities::{agents, message_feedback, personality_adjustments};

#[derive(Debug, Clone, Deserialize)]
pub struct SubmitFeedbackRequest {
    pub message_id: String,
    pub user_id: String,
    pub feedback_type: String,
    pub feedback_category: Option<String>,
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct FeedbackStats {
    pub positive: i64,
    pub negative: i64,
    pub neutral: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct PersonalityAdjustmentData {
    pub id: Uuid,
    pub agent_id: Uuid,
    pub trait_name: String,
    pub old_value: f32,
    pub new_value: f32,
    pub reason: Option<String>,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

pub struct FeedbackService;

impl FeedbackService {
    fn negative_ratio(stats: &FeedbackStats) -> f32 {
        let total = stats.positive + stats.negative + stats.neutral;
        if total <= 0 {
            return 0.0;
        }
        stats.negative as f32 / total as f32
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

        let existing = message_feedback::Entity::find()
            .filter(message_feedback::Column::MessageId.eq(message_id))
            .filter(message_feedback::Column::UserId.eq(user_id))
            .one(db)
            .await
            .map_err(|e| format!("Failed to query feedback: {e}"))?;

        match existing {
            Some(model) => {
                let mut active: message_feedback::ActiveModel = model.into();
                active.feedback_type = Set(request.feedback_type);
                active.feedback_category = Set(request.feedback_category);
                active.notes = Set(request.notes);
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
                    feedback_category: ActiveValue::Set(request.feedback_category),
                    notes: ActiveValue::Set(request.notes),
                    created_at: ActiveValue::Set(chrono::Utc::now().into()),
                };
                model
                    .insert(db)
                    .await
                    .map_err(|e| format!("Failed to save feedback: {e}"))?;
            }
        }

        Ok(())
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
            let Some(message) = maybe_message else { continue };
            let conversation = crate::entities::conversations::Entity::find_by_id(message.conversation_id)
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

    pub async fn analyze_feedback_patterns(
        db: &DatabaseConnection,
        agent_id: String,
    ) -> Result<Vec<PersonalityAdjustmentData>, String> {
        let agent_id = Uuid::parse_str(&agent_id).map_err(|e| format!("Invalid agent_id: {e}"))?;
        let stats = Self::get_feedback_stats(db, agent_id.to_string()).await?;
        let total = stats.positive + stats.negative + stats.neutral;
        if total < 5 {
            return Ok(vec![]);
        }

        let negative_ratio = Self::negative_ratio(&stats);
        let mut adjustments = Vec::new();

        if negative_ratio >= 0.4 {
            let existing = personality_adjustments::Entity::find()
                .filter(personality_adjustments::Column::AgentId.eq(agent_id))
                .filter(personality_adjustments::Column::TraitName.eq("verbosity"))
                .order_by_desc(personality_adjustments::Column::CreatedAt)
                .one(db)
                .await
                .map_err(|e| format!("Failed to query prior adjustments: {e}"))?;

            let old_value = existing.map(|v| v.new_value).unwrap_or(0.5);
            let new_value = (old_value - 0.1).clamp(0.0, 1.0);
            let reason = format!(
                "High negative feedback ratio ({:.0}%) suggests reducing verbosity",
                negative_ratio * 100.0
            );

            let model = personality_adjustments::ActiveModel {
                id: ActiveValue::Set(Uuid::new_v4()),
                agent_id: ActiveValue::Set(agent_id),
                trait_name: ActiveValue::Set("verbosity".to_string()),
                old_value: ActiveValue::Set(old_value),
                new_value: ActiveValue::Set(new_value),
                reason: ActiveValue::Set(Some(reason.clone())),
                created_at: ActiveValue::Set(chrono::Utc::now().into()),
            };
            let saved = model
                .insert(db)
                .await
                .map_err(|e| format!("Failed to save personality adjustment: {e}"))?;
            adjustments.push(PersonalityAdjustmentData {
                id: saved.id,
                agent_id: saved.agent_id,
                trait_name: saved.trait_name,
                old_value: saved.old_value,
                new_value: saved.new_value,
                reason: saved.reason,
                created_at: saved.created_at.into(),
            });

            // Persist applied adjustment into behavioral constraints as metadata.
            if let Some(agent) = agents::Entity::find_by_id(agent_id)
                .one(db)
                .await
                .map_err(|e| format!("Failed to load agent for adjustment: {e}"))?
            {
                let existing_constraints = agent.behavioral_constraints.clone();
                let mut active: agents::ActiveModel = agent.into();
                let mut constraints = existing_constraints.unwrap_or_else(|| serde_json::json!({}));
                if !constraints.is_object() {
                    constraints = serde_json::json!({});
                }
                constraints["adaptive_traits"] = serde_json::json!({
                    "verbosity": new_value
                });
                active.behavioral_constraints = Set(Some(constraints));
                active.updated_at = Set(chrono::Utc::now().into());
                active
                    .update(db)
                    .await
                    .map_err(|e| format!("Failed to update agent constraints with adjustment: {e}"))?;
            }
        }

        Ok(adjustments)
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
}

