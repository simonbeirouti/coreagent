# CoreAgent Unified Delivery PRD

## Document Status
- Version: 4.0
- Last Updated: 2026-02-18
- Owner: CoreAgent Product + Platform Engineering
- Scope: Single source of truth for skills registry, tools/runtime integration, and next-iteration orchestration + automation

## Executive Summary
CoreAgent now has:
1. a working Skills Registry server with admin publish/revoke and user install/assign lifecycle
2. an admin panel/path to publish skills
3. in-app tools route integration to install, auto-assign, unassign, and manage registry-backed skills
4. baseline runtime validation gates for registry skills

The immediate objective is to finish end-to-end interaction reliability from publish -> install -> assign -> execute -> observe, then move into next iteration: production-grade sub-agent orchestration and automated/background functionality.

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
  - implementation checklist with progress markers

## Remaining Gaps To “Complete And Working Interaction”

### 1. Runtime And Sync Hardening
- Implement startup bootstrap sync loop for installed skills + advisories with durable cursor state.
- Add degraded-mode UX/states for registry outages (`sync_stale` behavior end-to-end).
- Add stronger runtime handshake cache strategy and invalidation.

### 2. Skills Interaction Completeness
- Add explicit “unassign” API/command semantics (hard unassign vs disable toggle).
- Add richer state feedback in UI for install/assign/validation failures.
- Add registry diagnostics panel (connectivity, last sync, force-disabled count).

### 3. Skill/Tool Creation Flow Quality
- Provide canonical “skill authoring kit”:
  - markdown starter templates
  - manifest template + schema examples
  - local validation command
  - publish dry-run command
- Add curated permission profiles for common safe tool classes.
- Add documented compatibility mapping for OpenClaw-style skill metadata.

### 4. Test And Release Gates
- Add integration tests for full lifecycle:
  - publish -> install -> assign -> runtime validate -> invoke
  - revocation -> advisory sync -> force-disable
- Add resilience tests:
  - registry unavailable during install/sync
  - advisory sync recovery behavior
- Add security checks:
  - token redaction
  - permission escalation attempts

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
- Unified diagnostics for orchestration + skills runtime.

### Exit Criteria
1. Delegated run lifecycle is backend-authoritative and recoverable after restarts.
2. Capability and policy checks are enforced before task execution/reassignment.
3. Automated schedules can run safely with observable status and failure handling.
4. Reliability/security suites pass for orchestration-critical paths.

## Milestone Plan
1. Milestone A: Finish skills interaction reliability and diagnostics.
2. Milestone B: Ship skill authoring kit and safe publish tooling.
3. Milestone C: Implement orchestration state hardening and delegated runtime checks.
4. Milestone D: Add automated scheduling and background execution loops.
5. Milestone E: Complete resilience/security gates and staged production rollout.

## Risks And Mitigations
- Risk: partial integration leaves operators unsure why skills are unavailable.
  - Mitigation: explicit status + disabled reason + diagnostics panel.
- Risk: unbounded automation introduces unsafe behavior.
  - Mitigation: policy gates, capability checks, deny-by-default permissions.
- Risk: orchestration complexity causes regressions.
  - Mitigation: incremental milestones, deterministic tests, rollback strategy.

## Open Questions
1. Should unassign mean hard delete of agent mapping or soft-disable by default?
2. What advisory sync interval and TTL policy should be required for production?
3. Which automation job classes are allowed in v1 (internal only vs user-defined)?
4. What is the minimum “trusted skill” bar for recommended catalog placement?
