# Two-Layer Reliability Testing Guide

This guide defines how to run and interpret the first-run reliability suite for:

- frontend components/pages/hooks smoke coverage
- backend two-layer integration and policy checks
- local Phase 2 hardening gate before physical QA interactivity testing

## Test Inventory

### Frontend smoke suite

- `src/hooks/useAgents.test.ts`
- `src/hooks/useConversations.test.ts`
- `src/hooks/useFeedback.test.ts`
- `src/hooks/useMemory.test.ts`
- `src/hooks/use-mobile.test.ts`
- `src/routes/agents/$agentId.dashboard.test.tsx`
- `src/routes/agents/$agentId.chat.test.tsx`
- `src/components/ui/chart-source-mix-bars.test.tsx`
- `src/components/ui/chart-confidence-coverage.test.tsx`
- `src/components/ui/chart-guardrail-outcomes.test.tsx`

### Backend reliability suite

- `src-tauri/tests/two_layer_feedback_pipeline.rs`
- `src-tauri/tests/quality_reconciliation_rules.rs`
- `src-tauri/tests/retrieval_provenance_tuning.rs`
- `src-tauri/tests/streaming_timeout_resilience.rs`
- `src-tauri/tests/migration_policy_sanity.rs`

## Environment

- `DATABASE_URL` must point to your development Postgres/Supabase database.
- The backend integration tests are deterministic and isolate rows by generated run IDs.
- Tests include best-effort cleanup for created fixture rows.

## Command Matrix

- Frontend smoke suite: `pnpm test:frontend`
- Rust reliability suite: `pnpm test:rust`
- Full local test run: `pnpm test`
- TypeScript + Rust compile/lint checks: `pnpm run check`

## Recommended Local Execution Order

1. `pnpm test:frontend`
2. `pnpm test:rust`
3. `pnpm run check`

## Phase 2 Local Release Gate Checklist

- Frontend smoke suite passes with no new failures.
- Two-layer backend suite passes:
  - feedback write/read/reconcile flow
  - reconciliation provenance scenarios
  - retrieval tuning source mix + confidence coverage assertions
  - failure-path resilience checks
  - migration/policy/constraint sanity checks
- `pnpm run check` passes.
- Only then proceed to physical QA interactivity testing.
