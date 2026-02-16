# Orchestration Job Assignment Board

This guide documents the current board-based orchestration flow on the root route (`/`), including drag/drop rules and assignment behavior.

## Overview

The board visualizes agents in three lanes:

- `Idle Queue`: agent has no active assignment context yet
- `Working Now`: agent is actively attached to work
- `Ready For Review`: agent work is complete and ready for review/handoff

Lane placement is persisted locally per agent so board position remains stable across refreshes.

## Current Lane Movement Rules

## Allowed

- Reorder inside the same lane
- Move between lanes, except where blocked below

## Blocked

- `Idle -> Ready For Review` is hard-blocked.
- No modal or alert is shown for this move; drop is ignored.

Reason: an idle agent has no active execution context to review.

## Guarded Move: Idle -> Working

Moving an agent from `Idle` to `Working` opens a task-context dialog:

1. System loads open tasks for that agent from orchestration runs.
2. If open tasks exist (`queued`, `planned`, `waiting`), user can confirm the move.
3. If no open tasks exist, user is guided to open the assignment wizard.

This prevents moving to `Working` without execution context.

## Create Job Assignment Flow

Use `Create Job Assignment` from the board header to run the guided assignment wizard.

Wizard steps:

1. Select agent
2. Define run
3. Sub-agent setup (optional delegation)
4. Task assignment
5. Updates and memory
6. Review and create

On success, the assigned task owner is moved to `Working`.

## Data Operations Triggered By Assignment

When an assignment is created, the flow can perform:

- Delegation creation (if child agent was provided and not already active)
- Run creation
- Optional run status update
- Task creation
- Optional schedule setup
- Optional memory seed upsert
- Query invalidation for delegations, runs, tasks, and diagnostics

## UX Guidance

Current behavior favors explicit task context over implicit automation:

- For `Idle -> Working`, show available tasks first.
- Only allow direct move when task context exists.
- Route users to the wizard when context is missing.

This keeps orchestration state coherent and avoids hidden auto-assignment behavior.
