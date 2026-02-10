use crate::entities::agents::{self, Entity as Agents, ActiveModel, Model};
use crate::user_profile_service::{UserProfileService, UserProfileData};
use sea_orm::{ActiveModelTrait, DatabaseConnection, EntityTrait, QueryFilter, ColumnTrait, Set, ActiveValue};
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use chrono;
use tauri::ipc::Channel;
use crate::ai_client::StreamEvent;

// Agent data structures
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentData {
    pub id: Uuid,
    pub user_id: Uuid,
    pub name: String,
    pub persona: String,
    pub provider_type: String,
    pub model_id: String,
    pub state: String,
    pub mission: Option<String>,
    pub values: Option<Vec<String>>,
    pub behavioral_constraints: Option<serde_json::Value>,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub updated_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Deserialize)]
pub struct CreateAgentRequest {
    pub name: String,
    pub persona: String,
    pub provider_type: String,
    pub model_id: String,
    pub user_id: String,
    pub mission: Option<String>,
    pub values: Option<Vec<String>>,
    pub behavioral_constraints: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateAgentRequest {
    pub name: Option<String>,
    pub persona: Option<String>,
    pub provider_type: Option<String>,
    pub model_id: Option<String>,
    pub state: Option<String>,
    pub mission: Option<String>,
    pub values: Option<Vec<String>>,
    pub behavioral_constraints: Option<serde_json::Value>,
}

// Convert SeaORM model to our AgentData struct
impl From<agents::Model> for AgentData {
    fn from(model: agents::Model) -> Self {
        AgentData {
            id: model.id,
            user_id: model.user_id,
            name: model.name,
            persona: model.persona,
            provider_type: model.provider_type,
            model_id: model.model_id,
            state: model.state,
            mission: model.mission,
            values: model.values,
            behavioral_constraints: model.behavioral_constraints,
            created_at: model.created_at.into(),
            updated_at: model.updated_at.into(),
        }
    }
}

// Agent service implementation
pub struct AgentService;

impl AgentService {
    /// Create a new agent
    pub async fn create_agent(
        db: &DatabaseConnection,
        request: CreateAgentRequest,
    ) -> Result<AgentData, String> {
        let user_id = Uuid::parse_str(&request.user_id)
            .map_err(|e| format!("Invalid user ID: {}", e))?;

        // Validate provider type
        if !["openai", "anthropic"].contains(&request.provider_type.as_str()) {
            return Err("Invalid provider type. Must be 'openai' or 'anthropic'".to_string());
        }

        // Validate state (default to active)
        let state = "active".to_string();

        let agent = agents::ActiveModel {
            id: ActiveValue::Set(Uuid::new_v4()),
            user_id: ActiveValue::Set(user_id),
            name: ActiveValue::Set(request.name),
            persona: ActiveValue::Set(request.persona),
            provider_type: ActiveValue::Set(request.provider_type),
            model_id: ActiveValue::Set(request.model_id),
            state: ActiveValue::Set(state),
            mission: ActiveValue::Set(request.mission),
            values: ActiveValue::Set(request.values),
            behavioral_constraints: ActiveValue::Set(request.behavioral_constraints),
            created_at: ActiveValue::Set(chrono::Utc::now().into()),
            updated_at: ActiveValue::Set(chrono::Utc::now().into()),
        };

        let agent = agent.insert(db).await
            .map_err(|e| format!("Failed to create agent: {}", e))?;

        println!("[AGENT] Created agent: {} for user: {}", agent.name, agent.user_id);
        Ok(agent.into())
    }

    /// List all agents for a user
    pub async fn list_agents(
        db: &DatabaseConnection,
        user_id: String,
    ) -> Result<Vec<AgentData>, String> {
        let user_id = Uuid::parse_str(&user_id)
            .map_err(|e| format!("Invalid user ID: {}", e))?;

        let agents = agents::Entity::find()
            .filter(agents::Column::UserId.eq(user_id))
            .all(db)
            .await
            .map_err(|e| format!("Failed to list agents: {}", e))?;

        let agents: Vec<AgentData> = agents.into_iter().map(|a| a.into()).collect();
        println!("[AGENT] Listed {} agents for user: {}", agents.len(), user_id);
        Ok(agents)
    }

    /// Get a specific agent
    pub async fn get_agent(
        db: &DatabaseConnection,
        agent_id: String,
    ) -> Result<AgentData, String> {
        let agent_id = Uuid::parse_str(&agent_id)
            .map_err(|e| format!("Invalid agent ID: {}", e))?;

        let agent = agents::Entity::find_by_id(agent_id)
            .one(db)
            .await
            .map_err(|e| format!("Failed to get agent: {}", e))?
            .ok_or_else(|| format!("Agent not found: {}", agent_id))?;

        Ok(agent.into())
    }

    /// Update an agent
    pub async fn update_agent(
        db: &DatabaseConnection,
        agent_id: String,
        updates: UpdateAgentRequest,
    ) -> Result<AgentData, String> {
        let agent_id = Uuid::parse_str(&agent_id)
            .map_err(|e| format!("Invalid agent ID: {}", e))?;

        let mut agent: agents::ActiveModel = agents::Entity::find_by_id(agent_id)
            .one(db)
            .await
            .map_err(|e| format!("Failed to find agent: {}", e))?
            .ok_or_else(|| format!("Agent not found: {}", agent_id))?
            .into();

        // Apply updates
        if let Some(name) = updates.name {
            agent.name = Set(name);
        }
        if let Some(persona) = updates.persona {
            agent.persona = Set(persona);
        }
        if let Some(provider_type) = updates.provider_type {
            if !["openai", "anthropic"].contains(&provider_type.as_str()) {
                return Err("Invalid provider type. Must be 'openai' or 'anthropic'".to_string());
            }
            agent.provider_type = Set(provider_type);
        }
        if let Some(model_id) = updates.model_id {
            agent.model_id = Set(model_id);
        }
        if let Some(state) = updates.state {
            if !["active", "paused", "stopped"].contains(&state.as_str()) {
                return Err("Invalid state. Must be 'active', 'paused', or 'stopped'".to_string());
            }
            agent.state = Set(state);
        }
        if let Some(mission) = updates.mission {
            agent.mission = Set(Some(mission));
        }
        if let Some(values) = updates.values {
            agent.values = Set(Some(values));
        }
        if let Some(behavioral_constraints) = updates.behavioral_constraints {
            agent.behavioral_constraints = Set(Some(behavioral_constraints));
        }

        agent.updated_at = Set(chrono::Utc::now().into());

        let agent = agent.update(db).await
            .map_err(|e| format!("Failed to update agent: {}", e))?;

        println!("[AGENT] Updated agent: {}", agent.name);
        Ok(agent.into())
    }

    /// Delete an agent
    pub async fn delete_agent(
        db: &DatabaseConnection,
        agent_id: String,
    ) -> Result<(), String> {
        let agent_id = Uuid::parse_str(&agent_id)
            .map_err(|e| format!("Invalid agent ID: {}", e))?;

        let result = agents::Entity::delete_by_id(agent_id)
            .exec(db)
            .await
            .map_err(|e| format!("Failed to delete agent: {}", e))?;

        if result.rows_affected == 0 {
            return Err(format!("Agent not found: {}", agent_id));
        }

        println!("[AGENT] Deleted agent: {}", agent_id);
        Ok(())
    }

    /// Send a message to an agent and get response with conversation history
    pub async fn send_message_to_agent(
        db: &DatabaseConnection,
        agent_id: String,
        message: String,
        history: Vec<(String, String)>, // (role, content) pairs
        image_base64: Option<String>,
        ai_client: &crate::ai_client::AiClient,
    ) -> Result<String, String> {
        // Get agent details from database
        let agent_uuid = Uuid::parse_str(&agent_id)
            .map_err(|e| format!("Invalid agent ID: {}", e))?;

        let agent = agents::Entity::find_by_id(agent_uuid)
            .one(db)
            .await
            .map_err(|e| format!("Failed to get agent: {}", e))?
            .ok_or_else(|| format!("Agent not found: {}", agent_id))?;

        println!("[AGENT] Agent {} processing message with {} history items", agent.name, history.len());

        // Fetch user profile for personalized context
        let user_profile = UserProfileService::get_or_create_profile(
            db,
            agent.user_id.to_string()
        ).await.ok();

        // Call AI client with agent's configuration and user profile
        let response = ai_client
            .get_completion_with_image(
                &agent.provider_type,
                &agent.model_id,
                &agent.name,
                &agent.persona,
                agent.mission.as_deref(),
                agent.values.as_deref(),
                agent.behavioral_constraints.as_ref(),
                user_profile.as_ref(),
                history,
                &message,
                image_base64.as_deref(),
            )
            .await?;

        println!("[AGENT] Agent {} generated response ({} chars)", agent.name, response.len());
        Ok(response)
    }

    /// Send message to agent with streaming response
    pub async fn send_message_to_agent_streaming(
        db: &sea_orm::DatabaseConnection,
        agent_id: String,
        message: String,
        history: Vec<(String, String)>,
        image_base64: Option<String>,
        on_event: Channel<StreamEvent>,
        ai_client: &crate::ai_client::AiClient,
    ) -> Result<String, String> {
        let agent_id = uuid::Uuid::parse_str(&agent_id)
            .map_err(|e| format!("Invalid agent ID: {}", e))?;

        // Fetch agent configuration
        let agent = crate::entities::agents::Entity::find_by_id(agent_id)
            .one(db)
            .await
            .map_err(|e| format!("Failed to fetch agent: {}", e))?
            .ok_or_else(|| format!("Agent not found: {}", agent_id))?;

        println!("[AGENT] Sending streaming message to agent: {}", agent.name);

        // Fetch user profile for personalization (optional)
        let user_profile = crate::user_profile_service::UserProfileService::get_profile(db, "default_user".to_string())
            .await.ok().flatten();

        // Call AI client with agent's configuration and user profile (streaming)
        let response = ai_client
            .get_completion_with_image_streaming(
                &agent.provider_type,
                &agent.model_id,
                &agent.name,
                &agent.persona,
                agent.mission.as_deref(),
                agent.values.as_deref(),
                agent.behavioral_constraints.as_ref(),
                user_profile.as_ref(),
                history,
                &message,
                image_base64.as_deref(),
                on_event,
            )
            .await?;

        println!("[AGENT] Agent {} generated streaming response ({} chars)", agent.name, response.len());
        Ok(response)
    }
}