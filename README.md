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
- Runtime tool execution security:
  - Tool calling runs in Docker-isolated environments as the primary security boundary.
  - This applies to both `remote` and `local_docker` execution paths.
- Container image selection is profile-based via `RUNTIME_LOCAL_DOCKER_IMAGE_PROFILES` using canonical language profiles (`default`, `node`, `python`, `rust`). Aliases like `js/javascript`, `py`, and `rs` normalize to those canonical profiles.
- Runtime image warmup now dedupes alias profiles so each language pulls a single canonical image.
- Chat runtime UX now renders direct tool runs inline with conversation order, dedupes repeated progress events, and auto-scrolls while tool progress is streaming.
- On reload, internal direct-tool context payloads are hidden from user bubbles and used to hydrate tool run accordions instead.
- Chat no longer uses manual slash-based direct tool execution; tool selection/execution is provider-native and model-driven.
- Runtime-tool summaries now stream incrementally (no single large buffered response chunk at the end of a run).
- Anthropic model compatibility includes fallback handling for deprecated/unavailable model IDs.
- User file library + attachments:
  - Assets are stored in `user-files` and are user-scoped.
  - Files uploaded in chat are available on the Files page, and Files page uploads are available in chat.
  - Current allowed file extensions include docs and images (`txt`, `pdf`, `doc`, `csv`, `png`, `jpg`, `jpeg`, `gif`, `webp`).
  - Chat attaches files by marker reference; file content is fetched through runtime tools (not auto-inlined).
- New core runtime tool:
  - `attachment_read`: reads attached docs and summarizes attached images with guarded limits.
  - Available as a core tool by default; surfaced via runtime tool execution timeline.

## Current Test Milestone (2026-02-20)

- Database reset + migrations completed successfully.
- Seed data loaded successfully:
  - `apps/coreagent/scripts/seed-test-data.ts`
  - `apps/server/scripts/seed-open-skills.mjs`
- Registry now includes starter markdown skills plus `coreagent.py.deep_analysis` (runtime package install test path).

## Current Delivery Update (2026-02-22)

- Runtime tools execute successfully in both modes during active development validation:
  - `remote`
  - `local_docker`
- Attachment-read capability has been integrated as a core runtime tool.
- File asset management is unified and reusable across chat and Files route workflows.

## Current Delivery Update (2026-02-23)

- Legacy tool-calling paths are now removed from CoreAgent runtime execution.
- Provider-native tool calling is now the only supported decision policy in-app.
- Runtime tool execution is now API/Docker only (`runtime API -> queue -> runner -> Docker`) with no local legacy fallback path.
- Legacy runtime toggle env vars were removed from `apps/coreagent/.env.example`.
- Manual slash/direct tool run UI path has been removed from chat in favor of automatic model tool calling.
- Runtime tool-run timeline now uses accordion entries directly without acceptance-message cards.

## Next Validation Steps

1. Start services:
   - `pnpm dev:runtime`
   - `pnpm dev:coreagent`
2. In CoreAgent settings, verify runtime mode behavior:
   - `remote` shows healthy status
   - `local_docker` checks Docker readiness and remediates gracefully when unavailable
3. Verify selected runtime mode is passed through all run creation paths.
4. Validate attachment-read outputs in chat timeline for:
   - text/csv/pdf/doc extraction
   - image summary path
   - truncation/error guardrail messaging
5. Run automated parity verification:
   - Ensure env toggles are set:
     - `apps/server/.env`: `ENABLE_RUNTIME_QUEUE=true`
     - `apps/runner/.env`: `RUNTIME_ENABLE_REMOTE_DOCKER=true` and `RUNTIME_ENABLE_LOCAL_DOCKER=true`
   - Run:
     - `pnpm --filter server verify:runtime-modes -- --authToken "<jwt-token>" --skillId "coreagent.rs.regex_advisor" --version "1.0.0" --input '{"text":"foo-123"}'`
6. Validate automatic tool-calling + streaming behavior in chat:
   - Ask for a task that clearly requires a runtime skill/tool.
   - Confirm no slash/manual tool picker is required.
   - Confirm the assistant response streams token-by-token during/after tool execution.

## Backlog Note

- File list/state synchronization still has a known gap when bucket contents are changed directly outside app flows.
- Backlog item: add direct bucket-to-app sync/reconciliation so Files and chat attachment views reflect bucket truth without requiring app-originated updates.
