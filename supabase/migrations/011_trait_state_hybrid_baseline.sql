-- CoreAgent Phase 2 hardening: trait baseline provenance + non-defaulted trait inserts
-- Migration: 011_trait_state_hybrid_baseline.sql

ALTER TABLE trait_state
ADD COLUMN IF NOT EXISTS baseline_source TEXT NOT NULL DEFAULT 'legacy_midpoint',
ADD COLUMN IF NOT EXISTS baseline_version TEXT NOT NULL DEFAULT 'v1',
ADD COLUMN IF NOT EXISTS baseline_context JSONB NOT NULL DEFAULT '{}';

ALTER TABLE trait_state
ALTER COLUMN helpfulness DROP DEFAULT,
ALTER COLUMN formality DROP DEFAULT,
ALTER COLUMN verbosity DROP DEFAULT,
ALTER COLUMN proactivity DROP DEFAULT,
ALTER COLUMN creativity DROP DEFAULT,
ALTER COLUMN empathy DROP DEFAULT;

UPDATE trait_state
SET
    baseline_source = 'legacy_midpoint',
    baseline_version = 'v1',
    baseline_context = jsonb_build_object(
        'migration', '011_trait_state_hybrid_baseline',
        'note', 'row existed before hybrid baseline initialization'
    )
WHERE baseline_source = 'legacy_midpoint'
  AND baseline_context = '{}'::jsonb;
