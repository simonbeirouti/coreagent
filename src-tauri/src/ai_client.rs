use rig::completion::{Chat, Message};
use rig::agent::AgentBuilder;
use rig::client::CompletionClient;
use rig::providers::openai;
use rig::providers::anthropic;
use std::sync::Arc;
use crate::user_profile_service::UserProfileData;

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
            
            // Add preferences
            if let Some(prefs) = profile.preferences.as_object() {
                if let Some(comm_style) = prefs.get("communication_style").and_then(|v| v.as_str()) {
                    prompt.push_str(&format!("\n- Communication style: {}", comm_style));
                }
                if let Some(language) = prefs.get("language").and_then(|v| v.as_str()) {
                    prompt.push_str(&format!("\n- Preferred language: {}", language));
                }
                if let Some(timezone) = prefs.get("timezone").and_then(|v| v.as_str()) {
                    prompt.push_str(&format!("\n- Timezone: {}", timezone));
                }
            }
            
            // Add habits
            if let Some(habits) = profile.habits.as_object() {
                if let Some(feedback_style) = habits.get("feedback_style").and_then(|v| v.as_str()) {
                    prompt.push_str(&format!("\n- Feedback style: {}", feedback_style));
                }
                if let Some(session_length) = habits.get("session_length").and_then(|v| v.as_str()) {
                    prompt.push_str(&format!("\n- Typical session length: {}", session_length));
                }
            }
            
            // Add work patterns
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
}

// Thread-safe wrapper for use in Tauri state
pub type AiClient = Arc<AiClientManager>;

/// Create a thread-safe AI client instance
pub fn create_ai_client() -> Result<AiClient, String> {
    let manager = AiClientManager::new()?;
    Ok(Arc::new(manager))
}
