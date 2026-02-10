import { useQuery } from '@tanstack/react-query';
import { invoke } from '@tauri-apps/api/core';

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
    queryKey: ['memory', 'search', agentId, query, conversationId],
    queryFn: async (): Promise<SimilarMemory[]> => {
      return invoke('get_relevant_memories', {
        agentId,
        query,
        conversationId,
      });
    },
    enabled: enabled && !!agentId && query.trim().length > 2,
  });
}

