import { useQuery } from '@tanstack/react-query';
import { invoke } from '@tauri-apps/api/core';
import { abilityKeys } from '@/lib/query-keys';

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

export function useAgentAbilities(agentId: string) {
  return useQuery({
    queryKey: abilityKeys.agent(agentId),
    queryFn: async (): Promise<AgentAbility[]> => {
      return invoke('list_agent_abilities', { agentId });
    },
    enabled: !!agentId,
    staleTime: Infinity,
    gcTime: 24 * 60 * 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}

export function useAgentSkillRatings(agentId: string) {
  return useQuery({
    queryKey: abilityKeys.skillRatings(agentId),
    queryFn: async (): Promise<SkillPerformanceRating[]> => {
      return invoke('get_agent_skill_ratings', { agentId });
    },
    enabled: !!agentId,
    placeholderData: [],
    staleTime: Infinity,
    gcTime: 24 * 60 * 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}

