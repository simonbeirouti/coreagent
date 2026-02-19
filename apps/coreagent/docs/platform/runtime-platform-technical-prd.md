# Runtime Platform Technical PRD

## Document Status
- Version: 1.0
- Last Updated: 2026-02-19
- Owner: Platform Engineering
- Scope: Execution runtime for registry-managed skills (remote + local Docker), permission enforcement, and operational controls

## Decision: Repo And Service Strategy

### Decision
- Do not create a separate repository at this stage.
- Integrate in the existing `coreagent` repo with a multi-service layout.
- Keep `server` as control plane and add a dedicated runner service as a sibling package.

### Why
- Shared types/contracts with `server` and `src-tauri` need frequent coordinated changes.
- Atomic PRs across registry, runner, and client reduce rollout risk.
- Existing build/test tooling already supports split services in one repo.

### Proposed Layout
- `server/` (existing): control plane APIs, policy, advisory, install lifecycle, orchestration integration.
- `runner/` (new): remote execution worker + Docker orchestration.
- `packages/runtime-contracts/` (new): shared Zod contracts/events for run APIs.
- `src-tauri/` (existing): desktop runtime client with `remote` default and `local_docker` opt-in.

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

### Control Plane (`server`)
- Validates auth/policy/assignment/install state before dispatch.
- Resolves pinned skill version and environment identity.
- Enqueues runs and exposes run/event/result APIs.
- Maintains advisories and revocation force-disable semantics.

### Runner Plane (`runner`)
- Pulls run jobs from queue.
- Ensures environment image exists (build/pull/cache).
- Starts ephemeral container with resource limits.
- Streams logs/events and stores final outputs/metadata.
- Handles timeout/retry/cancel/reaper logic.

### Desktop Local Mode (`src-tauri`)
- Default mode: remote execution.
- Optional mode: local Docker runner selected in onboarding.
- Uses same run contract and policy checks as remote mode.

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

