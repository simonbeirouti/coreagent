import { useQuery } from '@tanstack/react-query';
import { invoke } from '@tauri-apps/api/core';
import { abilityKeys } from '@/lib/query-keys';
import { cacheFirstStaticQueryPolicy, dynamic30sQueryPolicy } from '@/lib/query-policies';

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
  return useQuery({
    queryKey: abilityKeys.skillRatings(agentId),
    queryFn: async (): Promise<SkillPerformanceRating[]> => {
      return invoke('get_agent_skill_ratings', { agentId });
    },
    enabled: !!agentId,
    placeholderData: [],
    ...dynamic30sQueryPolicy,
  });
}

export function useAgentSkillRatingTrends(agentId: string, days = 14) {
  return useQuery({
    queryKey: abilityKeys.skillTrends(agentId, days),
    queryFn: async (): Promise<SkillRatingTrendSeries[]> => {
      return invoke('get_agent_skill_rating_trends', { agentId, days });
    },
    enabled: !!agentId,
    placeholderData: [],
    ...dynamic30sQueryPolicy,
  });
}

