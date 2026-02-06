mod auth;
mod db;
mod entities;
mod agent_service;
mod conversation_service;
mod ai_client;

use tauri::Manager;
use auth::{AuthState, SessionData};
use sea_orm::DatabaseConnection;
use agent_service::{AgentService, CreateAgentRequest, UpdateAgentRequest};
use conversation_service::{ConversationService, CreateConversationRequest};
use ai_client::AiClient;

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
    AgentService::send_message_to_agent(&db, agent_id, message, vec![], &ai_client).await
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
    db: tauri::State<'_, DatabaseConnection>,
    ai_client: tauri::State<'_, AiClient>
) -> Result<conversation_service::MessageData, String> {
    ConversationService::send_message(&db, conversation_id, content, &ai_client).await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            // Initialize database connection at startup
            tauri::async_runtime::block_on(async {
                match db::init_db().await {
                    Ok(db_conn) => {
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
            send_message
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
