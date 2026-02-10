use crate::entities::conversations::{self, Entity as Conversations, ActiveModel, Model as ConversationModel};
use crate::entities::messages::{self, Entity as Messages, ActiveModel as MessageActiveModel, Model as MessageModel};
use sea_orm::{ActiveModelTrait, DatabaseConnection, EntityTrait, QueryFilter, ColumnTrait, Set, ActiveValue, QueryOrder, QuerySelect};
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use chrono;
use tauri::ipc::Channel;
use crate::ai_client::StreamEvent;

// Conversation data structures
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConversationData {
    pub id: Uuid,
    pub agent_id: Uuid,
    pub user_id: Uuid,
    pub title: Option<String>,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub updated_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MessageData {
    pub id: Uuid,
    pub conversation_id: Uuid,
    pub role: String,
    pub content: String,
    pub message_type: String,
    pub metadata: serde_json::Value,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Deserialize)]
pub struct CreateConversationRequest {
    pub agent_id: String,
    pub user_id: String,
    pub title: Option<String>,
}

// Convert SeaORM models to our data structures
impl From<conversations::Model> for ConversationData {
    fn from(model: conversations::Model) -> Self {
        ConversationData {
            id: model.id,
            agent_id: model.agent_id,
            user_id: model.user_id,
            title: model.title,
            created_at: model.created_at.into(),
            updated_at: model.updated_at.into(),
        }
    }
}

impl From<messages::Model> for MessageData {
    fn from(model: messages::Model) -> Self {
        MessageData {
            id: model.id,
            conversation_id: model.conversation_id,
            role: model.role,
            content: model.content,
            message_type: model.message_type,
            metadata: model.metadata,
            created_at: model.created_at.into(),
        }
    }
}

// Conversation service implementation
pub struct ConversationService;

impl ConversationService {
    /// Create a new conversation
    pub async fn create_conversation(
        db: &DatabaseConnection,
        request: CreateConversationRequest,
    ) -> Result<ConversationData, String> {
        let agent_id = Uuid::parse_str(&request.agent_id)
            .map_err(|e| format!("Invalid agent ID: {}", e))?;

        let user_id = Uuid::parse_str(&request.user_id)
            .map_err(|e| format!("Invalid user ID: {}", e))?;

        let conversation = conversations::ActiveModel {
            id: ActiveValue::Set(Uuid::new_v4()),
            agent_id: ActiveValue::Set(agent_id),
            user_id: ActiveValue::Set(user_id),
            title: ActiveValue::Set(request.title),
            created_at: ActiveValue::Set(chrono::Utc::now().into()),
            updated_at: ActiveValue::Set(chrono::Utc::now().into()),
        };

        let conversation = conversation.insert(db).await
            .map_err(|e| format!("Failed to create conversation: {}", e))?;

        println!("[CONVERSATION] Created conversation: {} for agent: {}", conversation.id, agent_id);
        Ok(conversation.into())
    }

    /// List conversations for an agent
    pub async fn list_conversations(
        db: &DatabaseConnection,
        agent_id: String,
    ) -> Result<Vec<ConversationData>, String> {
        let agent_id = Uuid::parse_str(&agent_id)
            .map_err(|e| format!("Invalid agent ID: {}", e))?;

        let conversations = conversations::Entity::find()
            .filter(conversations::Column::AgentId.eq(agent_id))
            .order_by_desc(conversations::Column::UpdatedAt)
            .all(db)
            .await
            .map_err(|e| format!("Failed to list conversations: {}", e))?;

        let conversations: Vec<ConversationData> = conversations.into_iter().map(|c| c.into()).collect();
        println!("[CONVERSATION] Listed {} conversations for agent: {}", conversations.len(), agent_id);
        Ok(conversations)
    }

    /// Get a specific conversation
    pub async fn get_conversation(
        db: &DatabaseConnection,
        conversation_id: String,
    ) -> Result<ConversationData, String> {
        let conversation_id = Uuid::parse_str(&conversation_id)
            .map_err(|e| format!("Invalid conversation ID: {}", e))?;

        let conversation = conversations::Entity::find_by_id(conversation_id)
            .one(db)
            .await
            .map_err(|e| format!("Failed to get conversation: {}", e))?
            .ok_or_else(|| format!("Conversation not found: {}", conversation_id))?;

        Ok(conversation.into())
    }

    /// Get messages for a conversation
    pub async fn get_conversation_messages(
        db: &DatabaseConnection,
        conversation_id: String,
    ) -> Result<Vec<MessageData>, String> {
        let conversation_id = Uuid::parse_str(&conversation_id)
            .map_err(|e| format!("Invalid conversation ID: {}", e))?;

        let messages = messages::Entity::find()
            .filter(messages::Column::ConversationId.eq(conversation_id))
            .order_by_asc(messages::Column::CreatedAt)
            .all(db)
            .await
            .map_err(|e| format!("Failed to get messages: {}", e))?;

        let messages: Vec<MessageData> = messages.into_iter().map(|m| m.into()).collect();
        println!("[CONVERSATION] Retrieved {} messages for conversation: {}", messages.len(), conversation_id);
        Ok(messages)
    }

    /// Send a message to a conversation (user message + AI response)
    pub async fn send_message(
        db: &DatabaseConnection,
        conversation_id: String,
        content: String,
        image_base64: Option<String>,
        ai_client: &crate::ai_client::AiClient,
    ) -> Result<MessageData, String> {
        let conversation_id = Uuid::parse_str(&conversation_id)
            .map_err(|e| format!("Invalid conversation ID: {}", e))?;

        // First, verify the conversation exists and get the agent
        let conversation = conversations::Entity::find_by_id(conversation_id)
            .one(db)
            .await
            .map_err(|e| format!("Failed to find conversation: {}", e))?
            .ok_or_else(|| format!("Conversation not found: {}", conversation_id))?;

        // Create user message
        let user_message = messages::ActiveModel {
            id: ActiveValue::Set(Uuid::new_v4()),
            conversation_id: ActiveValue::Set(conversation_id),
            role: ActiveValue::Set("user".to_string()),
            content: ActiveValue::Set(content.clone()),
            message_type: ActiveValue::Set("text".to_string()),
            metadata: ActiveValue::Set(serde_json::json!({})),
            created_at: ActiveValue::Set(chrono::Utc::now().into()),
        };

        user_message.insert(db).await
            .map_err(|e| format!("Failed to save user message: {}", e))?;

        // Fetch conversation history (last 20 messages for context)
        let history_messages = messages::Entity::find()
            .filter(messages::Column::ConversationId.eq(conversation_id))
            .order_by_desc(messages::Column::CreatedAt)
            .limit(20)
            .all(db)
            .await
            .map_err(|e| format!("Failed to fetch conversation history: {}", e))?;

        // Build history in chronological order (oldest first)
        let mut history: Vec<(String, String)> = history_messages
            .into_iter()
            .rev()
            .map(|msg| (msg.role, msg.content))
            .collect();

        // Remove the user message we just added from history to avoid duplication
        if !history.is_empty() {
            history.pop();
        }

        println!("[CONVERSATION] Processing message with {} history items", history.len());

        // Get AI response with conversation history
        let ai_response = crate::agent_service::AgentService::send_message_to_agent(
            db,
            conversation.agent_id.to_string(),
            content,
            history,
            image_base64,
            ai_client,
        ).await?;

        // Create assistant message
        let assistant_message = messages::ActiveModel {
            id: ActiveValue::Set(Uuid::new_v4()),
            conversation_id: ActiveValue::Set(conversation_id),
            role: ActiveValue::Set("assistant".to_string()),
            content: ActiveValue::Set(ai_response),
            message_type: ActiveValue::Set("text".to_string()),
            metadata: ActiveValue::Set(serde_json::json!({})),
            created_at: ActiveValue::Set(chrono::Utc::now().into()),
        };

        let saved_message = assistant_message.insert(db).await
            .map_err(|e| format!("Failed to save assistant message: {}", e))?;

        // Update conversation timestamp
        let mut conversation_model: conversations::ActiveModel = conversation.into();
        conversation_model.updated_at = Set(chrono::Utc::now().into());
        conversation_model.update(db).await
            .map_err(|e| format!("Failed to update conversation timestamp: {}", e))?;

        println!("[CONVERSATION] Added message to conversation: {}", conversation_id);
        Ok(saved_message.into())
    }

    /// Send a message to a conversation (user message + AI response) with streaming
    pub async fn send_message_streaming(
        db: &DatabaseConnection,
        conversation_id: String,
        content: String,
        image_base64: Option<String>,
        on_event: crate::ai_client::Channel<crate::ai_client::StreamEvent>,
        ai_client: &crate::ai_client::AiClient,
    ) -> Result<MessageData, String> {
        let conversation_id = Uuid::parse_str(&conversation_id)
            .map_err(|e| format!("Invalid conversation ID: {}", e))?;

        // First, verify the conversation exists and get the agent
        let conversation = conversations::Entity::find_by_id(conversation_id)
            .one(db)
            .await
            .map_err(|e| format!("Failed to find conversation: {}", e))?
            .ok_or_else(|| format!("Conversation not found: {}", conversation_id))?;

        // Create user message
        let user_message = messages::ActiveModel {
            id: ActiveValue::Set(Uuid::new_v4()),
            conversation_id: ActiveValue::Set(conversation_id),
            role: ActiveValue::Set("user".to_string()),
            content: ActiveValue::Set(content.clone()),
            message_type: ActiveValue::Set("text".to_string()),
            metadata: ActiveValue::Set(serde_json::json!({})),
            created_at: ActiveValue::Set(chrono::Utc::now().into()),
        };

        user_message.insert(db).await
            .map_err(|e| format!("Failed to save user message: {}", e))?;

        // Fetch conversation history (last 20 messages for context)
        let history_messages = messages::Entity::find()
            .filter(messages::Column::ConversationId.eq(conversation_id))
            .order_by_desc(messages::Column::CreatedAt)
            .limit(20)
            .all(db)
            .await
            .map_err(|e| format!("Failed to fetch conversation history: {}", e))?;

        // Build history in chronological order (oldest first)
        let mut history: Vec<(String, String)> = history_messages
            .into_iter()
            .rev()
            .map(|msg| (msg.role, msg.content))
            .collect();

        // Remove the user message we just added from history to avoid duplication
        if !history.is_empty() {
            history.pop();
        }

        println!("[CONVERSATION] Processing streaming message with {} history items", history.len());

        // Get AI response with conversation history (streaming)
        let ai_response = crate::agent_service::AgentService::send_message_to_agent_streaming(
            db,
            conversation.agent_id.to_string(),
            content,
            history,
            image_base64,
            on_event,
            ai_client,
        ).await?;

        // Create assistant message
        let assistant_message = messages::ActiveModel {
            id: ActiveValue::Set(Uuid::new_v4()),
            conversation_id: ActiveValue::Set(conversation_id),
            role: ActiveValue::Set("assistant".to_string()),
            content: ActiveValue::Set(ai_response),
            message_type: ActiveValue::Set("text".to_string()),
            metadata: ActiveValue::Set(serde_json::json!({})),
            created_at: ActiveValue::Set(chrono::Utc::now().into()),
        };

        let saved_message = assistant_message.insert(db).await
            .map_err(|e| format!("Failed to save assistant message: {}", e))?;

        // Update conversation timestamp
        let mut conversation_model: conversations::ActiveModel = conversation.into();
        conversation_model.updated_at = Set(chrono::Utc::now().into());
        conversation_model.update(db).await
            .map_err(|e| format!("Failed to update conversation timestamp: {}", e))?;

        println!("[CONVERSATION] Added streaming message to conversation: {}", conversation_id);
        Ok(saved_message.into())
    }

    /// Update conversation title
    pub async fn update_conversation_title(
        db: &DatabaseConnection,
        conversation_id: String,
        title: Option<String>,
    ) -> Result<ConversationData, String> {
        let conversation_id = Uuid::parse_str(&conversation_id)
            .map_err(|e| format!("Invalid conversation ID: {}", e))?;

        let mut conversation: conversations::ActiveModel = conversations::Entity::find_by_id(conversation_id)
            .one(db)
            .await
            .map_err(|e| format!("Failed to find conversation: {}", e))?
            .ok_or_else(|| format!("Conversation not found: {}", conversation_id))?
            .into();

        conversation.title = Set(title);
        conversation.updated_at = Set(chrono::Utc::now().into());

        let conversation = conversation.update(db).await
            .map_err(|e| format!("Failed to update conversation: {}", e))?;

        println!("[CONVERSATION] Updated conversation title: {}", conversation_id);
        Ok(conversation.into())
    }

    /// Generate and update conversation title based on the first message
    pub async fn generate_and_update_conversation_title(
        db: &DatabaseConnection,
        conversation_id: String,
        first_message: String,
        ai_client: &crate::ai_client::AiClient,
    ) -> Result<ConversationData, String> {
        let conversation_id = Uuid::parse_str(&conversation_id)
            .map_err(|e| format!("Invalid conversation ID: {}", e))?;

        // Generate title using AI
        let title_prompt = format!(
            "Summarize this message in 2-5 words as a conversation title. Respond with only the title, no quotes or punctuation.\n\nMessage: {}",
            first_message
        );

        // Use a lightweight model for title generation
        let title = ai_client.get_completion(
            "openai", // Default to OpenAI for title generation
            "gpt-4o-mini", // Use cheaper model for this simple task
            "Title Generator", // Dummy agent name
            "You are a helpful assistant that generates concise conversation titles.", // Simple persona
            None, // No mission
            None, // No values
            None, // No constraints
            None, // No user profile needed
            vec![], // No conversation history needed
            &title_prompt,
        ).await
        .map_err(|e| format!("Failed to generate title: {}", e))?
        .trim()
        .to_string();

        // Ensure title is reasonable length (2-5 words)
        let word_count = title.split_whitespace().count();
        if word_count < 2 || word_count > 5 {
            println!("[CONVERSATION] Generated title '{}' has {} words, using default", title, word_count);
            // Fallback to a generic title if AI generated something too long/short
            let fallback_title = if first_message.len() > 50 {
                format!("{}...", &first_message[..47])
            } else {
                first_message.clone()
            };
            return Self::update_conversation_title(db, conversation_id.to_string(), Some(fallback_title)).await;
        }

        println!("[CONVERSATION] Generated title '{}' for conversation {}", title, conversation_id);
        Self::update_conversation_title(db, conversation_id.to_string(), Some(title)).await
    }

    /// Delete a conversation and all its messages
    pub async fn delete_conversation(
        db: &DatabaseConnection,
        conversation_id: String,
    ) -> Result<(), String> {
        let conversation_id = Uuid::parse_str(&conversation_id)
            .map_err(|e| format!("Invalid conversation ID: {}", e))?;

        // Delete the conversation (messages will be cascade deleted due to foreign key)
        let result = conversations::Entity::delete_by_id(conversation_id)
            .exec(db)
            .await
            .map_err(|e| format!("Failed to delete conversation: {}", e))?;

        if result.rows_affected == 0 {
            return Err(format!("Conversation not found: {}", conversation_id));
        }

        println!("[CONVERSATION] Deleted conversation: {}", conversation_id);
        Ok(())
    }

    /// Save voice transcript entries to conversation
    /// This saves multiple transcript entries (user and assistant) as messages
    pub async fn save_voice_transcript(
        db: &DatabaseConnection,
        conversation_id: String,
        entries: Vec<TranscriptEntry>,
    ) -> Result<Vec<MessageData>, String> {
        let conversation_id = Uuid::parse_str(&conversation_id)
            .map_err(|e| format!("Invalid conversation ID: {}", e))?;

        // Verify the conversation exists
        let conversation = conversations::Entity::find_by_id(conversation_id)
            .one(db)
            .await
            .map_err(|e| format!("Failed to find conversation: {}", e))?
            .ok_or_else(|| format!("Conversation not found: {}", conversation_id))?;

        let mut saved_messages: Vec<MessageData> = Vec::new();

        for entry in entries {
            let message = messages::ActiveModel {
                id: ActiveValue::Set(Uuid::new_v4()),
                conversation_id: ActiveValue::Set(conversation_id),
                role: ActiveValue::Set(entry.role),
                content: ActiveValue::Set(entry.text),
                message_type: ActiveValue::Set("audio".to_string()), // Mark as audio message
                metadata: ActiveValue::Set(serde_json::json!({
                    "source": "voice_chat",
                    "timestamp": entry.timestamp
                })),
                created_at: ActiveValue::Set(chrono::Utc::now().into()),
            };

            let saved = message.insert(db).await
                .map_err(|e| format!("Failed to save transcript entry: {}", e))?;
            
            saved_messages.push(saved.into());
        }

        // Update conversation timestamp
        let mut conversation_model: conversations::ActiveModel = conversation.into();
        conversation_model.updated_at = Set(chrono::Utc::now().into());
        conversation_model.update(db).await
            .map_err(|e| format!("Failed to update conversation timestamp: {}", e))?;

        println!("[CONVERSATION] Saved {} voice transcript entries to conversation: {}", saved_messages.len(), conversation_id);
        Ok(saved_messages)
    }
}

/// Voice transcript entry from the frontend
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TranscriptEntry {
    pub role: String,
    pub text: String,
    pub timestamp: String,
}