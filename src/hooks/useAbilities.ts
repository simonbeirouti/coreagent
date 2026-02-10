import { useQuery } from '@tanstack/react-query';
import { invoke } from '@tauri-apps/api/core';

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
    queryKey: ['abilities', 'agent', agentId],
    queryFn: async (): Promise<AgentAbility[]> => {
      return invoke('list_agent_abilities', { agentId });
    },
    enabled: !!agentId,
  });
}

