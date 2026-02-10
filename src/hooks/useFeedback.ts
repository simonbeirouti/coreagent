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

export interface FeedbackMonthlyPoint {
  month: string;
  positive: number;
  negative: number;
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
  conversation_id?: string;
}

function updateMonthlyFeedback(
  points: FeedbackMonthlyPoint[] | undefined,
  previousType: FeedbackType | null,
  nextType: FeedbackType
) {
  if (!points || points.length === 0) return points;

  const nextPoints = points.map((point) => ({ ...point }));
  const lastPoint = nextPoints[nextPoints.length - 1];
  if (!lastPoint) return nextPoints;

  const decrement = (type: FeedbackType | null) => {
    if (type === 'positive') lastPoint.positive = Math.max(0, lastPoint.positive - 1);
    if (type === 'negative') lastPoint.negative = Math.max(0, lastPoint.negative - 1);
  };
  const increment = (type: FeedbackType) => {
    if (type === 'positive') lastPoint.positive += 1;
    if (type === 'negative') lastPoint.negative += 1;
  };

  decrement(previousType);
  increment(nextType);
  return nextPoints;
}

export function useSubmitFeedback(agentId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (request: SubmitFeedbackRequest): Promise<void> => {
      return invoke('submit_message_feedback', { request });
    },
    onMutate: async (request) => {
      const previousConversationFeedback =
        request.conversation_id && request.user_id
          ? queryClient.getQueryData<Record<string, FeedbackType>>(
              feedbackKeys.conversation(request.conversation_id, request.user_id)
            )
          : undefined;

      const previousFeedbackType = previousConversationFeedback?.[request.message_id] ?? null;

      if (request.conversation_id && request.user_id) {
        queryClient.setQueryData<Record<string, FeedbackType>>(
          feedbackKeys.conversation(request.conversation_id, request.user_id),
          (current = {}) => ({
            ...current,
            [request.message_id]: request.feedback_type,
          })
        );
      }

      if (agentId) {
        queryClient.setQueryData<FeedbackStats | undefined>(
          feedbackKeys.stats(agentId),
          (current) => {
            if (!current) return current;

            const next = { ...current };
            const decrement = (type: FeedbackType | null) => {
              if (type === 'positive') next.positive = Math.max(0, next.positive - 1);
              if (type === 'negative') next.negative = Math.max(0, next.negative - 1);
              if (type === 'neutral') next.neutral = Math.max(0, next.neutral - 1);
            };
            const increment = (type: FeedbackType) => {
              if (type === 'positive') next.positive += 1;
              if (type === 'negative') next.negative += 1;
              if (type === 'neutral') next.neutral += 1;
            };

            decrement(previousFeedbackType);
            increment(request.feedback_type);
            return next;
          }
        );
        queryClient.setQueryData<FeedbackMonthlyPoint[] | undefined>(
          feedbackKeys.monthly(agentId),
          (current) => updateMonthlyFeedback(current, previousFeedbackType, request.feedback_type)
        );
      }

      return { previousConversationFeedback, previousFeedbackType };
    },
    onSuccess: (_data, request) => {
      if (agentId) {
        queryClient.invalidateQueries({ queryKey: feedbackKeys.stats(agentId) });
        queryClient.invalidateQueries({ queryKey: feedbackKeys.monthly(agentId) });
        queryClient.invalidateQueries({ queryKey: feedbackKeys.adjustments(agentId) });
      }

      if (request.conversation_id && request.user_id) {
        queryClient.invalidateQueries({
          queryKey: feedbackKeys.conversation(request.conversation_id, request.user_id),
        });
      }
    },
    onError: (_error, request, context) => {
      if (request.conversation_id && request.user_id && context?.previousConversationFeedback) {
        queryClient.setQueryData(
          feedbackKeys.conversation(request.conversation_id, request.user_id),
          context.previousConversationFeedback
        );
      }

      if (agentId) {
        queryClient.setQueryData<FeedbackStats | undefined>(
          feedbackKeys.stats(agentId),
          (current) => {
            if (!current) return current;

            const next = { ...current };
            const decrement = (type: FeedbackType | null) => {
              if (type === 'positive') next.positive = Math.max(0, next.positive - 1);
              if (type === 'negative') next.negative = Math.max(0, next.negative - 1);
              if (type === 'neutral') next.neutral = Math.max(0, next.neutral - 1);
            };
            const increment = (type: FeedbackType) => {
              if (type === 'positive') next.positive += 1;
              if (type === 'negative') next.negative += 1;
              if (type === 'neutral') next.neutral += 1;
            };

            decrement(request.feedback_type);
            if (context?.previousFeedbackType) {
              increment(context.previousFeedbackType);
            }
            return next;
          }
        );
        queryClient.setQueryData<FeedbackMonthlyPoint[] | undefined>(
          feedbackKeys.monthly(agentId),
          (current) =>
            updateMonthlyFeedback(
              current,
              request.feedback_type,
              context?.previousFeedbackType ?? 'neutral'
            )
        );
      }
    },
  });
}

export function useConversationFeedback(conversationId: string, userId: string) {
  return useQuery({
    queryKey: feedbackKeys.conversation(conversationId, userId),
    queryFn: async (): Promise<Record<string, FeedbackType>> => {
      return invoke('get_conversation_feedback', { conversationId, userId });
    },
    enabled: !!conversationId && !!userId,
    staleTime: Infinity,
    gcTime: 24 * 60 * 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    placeholderData: {},
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

export function useFeedbackMonthly(agentId: string) {
  return useQuery({
    queryKey: feedbackKeys.monthly(agentId),
    queryFn: async (): Promise<FeedbackMonthlyPoint[]> => {
      return invoke('get_agent_feedback_monthly', { agentId });
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

