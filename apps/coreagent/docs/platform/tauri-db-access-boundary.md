# Tauri DB Access Boundary

This document defines the runtime boundary for data access in CoreAgent.

## Boundary Contract

- Frontend owns UI state, optimistic UX, and cache persistence.
- Frontend calls backend commands through Tauri IPC only.
- Backend owns all database access, validation, authorization, and transactions.
- Heavy/long-running work remains backend-owned (orchestration, retrieval scoring, adaptation loops, runtime jobs).

## Ownership Split

### Frontend (`apps/coreagent/src`)

- TanStack Query cache keys and hydration (`lib/query-keys.ts`, `lib/tauri-store.ts`, `providers/query-provider.tsx`)
- Optimistic updates and rollback in hooks (for example `hooks/useAgents.ts`, `hooks/useConversations.ts`)
- Command invocation through typed client surface (`lib/tauri-command-client.ts`)

### Backend (`apps/coreagent/src-tauri/src`)

- Tauri command registration and IPC entry points (`lib.rs`)
- Service-level business rules (`agent_service.rs`, `conversation_service.rs`, `orchestration_service.rs`, `memory_service.rs`, `feedback_service.rs`, `ability_service.rs`)
- Database pool and query execution (`db.rs` + services)

## Non-Negotiable Rules

1. Do not add direct DB clients in the frontend for core platform entities.
2. Do not move policy checks or multi-entity invariants into React hooks.
3. Keep command handlers thin and delegate behavior to service modules.
4. Keep optimistic updates in frontend, but reconcile against backend response truth.

## Allowed Exceptions

- Local-only preference/state storage not shared with backend invariants.
- Read-only local data where security and transactional guarantees are not required.

## Why This Boundary Exists

- Prevents credential exposure and policy bypass.
- Preserves transaction guarantees for multi-step writes.
- Keeps heavy computation and retries out of the UI thread.
- Retains a single authoritative place for behavior changes and audits.
