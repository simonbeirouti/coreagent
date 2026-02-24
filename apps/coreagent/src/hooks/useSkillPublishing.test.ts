import { renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';

import { createTestQueryClient } from '@/test/utils';
import {
  useDryRunPublishRegistrySkill,
  useRegistryPermissionProfiles,
} from './useSkillPublishing';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

describe('useSkillPublishing', () => {
  it('loads permission profiles', async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce([
      {
        id: 'read_only',
        title: 'Read-only',
        description: 'Read-only profile',
        permissions: [],
      },
    ]);

    const queryClient = createTestQueryClient();
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: queryClient }, children);

    const { result } = renderHook(() => useRegistryPermissionProfiles(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(invokeMock).toHaveBeenCalledWith('list_registry_permission_profiles');
  });

  it('maps publish payload and calls dry-run command', async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      skillId: 'coreagent.example.skill',
      version: '1.0.0',
      digest: 'abc',
      artifactUri: 'artifact://abc',
      implementationKey: 'coreagent.example.skill',
      dryRun: true,
    });

    const queryClient = createTestQueryClient();
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: queryClient }, children);
    const { result } = renderHook(() => useDryRunPublishRegistrySkill(), { wrapper });

    await result.current.mutateAsync({
      skillId: 'coreagent.example.skill',
      implementationKey: 'coreagent.example.skill',
      title: 'Example',
      version: '1.0.0',
      runtime: 'command',
      artifactDigest: 'abc',
      permissionProfileId: 'read_only',
    });

    expect(invokeMock).toHaveBeenCalledWith('dry_run_publish_registry_skill', {
      payload: expect.objectContaining({
        skillId: 'coreagent.example.skill',
        permissionProfileId: 'read_only',
        artifactDigest: 'abc',
      }),
    });
  });
});
