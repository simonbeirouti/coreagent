# CoreAgent Workspace

Monorepo for CoreAgent apps and shared packages.

## Workspace Layout

- `apps/coreagent`: Tauri desktop app (React + Rust)
- `apps/server`: Skills registry + runtime control plane (Fastify)
- `apps/runner`: Runtime worker service (BullMQ + Redis)
- `apps/admin`: Admin web app
- `packages/runtime-contracts`: Shared runtime API contracts (Zod)
- `supabase`: SQL schema and migrations
- `prd.md`: Product and implementation plan

## Runtime Integration (Backend + Frontend)

- Backend control plane: `apps/server`
  - exposes runtime execution APIs (`/v1/runtime/runs*`)
  - validates auth/policy/install gates
  - persists run state/events and queue health
- Backend worker plane: `apps/runner`
  - consumes BullMQ jobs from Redis
  - applies runtime permission + credential brokers
  - returns completion/failure through queue events
- Frontend/desktop: `apps/coreagent`
  - calls server runtime APIs for run start/status/events/cancel
  - uses remote execution by default with optional `local_docker` mode

## Prerequisites

- Node.js 20+
- pnpm 10+
- Rust stable toolchain
- Redis (for runner/queue-backed runtime)
- Postgres/Supabase (for persistent runtime state)

## Quick Start

```bash
pnpm install

cp apps/coreagent/.env.example apps/coreagent/.env
cp apps/server/.env.example apps/server/.env
cp apps/runner/.env.example apps/runner/.env
```

## Common Commands

```bash
# run all app dev tasks
pnpm dev

# run registry + runner
pnpm dev:runtime

# run desktop app
pnpm dev:coreagent

# checks
pnpm check-types
pnpm build
```

## Notes

- Queue-backed runtime in `apps/server` is controlled by `ENABLE_RUNTIME_QUEUE=true`.
- Runner reads env from `apps/runner/.env` (via dotenv).
- Runtime run events require latest SQL migration in `supabase/`.
- Apply migrations in order:
  - `supabase/01_coreagent_foundation.sql`
  - `supabase/02_backend_runtime_env_events.sql`
- For Upstash, set `REDIS_URL` to the Redis connection string (`rediss://...`), not the REST URL.
- Queue retries are configurable via `RUNTIME_RUN_MAX_ATTEMPTS` and `RUNTIME_RUN_RETRY_BACKOFF_MS`.
- If you see transient Redis resets (for example `ECONNRESET`) on server cache logs, set `ENABLE_RUNTIME_REDIS_CACHE=false` in `apps/server/.env` to disable the optional cache client while keeping queue execution active.
- Runner execution modes:
  - `remote`: executes skill artifacts in Docker on the runner host (requires Docker + `RUNTIME_ENABLE_REMOTE_DOCKER=true`).
  - `local_docker`: executes the same Docker-isolated flow with local-mode gating (`RUNTIME_ENABLE_LOCAL_DOCKER=true`).
- Container image selection is profile-based via `RUNTIME_LOCAL_DOCKER_IMAGE_PROFILES` using canonical language profiles (`default`, `node`, `python`, `rust`). Aliases like `js/javascript`, `py`, and `rs` normalize to those canonical profiles.
- Runtime image warmup now dedupes alias profiles so each language pulls a single canonical image.
- Chat runtime UX now renders direct tool runs inline with conversation order, dedupes repeated progress events, and auto-scrolls while tool progress is streaming.
- On reload, internal direct-tool context payloads are hidden from user bubbles and used to hydrate tool run accordions instead.

## Current Test Milestone (2026-02-20)

- Database reset + migrations completed successfully.
- Seed data loaded successfully:
  - `apps/coreagent/scripts/seed-test-data.ts`
  - `apps/server/scripts/seed-open-skills.mjs`
- Registry now includes starter markdown skills plus `coreagent.py.deep_analysis` (runtime package install test path).

## Next Validation Steps

1. Start services:
   - `pnpm dev:runtime`
   - `pnpm dev:coreagent`
2. In CoreAgent settings, verify runtime mode behavior:
   - `remote` shows neutral status
   - `local_docker` checks Docker readiness and auto-falls back to remote if unavailable
3. Install and assign a seeded skill from Tools.
4. Execute one run in `remote` and one in `local_docker`.
5. Verify runtime results:
   - `GET /v1/runtime/runs/:runId` reaches `succeeded`
   - `GET /v1/runtime/runs/:runId/events` includes streamed `log` events
6. Run automated parity verification:
   - Ensure env toggles are set:
     - `apps/server/.env`: `ENABLE_RUNTIME_QUEUE=true`
     - `apps/runner/.env`: `RUNTIME_ENABLE_REMOTE_DOCKER=true` and `RUNTIME_ENABLE_LOCAL_DOCKER=true`
   - Run:
     - `pnpm --filter server verify:runtime-modes -- --authToken "<jwt-token>" --skillId "coreagent.rs.regex_advisor" --version "1.0.0" --input '{"text":"foo-123"}'`
