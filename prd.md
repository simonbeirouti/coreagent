# CoreAgent Unified Delivery PRD (Active)

## Document Status
- Version: 6.2
- Last Updated: 2026-02-26
- Owner: CoreAgent Product + Platform Engineering
- Purpose: active roadmap only (completed work removed from execution backlog)

## What Changed In This Cleanup
- Completed tasks from recent implementation were removed from the active backlog.
- Historical narrative/status-log sections were trimmed to reduce noise.
- Remaining scope is now organized by immediate execution order.
- This document now acts as the planning gate for the next phase.

## Recently Completed (No Longer Backlog)
- Skills Graph MVP foundation shipped:
  - agent route and canvas (`/agents/$agentId/skills-graph`)
  - add/connect/layout/save/suggest interactions
  - persistence hooks (`load/save/suggest`) and query-key integration
  - graph schema/persistence table and RLS policies for `user` and `agent` ownership
  - route-level and hook-level tests
- Orchestration capability precheck enforcement expanded:
  - `create_agent_delegation` now blocks when required abilities are missing
  - `reassign_task` now applies delegation policy prechecks
  - orchestration phase tests updated for capability-block scenarios
- User profile email field restored end-to-end:
  - database schema (`user_profiles.email`)
  - Rust entity/service model updates
  - frontend type/settings wiring
- Tools/runtime visibility quality improved:
  - richer lifecycle/source/disabled-reason handling in tools UX
  - runtime sync trigger/invalidation updates in registry hooks
- Runtime hardening + skills usability follow-through shipped:
  - startup registry bootstrap sync is triggered on backend session sync
  - degraded-mode contract enforces registry mutation blocking while preserving core-tool runtime availability
  - remote/local runtime parity verifier now validates output/event consistency more strictly
  - handshake/advisory/blocked-execution observability metrics landed in registry service
  - handshake decision-matrix unit coverage added for runtime gate validation
  - explicit hard-remove path now uses destructive confirmation semantics
  - richer install/assign/unassign remediation messaging added in tools UX
  - dedicated registry diagnostics surfaced in settings/tools views
  - `attachment_read` now returns parse diagnostics metadata for UI surfaces
  - skills graph usability baseline shipped (search control, post-search filtering, edge typing selector, human-review apply flow for suggestions)
- P0 release-gate validation coverage shipped:
  - lifecycle integration tests now cover install -> assign -> runtime validate and revocation force-disable transitions
  - resilience/security coverage expanded for advisory sync recovery, permission-escalation blocking, and token-redaction assertions in auth failures

## Active Priorities (Canonical Order)
- Current execution scope: Phase 4 go/no-go and backlog prioritization.

### P0 - Runtime Hardening Closure
- Completed in 6.1; removed from active backlog.

### P0 - Release Gates (Must Pass Before Phase 4)
- Completed in 6.2; removed from active backlog.

### P1 - Skills Interaction UX/Policy Completion
- Completed in 6.1; removed from active backlog.

### P1 - Skills Graph Week-1/2 Usability Follow-Through
- Completed in 6.1; removed from active backlog.

### P2 - Product Backlog
- [ ] Mobile application support for tracking jobs and messaging agents.
- [ ] Add direct bucket-to-app file sync/reconciliation for external object changes.
- [ ] Team graph module + integration (future larger module):
  - [ ] DB/RLS policy completion for team ownership
  - [ ] app/API wiring for team scope
  - [ ] UX controls for team context switching

## Next Phase Definition: Phase 4 (Sub-Agents + Automation)

### Phase 4 Objective
Move from mostly manual, single-agent execution toward reliable delegated and scheduled automation while preserving runtime safety guarantees.

### Phase 4 Entry Criteria (Go/No-Go)
- [x] P0 Runtime Hardening Closure complete.
- [x] P0 Release Gates complete and passing.
- [x] Skills Graph usability baseline ready for operational planning workflows.
- [ ] No critical open reliability/security defects in orchestration/runtime paths.

### Planned Phase 4 Scope (When Entry Criteria Pass)
- Capability-aware delegation/reassignment across orchestration paths.
- Durable orchestration state progression with retries/heartbeats/recovery.
- Human-in-the-loop task review loop (`approved` / `rework` / `rejected`) backed by orchestration task feedback state.
- Delegation management completion (revoke/reactivate) and stronger run/task detail UX.
- Session-bound orchestration write identity (remove trust in client-supplied owner IDs).
- Unified diagnostics across orchestration + runtime execution.

Phase 4 detail PRD (implementation-aligned): `agent-to-agent.md` (v2.0).

## Execution Focus For Next Step
1. Run final reliability/security audit for orchestration/runtime critical paths.
2. If audit is clean, execute Phase 4 milestones from `agent-to-agent.md` in order (M1 -> M6).
3. Re-prioritize P2 backlog items relative to the Phase 4 milestone plan.
