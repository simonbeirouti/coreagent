import { renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { createTestQueryClient } from '@/test/utils';
import { useSaveSkillsGraph, useSkillsGraph, useSuggestSkillsGraphConnections } from './useSkillsGraph';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

describe('useSkillsGraph', () => {
  it('loads graph snapshot by owner', async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      ownerType: 'user',
      ownerId: 'self',
      version: 1,
      graphJson: { nodes: [], edges: [], viewport: {} },
      updatedAt: null,
    });

    const queryClient = createTestQueryClient();
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: queryClient }, children);

    const { result } = renderHook(() => useSkillsGraph('user'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invokeMock).toHaveBeenCalledWith('load_skills_graph', { ownerType: 'user', ownerId: null });
  });

  it('saves graph snapshot', async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      ownerType: 'user',
      ownerId: 'self',
      version: 2,
      graphJson: { nodes: [{ id: 'n1' }], edges: [], viewport: {} },
      updatedAt: null,
    });

    const queryClient = createTestQueryClient();
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: queryClient }, children);
    const { result } = renderHook(() => useSaveSkillsGraph('user'), { wrapper });

    await result.current.mutateAsync({ nodes: [{ id: 'n1' }], edges: [], viewport: {} });
    expect(invokeMock).toHaveBeenCalledWith('save_skills_graph', {
      ownerType: 'user',
      ownerId: null,
      graphJson: { nodes: [{ id: 'n1' }], edges: [], viewport: {} },
    });
  });

  it('requests AI connection suggestions with contract payload', async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      proposedNodes: [],
      proposedEdges: [],
    });

    const queryClient = createTestQueryClient();
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: queryClient }, children);
    const { result } = renderHook(() => useSuggestSkillsGraphConnections(), { wrapper });

    await result.current.mutateAsync({ nodes: [], edges: [], viewport: {} });
    expect(invokeMock).toHaveBeenCalledWith('suggest_skills_graph_connections', {
      request: {
        graphJson: { nodes: [], edges: [], viewport: {} },
      },
    });
  });
});
