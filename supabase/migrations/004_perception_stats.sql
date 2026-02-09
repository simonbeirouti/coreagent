-- Track usage of core perception features
CREATE TABLE perception_stats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  feature_type TEXT NOT NULL CHECK (feature_type IN ('vision', 'audio', 'browser')),
  action TEXT NOT NULL,
  usage_count INTEGER DEFAULT 1,
  last_used_at TIMESTAMPTZ DEFAULT NOW(),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(agent_id, feature_type, action)
);

CREATE INDEX idx_perception_stats_agent ON perception_stats(agent_id);
CREATE INDEX idx_perception_stats_feature ON perception_stats(feature_type);

-- Perception logs for storing actual perception data
CREATE TABLE perception_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  perception_type TEXT NOT NULL CHECK (perception_type IN ('screenshot', 'camera', 'audio_recording', 'transcription', 'tts_output')),
  storage_path TEXT NOT NULL,
  analysis_result JSONB,
  duration_ms INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_perception_logs_agent ON perception_logs(agent_id);
CREATE INDEX idx_perception_logs_conversation ON perception_logs(conversation_id);

-- RLS policies
ALTER TABLE perception_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE perception_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can access their perception stats"
ON perception_stats FOR ALL USING (
  agent_id IN (SELECT id FROM agents WHERE user_id = auth.uid())
);

CREATE POLICY "Users can access their perception logs"
ON perception_logs FOR ALL USING (
  agent_id IN (SELECT id FROM agents WHERE user_id = auth.uid())
);