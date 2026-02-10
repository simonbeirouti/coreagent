use rig::completion::{Chat, Message};
use rig::agent::AgentBuilder;
use rig::client::CompletionClient;
use rig::providers::openai;
use rig::providers::anthropic;
use std::sync::Arc;
use crate::user_profile_service::UserProfileData;
pub use tauri::ipc::Channel;
use futures::StreamExt;

// OpenAI Vision API imports
use async_openai::{
    types::chat::{CreateChatCompletionRequestArgs, ChatCompletionRequestMessage, ChatCompletionRequestUserMessage, ChatCompletionRequestUserMessageContent, ChatCompletionRequestUserMessageContentPart, ChatCompletionRequestMessageContentPartText, ChatCompletionRequestMessageContentPartImage, ImageUrl, ImageDetail},
    Client as OpenAIClient,
    config::OpenAIConfig,
};

// Anthropic streaming imports
use async_anthropic::{
    types::{CreateMessagesRequestBuilder, MessageBuilder, MessageRole, MessagesStreamEvent, ContentBlockDelta},
    Client as AnthropicStreamingClient,
};

/// Streaming events for AI responses
#[derive(Clone, serde::Serialize)]
#[serde(tag = "type", content = "data")]
pub enum StreamEvent {
    Started,
    Delta { content: String },
    Done { full_content: String },
    Error { message: String },
}

/// AI Client manager for handling OpenAI and Anthropic connections
pub struct AiClientManager {
    openai_client: Option<openai::Client>,
    anthropic_client: Option<anthropic::Client>,
}

impl AiClientManager {
    /// Build a structured identity prompt for an agent
    fn build_identity_prompt(
        agent_name: &str,
        persona: &str,
        mission: Option<&str>,
        values: Option<&[String]>,
        constraints: Option<&serde_json::Value>,
        user_profile: Option<&UserProfileData>,
    ) -> String {
        let mut prompt = format!(
            r#"You are {agent_name}.

## Identity
{persona}"#
        );

        // Add mission if provided
        if let Some(mission_text) = mission {
            prompt.push_str(&format!(
                r#"

## Mission
{}"#,
                mission_text
            ));
        }

        // Add core values if provided
        if let Some(values_list) = values {
            if !values_list.is_empty() {
                prompt.push_str("\n\n## Core Values");
                for value in values_list {
                    prompt.push_str(&format!("\n- {}", value));
                }
            }
        }

        // Add behavioral constraints if provided
        if let Some(constraints_obj) = constraints {
            if let Some(constraints_map) = constraints_obj.as_object() {
                if !constraints_map.is_empty() {
                    prompt.push_str("\n\n## Behavioral Constraints");
                    for (key, value) in constraints_map {
                        if let Some(constraint_text) = value.as_str() {
                            prompt.push_str(&format!("\n- {}: {}", key, constraint_text));
                        } else {
                            prompt.push_str(&format!("\n- {}: {}", key, value));
                        }
                    }
                }
            }
        }

        // Add user profile information if available
        if let Some(profile) = user_profile {
            prompt.push_str("\n\n## About the User");
            
            // Add AI response language directive (from dedicated column)
            prompt.push_str(&format!("\n- IMPORTANT: Respond in {} language", Self::get_language_name(&profile.ai_response_language)));
            
            // Add preferences from JSONB
            if let Some(prefs) = profile.preferences.as_object() {
                if let Some(comm_style) = prefs.get("communication_style").and_then(|v| v.as_str()) {
                    prompt.push_str(&format!("\n- Communication style: {}", comm_style));
                }
                if let Some(timezone) = prefs.get("timezone").and_then(|v| v.as_str()) {
                    prompt.push_str(&format!("\n- Timezone: {}", timezone));
                }
            }
            
            // Add habits from JSONB
            if let Some(habits) = profile.habits.as_object() {
                if let Some(feedback_style) = habits.get("feedback_style").and_then(|v| v.as_str()) {
                    prompt.push_str(&format!("\n- Feedback style: {}", feedback_style));
                }
                if let Some(session_length) = habits.get("session_length").and_then(|v| v.as_str()) {
                    prompt.push_str(&format!("\n- Typical session length: {}", session_length));
                }
                if let Some(preferred_hours) = habits.get("preferred_hours").and_then(|v| v.as_str()) {
                    prompt.push_str(&format!("\n- Preferred working hours: {}", preferred_hours));
                }
            }
            
            // Add work patterns from JSONB
            if let Some(work) = profile.work_patterns.as_object() {
                if let Some(domain) = work.get("domain").and_then(|v| v.as_str()) {
                    prompt.push_str(&format!("\n- Domain expertise: {}", domain));
                }
                if let Some(tasks) = work.get("common_tasks").and_then(|v| v.as_array()) {
                    let tasks_str: Vec<String> = tasks
                        .iter()
                        .filter_map(|t| t.as_str().map(|s| s.to_string()))
                        .collect();
                    if !tasks_str.is_empty() {
                        prompt.push_str(&format!("\n- Common tasks: {}", tasks_str.join(", ")));
                    }
                }
                if let Some(expertise) = work.get("expertise").and_then(|v| v.as_array()) {
                    let expertise_str: Vec<String> = expertise
                        .iter()
                        .filter_map(|e| e.as_str().map(|s| s.to_string()))
                        .collect();
                    if !expertise_str.is_empty() {
                        prompt.push_str(&format!("\n- Technical expertise: {}", expertise_str.join(", ")));
                    }
                }
            }
        }

        // Add behavioral guidelines
        prompt.push_str(&format!(
            r#"

## Behavioral Guidelines
- Always respond in character as {agent_name}
- Maintain consistency with your defined persona throughout the conversation
- Remember and reference earlier parts of the conversation when relevant
- If asked about your identity, refer to yourself as {agent_name}"#
        ));

        // Add user-specific guidelines if profile exists
        if user_profile.is_some() {
            prompt.push_str("\n- Adapt your responses to the user's communication style and preferences");
            prompt.push_str("\n- Consider the user's domain expertise and common tasks when providing assistance");
        }

        prompt
    }

    /// Convert ISO 639-1 language code to readable language name
    fn get_language_name(code: &str) -> &'static str {
        match code {
            "en" => "English",
            "es" => "Spanish",
            "fr" => "French",
            "de" => "German",
            "it" => "Italian",
            "pt" => "Portuguese",
            "ru" => "Russian",
            "zh" => "Chinese",
            "ja" => "Japanese",
            "ko" => "Korean",
            "ar" => "Arabic",
            "hi" => "Hindi",
            "nl" => "Dutch",
            "pl" => "Polish",
            "tr" => "Turkish",
            "vi" => "Vietnamese",
            "th" => "Thai",
            "id" => "Indonesian",
            "ms" => "Malay",
            "sv" => "Swedish",
            "da" => "Danish",
            "no" => "Norwegian",
            "fi" => "Finnish",
            "cs" => "Czech",
            "el" => "Greek",
            "he" => "Hebrew",
            "uk" => "Ukrainian",
            _ => "English", // Default to English for unknown codes
        }
    }

    /// Initialize AI clients from environment variables
    pub fn new() -> Result<Self, String> {
        // Load environment variables
        dotenv::dotenv().ok();

        let openai_client = match std::env::var("OPENAI_API_KEY") {
            Ok(key) if !key.is_empty() => {
                println!("[AI_CLIENT] Initializing OpenAI client");
                match openai::Client::new(&key) {
                    Ok(client) => Some(client),
                    Err(e) => {
                        println!("[AI_CLIENT] Failed to create OpenAI client: {}", e);
                        None
                    }
                }
            }
            _ => {
                println!("[AI_CLIENT] OPENAI_API_KEY not found, OpenAI models will be unavailable");
                None
            }
        };

        let anthropic_client = match std::env::var("ANTHROPIC_API_KEY") {
            Ok(key) if !key.is_empty() => {
                println!("[AI_CLIENT] Initializing Anthropic client");
                match anthropic::Client::new(&key) {
                    Ok(client) => Some(client),
                    Err(e) => {
                        println!("[AI_CLIENT] Failed to create Anthropic client: {}", e);
                        None
                    }
                }
            }
            _ => {
                println!("[AI_CLIENT] ANTHROPIC_API_KEY not found, Anthropic models will be unavailable");
                None
            }
        };

        if openai_client.is_none() && anthropic_client.is_none() {
            return Err("No AI provider API keys found. Please set OPENAI_API_KEY or ANTHROPIC_API_KEY in .env".to_string());
        }

        Ok(AiClientManager {
            openai_client,
            anthropic_client,
        })
    }

    /// Get a completion response from the appropriate AI model
    pub async fn get_completion(
        &self,
        provider_type: &str,
        model_id: &str,
        agent_name: &str,
        persona: &str,
        mission: Option<&str>,
        values: Option<&[String]>,
        constraints: Option<&serde_json::Value>,
        user_profile: Option<&UserProfileData>,
        messages: Vec<(String, String)>, // (role, content) pairs
        user_message: &str,
    ) -> Result<String, String> {
        // Build structured identity prompt from agent data
        let identity_prompt = Self::build_identity_prompt(
            agent_name,
            persona,
            mission,
            values,
            constraints,
            user_profile,
        );

        match provider_type {
            "openai" => self.get_openai_completion(model_id, &identity_prompt, messages, user_message).await,
            "anthropic" => self.get_anthropic_completion(model_id, &identity_prompt, messages, user_message).await,
            _ => Err(format!("Unsupported provider type: {}", provider_type)),
        }
    }

    /// Get a completion response with optional image support from the appropriate AI model
    pub async fn get_completion_with_image(
        &self,
        provider_type: &str,
        model_id: &str,
        agent_name: &str,
        persona: &str,
        mission: Option<&str>,
        values: Option<&[String]>,
        constraints: Option<&serde_json::Value>,
        user_profile: Option<&UserProfileData>,
        messages: Vec<(String, String)>, // (role, content) pairs
        user_message: &str,
        image_base64: Option<&str>,
    ) -> Result<String, String> {
        // If no image provided, use regular completion
        if image_base64.is_none() {
            return self.get_completion(
                provider_type,
                model_id,
                agent_name,
                persona,
                mission,
                values,
                constraints,
                user_profile,
                messages,
                user_message,
            ).await;
        }

        // For images, currently only OpenAI Vision API is supported
        match provider_type {
            "openai" => self.get_openai_vision_completion(
                model_id,
                agent_name,
                persona,
                mission,
                values,
                constraints,
                user_profile,
                messages,
                user_message,
                image_base64.unwrap(),
            ).await,
            _ => Err(format!("Vision API not supported for provider type: {}. Only OpenAI vision is currently supported.", provider_type)),
        }
    }

    /// Get completion from OpenAI with proper persona
    async fn get_openai_completion(
        &self,
        model_id: &str,
        identity_prompt: &str,
        history: Vec<(String, String)>,
        user_message: &str,
    ) -> Result<String, String> {
        let client = self.openai_client.as_ref()
            .ok_or_else(|| "OpenAI client not initialized. Check OPENAI_API_KEY".to_string())?;

        // Create the agent with identity prompt - this is the key!
        // The preamble IS the system prompt and will be sent as a system message
        let completion_model = client.completion_model(model_id);
        let agent = AgentBuilder::new(completion_model)
            .preamble(identity_prompt)  // THIS sets the agent's identity as system message
            .build();

        println!("[AI_CLIENT] OpenAI agent with identity prompt: {}", &identity_prompt[..identity_prompt.len().min(50)]);
        println!("[AI_CLIENT] Processing {} history messages + current message", history.len());
        println!("[AI_CLIENT] Current user message: {}", &user_message[..user_message.len().min(100)]);

        // Convert conversation history to structured Message objects
        let message_history: Vec<Message> = history
            .into_iter()
            .map(|(role, content)| match role.as_str() {
                "user" => Message::user(content),
                "assistant" => Message::assistant(content),
                _ => Message::user(content), // Fallback for unknown roles
            })
            .collect();

        println!("[AI_CLIENT] Converted {} history messages to structured format", message_history.len());
        println!("[AI_CLIENT] Sending to OpenAI API with identity prompt and conversation context");

        // Use .chat() method for conversational agents with structured message history
        let response = agent
            .chat(user_message, message_history)
            .await
            .map_err(|e| format!("OpenAI API error: {}", e))?;

        println!("[AI_CLIENT] OpenAI completion successful");
        Ok(response)
    }

    /// Get completion from Anthropic with proper persona
    async fn get_anthropic_completion(
        &self,
        model_id: &str,
        identity_prompt: &str,
        history: Vec<(String, String)>,
        user_message: &str,
    ) -> Result<String, String> {
        let client = self.anthropic_client.as_ref()
            .ok_or_else(|| "Anthropic client not initialized. Check ANTHROPIC_API_KEY".to_string())?;

        // Create the agent with identity prompt - this is the key!
        // The preamble IS the system prompt and will be sent as a system message
        let completion_model = client.completion_model(model_id);
        let agent = AgentBuilder::new(completion_model)
            .preamble(identity_prompt)  // THIS sets the agent's identity as system message
            .build();

        println!("[AI_CLIENT] Anthropic agent with identity prompt: {}", &identity_prompt[..identity_prompt.len().min(50)]);
        println!("[AI_CLIENT] Processing {} history messages + current message", history.len());
        println!("[AI_CLIENT] Current user message: {}", &user_message[..user_message.len().min(100)]);

        // Convert conversation history to structured Message objects
        let message_history: Vec<Message> = history
            .into_iter()
            .map(|(role, content)| match role.as_str() {
                "user" => Message::user(content),
                "assistant" => Message::assistant(content),
                _ => Message::user(content), // Fallback for unknown roles
            })
            .collect();

        println!("[AI_CLIENT] Converted {} history messages to structured format", message_history.len());
        println!("[AI_CLIENT] Sending to Anthropic API with identity prompt and conversation context");

        // Use .chat() method for conversational agents with structured message history
        let response = agent
            .chat(user_message, message_history)
            .await
            .map_err(|e| format!("Anthropic API error: {}", e))?;

        println!("[AI_CLIENT] Anthropic completion successful");
        Ok(response)
    }

    /// Get completion from OpenAI Vision API with image support
    async fn get_openai_vision_completion(
        &self,
        model_id: &str,
        agent_name: &str,
        persona: &str,
        mission: Option<&str>,
        values: Option<&[String]>,
        constraints: Option<&serde_json::Value>,
        user_profile: Option<&UserProfileData>,
        history: Vec<(String, String)>,
        user_message: &str,
        image_base64: &str,
    ) -> Result<String, String> {
        // Build identity prompt for system message
        let identity_prompt = Self::build_identity_prompt(
            agent_name,
            persona,
            mission,
            values,
            constraints,
            user_profile,
        );

        // Create OpenAI Vision client directly (not using rig library for vision)
        let openai_client = OpenAIClient::new();

        println!("[AI_CLIENT] OpenAI Vision agent with identity prompt: {}", &identity_prompt[..identity_prompt.len().min(50)]);
        println!("[AI_CLIENT] Processing {} history messages + current message with image", history.len());
        println!("[AI_CLIENT] Current user message: {}", &user_message[..user_message.len().min(100)]);

        // Convert conversation history to OpenAI message format
        let mut chat_messages: Vec<ChatCompletionRequestMessage> = Vec::new();

        // Add system message with identity prompt
        chat_messages.push(ChatCompletionRequestMessage::System(
            async_openai::types::chat::ChatCompletionRequestSystemMessage {
                content: async_openai::types::chat::ChatCompletionRequestSystemMessageContent::Text(identity_prompt),
                name: None,
            }
        ));

        // Add conversation history
        for (role, content) in history {
            let message = match role.as_str() {
                "user" => ChatCompletionRequestMessage::User(
                    ChatCompletionRequestUserMessage {
                        content: ChatCompletionRequestUserMessageContent::Text(content),
                        name: None,
                    }
                ),
                "assistant" => ChatCompletionRequestMessage::Assistant(
                    async_openai::types::chat::ChatCompletionRequestAssistantMessage {
                        content: Some(async_openai::types::chat::ChatCompletionRequestAssistantMessageContent::Text(content)),
                        name: None,
                        tool_calls: None,
                        function_call: None,
                        refusal: None,
                        audio: None,
                    }
                ),
                _ => continue, // Skip unknown roles
            };
            chat_messages.push(message);
        }

        // Create multimodal user message with text and image
        let image_url = format!("data:image/png;base64,{}", image_base64);
        let user_content_parts = vec![
            ChatCompletionRequestUserMessageContentPart::Text(
                ChatCompletionRequestMessageContentPartText {
                    text: user_message.to_string(),
                }
            ),
            ChatCompletionRequestUserMessageContentPart::ImageUrl(
                ChatCompletionRequestMessageContentPartImage {
                    image_url: ImageUrl {
                        url: image_url,
                        detail: Some(ImageDetail::Low), // Use low detail for faster processing
                    }
                }
            ),
        ];

        let user_message_with_image = ChatCompletionRequestUserMessage {
            content: ChatCompletionRequestUserMessageContent::Array(user_content_parts),
            name: None,
        };

        chat_messages.push(ChatCompletionRequestMessage::User(user_message_with_image));

        // Build the request
        let request = CreateChatCompletionRequestArgs::default()
            .model(model_id)
            .messages(chat_messages)
            .max_tokens(1000u32)
            .temperature(0.7f32)
            .build()
            .map_err(|e| format!("Failed to build vision request: {}", e))?;

        // Call OpenAI Vision API
        let response = openai_client.chat().create(request).await
            .map_err(|e| format!("OpenAI Vision API error: {}", e))?;

        if let Some(choice) = response.choices.first() {
            if let Some(ref content) = choice.message.content {
                println!("[AI_CLIENT] OpenAI Vision completion successful");
                return Ok(content.clone());
            }
        }

        Err("No response content from OpenAI Vision API".to_string())
    }

    /// Get a completion response with optional image support from the appropriate AI model (streaming)
    pub async fn get_completion_with_image_streaming(
        &self,
        provider_type: &str,
        model_id: &str,
        agent_name: &str,
        persona: &str,
        mission: Option<&str>,
        values: Option<&[String]>,
        constraints: Option<&serde_json::Value>,
        user_profile: Option<&UserProfileData>,
        messages: Vec<(String, String)>, // (role, content) pairs
        user_message: &str,
        image_base64: Option<&str>,
        on_event: Channel<StreamEvent>,
    ) -> Result<String, String> {
        // If no image provided, use regular completion
        if image_base64.is_none() {
            return self.get_completion_streaming(
                provider_type,
                model_id,
                agent_name,
                persona,
                mission,
                values,
                constraints,
                user_profile,
                messages,
                user_message,
                on_event,
            ).await;
        }

        // For images, currently only OpenAI Vision API is supported with streaming
        match provider_type {
            "openai" => self.get_openai_vision_completion_streaming(
                model_id,
                agent_name,
                persona,
                mission,
                values,
                constraints,
                user_profile,
                messages,
                user_message,
                image_base64.unwrap(),
                on_event,
            ).await,
            _ => Err(format!("Vision API streaming not supported for provider type: {}. Only OpenAI vision is currently supported.", provider_type)),
        }
    }

    /// Get completion from OpenAI with proper persona (streaming)
    async fn get_completion_streaming(
        &self,
        provider_type: &str,
        model_id: &str,
        agent_name: &str,
        persona: &str,
        mission: Option<&str>,
        values: Option<&[String]>,
        constraints: Option<&serde_json::Value>,
        user_profile: Option<&UserProfileData>,
        messages: Vec<(String, String)>,
        user_message: &str,
        on_event: Channel<StreamEvent>,
    ) -> Result<String, String> {
        match provider_type {
            "openai" => self.get_openai_completion_streaming(model_id, agent_name, persona, mission, values, constraints, user_profile, messages, user_message, on_event).await,
            "anthropic" => self.get_anthropic_completion_streaming(
                model_id, agent_name, persona, mission, values, constraints,
                user_profile, messages, user_message, on_event
            ).await,
            _ => Err(format!("Unsupported provider type for streaming: {}", provider_type)),
        }
    }

    /// Get completion from OpenAI Vision API with image support (streaming)
    async fn get_openai_vision_completion_streaming(
        &self,
        model_id: &str,
        agent_name: &str,
        persona: &str,
        mission: Option<&str>,
        values: Option<&[String]>,
        constraints: Option<&serde_json::Value>,
        user_profile: Option<&UserProfileData>,
        history: Vec<(String, String)>,
        user_message: &str,
        image_base64: &str,
        on_event: Channel<StreamEvent>,
    ) -> Result<String, String> {
        // Build identity prompt for system message
        let identity_prompt = Self::build_identity_prompt(
            agent_name,
            persona,
            mission,
            values,
            constraints,
            user_profile,
        );

        // Create OpenAI Vision client directly
        let openai_client = OpenAIClient::new();

        println!("[AI_CLIENT] OpenAI Vision streaming agent with identity prompt: {}", &identity_prompt[..identity_prompt.len().min(50)]);
        println!("[AI_CLIENT] Processing {} history messages + current message with image", history.len());
        println!("[AI_CLIENT] Current user message: {}", &user_message[..user_message.len().min(100)]);

        // Convert conversation history to OpenAI message format
        let mut chat_messages: Vec<ChatCompletionRequestMessage> = Vec::new();

        // Add system message with identity prompt
        chat_messages.push(ChatCompletionRequestMessage::System(
            async_openai::types::chat::ChatCompletionRequestSystemMessage {
                content: async_openai::types::chat::ChatCompletionRequestSystemMessageContent::Text(identity_prompt),
                name: None,
            }
        ));

        // Add conversation history
        for (role, content) in history {
            let message = match role.as_str() {
                "user" => ChatCompletionRequestMessage::User(
                    ChatCompletionRequestUserMessage {
                        content: ChatCompletionRequestUserMessageContent::Text(content),
                        name: None,
                    }
                ),
                "assistant" => ChatCompletionRequestMessage::Assistant(
                    async_openai::types::chat::ChatCompletionRequestAssistantMessage {
                        content: Some(async_openai::types::chat::ChatCompletionRequestAssistantMessageContent::Text(content)),
                        name: None,
                        tool_calls: None,
                        function_call: None,
                        refusal: None,
                        audio: None,
                    }
                ),
                _ => continue, // Skip unknown roles
            };
            chat_messages.push(message);
        }

        // Create multimodal user message with text and image
        let image_url = format!("data:image/png;base64,{}", image_base64);
        let user_content_parts = vec![
            ChatCompletionRequestUserMessageContentPart::Text(
                ChatCompletionRequestMessageContentPartText {
                    text: user_message.to_string(),
                }
            ),
            ChatCompletionRequestUserMessageContentPart::ImageUrl(
                ChatCompletionRequestMessageContentPartImage {
                    image_url: ImageUrl {
                        url: image_url,
                        detail: Some(ImageDetail::Low), // Use low detail for faster processing
                    }
                }
            ),
        ];

        let user_message_with_image = ChatCompletionRequestUserMessage {
            content: ChatCompletionRequestUserMessageContent::Array(user_content_parts),
            name: None,
        };

        chat_messages.push(ChatCompletionRequestMessage::User(user_message_with_image));

        // Build the request
        let request = CreateChatCompletionRequestArgs::default()
            .model(model_id)
            .messages(chat_messages)
            .max_tokens(1000u32)
            .temperature(0.7f32)
            .stream(true) // Enable streaming
            .build()
            .map_err(|e| format!("Failed to build vision streaming request: {}", e))?;

        // Create streaming response
        let mut stream = openai_client.chat().create_stream(request).await
            .map_err(|e| format!("OpenAI Vision streaming API error: {}", e))?;

        let mut full_content = String::new();
        on_event.send(StreamEvent::Started)
            .map_err(|e| format!("Failed to send Started event: {}", e))?;

        while let Some(result) = stream.next().await {
            match result {
                Ok(response) => {
                    if let Some(choice) = response.choices.first() {
                        if let Some(delta) = &choice.delta.content {
                            full_content.push_str(delta);
                            on_event.send(StreamEvent::Delta {
                                content: delta.clone()
                            }).map_err(|e| format!("Failed to send Delta event: {}", e))?;
                        }
                    }
                }
                Err(e) => {
                    on_event.send(StreamEvent::Error {
                        message: format!("Streaming error: {}", e)
                    }).map_err(|e| format!("Failed to send Error event: {}", e))?;
                    return Err(format!("OpenAI Vision streaming error: {}", e));
                }
            }
        }

        on_event.send(StreamEvent::Done {
            full_content: full_content.clone()
        }).map_err(|e| format!("Failed to send Done event: {}", e))?;

        println!("[AI_CLIENT] OpenAI Vision streaming completion successful");
        Ok(full_content)
    }

    /// Get completion from OpenAI with proper persona (streaming)
    async fn get_openai_completion_streaming(
        &self,
        model_id: &str,
        agent_name: &str,
        persona: &str,
        mission: Option<&str>,
        values: Option<&[String]>,
        constraints: Option<&serde_json::Value>,
        user_profile: Option<&UserProfileData>,
        history: Vec<(String, String)>,
        user_message: &str,
        on_event: Channel<StreamEvent>,
    ) -> Result<String, String> {
        // Build identity prompt for system message
        let identity_prompt = Self::build_identity_prompt(
            agent_name,
            persona,
            mission,
            values,
            constraints,
            user_profile,
        );

        // Create OpenAI client directly for streaming
        let openai_client = OpenAIClient::new();

        println!("[AI_CLIENT] OpenAI streaming agent with identity prompt: {}", &identity_prompt[..identity_prompt.len().min(50)]);
        println!("[AI_CLIENT] Processing {} history messages + current message", history.len());
        println!("[AI_CLIENT] Current user message: {}", &user_message[..user_message.len().min(100)]);

        // Convert conversation history to OpenAI message format
        let mut chat_messages: Vec<ChatCompletionRequestMessage> = Vec::new();

        // Add system message with identity prompt
        chat_messages.push(ChatCompletionRequestMessage::System(
            async_openai::types::chat::ChatCompletionRequestSystemMessage {
                content: async_openai::types::chat::ChatCompletionRequestSystemMessageContent::Text(identity_prompt),
                name: None,
            }
        ));

        // Add conversation history
        for (role, content) in history {
            let message = match role.as_str() {
                "user" => ChatCompletionRequestMessage::User(
                    ChatCompletionRequestUserMessage {
                        content: ChatCompletionRequestUserMessageContent::Text(content),
                        name: None,
                    }
                ),
                "assistant" => ChatCompletionRequestMessage::Assistant(
                    async_openai::types::chat::ChatCompletionRequestAssistantMessage {
                        content: Some(async_openai::types::chat::ChatCompletionRequestAssistantMessageContent::Text(content)),
                        name: None,
                        tool_calls: None,
                        function_call: None,
                        refusal: None,
                        audio: None,
                    }
                ),
                _ => continue, // Skip unknown roles
            };
            chat_messages.push(message);
        }

        // Add current user message
        chat_messages.push(ChatCompletionRequestMessage::User(
            ChatCompletionRequestUserMessage {
                content: ChatCompletionRequestUserMessageContent::Text(user_message.to_string()),
                name: None,
            }
        ));

        // Build the streaming request
        let request = CreateChatCompletionRequestArgs::default()
            .model(model_id)
            .messages(chat_messages)
            .max_tokens(1000u32)
            .temperature(0.7f32)
            .stream(true) // Enable streaming
            .build()
            .map_err(|e| format!("Failed to build streaming request: {}", e))?;

        // Create streaming response
        let mut stream = openai_client.chat().create_stream(request).await
            .map_err(|e| format!("OpenAI streaming API error: {}", e))?;

        let mut full_content = String::new();
        on_event.send(StreamEvent::Started)
            .map_err(|e| format!("Failed to send Started event: {}", e))?;

        while let Some(result) = stream.next().await {
            match result {
                Ok(response) => {
                    if let Some(choice) = response.choices.first() {
                        if let Some(delta) = &choice.delta.content {
                            full_content.push_str(delta);
                            on_event.send(StreamEvent::Delta {
                                content: delta.clone()
                            }).map_err(|e| format!("Failed to send Delta event: {}", e))?;
                        }
                    }
                }
                Err(e) => {
                    on_event.send(StreamEvent::Error {
                        message: format!("Streaming error: {}", e)
                    }).map_err(|e| format!("Failed to send Error event: {}", e))?;
                    return Err(format!("OpenAI streaming error: {}", e));
                }
            }
        }

        on_event.send(StreamEvent::Done {
            full_content: full_content.clone()
        }).map_err(|e| format!("Failed to send Done event: {}", e))?;

        println!("[AI_CLIENT] OpenAI streaming completion successful");
        Ok(full_content)
    }

    /// Get completion from Anthropic with proper persona (streaming)
    async fn get_anthropic_completion_streaming(
        &self,
        model_id: &str,
        agent_name: &str,
        persona: &str,
        mission: Option<&str>,
        values: Option<&[String]>,
        constraints: Option<&serde_json::Value>,
        user_profile: Option<&UserProfileData>,
        history: Vec<(String, String)>,
        user_message: &str,
        on_event: Channel<StreamEvent>,
    ) -> Result<String, String> {
        // Build identity prompt for system message
        let identity_prompt = Self::build_identity_prompt(
            agent_name,
            persona,
            mission,
            values,
            constraints,
            user_profile,
        );

        // Create Anthropic streaming client (uses ANTHROPIC_API_KEY env var automatically)
        let client = AnthropicStreamingClient::default();

        println!("[AI_CLIENT] Anthropic streaming agent with identity prompt: {}", &identity_prompt[..identity_prompt.len().min(50)]);
        println!("[AI_CLIENT] Processing {} history messages + current message", history.len());
        println!("[AI_CLIENT] Current user message: {}", &user_message[..user_message.len().min(100)]);

        // Build messages list from history
        let mut messages = Vec::new();

        // Add conversation history
        for (role, content) in history {
            let message_role = match role.as_str() {
                "user" => MessageRole::User,
                "assistant" => MessageRole::Assistant,
                _ => continue, // Skip unknown roles
            };
            messages.push(
                MessageBuilder::default()
                    .role(message_role)
                    .content(content)
                    .build()
                    .map_err(|e| format!("Failed to build history message: {}", e))?
            );
        }

        // Add current user message
        messages.push(
            MessageBuilder::default()
                .role(MessageRole::User)
                .content(user_message.to_string())
                .build()
                .map_err(|e| format!("Failed to build user message: {}", e))?
        );

        // Build the streaming request
        let request = CreateMessagesRequestBuilder::default()
            .model(model_id)
            .max_tokens(4096i32)
            .system(identity_prompt)
            .messages(messages)
            .build()
            .map_err(|e| format!("Failed to build Anthropic streaming request: {}", e))?;

        // Create streaming response
        let mut stream = client.messages().create_stream(request).await;

        let mut full_content = String::new();
        on_event.send(StreamEvent::Started)
            .map_err(|e| format!("Failed to send Started event: {}", e))?;

        while let Some(result) = stream.next().await {
            match result {
                Ok(event) => {
                    // Handle the ContentBlockDelta variant which contains text deltas
                    if let MessagesStreamEvent::ContentBlockDelta { delta, .. } = event {
                        if let ContentBlockDelta::TextDelta { text } = delta {
                            full_content.push_str(&text);
                            on_event.send(StreamEvent::Delta {
                                content: text
                            }).map_err(|e| format!("Failed to send Delta event: {}", e))?;
                        }
                    }
                }
                Err(e) => {
                    on_event.send(StreamEvent::Error {
                        message: format!("Anthropic streaming error: {}", e)
                    }).map_err(|e| format!("Failed to send Error event: {}", e))?;
                    return Err(format!("Anthropic streaming error: {}", e));
                }
            }
        }

        on_event.send(StreamEvent::Done {
            full_content: full_content.clone()
        }).map_err(|e| format!("Failed to send Done event: {}", e))?;

        println!("[AI_CLIENT] Anthropic streaming completion successful");
        Ok(full_content)
    }
}

// Thread-safe wrapper for use in Tauri state
pub type AiClient = Arc<AiClientManager>;

/// Create a thread-safe AI client instance
pub fn create_ai_client() -> Result<AiClient, String> {
    let manager = AiClientManager::new()?;
    Ok(Arc::new(manager))
}
