# CoreAgent

Cloud-first, multimodal AI agent platform built with Rust + Supabase where agents see, hear, interact with the web, and evolve unique identities over time.

## Current Status
Phase 2 (Agent Identity) is in progress with dashboard analytics now wired end-to-end and ready for final hardening.

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

### In Progress (Current Focus)
- Dashboard production polish (loading/empty/error states and UX refinement)
- Closed-loop trait adaptation quality from user feedback
- Retrieval quality tuning and observability validation for memory relevance

### Next
- Phase 2 hardening wrap-up, then Phase 3 kickoff: browser automation and deeper multimodal workflows

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

# Build
pnpm build            # Frontend build
pnpm run tauri build  # Full application build
```

## Documentation

- **[prd.md](prd.md)** - Product requirements, shipped features, and roadmap
- **[avatar_prd.md](avatar_prd.md)** - Avatar system feature specification
- **[browser_automation_prd.md](browser_automation_prd.md)** - Browser automation feature specification
- **[phase2_dashboard_data_guide.md](phase2_dashboard_data_guide.md)** - Dashboard data sources, chart wiring, and population checklist

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
