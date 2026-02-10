use sea_orm::{ConnectionTrait, DatabaseBackend, DatabaseConnection, Statement};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SimilarMessage {
    pub message_id: Uuid,
    pub conversation_id: Uuid,
    pub role: String,
    pub content: String,
    pub similarity: f32,
    pub created_at: String,
}

pub struct MemoryService;

impl MemoryService {
    fn compact_search_text(text: &str) -> String {
        text.chars()
            .filter(|c| c.is_ascii_alphanumeric())
            .flat_map(|c| c.to_lowercase())
            .collect()
    }

    fn to_vector_literal(values: &[f32]) -> String {
        format!(
            "[{}]",
            values
                .iter()
                .map(|v| v.to_string())
                .collect::<Vec<_>>()
                .join(",")
        )
    }

    pub async fn generate_embedding(text: &str) -> Result<Vec<f32>, String> {
        let api_key = std::env::var("OPENAI_API_KEY")
            .map_err(|_| "OPENAI_API_KEY is not set; cannot generate embeddings".to_string())?;

        let client = reqwest::Client::new();
        let response = client
            .post("https://api.openai.com/v1/embeddings")
            .bearer_auth(api_key)
            .header("Content-Type", "application/json")
            .json(&serde_json::json!({
                "model": "text-embedding-3-small",
                "input": text
            }))
            .send()
            .await
            .map_err(|e| format!("Embedding request failed: {e}"))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(format!("Embedding request failed ({status}): {body}"));
        }

        let body: serde_json::Value = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse embedding response: {e}"))?;

        let embedding = body
            .get("data")
            .and_then(|v| v.as_array())
            .and_then(|arr| arr.first())
            .and_then(|v| v.get("embedding"))
            .and_then(|v| v.as_array())
            .ok_or_else(|| "Embedding response missing data[0].embedding".to_string())?;

        let mut out = Vec::with_capacity(embedding.len());
        for item in embedding {
            let value = item
                .as_f64()
                .ok_or_else(|| "Embedding contains non-numeric value".to_string())?;
            out.push(value as f32);
        }
        Ok(out)
    }

    pub async fn store_message_embedding(
        db: &DatabaseConnection,
        message_id: Uuid,
        embedding: &[f32],
    ) -> Result<(), String> {
        let vector_literal = Self::to_vector_literal(embedding);
        let embedding_json = serde_json::to_string(embedding)
            .map_err(|e| format!("Failed to serialize embedding json: {e}"))?;

        let sql = r#"
            INSERT INTO message_embeddings (id, message_id, embedding, embedding_json, created_at)
            VALUES (gen_random_uuid(), $1::uuid, $2::vector, $3::jsonb, NOW())
            ON CONFLICT (message_id)
            DO UPDATE SET
                embedding = EXCLUDED.embedding,
                embedding_json = EXCLUDED.embedding_json
        "#;

        db.execute(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            sql,
            vec![
                message_id.into(),
                vector_literal.into(),
                embedding_json.into(),
            ],
        ))
        .await
        .map_err(|e| format!("Failed to store embedding: {e}"))?;

        Ok(())
    }

    pub async fn embed_message_content(
        db: &DatabaseConnection,
        message_id: Uuid,
        content: &str,
    ) -> Result<(), String> {
        if content.trim().is_empty() {
            return Ok(());
        }

        let embedding = Self::generate_embedding(content).await?;
        Self::store_message_embedding(db, message_id, &embedding).await
    }

    pub async fn search_similar_messages(
        db: &DatabaseConnection,
        query: &str,
        agent_id: Uuid,
        current_conversation_id: Option<Uuid>,
        limit: usize,
    ) -> Result<Vec<SimilarMessage>, String> {
        let query_embedding = Self::generate_embedding(query).await?;
        let vector_literal = Self::to_vector_literal(&query_embedding);
        let text_match_pattern = format!("%{}%", query);
        let compact_query = Self::compact_search_text(query);
        let compact_text_match_pattern = format!("%{}%", compact_query);

        let sql = r#"
            SELECT
                m.id AS message_id,
                m.conversation_id,
                m.role,
                m.content,
                COALESCE((1 - (me.embedding <=> $1::vector))::float, 0.0) AS similarity,
                m.created_at::text AS created_at
            FROM messages m
            JOIN conversations c ON c.id = m.conversation_id
            LEFT JOIN message_embeddings me ON m.id = me.message_id
            WHERE c.agent_id = $2::uuid
              AND ($3::uuid IS NULL OR m.conversation_id <> $3::uuid)
              AND m.role IN ('user', 'assistant')
              AND (
                (me.embedding IS NOT NULL AND (1 - (me.embedding <=> $1::vector)) >= 0.70)
                OR m.content ILIKE $5
                OR regexp_replace(lower(m.content), '[^a-z0-9]+', '', 'g') LIKE $6
              )
            ORDER BY
              CASE
                WHEN m.content ILIKE $5 THEN 0
                WHEN regexp_replace(lower(m.content), '[^a-z0-9]+', '', 'g') LIKE $6 THEN 1
                ELSE 2
              END,
              me.embedding <=> $1::vector NULLS LAST,
              m.created_at DESC
            LIMIT $4
        "#;

        let rows = db
            .query_all(Statement::from_sql_and_values(
                DatabaseBackend::Postgres,
                sql,
                vec![
                    vector_literal.into(),
                    agent_id.into(),
                    current_conversation_id.into(),
                    (limit as i64).into(),
                    text_match_pattern.into(),
                    compact_text_match_pattern.into(),
                ],
            ))
            .await
            .map_err(|e| format!("Failed to search similar messages: {e}"))?;

        let mut out = Vec::with_capacity(rows.len());
        for row in rows {
            let similarity = row
                .try_get::<Option<f64>>("", "similarity")
                .map_err(|e| format!("Failed to decode similarity: {e}"))?
                .unwrap_or(0.0) as f32;

            out.push(SimilarMessage {
                message_id: row
                    .try_get("", "message_id")
                    .map_err(|e| format!("Failed to decode message_id: {e}"))?,
                conversation_id: row
                    .try_get("", "conversation_id")
                    .map_err(|e| format!("Failed to decode conversation_id: {e}"))?,
                role: row
                    .try_get("", "role")
                    .map_err(|e| format!("Failed to decode role: {e}"))?,
                content: row
                    .try_get("", "content")
                    .map_err(|e| format!("Failed to decode content: {e}"))?,
                similarity,
                created_at: row
                    .try_get("", "created_at")
                    .map_err(|e| format!("Failed to decode created_at: {e}"))?,
            });
        }

        Ok(out)
    }

    pub async fn get_relevant_context(
        db: &DatabaseConnection,
        query: &str,
        agent_id: Uuid,
        current_conversation_id: Option<Uuid>,
    ) -> Result<Vec<String>, String> {
        let matches =
            Self::search_similar_messages(db, query, agent_id, current_conversation_id, 4).await?;

        let contexts = matches
            .into_iter()
            .map(|m| format!("[Memory {:.2}] {}: {}", m.similarity, m.role, m.content))
            .collect::<Vec<_>>();
        Ok(contexts)
    }
}

#[cfg(test)]
mod tests {
    use super::MemoryService;

    #[test]
    fn vector_literal_is_pgvector_compatible() {
        let literal = MemoryService::to_vector_literal(&[0.5, -1.25, 2.0]);
        assert_eq!(literal, "[0.5,-1.25,2]");
    }
}

