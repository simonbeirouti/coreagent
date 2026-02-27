import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createElement, type ReactNode } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { createTestQueryClient } from '@/test/utils';
import {
  OrchestrationEventRecord,
  OrchestrationRun,
  OrchestrationTask,
  useCreateOrchestrationRun,
  useOrchestrationEvents,
  useOrchestrationRuns,
  useReassignOrchestrationTask,
  useSubmitOrchestrationTaskFeedback,
} from './useOrchestration';
import { orchestrationKeys } from '@/lib/query-keys';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  Channel: class {},
}));

vi.mock('@/lib/tauri-store', () => ({
  getCachedData: vi.fn(() => undefined),
  getCachedDataUpdatedAt: vi.fn(() => undefined),
}));

describe('useOrchestration', () => {
  it('loads runs by parent agent', async () => {
    const invokeMock = vi.mocked(invoke);
    const runs: OrchestrationRun[] = [
      {
        id: 'run-1',
        parent_agent_id: 'agent-1',
        owner_user_id: 'user-1',
        title: 'Run 1',
        objective: 'Objective 1',
        status: 'queued',
        priority: 'normal',
        created_at: '2026-02-16T00:00:00.000Z',
        updated_at: '2026-02-16T00:00:00.000Z',
      },
    ];
    invokeMock.mockResolvedValueOnce(runs);

    const queryClient = createTestQueryClient();
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: queryClient }, children);

    const { result } = renderHook(() => useOrchestrationRuns('agent-1'), { wrapper });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toEqual(runs);
    expect(invokeMock).toHaveBeenCalledWith('list_orchestration_runs', { parentAgentId: 'agent-1' });
  });

  it('applies optimistic run creation and reconciles temp id on success', async () => {
    const invokeMock = vi.mocked(invoke);
    const queryClient = createTestQueryClient();
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: queryClient }, children);

    const baselineRun: OrchestrationRun = {
      id: 'baseline-run',
      parent_agent_id: 'agent-1',
      owner_user_id: 'user-1',
      title: 'Baseline',
      objective: 'Baseline objective',
      status: 'planned',
      priority: 'normal',
      created_at: '2026-02-16T00:00:00.000Z',
      updated_at: '2026-02-16T00:00:00.000Z',
    };
    queryClient.setQueryData(orchestrationKeys.runs('agent-1'), [baselineRun]);

    let resolveCreate!: (value: OrchestrationRun) => void;
    const createPromise = new Promise<OrchestrationRun>((resolve) => {
      resolveCreate = resolve;
    });
    invokeMock.mockImplementationOnce(async (command) => {
      if (command === 'create_orchestration_run') {
        return createPromise;
      }
      throw new Error(`unexpected command: ${String(command)}`);
    });

    const { result } = renderHook(() => useCreateOrchestrationRun('agent-1'), { wrapper });
    const mutatePromise = result.current.mutateAsync({
      parent_agent_id: 'agent-1',
      title: 'New Run',
      objective: 'New objective',
      priority: 'high',
    });

    let tempId = '';
    await waitFor(() => {
      const optimisticRuns = queryClient.getQueryData<OrchestrationRun[]>(orchestrationKeys.runs('agent-1')) ?? [];
      expect(optimisticRuns).toHaveLength(2);
      expect(optimisticRuns[0]?.id.startsWith('temp-run-')).toBe(true);
      tempId = optimisticRuns[0]!.id;
    });

    resolveCreate({
      id: 'server-run-1',
      parent_agent_id: 'agent-1',
      owner_user_id: 'user-1',
      title: 'Server Run',
      objective: 'Server objective',
      status: 'queued',
      priority: 'high',
      created_at: '2026-02-16T00:01:00.000Z',
      updated_at: '2026-02-16T00:01:00.000Z',
    });

    await mutatePromise;

    const settledRuns = queryClient.getQueryData<OrchestrationRun[]>(orchestrationKeys.runs('agent-1')) ?? [];
    expect(settledRuns.map((value) => value.id)).toContain('server-run-1');
    expect(settledRuns.map((value) => value.id)).not.toContain(tempId);
    expect(invokeMock).toHaveBeenCalledWith('create_orchestration_run', {
      request: {
        parent_agent_id: 'agent-1',
        title: 'New Run',
        objective: 'New objective',
        priority: 'high',
      },
    });
  });

  it('rolls back optimistic run creation on error', async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockRejectedValueOnce(new Error('create run failed'));

    const queryClient = createTestQueryClient();
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: queryClient }, children);

    const baselineRuns: OrchestrationRun[] = [
      {
        id: 'baseline-run',
        parent_agent_id: 'agent-1',
        owner_user_id: 'user-1',
        title: 'Baseline',
        objective: 'Baseline objective',
        status: 'planned',
        priority: 'normal',
        created_at: '2026-02-16T00:00:00.000Z',
        updated_at: '2026-02-16T00:00:00.000Z',
      },
    ];
    queryClient.setQueryData(orchestrationKeys.runs('agent-1'), baselineRuns);

    const { result } = renderHook(() => useCreateOrchestrationRun('agent-1'), { wrapper });
    await expect(
      result.current.mutateAsync({
        parent_agent_id: 'agent-1',
        title: 'Should fail',
        objective: 'Fail objective',
      })
    ).rejects.toThrow('create run failed');

    expect(queryClient.getQueryData(orchestrationKeys.runs('agent-1'))).toEqual(baselineRuns);
  });

  it('rolls back optimistic task reassignment on error', async () => {
    const invokeMock = vi.mocked(invoke);

    const queryClient = createTestQueryClient();
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: queryClient }, children);

    const tasks: OrchestrationTask[] = [
      {
        id: 'task-1',
        run_id: 'run-1',
        owner_agent_id: 'agent-1',
        title: 'Task',
        status: 'queued',
        task_order: 0,
        attempt_count: 0,
        max_retries: 3,
        heartbeat_progress: 0,
        created_at: '2026-02-16T00:00:00.000Z',
        updated_at: '2026-02-16T00:00:00.000Z',
      },
    ];
    queryClient.setQueryData(orchestrationKeys.tasks('run-1'), tasks);

    let rejectReassign!: (error?: unknown) => void;
    const reassignPromise = new Promise<OrchestrationTask>((_resolve, reject) => {
      rejectReassign = reject;
    });
    invokeMock.mockImplementationOnce(async (command) => {
      if (command === 'reassign_orchestration_task') {
        return reassignPromise;
      }
      throw new Error(`unexpected command: ${String(command)}`);
    });

    const { result } = renderHook(() => useReassignOrchestrationTask('run-1'), { wrapper });
    const mutatePromise = result.current.mutateAsync({
      taskId: 'task-1',
      newOwnerAgentId: 'agent-2',
      requestedByAgentId: 'agent-1',
    });

    await waitFor(() => {
      const optimisticTasks = queryClient.getQueryData<OrchestrationTask[]>(orchestrationKeys.tasks('run-1')) ?? [];
      expect(optimisticTasks[0]?.owner_agent_id).toBe('agent-2');
    });

    rejectReassign(new Error('reassign failed'));
    await expect(mutatePromise).rejects.toThrow('reassign failed');

    const rolledBackTasks = queryClient.getQueryData<OrchestrationTask[]>(orchestrationKeys.tasks('run-1')) ?? [];
    expect(rolledBackTasks[0]?.owner_agent_id).toBe('agent-1');
  });

  it('loads run events', async () => {
    const invokeMock = vi.mocked(invoke);
    const events: OrchestrationEventRecord[] = [
      {
        id: 'event-1',
        run_id: 'run-1',
        task_id: 'task-1',
        event_type: 'task.created',
        severity: 'info',
        payload: {},
        created_at: '2026-02-26T00:00:00.000Z',
      },
    ];
    invokeMock.mockResolvedValueOnce(events);
    const queryClient = createTestQueryClient();
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: queryClient }, children);

    const { result } = renderHook(() => useOrchestrationEvents('run-1', 50), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(events);
    expect(invokeMock).toHaveBeenCalledWith('list_orchestration_events', { runId: 'run-1', limit: 50 });
  });

  it('submits task feedback without client user id', async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      id: 'feedback-1',
      task_id: 'task-1',
      run_id: 'run-1',
      user_id: 'user-1',
      verdict: 'approved',
      notes: null,
      created_at: '2026-02-26T00:00:00.000Z',
    });
    const queryClient = createTestQueryClient();
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: queryClient }, children);

    const { result } = renderHook(() => useSubmitOrchestrationTaskFeedback('run-1'), { wrapper });
    await result.current.mutateAsync({
      taskId: 'task-1',
      verdict: 'approved',
      notes: null,
      requestedByAgentId: 'agent-1',
    });
    expect(invokeMock).toHaveBeenCalledWith('submit_orchestration_task_feedback', {
      taskId: 'task-1',
      verdict: 'approved',
      notes: null,
      requestedByAgentId: 'agent-1',
    });
  });
});
