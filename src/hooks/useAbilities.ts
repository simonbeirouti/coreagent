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

