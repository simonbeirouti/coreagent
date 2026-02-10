-- CoreAgent Phase 3: User Profile Settings Enhancement
-- Migration: 005_user_profile_settings.sql

-- 1. Add explicit columns for settings that need to be queryable
ALTER TABLE user_profiles
ADD COLUMN language TEXT NOT NULL DEFAULT 'en',
ADD COLUMN ai_response_language TEXT NOT NULL DEFAULT 'en',
ADD COLUMN notifications_enabled BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN analytics_enabled BOOLEAN NOT NULL DEFAULT false;

-- Add comments for documentation
COMMENT ON COLUMN user_profiles.language IS 'UI language preference (ISO 639-1 code)';
COMMENT ON COLUMN user_profiles.ai_response_language IS 'Language the AI should respond in (ISO 639-1 code)';
COMMENT ON COLUMN user_profiles.notifications_enabled IS 'Whether notifications are enabled for the user';
COMMENT ON COLUMN user_profiles.analytics_enabled IS 'Whether the user has opted in to analytics';

-- 2. Update handle_new_user function to include new columns
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
SET search_path = ''
AS $$
BEGIN
  -- Create profile entry (from migration 001)
  INSERT INTO public.profiles (id, created_at, updated_at, full_name)
  VALUES (NEW.id, timezone('utc'::text, now()), timezone('utc'::text, now()), NEW.raw_user_meta_data->>'full_name');
  
  -- Create user_profile entry with all columns (updated from migration 003)
  INSERT INTO public.user_profiles (
    user_id,
    preferences,
    habits,
    work_patterns,
    language,
    ai_response_language,
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
    true,
    false
  );
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

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
