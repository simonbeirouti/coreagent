import { useQuery } from '@tanstack/react-query';
import { memoryKeys } from '@/lib/query-keys';
import { getCachedData, getCachedDataUpdatedAt } from '@/lib/tauri-store';
import { cacheFirstStaticQueryPolicy, shortSearchQueryPolicy } from '@/lib/query-policies';
import { tauriCommandClient } from '@/lib/tauri-command-client';

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

export interface RetrievalQualityValidation {
  sample_size: number;
  hit_rate: number;
  avg_top_similarity: number;
  p95_latency_ms: number;
  hit_rate_stddev: number;
  judged_precision?: number | null;
  quality_score: number;
  passes_guardrails: boolean;
  reasons: string[];
  source_mix: {
    user_override_count: number;
    weighted_blend_count: number;
    agent_only_count: number;
    heuristic_fallback_count: number;
  };
  confidence_target: number;
  confidence_scored_sample_size: number;
  confidence_above_target_count: number;
  confidence_above_target_ratio: number;
  evaluated_at: string;
}

export interface RetrievalTuningDecision {
  created_at: string;
  status: 'applied' | 'skipped';
  previous_threshold: number;
  next_threshold: number;
  reason?: string | null;
}

export interface RetrievalTuningStatus {
  current_threshold: number;
  min_threshold: number;
  max_threshold: number;
  auto_tune_enabled: boolean;
  cooldown_minutes: number;
  last_tuned_at?: string | null;
  last_decision_reason?: string | null;
  quality: RetrievalQualityValidation;
  recent_decisions: RetrievalTuningDecision[];
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
      return tauriCommandClient.getRelevantMemories<SimilarMemory[]>(agentId, query, conversationId);
    },
    enabled: enabled && !!agentId && query.trim().length > 2,
    ...shortSearchQueryPolicy,
  });
}

export function useMemoryQualitySummary(agentId: string, days = 14) {
  const queryKey = memoryKeys.quality(agentId, days);
  const initialData = getCachedData<MemoryRetrievalQualitySummary>(queryKey);
  const initialDataUpdatedAt = getCachedDataUpdatedAt(queryKey);

  return useQuery({
    queryKey,
    queryFn: async (): Promise<MemoryRetrievalQualitySummary> => {
      return tauriCommandClient.getAgentRetrievalQualitySummary<MemoryRetrievalQualitySummary>(
        agentId,
        days
      );
    },
    enabled: !!agentId,
    initialData,
    initialDataUpdatedAt,
    ...cacheFirstStaticQueryPolicy,
  });
}

export function useMemoryQualityTimeseries(agentId: string, days = 14) {
  const queryKey = memoryKeys.qualityTimeseries(agentId, days);
  const initialData = getCachedData<MemoryRetrievalTimeseriesPoint[]>(queryKey);
  const initialDataUpdatedAt = getCachedDataUpdatedAt(queryKey);

  return useQuery({
    queryKey,
    queryFn: async (): Promise<MemoryRetrievalTimeseriesPoint[]> => {
      return tauriCommandClient.getAgentRetrievalQualityTimeseries<MemoryRetrievalTimeseriesPoint[]>(
        agentId,
        days
      );
    },
    enabled: !!agentId,
    initialData,
    initialDataUpdatedAt,
    ...cacheFirstStaticQueryPolicy,
  });
}

export function useRetrievalTuningStatus(agentId: string) {
  const queryKey = memoryKeys.tuningStatus(agentId);
  const initialData = getCachedData<RetrievalTuningStatus>(queryKey);
  const initialDataUpdatedAt = getCachedDataUpdatedAt(queryKey);

  return useQuery({
    queryKey,
    queryFn: async (): Promise<RetrievalTuningStatus> => {
      return tauriCommandClient.getAgentRetrievalTuningStatus<RetrievalTuningStatus>(agentId);
    },
    enabled: !!agentId,
    initialData,
    initialDataUpdatedAt,
    ...cacheFirstStaticQueryPolicy,
  });
}

