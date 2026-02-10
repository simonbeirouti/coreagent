import { useQuery } from '@tanstack/react-query';
import { invoke } from '@tauri-apps/api/core';
import { memoryKeys } from '@/lib/query-keys';

export interface SimilarMemory {
  message_id: string;
  conversation_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  similarity: number;
  created_at: string;
}

export function useRelevantMemories(
  agentId: string,
  query: string,
  conversationId?: string,
  enabled = true
) {
  return useQuery({
    queryKey: memoryKeys.search(agentId, query, conversationId),
    queryFn: async (): Promise<SimilarMemory[]> => {
      return invoke('get_relevant_memories', {
        agentId,
        query,
        conversationId,
      });
    },
    enabled: enabled && !!agentId && query.trim().length > 2,
    staleTime: Infinity,
    gcTime: 24 * 60 * 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}

