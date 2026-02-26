import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { invoke } from '@tauri-apps/api/core';
import { abilityKeys, registryKeys } from '@/lib/query-keys';
import { cacheFirstStaticQueryPolicy } from '@/lib/query-policies';

export interface RegistrySkillSummary {
  skillId: string;
  name: string;
  description: string;
  latestVersion: string;
  risk: 'low' | 'moderate' | 'high' | string;
  trusted?: boolean;
}

export interface RegistrySkillVersion {
  version: string;
  digest: string;
  signature: string;
  runtime?: 'command' | 'http' | 'wasm' | string;
  entrypoint?: string;
  artifactUri?: string;
  compatibilityMinAppVersion?: string | null;
  compatibilityMaxAppVersion?: string | null;
  policyStatus?: 'pending' | 'approved' | 'rejected' | 'revoked' | string;
  reviewStatus?: 'not_submitted' | 'in_review' | 'approved' | 'rejected' | string;
  trustBadge?: boolean;
  trustBadgeMetadata?: Record<string, unknown>;
  revokedAt?: string | null;
}

export interface RegistrySkillDetails extends RegistrySkillSummary {
  versions: RegistrySkillVersion[];
}

export interface InstalledSkill {
  installId: string;
  skillId: string;
  implementationKey: string;
  name: string;
  installState: string;
  autoUpdate: boolean;
  pinnedVersion?: string | null;
  updatedAt: string;
}

export interface RegistryInstallResponse {
  installId: string;
  skillId: string;
  version: string;
  implementationKey: string;
  installed: boolean;
}

export interface RegistryAssignResponse {
  agentAbilityId: string;
  agentId: string;
  skillId: string;
  implementationKey: string;
  assigned: boolean;
}

export interface RegistryUninstallResponse {
  installId: string;
  skillId: string;
  uninstalled: boolean;
}

export interface RuntimeHandshake {
  skillId: string;
  implementationKey: string;
  name: string;
  version: string;
  install: {
    installId?: string | null;
    installed: boolean;
    installState?: string | null;
    autoUpdate?: boolean | null;
    pinnedVersion?: string | null;
    installConfig: Record<string, unknown>;
  };
  runtime: {
    type: string;
    entrypoint: string;
    compatibility: {
      minAppVersion?: string | null;
      maxAppVersion?: string | null;
    };
  };
  policy: {
    status: string;
    riskLevel: string;
  };
  forceDisable: {
    required: boolean;
    reason?: string | null;
  };
}

export interface RegistryAdvisory {
  id: string;
  skillId: string;
  version?: string | null;
  advisoryType: string;
  severity: string;
  title: string;
  summary: string;
  sequenceCursor?: string;
  forceDisable?: boolean;
  publishedAt: string;
  resolvedAt?: string | null;
}

export interface AdvisoryFeedResponse {
  data: RegistryAdvisory[];
  page: {
    nextCursor?: string | null;
    hasMore: boolean;
  };
}

export interface RuntimeSyncDiagnostics {
  freshness: 'fresh' | 'soft_stale' | 'hard_stale' | string;
  appIsForeground: boolean;
  cursor?: string | null;
  lastSuccessAtMs?: number | null;
  lastAttemptAtMs?: number | null;
  lastControlSyncAtMs?: number | null;
  lastAppSyncAtMs?: number | null;
  nextRetryAtMs?: number | null;
  consecutiveFailures: number;
  nextBackoffSeconds: number;
  lastError?: string | null;
}

export function useRegistrySkills(query?: string) {
  return useQuery({
    queryKey: registryKeys.skills(query ?? ''),
    queryFn: async (): Promise<RegistrySkillSummary[]> =>
      invoke('list_registry_skills', { query: query?.trim() || null }),
    ...cacheFirstStaticQueryPolicy,
  });
}

export function useTrustedRegistrySkills(query?: string) {
  return useQuery({
    queryKey: registryKeys.trustedSkills(query ?? ''),
    queryFn: async (): Promise<RegistrySkillSummary[]> =>
      invoke('list_registry_skills', { query: query?.trim() || null, trustedOnly: true }),
    ...cacheFirstStaticQueryPolicy,
  });
}

export function useRegistrySkill(skillId: string) {
  return useQuery({
    queryKey: registryKeys.skill(skillId),
    queryFn: async (): Promise<RegistrySkillDetails> => invoke('get_registry_skill', { skillId }),
    enabled: !!skillId,
    ...cacheFirstStaticQueryPolicy,
  });
}

export function useInstalledSkills() {
  return useQuery({
    queryKey: registryKeys.installed(),
    queryFn: async (): Promise<InstalledSkill[]> => invoke('list_installed_skills'),
    ...cacheFirstStaticQueryPolicy,
  });
}

export function useInstallRegistrySkill() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (params: {
      skillId: string;
      version?: string;
      autoUpdate?: boolean;
      installConfig?: Record<string, unknown>;
    }): Promise<RegistryInstallResponse> =>
      invoke('install_registry_skill', {
        skillId: params.skillId,
        version: params.version ?? null,
        autoUpdate: params.autoUpdate ?? true,
        installConfig: params.installConfig ?? {},
      }),
    onSuccess: () => {
      invoke('trigger_runtime_sync_command', { reason: 'install_registry_skill_ui' }).catch((error) => {
        console.error('Failed triggering runtime sync after install:', error);
      });
      queryClient.invalidateQueries({ queryKey: registryKeys.installed(), refetchType: 'all' });
      queryClient.invalidateQueries({
        queryKey: registryKeys.runtimeSyncDiagnostics(),
        refetchType: 'all',
      });
    },
  });
}

export function useAssignRegistrySkill(agentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (params: {
      skillId: string;
      enabled?: boolean;
      config?: Record<string, unknown>;
    }): Promise<RegistryAssignResponse> =>
      invoke('assign_registry_skill', {
        skillId: params.skillId,
        agentId,
        enabled: params.enabled ?? true,
        config: params.config ?? {},
      }),
    onSuccess: () => {
      invoke('trigger_runtime_sync_command', { reason: 'assign_registry_skill_ui' }).catch((error) => {
        console.error('Failed triggering runtime sync after assign:', error);
      });
      queryClient.invalidateQueries({
        queryKey: abilityKeys.agentRegistrySkills(agentId),
        refetchType: 'all',
      });
      queryClient.invalidateQueries({ queryKey: abilityKeys.toolSettings(agentId), refetchType: 'all' });
      queryClient.invalidateQueries({ queryKey: abilityKeys.agent(agentId), refetchType: 'all' });
      queryClient.invalidateQueries({ queryKey: registryKeys.installed(), refetchType: 'all' });
      queryClient.invalidateQueries({
        queryKey: registryKeys.runtimeSyncDiagnostics(),
        refetchType: 'all',
      });
    },
  });
}

export function useUninstallRegistrySkill(agentId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (params: {
      skillId: string;
    }): Promise<RegistryUninstallResponse> =>
      invoke('uninstall_registry_skill', {
        skillId: params.skillId,
      }),
    onSuccess: () => {
      invoke('trigger_runtime_sync_command', { reason: 'uninstall_registry_skill_ui' }).catch((error) => {
        console.error('Failed triggering runtime sync after uninstall:', error);
      });
      queryClient.invalidateQueries({ queryKey: registryKeys.installed(), refetchType: 'all' });
      queryClient.invalidateQueries({
        queryKey: registryKeys.runtimeSyncDiagnostics(),
        refetchType: 'all',
      });
      if (agentId) {
        queryClient.invalidateQueries({
          queryKey: abilityKeys.agentRegistrySkills(agentId),
          refetchType: 'all',
        });
        queryClient.invalidateQueries({ queryKey: abilityKeys.toolSettings(agentId), refetchType: 'all' });
      }
    },
  });
}

export function useValidateSkillRuntime() {
  return useMutation({
    mutationFn: async (params: { skillId: string; version: string }): Promise<RuntimeHandshake> =>
      invoke('validate_skill_runtime', { skillId: params.skillId, version: params.version }),
  });
}

export function useSkillAdvisoryFeed(cursor?: string, limit = 50) {
  return useQuery({
    queryKey: registryKeys.advisories(cursor ?? '', limit),
    queryFn: async (): Promise<AdvisoryFeedResponse> =>
      invoke('sync_skill_advisories', {
        cursor: cursor?.trim() || null,
        limit,
      }),
    ...cacheFirstStaticQueryPolicy,
  });
}

export function useRuntimeSyncDiagnostics() {
  return useQuery({
    queryKey: registryKeys.runtimeSyncDiagnostics(),
    queryFn: async (): Promise<RuntimeSyncDiagnostics> => invoke('get_runtime_sync_diagnostics_command'),
    ...cacheFirstStaticQueryPolicy,
  });
}

export function useTriggerRuntimeSync() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (reason?: string): Promise<RuntimeSyncDiagnostics> =>
      invoke('trigger_runtime_sync_command', { reason: reason ?? null }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: registryKeys.runtimeSyncDiagnostics(),
        refetchType: 'all',
      });
      queryClient.invalidateQueries({ queryKey: registryKeys.advisories('', 50), refetchType: 'all' });
    },
  });
}
