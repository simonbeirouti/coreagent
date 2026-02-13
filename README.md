# CoreAgent

Cloud-first, multimodal AI agent platform built with Rust + Supabase where agents see, hear, interact with the web, and evolve unique identities over time.

## Current Status
Phase 2 (Agent Identity) hardening is complete: two-layer quality feedback, closed-loop adaptation, retrieval tuning guardrails, dashboard transparency surfaces, hardened frontend/backend tests, and project quality rules + docs are in place.
Current focus is Phase 3 kickoff: automation and delegation using Rig + swarms-rs.

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
- Phase 3 automation architecture: delegated task lifecycle, tool contracts, and retry-safe orchestration primitives with Rig
- Phase 3 delegation architecture: worker-role routing, handoff semantics, and policy boundaries with swarms-rs
- First delegated workflow surfaces (browser + documentation operations) and observability traces

### Next
- Implement delegated execution flows across Rig agents with explicit task state transitions
- Add swarms-rs orchestration paths for multi-agent task decomposition and coordination
- Expand browser automation as the first production delegation capability

## Tech Stack
- **Frontend**: React 19 + TypeScript + TanStack Router + Shadcn UI + Tailwind CSS
- **Backend**: Tauri 2.0 + Rust + Rig framework + SeaORM
- **Auth**: Supabase Auth
- **Database**: Supabase PostgreSQL + pgvector + Row-Level Security

## Prerequisites
- Node.js 18+
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
# Edit .env with your Supabase credentials
```

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

- **[prd.md](prd.md)** - Product requirements, shipped features, and roadmap
- **[dashboard_transparency_prd.md](dashboard_transparency_prd.md)** - Phase 2 transparency UX and explainability requirements
- **[two_layer_reliability_suite_prd.md](two_layer_reliability_suite_prd.md)** - Unified QA + observability + testing reliability plan
- **[avatar_prd.md](avatar_prd.md)** - Avatar system feature specification
- **[browser_automation_prd.md](browser_automation_prd.md)** - Browser automation feature specification
- **[phase2_dashboard_data_guide.md](phase2_dashboard_data_guide.md)** - Dashboard data sources, chart wiring, and population checklist
- **[docs/testing/two-layer-reliability.md](docs/testing/two-layer-reliability.md)** - Hardened test execution guide and quality gates
- **[docs/platform/feature-map.md](docs/platform/feature-map.md)** - Feature ownership and platform capability map
- **[docs/platform/getting-started-workflows.md](docs/platform/getting-started-workflows.md)** - Operator/developer workflow onboarding
- **[docs/platform/data-meaning-reference.md](docs/platform/data-meaning-reference.md)** - Metric and data semantics reference
- **[docs/platform/feedback-and-adaptation-flow.md](docs/platform/feedback-and-adaptation-flow.md)** - Two-layer feedback to adaptation lifecycle
- **[docs/platform/dashboard-metrics-guide.md](docs/platform/dashboard-metrics-guide.md)** - Dashboard metrics interpretation guide
- **[scripts/seed-dashboard-test-data.ts](scripts/seed-dashboard-test-data.ts)** - TypeScript synthetic dashboard seed script

## Phase 2 Runtime Flags

Optional backend flags for staged Phase 2 rollout:

- `ADAPTATION_AUTO=true|false` - enable/disable automatic feedback-to-trait adaptation cycles
- `RETRIEVAL_TELEMETRY=true|false` - enable/disable memory retrieval event telemetry logging
- `IDENTITY_TRENDS=true|false` - enable/disable skill rating snapshot persistence for trend charts

Defaults: all three flags are enabled if unset.

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

1. Check [prd.md](prd.md) for current priorities, status, and roadmap
2. Follow existing patterns for React Query caching and Supabase/RLS-safe data flows
3. Run `pnpm run check` before opening a PR
