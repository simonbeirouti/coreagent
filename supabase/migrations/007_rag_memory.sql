-- CoreAgent Phase 2: RAG Memory
-- Migration: 007_rag_memory.sql

-- Enable pgvector for semantic search
CREATE EXTENSION IF NOT EXISTS vector;

-- Store message embeddings for semantic retrieval
CREATE TABLE message_embeddings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id UUID NOT NULL UNIQUE REFERENCES messages(id) ON DELETE CASCADE,
    -- Vector used for similarity search
    embedding vector(1536) NOT NULL,
    -- JSON mirror keeps tooling/ORM interoperability simple
    embedding_json JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_message_embeddings_message_id ON message_embeddings(message_id);
CREATE INDEX idx_message_embeddings_created_at ON message_embeddings(created_at);
CREATE INDEX idx_message_embeddings_vector
    ON message_embeddings
    USING hnsw (embedding vector_cosine_ops);

-- Optional helper RPC for querying similar memories by agent
CREATE OR REPLACE FUNCTION public.search_similar_messages(
    query_embedding vector(1536),
    agent_id_filter UUID,
    similarity_threshold FLOAT DEFAULT 0.75,
    max_results INT DEFAULT 5
)
RETURNS TABLE (
    message_id UUID,
    conversation_id UUID,
    role TEXT,
    content TEXT,
    similarity FLOAT,
    created_at TIMESTAMPTZ
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, extensions, pg_catalog
AS $$
    SELECT
        m.id AS message_id,
        m.conversation_id,
        m.role,
        m.content,
        (1 - (me.embedding <=> query_embedding))::FLOAT AS similarity,
        m.created_at
    FROM public.message_embeddings me
    JOIN public.messages m ON m.id = me.message_id
    JOIN public.conversations c ON c.id = m.conversation_id
    WHERE c.agent_id = agent_id_filter
      AND (1 - (me.embedding <=> query_embedding)) >= similarity_threshold
    ORDER BY me.embedding <=> query_embedding
    LIMIT max_results;
$$;

GRANT EXECUTE ON FUNCTION public.search_similar_messages(vector, UUID, FLOAT, INT) TO authenticated;

-- RLS
ALTER TABLE message_embeddings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can access message embeddings in their conversations"
ON message_embeddings FOR ALL USING (
    EXISTS (
        SELECT 1
        FROM messages m
        JOIN conversations c ON c.id = m.conversation_id
        JOIN agents a ON a.id = c.agent_id
        WHERE m.id = message_embeddings.message_id
          AND a.user_id = auth.uid()
    )
);

