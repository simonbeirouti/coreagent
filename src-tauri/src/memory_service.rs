use sea_orm::{ConnectionTrait, DatabaseBackend, DatabaseConnection, Statement};
use serde::{Deserialize, Serialize};
use std::time::Instant;
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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryRetrievalQualitySummary {
    pub total_events: i64,
    pub hit_rate: f32,
    pub no_hit_rate: f32,
    pub avg_result_count: f32,
    pub avg_top_similarity: f32,
    pub avg_similarity: f32,
    pub p95_latency_ms: f32,
    pub last_retrieval_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryRetrievalTimeseriesPoint {
    pub date: String,
    pub hit_count: i32,
    pub no_hit_count: i32,
    pub hit_rate: f32,
    pub avg_top_similarity: f32,
    pub p95_latency_ms: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RetrievalEvalResult {
    pub queries_tested: i32,
    pub hit_count: i32,
    pub hit_rate: f32,
    pub avg_top_similarity: f32,
    pub generated_at: String,
}

pub struct MemoryService;

impl MemoryService {
    fn retrieval_telemetry_enabled() -> bool {
        std::env::var("RETRIEVAL_TELEMETRY")
            .ok()
            .map(|v| matches!(v.trim().to_ascii_lowercase().as_str(), "1" | "true" | "yes" | "on"))
            .unwrap_or(true)
    }

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
        Self::search_similar_messages_internal(
            db,
            query,
            agent_id,
            current_conversation_id,
            limit,
            false,
        )
        .await
    }

    async fn search_similar_messages_internal(
        db: &DatabaseConnection,
        query: &str,
        agent_id: Uuid,
        current_conversation_id: Option<Uuid>,
        limit: usize,
        used_in_response: bool,
    ) -> Result<Vec<SimilarMessage>, String> {
        let started = Instant::now();
        let similarity_threshold = 0.70_f32;
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
                (me.embedding IS NOT NULL AND (1 - (me.embedding <=> $1::vector)) >= $7::float)
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
                    (similarity_threshold as f64).into(),
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

        let result_count = out.len() as i32;
        let top_similarity = out
            .iter()
            .map(|m| m.similarity)
            .max_by(|a, b| a.total_cmp(b))
            .unwrap_or(0.0);
        let avg_similarity = if out.is_empty() {
            0.0
        } else {
            out.iter().map(|m| m.similarity).sum::<f32>() / out.len() as f32
        };
        let selected_memory_ids = serde_json::to_string(
            &out.iter()
                .map(|m| m.message_id.to_string())
                .collect::<Vec<String>>(),
        )
        .unwrap_or_else(|_| "[]".to_string());
        let fingerprint = if compact_query.is_empty() {
            "empty".to_string()
        } else {
            compact_query.chars().take(64).collect::<String>()
        };
        let latency_ms = started.elapsed().as_millis() as i32;
        let insert_sql = r#"
            INSERT INTO memory_retrieval_events (
                id,
                agent_id,
                conversation_id,
                query_fingerprint,
                query_length,
                similarity_threshold,
                max_results,
                result_count,
                top_similarity,
                avg_similarity,
                latency_ms,
                selected_memory_ids,
                used_in_response,
                retrieval_mode,
                created_at
            )
            VALUES (
                gen_random_uuid(),
                $1::uuid,
                $2::uuid,
                $3::text,
                $4::int,
                $5::float,
                $6::int,
                $7::int,
                $8::float,
                $9::float,
                $10::int,
                $11::jsonb,
                $12::bool,
                'semantic_hybrid',
                NOW()
            )
        "#;
        if Self::retrieval_telemetry_enabled() {
            if let Err(err) = db
                .execute(Statement::from_sql_and_values(
                    DatabaseBackend::Postgres,
                    insert_sql,
                    vec![
                        agent_id.into(),
                        current_conversation_id.into(),
                        fingerprint.into(),
                        (query.chars().count() as i32).into(),
                        (similarity_threshold as f64).into(),
                        (limit as i32).into(),
                        result_count.into(),
                        (top_similarity as f64).into(),
                        (avg_similarity as f64).into(),
                        latency_ms.into(),
                        selected_memory_ids.into(),
                        used_in_response.into(),
                    ],
                ))
                .await
            {
                eprintln!("[MEMORY] Failed to persist retrieval telemetry: {}", err);
            }
        }

        Ok(out)
    }

    pub async fn get_relevant_context(
        db: &DatabaseConnection,
        query: &str,
        agent_id: Uuid,
        current_conversation_id: Option<Uuid>,
    ) -> Result<Vec<String>, String> {
        let matches = Self::search_similar_messages_internal(
            db,
            query,
            agent_id,
            current_conversation_id,
            4,
            true,
        )
        .await?;

        let contexts = matches
            .into_iter()
            .map(|m| format!("[Memory {:.2}] {}: {}", m.similarity, m.role, m.content))
            .collect::<Vec<_>>();
        Ok(contexts)
    }

    pub async fn get_retrieval_quality_summary(
        db: &DatabaseConnection,
        agent_id: Uuid,
        days: i32,
    ) -> Result<MemoryRetrievalQualitySummary, String> {
        let days = days.clamp(1, 90);
        let sql = r#"
            SELECT
                COUNT(*)::bigint AS total_events,
                COUNT(*) FILTER (WHERE result_count = 0)::bigint AS no_hit_events,
                COALESCE(AVG(result_count), 0)::float AS avg_result_count,
                COALESCE(AVG(top_similarity), 0)::float AS avg_top_similarity,
                COALESCE(AVG(avg_similarity), 0)::float AS avg_similarity,
                COALESCE(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latency_ms), 0)::float AS p95_latency_ms,
                MAX(created_at)::text AS last_retrieval_at
            FROM memory_retrieval_events
            WHERE agent_id = $1::uuid
              AND created_at >= NOW() - (($2::int || ' days')::interval)
        "#;
        let row = db
            .query_one(Statement::from_sql_and_values(
                DatabaseBackend::Postgres,
                sql,
                vec![agent_id.into(), days.into()],
            ))
            .await
            .map_err(|e| format!("Failed loading retrieval quality summary: {e}"))?
            .ok_or_else(|| "No retrieval summary row returned".to_string())?;

        let total_events = row
            .try_get::<i64>("", "total_events")
            .map_err(|e| format!("Failed decoding total_events: {e}"))?;
        let no_hit_events = row
            .try_get::<i64>("", "no_hit_events")
            .map_err(|e| format!("Failed decoding no_hit_events: {e}"))?;
        let hit_rate = if total_events <= 0 {
            0.0
        } else {
            ((total_events - no_hit_events) as f32 / total_events as f32).clamp(0.0, 1.0)
        };
        let no_hit_rate = if total_events <= 0 {
            0.0
        } else {
            (no_hit_events as f32 / total_events as f32).clamp(0.0, 1.0)
        };

        Ok(MemoryRetrievalQualitySummary {
            total_events,
            hit_rate,
            no_hit_rate,
            avg_result_count: row
                .try_get::<f64>("", "avg_result_count")
                .map_err(|e| format!("Failed decoding avg_result_count: {e}"))?
                as f32,
            avg_top_similarity: row
                .try_get::<f64>("", "avg_top_similarity")
                .map_err(|e| format!("Failed decoding avg_top_similarity: {e}"))?
                as f32,
            avg_similarity: row
                .try_get::<f64>("", "avg_similarity")
                .map_err(|e| format!("Failed decoding avg_similarity: {e}"))?
                as f32,
            p95_latency_ms: row
                .try_get::<f64>("", "p95_latency_ms")
                .map_err(|e| format!("Failed decoding p95_latency_ms: {e}"))?
                as f32,
            last_retrieval_at: row
                .try_get::<Option<String>>("", "last_retrieval_at")
                .map_err(|e| format!("Failed decoding last_retrieval_at: {e}"))?,
        })
    }

    pub async fn get_retrieval_quality_timeseries(
        db: &DatabaseConnection,
        agent_id: Uuid,
        days: i32,
    ) -> Result<Vec<MemoryRetrievalTimeseriesPoint>, String> {
        let days = days.clamp(1, 90);
        let sql = r#"
            WITH day_bins AS (
                SELECT generate_series(
                    date_trunc('day', NOW()) - (($2::int - 1 || ' days')::interval),
                    date_trunc('day', NOW()),
                    interval '1 day'
                ) AS day
            ),
            day_events AS (
                SELECT
                    date_trunc('day', created_at) AS day,
                    COUNT(*) FILTER (WHERE result_count > 0) AS hit_count,
                    COUNT(*) FILTER (WHERE result_count = 0) AS no_hit_count,
                    AVG(top_similarity) AS avg_top_similarity,
                    PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latency_ms) AS p95_latency_ms
                FROM memory_retrieval_events
                WHERE agent_id = $1::uuid
                  AND created_at >= NOW() - (($2::int || ' days')::interval)
                GROUP BY date_trunc('day', created_at)
            )
            SELECT
                to_char(day_bins.day::date, 'YYYY-MM-DD') AS date,
                COALESCE(day_events.hit_count, 0)::int AS hit_count,
                COALESCE(day_events.no_hit_count, 0)::int AS no_hit_count,
                COALESCE(day_events.avg_top_similarity, 0)::float AS avg_top_similarity,
                COALESCE(day_events.p95_latency_ms, 0)::float AS p95_latency_ms
            FROM day_bins
            LEFT JOIN day_events ON day_events.day = day_bins.day
            ORDER BY day_bins.day ASC
        "#;

        let rows = db
            .query_all(Statement::from_sql_and_values(
                DatabaseBackend::Postgres,
                sql,
                vec![agent_id.into(), days.into()],
            ))
            .await
            .map_err(|e| format!("Failed loading retrieval quality timeseries: {e}"))?;

        let mut out = Vec::with_capacity(rows.len());
        for row in rows {
            let hit_count = row
                .try_get::<i32>("", "hit_count")
                .map_err(|e| format!("Failed decoding hit_count: {e}"))?;
            let no_hit_count = row
                .try_get::<i32>("", "no_hit_count")
                .map_err(|e| format!("Failed decoding no_hit_count: {e}"))?;
            let total = hit_count + no_hit_count;
            let hit_rate = if total <= 0 {
                0.0
            } else {
                (hit_count as f32 / total as f32).clamp(0.0, 1.0)
            };

            out.push(MemoryRetrievalTimeseriesPoint {
                date: row
                    .try_get("", "date")
                    .map_err(|e| format!("Failed decoding date: {e}"))?,
                hit_count,
                no_hit_count,
                hit_rate,
                avg_top_similarity: row
                    .try_get::<f64>("", "avg_top_similarity")
                    .map_err(|e| format!("Failed decoding avg_top_similarity: {e}"))?
                    as f32,
                p95_latency_ms: row
                    .try_get::<f64>("", "p95_latency_ms")
                    .map_err(|e| format!("Failed decoding p95_latency_ms: {e}"))?
                    as f32,
            });
        }
        Ok(out)
    }

    pub async fn run_retrieval_eval(
        db: &DatabaseConnection,
        agent_id: Uuid,
        sample_size: i32,
    ) -> Result<RetrievalEvalResult, String> {
        let sample_size = sample_size.clamp(5, 100);
        let seed_sql = r#"
            SELECT m.content, m.conversation_id
            FROM messages m
            JOIN conversations c ON c.id = m.conversation_id
            LEFT JOIN message_embeddings me ON me.message_id = m.id
            WHERE c.agent_id = $1::uuid
              AND m.role = 'user'
              AND me.embedding IS NOT NULL
              AND length(trim(m.content)) > 16
            ORDER BY m.created_at DESC
            LIMIT $2
        "#;
        let seed_rows = db
            .query_all(Statement::from_sql_and_values(
                DatabaseBackend::Postgres,
                seed_sql,
                vec![agent_id.into(), (sample_size as i64).into()],
            ))
            .await
            .map_err(|e| format!("Failed to load retrieval eval seed queries: {e}"))?;

        let mut queries_tested = 0_i32;
        let mut hit_count = 0_i32;
        let mut top_similarity_sum = 0.0_f32;

        for row in seed_rows {
            let query: String = row
                .try_get("", "content")
                .map_err(|e| format!("Failed decoding eval seed content: {e}"))?;
            let conversation_id: Uuid = row
                .try_get("", "conversation_id")
                .map_err(|e| format!("Failed decoding eval seed conversation_id: {e}"))?;

            let matches = Self::search_similar_messages_internal(
                db,
                &query,
                agent_id,
                Some(conversation_id),
                5,
                false,
            )
            .await
            .unwrap_or_default();
            queries_tested += 1;
            if let Some(best) = matches
                .iter()
                .map(|m| m.similarity)
                .max_by(|a, b| a.total_cmp(b))
            {
                hit_count += 1;
                top_similarity_sum += best;
            }
        }

        let hit_rate = if queries_tested <= 0 {
            0.0
        } else {
            (hit_count as f32 / queries_tested as f32).clamp(0.0, 1.0)
        };
        let avg_top_similarity = if hit_count <= 0 {
            0.0
        } else {
            top_similarity_sum / hit_count as f32
        };

        Ok(RetrievalEvalResult {
            queries_tested,
            hit_count,
            hit_rate,
            avg_top_similarity,
            generated_at: chrono::Utc::now().to_rfc3339(),
        })
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

