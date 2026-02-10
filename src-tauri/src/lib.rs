#![allow(dead_code)]
#![allow(clippy::too_many_arguments)]
#![allow(clippy::single_component_path_imports)]
#![allow(clippy::collapsible_match)]
#![allow(clippy::manual_range_contains)]
#![allow(clippy::redundant_closure)]

mod auth;
mod db;
mod entities;
mod agent_service;
mod ability_service;
mod conversation_service;
mod ai_client;
mod feedback_service;
mod memory_service;
mod user_profile_service;
mod perception_tracker;
mod audio_service;
mod vision_service;
mod input_sanitizer;

use tauri::{Manager, ipc::Channel};
use auth::{AuthState, SessionData};
use sea_orm::DatabaseConnection;
use agent_service::{AgentService, CreateAgentRequest, UpdateAgentRequest};
use ability_service::AbilityService;
use conversation_service::{ConversationService, CreateConversationRequest, TranscriptEntry};
use ai_client::AiClient;
use feedback_service::{FeedbackService, SubmitFeedbackRequest};
use memory_service::{MemoryService, SimilarMessage};
use perception_tracker::{PerceptionTracker, PerceptionStat};
use audio_service::{AudioService, RecordingResult};
use vision_service::{VisionService, ScreenshotResult};

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
fn set_session(session: SessionData, state: tauri::State<AuthState>) -> Result<(), String> {
    state.set_session(session);
    Ok(())
}

#[tauri::command]
fn clear_session(state: tauri::State<AuthState>) -> Result<(), String> {
    state.clear_session();
    Ok(())
}

#[tauri::command]
fn verify_session(user_id: String, state: tauri::State<AuthState>) -> Result<bool, String> {
    match state.get_session() {
        Some(session) => Ok(session.user_id == user_id),
        None => Ok(false),
    }
}

// Agent commands
#[tauri::command]
async fn create_agent(
    request: CreateAgentRequest,
    db: tauri::State<'_, DatabaseConnection>
) -> Result<agent_service::AgentData, String> {
    AgentService::create_agent(&db, request).await
}

#[tauri::command]
async fn list_agents(
    user_id: String,
    db: tauri::State<'_, DatabaseConnection>
) -> Result<Vec<agent_service::AgentData>, String> {
    AgentService::list_agents(&db, user_id).await
        .map_err(|e| {
            eprintln!("[ERROR] list_agents failed: {}", e);
            e
        })
}

#[tauri::command]
async fn get_agent(
    agent_id: String,
    db: tauri::State<'_, DatabaseConnection>
) -> Result<agent_service::AgentData, String> {
    AgentService::get_agent(&db, agent_id).await
}

#[tauri::command]
async fn update_agent(
    agent_id: String,
    updates: UpdateAgentRequest,
    db: tauri::State<'_, DatabaseConnection>
) -> Result<agent_service::AgentData, String> {
    AgentService::update_agent(&db, agent_id, updates).await
}

#[tauri::command]
async fn delete_agent(
    agent_id: String,
    db: tauri::State<'_, DatabaseConnection>
) -> Result<(), String> {
    AgentService::delete_agent(&db, agent_id).await
}

#[tauri::command]
async fn send_message_to_agent(
    agent_id: String,
    message: String,
    db: tauri::State<'_, DatabaseConnection>,
    ai_client: tauri::State<'_, AiClient>
) -> Result<String, String> {
    // Simple one-shot message without conversation history
    AgentService::send_message_to_agent(&db, agent_id, message, vec![], None, &ai_client).await
}

// Conversation commands
#[tauri::command]
async fn create_conversation(
    request: CreateConversationRequest,
    db: tauri::State<'_, DatabaseConnection>
) -> Result<conversation_service::ConversationData, String> {
    ConversationService::create_conversation(&db, request).await
}

#[tauri::command]
async fn list_conversations(
    agent_id: String,
    db: tauri::State<'_, DatabaseConnection>
) -> Result<Vec<conversation_service::ConversationData>, String> {
    ConversationService::list_conversations(&db, agent_id).await
}

#[tauri::command]
async fn get_conversation(
    conversation_id: String,
    db: tauri::State<'_, DatabaseConnection>
) -> Result<conversation_service::ConversationData, String> {
    ConversationService::get_conversation(&db, conversation_id).await
}

#[tauri::command]
async fn get_conversation_messages(
    conversation_id: String,
    db: tauri::State<'_, DatabaseConnection>
) -> Result<Vec<conversation_service::MessageData>, String> {
    ConversationService::get_conversation_messages(&db, conversation_id).await
}

#[tauri::command]
async fn send_message(
    conversation_id: String,
    content: String,
    image_base64: Option<String>,
    db: tauri::State<'_, DatabaseConnection>,
    ai_client: tauri::State<'_, AiClient>
) -> Result<conversation_service::MessageData, String> {
    let response = ConversationService::send_message(&db, conversation_id, content, image_base64, &ai_client).await?;
    // Track as a core conversation skill usage (best-effort).
    if let Ok(conversation) = ConversationService::get_conversation(&db, response.conversation_id.to_string()).await {
        let _ = AbilityService::track_ability_usage(&db, conversation.agent_id, "conversation", true).await;
    }
    Ok(response)
}

#[tauri::command]
async fn send_message_streaming(
    conversation_id: String,
    content: String,
    image_base64: Option<String>,
    on_event: Channel<ai_client::StreamEvent>,
    db: tauri::State<'_, DatabaseConnection>,
    ai_client: tauri::State<'_, AiClient>
) -> Result<conversation_service::MessageData, String> {
    let response = ConversationService::send_message_streaming(&db, conversation_id, content, image_base64, on_event, &ai_client).await?;
    if let Ok(conversation) = ConversationService::get_conversation(&db, response.conversation_id.to_string()).await {
        let _ = AbilityService::track_ability_usage(&db, conversation.agent_id, "conversation", true).await;
    }
    Ok(response)
}

#[tauri::command]
async fn update_conversation_title(
    conversation_id: String,
    title: Option<String>,
    db: tauri::State<'_, DatabaseConnection>
) -> Result<conversation_service::ConversationData, String> {
    ConversationService::update_conversation_title(&db, conversation_id, title).await
}

#[tauri::command]
async fn generate_conversation_title(
    conversation_id: String,
    first_message: String,
    db: tauri::State<'_, DatabaseConnection>,
    ai_client: tauri::State<'_, AiClient>
) -> Result<conversation_service::ConversationData, String> {
    ConversationService::generate_and_update_conversation_title(&db, conversation_id, first_message, &ai_client).await
}

#[tauri::command]
async fn save_voice_transcript(
    conversation_id: String,
    entries: Vec<TranscriptEntry>,
    db: tauri::State<'_, DatabaseConnection>
) -> Result<Vec<conversation_service::MessageData>, String> {
    ConversationService::save_voice_transcript(&db, conversation_id, entries).await
}

#[tauri::command]
async fn delete_conversation(
    conversation_id: String,
    db: tauri::State<'_, DatabaseConnection>
) -> Result<(), String> {
    ConversationService::delete_conversation(&db, conversation_id).await
}

#[tauri::command]
async fn delete_message(
    message_id: String,
    db: tauri::State<'_, DatabaseConnection>
) -> Result<Vec<String>, String> {
    let deleted_ids = ConversationService::delete_message(&db, message_id).await?;
    // Convert UUIDs to strings for frontend
    Ok(deleted_ids.iter().map(|id| id.to_string()).collect())
}

#[tauri::command]
async fn edit_message(
    message_id: String,
    new_content: String,
    image_base64: Option<String>,
    db: tauri::State<'_, DatabaseConnection>,
    ai_client: tauri::State<'_, AiClient>
) -> Result<(conversation_service::MessageData, conversation_service::MessageData), String> {
    let result = ConversationService::edit_message(&db, message_id, new_content, image_base64, &ai_client).await?;
    if let Ok(conversation) = ConversationService::get_conversation(&db, result.0.conversation_id.to_string()).await {
        let _ = AbilityService::track_ability_usage(&db, conversation.agent_id, "conversation", true).await;
    }
    Ok(result)
}

#[tauri::command]
async fn edit_message_streaming(
    message_id: String,
    new_content: String,
    image_base64: Option<String>,
    on_event: Channel<ai_client::StreamEvent>,
    db: tauri::State<'_, DatabaseConnection>,
    ai_client: tauri::State<'_, AiClient>
) -> Result<(conversation_service::MessageData, conversation_service::MessageData), String> {
    let result = ConversationService::edit_message_streaming(&db, message_id, new_content, image_base64, on_event, &ai_client).await?;
    if let Ok(conversation) = ConversationService::get_conversation(&db, result.0.conversation_id.to_string()).await {
        let _ = AbilityService::track_ability_usage(&db, conversation.agent_id, "conversation", true).await;
    }
    Ok(result)
}

// Vision commands
#[tauri::command]
async fn capture_screenshot(
    agent_id: String,
    db: tauri::State<'_, DatabaseConnection>,
    ai_client: tauri::State<'_, AiClient>,
    _app: tauri::AppHandle
) -> Result<ScreenshotResult, String> {
    let vision_service = VisionService::new(&ai_client);
    let result = vision_service.capture_screenshot().await?;

    // Track usage
    PerceptionTracker::track_usage(
        &db,
        &agent_id,
        "vision",
        "screenshot",
        None
    ).await?;
    let agent_uuid = uuid::Uuid::parse_str(&agent_id).map_err(|e| format!("Invalid agent ID: {}", e))?;
    let _ = AbilityService::track_ability_usage(&db, agent_uuid, "vision_screenshot", true).await;

    // Note: Perception logging is done separately via log_screenshot_perception
    // after the frontend uploads the file to Supabase Storage

    Ok(result)
}

#[tauri::command]
async fn log_screenshot_perception(
    agent_id: String,
    storage_path: String,
    conversation_id: Option<String>,
    db: tauri::State<'_, DatabaseConnection>
) -> Result<(), String> {
    // Log perception data with the actual uploaded storage path
    PerceptionTracker::log_perception(
        &db,
        &agent_id,
        conversation_id.as_deref(),
        "screenshot",
        &storage_path,
        None, // No analysis result yet
        None  // No duration for screenshots
    ).await?;

    Ok(())
}

#[tauri::command]
async fn analyze_image(
    agent_id: String,
    image_base64: String,
    prompt: Option<String>,
    db: tauri::State<'_, DatabaseConnection>,
    ai_client: tauri::State<'_, AiClient>
) -> Result<String, String> {
    let vision_service = VisionService::new(&ai_client);
    let analysis = vision_service.analyze_image_base64(&image_base64, prompt).await?;

    // Track usage
    PerceptionTracker::track_usage(
        &db,
        &agent_id,
        "vision",
        "analyze",
        None
    ).await?;
    let agent_uuid = uuid::Uuid::parse_str(&agent_id).map_err(|e| format!("Invalid agent ID: {}", e))?;
    let _ = AbilityService::track_ability_usage(&db, agent_uuid, "vision_analysis", true).await;

    Ok(analysis)
}

// Audio commands
#[tauri::command]
async fn start_recording(
    agent_id: String,
    db: tauri::State<'_, DatabaseConnection>
) -> Result<(), String> {
    // Track usage when starting recording
    PerceptionTracker::track_usage(
        &db,
        &agent_id,
        "audio",
        "start_recording",
        None
    ).await?;

    // The actual recording start is handled by the frontend plugin
    Ok(())
}

#[tauri::command]
async fn stop_recording(
    _agent_id: String,
    _db: tauri::State<'_, DatabaseConnection>,
    _ai_client: tauri::State<'_, AiClient>,
    _app: tauri::AppHandle
) -> Result<RecordingResult, String> {
    // This would get audio data from the mic recorder plugin
    // For now, return a placeholder - actual implementation needs frontend integration
    Err("Audio recording stop not yet implemented - requires frontend plugin integration".to_string())
}

#[tauri::command]
async fn transcribe_audio(
    agent_id: String,
    audio_base64: String,
    db: tauri::State<'_, DatabaseConnection>,
    ai_client: tauri::State<'_, AiClient>
) -> Result<String, String> {
    let audio_service = AudioService::new(&ai_client);
    
    // Simple transcription - audio upload/logging is handled by frontend
    let transcription = audio_service.transcribe_base64(&audio_base64, None).await?;

    // Track usage
    PerceptionTracker::track_usage(
        &db,
        &agent_id,
        "audio",
        "transcribe",
        None
    ).await?;
    let agent_uuid = uuid::Uuid::parse_str(&agent_id).map_err(|e| format!("Invalid agent ID: {}", e))?;
    let _ = AbilityService::track_ability_usage(&db, agent_uuid, "audio_transcription", true).await;

    Ok(transcription)
}

#[tauri::command]
async fn log_audio_perception(
    agent_id: String,
    storage_path: String,
    transcription: Option<String>,
    duration_ms: Option<i32>,
    conversation_id: Option<String>,
    db: tauri::State<'_, DatabaseConnection>
) -> Result<(), String> {
    // Track usage
    PerceptionTracker::track_usage(
        &db,
        &agent_id,
        "audio",
        "upload",
        None
    ).await?;
    
    // Build analysis result with transcription if provided
    let analysis_result = transcription.map(|text| serde_json::json!({ "text": text }));
    
    // Log perception data with the storage path from frontend upload
    PerceptionTracker::log_perception(
        &db,
        &agent_id,
        conversation_id.as_deref(),
        "transcription",
        &storage_path,
        analysis_result,
        duration_ms
    ).await?;

    Ok(())
}

#[tauri::command]
async fn text_to_speech(
    agent_id: String,
    text: String,
    voice: Option<String>,
    db: tauri::State<'_, DatabaseConnection>,
    ai_client: tauri::State<'_, AiClient>
) -> Result<String, String> {
    let audio_service = AudioService::new(&ai_client);
    let audio_base64 = audio_service.text_to_speech_base64(&text, voice).await?;

    // Track usage
    PerceptionTracker::track_usage(
        &db,
        &agent_id,
        "audio",
        "tts",
        None
    ).await?;
    let agent_uuid = uuid::Uuid::parse_str(&agent_id).map_err(|e| format!("Invalid agent ID: {}", e))?;
    let _ = AbilityService::track_ability_usage(&db, agent_uuid, "voice_synthesis", true).await;

    Ok(audio_base64)
}

// File reading command for audio files
#[tauri::command]
async fn read_audio_file(file_path: String) -> Result<String, String> {
    use base64::{Engine as _, engine::general_purpose};
    
    let bytes = std::fs::read(&file_path)
        .map_err(|e| format!("Failed to read audio file: {}", e))?;
    
    Ok(general_purpose::STANDARD.encode(&bytes))
}

// OpenAI Realtime API token generation for Voice Chat feature (GA version)
#[tauri::command]
async fn get_realtime_session_token(voice: Option<String>) -> Result<String, String> {
    use serde_json::json;
    
    let api_key = std::env::var("OPENAI_API_KEY")
        .map_err(|_| "OPENAI_API_KEY environment variable not set".to_string())?;
    
    let voice_setting = voice.unwrap_or_else(|| "alloy".to_string());
    
    let client = reqwest::Client::new();
    
    // Use the GA endpoint: /v1/realtime/client_secrets
    let response = client
        .post("https://api.openai.com/v1/realtime/client_secrets")
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .json(&json!({
            "session": {
                "type": "realtime",
                "model": "gpt-realtime",
                "audio": {
                    "output": {
                        "voice": voice_setting
                    }
                }
            }
        }))
        .send()
        .await
        .map_err(|e| format!("Failed to request realtime session: {}", e))?;
    
    if !response.status().is_success() {
        let status = response.status();
        let error_text = response.text().await.unwrap_or_default();
        return Err(format!("Realtime session request failed with status {}: {}", status, error_text));
    }
    
    let body: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse realtime session response: {}", e))?;
    
    // The GA response has the token directly in "value" field
    let token = body
        .get("value")
        .and_then(|v| v.as_str())
        .ok_or_else(|| format!("No value in response: {:?}", body))?;
    
    Ok(token.to_string())
}

// Stats command
#[tauri::command]
async fn get_perception_stats(
    agent_id: String,
    db: tauri::State<'_, DatabaseConnection>
) -> Result<Vec<PerceptionStat>, String> {
    PerceptionTracker::get_stats(&db, &agent_id).await
}

// User profile commands
#[tauri::command]
async fn get_user_profile(
    user_id: String,
    db: tauri::State<'_, DatabaseConnection>
) -> Result<user_profile_service::UserProfileData, String> {
    user_profile_service::UserProfileService::get_or_create_profile(&db, user_id).await
}

#[tauri::command]
async fn update_user_profile(
    user_id: String,
    updates: user_profile_service::UpdateUserProfileRequest,
    db: tauri::State<'_, DatabaseConnection>
) -> Result<user_profile_service::UserProfileData, String> {
    user_profile_service::UserProfileService::update_profile(&db, user_id, updates).await
}

#[tauri::command]
async fn list_agent_abilities(
    agent_id: String,
    db: tauri::State<'_, DatabaseConnection>
) -> Result<Vec<ability_service::AgentAbilityData>, String> {
    AbilityService::list_agent_abilities(&db, agent_id).await
}

#[tauri::command]
async fn get_relevant_memories(
    agent_id: String,
    query: String,
    conversation_id: Option<String>,
    db: tauri::State<'_, DatabaseConnection>
) -> Result<Vec<SimilarMessage>, String> {
    let agent_uuid = uuid::Uuid::parse_str(&agent_id).map_err(|e| format!("Invalid agent ID: {}", e))?;
    let conversation_uuid = conversation_id
        .map(|id| uuid::Uuid::parse_str(&id))
        .transpose()
        .map_err(|e| format!("Invalid conversation ID: {}", e))?;
    println!(
        "[MEMORY] Search request for agent={} conversation={:?} query='{}'",
        agent_uuid, conversation_uuid, query
    );

    let memories = MemoryService::search_similar_messages(&db, &query, agent_uuid, conversation_uuid, 10)
        .await
        .map_err(|e| {
            eprintln!("[MEMORY] Search failed: {}", e);
            e
        })?;

    println!("[MEMORY] Search returned {} matches", memories.len());
    let _ = AbilityService::track_ability_usage(&db, agent_uuid, "memory_retrieval", true).await;
    Ok(memories)
}

#[tauri::command]
async fn submit_message_feedback(
    request: SubmitFeedbackRequest,
    db: tauri::State<'_, DatabaseConnection>
) -> Result<(), String> {
    FeedbackService::submit_feedback(&db, request).await
}

#[tauri::command]
async fn get_agent_feedback_stats(
    agent_id: String,
    db: tauri::State<'_, DatabaseConnection>
) -> Result<feedback_service::FeedbackStats, String> {
    FeedbackService::get_feedback_stats(&db, agent_id).await
}

#[tauri::command]
async fn analyze_agent_feedback_patterns(
    agent_id: String,
    db: tauri::State<'_, DatabaseConnection>
) -> Result<Vec<feedback_service::PersonalityAdjustmentData>, String> {
    FeedbackService::analyze_feedback_patterns(&db, agent_id).await
}

#[tauri::command]
async fn list_personality_adjustments(
    agent_id: String,
    db: tauri::State<'_, DatabaseConnection>
) -> Result<Vec<feedback_service::PersonalityAdjustmentData>, String> {
    FeedbackService::list_personality_adjustments(&db, agent_id).await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            // Initialize database connection at startup
            tauri::async_runtime::block_on(async {
                match db::init_db().await {
                    Ok(db_conn) => {
                        if let Err(err) = AbilityService::initialize_core_abilities(&db_conn).await {
                            eprintln!("[APP] Failed to initialize core abilities: {}", err);
                        }
                        app.manage(db_conn);
                        println!("[APP] Database connection initialized successfully");
                    }
                    Err(e) => {
                        eprintln!("[APP] Failed to initialize database: {:?}", e);
                        return Err(Box::new(e) as Box<dyn std::error::Error>);
                    }
                }

                // Initialize AI client
                match ai_client::create_ai_client() {
                    Ok(client) => {
                        app.manage(client);
                        println!("[APP] AI client initialized successfully");
                        Ok(())
                    }
                    Err(e) => {
                        eprintln!("[APP] Failed to initialize AI client: {}", e);
                        eprintln!("[APP] AI features will be unavailable");
                        // Don't fail the app if AI client fails, just continue without it
                        // We'll create a dummy client for development
                        Ok(())
                    }
                }
            })
        })
        .manage(AuthState::new())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_mic_recorder::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            set_session,
            clear_session,
            verify_session,
            create_agent,
            list_agents,
            get_agent,
            update_agent,
            delete_agent,
            send_message_to_agent,
            create_conversation,
            list_conversations,
            get_conversation,
            get_conversation_messages,
            send_message,
            send_message_streaming,
            update_conversation_title,
            generate_conversation_title,
            save_voice_transcript,
            delete_conversation,
            delete_message,
            edit_message,
            edit_message_streaming,
            // Perception commands
            capture_screenshot,
            log_screenshot_perception,
            analyze_image,
            start_recording,
            stop_recording,
            transcribe_audio,
            log_audio_perception,
            text_to_speech,
            read_audio_file,
            get_perception_stats,
            // User profile commands
            get_user_profile,
            update_user_profile,
            // Skill tracking + memory + feedback
            list_agent_abilities,
            get_relevant_memories,
            submit_message_feedback,
            get_agent_feedback_stats,
            analyze_agent_feedback_patterns,
            list_personality_adjustments,
            // Realtime voice chat
            get_realtime_session_token
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
