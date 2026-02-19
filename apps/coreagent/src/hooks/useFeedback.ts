import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { invoke } from '@tauri-apps/api/core';
import { feedbackKeys } from '@/lib/query-keys';
import { getCachedData, getCachedDataUpdatedAt } from '@/lib/tauri-store';
import { cacheFirstStaticQueryPolicy } from '@/lib/query-policies';

export type FeedbackType = 'positive' | 'negative' | 'neutral';
export type FeedbackCategory = 'helpfulness' | 'accuracy' | 'tone' | 'verbosity';
export type FeedbackDimension = 'helpfulness' | 'accuracy' | 'tone' | 'verbosity';
export type FeedbackRating = 'up' | 'down';

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

export interface TraitState {
  agent_id: string;
  helpfulness: number;
  formality: number;
  verbosity: number;
  proactivity: number;
  creativity: number;
  empathy: number;
  adaptation_enabled: boolean;
  updated_at: string;
}

interface SubmitFeedbackRequest {
  message_id: string;
  user_id: string;
  feedback_type: FeedbackType;
  feedback_category?: FeedbackCategory;
  notes?: string;
  conversation_id?: string;
  dimension_ratings?: Partial<Record<FeedbackDimension, FeedbackRating>>;
}

export type ConversationDimensionFeedback = Record<
  string,
  Partial<Record<FeedbackDimension, FeedbackRating>>
>;

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
      const dimensionQueryKey = request.conversation_id && request.user_id
        ? [...feedbackKeys.conversation(request.conversation_id, request.user_id), 'dimensions']
        : null;
      const previousConversationFeedback =
        request.conversation_id && request.user_id
          ? queryClient.getQueryData<Record<string, FeedbackType>>(
              feedbackKeys.conversation(request.conversation_id, request.user_id)
            )
          : undefined;
      const previousDimensionFeedback = dimensionQueryKey
        ? queryClient.getQueryData<ConversationDimensionFeedback>(dimensionQueryKey)
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
        if (dimensionQueryKey && request.dimension_ratings && Object.keys(request.dimension_ratings).length > 0) {
          queryClient.setQueryData<ConversationDimensionFeedback>(dimensionQueryKey, (current) => {
              const safeCurrent: ConversationDimensionFeedback = current ?? {};
              const nextForMessage = {
                ...(safeCurrent[request.message_id] ?? {}),
                ...request.dimension_ratings,
              };
              return {
                ...safeCurrent,
                [request.message_id]: nextForMessage,
              };
            });
        }
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

      return { previousConversationFeedback, previousFeedbackType, previousDimensionFeedback, dimensionQueryKey };
    },
    onSuccess: () => {
      if (agentId) {
        // Thumbs feedback is optimistically reconciled for conversation/stats/monthly.
        // Defer adaptation-related refresh and avoid active-view refetch storms.
        window.setTimeout(() => {
          queryClient.invalidateQueries({
            queryKey: feedbackKeys.adjustments(agentId),
            refetchType: 'inactive',
          });
          queryClient.invalidateQueries({
            queryKey: feedbackKeys.traitState(agentId),
            refetchType: 'inactive',
          });
        }, 1500);
      }
    },
    onError: (_error, request, context) => {
      if (request.conversation_id && request.user_id && context?.previousConversationFeedback) {
        queryClient.setQueryData(
          feedbackKeys.conversation(request.conversation_id, request.user_id),
          context.previousConversationFeedback
        );
      }
      if (context?.dimensionQueryKey && context.previousDimensionFeedback) {
        queryClient.setQueryData(context.dimensionQueryKey, context.previousDimensionFeedback);
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
    ...cacheFirstStaticQueryPolicy,
    placeholderData: {},
  });
}

export function useConversationDimensionFeedback(conversationId: string, userId: string) {
  return useQuery({
    queryKey: [...feedbackKeys.conversation(conversationId, userId), 'dimensions'],
    queryFn: async (): Promise<ConversationDimensionFeedback> => {
      return invoke('get_conversation_dimension_feedback', { conversationId, userId });
    },
    enabled: !!conversationId && !!userId,
    ...cacheFirstStaticQueryPolicy,
    placeholderData: {},
  });
}

export function useFeedbackStats(agentId: string) {
  const queryKey = feedbackKeys.stats(agentId);
  const initialData = getCachedData<FeedbackStats>(queryKey);
  const initialDataUpdatedAt = getCachedDataUpdatedAt(queryKey);

  return useQuery({
    queryKey,
    queryFn: async (): Promise<FeedbackStats> => {
      return invoke('get_agent_feedback_stats', { agentId });
    },
    enabled: !!agentId,
    initialData,
    initialDataUpdatedAt,
    ...cacheFirstStaticQueryPolicy,
  });
}

export function useFeedbackMonthly(agentId: string) {
  const queryKey = feedbackKeys.monthly(agentId);
  const initialData = getCachedData<FeedbackMonthlyPoint[]>(queryKey);
  const initialDataUpdatedAt = getCachedDataUpdatedAt(queryKey);

  return useQuery({
    queryKey,
    queryFn: async (): Promise<FeedbackMonthlyPoint[]> => {
      return invoke('get_agent_feedback_monthly', { agentId });
    },
    enabled: !!agentId,
    initialData,
    initialDataUpdatedAt,
    ...cacheFirstStaticQueryPolicy,
  });
}

export function usePersonalityAdjustments(agentId: string) {
  const queryKey = feedbackKeys.adjustments(agentId);
  const initialData = getCachedData<PersonalityAdjustment[]>(queryKey);
  const initialDataUpdatedAt = getCachedDataUpdatedAt(queryKey);

  return useQuery({
    queryKey,
    queryFn: async (): Promise<PersonalityAdjustment[]> => {
      return invoke('list_personality_adjustments', { agentId });
    },
    enabled: !!agentId,
    initialData,
    initialDataUpdatedAt,
    ...cacheFirstStaticQueryPolicy,
  });
}

export function useTraitState(agentId: string) {
  const queryKey = feedbackKeys.traitState(agentId);
  const initialData = getCachedData<TraitState>(queryKey);
  const initialDataUpdatedAt = getCachedDataUpdatedAt(queryKey);

  return useQuery({
    queryKey,
    queryFn: async (): Promise<TraitState> => {
      return invoke('get_agent_trait_state', { agentId });
    },
    enabled: !!agentId,
    initialData,
    initialDataUpdatedAt,
    ...cacheFirstStaticQueryPolicy,
  });
}

export function useSetAdaptationEnabled(agentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (enabled: boolean): Promise<TraitState> => {
      return invoke('set_agent_adaptation_enabled', { agentId, enabled });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: feedbackKeys.traitState(agentId), refetchType: 'all' });
      queryClient.invalidateQueries({ queryKey: feedbackKeys.adjustments(agentId), refetchType: 'all' });
    },
  });
}

export function useRevertLastAdaptationCycle(agentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<void> => {
      return invoke('revert_agent_last_adaptation_cycle', { agentId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: feedbackKeys.traitState(agentId), refetchType: 'all' });
      queryClient.invalidateQueries({ queryKey: feedbackKeys.adjustments(agentId), refetchType: 'all' });
    },
  });
}

export function useAnalyzeFeedbackPatterns(agentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<PersonalityAdjustment[]> => {
      return invoke('analyze_agent_feedback_patterns', { agentId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: feedbackKeys.adjustments(agentId), refetchType: 'all' });
      queryClient.invalidateQueries({ queryKey: feedbackKeys.stats(agentId), refetchType: 'all' });
    },
  });
}

