use crate::entities::conversations::{self};
use crate::entities::messages::{self};
use sea_orm::{ActiveModelTrait, DatabaseConnection, EntityTrait, QueryFilter, ColumnTrait, Set, ActiveValue, QueryOrder, QuerySelect};
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use chrono;
use crate::ability_service::AbilityService;
use crate::input_sanitizer::sanitize_message;
use crate::memory_service::MemoryService;

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
    /// Parent message ID for branching support
    pub parent_id: Option<Uuid>,
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
            parent_id: model.parent_id,
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

        // Sanitize the user input
        let sanitized_content = sanitize_message(&content)
            .map_err(|e| format!("Input validation failed: {}", e))?;

        // First, verify the conversation exists and get the agent
        let conversation = conversations::Entity::find_by_id(conversation_id)
            .one(db)
            .await
            .map_err(|e| format!("Failed to find conversation: {}", e))?
            .ok_or_else(|| format!("Conversation not found: {}", conversation_id))?;

        // Find the last message in the conversation to use as parent_id
        let last_message = messages::Entity::find()
            .filter(messages::Column::ConversationId.eq(conversation_id))
            .order_by_desc(messages::Column::CreatedAt)
            .one(db)
            .await
            .map_err(|e| format!("Failed to find last message: {}", e))?;
        
        let parent_id = last_message.map(|m| m.id);

        // Create user message with parent_id
        let user_message_id = Uuid::new_v4();
        let user_message = messages::ActiveModel {
            id: ActiveValue::Set(user_message_id),
            conversation_id: ActiveValue::Set(conversation_id),
            role: ActiveValue::Set("user".to_string()),
            content: ActiveValue::Set(sanitized_content.content.clone()),
            message_type: ActiveValue::Set("text".to_string()),
            metadata: ActiveValue::Set(serde_json::json!({})),
            created_at: ActiveValue::Set(chrono::Utc::now().into()),
            parent_id: ActiveValue::Set(parent_id),
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

        // Add semantic memory context if available (best-effort).
        let mut final_prompt = content.clone();
        if let Ok(memories) = MemoryService::get_relevant_context(
            db,
            &sanitized_content.content,
            conversation.agent_id,
            Some(conversation_id),
        )
        .await
        {
            let _ = AbilityService::track_ability_usage(
                db,
                conversation.agent_id,
                "memory_retrieval",
                !memories.is_empty(),
            )
            .await;
            if !memories.is_empty() {
                final_prompt = format!(
                    "{}\n\nRelevant prior context:\n{}",
                    content,
                    memories.join("\n")
                );
            }
        }

        // Get AI response with conversation history
        let ai_response = crate::agent_service::AgentService::send_message_to_agent(
            db,
            conversation.agent_id.to_string(),
            final_prompt,
            history,
            image_base64,
            ai_client,
        ).await?;

        // Create assistant message with parent_id pointing to the user message
        let assistant_message = messages::ActiveModel {
            id: ActiveValue::Set(Uuid::new_v4()),
            conversation_id: ActiveValue::Set(conversation_id),
            role: ActiveValue::Set("assistant".to_string()),
            content: ActiveValue::Set(ai_response),
            message_type: ActiveValue::Set("text".to_string()),
            metadata: ActiveValue::Set(serde_json::json!({})),
            created_at: ActiveValue::Set(chrono::Utc::now().into()),
            parent_id: ActiveValue::Set(Some(user_message_id)),
        };

        let saved_message = assistant_message.insert(db).await
            .map_err(|e| format!("Failed to save assistant message: {}", e))?;

        // Embed user + assistant messages (best-effort, non-fatal).
        let _ = MemoryService::embed_message_content(db, user_message_id, &sanitized_content.content).await;
        let _ = MemoryService::embed_message_content(db, saved_message.id, &saved_message.content).await;

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

        // Sanitize the user input
        let sanitized_content = sanitize_message(&content)
            .map_err(|e| format!("Input validation failed: {}", e))?;

        // First, verify the conversation exists and get the agent
        let conversation = conversations::Entity::find_by_id(conversation_id)
            .one(db)
            .await
            .map_err(|e| format!("Failed to find conversation: {}", e))?
            .ok_or_else(|| format!("Conversation not found: {}", conversation_id))?;

        // Find the last message in the conversation to use as parent_id
        let last_message = messages::Entity::find()
            .filter(messages::Column::ConversationId.eq(conversation_id))
            .order_by_desc(messages::Column::CreatedAt)
            .one(db)
            .await
            .map_err(|e| format!("Failed to find last message: {}", e))?;
        
        let parent_id = last_message.map(|m| m.id);

        // Create user message with parent_id
        let user_message_id = Uuid::new_v4();
        let user_message = messages::ActiveModel {
            id: ActiveValue::Set(user_message_id),
            conversation_id: ActiveValue::Set(conversation_id),
            role: ActiveValue::Set("user".to_string()),
            content: ActiveValue::Set(sanitized_content.content.clone()),
            message_type: ActiveValue::Set("text".to_string()),
            metadata: ActiveValue::Set(serde_json::json!({})),
            created_at: ActiveValue::Set(chrono::Utc::now().into()),
            parent_id: ActiveValue::Set(parent_id),
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

        // Add semantic memory context if available (best-effort).
        let mut final_prompt = content.clone();
        if let Ok(memories) = MemoryService::get_relevant_context(
            db,
            &sanitized_content.content,
            conversation.agent_id,
            Some(conversation_id),
        )
        .await
        {
            let _ = AbilityService::track_ability_usage(
                db,
                conversation.agent_id,
                "memory_retrieval",
                !memories.is_empty(),
            )
            .await;
            if !memories.is_empty() {
                final_prompt = format!(
                    "{}\n\nRelevant prior context:\n{}",
                    content,
                    memories.join("\n")
                );
            }
        }

        // Get AI response with conversation history (streaming)
        let ai_response = crate::agent_service::AgentService::send_message_to_agent_streaming(
            db,
            conversation.agent_id.to_string(),
            final_prompt,
            history,
            image_base64,
            on_event,
            ai_client,
        ).await?;

        // Create assistant message with parent_id pointing to the user message
        let assistant_message = messages::ActiveModel {
            id: ActiveValue::Set(Uuid::new_v4()),
            conversation_id: ActiveValue::Set(conversation_id),
            role: ActiveValue::Set("assistant".to_string()),
            content: ActiveValue::Set(ai_response),
            message_type: ActiveValue::Set("text".to_string()),
            metadata: ActiveValue::Set(serde_json::json!({})),
            created_at: ActiveValue::Set(chrono::Utc::now().into()),
            parent_id: ActiveValue::Set(Some(user_message_id)),
        };

        let saved_message = assistant_message.insert(db).await
            .map_err(|e| format!("Failed to save assistant message: {}", e))?;

        // Embed user + assistant messages (best-effort, non-fatal).
        let _ = MemoryService::embed_message_content(db, user_message_id, &sanitized_content.content).await;
        let _ = MemoryService::embed_message_content(db, saved_message.id, &saved_message.content).await;

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

        // Sanitize the first message before using it in the prompt
        let sanitized_message = sanitize_message(&first_message)
            .map_err(|e| format!("Input validation failed: {}", e))?;

        // Generate title using AI
        let title_prompt = format!(
            "Summarize this message in 2-5 words as a conversation title. Respond with only the title, no quotes or punctuation.\n\nMessage: {}",
            sanitized_message.content
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
        if !(2..=5).contains(&word_count) {
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

    /// Delete a single message and its direct child (assistant response if deleting a user message)
    pub async fn delete_message(
        db: &DatabaseConnection,
        message_id: String,
    ) -> Result<Vec<Uuid>, String> {
        let message_id = Uuid::parse_str(&message_id)
            .map_err(|e| format!("Invalid message ID: {}", e))?;

        // Find the message to delete
        let message = messages::Entity::find_by_id(message_id)
            .one(db)
            .await
            .map_err(|e| format!("Failed to find message: {}", e))?
            .ok_or_else(|| format!("Message not found: {}", message_id))?;

        let mut deleted_ids = Vec::new();

        // If it's a user message, also delete its direct assistant response (child)
        if message.role == "user" {
            let child_messages = messages::Entity::find()
                .filter(messages::Column::ParentId.eq(Some(message_id)))
                .filter(messages::Column::Role.eq("assistant"))
                .all(db)
                .await
                .map_err(|e| format!("Failed to find child messages: {}", e))?;

            for child in child_messages {
                deleted_ids.push(child.id);
                messages::Entity::delete_by_id(child.id)
                    .exec(db)
                    .await
                    .map_err(|e| format!("Failed to delete child message: {}", e))?;
            }
        }

        // Delete the message itself
        deleted_ids.push(message_id);
        let result = messages::Entity::delete_by_id(message_id)
            .exec(db)
            .await
            .map_err(|e| format!("Failed to delete message: {}", e))?;

        if result.rows_affected == 0 {
            return Err(format!("Message not found: {}", message_id));
        }

        println!("[CONVERSATION] Deleted message(s): {:?}", deleted_ids);
        Ok(deleted_ids)
    }

    /// Edit a message by creating a new sibling branch
    /// This creates a new user message with the same parent_id (sibling to the original)
    /// and gets a new AI response, creating a branch in the conversation tree
    pub async fn edit_message(
        db: &DatabaseConnection,
        message_id: String,
        new_content: String,
        image_base64: Option<String>,
        ai_client: &crate::ai_client::AiClient,
    ) -> Result<(MessageData, MessageData), String> {
        let message_id = Uuid::parse_str(&message_id)
            .map_err(|e| format!("Invalid message ID: {}", e))?;

        // Sanitize the new content
        let sanitized_content = sanitize_message(&new_content)
            .map_err(|e| format!("Input validation failed: {}", e))?;

        // Find the original message
        let original_message = messages::Entity::find_by_id(message_id)
            .one(db)
            .await
            .map_err(|e| format!("Failed to find message: {}", e))?
            .ok_or_else(|| format!("Message not found: {}", message_id))?;

        // Only user messages can be edited
        if original_message.role != "user" {
            return Err("Only user messages can be edited".to_string());
        }

        // Get the conversation for agent info
        let conversation = conversations::Entity::find_by_id(original_message.conversation_id)
            .one(db)
            .await
            .map_err(|e| format!("Failed to find conversation: {}", e))?
            .ok_or_else(|| format!("Conversation not found: {}", original_message.conversation_id))?;

        // Create new user message as a sibling (same parent_id as original)
        let new_user_message_id = Uuid::new_v4();
        let new_user_message = messages::ActiveModel {
            id: ActiveValue::Set(new_user_message_id),
            conversation_id: ActiveValue::Set(original_message.conversation_id),
            role: ActiveValue::Set("user".to_string()),
            content: ActiveValue::Set(sanitized_content.content.clone()),
            message_type: ActiveValue::Set(original_message.message_type.clone()),
            metadata: ActiveValue::Set(serde_json::json!({
                "edited_from": message_id.to_string()
            })),
            created_at: ActiveValue::Set(chrono::Utc::now().into()),
            parent_id: ActiveValue::Set(original_message.parent_id), // Same parent = sibling branch
        };

        let saved_user_message = new_user_message.insert(db).await
            .map_err(|e| format!("Failed to save new user message: {}", e))?;

        // Build history up to (but not including) the original message's parent
        // This gives us the conversation context up to the branch point
        let mut history: Vec<(String, String)> = Vec::new();
        
        if let Some(parent_id) = original_message.parent_id {
            // Walk up the tree to build history
            let mut current_id = Some(parent_id);
            let mut history_messages = Vec::new();
            
            while let Some(id) = current_id {
                if let Some(msg) = messages::Entity::find_by_id(id)
                    .one(db)
                    .await
                    .map_err(|e| format!("Failed to fetch history message: {}", e))?
                {
                    current_id = msg.parent_id;
                    history_messages.push((msg.role, msg.content));
                } else {
                    break;
                }
            }
            
            // Reverse to get chronological order
            history_messages.reverse();
            history = history_messages;
        }

        println!("[CONVERSATION] Edit message: built {} history items for branch", history.len());

        // Add semantic memory context if available (best-effort).
        let mut final_prompt = new_content.clone();
        if let Ok(memories) = MemoryService::get_relevant_context(
            db,
            &sanitized_content.content,
            conversation.agent_id,
            Some(original_message.conversation_id),
        )
        .await
        {
            let _ = AbilityService::track_ability_usage(
                db,
                conversation.agent_id,
                "memory_retrieval",
                !memories.is_empty(),
            )
            .await;
            if !memories.is_empty() {
                final_prompt = format!(
                    "{}\n\nRelevant prior context:\n{}",
                    new_content,
                    memories.join("\n")
                );
            }
        }

        // Get AI response with the history up to the branch point
        let ai_response = crate::agent_service::AgentService::send_message_to_agent(
            db,
            conversation.agent_id.to_string(),
            final_prompt,
            history,
            image_base64,
            ai_client,
        ).await?;

        // Create assistant response as child of new user message
        let new_assistant_message = messages::ActiveModel {
            id: ActiveValue::Set(Uuid::new_v4()),
            conversation_id: ActiveValue::Set(original_message.conversation_id),
            role: ActiveValue::Set("assistant".to_string()),
            content: ActiveValue::Set(ai_response),
            message_type: ActiveValue::Set("text".to_string()),
            metadata: ActiveValue::Set(serde_json::json!({})),
            created_at: ActiveValue::Set(chrono::Utc::now().into()),
            parent_id: ActiveValue::Set(Some(new_user_message_id)),
        };

        let saved_assistant_message = new_assistant_message.insert(db).await
            .map_err(|e| format!("Failed to save assistant message: {}", e))?;

        // Embed branch user + assistant messages (best-effort).
        let _ = MemoryService::embed_message_content(db, new_user_message_id, &sanitized_content.content).await;
        let _ = MemoryService::embed_message_content(db, saved_assistant_message.id, &saved_assistant_message.content).await;

        // Update conversation timestamp
        let mut conversation_model: conversations::ActiveModel = conversation.into();
        conversation_model.updated_at = Set(chrono::Utc::now().into());
        conversation_model.update(db).await
            .map_err(|e| format!("Failed to update conversation timestamp: {}", e))?;

        println!("[CONVERSATION] Created edit branch from message {}", message_id);
        Ok((saved_user_message.into(), saved_assistant_message.into()))
    }

    /// Edit a message by creating a new sibling branch (streaming version)
    pub async fn edit_message_streaming(
        db: &DatabaseConnection,
        message_id: String,
        new_content: String,
        image_base64: Option<String>,
        on_event: crate::ai_client::Channel<crate::ai_client::StreamEvent>,
        ai_client: &crate::ai_client::AiClient,
    ) -> Result<(MessageData, MessageData), String> {
        let message_id = Uuid::parse_str(&message_id)
            .map_err(|e| format!("Invalid message ID: {}", e))?;

        // Sanitize the new content
        let sanitized_content = sanitize_message(&new_content)
            .map_err(|e| format!("Input validation failed: {}", e))?;

        // Find the original message
        let original_message = messages::Entity::find_by_id(message_id)
            .one(db)
            .await
            .map_err(|e| format!("Failed to find message: {}", e))?
            .ok_or_else(|| format!("Message not found: {}", message_id))?;

        // Only user messages can be edited
        if original_message.role != "user" {
            return Err("Only user messages can be edited".to_string());
        }

        // Get the conversation for agent info
        let conversation = conversations::Entity::find_by_id(original_message.conversation_id)
            .one(db)
            .await
            .map_err(|e| format!("Failed to find conversation: {}", e))?
            .ok_or_else(|| format!("Conversation not found: {}", original_message.conversation_id))?;

        // Create new user message as a sibling (same parent_id as original)
        let new_user_message_id = Uuid::new_v4();
        let new_user_message = messages::ActiveModel {
            id: ActiveValue::Set(new_user_message_id),
            conversation_id: ActiveValue::Set(original_message.conversation_id),
            role: ActiveValue::Set("user".to_string()),
            content: ActiveValue::Set(sanitized_content.content.clone()),
            message_type: ActiveValue::Set(original_message.message_type.clone()),
            metadata: ActiveValue::Set(serde_json::json!({
                "edited_from": message_id.to_string()
            })),
            created_at: ActiveValue::Set(chrono::Utc::now().into()),
            parent_id: ActiveValue::Set(original_message.parent_id), // Same parent = sibling branch
        };

        let saved_user_message = new_user_message.insert(db).await
            .map_err(|e| format!("Failed to save new user message: {}", e))?;

        // Build history up to (but not including) the original message's parent
        let mut history: Vec<(String, String)> = Vec::new();
        
        if let Some(parent_id) = original_message.parent_id {
            let mut current_id = Some(parent_id);
            let mut history_messages = Vec::new();
            
            while let Some(id) = current_id {
                if let Some(msg) = messages::Entity::find_by_id(id)
                    .one(db)
                    .await
                    .map_err(|e| format!("Failed to fetch history message: {}", e))?
                {
                    current_id = msg.parent_id;
                    history_messages.push((msg.role, msg.content));
                } else {
                    break;
                }
            }
            
            history_messages.reverse();
            history = history_messages;
        }

        println!("[CONVERSATION] Edit message streaming: built {} history items for branch", history.len());

        // Add semantic memory context if available (best-effort).
        let mut final_prompt = new_content.clone();
        if let Ok(memories) = MemoryService::get_relevant_context(
            db,
            &sanitized_content.content,
            conversation.agent_id,
            Some(original_message.conversation_id),
        )
        .await
        {
            let _ = AbilityService::track_ability_usage(
                db,
                conversation.agent_id,
                "memory_retrieval",
                !memories.is_empty(),
            )
            .await;
            if !memories.is_empty() {
                final_prompt = format!(
                    "{}\n\nRelevant prior context:\n{}",
                    new_content,
                    memories.join("\n")
                );
            }
        }

        // Get AI response with streaming
        let ai_response = crate::agent_service::AgentService::send_message_to_agent_streaming(
            db,
            conversation.agent_id.to_string(),
            final_prompt,
            history,
            image_base64,
            on_event,
            ai_client,
        ).await?;

        // Create assistant response as child of new user message
        let new_assistant_message = messages::ActiveModel {
            id: ActiveValue::Set(Uuid::new_v4()),
            conversation_id: ActiveValue::Set(original_message.conversation_id),
            role: ActiveValue::Set("assistant".to_string()),
            content: ActiveValue::Set(ai_response),
            message_type: ActiveValue::Set("text".to_string()),
            metadata: ActiveValue::Set(serde_json::json!({})),
            created_at: ActiveValue::Set(chrono::Utc::now().into()),
            parent_id: ActiveValue::Set(Some(new_user_message_id)),
        };

        let saved_assistant_message = new_assistant_message.insert(db).await
            .map_err(|e| format!("Failed to save assistant message: {}", e))?;

        // Embed branch user + assistant messages (best-effort).
        let _ = MemoryService::embed_message_content(db, new_user_message_id, &sanitized_content.content).await;
        let _ = MemoryService::embed_message_content(db, saved_assistant_message.id, &saved_assistant_message.content).await;

        // Update conversation timestamp
        let mut conversation_model: conversations::ActiveModel = conversation.into();
        conversation_model.updated_at = Set(chrono::Utc::now().into());
        conversation_model.update(db).await
            .map_err(|e| format!("Failed to update conversation timestamp: {}", e))?;

        println!("[CONVERSATION] Created edit branch (streaming) from message {}", message_id);
        Ok((saved_user_message.into(), saved_assistant_message.into()))
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
        let conversation_agent_id = conversation.agent_id;

        // Find the last message to chain parent_ids
        let mut last_message_id = messages::Entity::find()
            .filter(messages::Column::ConversationId.eq(conversation_id))
            .order_by_desc(messages::Column::CreatedAt)
            .one(db)
            .await
            .map_err(|e| format!("Failed to find last message: {}", e))?
            .map(|m| m.id);

        let mut saved_messages: Vec<MessageData> = Vec::new();
        let mut user_entry_count = 0_i32;
        let mut assistant_entry_count = 0_i32;

        for entry in entries {
            if entry.role == "user" {
                user_entry_count += 1;
            } else if entry.role == "assistant" {
                assistant_entry_count += 1;
            }

            // Sanitize the transcript text
            let sanitized_text = sanitize_message(&entry.text)
                .map_err(|e| format!("Input validation failed for transcript: {}", e))?;
            let sanitized_text_content = sanitized_text.content.clone();

            let new_message_id = Uuid::new_v4();
            let message = messages::ActiveModel {
                id: ActiveValue::Set(new_message_id),
                conversation_id: ActiveValue::Set(conversation_id),
                role: ActiveValue::Set(entry.role),
                content: ActiveValue::Set(sanitized_text_content.clone()),
                message_type: ActiveValue::Set("audio".to_string()), // Mark as audio message
                metadata: ActiveValue::Set(serde_json::json!({
                    "source": "voice_chat",
                    "timestamp": entry.timestamp
                })),
                created_at: ActiveValue::Set(chrono::Utc::now().into()),
                parent_id: ActiveValue::Set(last_message_id),
            };

            let saved = message.insert(db).await
                .map_err(|e| format!("Failed to save transcript entry: {}", e))?;
            
            saved_messages.push(saved.into());
            let _ = MemoryService::embed_message_content(db, new_message_id, &sanitized_text_content).await;
            // Chain: next message's parent is this message
            last_message_id = Some(new_message_id);
        }

        // Update conversation timestamp
        let mut conversation_model: conversations::ActiveModel = conversation.into();
        conversation_model.updated_at = Set(chrono::Utc::now().into());
        conversation_model.update(db).await
            .map_err(|e| format!("Failed to update conversation timestamp: {}", e))?;

        // Track core voice abilities based on transcript roles (best-effort).
        for _ in 0..user_entry_count {
            let _ = AbilityService::track_ability_usage(
                db,
                conversation_agent_id,
                "audio_transcription",
                true,
            )
            .await;
        }
        for _ in 0..assistant_entry_count {
            let _ = AbilityService::track_ability_usage(
                db,
                conversation_agent_id,
                "voice_synthesis",
                true,
            )
            .await;
        }

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