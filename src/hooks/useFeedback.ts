import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { invoke } from '@tauri-apps/api/core';
import { feedbackKeys } from '@/lib/query-keys';

export type FeedbackType = 'positive' | 'negative' | 'neutral';
export type FeedbackCategory = 'helpfulness' | 'accuracy' | 'tone' | 'verbosity';

export interface FeedbackStats {
  positive: number;
  negative: number;
  neutral: number;
}

export interface PersonalityAdjustment {
  id: string;
  agent_id: string;
  trait_name: string;
  old_value: number;
  new_value: number;
  reason?: string | null;
  created_at: string;
}

interface SubmitFeedbackRequest {
  message_id: string;
  user_id: string;
  feedback_type: FeedbackType;
  feedback_category?: FeedbackCategory;
  notes?: string;
}

export function useSubmitFeedback(agentId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (request: SubmitFeedbackRequest): Promise<void> => {
      return invoke('submit_message_feedback', { request });
    },
    onSuccess: () => {
      if (agentId) {
        queryClient.invalidateQueries({ queryKey: feedbackKeys.stats(agentId) });
        queryClient.invalidateQueries({ queryKey: feedbackKeys.adjustments(agentId) });
      }
    },
  });
}

export function useFeedbackStats(agentId: string) {
  return useQuery({
    queryKey: feedbackKeys.stats(agentId),
    queryFn: async (): Promise<FeedbackStats> => {
      return invoke('get_agent_feedback_stats', { agentId });
    },
    enabled: !!agentId,
    staleTime: Infinity,
    gcTime: 24 * 60 * 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}

export function usePersonalityAdjustments(agentId: string) {
  return useQuery({
    queryKey: feedbackKeys.adjustments(agentId),
    queryFn: async (): Promise<PersonalityAdjustment[]> => {
      return invoke('list_personality_adjustments', { agentId });
    },
    enabled: !!agentId,
    staleTime: Infinity,
    gcTime: 24 * 60 * 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}

export function useAnalyzeFeedbackPatterns(agentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<PersonalityAdjustment[]> => {
      return invoke('analyze_agent_feedback_patterns', { agentId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: feedbackKeys.adjustments(agentId) });
      queryClient.invalidateQueries({ queryKey: feedbackKeys.stats(agentId) });
    },
  });
}

