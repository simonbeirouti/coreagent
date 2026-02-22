# Tauri Command Audit (Frontend Hot Paths)

This audit identifies high-traffic command paths and batching candidates without changing the DB boundary.

## High-Traffic Frontend Paths

## 1) Chat lifecycle

- `list_conversations`
- `get_conversation_messages`
- `create_conversation`
- `send_message`
- `send_message_streaming`
- `edit_message_streaming`

These are user-interactive and can fire repeatedly in active chat sessions.

## 2) Agent lifecycle

- `list_agents`
- `get_agent`
- `create_agent`
- `update_agent`
- `delete_agent`

These drive primary list/detail routes and setup flows.

## 3) Dashboard and quality metrics

- `list_agent_abilities`
- `get_agent_skill_ratings`
- `get_agent_skill_rating_trends`
- `get_agent_retrieval_quality_summary`
- `get_agent_retrieval_quality_timeseries`

These are often loaded together and are good aggregate-command candidates.

## Current Frontend Alignment

- High-traffic agent/conversation hooks now use a typed command client (`src/lib/tauri-command-client.ts`).
- Optimistic update + scoped invalidation behavior is preserved in existing hooks.
- Cache-first query policy is explicitly applied in core agent/conversation query hooks.

## Batching / Aggregate Candidates

1. `get_agent_dashboard_snapshot(agentId, days?)`
   - Combines abilities + skill ratings + trend series + memory quality summary + timeseries.
   - Reduces dashboard render fan-out and startup IPC overhead.

2. `get_conversation_page(conversationId)`
   - Returns conversation metadata + messages in one command for route entry.
   - Reduces sequential detail/message fetches during chat initialization.

3. `list_agents_with_latest_activity(userId)`
   - Joins agent list with recent conversation/message metadata.
   - Avoids N+1 follow-up calls for list decorations.

## Guardrails For Future Changes

- Any new aggregate command must still delegate to service-layer methods.
- Command handlers should not inline cross-entity policy logic.
- Frontend should consume aggregate DTOs, but mutation authority remains backend-only.
