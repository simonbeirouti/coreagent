import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { createTestQueryClient } from '@/test/utils';
import {
  useAgentToolSettings,
  useSetAgentAbilityEnabled,
  useUpdateAgentAbilityConfig,
} from './useAbilities';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

vi.mock('@/lib/tauri-store', () => ({
  getCachedData: vi.fn(() => undefined),
  getCachedDataUpdatedAt: vi.fn(() => undefined),
}));

describe('useAbilities tool settings', () => {
  it('loads tool settings from tauri command', async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce([
      {
        agent_id: 'agent-1',
        ability_id: 'ability-1',
        ability_name: 'Vision Analysis',
        implementation_key: 'vision_analysis',
        category: 'perception',
        enabled: true,
        config: {},
        parameters_schema: {},
        is_mandatory: false,
      },
    ]);

    const queryClient = createTestQueryClient();
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: queryClient }, children);

    const { result } = renderHook(() => useAgentToolSettings('agent-1'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(invokeMock).toHaveBeenCalledWith('list_agent_tool_settings', { agentId: 'agent-1' });
  });

  it('toggles an ability enabled state', async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      implementation_key: 'vision_analysis',
      enabled: false,
    });

    const queryClient = createTestQueryClient();
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: queryClient }, children);

    const { result } = renderHook(() => useSetAgentAbilityEnabled('agent-1'), { wrapper });
    await result.current.mutateAsync({ implementationKey: 'vision_analysis', enabled: false });

    expect(invokeMock).toHaveBeenCalledWith('set_agent_ability_enabled', {
      agentId: 'agent-1',
      implementationKey: 'vision_analysis',
      enabled: false,
    });
  });

  it('updates an ability config', async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      implementation_key: 'vision_analysis',
      config: { detail: 'low' },
    });

    const queryClient = createTestQueryClient();
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: queryClient }, children);

    const { result } = renderHook(() => useUpdateAgentAbilityConfig('agent-1'), { wrapper });
    await result.current.mutateAsync({
      implementationKey: 'vision_analysis',
      config: { detail: 'low' },
    });

    expect(invokeMock).toHaveBeenCalledWith('update_agent_ability_config', {
      agentId: 'agent-1',
      implementationKey: 'vision_analysis',
      config: { detail: 'low' },
    });
  });
});
