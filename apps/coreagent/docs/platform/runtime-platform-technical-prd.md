# Runtime Platform Technical PRD

## Document Status
- Version: 1.3
- Last Updated: 2026-02-19
- Owner: Platform Engineering
- Scope: Execution runtime for registry-managed skills (remote + local Docker), permission enforcement, and operational controls

## Decision: Repo And Service Strategy

### Decision
- Do not create a separate repository at this stage.
- Integrate in the existing `coreagent` monorepo under `apps/*` and `packages/*`.
- Keep `apps/server` as control plane and add `apps/runner` as a sibling runtime service.

### Why
- Shared types/contracts with `apps/server` and `apps/coreagent/src-tauri` need frequent coordinated changes.
- Atomic PRs across registry, runner, and client reduce rollout risk.
- Existing build/test tooling already supports split services in one repo.
- The new co-located app structure keeps runtime services discoverable and easier to operate.

### Proposed Layout
- `apps/server/` (existing): control plane APIs, policy, advisory, install lifecycle, orchestration integration.
- `apps/runner/` (new): remote execution worker + Docker orchestration.
- `packages/runtime-contracts/` (new): shared Zod contracts/events for run APIs.
- `apps/coreagent/src-tauri/` (existing): desktop runtime client with `remote` default and `local_docker` opt-in.
- `apps/admin/` (existing): operational/admin UI (not part of runtime execution path).

## Core Runtime Frameworks (Fast + Async)

### Fast Path (API Performance)
- `Fastify` is the primary HTTP framework for runtime/control-plane APIs (initially in `apps/server`, with `apps/runner` optional API surface if needed).
- Rationale: high-throughput, low-overhead request handling and strong TypeScript ergonomics.

### Async Path (Background And Long-Running Work)
- `BullMQ` + `Redis` provide async run dispatch, worker processing, retries, and delayed/recovered execution semantics.
- `Dockerode` is used by `apps/runner` to orchestrate container lifecycle asynchronously.
- `Tokio` remains the async runtime on the Rust side in `apps/coreagent/src-tauri` for desktop-side concurrent operations.
- Net result:
  - `Fastify` = fast request/response plane.
  - `BullMQ`/`Redis` (+ `Tokio` in Rust) = async execution and background concurrency plane.

## Pre-Implementation Install Plan (Packages + SDKs)

This is the install baseline to complete before Milestone A implementation starts.

### A. Workspace Packages To Add
- `apps/runner` runtime dependencies:
  - `bullmq`, `ioredis` (run queue + worker coordination)
  - `dockerode` (Docker API integration for container lifecycle)
  - `zod` (runtime contract validation at service boundary)
  - `pino` (structured logs)
- `apps/runner` dev dependencies:
  - `typescript`, `tsx`, `vitest`, `@types/node`, `@types/dockerode`, `eslint`
- `packages/runtime-contracts` dependencies:
  - `zod`
- `apps/server` additional dependencies for runtime dispatch:
  - `bullmq`, `ioredis`

### B. Recommended Install Commands (pnpm)
- `pnpm --filter runner add bullmq ioredis dockerode zod pino`
- `pnpm --filter runner add -D typescript tsx vitest @types/node @types/dockerode eslint`
- `pnpm --filter server add bullmq ioredis`
- `pnpm --filter @coreagent/runtime-contracts add zod`

### C. SDKs And System Tooling To Install
- Node.js `>=20` (workspace standard)
- pnpm `10.x` (workspace standard)
- Rust stable toolchain + components:
  - `rustup toolchain install stable`
  - `rustup component add rustfmt clippy`
- Cargo test runner:
  - `cargo install cargo-nextest --locked`
- Docker Desktop (or compatible local Docker engine) with CLI access
- Redis `7+` for queue backend
- Postgres via existing Supabase local/dev environment
- Tauri v2 prerequisites for desktop development on macOS:
  - Xcode Command Line Tools (`xcode-select --install`)
  - Tauri CLI already managed in `apps/coreagent` dev dependencies

### D. Optional But Useful Early Additions
- `@opentelemetry/api` + `@opentelemetry/sdk-node` (if we want tracing from day 1)
- `pino-pretty` for local runner log readability
- `testcontainers` for integration tests covering Docker-backed run execution

## Goals
- Run registry-managed skills in isolated per-invocation environments.
- Use immutable environment artifacts keyed by `(skill_id, version, digest)`.
- Support:
  - mobile: remote runner only
  - desktop: remote default, optional local Docker mode
- Enforce deny-by-default runtime permissions for world actions.
- Provide auditable, cancellable, observable run lifecycle.

## Non-Goals (v1)
- Multi-cluster geo scheduling.
- Arbitrary user-provided container runtime backends.
- Long-lived shared mutable containers per agent.

## Architecture

### Control Plane (`apps/server`)
- Validates auth/policy/assignment/install state before dispatch.
- Resolves pinned skill version and environment identity.
- Enqueues runs and exposes run/event/result APIs.
- Maintains advisories and revocation force-disable semantics.

### Runner Plane (`apps/runner`)
- Pulls run jobs from queue.
- Ensures environment image exists (build/pull/cache).
- Starts ephemeral container with resource limits.
- Streams logs/events and stores final outputs/metadata.
- Handles timeout/retry/cancel/reaper logic.

### Desktop Local Mode (`apps/coreagent/src-tauri`)
- Default mode: remote execution.
- Optional mode: local Docker runner selected in onboarding.
- Uses same run contract and policy checks as remote mode.
- Implemented runner path: `executionMode=local_docker` with explicit env gate (`RUNTIME_ENABLE_LOCAL_DOCKER`) and bounded container resources.

## CoreAgent Integration Notes (Backend + Frontend)

### Backend Integration (`apps/server` <-> `apps/runner`)
- `apps/server` is the control plane:
  - validates user auth + install/policy gates
  - resolves skill version/environment metadata
  - enqueues run jobs and persists lifecycle state/events
- `apps/runner` is the execution worker:
  - consumes `runtime-runs` queue jobs from Redis
  - enforces permission broker + scoped credential broker
  - reports run completion/failure via queue events consumed by server
- `GET /v1/runtime/health` and `/diagnostics` expose queue state plus autoscaling recommendation for runner replicas.

### Frontend/Desktop Integration (`apps/coreagent`)
- UI/tooling actions call server runtime APIs:
  - start run: `POST /v1/runtime/runs`
  - poll status/events: `GET /v1/runtime/runs/:runId`, `GET /v1/runtime/runs/:runId/events`
  - cancel run: `POST /v1/runtime/runs/:runId/cancel`
- Registry-managed execution remains fail-closed on policy/revocation/compatibility guardrails before queue dispatch.
- Remote execution is default for desktop/mobile parity; local Docker mode will use the same API contract.

## Runtime Model

### Environment Lifecycle
- Immutable environment per `(skill_id, version, digest)`.
- Install state extension:
  - `resolving`
  - `building`
  - `ready`
  - `failed`

### Run Lifecycle
- `queued` -> `preparing` -> `running` -> `succeeded|failed|timed_out|cancelled`.
- Every run is isolated in a fresh container.
- No shared mutable runtime across users or agents.

## API Contract (Control Plane)
- `POST /v1/runtime/runs`
  - create run request for a skill invocation
- `GET /v1/runtime/runs/:runId`
  - current run status + summary
- `GET /v1/runtime/runs/:runId/events?cursor=...`
  - streaming/polling event feed
- `POST /v1/runtime/runs/:runId/cancel`
  - cooperative + forced cancellation flow

## Security Model
- Permission broker for:
  - `network` (deny by default, domain allowlist)
  - `filesystem` (scoped mounts only)
  - `process` (restricted execution policy)
  - `browser` (guarded action classes)
- Scoped credential broker only; no raw env secret passthrough.
  - Required credential scopes are resolved through explicit scope mapping (`RUNTIME_CREDENTIAL_SCOPE_MAP`) in runner env.
  - Missing/unmapped required scopes fail execution with a credential-broker deny reason.
- Runtime integrity checks:
  - signed digest validation
  - policy status approved
  - install state valid
  - advisory/force-disable checks

## Advisory Sync Production Policy
- Runner/control plane sync every `30s` with jitter.
- App sync:
  - foreground every `60s`
  - background every `5m`
  - immediate sync on resume/install/assign/run
- Staleness thresholds:
  - soft-stale `2m` (degraded/warn)
  - hard-stale `10m` (fail-closed for registry-managed execution)

## Data Model Additions
- `runtime_environments`
  - environment identity and readiness by skill version digest
- `runtime_environment_builds`
  - build attempts, logs pointers, outcome metadata
- `skill_run_events`
  - structured event stream for each run (state transitions, logs, policy blocks)

Note: Existing `skill_runs` and `skill_health_events` remain primary summary/audit tables.

## Observability And SLOs
- Metrics:
  - queue depth, scheduling latency, environment build latency
  - run success/failure/timeout/cancel rates
  - policy deny counts by reason
  - advisory propagation lag and stale-window breaches
  - autoscaling recommendation (`recommendedReplicas`) based on queue depth + active concurrency
- Initial SLO targets:
  - p95 queue-to-start under 5s (warm env), under 30s (cold env)
  - successful cancellation under 10s p95

## Trusted Skill Badge (Catalog Recommendation Gate)
- Recommended catalog placement requires:
  - reviewed code
  - security checks passed
  - reliability checks passed
  - no unresolved critical advisory
- Badge state is attached to skill version and surfaced in catalog UI.

## Rollout Plan
- Phase A:
  - introduce run APIs and queue model
  - implement remote runner skeleton + event pipeline
- Phase B:
  - permission broker and credential brokering
  - install lifecycle extension and environment readiness state
- Phase C:
  - desktop local Docker mode in onboarding
  - trusted skill badge workflow and recommendation gating
- Phase D:
  - hardening: retries, reaper, scaling policy, staged production rollout
