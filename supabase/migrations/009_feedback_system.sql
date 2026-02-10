-- CoreAgent Phase 2: Feedback Loops
-- Migration: 009_feedback_system.sql

CREATE TABLE message_feedback (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    feedback_type TEXT NOT NULL CHECK (feedback_type IN ('positive', 'negative', 'neutral')),
    feedback_category TEXT CHECK (feedback_category IN ('helpfulness', 'accuracy', 'tone', 'verbosity')),
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(message_id, user_id)
);

CREATE TABLE personality_adjustments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    trait_name TEXT NOT NULL,
    old_value FLOAT NOT NULL,
    new_value FLOAT NOT NULL,
    reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_message_feedback_message_id ON message_feedback(message_id);
CREATE INDEX idx_message_feedback_user_id ON message_feedback(user_id);
CREATE INDEX idx_personality_adjustments_agent_id ON personality_adjustments(agent_id);
CREATE INDEX idx_personality_adjustments_created_at ON personality_adjustments(created_at);

-- RLS
ALTER TABLE message_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE personality_adjustments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can access their own message feedback"
ON message_feedback FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users can access personality adjustments for their agents"
ON personality_adjustments FOR ALL USING (
    EXISTS (
        SELECT 1 FROM agents a
        WHERE a.id = personality_adjustments.agent_id
          AND a.user_id = auth.uid()
    )
);

