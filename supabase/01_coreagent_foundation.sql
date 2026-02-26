-- ============================================================================
-- Set up Storage Buckets for CoreAgent assets
-- ============================================================================

-- Avatars bucket (public read, owner-only write/update/delete)
insert into storage.buckets (id, name)
  values ('avatars', 'avatars');

-- Screenshots bucket (owner-only for all operations)
insert into storage.buckets (id, name)
  values ('screenshots', 'screenshots');

-- Audio bucket (owner-only for all operations)
insert into storage.buckets (id, name)
  values ('audio', 'audio');

-- User assets bucket (owner-only for all operations)
insert into storage.buckets (id, name)
  values ('user-files', 'user-files');

-- Set up access controls for storage.
-- Avatars bucket policies (public read, owner-only CRUD)
create policy "Avatar images are publicly accessible." on storage.objects
  for select using (bucket_id = 'avatars');

create policy "Users can upload their own avatar." on storage.objects
  for insert with check (
    bucket_id = 'avatars'
    and (select auth.uid())::text = (storage.foldername(name))[1]
  );

create policy "Users can update their own avatar." on storage.objects
  for update using (
    bucket_id = 'avatars'
    and (select auth.uid())::text = (storage.foldername(name))[1]
  );

create policy "Users can delete their own avatar." on storage.objects
  for delete using (
    bucket_id = 'avatars'
    and (select auth.uid())::text = (storage.foldername(name))[1]
  );

-- Screenshots bucket policies (owner-only)
create policy "Users can view their own screenshots." on storage.objects
  for select using (
    bucket_id = 'screenshots'
    and (select auth.uid())::text = (storage.foldername(name))[1]
  );

create policy "Users can upload their own screenshots." on storage.objects
  for insert with check (
    bucket_id = 'screenshots'
    and (select auth.uid())::text = (storage.foldername(name))[1]
  );

create policy "Users can update their own screenshots." on storage.objects
  for update using (
    bucket_id = 'screenshots'
    and (select auth.uid())::text = (storage.foldername(name))[1]
  );

create policy "Users can delete their own screenshots." on storage.objects
  for delete using (
    bucket_id = 'screenshots'
    and (select auth.uid())::text = (storage.foldername(name))[1]
  );

-- Audio bucket policies (owner-only)
create policy "Users can view their own audio files." on storage.objects
  for select using (
    bucket_id = 'audio'
    and (select auth.uid())::text = (storage.foldername(name))[1]
  );

create policy "Users can upload their own audio files." on storage.objects
  for insert with check (
    bucket_id = 'audio'
    and (select auth.uid())::text = (storage.foldername(name))[1]
  );

create policy "Users can update their own audio files." on storage.objects
  for update using (
    bucket_id = 'audio'
    and (select auth.uid())::text = (storage.foldername(name))[1]
  );

create policy "Users can delete their own audio files." on storage.objects
  for delete using (
    bucket_id = 'audio'
    and (select auth.uid())::text = (storage.foldername(name))[1]
  );

create policy "Users can view their own files." on storage.objects
  for select using (
    bucket_id = 'user-files'
    and (select auth.uid())::text = (storage.foldername(name))[1]
  );

create policy "Users can upload their own files." on storage.objects
  for insert with check (
    bucket_id = 'user-files'
    and (select auth.uid())::text = (storage.foldername(name))[1]
  );

create policy "Users can update their own files." on storage.objects
  for update using (
    bucket_id = 'user-files'
    and (select auth.uid())::text = (storage.foldername(name))[1]
  );

create policy "Users can delete their own files." on storage.objects
  for delete using (
    bucket_id = 'user-files'
    and (select auth.uid())::text = (storage.foldername(name))[1]
  );

-- user_files catalog tracks uploaded assets for filtering/listing.
-- Types were expanded to include both documents and image assets.
create table user_files (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  storage_path text not null unique,
  file_name text not null,
  file_ext text not null check (file_ext in ('txt', 'pdf', 'doc', 'csv', 'png', 'jpg', 'jpeg', 'gif', 'webp')),
  mime_type text not null,
  size_bytes bigint not null check (size_bytes >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_user_files_user_created_at
  on user_files (user_id, created_at desc);

create index idx_user_files_user_file_ext
  on user_files (user_id, file_ext);

alter table user_files enable row level security;

create policy "Users can view their own user files" on user_files
  for select using (auth.uid() = user_id);

create policy "Users can insert their own user files" on user_files
  for insert with check (auth.uid() = user_id);

create policy "Users can update their own user files" on user_files
  for update using (auth.uid() = user_id);

create policy "Users can delete their own user files" on user_files
  for delete using (auth.uid() = user_id);

-- ============================================================================
-- Agents and Conversations Schema
-- ============================================================================

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Agents table
CREATE TABLE agents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    persona TEXT NOT NULL, -- Agent personality description
    provider_type TEXT NOT NULL CHECK (provider_type IN ('openai', 'anthropic')),
    model_id TEXT NOT NULL,
    mission TEXT,
    values TEXT[],
    behavioral_constraints JSONB DEFAULT '{}',
    state TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'paused', 'stopped')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Conversations table
CREATE TABLE conversations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    title TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Messages table
CREATE TABLE messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
    content TEXT NOT NULL,
    message_type TEXT NOT NULL DEFAULT 'text' CHECK (message_type IN ('text', 'image', 'audio')),
    metadata JSONB DEFAULT '{}',
    parent_id UUID REFERENCES messages(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX idx_agents_user_id ON agents(user_id);
CREATE INDEX idx_agents_state ON agents(state);
CREATE INDEX idx_conversations_agent_id ON conversations(agent_id);
CREATE INDEX idx_conversations_user_id ON conversations(user_id);
CREATE INDEX idx_messages_conversation_id ON messages(conversation_id);
CREATE INDEX idx_messages_created_at ON messages(created_at);
CREATE INDEX idx_messages_parent_id ON messages(parent_id);

-- Row Level Security (RLS) Policies

-- Enable RLS on all tables
ALTER TABLE agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

-- Agents policies: Users can only access their own agents
CREATE POLICY "Users can view their own agents" ON agents
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own agents" ON agents
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own agents" ON agents
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own agents" ON agents
    FOR DELETE USING (auth.uid() = user_id);

-- Conversations policies: Users can only access conversations for their agents
CREATE POLICY "Users can view conversations for their agents" ON conversations
    FOR SELECT USING (
        auth.uid() = user_id OR
        EXISTS (
            SELECT 1 FROM agents
            WHERE agents.id = conversations.agent_id
            AND agents.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can insert conversations for their agents" ON conversations
    FOR INSERT WITH CHECK (
        auth.uid() = user_id AND
        EXISTS (
            SELECT 1 FROM agents
            WHERE agents.id = conversations.agent_id
            AND agents.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can update conversations for their agents" ON conversations
    FOR UPDATE USING (
        auth.uid() = user_id AND
        EXISTS (
            SELECT 1 FROM agents
            WHERE agents.id = conversations.agent_id
            AND agents.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can delete conversations for their agents" ON conversations
    FOR DELETE USING (
        auth.uid() = user_id AND
        EXISTS (
            SELECT 1 FROM agents
            WHERE agents.id = conversations.agent_id
            AND agents.user_id = auth.uid()
        )
    );

-- Messages policies: Users can only access messages in conversations they own
CREATE POLICY "Users can view messages in their conversations" ON messages
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM conversations
            WHERE conversations.id = messages.conversation_id
            AND (
                conversations.user_id = auth.uid() OR
                EXISTS (
                    SELECT 1 FROM agents
                    WHERE agents.id = conversations.agent_id
                    AND agents.user_id = auth.uid()
                )
            )
        )
    );

CREATE POLICY "Users can insert messages in their conversations" ON messages
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM conversations
            WHERE conversations.id = messages.conversation_id
            AND (
                conversations.user_id = auth.uid() OR
                EXISTS (
                    SELECT 1 FROM agents
                    WHERE agents.id = conversations.agent_id
                    AND agents.user_id = auth.uid()
                )
            )
        )
    );

-- Functions for updating timestamps
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Triggers for automatic timestamp updates
CREATE TRIGGER update_agents_updated_at BEFORE UPDATE ON agents
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_conversations_updated_at BEFORE UPDATE ON conversations
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_user_files_updated_at BEFORE UPDATE ON user_files
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- Agent Identity and User Profile Enhancement
-- ============================================================================

-- Add comment for documentation
COMMENT ON COLUMN agents.mission IS 'Agent''s purpose and objective';
COMMENT ON COLUMN agents.values IS 'Array of core values and principles the agent embodies';
COMMENT ON COLUMN agents.behavioral_constraints IS 'JSONB object containing rules and constraints the agent must follow';

-- 2. Create user_profiles table
CREATE TABLE user_profiles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
    preferences JSONB DEFAULT '{}',
    habits JSONB DEFAULT '{}',
    work_patterns JSONB DEFAULT '{}',
    language TEXT NOT NULL DEFAULT 'en',
    ai_response_language TEXT NOT NULL DEFAULT 'en',
    email TEXT,
    notifications_enabled BOOLEAN NOT NULL DEFAULT true,
    analytics_enabled BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add comments for documentation
COMMENT ON TABLE user_profiles IS 'User profile information including preferences, habits, and work patterns';
COMMENT ON COLUMN user_profiles.preferences IS 'Communication preferences, language, timezone, etc. Example: {"communication_style": "concise", "language": "en", "timezone": "UTC"}';
COMMENT ON COLUMN user_profiles.habits IS 'Usage patterns, preferred times, workflow habits. Example: {"preferred_hours": "9-17", "session_length": "short", "feedback_style": "direct"}';
COMMENT ON COLUMN user_profiles.work_patterns IS 'Professional context, domain expertise, common tasks. Example: {"domain": "software", "common_tasks": ["code review", "debugging"], "expertise": ["rust", "typescript"]}';

-- Create index for performance
CREATE INDEX idx_user_profiles_user_id ON user_profiles(user_id);
CREATE INDEX idx_user_profiles_email ON user_profiles(email);

-- Enable RLS on user_profiles table
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

-- User profiles policies: Users can only access their own profile
CREATE POLICY "Users can view their own profile" ON user_profiles
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own profile" ON user_profiles
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own profile" ON user_profiles
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own profile" ON user_profiles
    FOR DELETE USING (auth.uid() = user_id);

-- Trigger for automatic timestamp updates on user_profiles
CREATE TRIGGER update_user_profiles_updated_at BEFORE UPDATE ON user_profiles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- Perception Stats and Logs
-- ============================================================================

-- Track usage of core perception features
CREATE TABLE perception_stats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  feature_type TEXT NOT NULL CHECK (feature_type IN ('vision', 'audio')),
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

-- ============================================================================
-- User Profile Settings Enhancement
-- ============================================================================

COMMENT ON COLUMN user_profiles.language IS 'UI language preference (ISO 639-1 code)';
COMMENT ON COLUMN user_profiles.ai_response_language IS 'Language the AI should respond in (ISO 639-1 code)';
COMMENT ON COLUMN user_profiles.email IS 'Optional contact email used for product updates/notifications.';
COMMENT ON COLUMN user_profiles.notifications_enabled IS 'Whether notifications are enabled for the user';
COMMENT ON COLUMN user_profiles.analytics_enabled IS 'Whether the user has opted in to analytics';

-- 2. Update handle_new_user function to include new columns
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
SET search_path = ''
AS $$
BEGIN
  -- Create user_profile entry with all columns (updated from migration 003)
  INSERT INTO public.user_profiles (
    user_id,
    preferences,
    habits,
    work_patterns,
    language,
    ai_response_language,
    email,
    notifications_enabled,
    analytics_enabled
  )
  VALUES (
    NEW.id,
    '{"communication_style": "balanced", "timezone": "UTC"}'::jsonb,
    '{"feedback_style": "constructive", "session_length": "medium"}'::jsonb,
    '{}'::jsonb,
    'en',
    'en',
    NEW.email,
    true,
    false
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- 3. Create delete_user function to allow users to delete their own account
-- This function deletes the user from auth.users which cascades to all related data
CREATE OR REPLACE FUNCTION public.delete_user()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  DELETE FROM auth.users WHERE id = auth.uid();
$$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION public.delete_user() TO authenticated;

-- ============================================================================
-- Runtime Advisory Sync State
-- ============================================================================

CREATE TABLE advisory_sync_state (
    state_key TEXT PRIMARY KEY DEFAULT 'default',
    cursor TEXT,
    last_success_at TIMESTAMPTZ,
    last_attempt_at TIMESTAMPTZ,
    last_control_sync_at TIMESTAMPTZ,
    last_app_sync_at TIMESTAMPTZ,
    next_retry_at TIMESTAMPTZ,
    consecutive_failures INTEGER NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
    next_backoff_seconds INTEGER NOT NULL DEFAULT 0 CHECK (next_backoff_seconds >= 0),
    last_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (state_key = 'default')
);

CREATE TRIGGER update_advisory_sync_state_updated_at BEFORE UPDATE ON advisory_sync_state
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE advisory_sync_state IS 'Singleton checkpoint and health state for runtime advisory sync loops.';
COMMENT ON COLUMN advisory_sync_state.cursor IS 'Registry advisory feed cursor checkpoint for incremental sync.';
COMMENT ON COLUMN advisory_sync_state.last_success_at IS 'Timestamp of the most recent successful advisory sync.';
COMMENT ON COLUMN advisory_sync_state.last_control_sync_at IS 'Timestamp of last 30s control-plane style advisory poll.';
COMMENT ON COLUMN advisory_sync_state.last_app_sync_at IS 'Timestamp of last app cadence sync (foreground/background policy).';


-- ============================================================================
-- Message Branching Support
-- ============================================================================

-- RLS policies for UPDATE on messages (currently missing)
-- Users can update messages in their conversations
CREATE POLICY "Users can update messages in their conversations" ON messages
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM conversations
            WHERE conversations.id = messages.conversation_id
            AND (
                conversations.user_id = auth.uid() OR
                EXISTS (
                    SELECT 1 FROM agents
                    WHERE agents.id = conversations.agent_id
                    AND agents.user_id = auth.uid()
                )
            )
        )
    );

-- RLS policies for DELETE on messages (currently missing)
-- Users can delete messages in their conversations
CREATE POLICY "Users can delete messages in their conversations" ON messages
    FOR DELETE USING (
        EXISTS (
            SELECT 1 FROM conversations
            WHERE conversations.id = messages.conversation_id
            AND (
                conversations.user_id = auth.uid() OR
                EXISTS (
                    SELECT 1 FROM agents
                    WHERE agents.id = conversations.agent_id
                    AND agents.user_id = auth.uid()
                )
            )
        )
    );

-- Comment explaining the branching model
COMMENT ON COLUMN messages.parent_id IS 'References the parent message in the conversation tree. NULL for the first message. Multiple messages with the same parent_id represent branches (edits).';


-- ============================================================================
-- RAG Memory
-- ============================================================================

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

-- ============================================================================
-- Skill Proficiency Tracking
-- ============================================================================

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
    enabled BOOLEAN NOT NULL DEFAULT true,
    config JSONB NOT NULL DEFAULT '{}'::jsonb,
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

-- ============================================================================
-- Feedback System
-- ============================================================================

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

-- ============================================================================
-- Hits and Retrieval Observability
-- ============================================================================

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
    helpfulness FLOAT NOT NULL CHECK (helpfulness >= 0.0 AND helpfulness <= 1.0),
    formality FLOAT NOT NULL CHECK (formality >= 0.0 AND formality <= 1.0),
    verbosity FLOAT NOT NULL CHECK (verbosity >= 0.0 AND verbosity <= 1.0),
    proactivity FLOAT NOT NULL CHECK (proactivity >= 0.0 AND proactivity <= 1.0),
    creativity FLOAT NOT NULL CHECK (creativity >= 0.0 AND creativity <= 1.0),
    empathy FLOAT NOT NULL CHECK (empathy >= 0.0 AND empathy <= 1.0),
    adaptation_enabled BOOLEAN NOT NULL DEFAULT true,
    baseline_source TEXT NOT NULL DEFAULT 'legacy_midpoint',
    baseline_version TEXT NOT NULL DEFAULT 'v1',
    baseline_context JSONB NOT NULL DEFAULT '{}',
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

-- Aggregate helper for dashboard-level retrieval quality summaries
CREATE OR REPLACE VIEW agent_memory_retrieval_summary
WITH (security_invoker = true) AS
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

REVOKE ALL ON TABLE agent_memory_retrieval_summary FROM PUBLIC;
REVOKE ALL ON TABLE agent_memory_retrieval_summary FROM anon;
GRANT SELECT ON TABLE agent_memory_retrieval_summary TO authenticated;

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

-- ============================================================================
-- Retrieval Tuning State and Events
-- ============================================================================

CREATE TABLE retrieval_tuning_state (
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

CREATE TABLE retrieval_tuning_events (
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

CREATE INDEX idx_retrieval_tuning_events_agent_time
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

-- ============================================================================
-- Two-Layer Message Quality Feedback
-- ============================================================================

CREATE TABLE message_quality_labels (
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

CREATE TABLE message_quality_user_ratings (
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

CREATE TABLE message_quality_reconciliation (
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

CREATE INDEX idx_message_quality_labels_agent_time
ON message_quality_labels(agent_id, created_at DESC);

CREATE INDEX idx_message_quality_labels_status_time
ON message_quality_labels(status, created_at DESC);

CREATE INDEX idx_message_quality_user_ratings_agent_time
ON message_quality_user_ratings(agent_id, created_at DESC);

CREATE INDEX idx_message_quality_user_ratings_message
ON message_quality_user_ratings(message_id);

CREATE INDEX idx_message_quality_reconciliation_agent_time
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

-- ============================================================================
-- Sub-agents Orchestration
-- ============================================================================

CREATE TABLE agent_delegations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    parent_agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    child_agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('planner', 'researcher', 'executor', 'reviewer', 'custom')),
    ownership_scope TEXT NOT NULL DEFAULT 'delegated' CHECK (ownership_scope IN ('delegated', 'shared', 'observer')),
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_by_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(parent_agent_id, child_agent_id),
    CHECK (parent_agent_id <> child_agent_id)
);

CREATE TABLE orchestration_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    parent_agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    owner_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    objective TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued', 'planned', 'in_progress', 'waiting', 'completed', 'failed', 'cancelled', 'paused')),
    priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high')),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    last_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE orchestration_tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id UUID NOT NULL REFERENCES orchestration_runs(id) ON DELETE CASCADE,
    parent_task_id UUID REFERENCES orchestration_tasks(id) ON DELETE SET NULL,
    owner_agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued', 'planned', 'in_progress', 'waiting', 'completed', 'failed', 'cancelled', 'paused')),
    task_order INTEGER NOT NULL DEFAULT 0,
    idempotency_key TEXT,
    attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    max_retries INTEGER NOT NULL DEFAULT 3 CHECK (max_retries >= 0 AND max_retries <= 10),
    next_retry_at TIMESTAMPTZ,
    last_failure_reason TEXT,
    last_heartbeat_at TIMESTAMPTZ,
    heartbeat_status TEXT,
    heartbeat_progress FLOAT NOT NULL DEFAULT 0.0 CHECK (heartbeat_progress >= 0.0 AND heartbeat_progress <= 1.0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_orchestration_tasks_run_idempotency
ON orchestration_tasks(run_id, idempotency_key)
WHERE idempotency_key IS NOT NULL;

CREATE TABLE orchestration_task_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id UUID NOT NULL REFERENCES orchestration_runs(id) ON DELETE CASCADE,
    task_id UUID NOT NULL REFERENCES orchestration_tasks(id) ON DELETE CASCADE,
    attempt_number INTEGER NOT NULL CHECK (attempt_number >= 1),
    attempt_idempotency_key TEXT NOT NULL,
    executor_agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK (status IN ('scheduled', 'started', 'succeeded', 'failed', 'cancelled', 'timed_out')),
    backoff_seconds INTEGER NOT NULL DEFAULT 0 CHECK (backoff_seconds >= 0),
    error_class TEXT,
    error_message TEXT,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ended_at TIMESTAMPTZ,
    latency_ms INTEGER CHECK (latency_ms >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(task_id, attempt_number),
    UNIQUE(attempt_idempotency_key)
);

CREATE TABLE orchestration_delegations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id UUID NOT NULL REFERENCES orchestration_runs(id) ON DELETE CASCADE,
    task_id UUID NOT NULL REFERENCES orchestration_tasks(id) ON DELETE CASCADE,
    from_agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    to_agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    policy_decision TEXT NOT NULL CHECK (policy_decision IN ('allowed', 'blocked', 'manual_override')),
    policy_reason TEXT,
    handoff_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (from_agent_id <> to_agent_id)
);

CREATE TABLE orchestration_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id UUID NOT NULL REFERENCES orchestration_runs(id) ON DELETE CASCADE,
    task_id UUID REFERENCES orchestration_tasks(id) ON DELETE SET NULL,
    event_type TEXT NOT NULL,
    severity TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'warning', 'error')),
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE orchestration_heartbeats (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id UUID NOT NULL REFERENCES orchestration_runs(id) ON DELETE CASCADE,
    task_id UUID NOT NULL REFERENCES orchestration_tasks(id) ON DELETE CASCADE,
    agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    status TEXT NOT NULL,
    progress FLOAT NOT NULL DEFAULT 0.0 CHECK (progress >= 0.0 AND progress <= 1.0),
    summary TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(run_id, task_id, agent_id)
);

CREATE TABLE orchestration_memories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id UUID NOT NULL REFERENCES orchestration_runs(id) ON DELETE CASCADE,
    task_id UUID REFERENCES orchestration_tasks(id) ON DELETE SET NULL,
    agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    scope TEXT NOT NULL CHECK (scope IN ('private', 'shared_run', 'parent_visible')),
    key TEXT NOT NULL,
    summary TEXT,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    promoted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(run_id, agent_id, scope, key)
);

CREATE TABLE orchestration_schedules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id UUID NOT NULL UNIQUE REFERENCES orchestration_runs(id) ON DELETE CASCADE,
    enabled BOOLEAN NOT NULL DEFAULT false,
    interval_minutes INTEGER NOT NULL DEFAULT 15 CHECK (interval_minutes >= 1 AND interval_minutes <= 1440),
    next_run_at TIMESTAMPTZ,
    last_run_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_agent_delegations_parent_active
ON agent_delegations(parent_agent_id, is_active);

CREATE INDEX idx_orchestration_runs_parent_status_updated
ON orchestration_runs(parent_agent_id, status, updated_at DESC);

CREATE INDEX idx_orchestration_runs_owner_status_updated
ON orchestration_runs(owner_user_id, status, updated_at DESC);

CREATE INDEX idx_orchestration_tasks_run_order
ON orchestration_tasks(run_id, task_order, created_at);

CREATE INDEX idx_orchestration_tasks_run_status_updated
ON orchestration_tasks(run_id, status, updated_at DESC);

CREATE INDEX idx_orchestration_tasks_stale_detection
ON orchestration_tasks(status, last_heartbeat_at);

CREATE INDEX idx_orchestration_task_attempts_task_attempt
ON orchestration_task_attempts(task_id, attempt_number DESC);

CREATE INDEX idx_orchestration_task_attempts_status_created
ON orchestration_task_attempts(status, created_at DESC);

CREATE INDEX idx_orchestration_delegations_run_created
ON orchestration_delegations(run_id, created_at DESC);

CREATE INDEX idx_orchestration_events_run_created
ON orchestration_events(run_id, created_at DESC);

CREATE INDEX idx_orchestration_events_task_created
ON orchestration_events(task_id, created_at DESC);

CREATE INDEX idx_orchestration_heartbeats_run_updated
ON orchestration_heartbeats(run_id, updated_at DESC);

CREATE INDEX idx_orchestration_memories_run_scope_created
ON orchestration_memories(run_id, scope, created_at DESC);

CREATE INDEX idx_orchestration_memories_agent_scope_created
ON orchestration_memories(agent_id, scope, created_at DESC);

CREATE INDEX idx_orchestration_schedules_due
ON orchestration_schedules(enabled, next_run_at);

CREATE TRIGGER update_agent_delegations_updated_at BEFORE UPDATE ON agent_delegations
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_orchestration_runs_updated_at BEFORE UPDATE ON orchestration_runs
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_orchestration_tasks_updated_at BEFORE UPDATE ON orchestration_tasks
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_orchestration_memories_updated_at BEFORE UPDATE ON orchestration_memories
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_orchestration_schedules_updated_at BEFORE UPDATE ON orchestration_schedules
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE agent_delegations ENABLE ROW LEVEL SECURITY;
ALTER TABLE orchestration_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE orchestration_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE orchestration_task_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE orchestration_delegations ENABLE ROW LEVEL SECURITY;
ALTER TABLE orchestration_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE orchestration_heartbeats ENABLE ROW LEVEL SECURITY;
ALTER TABLE orchestration_memories ENABLE ROW LEVEL SECURITY;
ALTER TABLE orchestration_schedules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can access their agent delegations"
ON agent_delegations FOR ALL USING (
    EXISTS (
        SELECT 1
        FROM agents a
        WHERE a.id = agent_delegations.parent_agent_id
          AND a.user_id = auth.uid()
    )
);

CREATE POLICY "Users can access orchestration runs for their agents"
ON orchestration_runs FOR ALL USING (
    orchestration_runs.owner_user_id = auth.uid()
    OR EXISTS (
        SELECT 1
        FROM agents a
        WHERE a.id = orchestration_runs.parent_agent_id
          AND a.user_id = auth.uid()
    )
);

CREATE POLICY "Users can access orchestration tasks through run ownership"
ON orchestration_tasks FOR ALL USING (
    EXISTS (
        SELECT 1
        FROM orchestration_runs r
        WHERE r.id = orchestration_tasks.run_id
          AND (
            r.owner_user_id = auth.uid()
            OR EXISTS (
                SELECT 1
                FROM agents a
                WHERE a.id = r.parent_agent_id
                  AND a.user_id = auth.uid()
            )
          )
    )
);

CREATE POLICY "Users can access orchestration task attempts through run ownership"
ON orchestration_task_attempts FOR ALL USING (
    EXISTS (
        SELECT 1
        FROM orchestration_runs r
        WHERE r.id = orchestration_task_attempts.run_id
          AND (
            r.owner_user_id = auth.uid()
            OR EXISTS (
                SELECT 1
                FROM agents a
                WHERE a.id = r.parent_agent_id
                  AND a.user_id = auth.uid()
            )
          )
    )
);

CREATE POLICY "Users can access orchestration delegations through run ownership"
ON orchestration_delegations FOR ALL USING (
    EXISTS (
        SELECT 1
        FROM orchestration_runs r
        WHERE r.id = orchestration_delegations.run_id
          AND (
            r.owner_user_id = auth.uid()
            OR EXISTS (
                SELECT 1
                FROM agents a
                WHERE a.id = r.parent_agent_id
                  AND a.user_id = auth.uid()
            )
          )
    )
);

CREATE POLICY "Users can access orchestration events through run ownership"
ON orchestration_events FOR ALL USING (
    EXISTS (
        SELECT 1
        FROM orchestration_runs r
        WHERE r.id = orchestration_events.run_id
          AND (
            r.owner_user_id = auth.uid()
            OR EXISTS (
                SELECT 1
                FROM agents a
                WHERE a.id = r.parent_agent_id
                  AND a.user_id = auth.uid()
            )
          )
    )
);

CREATE POLICY "Users can access orchestration heartbeats through run ownership"
ON orchestration_heartbeats FOR ALL USING (
    EXISTS (
        SELECT 1
        FROM orchestration_runs r
        WHERE r.id = orchestration_heartbeats.run_id
          AND (
            r.owner_user_id = auth.uid()
            OR EXISTS (
                SELECT 1
                FROM agents a
                WHERE a.id = r.parent_agent_id
                  AND a.user_id = auth.uid()
            )
          )
    )
);

CREATE POLICY "Users can access orchestration memories through run ownership"
ON orchestration_memories FOR ALL USING (
    EXISTS (
        SELECT 1
        FROM orchestration_runs r
        WHERE r.id = orchestration_memories.run_id
          AND (
            r.owner_user_id = auth.uid()
            OR EXISTS (
                SELECT 1
                FROM agents a
                WHERE a.id = r.parent_agent_id
                  AND a.user_id = auth.uid()
            )
          )
    )
);

CREATE POLICY "Users can access orchestration schedules through run ownership"
ON orchestration_schedules FOR ALL USING (
    EXISTS (
        SELECT 1
        FROM orchestration_runs r
        WHERE r.id = orchestration_schedules.run_id
          AND (
            r.owner_user_id = auth.uid()
            OR EXISTS (
                SELECT 1
                FROM agents a
                WHERE a.id = r.parent_agent_id
                  AND a.user_id = auth.uid()
            )
          )
    )
);

-- ============================================================================
-- Skills Graph Snapshots
-- ============================================================================

-- Skills graph snapshots for user/team scopes.
CREATE TABLE skills_graphs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_type TEXT NOT NULL CHECK (owner_type IN ('user', 'team', 'agent')),
  owner_id UUID NOT NULL,
  graph_jsonb JSONB NOT NULL DEFAULT '{"nodes":[],"edges":[],"viewport":{}}'::jsonb,
  version INTEGER NOT NULL DEFAULT 1,
  created_by_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (owner_type, owner_id)
);

CREATE INDEX idx_skills_graphs_owner ON skills_graphs(owner_type, owner_id);

ALTER TABLE skills_graphs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own graphs" ON skills_graphs
  FOR SELECT USING (
    (owner_type = 'user' AND owner_id = auth.uid())
    OR (
      owner_type = 'agent'
      AND EXISTS (
        SELECT 1 FROM agents a
        WHERE a.id = owner_id
          AND a.user_id = auth.uid()
      )
    )
  );

CREATE POLICY "Users can write own user graphs" ON skills_graphs
  FOR INSERT WITH CHECK (
    (
      owner_type = 'user' AND owner_id = auth.uid() AND created_by_user_id = auth.uid()
    )
    OR (
      owner_type = 'agent'
      AND created_by_user_id = auth.uid()
      AND EXISTS (
        SELECT 1 FROM agents a
        WHERE a.id = owner_id
          AND a.user_id = auth.uid()
      )
    )
  );

CREATE POLICY "Users can update own user graphs" ON skills_graphs
  FOR UPDATE USING (
    (owner_type = 'user' AND owner_id = auth.uid())
    OR (
      owner_type = 'agent'
      AND EXISTS (
        SELECT 1 FROM agents a
        WHERE a.id = owner_id
          AND a.user_id = auth.uid()
      )
    )
  );

CREATE TRIGGER update_skills_graphs_updated_at
  BEFORE UPDATE ON skills_graphs
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Helper for periodic retention in scheduler/admin maintenance jobs.
CREATE OR REPLACE FUNCTION purge_old_orchestration_events(retention_days integer DEFAULT 30)
RETURNS bigint
LANGUAGE plpgsql
AS $$
DECLARE
    deleted_count bigint;
BEGIN
    DELETE FROM orchestration_events
    WHERE created_at < NOW() - ((GREATEST(retention_days, 1)::text || ' days')::interval);
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$;

