import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { invoke } from '@tauri-apps/api/core';
import { cacheFirstStaticQueryPolicy } from '@/lib/query-policies';
import { skillsGraphKeys } from '@/lib/query-keys';

export type SkillsGraphOwnerType = 'user' | 'team' | 'agent';

export interface SkillsGraphSnapshot {
  ownerType: SkillsGraphOwnerType;
  ownerId: string;
  version: number;
  graphJson: {
    nodes: Array<Record<string, unknown>>;
    edges: Array<Record<string, unknown>>;
    viewport: Record<string, unknown>;
  };
  updatedAt?: string | null;
}

export interface SuggestedEdge {
  source: string;
  target: string;
  label: 'prereq' | 'related' | 'used_with' | string;
  rationale: string;
}

export interface SkillsGraphSuggestions {
  proposedNodes: Array<Record<string, unknown>>;
  proposedEdges: SuggestedEdge[];
}

export function useSkillsGraph(ownerType: SkillsGraphOwnerType, ownerId?: string) {
  const resolvedOwnerId = ownerId ?? 'self';
  return useQuery({
    queryKey: skillsGraphKeys.byOwner(ownerType, resolvedOwnerId),
    queryFn: async (): Promise<SkillsGraphSnapshot> =>
      invoke('load_skills_graph', { ownerType, ownerId: ownerId ?? null }),
    ...cacheFirstStaticQueryPolicy,
  });
}

export function useSaveSkillsGraph(ownerType: SkillsGraphOwnerType, ownerId?: string) {
  const queryClient = useQueryClient();
  const resolvedOwnerId = ownerId ?? 'self';

  return useMutation({
    mutationFn: async (graphJson: SkillsGraphSnapshot['graphJson']): Promise<SkillsGraphSnapshot> =>
      invoke('save_skills_graph', { ownerType, ownerId: ownerId ?? null, graphJson }),
    onSuccess: (snapshot) => {
      queryClient.setQueryData(skillsGraphKeys.byOwner(ownerType, resolvedOwnerId), snapshot);
    },
  });
}

export function useSuggestSkillsGraphConnections() {
  return useMutation({
    mutationFn: async (graphJson: SkillsGraphSnapshot['graphJson']): Promise<SkillsGraphSuggestions> =>
      invoke('suggest_skills_graph_connections', { request: { graphJson } }),
  });
}
