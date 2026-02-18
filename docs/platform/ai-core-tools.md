# CoreAgent AI Core Tools

## Document Status
- Last Updated: 2026-02-17
- Scope: Unified tools reference across current app behavior + Phase 3 orchestration + skills-registry integration

## Purpose
Core tools are runtime capabilities that let agents perceive context, retain memory, communicate, and execute delegated work safely. This document is the single source of truth for tool classes, lifecycle, runtime enforcement, and operational rules.

## Related Specs
- `/Users/simonbeirouti/Developer/ai/coreagent/prd.md`

## Tool Classes

### 1. Core Tools (Always-On)
Core categories:
- `memory`
- `perception`
- `communication`

Current core tool implementations:
- `memory_retrieval`
- `vision_screenshot`
- `vision_analysis`
- `audio_transcription`
- `voice_synthesis`

Rules:
- Core tools are mandatory.
- Core tools cannot be disabled by user toggle.
- Core tools are resolved locally by backend ability service.

### 2. Registry-Managed Tools (User Install + Agent Assign)
Registry-managed tools are sourced from the Skills Registry service and become usable after install, assignment, and runtime validation.

Rules:
- Toggleable per agent.
- Governed by install state, policy status, compatibility, advisory, and runtime handshake.
- Subject to force-disable on revocation/security advisories.

### 3. Orchestration Runtime Tools
Orchestration uses agent tools/capabilities as execution prerequisites during delegation and reassignment.

Rules:
- Tasks may declare required ability keys.
- Assignment/reassignment must fail safely when required capabilities are not available/enabled.
- Policy decisions and blocked transitions must be auditable.

## Tool Data Model And Source Of Truth

| Concern | Source of Truth | Notes |
|---|---|---|
| Global tool identity and schemas | `abilities` | Includes `implementation_key`, category, and parameters schema. |
| Per-agent enablement/config/usage | `agent_abilities` | Runtime switch + config + proficiency/usage counters. |
| Skill catalog/install/pin/advisory state | Skills Registry (`/server`) | Remote policy-authoritative registry APIs. |
| Runtime validation contract | Registry runtime handshake endpoint | Includes digest/signature, compatibility, policy, force-disable signal. |

## Registry Skill Lifecycle
For registry-managed tools, lifecycle is:
1. `discovered` (visible in catalog)
2. `installed` (user install exists)
3. `assigned` (mapped into `agent_abilities` for specific agents)
4. `runtime_validated` (handshake passes policy/compatibility/revocation checks)
5. `active` (eligible for execution)
6. `revoked` or `force_disabled` (execution blocked until remediated)

Notes:
- Install without assignment does not enable execution.
- Assignment without valid runtime handshake does not enable execution.

## Runtime Enforcement Pipeline
Before executing a registry-managed tool:
1. Resolve agent assignment and local enablement/config (`agent_abilities`).
2. Resolve installed/pinned skill version for current user.
3. Perform runtime handshake (direct or short-lived cache).
4. Enforce:
   - install state is `installed`
   - policy status is `approved`
   - app version is inside compatibility range
   - `forceDisable.required` is `false`
5. Enforce permission broker for any world interaction.
6. Execute tool only if all gates pass.
7. Record invocation outcome and policy decision telemetry.

Core tool behavior:
- Core tools remain available even when registry is degraded.
- Core tools are not gated by registry handshake.

## Revocation And Advisory Semantics
- Registry advisories are authoritative for registry-managed tools.
- Revocation/security advisories can trigger force-disable.
- Force-disable overrides local enabled toggles in production mode.
- Forced-disabled tools must show explicit reason in UI and diagnostics.

## Orchestration Capability Semantics
- Delegated tasks can require explicit ability keys.
- Reassignment checks must validate required abilities on target agent.
- Missing/disabled required abilities must block execution and emit machine-readable reasons.
- Orchestration diagnostics must expose capability mismatches and blocked transitions.

## OpenClaw World-Interaction Guardrails
For OpenClaw-aligned production execution, registry-managed tools must run under deny-by-default permission controls:
- Network access: domain allowlist
- Filesystem access: scoped path allowlist
- Browser automation: guarded action categories
- Process execution: explicit restricted command policy

Additional requirements:
- No direct raw environment secret access from skills.
- Use brokered scoped credentials only.
- Audit every world-action invocation with agent, skill, version, permission scope, and outcome.

## Reliability And Degraded Mode
When registry is unavailable:
- Core tools continue operating.
- New registry installs/updates are blocked.
- Registry-managed tools become `sync_stale` until validation resumes.
- Runtime execution of registry-managed tools must remain safe-by-default.

Operational targets:
- Fast advisory propagation for force-disable.
- Automatic recovery of advisory sync loop after transient failures.
- Bounded retry/backoff for registry calls.

## Observability And Release Gates

### Required Telemetry
- Registry request success/failure by endpoint
- Install/assign success rates
- Runtime handshake decision outcomes
- Force-disable event count and time-to-apply
- Blocked execution counts by reason
- Advisory sync cursor progress and lag

### Required Test Gates
- Unit: policy/handshake evaluation and permission broker enforcement
- Integration: install -> assign -> validate -> execute path
- Security: revocation enforcement, permission escalation denial, token/secret leak prevention
- Resilience: registry outage/degraded mode recovery

## Current UI Expectations
- Agent tools UI must distinguish `core` vs `registry-managed` tools.
- Core tools are shown as non-disableable.
- Registry-managed tools should show lifecycle/enforcement state (`installed`, `pinned`, `revoked`, `force_disabled`, `sync_stale`).
- Disabled reasons should be explicit for policy, compatibility, and advisory blocks.

## Implementation TODO Checklist
- [x] Add `skills_registry_client.rs` with typed request/response contracts for catalog, install, assign, handshake, and advisory feed endpoints.
- [x] Add Tauri commands for registry skill lifecycle operations and register them in `tauri::generate_handler!`.
- [x] Add registry auth header injection using in-memory `AuthState` session token only.
- [ ] Add startup skills bootstrap flow (installed skills sync + diagnostics status).
- [ ] Add advisory sync loop with cursor checkpoint persistence and retry/backoff.
- [x] Add runtime handshake gate for all registry-managed tool executions.
- [x] Add compatibility and `forceDisable.required` hard-block checks before execution.
- [ ] Add permission broker for world-action categories (`network`, `filesystem`, `browser`, `process`) with deny-by-default behavior.
- [ ] Add structured audit events for each registry-managed invocation (agent, skill, version, scope, outcome).
- [x] Add UI source markers (`core` vs `registry-managed`) and lifecycle/status badges.
- [x] Add explicit disabled-reason messaging in agent tools UI for policy/compatibility/advisory blocks.
- [ ] Add orchestration capability prechecks for required ability keys on delegation and reassignment paths.
- [ ] Add degraded-mode handling: core tools continue, registry installs/updates blocked, registry tools marked `sync_stale`.
- [ ] Add observability metrics for install/assign/handshake/advisory propagation and blocked executions.
- [ ] Add unit tests for handshake decision logic and permission broker policy.
- [ ] Add integration tests for install -> assign -> runtime validate -> execute path.
- [ ] Add security tests for revocation enforcement, permission escalation denial, and token redaction in logs/errors.
- [ ] Add resilience tests for registry outage recovery and advisory sync restart behavior.
