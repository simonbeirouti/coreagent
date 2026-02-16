use crate::entities::user_profiles::{self, Entity as UserProfiles};
use chrono;
use sea_orm::{
    ActiveModelTrait, ActiveValue, ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter, Set,
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use uuid::Uuid;

// User profile data structures
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserProfileData {
    pub id: Uuid,
    pub user_id: Uuid,
    pub preferences: serde_json::Value,
    pub habits: serde_json::Value,
    pub work_patterns: serde_json::Value,
    pub language: String,
    pub ai_response_language: String,
    pub notifications_enabled: bool,
    pub analytics_enabled: bool,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub updated_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateUserProfileRequest {
    pub preferences: Option<serde_json::Value>,
    pub habits: Option<serde_json::Value>,
    pub work_patterns: Option<serde_json::Value>,
    pub language: Option<String>,
    pub ai_response_language: Option<String>,
    pub notifications_enabled: Option<bool>,
    pub analytics_enabled: Option<bool>,
}

// Convert SeaORM model to our UserProfileData struct
impl From<user_profiles::Model> for UserProfileData {
    fn from(model: user_profiles::Model) -> Self {
        UserProfileData {
            id: model.id,
            user_id: model.user_id,
            preferences: model.preferences,
            habits: model.habits,
            work_patterns: model.work_patterns,
            language: model.language,
            ai_response_language: model.ai_response_language,
            notifications_enabled: model.notifications_enabled,
            analytics_enabled: model.analytics_enabled,
            created_at: model.created_at.into(),
            updated_at: model.updated_at.into(),
        }
    }
}

// User profile service implementation
pub struct UserProfileService;

impl UserProfileService {
    /// Get or create a user profile (ensures profile always exists)
    pub async fn get_or_create_profile(
        db: &DatabaseConnection,
        user_id: String,
    ) -> Result<UserProfileData, String> {
        let user_uuid = Uuid::parse_str(&user_id).map_err(|e| format!("Invalid user ID: {}", e))?;

        // Try to find existing profile
        if let Some(profile) = UserProfiles::find()
            .filter(user_profiles::Column::UserId.eq(user_uuid))
            .one(db)
            .await
            .map_err(|e| format!("Failed to query user profile: {}", e))?
        {
            println!(
                "[USER_PROFILE] Found existing profile for user: {}",
                user_uuid
            );
            return Ok(profile.into());
        }

        // Create default profile if it doesn't exist
        println!(
            "[USER_PROFILE] Creating default profile for user: {}",
            user_uuid
        );
        let profile = user_profiles::ActiveModel {
            id: ActiveValue::Set(Uuid::new_v4()),
            user_id: ActiveValue::Set(user_uuid),
            preferences: ActiveValue::Set(json!({
                "communication_style": "balanced",
                "timezone": "UTC"
            })),
            habits: ActiveValue::Set(json!({
                "feedback_style": "constructive",
                "session_length": "medium"
            })),
            work_patterns: ActiveValue::Set(json!({})),
            language: ActiveValue::Set("en".to_string()),
            ai_response_language: ActiveValue::Set("en".to_string()),
            notifications_enabled: ActiveValue::Set(true),
            analytics_enabled: ActiveValue::Set(false),
            created_at: ActiveValue::Set(chrono::Utc::now().into()),
            updated_at: ActiveValue::Set(chrono::Utc::now().into()),
        };

        let profile = profile
            .insert(db)
            .await
            .map_err(|e| format!("Failed to create user profile: {}", e))?;

        println!(
            "[USER_PROFILE] Created default profile for user: {}",
            user_uuid
        );
        Ok(profile.into())
    }

    /// Get a user profile (returns None if doesn't exist)
    pub async fn get_profile(
        db: &DatabaseConnection,
        user_id: String,
    ) -> Result<Option<UserProfileData>, String> {
        let user_uuid = Uuid::parse_str(&user_id).map_err(|e| format!("Invalid user ID: {}", e))?;

        let profile = UserProfiles::find()
            .filter(user_profiles::Column::UserId.eq(user_uuid))
            .one(db)
            .await
            .map_err(|e| format!("Failed to get user profile: {}", e))?;

        Ok(profile.map(|p| p.into()))
    }

    /// Update a user profile
    pub async fn update_profile(
        db: &DatabaseConnection,
        user_id: String,
        updates: UpdateUserProfileRequest,
    ) -> Result<UserProfileData, String> {
        let user_uuid = Uuid::parse_str(&user_id).map_err(|e| format!("Invalid user ID: {}", e))?;

        // Find existing profile
        let mut profile: user_profiles::ActiveModel = UserProfiles::find()
            .filter(user_profiles::Column::UserId.eq(user_uuid))
            .one(db)
            .await
            .map_err(|e| format!("Failed to find user profile: {}", e))?
            .ok_or_else(|| format!("User profile not found for user: {}", user_uuid))?
            .into();

        // Apply updates
        if let Some(preferences) = updates.preferences {
            profile.preferences = Set(preferences);
        }
        if let Some(habits) = updates.habits {
            profile.habits = Set(habits);
        }
        if let Some(work_patterns) = updates.work_patterns {
            profile.work_patterns = Set(work_patterns);
        }
        if let Some(language) = updates.language {
            profile.language = Set(language);
        }
        if let Some(ai_response_language) = updates.ai_response_language {
            profile.ai_response_language = Set(ai_response_language);
        }
        if let Some(notifications_enabled) = updates.notifications_enabled {
            profile.notifications_enabled = Set(notifications_enabled);
        }
        if let Some(analytics_enabled) = updates.analytics_enabled {
            profile.analytics_enabled = Set(analytics_enabled);
        }

        profile.updated_at = Set(chrono::Utc::now().into());

        let profile = profile
            .update(db)
            .await
            .map_err(|e| format!("Failed to update user profile: {}", e))?;

        println!("[USER_PROFILE] Updated profile for user: {}", user_uuid);
        Ok(profile.into())
    }

    /// Delete a user profile
    pub async fn delete_profile(db: &DatabaseConnection, user_id: String) -> Result<(), String> {
        let user_uuid = Uuid::parse_str(&user_id).map_err(|e| format!("Invalid user ID: {}", e))?;

        let result = UserProfiles::delete_many()
            .filter(user_profiles::Column::UserId.eq(user_uuid))
            .exec(db)
            .await
            .map_err(|e| format!("Failed to delete user profile: {}", e))?;

        if result.rows_affected == 0 {
            return Err(format!("User profile not found for user: {}", user_uuid));
        }

        println!("[USER_PROFILE] Deleted profile for user: {}", user_uuid);
        Ok(())
    }
}
