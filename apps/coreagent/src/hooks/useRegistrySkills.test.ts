import { renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { createTestQueryClient } from '@/test/utils';
import { useInstallRegistrySkill, useRuntimeSyncDiagnostics } from './useRegistrySkills';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

vi.mock('@/lib/tauri-store', () => ({
  getCachedData: vi.fn(() => undefined),
  getCachedDataUpdatedAt: vi.fn(() => undefined),
}));

describe('useRegistrySkills runtime sync hooks', () => {
  it('loads runtime sync diagnostics', async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      freshness: 'fresh',
      appIsForeground: true,
      consecutiveFailures: 0,
      nextBackoffSeconds: 0,
    });

    const queryClient = createTestQueryClient();
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: queryClient }, children);

    const { result } = renderHook(() => useRuntimeSyncDiagnostics(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(invokeMock).toHaveBeenCalledWith('get_runtime_sync_diagnostics_command');
  });

  it('triggers immediate runtime sync after install mutation', async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      installId: 'install-1',
      skillId: 'skill-1',
      version: '1.0.0',
      implementationKey: 'attachment_read',
      installed: true,
    });
    invokeMock.mockResolvedValueOnce({
      freshness: 'fresh',
      appIsForeground: true,
      consecutiveFailures: 0,
      nextBackoffSeconds: 0,
    });

    const queryClient = createTestQueryClient();
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: queryClient }, children);

    const { result } = renderHook(() => useInstallRegistrySkill(), { wrapper });
    await result.current.mutateAsync({ skillId: 'skill-1', version: '1.0.0' });

    expect(invokeMock).toHaveBeenCalledWith('install_registry_skill', {
      skillId: 'skill-1',
      version: '1.0.0',
      autoUpdate: true,
      installConfig: {},
    });
    expect(invokeMock).toHaveBeenCalledWith('trigger_runtime_sync_command', {
      reason: 'install_registry_skill_ui',
    });
  });
});
