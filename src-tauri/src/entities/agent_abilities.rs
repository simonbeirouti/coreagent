//! SeaORM Entity for agent_abilities table

use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "agent_abilities")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: Uuid,
    pub agent_id: Uuid,
    pub ability_id: Uuid,
    pub acquired_at: DateTimeWithTimeZone,
    pub usage_count: i32,
    pub success_count: i32,
    pub proficiency: f64,
    pub last_used_at: Option<DateTimeWithTimeZone>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(
        belongs_to = "super::agents::Entity",
        from = "Column::AgentId",
        to = "super::agents::Column::Id",
        on_update = "NoAction",
        on_delete = "Cascade"
    )]
    Agents,
    #[sea_orm(
        belongs_to = "super::abilities::Entity",
        from = "Column::AbilityId",
        to = "super::abilities::Column::Id",
        on_update = "NoAction",
        on_delete = "Cascade"
    )]
    Abilities,
}

impl Related<super::agents::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Agents.def()
    }
}

impl Related<super::abilities::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Abilities.def()
    }
}

impl ActiveModelBehavior for ActiveModel {}

