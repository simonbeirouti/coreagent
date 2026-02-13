-- CoreAgent Phase 2 Completion: Adaptation + Retrieval Observability + Skill Trends
-- Migration: 010_hits_and_retrieval_observability.sql

CREATE TABLE adaptation_cycles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    window_started_at TIMESTAMPTZ,
    window_ended_at TIMESTAMPTZ,
    sample_size INTEGER NOT NULL DEFAULT 0,
    signal_summary JSONB NOT NULL DEFAULT '{}',
    guardrail_flags JSONB NOT NULL DEFAULT '{}',
    applied_changes JSONB NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'applied' CHECK (status IN ('applied', 'skipped', 'reverted')),
    reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE trait_state (
    agent_id UUID PRIMARY KEY REFERENCES agents(id) ON DELETE CASCADE,
    helpfulness FLOAT NOT NULL DEFAULT 0.5 CHECK (helpfulness >= 0.0 AND helpfulness <= 1.0),
    formality FLOAT NOT NULL DEFAULT 0.5 CHECK (formality >= 0.0 AND formality <= 1.0),
    verbosity FLOAT NOT NULL DEFAULT 0.5 CHECK (verbosity >= 0.0 AND verbosity <= 1.0),
    proactivity FLOAT NOT NULL DEFAULT 0.5 CHECK (proactivity >= 0.0 AND proactivity <= 1.0),
    creativity FLOAT NOT NULL DEFAULT 0.5 CHECK (creativity >= 0.0 AND creativity <= 1.0),
    empathy FLOAT NOT NULL DEFAULT 0.5 CHECK (empathy >= 0.0 AND empathy <= 1.0),
    adaptation_enabled BOOLEAN NOT NULL DEFAULT true,
    updated_by_cycle_id UUID REFERENCES adaptation_cycles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE skill_rating_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    skill_key TEXT NOT NULL,
    skill_name TEXT NOT NULL,
    rating FLOAT NOT NULL CHECK (rating >= 0.0 AND rating <= 100.0),
    quality_score FLOAT NOT NULL CHECK (quality_score >= 0.0 AND quality_score <= 1.0),
    engagement_score FLOAT NOT NULL CHECK (engagement_score >= 0.0 AND engagement_score <= 1.0),
    feedback_score FLOAT NOT NULL CHECK (feedback_score >= 0.0 AND feedback_score <= 1.0),
    confidence_score FLOAT NOT NULL CHECK (confidence_score >= 0.0 AND confidence_score <= 1.0),
    usage_count INTEGER NOT NULL DEFAULT 0,
    ability_usage_count INTEGER NOT NULL DEFAULT 0,
    perception_usage_count INTEGER NOT NULL DEFAULT 0,
    snapshot_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE memory_retrieval_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
    query_fingerprint TEXT NOT NULL,
    query_length INTEGER NOT NULL DEFAULT 0,
    similarity_threshold FLOAT NOT NULL DEFAULT 0.70 CHECK (similarity_threshold >= 0.0 AND similarity_threshold <= 1.0),
    max_results INTEGER NOT NULL DEFAULT 4,
    result_count INTEGER NOT NULL DEFAULT 0,
    top_similarity FLOAT,
    avg_similarity FLOAT,
    latency_ms INTEGER NOT NULL DEFAULT 0,
    selected_memory_ids JSONB NOT NULL DEFAULT '[]',
    used_in_response BOOLEAN NOT NULL DEFAULT false,
    retrieval_mode TEXT NOT NULL DEFAULT 'semantic_hybrid',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE memory_retrieval_judgments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES memory_retrieval_events(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    judgment_type TEXT NOT NULL CHECK (judgment_type IN ('positive', 'negative', 'neutral')),
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(event_id, user_id)
);

CREATE INDEX idx_adaptation_cycles_agent_created ON adaptation_cycles(agent_id, created_at DESC);
CREATE INDEX idx_trait_state_adaptation_enabled ON trait_state(adaptation_enabled);
CREATE INDEX idx_skill_rating_snapshots_agent_time ON skill_rating_snapshots(agent_id, snapshot_at DESC);
CREATE INDEX idx_skill_rating_snapshots_agent_skill_time ON skill_rating_snapshots(agent_id, skill_key, snapshot_at DESC);
CREATE INDEX idx_memory_retrieval_events_agent_time ON memory_retrieval_events(agent_id, created_at DESC);
CREATE INDEX idx_memory_retrieval_events_agent_used_time ON memory_retrieval_events(agent_id, used_in_response, created_at DESC);
CREATE INDEX idx_memory_retrieval_judgments_event ON memory_retrieval_judgments(event_id);
CREATE INDEX idx_memory_retrieval_judgments_user ON memory_retrieval_judgments(user_id);

-- Seed deterministic trait state for existing agents
INSERT INTO trait_state (agent_id)
SELECT a.id
FROM agents a
ON CONFLICT (agent_id) DO NOTHING;

-- Aggregate helper for dashboard-level retrieval quality summaries
CREATE OR REPLACE VIEW agent_memory_retrieval_summary AS
SELECT
    mre.agent_id,
    COUNT(*)::BIGINT AS total_events,
    COUNT(*) FILTER (WHERE mre.result_count = 0)::BIGINT AS no_hit_events,
    ROUND(AVG(mre.result_count)::numeric, 2)::FLOAT AS avg_result_count,
    ROUND(AVG(mre.top_similarity)::numeric, 4)::FLOAT AS avg_top_similarity,
    ROUND(AVG(mre.avg_similarity)::numeric, 4)::FLOAT AS avg_similarity,
    PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY mre.latency_ms)::FLOAT AS p95_latency_ms,
    MAX(mre.created_at) AS last_retrieval_at
FROM memory_retrieval_events mre
GROUP BY mre.agent_id;

ALTER TABLE adaptation_cycles ENABLE ROW LEVEL SECURITY;
ALTER TABLE trait_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE skill_rating_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE memory_retrieval_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE memory_retrieval_judgments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can access adaptation cycles for their agents"
ON adaptation_cycles FOR ALL USING (
    EXISTS (
        SELECT 1 FROM agents a
        WHERE a.id = adaptation_cycles.agent_id
          AND a.user_id = auth.uid()
    )
);

CREATE POLICY "Users can access trait state for their agents"
ON trait_state FOR ALL USING (
    EXISTS (
        SELECT 1 FROM agents a
        WHERE a.id = trait_state.agent_id
          AND a.user_id = auth.uid()
    )
);

CREATE POLICY "Users can access skill snapshots for their agents"
ON skill_rating_snapshots FOR ALL USING (
    EXISTS (
        SELECT 1 FROM agents a
        WHERE a.id = skill_rating_snapshots.agent_id
          AND a.user_id = auth.uid()
    )
);

CREATE POLICY "Users can access retrieval events for their agents"
ON memory_retrieval_events FOR ALL USING (
    EXISTS (
        SELECT 1 FROM agents a
        WHERE a.id = memory_retrieval_events.agent_id
          AND a.user_id = auth.uid()
    )
);

CREATE POLICY "Users can access retrieval judgments they create"
ON memory_retrieval_judgments FOR ALL USING (
    auth.uid() = user_id
    AND EXISTS (
        SELECT 1
        FROM memory_retrieval_events mre
        JOIN agents a ON a.id = mre.agent_id
        WHERE mre.id = memory_retrieval_judgments.event_id
          AND a.user_id = auth.uid()
    )
);

