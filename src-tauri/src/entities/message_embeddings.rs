//! SeaORM Entity for message_embeddings table

use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq, Serialize, Deserialize)]
#[sea_orm(table_name = "message_embeddings")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: Uuid,
    pub message_id: Uuid,
    // Note: vector column is mirrored as JSON for ORM-friendly reads/writes
    pub embedding_json: Json,
    pub created_at: DateTimeWithTimeZone,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(
        belongs_to = "super::messages::Entity",
        from = "Column::MessageId",
        to = "super::messages::Column::Id",
        on_update = "NoAction",
        on_delete = "Cascade"
    )]
    Messages,
}

impl Related<super::messages::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Messages.def()
    }
}

impl ActiveModelBehavior for ActiveModel {}
