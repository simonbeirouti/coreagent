-- ============================================================================
-- Skills Registry Service
-- ============================================================================

-- Canonical skill identity and high-level catalog metadata.
CREATE TABLE IF NOT EXISTS skills (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    skill_id TEXT NOT NULL UNIQUE,
    implementation_key TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'coreagent_registry',
    status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'deprecated', 'disabled')),
    risk_level TEXT NOT NULL DEFAULT 'moderate'
        CHECK (risk_level IN ('low', 'moderate', 'high')),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (btrim(skill_id) <> ''),
    CHECK (btrim(implementation_key) <> ''),
    CHECK (btrim(name) <> '')
);

-- Immutable versioned release metadata for each skill.
-- `digest` + `signature` are required for runtime integrity checks.
CREATE TABLE IF NOT EXISTS skill_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    skill_ref_id UUID NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
    version TEXT NOT NULL,
    runtime TEXT NOT NULL CHECK (runtime IN ('command', 'http', 'wasm')),
    entrypoint TEXT NOT NULL,
    manifest JSONB NOT NULL DEFAULT '{}'::jsonb,
    input_schema JSONB NOT NULL DEFAULT '{}'::jsonb,
    output_schema JSONB NOT NULL DEFAULT '{}'::jsonb,
    healthcheck JSONB NOT NULL DEFAULT '{}'::jsonb,
    heartbeat_policy JSONB NOT NULL DEFAULT '{}'::jsonb,
    artifact_uri TEXT,
    digest TEXT NOT NULL UNIQUE,
    signature TEXT NOT NULL,
    compatibility_min_app_version TEXT,
    compatibility_max_app_version TEXT,
    policy_status TEXT NOT NULL DEFAULT 'approved'
        CHECK (policy_status IN ('pending', 'approved', 'rejected', 'revoked')),
    published_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(skill_ref_id, version),
    CHECK (btrim(version) <> ''),
    CHECK (btrim(entrypoint) <> ''),
    CHECK (btrim(digest) <> ''),
    CHECK (btrim(signature) <> '')
);

-- Declared permission envelope per skill version.
-- Enforced at publish-time and runtime via policy/broker layers.
CREATE TABLE IF NOT EXISTS skill_permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    skill_version_id UUID NOT NULL REFERENCES skill_versions(id) ON DELETE CASCADE,
    permission_key TEXT NOT NULL,
    permission_scope JSONB NOT NULL DEFAULT '{}'::jsonb,
    required BOOLEAN NOT NULL DEFAULT true,
    risk_level TEXT NOT NULL DEFAULT 'moderate'
        CHECK (risk_level IN ('low', 'moderate', 'high')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(skill_version_id, permission_key),
    CHECK (btrim(permission_key) <> '')
);

-- Per-user install state and pinning.
-- `install_state` supports lifecycle transitions and degraded handling.
CREATE TABLE IF NOT EXISTS skill_installs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    skill_ref_id UUID NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
    pinned_version_id UUID REFERENCES skill_versions(id) ON DELETE SET NULL,
    installed_via TEXT NOT NULL DEFAULT 'catalog'
        CHECK (installed_via IN ('catalog', 'import', 'dev_mode')),
    install_state TEXT NOT NULL DEFAULT 'installed'
        CHECK (install_state IN ('pending', 'installed', 'failed', 'disabled', 'revoked')),
    auto_update BOOLEAN NOT NULL DEFAULT true,
    install_config JSONB NOT NULL DEFAULT '{}'::jsonb,
    last_error TEXT,
    installed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, skill_ref_id)
);

-- Per-invocation run history for observability, auditing, and replay safety.
-- `idempotency_key` can be used to deduplicate client retries.
CREATE TABLE IF NOT EXISTS skill_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
    skill_ref_id UUID NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
    skill_version_id UUID REFERENCES skill_versions(id) ON DELETE SET NULL,
    skill_install_id UUID REFERENCES skill_installs(id) ON DELETE SET NULL,
    idempotency_key TEXT,
    input_hash TEXT NOT NULL,
    output_summary TEXT,
    status TEXT NOT NULL
        CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'timed_out', 'cancelled')),
    latency_ms INTEGER CHECK (latency_ms >= 0),
    error_class TEXT,
    error_message TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    CHECK (btrim(input_hash) <> '')
);

-- Ensures idempotent run creation for callers that provide a stable key.
CREATE UNIQUE INDEX IF NOT EXISTS idx_skill_runs_user_idempotency
ON skill_runs(user_id, idempotency_key)
WHERE idempotency_key IS NOT NULL;

-- Time-series health snapshots used by diagnostics and SLO tracking.
CREATE TABLE IF NOT EXISTS skill_health_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
    skill_ref_id UUID NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
    skill_version_id UUID REFERENCES skill_versions(id) ON DELETE SET NULL,
    skill_install_id UUID REFERENCES skill_installs(id) ON DELETE SET NULL,
    status TEXT NOT NULL
        CHECK (status IN ('healthy', 'degraded', 'unhealthy', 'disabled', 'revoked')),
    summary TEXT,
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Advisory stream for warnings/revocations/security events.
-- Active advisories are those without `resolved_at`.
CREATE TABLE IF NOT EXISTS skill_advisories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    advisory_key TEXT NOT NULL UNIQUE,
    skill_ref_id UUID NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
    skill_version_id UUID REFERENCES skill_versions(id) ON DELETE SET NULL,
    advisory_type TEXT NOT NULL
        CHECK (advisory_type IN ('warning', 'revocation', 'deprecation', 'security')),
    severity TEXT NOT NULL
        CHECK (severity IN ('low', 'moderate', 'high', 'critical')),
    title TEXT NOT NULL,
    summary TEXT NOT NULL,
    external_url TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    published_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (btrim(advisory_key) <> ''),
    CHECK (btrim(title) <> '')
);

-- Publication lifecycle audit trail for each skill version.
CREATE TABLE IF NOT EXISTS skill_publication_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    skill_version_id UUID NOT NULL REFERENCES skill_versions(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL
        CHECK (event_type IN ('submitted', 'validated', 'approved', 'rejected', 'signed', 'published', 'revoked')),
    actor_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- Search/list performance indexes
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_skills_status_updated_at
ON skills(status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_skills_risk_updated_at
ON skills(risk_level, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_skills_implementation_key
ON skills(implementation_key);

CREATE INDEX IF NOT EXISTS idx_skill_versions_skill_published
ON skill_versions(skill_ref_id, published_at DESC);

CREATE INDEX IF NOT EXISTS idx_skill_versions_policy_status_published
ON skill_versions(policy_status, published_at DESC);

CREATE INDEX IF NOT EXISTS idx_skill_permissions_version
ON skill_permissions(skill_version_id);

CREATE INDEX IF NOT EXISTS idx_skill_permissions_key
ON skill_permissions(permission_key);

CREATE INDEX IF NOT EXISTS idx_skill_installs_user_state_updated
ON skill_installs(user_id, install_state, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_skill_installs_pinned_version
ON skill_installs(pinned_version_id);

CREATE INDEX IF NOT EXISTS idx_skill_runs_user_started
ON skill_runs(user_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_skill_runs_agent_started
ON skill_runs(agent_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_skill_runs_version_started
ON skill_runs(skill_version_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_skill_runs_status_started
ON skill_runs(status, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_skill_health_events_user_observed
ON skill_health_events(user_id, observed_at DESC);

CREATE INDEX IF NOT EXISTS idx_skill_health_events_skill_observed
ON skill_health_events(skill_ref_id, observed_at DESC);

CREATE INDEX IF NOT EXISTS idx_skill_advisories_skill_published
ON skill_advisories(skill_ref_id, published_at DESC);

CREATE INDEX IF NOT EXISTS idx_skill_advisories_active
ON skill_advisories(skill_ref_id, severity, published_at DESC)
WHERE resolved_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_skill_publication_events_version_created
ON skill_publication_events(skill_version_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Automatic timestamp maintenance
-- ---------------------------------------------------------------------------
CREATE TRIGGER update_skills_updated_at BEFORE UPDATE ON skills
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_skill_installs_updated_at BEFORE UPDATE ON skill_installs
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ---------------------------------------------------------------------------
-- Row Level Security (RLS)
-- ---------------------------------------------------------------------------
ALTER TABLE skills ENABLE ROW LEVEL SECURITY;
ALTER TABLE skill_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE skill_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE skill_installs ENABLE ROW LEVEL SECURITY;
ALTER TABLE skill_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE skill_health_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE skill_advisories ENABLE ROW LEVEL SECURITY;
ALTER TABLE skill_publication_events ENABLE ROW LEVEL SECURITY;

-- Catalog entities are readable by any authenticated user.
CREATE POLICY "Authenticated users can read skills catalog"
ON skills FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can read skill versions"
ON skill_versions FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can read skill permissions"
ON skill_permissions FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can read skill advisories"
ON skill_advisories FOR SELECT USING (auth.uid() IS NOT NULL);

-- Install records are strictly scoped to the installing user.
CREATE POLICY "Users can access their skill installs"
ON skill_installs FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "Users can create their skill installs"
ON skill_installs FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update their skill installs"
ON skill_installs FOR UPDATE USING (user_id = auth.uid());

CREATE POLICY "Users can delete their skill installs"
ON skill_installs FOR DELETE USING (user_id = auth.uid());

-- Runtime run/health records are strictly scoped to the owning user.
CREATE POLICY "Users can access their skill runs"
ON skill_runs FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "Users can create their skill runs"
ON skill_runs FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update their skill runs"
ON skill_runs FOR UPDATE USING (user_id = auth.uid());

CREATE POLICY "Users can access their skill health events"
ON skill_health_events FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "Users can create their skill health events"
ON skill_health_events FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update their skill health events"
ON skill_health_events FOR UPDATE USING (user_id = auth.uid());
