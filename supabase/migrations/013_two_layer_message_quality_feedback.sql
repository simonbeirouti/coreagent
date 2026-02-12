-- CoreAgent two-layer quality model:
-- - orchestrator labels (continuous 0..1)
-- - user per-dimension ratings (up/down)
-- - reconciled effective dimension signals

CREATE TABLE IF NOT EXISTS message_quality_labels (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id UUID NOT NULL UNIQUE REFERENCES messages(id) ON DELETE CASCADE,
    agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    tone_score FLOAT NOT NULL CHECK (tone_score >= 0.0 AND tone_score <= 1.0),
    verbosity_score FLOAT NOT NULL CHECK (verbosity_score >= 0.0 AND verbosity_score <= 1.0),
    helpfulness_score FLOAT NOT NULL CHECK (helpfulness_score >= 0.0 AND helpfulness_score <= 1.0),
    accuracy_score FLOAT NOT NULL CHECK (accuracy_score >= 0.0 AND accuracy_score <= 1.0),
    confidence FLOAT NOT NULL DEFAULT 0.5 CHECK (confidence >= 0.0 AND confidence <= 1.0),
    orchestrator_version TEXT NOT NULL DEFAULT 'heuristic_v1',
    status TEXT NOT NULL DEFAULT 'scored' CHECK (status IN ('pending', 'scored', 'reconciled', 'failed')),
    rationale JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS message_quality_user_ratings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    dimension TEXT NOT NULL CHECK (dimension IN ('tone', 'verbosity', 'helpfulness', 'accuracy')),
    rating TEXT NOT NULL CHECK (rating IN ('up', 'down')),
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(message_id, user_id, dimension)
);

CREATE TABLE IF NOT EXISTS message_quality_reconciliation (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id UUID NOT NULL UNIQUE REFERENCES messages(id) ON DELETE CASCADE,
    agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    effective_tone_score FLOAT NOT NULL CHECK (effective_tone_score >= 0.0 AND effective_tone_score <= 1.0),
    effective_verbosity_score FLOAT NOT NULL CHECK (effective_verbosity_score >= 0.0 AND effective_verbosity_score <= 1.0),
    effective_helpfulness_score FLOAT NOT NULL CHECK (effective_helpfulness_score >= 0.0 AND effective_helpfulness_score <= 1.0),
    effective_accuracy_score FLOAT NOT NULL CHECK (effective_accuracy_score >= 0.0 AND effective_accuracy_score <= 1.0),
    source_mix JSONB NOT NULL DEFAULT '{}',
    provenance TEXT NOT NULL DEFAULT 'agent_only' CHECK (provenance IN ('user_override', 'weighted_blend', 'agent_only', 'heuristic_fallback')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_message_quality_labels_agent_time
ON message_quality_labels(agent_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_message_quality_labels_status_time
ON message_quality_labels(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_message_quality_user_ratings_agent_time
ON message_quality_user_ratings(agent_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_message_quality_user_ratings_message
ON message_quality_user_ratings(message_id);

CREATE INDEX IF NOT EXISTS idx_message_quality_reconciliation_agent_time
ON message_quality_reconciliation(agent_id, created_at DESC);

ALTER TABLE message_quality_labels ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_quality_user_ratings ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_quality_reconciliation ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can access quality labels for their agents"
ON message_quality_labels FOR ALL USING (
    EXISTS (
        SELECT 1 FROM agents a
        WHERE a.id = message_quality_labels.agent_id
          AND a.user_id = auth.uid()
    )
);

CREATE POLICY "Users can access quality user ratings for their agents"
ON message_quality_user_ratings FOR ALL USING (
    EXISTS (
        SELECT 1 FROM agents a
        WHERE a.id = message_quality_user_ratings.agent_id
          AND a.user_id = auth.uid()
    )
);

CREATE POLICY "Users can access quality reconciliation for their agents"
ON message_quality_reconciliation FOR ALL USING (
    EXISTS (
        SELECT 1 FROM agents a
        WHERE a.id = message_quality_reconciliation.agent_id
          AND a.user_id = auth.uid()
    )
);
