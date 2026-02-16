import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { invoke } from '@tauri-apps/api/core';
import { cacheFirstStaticQueryPolicy } from '@/lib/query-policies';
import { orchestrationKeys } from '@/lib/query-keys';
import { getCachedData, getCachedDataUpdatedAt } from '@/lib/tauri-store';

export interface OrchestrationRun {
  id: string;
  parent_agent_id: string;
  owner_user_id: string;
  title: string;
  objective: string;
  status: 'queued' | 'planned' | 'in_progress' | 'waiting' | 'completed' | 'failed' | 'cancelled' | 'paused';
  priority: 'low' | 'normal' | 'high';
  started_at?: string | null;
  completed_at?: string | null;
  last_error?: string | null;
  created_at: string;
  updated_at: string;
}

export interface OrchestrationTask {
  id: string;
  run_id: string;
  parent_task_id?: string | null;
  owner_agent_id: string;
  title: string;
  description?: string | null;
  status: OrchestrationRun['status'];
  task_order: number;
  idempotency_key?: string | null;
  attempt_count: number;
  max_retries: number;
  next_retry_at?: string | null;
  last_failure_reason?: string | null;
  last_heartbeat_at?: string | null;
  heartbeat_status?: string | null;
  heartbeat_progress: number;
  created_at: string;
  updated_at: string;
}

export interface AgentDelegation {
  id: string;
  parent_agent_id: string;
  child_agent_id: string;
  role: 'planner' | 'researcher' | 'executor' | 'reviewer' | 'custom';
  ownership_scope: 'delegated' | 'shared' | 'observer';
  is_active: boolean;
  created_by_user_id: string;
  created_at: string;
  updated_at: string;
}

export interface OrchestrationMemory {
  id: string;
  run_id: string;
  task_id?: string | null;
  agent_id: string;
  scope: 'private' | 'shared_run' | 'parent_visible';
  key: string;
  summary?: string | null;
  payload: Record<string, unknown>;
  promoted_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface OrchestrationSchedule {
  id: string;
  run_id: string;
  enabled: boolean;
  interval_minutes: number;
  next_run_at?: string | null;
  last_run_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface StaleTask {
  task_id: string;
  title: string;
  status: string;
  last_heartbeat_at?: string | null;
  minutes_since_heartbeat: number;
}

export interface OrchestrationDiagnostics {
  run: OrchestrationRun;
  task_counts_by_status: Record<string, number>;
  stale_tasks: StaleTask[];
  latest_heartbeat_at?: string | null;
  schedule?: OrchestrationSchedule | null;
}

interface CreateRunRequest {
  parent_agent_id: string;
  owner_user_id: string;
  title: string;
  objective: string;
  priority?: 'low' | 'normal' | 'high';
}

interface CreateDelegationRequest {
  parent_agent_id: string;
  child_agent_id: string;
  role: AgentDelegation['role'];
  ownership_scope?: AgentDelegation['ownership_scope'];
  created_by_user_id: string;
}

interface CreateTaskRequest {
  run_id: string;
  parent_task_id?: string;
  owner_agent_id: string;
  title: string;
  description?: string;
  task_order?: number;
  idempotency_key?: string;
  max_retries?: number;
}

interface UpsertMemoryRequest {
  run_id: string;
  task_id?: string;
  agent_id: string;
  scope: OrchestrationMemory['scope'];
  key: string;
  summary?: string;
  payload?: Record<string, unknown>;
}

function upsertRun(runs: OrchestrationRun[] = [], next: OrchestrationRun): OrchestrationRun[] {
  const replaced = runs.map((run) => (run.id === next.id ? next : run));
  if (replaced.some((run) => run.id === next.id)) {
    return replaced;
  }
  return [next, ...replaced];
}

function upsertTask(tasks: OrchestrationTask[] = [], next: OrchestrationTask): OrchestrationTask[] {
  const replaced = tasks.map((task) => (task.id === next.id ? next : task));
  if (replaced.some((task) => task.id === next.id)) {
    return replaced;
  }
  return [...replaced, next];
}

function upsertMemory(memories: OrchestrationMemory[] = [], next: OrchestrationMemory): OrchestrationMemory[] {
  const replaced = memories.map((memory) => (memory.id === next.id ? next : memory));
  if (replaced.some((memory) => memory.id === next.id)) {
    return replaced;
  }
  return [next, ...replaced];
}

export function useAgentDelegations(agentId: string) {
  const queryKey = orchestrationKeys.delegations(agentId);
  const initialData = getCachedData<AgentDelegation[]>(queryKey);
  const initialDataUpdatedAt = getCachedDataUpdatedAt(queryKey);

  return useQuery({
    queryKey,
    queryFn: async (): Promise<AgentDelegation[]> => invoke('list_agent_delegations', { parentAgentId: agentId }),
    enabled: !!agentId,
    initialData,
    initialDataUpdatedAt,
    ...cacheFirstStaticQueryPolicy,
  });
}

export function useCreateAgentDelegation(agentId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (request: CreateDelegationRequest): Promise<AgentDelegation> =>
      invoke('create_agent_delegation', { request }),
    onMutate: async (request) => {
      await queryClient.cancelQueries({ queryKey: orchestrationKeys.delegations(agentId) });
      const previousDelegations = queryClient.getQueryData<AgentDelegation[]>(orchestrationKeys.delegations(agentId));
      const tempId = `temp-delegation-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const optimistic: AgentDelegation = {
        id: tempId,
        parent_agent_id: request.parent_agent_id,
        child_agent_id: request.child_agent_id,
        role: request.role,
        ownership_scope: request.ownership_scope ?? 'delegated',
        is_active: true,
        created_by_user_id: request.created_by_user_id,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      queryClient.setQueryData<AgentDelegation[]>(orchestrationKeys.delegations(agentId), (old = []) => {
        const withoutExisting = old.filter((value) => value.child_agent_id !== optimistic.child_agent_id);
        return [optimistic, ...withoutExisting];
      });
      return { previousDelegations, tempId };
    },
    onError: (_error, _request, context) => {
      if (!context) return;
      queryClient.setQueryData(orchestrationKeys.delegations(agentId), context.previousDelegations ?? []);
    },
    onSuccess: (delegation, _request, context) => {
      queryClient.setQueryData<AgentDelegation[]>(orchestrationKeys.delegations(agentId), (old = []) => {
        const withoutTemp = context?.tempId ? old.filter((value) => value.id !== context.tempId) : old;
        const withoutExisting = withoutTemp.filter((value) => value.child_agent_id !== delegation.child_agent_id);
        return [delegation, ...withoutExisting];
      });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: orchestrationKeys.delegations(agentId) });
    },
  });
}

export function useOrchestrationRuns(agentId: string) {
  const queryKey = orchestrationKeys.runs(agentId);
  const initialData = getCachedData<OrchestrationRun[]>(queryKey);
  const initialDataUpdatedAt = getCachedDataUpdatedAt(queryKey);

  return useQuery({
    queryKey,
    queryFn: async (): Promise<OrchestrationRun[]> => invoke('list_orchestration_runs', { parentAgentId: agentId }),
    enabled: !!agentId,
    initialData,
    initialDataUpdatedAt,
    ...cacheFirstStaticQueryPolicy,
  });
}

export function useOrchestrationTasks(runId: string) {
  const queryKey = orchestrationKeys.tasks(runId);
  const initialData = getCachedData<OrchestrationTask[]>(queryKey);
  const initialDataUpdatedAt = getCachedDataUpdatedAt(queryKey);

  return useQuery({
    queryKey,
    queryFn: async (): Promise<OrchestrationTask[]> => invoke('list_orchestration_tasks', { runId }),
    enabled: !!runId,
    initialData,
    initialDataUpdatedAt,
    ...cacheFirstStaticQueryPolicy,
  });
}

export function useOrchestrationMemories(runId: string, viewerAgentId: string, scopeFilter: 'all' | OrchestrationMemory['scope'] = 'all') {
  const queryKey = orchestrationKeys.memories(runId, viewerAgentId, scopeFilter);
  const initialData = getCachedData<OrchestrationMemory[]>(queryKey);
  const initialDataUpdatedAt = getCachedDataUpdatedAt(queryKey);

  return useQuery({
    queryKey,
    queryFn: async (): Promise<OrchestrationMemory[]> =>
      invoke('list_orchestration_memories', {
        runId,
        viewerAgentId,
        scopeFilter,
      }),
    enabled: !!runId && !!viewerAgentId,
    initialData,
    initialDataUpdatedAt,
    ...cacheFirstStaticQueryPolicy,
  });
}

export function useOrchestrationDiagnostics(runId: string, staleAfterMinutes = 10) {
  const queryKey = orchestrationKeys.diagnostics(runId);
  const initialData = getCachedData<OrchestrationDiagnostics>(queryKey);
  const initialDataUpdatedAt = getCachedDataUpdatedAt(queryKey);

  return useQuery({
    queryKey,
    queryFn: async (): Promise<OrchestrationDiagnostics> =>
      invoke('get_orchestration_diagnostics', { runId, staleAfterMinutes }),
    enabled: !!runId,
    initialData,
    initialDataUpdatedAt,
    ...cacheFirstStaticQueryPolicy,
  });
}

export function useCreateOrchestrationRun(agentId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (request: CreateRunRequest): Promise<OrchestrationRun> =>
      invoke('create_orchestration_run', { request }),
    onMutate: async (request) => {
      await queryClient.cancelQueries({ queryKey: orchestrationKeys.runs(agentId) });
      const previousRuns = queryClient.getQueryData<OrchestrationRun[]>(orchestrationKeys.runs(agentId));
      const tempId = `temp-run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const optimistic: OrchestrationRun = {
        id: tempId,
        parent_agent_id: request.parent_agent_id,
        owner_user_id: request.owner_user_id,
        title: request.title,
        objective: request.objective,
        status: 'queued',
        priority: request.priority ?? 'normal',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      queryClient.setQueryData<OrchestrationRun[]>(orchestrationKeys.runs(agentId), (old = []) => [optimistic, ...old]);
      queryClient.setQueryData<OrchestrationRun>(orchestrationKeys.run(tempId), optimistic);
      return { previousRuns, tempId };
    },
    onError: (_error, _request, context) => {
      if (!context) return;
      queryClient.setQueryData(orchestrationKeys.runs(agentId), context.previousRuns ?? []);
      queryClient.removeQueries({ queryKey: orchestrationKeys.run(context.tempId) });
    },
    onSuccess: (run, _request, context) => {
      queryClient.setQueryData<OrchestrationRun[]>(orchestrationKeys.runs(agentId), (old = []) => {
        const withoutTemp = context?.tempId ? old.filter((r) => r.id !== context.tempId) : old;
        return upsertRun(withoutTemp, run);
      });
      queryClient.setQueryData(orchestrationKeys.run(run.id), run);
      if (context?.tempId) {
        queryClient.removeQueries({ queryKey: orchestrationKeys.run(context.tempId) });
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: orchestrationKeys.runs(agentId) });
    },
  });
}

export function useCreateOrchestrationTask(runId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (request: CreateTaskRequest): Promise<OrchestrationTask> =>
      invoke('create_orchestration_task', { request }),
    onMutate: async (request) => {
      await queryClient.cancelQueries({ queryKey: orchestrationKeys.tasks(runId) });
      const previousTasks = queryClient.getQueryData<OrchestrationTask[]>(orchestrationKeys.tasks(runId));
      const tempId = `temp-task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const optimistic: OrchestrationTask = {
        id: tempId,
        run_id: request.run_id,
        parent_task_id: request.parent_task_id ?? null,
        owner_agent_id: request.owner_agent_id,
        title: request.title,
        description: request.description ?? null,
        status: 'queued',
        task_order: request.task_order ?? 0,
        idempotency_key: request.idempotency_key ?? null,
        attempt_count: 0,
        max_retries: request.max_retries ?? 3,
        next_retry_at: null,
        last_failure_reason: null,
        heartbeat_progress: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      queryClient.setQueryData<OrchestrationTask[]>(orchestrationKeys.tasks(runId), (old = []) => [...old, optimistic]);
      return { previousTasks, tempId };
    },
    onError: (_error, _request, context) => {
      if (!context) return;
      queryClient.setQueryData(orchestrationKeys.tasks(runId), context.previousTasks ?? []);
    },
    onSuccess: (task, _request, context) => {
      queryClient.setQueryData<OrchestrationTask[]>(orchestrationKeys.tasks(runId), (old = []) => {
        const normalized = context?.tempId ? old.filter((value) => value.id !== context.tempId) : old;
        return upsertTask(normalized, task);
      });
      queryClient.invalidateQueries({ queryKey: orchestrationKeys.diagnostics(runId) });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: orchestrationKeys.tasks(runId) });
    },
  });
}

export function useUpdateOrchestrationRunStatus(agentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (params: {
      runId: string;
      status: OrchestrationRun['status'];
      lastError?: string | null;
    }): Promise<OrchestrationRun> =>
      invoke('update_orchestration_run_status', {
        runId: params.runId,
        status: params.status,
        lastError: params.lastError ?? null,
      }),
    onMutate: async (params) => {
      await queryClient.cancelQueries({ queryKey: orchestrationKeys.runs(agentId) });
      const previousRuns = queryClient.getQueryData<OrchestrationRun[]>(orchestrationKeys.runs(agentId));
      queryClient.setQueryData<OrchestrationRun[]>(orchestrationKeys.runs(agentId), (old = []) =>
        old.map((run) =>
          run.id === params.runId
            ? { ...run, status: params.status, last_error: params.lastError ?? null, updated_at: new Date().toISOString() }
            : run
        )
      );
      return { previousRuns };
    },
    onError: (_error, _params, context) => {
      if (!context) return;
      queryClient.setQueryData(orchestrationKeys.runs(agentId), context.previousRuns ?? []);
    },
    onSuccess: (run) => {
      queryClient.setQueryData<OrchestrationRun[]>(orchestrationKeys.runs(agentId), (old = []) =>
        old.map((value) => (value.id === run.id ? run : value))
      );
      queryClient.setQueryData(orchestrationKeys.run(run.id), run);
      queryClient.invalidateQueries({ queryKey: orchestrationKeys.diagnostics(run.id) });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: orchestrationKeys.runs(agentId) });
    },
  });
}

export function useRetryOrchestrationTask(runId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (params: { taskId: string; requestedByAgentId: string }): Promise<OrchestrationTask> =>
      invoke('retry_orchestration_task', params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: orchestrationKeys.tasks(runId) });
      queryClient.invalidateQueries({ queryKey: orchestrationKeys.diagnostics(runId) });
    },
  });
}

export function useReassignOrchestrationTask(runId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: {
      taskId: string;
      newOwnerAgentId: string;
      requestedByAgentId: string;
      reason?: string;
    }): Promise<OrchestrationTask> => invoke('reassign_orchestration_task', params),
    onMutate: async (params) => {
      await queryClient.cancelQueries({ queryKey: orchestrationKeys.tasks(runId) });
      const previousTasks = queryClient.getQueryData<OrchestrationTask[]>(orchestrationKeys.tasks(runId));
      queryClient.setQueryData<OrchestrationTask[]>(orchestrationKeys.tasks(runId), (old = []) =>
        old.map((task) =>
          task.id === params.taskId
            ? {
                ...task,
                owner_agent_id: params.newOwnerAgentId,
                updated_at: new Date().toISOString(),
              }
            : task
        )
      );
      return { previousTasks };
    },
    onError: (_error, _params, context) => {
      if (!context) return;
      queryClient.setQueryData(orchestrationKeys.tasks(runId), context.previousTasks ?? []);
    },
    onSuccess: (task) => {
      queryClient.setQueryData<OrchestrationTask[]>(orchestrationKeys.tasks(runId), (old = []) => upsertTask(old, task));
      queryClient.invalidateQueries({ queryKey: orchestrationKeys.diagnostics(runId) });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: orchestrationKeys.tasks(runId) });
    },
  });
}

export function useSetOrchestrationSchedule(runId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (params: { enabled: boolean; intervalMinutes?: number }): Promise<OrchestrationSchedule> =>
      invoke('set_orchestration_schedule', {
        runId,
        enabled: params.enabled,
        intervalMinutes: params.intervalMinutes ?? 15,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: orchestrationKeys.diagnostics(runId) });
    },
  });
}

export function useUpsertOrchestrationMemory(runId: string, viewerAgentId: string, scopeFilter: 'all' | OrchestrationMemory['scope'] = 'all') {
  const queryClient = useQueryClient();
  const memoryKey = orchestrationKeys.memories(runId, viewerAgentId, scopeFilter);

  return useMutation({
    mutationFn: async (request: UpsertMemoryRequest): Promise<OrchestrationMemory> =>
      invoke('upsert_orchestration_memory', { request }),
    onMutate: async (request) => {
      await queryClient.cancelQueries({ queryKey: memoryKey });
      const previousMemories = queryClient.getQueryData<OrchestrationMemory[]>(memoryKey);
      const tempId = `temp-memory-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const optimistic: OrchestrationMemory = {
        id: tempId,
        run_id: request.run_id,
        task_id: request.task_id ?? null,
        agent_id: request.agent_id,
        scope: request.scope,
        key: request.key,
        summary: request.summary ?? null,
        payload: request.payload ?? {},
        promoted_at: request.scope === 'parent_visible' ? new Date().toISOString() : null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      queryClient.setQueryData<OrchestrationMemory[]>(memoryKey, (old = []) => [optimistic, ...old]);
      return { previousMemories, tempId };
    },
    onError: (_error, _request, context) => {
      if (!context) return;
      queryClient.setQueryData(memoryKey, context.previousMemories ?? []);
    },
    onSuccess: (memory, _request, context) => {
      queryClient.setQueryData<OrchestrationMemory[]>(memoryKey, (old = []) => {
        const normalized = context?.tempId ? old.filter((value) => value.id !== context.tempId) : old;
        return upsertMemory(normalized, memory);
      });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: memoryKey });
    },
  });
}
