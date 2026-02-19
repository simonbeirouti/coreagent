# CoreAgent

Cloud-first, multimodal AI agent platform built with Rust + Supabase where agents see, hear, interact with the web, and evolve unique identities over time.

## Current Status
Phase 2 (Agent Identity) hardening is complete: two-layer quality feedback, closed-loop adaptation, retrieval tuning guardrails, dashboard transparency surfaces, hardened frontend/backend tests, and project quality rules + docs are in place.
Current focus is unified delivery across skills registry integration, reliable agent tooling, and next-iteration sub-agent orchestration + automation.

## Project Updates (February 16, 2026)
- Legacy split PRDs have been consolidated into a single unified program PRD in `prd.md`.
- `prd.md` now contains completed work summary, current integration gaps, and next-iteration delivery for sub-agents + automation.
- Root route now provides a board-first orchestration experience:
  - lanes: `Idle Queue`, `Working Now`, `Ready For Review`
  - guided `Create Job Assignment` wizard for run/task/delegation/schedule/memory creation
  - drag guardrails:
    - `idle -> review` is blocked
    - `idle -> working` is task-context gated via dialog
  - board lane positions persist locally per agent for continuity

### Shipped
- ✅ **Phase 0 (Foundation):** React + TypeScript app shell, routing, UI system, and auth UX
- ✅ **Phase 1 (Agent Core):** Rust/Tauri backend, agent + conversation CRUD, message flows
- ✅ **Phase 1.5 (Caching):** React Query cache hydration with persistent Tauri Store backing
- ✅ **Phase 2 Foundations:**
  - RAG memory schema (`message_embeddings`) with pgvector + HNSW similarity index
  - Skill tracking schema (`abilities`, `agent_abilities`) with proficiency metrics
  - Feedback schema (`message_feedback`, `personality_adjustments`) for learning loops
  - Frontend integration for these flows is implemented, tested, and cache-backed
  - Agent dashboard stats are now connected across skill trends, memory hit/no-hit + quality, trait state, personality timeline, and feedback/skill summaries
- ✅ **Two-layer feedback + learning (v1):**
  - Async per-message quality scoring for assistant messages
  - User per-dimension ratings (`helpfulness`, `accuracy`, `tone`, `verbosity`) with reconciliation into effective signals
  - Adaptation loop consumes fused dimension signals with provenance-aware fallback
  - Retrieval quality/tuning status includes quality source/provenance mix
  - Dashboard now renders independent transparency cards for source mix, confidence coverage, and guardrail outcomes
  - Latest retrieval tuning decision is surfaced inline with the personality evolution card
  - Transparency route now redirects to dashboard so explainability panels are maintained in one place
  - Streaming message timeout guard prevents indefinite request hangs

### In Progress (Current Focus)
- Phase 3 orchestration hardening: backend-driven lane state, review-completion semantics, and richer diagnostics
- Skills runtime and vetted registry implementation for safe in-app install/update/disable
- Reliability coverage expansion for orchestration board interactions and assignment lifecycle paths

### Next
- Connect lane state to orchestration run/task lifecycle as source-of-truth
- Add explicit review completion transitions tied to run/task status outcomes
- Implement skills runtime sandbox + signed registry integration

## Tech Stack
- **Frontend**: React 19 + TypeScript + TanStack Router + Shadcn UI + Tailwind CSS
- **Backend**: Tauri 2.0 + Rust + Rig framework + SeaORM
- **Auth**: Supabase Auth
- **Database**: Supabase PostgreSQL + pgvector + Row-Level Security

## Prerequisites
- Node.js 20+
- Rust 1.70+
- pnpm (recommended)

## Getting Started

### 1. Clone and Install Dependencies
```bash
git clone <repository-url>
cd coreagent
pnpm install
```

### 2. Environment Setup
```bash
cp .env.example .env
cp server/.env.example server/.env
# Edit .env and server/.env with your project credentials
```

### Environment Variables (Expected Values)

Env templates:
- Root app env template: `.env.example`
- Registry service env template: `server/.env.example`

`/server` loads env from:
- `server/.env` only

For optional variables, leave them unset or blank. If you set a value, it must be valid (for example, real URL format for `*_URL` fields).

Core app values (required):

- `VITE_SUPABASE_URL`: `https://<project-ref>.supabase.co`
- `VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY`: Supabase publishable (anon) key
- `SUPABASE_URL`: `https://<project-ref>.supabase.co`
- `DATABASE_URL`: Postgres connection string for your project

Registry server runtime (`/server`, optional with defaults shown):

- `HOST`: default `127.0.0.1` (use `0.0.0.0` only if remote/device access is needed)
- `PORT`: default `4010`
- `LOG_LEVEL`: default `info` (`debug` for local troubleshooting)
- `DATABASE_SSL`: default `false` (set `true` only if your DB requires TLS)
- `DATABASE_POOL_MAX`: default `10`
- `ARTIFACT_STORAGE_DIR`: default `data/artifacts` (artifact files keyed by SHA-256 digest)
- `ARTIFACT_MAX_BYTES`: default `10485760` (10 MB upload cap per artifact)
- `ENABLE_HEURISTIC_ARTIFACT_SCANNER`: default `false` (`true` enables lightweight content signature checks)
- `APP_RUNTIME_VERSION`: optional app semver used for publish-time compatibility guardrails

Registry JWT auth (multi-user, app-backed):

- Required for Supabase-backed verification (recommended):
  - `SUPABASE_URL`: used to derive issuer and JWKS URL automatically
- Optional overrides:
  - `JWT_JWKS_URL`: explicit JWKS URL override
  - `JWT_ISSUER`: explicit issuer override
- Optional policy controls:
  - `JWT_AUDIENCE`: default `authenticated`
  - `JWT_REQUIRE_AUTHENTICATED_ROLE`: default `true`
  - `JWT_CLOCK_SKEW_SECONDS`: default `30`
- Local/test fallback (only when not using JWKS):
  - `JWT_SECRET`: HS256 shared secret

Registry admin API:

- `ENABLE_ADMIN_API`: `false` by default; set `true` for publish/revoke endpoints
- `ADMIN_API_TOKEN`: required if `ENABLE_ADMIN_API=true`
- `SIGNING_SECRET`: required for `/v1/admin/skills/publish` (registry signs digests server-side)
- `SIGNING_KEY_ID`: optional key label in signature metadata; default `skills-registry-hmac-v1`

AI providers (used by Tauri backend capabilities):

- `OPENAI_API_KEY`: required for OpenAI-backed text/audio/embedding/realtime flows
- `ANTHROPIC_API_KEY`: required for Anthropic-backed chat/vision flows

Optional script-only value:

- `SUPABASE_SERVICE_ROLE_KEY`: needed for seed/admin scripts such as `pnpm run seed:dashboard`

### Skills Registry Service (Local)
```bash
cd server
pnpm dev         # run registry service in watch mode
pnpm test        # run route/auth test suite
pnpm check       # typecheck + lint + tests
```

User-scoped registry routes require:
- `Authorization: Bearer <JWT>`
- token `sub` claim must be a user UUID
- if `JWT_REQUIRE_AUTHENTICATED_ROLE=true`, token `role` must be `authenticated`

Admin publish flow (Phase 3):
1. Upload artifact: `POST /v1/admin/artifacts/upload` (`x-admin-token`)
2. Publish version: `POST /v1/admin/skills/publish` with `artifactDigest`
3. Assign installed skill via existing user endpoints (`/v1/skills/:skillId/install`, `/assign`)

### Phase 3 Local E2E (Registry + App)

1. Apply latest DB migrations in Supabase (including `017_skills_registry_service.sql`).
2. Configure env files with at least:
   - `DATABASE_URL`
   - `SUPABASE_URL`
   - `ENABLE_ADMIN_API=true`
   - `ADMIN_API_TOKEN=<token>`
   - `SIGNING_SECRET=<long-random-secret>`
   - set app/shared values in `.env`
   - set registry-only values in `server/.env` (recommended)
3. Start registry service:
   - `pnpm -C server dev:admin`
4. Start the app:
   - `pnpm run tauri dev`
5. Upload artifact:
```bash
curl -X POST http://127.0.0.1:4010/v1/admin/artifacts/upload \
  -H "x-admin-token: $ADMIN_API_TOKEN" \
  -H "content-type: application/json" \
  -d '{"artifactBase64":"'"$(printf 'echo hello' | base64)"'"}'
```
6. Publish skill version (use returned digest):
```bash
curl -X POST http://127.0.0.1:4010/v1/admin/skills/publish \
  -H "x-admin-token: $ADMIN_API_TOKEN" \
  -H "content-type: application/json" \
  -d '{
    "skillId":"coreagent.phase3.example",
    "implementationKey":"coreagent.phase3.example",
    "name":"Phase 3 Example Skill",
    "description":"Local test skill",
    "version":"1.0.0",
    "runtime":"command",
    "entrypoint":"scripts/run.sh",
    "artifactDigest":"<digest-from-upload>",
    "permissions":[{"permissionKey":"repo.read","required":true,"riskLevel":"low","permissionScope":{}}]
  }'
```
7. From a signed-in app session, use the user JWT (`Authorization: Bearer <token>`) to:
   - install: `POST /v1/skills/coreagent.phase3.example/install`
   - assign: `POST /v1/skills/coreagent.phase3.example/assign`
   - verify: `GET /v1/skills/installed` and `GET /v1/agents/:agentId/skills`

### 3. Development
```bash
# Start full-stack development (frontend + backend)
pnpm run tauri dev

# Or run separately:
pnpm dev              # Frontend only (Vite)
pnpm run tauri dev    # Backend + Frontend
```

### 4. Build for Production
```bash
pnpm run tauri build
```

## Development Commands

```bash
# Check code quality
pnpm check            # TypeScript + Rust checks
pnpm check:ts         # TypeScript only
pnpm check:rust       # Rust only

# Seed synthetic dashboard test data (3 agents, 14 days by default)
pnpm run seed:dashboard -- --userEmail you@example.com --userId 00000000-0000-0000-0000-000000000000

# Build
pnpm build            # Frontend build
pnpm run tauri build  # Full application build
```

## Synthetic Dashboard Seeder

Use the TypeScript seeder to generate realistic test data used by dashboard, agent settings, and user settings.

Requirements:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Command:

```bash
pnpm run seed:dashboard -- --userEmail you@example.com --userId 00000000-0000-0000-0000-000000000000
```

Optional flags:
- `--days <n>` (default: `14`)
- `--agents <n>` (default: `3`)

The script performs a clean reseed for rows tagged with its seed source and recreates a predictable dataset for testing.

## Documentation

- **[prd.md](prd.md)** - Unified program PRD with completed delivery summary, integration gaps, and next-iteration roadmap
- **[dashboard_transparency_prd.md](dashboard_transparency_prd.md)** - Phase 2 transparency UX and explainability requirements
- **[two_layer_reliability_suite_prd.md](two_layer_reliability_suite_prd.md)** - Unified QA + observability + testing reliability plan
- **[avatar_prd.md](avatar_prd.md)** - Avatar system feature specification
- **[browser_automation_prd.md](browser_automation_prd.md)** - Browser automation feature specification
- **[phase2_dashboard_data_guide.md](phase2_dashboard_data_guide.md)** - Dashboard data sources, chart wiring, and population checklist
- **[docs/testing/two-layer-reliability.md](docs/testing/two-layer-reliability.md)** - Hardened test execution guide and quality gates
- **[docs/platform/feature-map.md](docs/platform/feature-map.md)** - Feature ownership and platform capability map
- **[docs/platform/getting-started-workflows.md](docs/platform/getting-started-workflows.md)** - Operator/developer workflow onboarding
- **[docs/platform/ai-core-tools.md](docs/platform/ai-core-tools.md)** - Core AI tools reference and runtime rules
- **[docs/platform/data-meaning-reference.md](docs/platform/data-meaning-reference.md)** - Metric and data semantics reference
- **[docs/platform/feedback-and-adaptation-flow.md](docs/platform/feedback-and-adaptation-flow.md)** - Two-layer feedback to adaptation lifecycle
- **[docs/platform/dashboard-metrics-guide.md](docs/platform/dashboard-metrics-guide.md)** - Dashboard metrics interpretation guide
- **[docs/platform/orchestration-job-assignment-board.md](docs/platform/orchestration-job-assignment-board.md)** - Board lanes, drag rules, and guided job-assignment flow
- **[scripts/seed-dashboard-test-data.ts](scripts/seed-dashboard-test-data.ts)** - TypeScript synthetic dashboard seed script

## Phase 2 Runtime Flags

Optional backend flags for staged Phase 2 rollout:

- `ADAPTATION_AUTO=true|false` - enable/disable automatic feedback-to-trait adaptation cycles
- `RETRIEVAL_TELEMETRY=true|false` - enable/disable memory retrieval event telemetry logging
- `RETRIEVAL_AUTO_TUNE=true|false` - enable/disable automatic retrieval tuning updates
- `IDENTITY_TRENDS=true|false` - enable/disable skill rating snapshot persistence for trend charts

Defaults: all four flags are enabled if unset.

## Supabase Verification

After applying `supabase/migrations/010_hits_and_retrieval_observability.sql`, validate by:

- checking migration success in your Supabase SQL editor/history
- confirming dashboard charts receive non-empty data after real interactions
- using the checklist in `phase2_dashboard_data_guide.md` for data population and troubleshooting

Also apply and verify:
- `supabase/migrations/012_retrieval_tuning_state_and_events.sql`
- `supabase/migrations/013_two_layer_message_quality_feedback.sql`

## Project Structure

```text
coreagent/
├── src/                      # Frontend (React)
│   ├── components/           # UI components and feature modules
│   ├── routes/               # TanStack Router pages
│   ├── hooks/                # React Query + app hooks
│   └── lib/                  # Utilities, cache, and query keys
├── src-tauri/                # Backend (Rust/Tauri)
│   ├── src/                  # Rust source code
│   └── Cargo.toml            # Rust dependencies
├── supabase/
│   └── migrations/           # Postgres schema + RLS migrations
├── public/                   # Static assets
├── prd.md                    # Product roadmap and implementation status
├── avatar_prd.md             # Avatar feature PRD
└── browser_automation_prd.md # Browser automation PRD
```

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)

## Contributing

1. Check [prd.md](prd.md) for current priorities, completed status, and active implementation scope
2. Follow existing patterns for React Query caching and Supabase/RLS-safe data flows
3. Run `pnpm run check` before opening a PR
