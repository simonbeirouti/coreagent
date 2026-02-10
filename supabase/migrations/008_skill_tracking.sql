-- CoreAgent Phase 2: Skill Proficiency Tracking
-- Migration: 008_skill_tracking.sql

CREATE TABLE abilities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    category TEXT NOT NULL CHECK (category IN ('perception', 'communication', 'memory', 'automation', 'productivity')),
    implementation_key TEXT NOT NULL UNIQUE,
    is_premium BOOLEAN NOT NULL DEFAULT false,
    parameters_schema JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE agent_abilities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    ability_id UUID NOT NULL REFERENCES abilities(id) ON DELETE CASCADE,
    acquired_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    usage_count INTEGER NOT NULL DEFAULT 0,
    success_count INTEGER NOT NULL DEFAULT 0,
    proficiency FLOAT NOT NULL DEFAULT 0.0 CHECK (proficiency >= 0.0 AND proficiency <= 1.0),
    last_used_at TIMESTAMPTZ,
    UNIQUE(agent_id, ability_id)
);

CREATE INDEX idx_abilities_category ON abilities(category);
CREATE INDEX idx_agent_abilities_agent_id ON agent_abilities(agent_id);
CREATE INDEX idx_agent_abilities_ability_id ON agent_abilities(ability_id);
CREATE INDEX idx_agent_abilities_last_used_at ON agent_abilities(last_used_at);

-- Seed baseline abilities
INSERT INTO abilities (name, description, category, implementation_key)
VALUES
    ('Conversation', 'General text conversation handling', 'communication', 'conversation'),
    ('Vision Screenshot', 'Capture and analyze screenshots', 'perception', 'vision_screenshot'),
    ('Vision Analysis', 'Analyze user-provided images', 'perception', 'vision_analysis'),
    ('Audio Transcription', 'Transcribe voice to text', 'communication', 'audio_transcription'),
    ('Voice Synthesis', 'Generate audio responses', 'communication', 'voice_synthesis'),
    ('Memory Retrieval', 'Semantic memory lookup for prior context', 'memory', 'memory_retrieval')
ON CONFLICT (name) DO NOTHING;

-- RLS
ALTER TABLE abilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_abilities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read abilities"
ON abilities FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "Users can access their agent abilities"
ON agent_abilities FOR ALL USING (
    EXISTS (
        SELECT 1 FROM agents a
        WHERE a.id = agent_abilities.agent_id
          AND a.user_id = auth.uid()
    )
);

