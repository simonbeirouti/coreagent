-- CoreAgent Phase 2: Agent Identity and User Profile Enhancement
-- Migration: 003_agent_identity_and_user_profile.sql

-- 1. Extend agents table with identity fields
ALTER TABLE agents
ADD COLUMN mission TEXT,
ADD COLUMN values TEXT[],
ADD COLUMN behavioral_constraints JSONB DEFAULT '{}';

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

-- Update existing handle_new_user function to also create user_profiles
-- This merges with the trigger from migration 001 to avoid duplicate triggers
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
SET search_path = ''
AS $$
BEGIN
  -- Create profile entry (from migration 001)
  INSERT INTO public.profiles (id, created_at, updated_at, full_name)
  VALUES (NEW.id, timezone('utc'::text, now()), timezone('utc'::text, now()), NEW.raw_user_meta_data->>'full_name');
  
  -- Create user_profile entry (from migration 003)
  INSERT INTO public.user_profiles (user_id, preferences, habits, work_patterns)
  VALUES (
    NEW.id,
    '{"communication_style": "balanced", "language": "en", "timezone": "UTC"}'::jsonb,
    '{"feedback_style": "constructive"}'::jsonb,
    '{}'::jsonb
  );
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
