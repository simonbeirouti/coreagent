import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { invoke } from '@tauri-apps/api/core';
import { abilityKeys } from '@/lib/query-keys';
import { getCachedData, getCachedDataUpdatedAt } from '@/lib/tauri-store';
import { cacheFirstStaticQueryPolicy } from '@/lib/query-policies';

export interface AgentAbility {
  id: string;
  agent_id: string;
  ability_id: string;
  ability_name: string;
  implementation_key: string;
  category: string;
  usage_count: number;
  success_count: number;
  proficiency: number;
  last_used_at?: string | null;
  enabled: boolean;
  config: Record<string, unknown>;
}

export interface AgentToolSetting {
  agent_id: string;
  ability_id: string;
  ability_name: string;
  description?: string | null;
  implementation_key: string;
  category: string;
  enabled: boolean;
  config: Record<string, unknown>;
  parameters_schema: Record<string, unknown>;
  is_mandatory: boolean;
  source?: 'core' | 'registry-managed' | 'orchestration-runtime' | 'custom';
  lifecycle_state?:
    | 'discovered'
    | 'installed'
    | 'assigned'
    | 'runtime_validated'
    | 'active'
    | 'revoked'
    | 'force_disabled'
    | 'sync_stale';
  enforcement_state?:
    | 'active'
    | 'blocked_policy'
    | 'blocked_compatibility'
    | 'force_disabled'
    | 'sync_stale';
  disabled_reason?: string | null;
}

export interface AgentRegistrySkill {
  agentAbilityId: string;
  skillId: string;
  implementationKey: string;
  name: string;
  enabled: boolean;
  config: Record<string, unknown>;
  installState?: string | null;
  pinnedVersion?: string | null;
}

export interface SkillPerformanceRating {
  skill_key: 'chat' | 'voice' | 'screenshot' | string;
  skill_name: string;
  rating: number;
  quality_score: number;
  engagement_score: number;
  feedback_score: number;
  confidence_score: number;
  usage_count: number;
  ability_usage_count: number;
  perception_usage_count: number;
}

export interface SkillRatingTrendPoint {
  timestamp: string;
  rating: number;
  quality_score: number;
  engagement_score: number;
  feedback_score: number;
  confidence_score: number;
  usage_count: number;
}

export interface SkillRatingTrendSeries {
  skill_key: string;
  skill_name: string;
  points: SkillRatingTrendPoint[];
}

export function useAgentAbilities(agentId: string) {
  return useQuery({
    queryKey: abilityKeys.agent(agentId),
    queryFn: async (): Promise<AgentAbility[]> => {
      return invoke('list_agent_abilities', { agentId });
    },
    enabled: !!agentId,
    ...cacheFirstStaticQueryPolicy,
  });
}

export function useAgentSkillRatings(agentId: string) {
  const queryKey = abilityKeys.skillRatings(agentId);
  const initialData = getCachedData<SkillPerformanceRating[]>(queryKey);
  const initialDataUpdatedAt = getCachedDataUpdatedAt(queryKey);

  return useQuery({
    queryKey,
    queryFn: async (): Promise<SkillPerformanceRating[]> => {
      return invoke('get_agent_skill_ratings', { agentId });
    },
    enabled: !!agentId,
    initialData,
    initialDataUpdatedAt,
    ...cacheFirstStaticQueryPolicy,
  });
}

export function useAgentSkillRatingTrends(agentId: string, days = 14) {
  const queryKey = abilityKeys.skillTrends(agentId, days);
  const initialData = getCachedData<SkillRatingTrendSeries[]>(queryKey);
  const initialDataUpdatedAt = getCachedDataUpdatedAt(queryKey);

  return useQuery({
    queryKey,
    queryFn: async (): Promise<SkillRatingTrendSeries[]> => {
      return invoke('get_agent_skill_rating_trends', { agentId, days });
    },
    enabled: !!agentId,
    initialData,
    initialDataUpdatedAt,
    ...cacheFirstStaticQueryPolicy,
  });
}

export function useAgentToolSettings(agentId: string) {
  return useQuery({
    queryKey: abilityKeys.toolSettings(agentId),
    queryFn: async (): Promise<AgentToolSetting[]> => {
      return invoke('list_agent_tool_settings', { agentId });
    },
    enabled: !!agentId,
    ...cacheFirstStaticQueryPolicy,
  });
}

export function useAgentRegistrySkills(agentId: string) {
  return useQuery({
    queryKey: abilityKeys.agentRegistrySkills(agentId),
    queryFn: async (): Promise<AgentRegistrySkill[]> => {
      return invoke('list_agent_registry_skills', { agentId });
    },
    enabled: !!agentId,
    ...cacheFirstStaticQueryPolicy,
  });
}

export function useSetAgentAbilityEnabled(agentId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: {
      implementationKey: string;
      enabled: boolean;
    }): Promise<AgentToolSetting> => {
      return invoke('set_agent_ability_enabled', {
        agentId,
        implementationKey: params.implementationKey,
        enabled: params.enabled,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: abilityKeys.toolSettings(agentId), refetchType: 'all' });
      queryClient.invalidateQueries({ queryKey: abilityKeys.agent(agentId), refetchType: 'all' });
      queryClient.invalidateQueries({ queryKey: abilityKeys.skillRatings(agentId), refetchType: 'all' });
    },
  });
}

export function useUpdateAgentAbilityConfig(agentId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: {
      implementationKey: string;
      config: Record<string, unknown>;
    }): Promise<AgentToolSetting> => {
      return invoke('update_agent_ability_config', {
        agentId,
        implementationKey: params.implementationKey,
        config: params.config,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: abilityKeys.toolSettings(agentId), refetchType: 'all' });
      queryClient.invalidateQueries({ queryKey: abilityKeys.agent(agentId), refetchType: 'all' });
    },
  });
}
