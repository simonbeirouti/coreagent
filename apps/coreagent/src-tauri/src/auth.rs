use serde::{Deserialize, Serialize};
use std::sync::Mutex;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionData {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub user_id: String,
    pub expires_at: i64,
}

#[derive(Default)]
pub struct AuthState {
    session: Mutex<Option<SessionData>>,
}

impl AuthState {
    pub fn new() -> Self {
        Self {
            session: Mutex::new(None),
        }
    }

    pub fn set_session(&self, session: SessionData) {
        let mut s = self.session.lock().unwrap();
        println!(
            "[AUTH] Session stored for user: {} (expires: {})",
            session.user_id, session.expires_at
        );
        *s = Some(session);
    }

    pub fn get_session(&self) -> Option<SessionData> {
        let session = self.session.lock().unwrap().clone();
        if let Some(ref s) = session {
            println!("[AUTH] Session retrieved for user: {}", s.user_id);
        } else {
            println!("[AUTH] No session found in backend");
        }
        session
    }

    pub fn clear_session(&self) {
        let mut s = self.session.lock().unwrap();
        *s = None;
        println!("[AUTH] Session cleared from backend");
    }
}
