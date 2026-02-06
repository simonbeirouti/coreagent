mod auth;

use auth::{AuthState, SessionData};

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AuthState::new())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![greet, set_session, clear_session, verify_session])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
