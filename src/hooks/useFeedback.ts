import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { invoke } from '@tauri-apps/api/core';

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
        queryClient.invalidateQueries({ queryKey: ['feedback', 'stats', agentId] });
        queryClient.invalidateQueries({ queryKey: ['feedback', 'adjustments', agentId] });
      }
    },
  });
}

export function useFeedbackStats(agentId: string) {
  return useQuery({
    queryKey: ['feedback', 'stats', agentId],
    queryFn: async (): Promise<FeedbackStats> => {
      return invoke('get_agent_feedback_stats', { agentId });
    },
    enabled: !!agentId,
  });
}

export function usePersonalityAdjustments(agentId: string) {
  return useQuery({
    queryKey: ['feedback', 'adjustments', agentId],
    queryFn: async (): Promise<PersonalityAdjustment[]> => {
      return invoke('list_personality_adjustments', { agentId });
    },
    enabled: !!agentId,
  });
}

export function useAnalyzeFeedbackPatterns(agentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<PersonalityAdjustment[]> => {
      return invoke('analyze_agent_feedback_patterns', { agentId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['feedback', 'adjustments', agentId] });
      queryClient.invalidateQueries({ queryKey: ['feedback', 'stats', agentId] });
    },
  });
}

