//! SeaORM Entity for abilities table

use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq, Serialize, Deserialize)]
#[sea_orm(table_name = "abilities")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: Uuid,
    pub name: String,
    pub description: Option<String>,
    pub category: String,
    pub implementation_key: String,
    pub is_premium: bool,
    pub parameters_schema: Json,
    pub created_at: DateTimeWithTimeZone,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(has_many = "super::agent_abilities::Entity")]
    AgentAbilities,
}

impl Related<super::agent_abilities::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::AgentAbilities.def()
    }
}

impl ActiveModelBehavior for ActiveModel {}
