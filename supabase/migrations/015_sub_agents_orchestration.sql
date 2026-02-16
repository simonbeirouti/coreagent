-- CoreAgent Phase 3: Sub-agents orchestration foundation
-- Migration: 015_sub_agents_orchestration.sql

CREATE TABLE IF NOT EXISTS agent_delegations (
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

CREATE TABLE IF NOT EXISTS orchestration_runs (
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

CREATE TABLE IF NOT EXISTS orchestration_tasks (
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

CREATE UNIQUE INDEX IF NOT EXISTS idx_orchestration_tasks_run_idempotency
ON orchestration_tasks(run_id, idempotency_key)
WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS orchestration_task_attempts (
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

CREATE TABLE IF NOT EXISTS orchestration_delegations (
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

CREATE TABLE IF NOT EXISTS orchestration_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id UUID NOT NULL REFERENCES orchestration_runs(id) ON DELETE CASCADE,
    task_id UUID REFERENCES orchestration_tasks(id) ON DELETE SET NULL,
    event_type TEXT NOT NULL,
    severity TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'warning', 'error')),
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS orchestration_heartbeats (
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

CREATE TABLE IF NOT EXISTS orchestration_schedules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id UUID NOT NULL UNIQUE REFERENCES orchestration_runs(id) ON DELETE CASCADE,
    enabled BOOLEAN NOT NULL DEFAULT false,
    interval_minutes INTEGER NOT NULL DEFAULT 15 CHECK (interval_minutes >= 1 AND interval_minutes <= 1440),
    next_run_at TIMESTAMPTZ,
    last_run_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_delegations_parent_active
ON agent_delegations(parent_agent_id, is_active);

CREATE INDEX IF NOT EXISTS idx_orchestration_runs_parent_status_updated
ON orchestration_runs(parent_agent_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_orchestration_runs_owner_status_updated
ON orchestration_runs(owner_user_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_orchestration_tasks_run_order
ON orchestration_tasks(run_id, task_order, created_at);

CREATE INDEX IF NOT EXISTS idx_orchestration_tasks_run_status_updated
ON orchestration_tasks(run_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_orchestration_tasks_stale_detection
ON orchestration_tasks(status, last_heartbeat_at);

CREATE INDEX IF NOT EXISTS idx_orchestration_task_attempts_task_attempt
ON orchestration_task_attempts(task_id, attempt_number DESC);

CREATE INDEX IF NOT EXISTS idx_orchestration_task_attempts_status_created
ON orchestration_task_attempts(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_orchestration_delegations_run_created
ON orchestration_delegations(run_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_orchestration_events_run_created
ON orchestration_events(run_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_orchestration_events_task_created
ON orchestration_events(task_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_orchestration_heartbeats_run_updated
ON orchestration_heartbeats(run_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_orchestration_memories_run_scope_created
ON orchestration_memories(run_id, scope, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_orchestration_memories_agent_scope_created
ON orchestration_memories(agent_id, scope, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_orchestration_schedules_due
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
