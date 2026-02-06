use rig::completion::{Prompt, Chat};
use rig::providers::openai;
use rig::providers::anthropic;
use std::sync::Arc;

/// AI Client manager for handling OpenAI and Anthropic connections
pub struct AiClientManager {
    openai_client: Option<openai::Client>,
    anthropic_client: Option<anthropic::Client>,
}

impl AiClientManager {
    /// Initialize AI clients from environment variables
    pub fn new() -> Result<Self, String> {
        // Load environment variables
        dotenv::dotenv().ok();

        let openai_client = match std::env::var("OPENAI_API_KEY") {
            Ok(key) if !key.is_empty() => {
                println!("[AI_CLIENT] Initializing OpenAI client");
                Some(openai::Client::new(&key))
            }
            _ => {
                println!("[AI_CLIENT] OPENAI_API_KEY not found, OpenAI models will be unavailable");
                None
            }
        };

        let anthropic_client = match std::env::var("ANTHROPIC_API_KEY") {
            Ok(key) if !key.is_empty() => {
                println!("[AI_CLIENT] Initializing Anthropic client");
                Some(anthropic::ClientBuilder::new(&key).build())
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
        system_prompt: &str,
        messages: Vec<(String, String)>, // (role, content) pairs
        user_message: &str,
    ) -> Result<String, String> {
        match provider_type {
            "openai" => self.get_openai_completion(model_id, system_prompt, messages, user_message).await,
            "anthropic" => self.get_anthropic_completion(model_id, system_prompt, messages, user_message).await,
            _ => Err(format!("Unsupported provider type: {}", provider_type)),
        }
    }

    /// Get completion from OpenAI with proper persona
    async fn get_openai_completion(
        &self,
        model_id: &str,
        system_prompt: &str,
        history: Vec<(String, String)>,
        user_message: &str,
    ) -> Result<String, String> {
        let client = self.openai_client.as_ref()
            .ok_or_else(|| "OpenAI client not initialized. Check OPENAI_API_KEY".to_string())?;

        // Create the agent with system prompt (persona) - this is the key!
        // The preamble IS the system prompt and will be sent as a system message
        let agent = client
            .agent(model_id)
            .preamble(system_prompt)  // THIS sets the agent's persona as system message
            .build();

        println!("[AI_CLIENT] OpenAI agent with persona: {}", &system_prompt[..system_prompt.len().min(50)]);
        println!("[AI_CLIENT] Processing {} history messages + current message", history.len());
        println!("[AI_CLIENT] Current user message: {}", &user_message[..user_message.len().min(100)]);

        // For now, use a simplified approach with concatenated history
        // The key fix is using .chat() instead of .prompt()
        let mut context = String::new();

        // Add conversation history
        if !history.is_empty() {
            for (role, content) in history {
                context.push_str(&format!("{}: {}\n", role, content));
            }
            context.push_str("\n");
        }

        // Add current user message
        context.push_str(user_message);

        println!("[AI_CLIENT] Built context with {} chars", context.len());
        println!("[AI_CLIENT] Sending to OpenAI API with persona and conversation context");

        // Use .chat() method for conversational agents
        // Pass empty message history for now and include context in the prompt
        let response = agent
            .chat(&context, vec![])
            .await
            .map_err(|e| format!("OpenAI API error: {}", e))?;

        println!("[AI_CLIENT] OpenAI completion successful");
        Ok(response)
    }

    /// Get completion from Anthropic with proper persona
    async fn get_anthropic_completion(
        &self,
        model_id: &str,
        system_prompt: &str,
        history: Vec<(String, String)>,
        user_message: &str,
    ) -> Result<String, String> {
        let client = self.anthropic_client.as_ref()
            .ok_or_else(|| "Anthropic client not initialized. Check ANTHROPIC_API_KEY".to_string())?;

        // Create the agent with system prompt (persona) - this is the key!
        // The preamble IS the system prompt and will be sent as a system message
        let agent = client
            .agent(model_id)
            .preamble(system_prompt)  // THIS sets the agent's persona as system message
            .build();

        println!("[AI_CLIENT] Anthropic agent with persona: {}", &system_prompt[..system_prompt.len().min(50)]);
        println!("[AI_CLIENT] Processing {} history messages + current message", history.len());
        println!("[AI_CLIENT] Current user message: {}", &user_message[..user_message.len().min(100)]);

        // For now, use a simplified approach with concatenated history
        // The key fix is using .chat() instead of .prompt()
        let mut context = String::new();

        // Add conversation history
        if !history.is_empty() {
            for (role, content) in history {
                context.push_str(&format!("{}: {}\n", role, content));
            }
            context.push_str("\n");
        }

        // Add current user message
        context.push_str(user_message);

        println!("[AI_CLIENT] Built context with {} chars", context.len());
        println!("[AI_CLIENT] Sending to Anthropic API with persona and conversation context");

        // Use .chat() method for conversational agents
        // Pass empty message history for now and include context in the prompt
        let response = agent
            .chat(&context, vec![])
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
