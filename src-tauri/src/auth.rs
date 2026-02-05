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
        println!("Session stored for user: {}", session.user_id);
        *s = Some(session);
    }

    #[allow(dead_code)]
    pub fn get_session(&self) -> Option<SessionData> {
        self.session.lock().unwrap().clone()
    }

    pub fn clear_session(&self) {
        let mut s = self.session.lock().unwrap();
        *s = None;
        println!("Session cleared");
    }
}
