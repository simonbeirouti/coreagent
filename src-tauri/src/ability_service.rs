use sea_orm::{
    ActiveModelTrait, ActiveValue, ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter, Set,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::entities::{abilities, agent_abilities};

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
    pub proficiency: f32,
    pub last_used_at: Option<chrono::DateTime<chrono::Utc>>,
}

pub struct AbilityService;

impl AbilityService {
    fn calculate_proficiency(success_count: i32, usage_count: i32) -> f32 {
        if usage_count <= 0 {
            return 0.0;
        }
        (success_count as f32 / usage_count as f32).clamp(0.0, 1.0)
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
}

