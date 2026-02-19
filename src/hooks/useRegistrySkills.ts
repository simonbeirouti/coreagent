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

export function useRegistrySkills(query?: string) {
  return useQuery({
    queryKey: registryKeys.skills(query ?? ''),
    queryFn: async (): Promise<RegistrySkillSummary[]> =>
      invoke('list_registry_skills', { query: query?.trim() || null }),
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
      queryClient.invalidateQueries({ queryKey: registryKeys.installed(), refetchType: 'all' });
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
      queryClient.invalidateQueries({
        queryKey: abilityKeys.agentRegistrySkills(agentId),
        refetchType: 'all',
      });
      queryClient.invalidateQueries({ queryKey: abilityKeys.toolSettings(agentId), refetchType: 'all' });
      queryClient.invalidateQueries({ queryKey: abilityKeys.agent(agentId), refetchType: 'all' });
      queryClient.invalidateQueries({ queryKey: registryKeys.installed(), refetchType: 'all' });
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
