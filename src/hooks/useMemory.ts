import { useQuery } from '@tanstack/react-query';
import { invoke } from '@tauri-apps/api/core';
import { memoryKeys } from '@/lib/query-keys';
import { dynamic30sQueryPolicy, shortSearchQueryPolicy } from '@/lib/query-policies';

export interface SimilarMemory {
  message_id: string;
  conversation_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  similarity: number;
  created_at: string;
}

export interface MemoryRetrievalQualitySummary {
  total_events: number;
  hit_rate: number;
  no_hit_rate: number;
  avg_result_count: number;
  avg_top_similarity: number;
  avg_similarity: number;
  p95_latency_ms: number;
  last_retrieval_at?: string | null;
}

export interface MemoryRetrievalTimeseriesPoint {
  date: string;
  hit_count: number;
  no_hit_count: number;
  hit_rate: number;
  avg_top_similarity: number;
  p95_latency_ms: number;
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
    ...shortSearchQueryPolicy,
  });
}

export function useMemoryQualitySummary(agentId: string, days = 14) {
  return useQuery({
    queryKey: memoryKeys.quality(agentId, days),
    queryFn: async (): Promise<MemoryRetrievalQualitySummary> => {
      return invoke('get_agent_retrieval_quality_summary', { agentId, days });
    },
    enabled: !!agentId,
    ...dynamic30sQueryPolicy,
  });
}

export function useMemoryQualityTimeseries(agentId: string, days = 14) {
  return useQuery({
    queryKey: memoryKeys.qualityTimeseries(agentId, days),
    queryFn: async (): Promise<MemoryRetrievalTimeseriesPoint[]> => {
      return invoke('get_agent_retrieval_quality_timeseries', { agentId, days });
    },
    enabled: !!agentId,
    placeholderData: [],
    ...dynamic30sQueryPolicy,
  });
}

