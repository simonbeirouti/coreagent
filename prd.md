# CoreAgent Unified Delivery PRD

## Document Status
- Version: 5.5
- Last Updated: 2026-02-20
- Owner: CoreAgent Product + Platform Engineering
- Scope: Single source of truth for skills registry, tools/runtime integration, skills graph MVP, and next-iteration orchestration + automation

## Priority Todo List (Canonical Implementation Order)
- [ ] 1. Ship execution runtime platform (execution API, skill-version environments, remote runner for mobile, local Docker runner mode for desktop, runtime permission broker, scoped credentials, run controls).
- [ ] 2. Complete runtime and sync hardening (startup bootstrap, advisory loop with checkpoint/retry, degraded mode semantics, handshake cache/invalidation).
- [ ] 3. Ship dual-lane skill creation flow (guided interface + artifact upload path), authoring kit, curated permission profiles, publish dry-run, and trusted-skill review/badge workflow.
- [ ] 4. Complete skills interaction UX and diagnostics (explicit unassign semantics, richer failure states, diagnostics panel).
- [ ] 5. Enforce orchestration capability prechecks for delegation and reassignment.
- [ ] 6. Complete release gates (observability metrics, handshake/broker unit tests, lifecycle integration tests, resilience/security checks).
- [ ] 7. Deliver skills graph MVP and week-1 usability items.
- [x] Foundation complete and decisions resolved (registry baseline, handshake gates, research decisions for creation flow and runtime model).

## Status Update (2026-02-20)

### Runtime Platform Progress
- Completed now:
  - Database reset + migration apply completed:
    - `supabase/01_coreagent_foundation.sql`
    - `supabase/02_backend_runtime_env_events.sql`
  - Seed runs completed successfully:
    - `apps/coreagent/scripts/seed-test-data.ts`
    - `apps/server/scripts/seed-open-skills.mjs`
  - Runtime package-install test skill published path prepared:
    - `coreagent.py.deep_analysis` (runtime `numpy` install path)
  - Runtime execution API surface shipped in `apps/server`:
    - `POST /v1/runtime/runs`
    - `GET /v1/runtime/runs/:runId`
    - `GET /v1/runtime/runs/:runId/events`
    - `POST /v1/runtime/runs/:runId/cancel`
  - Runner service scaffold shipped in `apps/runner` (BullMQ worker + Redis connection + queue consumption skeleton).
  - Shared runtime contracts package created in `packages/runtime-contracts`.
  - Run persistence implemented in Postgres (`skill_runs`) with runtime event stream table migration (`skill_run_events` via `supabase/backend_runtime_env_events.sql`).
  - Queue/Redis operational diagnostics added:
    - queue health integrated into `/ready` and `/diagnostics`
    - dedicated `GET /v1/runtime/health` with stale-run visibility
  - Retry/backoff controls added for queue jobs (`RUNTIME_RUN_MAX_ATTEMPTS`, `RUNTIME_RUN_RETRY_BACKOFF_MS`).
  - Queue-depth autoscaling recommendation added to runtime queue health:
    - `RUNTIME_AUTOSCALE_MIN_REPLICAS`
    - `RUNTIME_AUTOSCALE_MAX_REPLICAS`
    - `RUNTIME_AUTOSCALE_TARGET_CONCURRENCY_PER_REPLICA`
  - Local Docker execution path now runs skill artifacts in containerized workspace (no placeholder command path).
  - Runner-to-server live log streaming added via queue progress events into `skill_run_events`.
  - CoreAgent settings runtime integration shipped:
    - runtime mode selector (`remote` / `local_docker`) with inline health status
    - profile persistence for runtime execution mode and local image preference
    - local Docker preflight + pre-pull flow via Tauri runtime commands
    - local mode failure remediation (`Open docker in background`) with auto-fallback to remote

- In progress:
  - Remote execution parity and CoreAgent run diagnostics panel are pending final completion.

### Remaining Tasks (By Priority)
1. Execution runtime platform:
   - Remaining:
     - scoped credential source abstraction beyond env-backed mapping (vault/DB-backed broker)
     - remote execution path parity with artifact/container contract
2. CoreAgent runtime integration closure:
   - Remaining:
     - pass selected runtime mode through run creation path in CoreAgent runtime invocation
     - add in-app run diagnostics view for state + `skill_run_events` logs
3. Runtime and sync hardening:
   - Remaining:
     - startup skills bootstrap + richer diagnostics state
     - production advisory sync policy implementation (checkpoint/retry cadence)
     - degraded mode stale-policy enforcement (`2m` soft / `10m` hard)
     - stronger handshake cache/invalidation
4. Skill creation flow quality:
   - Remaining in full (authoring kit, dual-lane UX completion, permission profiles, trust workflow).
5. Skills interaction completeness:
   - Remaining:
     - richer failure state UX
     - registry diagnostics panel in app
6. Orchestration capability controls:
   - Remaining in full.
7. Test and release gates:
   - Partially progressed; still remaining:
     - targeted runtime tests added:
       - frontend: runtime status mapping (`apps/coreagent/src/routes/runtime-status.test.ts`)
       - backend: credential broker scope extraction/dedup (`apps/runner/src/credential-broker.test.ts`)
     - expanded observability metrics
     - full lifecycle + resilience + security suites
8. Skills graph MVP:
   - Remaining in full.

## Executive Summary
CoreAgent now has:
1. a working Skills Registry server with admin publish/revoke and user install/assign lifecycle
2. an admin panel/path to publish skills
3. in-app tools route integration to install, auto-assign, unassign, and manage registry-backed skills
4. baseline runtime validation gates for registry skills

The immediate objective is to finish end-to-end interaction reliability from publish -> install -> assign -> execute -> observe, add a visual skills graph MVP as the operator-facing planning surface, then move into next iteration: production-grade sub-agent orchestration and automated/background functionality.

## Current State (Completed)

### A. Skills Registry Service
- Standalone `/server` service implemented with Fastify + Postgres integration.
- Admin endpoints:
  - `POST /v1/admin/artifacts/upload`
  - `POST /v1/admin/skills/publish`
  - `POST /v1/admin/skills/:skillId/versions/:version/revoke`
- User/runtime endpoints:
  - catalog/details/version APIs
  - install/uninstall/pin/assign APIs
  - `GET /v1/skills/installed`
  - `GET /v1/agents/:agentId/skills`
  - runtime handshake API
  - advisory feed API
- Validation/security in place:
  - manifest validation
  - publish policy evaluation
  - signature generation
  - revocation with force-disable metadata
  - auth checks and route coverage

### B. App/Tauri Integration
- Tauri registry client implemented: `/Users/simonbeirouti/Developer/ai/coreagent/src-tauri/src/skills_registry_client.rs`.
- Tauri commands added for lifecycle operations (list/install/assign/pin/handshake/advisories).
- Auth forwarding uses in-memory session token (`AuthState`) for bearer calls.
- Runtime gate checks added for registry-managed skill execution path (policy/install/force-disable/signature presence/compatibility validation).

### C. Tools UX Integration
- `/Users/simonbeirouti/Developer/ai/coreagent/src/routes/agents/$agentId.tools.tsx` now supports:
  - registry skill visibility on the page
  - install and auto-assign action
  - unassign action (disable assignment)
  - source/lifecycle/disabled-reason surfacing
- Starter markdown skills and seeding tooling added in `/server`:
  - seed script
  - 3 starter markdown skill artifacts
  - seed manifest list

### D. Core Tools Policy Documentation
- `/Users/simonbeirouti/Developer/ai/coreagent/docs/platform/ai-core-tools.md` now reflects:
  - tool classes (`core`, `registry-managed`, orchestration runtime)
  - lifecycle and runtime enforcement model
  - OpenClaw-aligned guardrails
  - canonical implementation tracking in this PRD

## Skills Graph MVP (Phase 3.5)

### Goal
Ship a production-ready, editable skill graph surface that:
1. visualizes skills, levels, and relationships at individual/team scope
2. supports direct manipulation (drag, connect, zoom/pan)
3. persists graph state for downstream AI recommendations and matching

### Why `@xyflow/react`
- Native graph interactions out-of-the-box: draggable nodes, drag-to-connect edges, minimap, controls, pan/zoom.
- Scales from MVP custom node cards to richer typed nodes without replacing the rendering engine.
- Clean fit for future AI augmentation: AI can propose nodes/edges as graph deltas.

### MVP Tech Stack
- React 18/19 + Vite
- `@xyflow/react` (target `v12.10+`)
- Tailwind + shadcn/ui for custom skill node cards and toolbars
- `dagre` for first-pass auto-layout (upgrade path to `elkjs` if needed)
- Zustand + persist for local graph editing state
- Supabase/Postgres JSONB for save/load and version snapshots

### MVP Scope
- Visual graph canvas in dashboard with:
  - custom `skill` node type (`label`, `level`, optional metadata badges)
  - edge creation via handle drag
  - basic edge labels (for example: `prereq`, `related`, `used_with`)
  - minimap, controls, background grid
- Actions:
  - add/delete skill node
  - connect/disconnect edges
  - auto-layout trigger
  - save graph snapshot
- Persistence:
  - save/load by owner scope (`user`, then `team`)
  - optimistic local edits with explicit save confirmation

### Data Model (Initial)
- `skills_graphs`
  - `id`, `owner_type`, `owner_id`, `version`, `created_at`, `updated_at`
  - `graph_jsonb` with `{ nodes: [], edges: [], viewport: {} }`
- Node payload:
  - `id`, `type`, `position`, `data: { label, level, tags?, source? }`
- Edge payload:
  - `id`, `source`, `target`, `label`, `data: { confidence?, provenance? }`

### AI Extension Path (Post-MVP)
- Add `Suggest Connections` endpoint that returns proposal patches:
  - `proposed_nodes[]`
  - `proposed_edges[]`
  - rationale metadata for review before apply
- Input candidates:
  - linked profile ingestion (for example GitHub/LinkedIn exports)
  - existing activity/tooling telemetry

### Phase Delivery Plan
1. `Today`: embed graph view in dashboard and ship save/load to Supabase.
2. `Tomorrow`: add AI suggestion endpoint contract and "apply suggested patch" flow.
3. `Week 1`: add auto-layout, search/filter, and stronger edge typing.
4. `Month 1`: add multi-user team graphs and query surfaces for matching use cases.

### Graph MVP Exit Criteria
1. Operators can create/edit/save/reload a skills graph with no data loss.
2. Graph interactions remain responsive at MVP scale (at least 200 nodes / 500 edges).
3. AI suggestion pipeline can surface proposals without direct auto-apply.
4. Team-level graph permissions are enforced for read/write operations.

## Runtime Execution Architecture Decision (2026-02-19)

### Decision Summary
- Adopt a hybrid execution model:
  - mobile defaults to remote execution
  - desktop defaults to remote execution and exposes optional local Docker execution during onboarding
- Runtime environments are built per skill version (`skill_id + version + digest`) as immutable images.
- Runtime execution is per invocation in isolated ephemeral containers.
- Agent state persists outside containers (database/object store); containers remain stateless.
- Use a unified execution API so the app/orchestration layers do not depend on runner location.

### Integration Points (Where)
- Skills Registry (`/server`)
  - extend install lifecycle to include runtime environment readiness states
  - add execution contract for queue/stream/result and run metadata
  - persist run/audit events using `skill_runs` + `skill_health_events`
- Tauri app (`/src-tauri`)
  - replace direct registry-managed tool invocation path with execution API calls
  - add runner mode selection (`remote`, `local_docker`) for desktop
  - maintain existing handshake/policy gates as pre-execution checks
- Runner plane (new)
  - remote runner service for mobile/cloud execution (autoscaled workers)
  - local Docker runner for desktop-hosted execution
  - shared permission broker for world-actions (`network`, `filesystem`, `browser`, `process`)

### Delivery Sequence (When)
1. Milestone A: ship execution API, environment builder contract, and registry-to-runner interfaces.
2. Milestone B: complete runtime/sync hardening and diagnostics semantics.
3. Milestone C: finalize skill creation UX split (guided interface + artifact upload path), authoring kit, and publish dry-run.
4. Milestone D: ship remote runner (mobile default), desktop local Docker runner mode, and orchestration/background execution integration.
5. Milestone E: harden security/resilience (secret brokering, strict auditing, kill/retry semantics, staged rollout).

## Centralized Delivery Backlog (Canonical, Ordered)

This checklist is the detailed tracker and is ordered by importance and implementation sequence.

### 1. Execution Runtime Platform (Skill Environments + Runners)
- [x] Add unified execution API for registry-managed tools (enqueue run, stream events/logs, resolve output, cancel).
- [x] Add runtime environment builder keyed by `(skill_id, version, digest)` and immutable image metadata.
- [x] Extend install lifecycle/state model to include environment readiness (`resolving`, `building`, `ready`, `failed`).
- [x] Add remote runner service for mobile-default execution with autoscaling by queue depth/concurrency.
- [x] Add desktop local Docker runner mode (`local_docker`) using the same execution API contract.
- [x] Replace local Docker placeholder command path with artifact/container execution path.
- [x] Stream runner container logs into `skill_run_events` for live runtime event consumption.
- [x] Add permission broker enforcement at run-time for `network`, `filesystem`, `browser`, and `process`.
- [x] Add scoped credential broker (no raw environment secret passthrough into skill containers).
- [x] Record structured per-run audit telemetry in `skill_runs` and health transitions in `skill_health_events`.
- [x] Add operational controls: run timeout, retries/backoff, stuck-run reaper, and kill semantics.

### 1A. CoreAgent Runtime Integration + Validation (Local/Remote)
- [x] Add CoreAgent runtime mode selector in onboarding/settings (`remote` vs `local_docker`).
- [x] Persist runtime mode preference in CoreAgent profile/config.
- [x] Add local Docker preflight command in CoreAgent (Docker installed + daemon reachable).
- [x] Add local Docker pre-pull command in CoreAgent for configured runtime image.
- [x] Block local mode selection and show remediation guidance when preflight/pre-pull fails.
- [ ] Route selected runtime mode into runtime run creation path from CoreAgent.
- [ ] Add CoreAgent runtime run panel to show run status + streamed `skill_run_events` logs.
- [ ] Execute and record local execution validation:
  - choose `local_docker` mode in CoreAgent
  - run a registry skill with local mode
  - verify run reaches `succeeded`
  - verify streamed `log` events appear in run events feed
- [ ] Execute and record remote execution validation:
  - choose `remote` mode in CoreAgent
  - run a registry skill with remote mode
  - verify run reaches `succeeded`
  - verify streamed `log` events appear in run events feed

### Immediate Next Steps (Validation Pass)
1. Execute one seeded skill in `remote` mode and confirm `succeeded` plus log events.
2. Execute one seeded skill in `local_docker` mode and confirm `succeeded` plus log events.
3. Execute `coreagent.py.deep_analysis` with profile-aware local image mapping and verify numeric JSON output.
4. Capture run IDs and event evidence, then mark `1A` local/remote validation checklist items complete.
5. Complete wiring so selected runtime mode is used in all CoreAgent run creation paths.

### 2. Runtime And Sync Hardening
- [ ] Add startup skills bootstrap flow (installed skills sync + diagnostics status).
- [ ] Add advisory sync loop with cursor checkpoint persistence and retry/backoff using production defaults:
  - runner/control plane every `30s` with jitter
  - app foreground every `60s`, app background every `5m`
  - immediate sync on resume/install/assign/run trigger
- [ ] Add degraded-mode handling with explicit stale policy:
  - soft-stale at `2m` (warn/degraded)
  - hard-stale at `10m` (fail-closed for registry-managed execution)
  - core tools continue; installs/updates blocked while degraded
- [ ] Add stronger runtime handshake cache strategy and invalidation.

### 3. Skill/Tool Creation Flow Quality
- [ ] Provide canonical "skill authoring kit":
  - markdown starter templates
  - manifest template + schema examples
  - local validation command
  - publish dry-run command
- [ ] Add dual-lane creation UX: guided interface flow + artifact upload flow (shared publish backend contract).
- [ ] Add curated permission profiles for common safe tool classes.
- [ ] Add documented compatibility mapping for OpenClaw-style skill metadata.
- [ ] Add trusted-skill review pipeline + catalog trust badge:
  - reviewed code + security tests + reliability checks required
  - only trusted-badge skills are eligible for recommended placement

### 4. Skills Interaction Completeness
- [ ] Add explicit "unassign" API/command semantics:
  - default action is soft-disable
  - hard-remove is explicit and reserved for cleanup/security
- [ ] Add richer state feedback in UI for install/assign/validation failures.
- [ ] Add registry diagnostics panel (connectivity, last sync, force-disabled count).

### 5. Orchestration Capability Controls
- [ ] Add orchestration capability prechecks for required ability keys on delegation and reassignment paths.

### 6. Test And Release Gates
- [ ] Add observability metrics for install/assign/handshake/advisory propagation and blocked executions.
- [ ] Add unit tests for handshake decision logic and permission broker policy.
- [ ] Add integration tests for full lifecycle:
  - publish -> install -> assign -> runtime validate -> invoke
  - revocation -> advisory sync -> force-disable
- [ ] Add resilience tests:
  - registry unavailable during install/sync
  - advisory sync recovery behavior
- [ ] Add security checks:
  - token redaction
  - permission escalation attempts

### 7. Skills Graph MVP
- [ ] Add graph canvas route/module using `@xyflow/react` with custom `skill` nodes.
- [ ] Add add/delete/connect/disconnect interactions with local persisted state.
- [ ] Add `dagre` auto-layout action for current graph.
- [ ] Add save/load APIs and JSONB persistence for graph snapshots.
- [ ] Add graph toolbar actions: `Add Skill`, `AI Suggest Connections`, `Save Graph`.
- [ ] Add AI suggestion endpoint contract for proposed nodes/edges (human-review apply flow).
- [ ] Add search/filter and typed edge labels for week-1 usability.
- [ ] Add team graph RBAC rules and multi-user access for month-1 readiness.

### 8. Completed Foundations And Resolved Research
- [x] Merge SQLs into one migration file.
- [x] Fix security issue: `agent_memory_retrieval_summary` is publicly accessible.
- [x] Remove unused SQL tables/columns.
- [x] Research ability to create skills (interface flow vs artifact upload flow).
  - Decision: support both flows behind one publish backend (`guided UI` + `artifact upload/CI`).
- [x] Research runtime model for skills/tools requiring installations (dedicated environment and/or sandbox strategy).
  - Decision: dedicated immutable environments per skill version + isolated per-run containers, via shared execution API.
- [x] Add `skills_registry_client.rs` with typed request/response contracts for catalog, install, assign, handshake, and advisory feed endpoints.
- [x] Add Tauri commands for registry skill lifecycle operations and register them in `tauri::generate_handler!`.
- [x] Add registry auth header injection using in-memory `AuthState` session token only.
- [x] Add runtime handshake gate for all registry-managed tool executions.
- [x] Add compatibility and `forceDisable.required` hard-block checks before execution.
- [x] Add UI source markers (`core` vs `registry-managed`) and lifecycle/status badges.
- [x] Add explicit disabled-reason messaging in agent tools UI for policy/compatibility/advisory blocks.

## Next Iteration (Phase 4): Sub-Agents + Automation

### Objectives
1. Move from single-agent/manual tooling to reliable delegated execution across sub-agents.
2. Add automated/background flows with scheduling, resumability, and observability.
3. Keep skills/runtime safety guarantees while enabling autonomous task progression.

### Required Capabilities
- Durable orchestration state machine for runs/tasks/attempts/events.
- Capability-aware delegation and reassignment checks.
- Heartbeats, stale-run detection, retries, and recovery.
- Scheduled automation jobs with explicit policy boundaries.
- v1 supports both internal and user-defined automation jobs, including unsupervised execution, under deny-by-default permissions and policy gates.
- Unified diagnostics for orchestration + skills runtime.

### Exit Criteria
1. Delegated run lifecycle is backend-authoritative and recoverable after restarts.
2. Capability and policy checks are enforced before task execution/reassignment.
3. Automated schedules can run safely with observable status and failure handling.
4. Reliability/security suites pass for orchestration-critical paths.

## Milestone Plan
1. Milestone A: Ship execution runtime platform foundation (execution API, environment builder contract, runner interfaces).
2. Milestone B: Complete runtime and sync hardening plus skills interaction diagnostics.
3. Milestone C: Ship dual-lane skill creation flow (guided UI + artifact upload), authoring kit, and safe publish tooling.
4. Milestone D: Add orchestration capability controls and automation/background execution on the runner plane.
5. Milestone E: Complete resilience/security release gates, autoscaling hardening, and staged production rollout.

## Risks And Mitigations
- Risk: partial integration leaves operators unsure why skills are unavailable.
  - Mitigation: explicit status + disabled reason + diagnostics panel.
- Risk: unbounded automation introduces unsafe behavior.
  - Mitigation: policy gates, capability checks, deny-by-default permissions.
- Risk: orchestration complexity causes regressions.
  - Mitigation: incremental milestones, deterministic tests, rollback strategy.

## Resolved Product Decisions (2026-02-19)
1. Unassign semantics: default to soft-disable; hard-remove is explicit and reserved for cleanup/security.
2. Advisory production policy:
   - sync cadence by platform as defined in Runtime And Sync Hardening
   - soft-stale at `2m`, hard-stale at `10m`, fail-closed for registry-managed execution
3. Automation classes in v1: both internal and user-defined, with unsupervised execution allowed under policy/permission controls.
4. Trusted-skill bar for recommended catalog placement: reviewed and tested code with security/reliability validation, represented by a trust badge.
5. Desktop runner mode: default `remote`; `local_docker` is explicit opt-in during onboarding.
