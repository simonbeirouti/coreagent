-- CoreAgent Phase 3: Orchestration gap-fill updates
-- Migration: 016_orchestration_gap_fill_updates.sql
-- Purpose: Apply incremental schema/policy updates that were added after the initial 015 migration.

-- 1) Retry scheduling/failure metadata on orchestration_tasks
ALTER TABLE orchestration_tasks
    ADD COLUMN IF NOT EXISTS next_retry_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS last_failure_reason TEXT;

-- 2) Retry attempt hardening on orchestration_task_attempts
ALTER TABLE orchestration_task_attempts
    ADD COLUMN IF NOT EXISTS attempt_idempotency_key TEXT,
    ADD COLUMN IF NOT EXISTS backoff_seconds INTEGER;

UPDATE orchestration_task_attempts
SET
    attempt_idempotency_key = CONCAT('task:', task_id::text, ':attempt:', attempt_number::text),
    backoff_seconds = COALESCE(backoff_seconds, 0)
WHERE attempt_idempotency_key IS NULL
   OR btrim(attempt_idempotency_key) = ''
   OR backoff_seconds IS NULL;

ALTER TABLE orchestration_task_attempts
    ALTER COLUMN attempt_idempotency_key SET NOT NULL,
    ALTER COLUMN backoff_seconds SET DEFAULT 0,
    ALTER COLUMN backoff_seconds SET NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'orchestration_task_attempts_backoff_seconds_check'
          AND conrelid = 'public.orchestration_task_attempts'::regclass
    ) THEN
        ALTER TABLE orchestration_task_attempts
            ADD CONSTRAINT orchestration_task_attempts_backoff_seconds_check
            CHECK (backoff_seconds >= 0);
    END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_orchestration_task_attempts_attempt_idempotency_key
ON orchestration_task_attempts(attempt_idempotency_key);

CREATE INDEX IF NOT EXISTS idx_orchestration_task_attempts_status_created
ON orchestration_task_attempts(status, created_at DESC);

-- Replace the legacy status check so `scheduled` is valid.
DO $$
DECLARE
    constraint_row RECORD;
BEGIN
    FOR constraint_row IN
        SELECT c.conname
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        JOIN unnest(c.conkey) AS key_col(attnum) ON true
        JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = key_col.attnum
        WHERE n.nspname = 'public'
          AND t.relname = 'orchestration_task_attempts'
          AND c.contype = 'c'
          AND a.attname = 'status'
    LOOP
        EXECUTE format(
            'ALTER TABLE public.orchestration_task_attempts DROP CONSTRAINT IF EXISTS %I',
            constraint_row.conname
        );
    END LOOP;

    ALTER TABLE orchestration_task_attempts
        ADD CONSTRAINT orchestration_task_attempts_status_check
        CHECK (status IN ('scheduled', 'started', 'succeeded', 'failed', 'cancelled', 'timed_out'));
END;
$$;

-- 3) Orchestration memory topology table
CREATE TABLE IF NOT EXISTS orchestration_memories (
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

CREATE INDEX IF NOT EXISTS idx_orchestration_memories_run_scope_created
ON orchestration_memories(run_id, scope, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_orchestration_memories_agent_scope_created
ON orchestration_memories(agent_id, scope, created_at DESC);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_trigger
        WHERE tgname = 'update_orchestration_memories_updated_at'
          AND tgrelid = 'public.orchestration_memories'::regclass
    ) THEN
        CREATE TRIGGER update_orchestration_memories_updated_at
            BEFORE UPDATE ON orchestration_memories
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    END IF;
END;
$$;

ALTER TABLE orchestration_memories ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'orchestration_memories'
          AND policyname = 'Users can access orchestration memories through run ownership'
    ) THEN
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
    END IF;
END;
$$;

-- 4) Event retention helper used by scheduler maintenance
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
