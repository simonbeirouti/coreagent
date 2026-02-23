//! SeaORM Entity for advisory_sync_state table

use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq, Serialize, Deserialize)]
#[sea_orm(table_name = "advisory_sync_state")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub state_key: String,
    pub cursor: Option<String>,
    pub last_success_at: Option<DateTimeWithTimeZone>,
    pub last_attempt_at: Option<DateTimeWithTimeZone>,
    pub last_control_sync_at: Option<DateTimeWithTimeZone>,
    pub last_app_sync_at: Option<DateTimeWithTimeZone>,
    pub next_retry_at: Option<DateTimeWithTimeZone>,
    pub consecutive_failures: i32,
    pub next_backoff_seconds: i32,
    pub last_error: Option<String>,
    pub created_at: DateTimeWithTimeZone,
    pub updated_at: DateTimeWithTimeZone,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
