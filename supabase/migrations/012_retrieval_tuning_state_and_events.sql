-- CoreAgent Phase 2 hardening: retrieval threshold tuning state + audit log
-- Migration: 012_retrieval_tuning_state_and_events.sql

CREATE TABLE IF NOT EXISTS retrieval_tuning_state (
    agent_id UUID PRIMARY KEY REFERENCES agents(id) ON DELETE CASCADE,
    similarity_threshold FLOAT NOT NULL DEFAULT 0.70 CHECK (similarity_threshold >= 0.0 AND similarity_threshold <= 1.0),
    min_threshold FLOAT NOT NULL DEFAULT 0.55 CHECK (min_threshold >= 0.0 AND min_threshold <= 1.0),
    max_threshold FLOAT NOT NULL DEFAULT 0.90 CHECK (max_threshold >= 0.0 AND max_threshold <= 1.0),
    last_tuned_at TIMESTAMPTZ,
    last_decision_reason TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (min_threshold <= max_threshold),
    CHECK (similarity_threshold >= min_threshold AND similarity_threshold <= max_threshold)
);

CREATE TABLE IF NOT EXISTS retrieval_tuning_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    previous_threshold FLOAT NOT NULL CHECK (previous_threshold >= 0.0 AND previous_threshold <= 1.0),
    next_threshold FLOAT NOT NULL CHECK (next_threshold >= 0.0 AND next_threshold <= 1.0),
    status TEXT NOT NULL DEFAULT 'skipped' CHECK (status IN ('applied', 'skipped')),
    reason TEXT,
    quality_summary JSONB NOT NULL DEFAULT '{}',
    guardrail_flags JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_retrieval_tuning_events_agent_time
ON retrieval_tuning_events(agent_id, created_at DESC);

INSERT INTO retrieval_tuning_state (agent_id)
SELECT a.id
FROM agents a
ON CONFLICT (agent_id) DO NOTHING;

ALTER TABLE retrieval_tuning_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE retrieval_tuning_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can access retrieval tuning state for their agents"
ON retrieval_tuning_state FOR ALL USING (
    EXISTS (
        SELECT 1 FROM agents a
        WHERE a.id = retrieval_tuning_state.agent_id
          AND a.user_id = auth.uid()
    )
);

CREATE POLICY "Users can access retrieval tuning events for their agents"
ON retrieval_tuning_events FOR ALL USING (
    EXISTS (
        SELECT 1 FROM agents a
        WHERE a.id = retrieval_tuning_events.agent_id
          AND a.user_id = auth.uid()
    )
);
