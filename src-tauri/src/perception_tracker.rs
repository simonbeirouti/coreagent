use sea_orm::{DatabaseConnection, EntityTrait, QueryFilter, ColumnTrait, ActiveValue, QueryOrder};
use serde_json::Value;
use uuid::Uuid;

use crate::entities::{perception_stats, perception_logs};

pub struct PerceptionTracker;

impl PerceptionTracker {
    /// Increment usage counter for a perception action
    pub async fn track_usage(
        db: &DatabaseConnection,
        agent_id: &str,
        feature_type: &str,
        action: &str,
        metadata: Option<Value>,
    ) -> Result<(), String> {
        let agent_uuid = Uuid::parse_str(agent_id)
            .map_err(|e| format!("Invalid agent ID: {}", e))?;

        // Try to find existing stat record
        let existing_stat = perception_stats::Entity::find()
            .filter(perception_stats::Column::AgentId.eq(agent_uuid))
            .filter(perception_stats::Column::FeatureType.eq(feature_type))
            .filter(perception_stats::Column::Action.eq(action))
            .one(db)
            .await
            .map_err(|e| format!("Database error: {}", e))?;

        match existing_stat {
            Some(stat) => {
                // Update existing record
                let usage_count = stat.usage_count + 1;
                let mut active_stat: perception_stats::ActiveModel = stat.into();
                active_stat.usage_count = ActiveValue::Set(usage_count);
                active_stat.last_used_at = ActiveValue::Set(chrono::Utc::now().into());
                if let Some(meta) = metadata {
                    active_stat.metadata = ActiveValue::Set(meta);
                }

                perception_stats::Entity::update(active_stat)
                    .exec(db)
                    .await
                    .map_err(|e| format!("Failed to update perception stats: {}", e))?;
            }
            None => {
                // Create new record
                let new_stat = perception_stats::ActiveModel {
                    id: ActiveValue::Set(Uuid::new_v4()),
                    agent_id: ActiveValue::Set(agent_uuid),
                    feature_type: ActiveValue::Set(feature_type.to_string()),
                    action: ActiveValue::Set(action.to_string()),
                    usage_count: ActiveValue::Set(1),
                    last_used_at: ActiveValue::Set(chrono::Utc::now().into()),
                    metadata: ActiveValue::Set(metadata.unwrap_or(Value::Object(serde_json::Map::new()))),
                    created_at: ActiveValue::Set(chrono::Utc::now().into()),
                };

                perception_stats::Entity::insert(new_stat)
                    .exec(db)
                    .await
                    .map_err(|e| format!("Failed to create perception stats: {}", e))?;
            }
        }

        Ok(())
    }

    /// Log perception data (file stored in Supabase)
    pub async fn log_perception(
        db: &DatabaseConnection,
        agent_id: &str,
        conversation_id: Option<&str>,
        perception_type: &str,
        storage_path: &str,
        analysis_result: Option<Value>,
        duration_ms: Option<i32>,
    ) -> Result<(), String> {
        let agent_uuid = Uuid::parse_str(agent_id)
            .map_err(|e| format!("Invalid agent ID: {}", e))?;

        let conversation_uuid = conversation_id
            .map(|id| Uuid::parse_str(id))
            .transpose()
            .map_err(|e| format!("Invalid conversation ID: {}", e))?;

        let new_log = perception_logs::ActiveModel {
            id: ActiveValue::Set(Uuid::new_v4()),
            agent_id: ActiveValue::Set(agent_uuid),
            conversation_id: ActiveValue::Set(conversation_uuid),
            perception_type: ActiveValue::Set(perception_type.to_string()),
            storage_path: ActiveValue::Set(storage_path.to_string()),
            analysis_result: ActiveValue::Set(analysis_result),
            duration_ms: ActiveValue::Set(duration_ms),
            created_at: ActiveValue::Set(chrono::Utc::now().into()),
        };

        perception_logs::Entity::insert(new_log)
            .exec(db)
            .await
            .map_err(|e| format!("Failed to log perception: {}", e))?;

        Ok(())
    }

    /// Get usage stats for an agent
    pub async fn get_stats(
        db: &DatabaseConnection,
        agent_id: &str,
    ) -> Result<Vec<PerceptionStat>, String> {
        let agent_uuid = Uuid::parse_str(agent_id)
            .map_err(|e| format!("Invalid agent ID: {}", e))?;

        let stats = perception_stats::Entity::find()
            .filter(perception_stats::Column::AgentId.eq(agent_uuid))
            .order_by_desc(perception_stats::Column::LastUsedAt)
            .all(db)
            .await
            .map_err(|e| format!("Failed to fetch perception stats: {}", e))?;

        let result = stats.into_iter()
            .map(|stat| PerceptionStat {
                feature_type: stat.feature_type,
                action: stat.action,
                usage_count: stat.usage_count,
                last_used_at: stat.last_used_at.to_string(),
                metadata: stat.metadata,
            })
            .collect();

        Ok(result)
    }
}

/// Data structure for perception stats returned to frontend
#[derive(serde::Serialize)]
pub struct PerceptionStat {
    pub feature_type: String,
    pub action: String,
    pub usage_count: i32,
    pub last_used_at: String,
    pub metadata: Value,
}