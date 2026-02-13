-- CoreAgent Phase 3: Agent ability runtime toggles and configuration
-- Migration: 014_agent_ability_toggles_and_config.sql

ALTER TABLE agent_abilities
    ADD COLUMN IF NOT EXISTS enabled BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN IF NOT EXISTS config JSONB NOT NULL DEFAULT '{}'::jsonb;

UPDATE agent_abilities
SET enabled = true
WHERE enabled IS DISTINCT FROM true;

UPDATE agent_abilities
SET config = '{}'::jsonb
WHERE config IS NULL;
