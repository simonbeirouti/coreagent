# Agent-to-Agent Orchestration
## Product Requirements Document (Implementation-Aligned)

**CoreAgent Platform | February 2026**

| Field | Value |
|---|---|
| Status | Draft v2.0 (aligned to current stack) |
| Stack | Rust (Tauri backend) · Vite + React (frontend) · Supabase Postgres |
| Runtime Integration | `apps/server` runtime APIs + `apps/runner` queue/worker |
| Scope | Delegation, run/task lifecycle, retries, memory, diagnostics, incremental review loop |
| Authors | CoreAgent Product + Platform Engineering |

---

## 1. Executive Summary

This PRD defines the next iteration of A2A orchestration based on what is already shipping in CoreAgent today.

Current implementation already provides:
- orchestration persistence and RLS-backed tables,
- Tauri commands for run/task/delegation/heartbeat/memory/schedule operations,
- scheduler tick + stale/retry recovery,
- board-first assignment UX on the root route.

This document focuses on closing functional gaps through incremental, low-risk changes that fit the existing architecture.

---

## 2. Product Direction

### 2.1 Goals

- Keep orchestration state authoritative in Postgres and mutate it through typed Tauri commands.
- Improve lifecycle correctness (status transitions, retries, stale handling, recovery).
- Add human review loop for tasks without introducing a new orchestration runtime engine.
- Improve observability for operators and end users.
- Preserve runtime safety and policy controls already used by registry-managed tool execution.

### 2.2 Non-Goals (This Iteration)

- Full rig-core orchestration engine rewrite.
- Autonomous multi-agent planning pipelines with unconstrained concurrency.
- Multi-user collaborative runs.
- Token-level stream fanout for each orchestration task.

---

## 3. Current Baseline (As Implemented)

### 3.1 Data Model

The following are already present and in use:
- `agent_delegations`
- `orchestration_runs`
- `orchestration_projects`
- `orchestration_project_selections`
- `orchestration_tasks`
- `orchestration_task_attempts`
- `orchestration_delegations`
- `orchestration_events`
- `orchestration_heartbeats`
- `orchestration_memories`
- `orchestration_schedules`

### 3.2 Backend Surface (Tauri)

Implemented command families:
- Project: create/list/get current/set current
- Run: create/list/get/update status, pause/resume/cancel
- Task: create/list/update, retry, reassign
- Delegation: create/list, delegation audit insert
- Memory: upsert/list/promote
- Heartbeat: upsert
- Diagnostics: run diagnostics, scheduler tick, recovery

### 3.3 Frontend Surface

Implemented today:
- Root orchestration board (`Idle`, `Working`, `Ready for Review`)
- Project-first creation flow with manager provisioning
- Guided assignment wizard (run + optional delegation + task + schedule + memory seed)
- Runtime console integration for tool-run progress
- Floating manager chat for requirement clarification on the board

Gaps in UX depth:
- No dedicated run detail page with integrated event timeline.
- No task review drawer with verdict workflow.
- No explicit delegation revoke workflow in UI.

---

## 4. Architecture (Target for This Iteration)

| Layer | Technology | Responsibility |
|---|---|---|
| Frontend | Vite + React + TanStack Query | Board UX, run/task views, review actions, diagnostics visibility |
| Command Layer | Tauri v2 commands | Typed boundary; validates and mutates orchestration state |
| Orchestration Core | `orchestration_service.rs` | Lifecycle/state machine, policy checks, retries, scheduler, recovery |
| Persistence | Supabase/Postgres + RLS | Source of truth for orchestration entities |
| Runtime Execution | `apps/server` + `apps/runner` | Tool/runtime execution, events, safety gates |

Design principle: keep orchestration deterministic and DB-driven first; integrate runtime/tool execution as explicit task actions.

---

## 5. Requirements and Changes

### 5.1 API Contract Stabilization

Keep existing commands and add missing orchestration operations needed for full loop:
- `get_task_detail(task_id)`
- `submit_task_feedback(task_id, verdict, notes)`
- `skip_task(task_id, reason)`
- `revoke_agent_delegation(delegation_id)`
- `reactivate_agent_delegation(delegation_id)` (optional explicit command; current behavior is upsert-based reactivation)

Refine existing command semantics:
- `list_orchestration_runs` adds optional `status` filter + pagination fields.
- `get_orchestration_run` returns run + task summary + latest heartbeat summary.
- `reassign_orchestration_task` optionally records explicit `manual_override` delegation event.

### 5.2 Data Model Additions

Add:
- `orchestration_task_feedback`
- `orchestration_projects`
- `orchestration_project_selections`

```sql
CREATE TABLE orchestration_task_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES orchestration_tasks(id) ON DELETE CASCADE,
  run_id UUID NOT NULL REFERENCES orchestration_runs(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  verdict TEXT NOT NULL CHECK (verdict IN ('approved', 'rework', 'rejected')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

RLS pattern must follow run-ownership chain used by existing orchestration tables.

### 5.3 Lifecycle and Retry Behavior

- Keep existing exponential retry/backoff model.
- Continue scheduler-based release of `waiting` tasks to `queued` when `next_retry_at` is due.
- Add explicit skip terminal path for tasks (`cancelled` + reason payload event).
- Maintain strict transition validation; reject invalid transitions with structured error codes.

### 5.4 Heartbeat and Staleness

- Keep scheduler-driven stale detection in `run_scheduler_tick`.
- Expose threshold as configurable setting (default remains conservative until tuned).
- Surface stale tasks clearly in diagnostics and task UI actions.

### 5.5 Delegation and Policy

- Preserve delegation policy checks (role + ability constraints + active topology).
- Add delegation revoke command/UI flow (`is_active = false`).
- Require manual override reason when bypassing policy checks.

### 5.6 Review Loop (Human-in-the-Loop)

Introduce minimal but complete review loop:
- Task reaches `completed`.
- User can submit verdict (`approved`, `rework`, `rejected`).
- `rework` triggers retry path (subject to retry budget).
- `approved` leaves task terminal-complete and allows run progression logic.

Run progression remains rule-based in service layer for this phase (not LLM-orchestrated pipeline).

### 5.7 Project Bootstrap Automation

When a project is created, orchestration must proceed immediately:
- create manager-owned bootstrap tasks (requirements intake, backlog generation, dispatch planning),
- transition the first intake task to active work,
- ensure backlog population is visible in the board,
- start manager kickoff conversation and request clarifying questions + initial plan,
- bind the project to exactly one dedicated manager conversation (`orchestration_projects.manager_conversation_id`) so chat history remains project-scoped.

This removes the “project created but idle” gap.

### 5.8 Project-Scoped Manager Chat Context

Manager chat must be project-aware by default:
- no fallback to generic agent conversations for project chat,
- every manager message is sent through a project-aware command that injects live project context (objective, run state, backlog/work counts, recent tasks),
- project switch immediately switches chat thread to that project’s bound manager conversation.

### 5.9 Persistence Standard

Client orchestration/project state must be persisted through TanStack Query + tauri-store cache hydration flow.
- Do not use browser `localStorage` for cross-device orchestration/project state.
- Fast hydration should read from persisted query cache keys.

### 5.10 Observability Standardization

Standardize `orchestration_events.event_type` taxonomy to predictable dotted names:
- `run.created`, `run.status_changed`, `run.recovered`
- `task.created`, `task.status_changed`, `task.retried`, `task.reassigned`, `task.skipped`
- `delegation.allowed`, `delegation.blocked`, `delegation.manual_override`
- `heartbeat.updated`, `heartbeat.stale`
- `memory.upserted`, `memory.promoted`
- `schedule.updated`
- `feedback.submitted`

Keep `purge_old_orchestration_events` retention in scheduler path.

### 5.11 Security and Identity Integrity

Current risk: client-provided user IDs in create flows.

Required change:
- Bind orchestration write identity to authenticated session state in Tauri command handlers.
- Treat client-supplied owner fields as hints or remove them from public command payloads.
- Keep policy and install-state gates for runtime tool execution unchanged.

---

## 6. Frontend UX Plan

### 6.1 Keep and Harden Board-First Flow

Retain root route orchestration board as primary creation and execution surface.
Project creation is manager-first and should trigger immediate bootstrap automation.

### 6.2 Add Run Detail Surface

Add focused run detail view:
- run status/actions,
- ordered task list with status/attempt/heartbeat,
- event timeline,
- diagnostics summary (stale count, schedule state).

### 6.3 Add Task Detail/Review Surface

Add task detail panel or drawer:
- metadata + attempt history,
- relevant memories,
- reassignment actions,
- retry/skip controls,
- feedback submission controls.
- manager chat surface for requirement Q&A with project-bound conversation context.

### 6.4 Delegation Management UX

Add explicit delegation management controls:
- list active/inactive child delegations,
- create/update role/scope,
- revoke/reactivate.

---

## 7. Milestones

| Milestone | Scope | Est. Effort |
|---|---|---|
| M1 | Command contract stabilization + task detail/skip/revoke APIs | 1 week |
| M2 | `orchestration_task_feedback` migration + feedback command flow | 1 week |
| M3 | Run detail + task detail/review UX | 1.5 weeks |
| M4 | Event taxonomy standardization + diagnostics polish | 1 week |
| M5 | Session-bound identity enforcement for orchestration writes | 1 week |
| M6 | Reliability pass (tests + transition/retry/stale edge cases) | 1 week |
| M7 | Project bootstrap automation + manager chat hardening | 1 week |

Total: ~7.5 weeks.

---

## 8. Acceptance Criteria

- All run/task/delegation/memory lifecycle operations are available via stable typed commands.
- Task review loop (`approved/rework/rejected`) is persisted and actionable.
- Delegation can be revoked/reactivated without direct DB intervention.
- Run detail and task detail UX are present and usable without CLI/SQL fallback.
- Event log taxonomy is consistent and queryable.
- Orchestration writes are session-bound and no longer trust arbitrary client user IDs.
- Retry, stale detection, and recovery behavior pass regression tests.
- Project creation immediately starts manager-led orchestration (no idle project state).
- Manager/user chat is available in-board for clarifications and requirement iteration.

---

## 9. Open Questions

1. Should stale threshold default remain at 10 minutes, or be reduced after telemetry baseline is collected?
2. Should `rejected` task verdict auto-fail task or keep it in a review-required state?
3. Should run progression be purely deterministic (status/count based) or allow optional orchestrator-agent recommendations?
4. Do we expose event export in UI now or defer until after taxonomy stabilization?

---

## 10. Implementation Note

This PRD intentionally aligns to the existing CoreAgent stack and current code paths.
Future rig-core-native orchestration can be treated as a separate architecture milestone once the service-driven orchestration loop is fully hardened.
