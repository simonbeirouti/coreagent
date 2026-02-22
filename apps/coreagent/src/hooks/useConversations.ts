import { useState, useCallback, useEffect, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Channel } from '@tauri-apps/api/core';
import { Conversation, Message, CreateConversationRequest, SendMessageRequest, StreamEvent } from '../types';
import { getCachedData, getCachedDataUpdatedAt } from '../lib/tauri-store';
import { abilityKeys, conversationKeys, memoryKeys } from '@/lib/query-keys';
import { cacheFirstStaticQueryPolicy } from '@/lib/query-policies';
import { tauriCommandClient } from '@/lib/tauri-command-client';

function getOptimisticParentId(messages: Message[] | undefined): string | null {
  if (!messages || messages.length === 0) return null;

  const childParentIds = new Set(
    messages
      .map((message) => message.parent_id)
      .filter((parentId): parentId is string => typeof parentId === 'string' && parentId.length > 0)
  );
  const leafMessages = messages.filter((message) => !childParentIds.has(message.id));

  if (leafMessages.length === 0) return null;

  return leafMessages.reduce((latest, current) => {
    return new Date(current.created_at).getTime() > new Date(latest.created_at).getTime()
      ? current
      : latest;
  }).id;
}

export { conversationKeys };

function getAgentIdForConversation(
  queryClient: ReturnType<typeof useQueryClient>,
  conversationId: string
): string | null {
  const conversation = queryClient.getQueryData<Conversation>(
    conversationKeys.detail(conversationId)
  );
  if (conversation?.agent_id) return conversation.agent_id;

  const listEntries = queryClient.getQueriesData<Conversation[]>({
    queryKey: conversationKeys.lists(),
  });
  for (const [, list] of listEntries) {
    const match = list?.find((item) => item.id === conversationId);
    if (match?.agent_id) return match.agent_id;
  }
  return null;
}

function invalidateAgentDashboardQueries(
  queryClient: ReturnType<typeof useQueryClient>,
  agentId: string
) {
  queryClient.invalidateQueries({ queryKey: conversationKeys.list(agentId) });
  queryClient.invalidateQueries({ queryKey: abilityKeys.agent(agentId) });
  queryClient.invalidateQueries({ queryKey: abilityKeys.skillRatings(agentId) });
  queryClient.invalidateQueries({
    predicate: (query) =>
      Array.isArray(query.queryKey) &&
      query.queryKey[0] === abilityKeys.all[0] &&
      query.queryKey[1] === 'skill-trends' &&
      query.queryKey[2] === agentId,
  });
  queryClient.invalidateQueries({
    predicate: (query) =>
      Array.isArray(query.queryKey) &&
      query.queryKey[0] === memoryKeys.all[0] &&
      query.queryKey[2] === agentId &&
      (query.queryKey[1] === 'quality' || query.queryKey[1] === 'quality-timeseries'),
  });
}

function invalidateFallbackDashboardQueries(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: conversationKeys.lists() });
  queryClient.invalidateQueries({
    predicate: (query) =>
      Array.isArray(query.queryKey) &&
      query.queryKey[0] === abilityKeys.all[0] &&
      (query.queryKey[1] === 'agent' ||
        query.queryKey[1] === 'skill-ratings' ||
        query.queryKey[1] === 'skill-trends'),
  });
  queryClient.invalidateQueries({
    predicate: (query) =>
      Array.isArray(query.queryKey) &&
      query.queryKey[0] === memoryKeys.all[0] &&
      (query.queryKey[1] === 'quality' || query.queryKey[1] === 'quality-timeseries'),
  });
}

function toUserFriendlyStreamingDelta(raw: string): string {
  const value = raw.trim();
  if (value.startsWith('[tool-chain] phase=plan_created')) {
    return '';
  }
  if (value.startsWith('[tool-chain] phase=planner_filtered')) {
    return '';
  }
  if (value.startsWith('[tool-chain] phase=tool_step_started')) {
    return '';
  }
  if (value.startsWith('[tool-chain] phase=tool_step_done')) {
    return '';
  }
  if (value.startsWith('[tool-chain] phase=final_summarize')) {
    return '';
  }
  if (value.startsWith('[tool-chain] phase=budget_exhausted')) {
    return '';
  }
  if (value.startsWith('[tool-selection] runtime tools available')) {
    return '';
  }
  if (value.startsWith('[tool-selection]')) {
    return '';
  }
  if (value.startsWith('[tool:')) {
    return '';
  }
  if (value.startsWith('[event:')) {
    return '';
  }
  return raw;
}

export type InferredToolProgressEvent = {
  clientRunId: string;
  conversationId: string;
  implementationKey: string;
  runId?: string | null;
  status?: string | null;
  message: string;
  sequence: number;
  timestampMs: number;
};

type PersistedInferredToolRun = {
  clientRunId: string;
  implementationKey: string;
  runId?: string | null;
  status?: string | null;
  startedAtMs: number;
  timeline: Array<{
    id: string;
    message: string;
    level: 'info' | 'success' | 'error';
    timestampMs: number;
    sequence: number;
  }>;
};

function normalizeInferredImplementationKey(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return trimmed;
  return trimmed
    .replace(/^coreagent_(rs|py|js|md)_/, '')
    .replace(/^coreagent_(rs|py|js|md)\./, '')
    .replace(/^coreagent\.(rs|py|js|md)\./, '')
    .trim();
}

function inferTimelineLevelFromProgress(message: string, status?: string | null): 'info' | 'success' | 'error' {
  const normalized = `${status ?? ''} ${message}`.toLowerCase();
  if (
    normalized.includes('failed') ||
    normalized.includes('error') ||
    normalized.includes('timed_out') ||
    normalized.includes('cancelled')
  ) {
    return 'error';
  }
  if (normalized.includes('succeeded') || normalized.includes('success')) {
    return 'success';
  }
  return 'info';
}

function groupInferredRunsForPersistence(
  events: InferredToolProgressEvent[]
): PersistedInferredToolRun[] {
  const grouped = new Map<string, PersistedInferredToolRun>();
  for (const event of events) {
    const existing = grouped.get(event.clientRunId);
    const entry = {
      id: `${event.clientRunId}-persisted-${event.sequence}`,
      message: event.message,
      level: inferTimelineLevelFromProgress(event.message, event.status),
      timestampMs: event.timestampMs,
      sequence: event.sequence,
    } as const;
    if (!existing) {
      grouped.set(event.clientRunId, {
        clientRunId: event.clientRunId,
        implementationKey: event.implementationKey,
        runId: event.runId ?? null,
        status: event.status ?? 'running',
        startedAtMs: event.timestampMs,
        timeline: [entry],
      });
      continue;
    }
    existing.status = event.status ?? existing.status;
    existing.runId = event.runId ?? existing.runId;
    existing.timeline.push(entry);
  }

  return Array.from(grouped.values()).map((run) => ({
    ...run,
    timeline: run.timeline.sort((a, b) => a.sequence - b.sequence),
  }));
}

function normalizePlannedToolLabel(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return 'tool';
  const withoutPrefix = trimmed.replace(/^coreagent_(rs|py|js|md)_/, '');
  const lastSegment = withoutPrefix.split('.').pop() || withoutPrefix;
  return lastSegment.replace(/[_-]+/g, ' ').trim();
}

function buildAcceptanceMessageFromLine(line: string): string | null {
  if (
    !line.startsWith('[tool-chain] phase=') &&
    !line.startsWith('[tool:') &&
    !line.startsWith('[event:')
  ) {
    return null;
  }

  const plannerMatch = line.match(/callable_tools=([^\s]+)/);
  if (plannerMatch?.[1]) {
    const tools = plannerMatch[1]
      .split(',')
      .map((token) => normalizePlannedToolLabel(token))
      .filter(Boolean);
    if (tools.length === 1) {
      return `Accepted. I will run ${tools[0]} and then summarize the result.`;
    }
    if (tools.length > 1) {
      return `Accepted. I will run ${tools.join(', ')} and then summarize the combined results.`;
    }
  }

  return 'Accepted. I will run the required tool steps and then summarize the results.';
}

function inferStatusFromToolEvent(eventCode: string, rawMessage: string): string {
  const normalized = `${eventCode} ${rawMessage}`.toLowerCase();
  if (
    normalized.includes('succeeded') ||
    normalized.includes('success') ||
    normalized.includes('completed')
  ) {
    return 'succeeded';
  }
  if (normalized.includes('cancelled')) {
    return 'cancelled';
  }
  if (normalized.includes('timed_out') || normalized.includes('timed out')) {
    return 'timed_out';
  }
  if (
    normalized.includes('failed') ||
    normalized.includes('error') ||
    normalized.includes('budget_exhausted')
  ) {
    return 'failed';
  }
  return 'running';
}

// Fetch conversations for an agent
export function useConversations(agentId: string) {
  const initialData = getCachedData<Conversation[]>(conversationKeys.list(agentId));
  const initialDataUpdatedAt = getCachedDataUpdatedAt(conversationKeys.list(agentId));

  return useQuery({
    queryKey: conversationKeys.list(agentId),
    queryFn: async (): Promise<Conversation[]> => {
      return tauriCommandClient.listConversations(agentId);
    },
    enabled: !!agentId,
    initialData,
    initialDataUpdatedAt,
    ...cacheFirstStaticQueryPolicy,
  });
}

// Fetch a single conversation
export function useConversation(conversationId: string) {
  const initialData = getCachedData<Conversation>(conversationKeys.detail(conversationId));
  const initialDataUpdatedAt = getCachedDataUpdatedAt(conversationKeys.detail(conversationId));

  return useQuery({
    queryKey: conversationKeys.detail(conversationId),
    queryFn: async (): Promise<Conversation> => {
      return tauriCommandClient.getConversation(conversationId);
    },
    enabled: !!conversationId,
    initialData,
    initialDataUpdatedAt,
    ...cacheFirstStaticQueryPolicy,
  });
}

// Fetch messages for a conversation
export function useMessages(conversationId: string) {
  const initialData = getCachedData<Message[]>(conversationKeys.messages(conversationId));
  const initialDataUpdatedAt = getCachedDataUpdatedAt(conversationKeys.messages(conversationId));

  return useQuery({
    queryKey: conversationKeys.messages(conversationId),
    queryFn: async (): Promise<Message[]> => {
      return tauriCommandClient.getConversationMessages(conversationId);
    },
    enabled: !!conversationId,
    initialData,
    initialDataUpdatedAt,
    ...cacheFirstStaticQueryPolicy,
  });
}

// Create a new conversation
export function useCreateConversation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (request: CreateConversationRequest): Promise<Conversation> => {
      return tauriCommandClient.createConversation(request);
    },
    onMutate: async (request) => {
      await queryClient.cancelQueries({ queryKey: conversationKeys.list(request.agent_id) });

      const previousConversations = queryClient.getQueryData<Conversation[]>(
        conversationKeys.list(request.agent_id)
      );

      const tempId = `temp-conversation-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const optimisticConversation: Conversation = {
        id: tempId,
        agent_id: request.agent_id,
        user_id: request.user_id,
        title: request.title || 'New Conversation',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      queryClient.setQueryData<Conversation[]>(
        conversationKeys.list(request.agent_id),
        (old = []) => [optimisticConversation, ...old]
      );
      queryClient.setQueryData<Conversation>(conversationKeys.detail(tempId), optimisticConversation);
      queryClient.setQueryData<Message[]>(conversationKeys.messages(tempId), []);

      return { previousConversations, tempId, agentId: request.agent_id };
    },
    onError: (_error, _request, context) => {
      if (!context) return;
      queryClient.setQueryData(
        conversationKeys.list(context.agentId),
        context.previousConversations ?? []
      );
      queryClient.removeQueries({ queryKey: conversationKeys.detail(context.tempId) });
      queryClient.removeQueries({ queryKey: conversationKeys.messages(context.tempId) });
    },
    onSuccess: (data, _request, context) => {
      const tempId = context?.tempId;

      // Reconcile optimistic temp ID with server ID
      queryClient.setQueryData<Conversation[]>(
        conversationKeys.list(data.agent_id),
        (old = []) => {
          const replaced = old.map((conv) => (conv.id === tempId ? data : conv));
          if (replaced.some((conv) => conv.id === data.id)) {
            return replaced;
          }
          return [data, ...replaced];
        }
      );

      const tempMessages = tempId
        ? queryClient.getQueryData<Message[]>(conversationKeys.messages(tempId))
        : [];

      queryClient.setQueryData<Conversation>(conversationKeys.detail(data.id), data);
      queryClient.setQueryData<Message[]>(conversationKeys.messages(data.id), tempMessages ?? []);

      if (tempId) {
        queryClient.removeQueries({ queryKey: conversationKeys.detail(tempId) });
        queryClient.removeQueries({ queryKey: conversationKeys.messages(tempId) });
      }
    },
    onSettled: (_data, _error, _request, context) => {
      if (!context?.agentId) return;
      queryClient.invalidateQueries({ queryKey: conversationKeys.list(context.agentId) });
    },
  });
}

// Create a conversation instantly with optimistic update
// Returns the temporary ID immediately, then updates to real ID via callback
export function useCreateConversationInstant() {
  const queryClient = useQueryClient();
  const [pendingCreates, setPendingCreates] = useState<Map<string, string>>(new Map());
  const isMountedRef = useRef(true);
  const activeTempIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const createInstant = useCallback((
    request: CreateConversationRequest,
    onRealIdReady?: (realId: string) => void
  ): string => {
    const tempId = `temp-conversation-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    activeTempIdsRef.current.add(tempId);
    
    // Create optimistic conversation
    const optimisticConversation: Conversation = {
      id: tempId,
      agent_id: request.agent_id,
      user_id: request.user_id,
      title: request.title || 'New Conversation',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    // Add to list immediately
    queryClient.setQueryData<Conversation[]>(
      conversationKeys.list(request.agent_id),
      (old = []) => [optimisticConversation, ...old]
    );

    // Pre-populate empty messages
    queryClient.setQueryData<Message[]>(
      conversationKeys.messages(tempId),
      []
    );

    // Track this pending create
    if (isMountedRef.current) {
      setPendingCreates(prev => new Map(prev).set(tempId, 'pending'));
    }

    // Create in background
    tauriCommandClient.createConversation(request)
      .then((realConversation) => {
        // Replace optimistic with real in the list
        queryClient.setQueryData<Conversation[]>(
          conversationKeys.list(request.agent_id),
          (old = []) => old.map(conv => 
            conv.id === tempId ? realConversation : conv
          )
        );

        // Set up real conversation cache
        queryClient.setQueryData<Conversation>(
          conversationKeys.detail(realConversation.id),
          realConversation
        );

        // Move messages from temp to real ID
        const tempMessages = queryClient.getQueryData<Message[]>(
          conversationKeys.messages(tempId)
        ) || [];
        queryClient.setQueryData<Message[]>(
          conversationKeys.messages(realConversation.id),
          tempMessages
        );
        queryClient.removeQueries({ queryKey: conversationKeys.messages(tempId) });

        // Update pending status
        activeTempIdsRef.current.delete(tempId);
        if (isMountedRef.current) {
          setPendingCreates(prev => {
            const next = new Map(prev);
            next.delete(tempId);
            return next;
          });
        }

        // Notify caller of real ID when still mounted
        if (isMountedRef.current) {
          onRealIdReady?.(realConversation.id);
        }
      })
      .catch((error) => {
        console.error('Failed to create conversation:', error);
        
        // Remove the optimistic conversation
        queryClient.setQueryData<Conversation[]>(
          conversationKeys.list(request.agent_id),
          (old = []) => old.filter(conv => conv.id !== tempId)
        );
        queryClient.removeQueries({ queryKey: conversationKeys.messages(tempId) });

        activeTempIdsRef.current.delete(tempId);
        if (isMountedRef.current) {
          setPendingCreates(prev => {
            const next = new Map(prev);
            next.delete(tempId);
            return next;
          });
        }
      });

    return tempId;
  }, [queryClient]);

  const isTemp = useCallback((id: string) => id.startsWith('temp-'), []);
  const isPending = useCallback((id: string) => pendingCreates.has(id), [pendingCreates]);

  return { createInstant, isTemp, isPending };
}


// Send a message to a conversation
export function useSendMessage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (request: SendMessageRequest): Promise<Message> => {
      return tauriCommandClient.sendMessage(request);
    },
    onMutate: async (request) => {
      // Cancel outgoing refetches to prevent overwriting our optimistic update
      await queryClient.cancelQueries({ 
        queryKey: conversationKeys.messages(request.conversation_id) 
      });

      // Snapshot the previous messages
      const previousMessages = queryClient.getQueryData<Message[]>(
        conversationKeys.messages(request.conversation_id)
      );

      // Optimistically add the user message to the cache
      queryClient.setQueryData<Message[]>(
        conversationKeys.messages(request.conversation_id),
        (old = []) => [
          ...old,
          {
            id: `temp-${Date.now()}`, // Temporary ID
            conversation_id: request.conversation_id,
            role: 'user',
            content: request.content,
            message_type: 'text',
            metadata: {},
            created_at: new Date().toISOString(),
          } as Message,
        ]
      );

      // Return context for potential rollback
      return { previousMessages };
    },
    onError: (err, request, context) => {
      console.error('Failed to send message:', err);
      
      // Rollback to previous state on error
      if (context?.previousMessages) {
        queryClient.setQueryData(
          conversationKeys.messages(request.conversation_id),
          context.previousMessages
        );
      }
    },
    onSuccess: (_data, request) => {
      const agentId = getAgentIdForConversation(queryClient, request.conversation_id);

      // Reconcile with server IDs/content
      queryClient.invalidateQueries({ 
        queryKey: conversationKeys.messages(request.conversation_id) 
      });
      
      // Also invalidate conversation details to update timestamp
      queryClient.invalidateQueries({ 
        queryKey: conversationKeys.detail(request.conversation_id) 
      });
      
      if (agentId) {
        invalidateAgentDashboardQueries(queryClient, agentId);
      } else {
        invalidateFallbackDashboardQueries(queryClient);
      }
    },
  });
}

// Update conversation title
export function useUpdateConversationTitle() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ conversationId, title }: { conversationId: string; title: string | null }): Promise<Conversation> => {
      return tauriCommandClient.updateConversationTitle(conversationId, title);
    },
    onMutate: async ({ conversationId, title }) => {
      const previousConversation = queryClient.getQueryData<Conversation>(
        conversationKeys.detail(conversationId)
      );
      const agentId =
        previousConversation?.agent_id ?? getAgentIdForConversation(queryClient, conversationId);
      const previousList = agentId
        ? queryClient.getQueryData<Conversation[]>(conversationKeys.list(agentId))
        : undefined;

      if (previousConversation) {
        queryClient.setQueryData<Conversation>(conversationKeys.detail(conversationId), {
          ...previousConversation,
          title: title || previousConversation.title,
          updated_at: new Date().toISOString(),
        });
      }
      if (agentId) {
        queryClient.setQueryData<Conversation[]>(
          conversationKeys.list(agentId),
          (old = []) =>
            old.map((conv) =>
              conv.id === conversationId
                ? { ...conv, title: title || conv.title, updated_at: new Date().toISOString() }
                : conv
            )
        );
      }

      return { previousConversation, previousList, conversationId, agentId };
    },
    onError: (_error, _variables, context) => {
      if (!context) return;
      if (context.previousConversation) {
        queryClient.setQueryData(
          conversationKeys.detail(context.conversationId),
          context.previousConversation
        );
      }
      if (context.agentId) {
        queryClient.setQueryData(
          conversationKeys.list(context.agentId),
          context.previousList ?? []
        );
      }
    },
    onSuccess: (data) => {
      // Update the conversation in the list cache
      queryClient.setQueryData<Conversation[]>(
        conversationKeys.list(data.agent_id),
        (old = []) => old.map(conv => conv.id === data.id ? data : conv)
      );

      // Update the conversation detail cache
      queryClient.setQueryData<Conversation>(
        conversationKeys.detail(data.id),
        data
      );
    },
  });
}

// Generate and update conversation title based on first message
export function useGenerateConversationTitle() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ conversationId, firstMessage }: { conversationId: string; firstMessage: string }): Promise<Conversation> => {
      return tauriCommandClient.generateConversationTitle(conversationId, firstMessage);
    },
    onMutate: async ({ conversationId, firstMessage }) => {
      const previousConversation = queryClient.getQueryData<Conversation>(
        conversationKeys.detail(conversationId)
      );
      const agentId =
        previousConversation?.agent_id ?? getAgentIdForConversation(queryClient, conversationId);
      const previousList = agentId
        ? queryClient.getQueryData<Conversation[]>(conversationKeys.list(agentId))
        : undefined;
      const optimisticTitle = firstMessage.slice(0, 80).trim() || 'New Conversation';

      if (previousConversation) {
        queryClient.setQueryData<Conversation>(conversationKeys.detail(conversationId), {
          ...previousConversation,
          title: optimisticTitle,
          updated_at: new Date().toISOString(),
        });
      }
      if (agentId) {
        queryClient.setQueryData<Conversation[]>(
          conversationKeys.list(agentId),
          (old = []) =>
            old.map((conv) =>
              conv.id === conversationId
                ? { ...conv, title: optimisticTitle, updated_at: new Date().toISOString() }
                : conv
            )
        );
      }

      return { previousConversation, previousList, conversationId, agentId };
    },
    onError: (error, _variables, context) => {
      if (context?.previousConversation) {
        queryClient.setQueryData(
          conversationKeys.detail(context.conversationId),
          context.previousConversation
        );
      }
      if (context?.agentId) {
        queryClient.setQueryData(
          conversationKeys.list(context.agentId),
          context.previousList ?? []
        );
      }
      // Silently log title generation errors - don't show to user since this is background operation
      console.warn('Failed to generate conversation title:', error);
    },
    onSuccess: (data) => {
      // Update the conversation in the list cache
      queryClient.setQueryData<Conversation[]>(
        conversationKeys.list(data.agent_id),
        (old = []) => old.map(conv => conv.id === data.id ? data : conv)
      );

      // Update the conversation detail cache
      queryClient.setQueryData<Conversation>(
        conversationKeys.detail(data.id),
        data
      );
    },
  });
}

// Delete a conversation
export function useDeleteConversation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ conversationId }: { conversationId: string; agentId: string }): Promise<void> => {
      return tauriCommandClient.deleteConversation(conversationId);
    },
    onMutate: async ({ conversationId, agentId }) => {
      // Cancel any outgoing refetches to prevent overwriting our optimistic update
      await queryClient.cancelQueries({ queryKey: conversationKeys.list(agentId) });
      await queryClient.cancelQueries({ queryKey: conversationKeys.detail(conversationId) });
      await queryClient.cancelQueries({ queryKey: conversationKeys.messages(conversationId) });

      // Snapshot the previous conversations
      const previousConversations = queryClient.getQueryData<Conversation[]>(
        conversationKeys.list(agentId)
      );
      const previousConversationDetail = queryClient.getQueryData<Conversation>(
        conversationKeys.detail(conversationId)
      );
      const previousMessages = queryClient.getQueryData<Message[]>(
        conversationKeys.messages(conversationId)
      );

      // Optimistically remove the conversation from the list
      queryClient.setQueryData<Conversation[]>(
        conversationKeys.list(agentId),
        (old = []) => old.filter(conv => conv.id !== conversationId)
      );

      // Remove the conversation detail and messages immediately
      queryClient.removeQueries({ queryKey: conversationKeys.detail(conversationId) });
      queryClient.removeQueries({ queryKey: conversationKeys.messages(conversationId) });

      // Return context for potential rollback
      return { previousConversations, previousConversationDetail, previousMessages, conversationId };
    },
    onError: (err, { agentId }, context) => {
      console.error('Failed to delete conversation:', err);

      // Rollback to previous state on error
      if (context?.previousConversations) {
        queryClient.setQueryData(
          conversationKeys.list(agentId),
          context.previousConversations
        );
      }
      if (context?.previousConversationDetail) {
        queryClient.setQueryData(
          conversationKeys.detail(context.conversationId),
          context.previousConversationDetail
        );
      }
      if (context?.previousMessages) {
        queryClient.setQueryData(
          conversationKeys.messages(context.conversationId),
          context.previousMessages
        );
      }
    },
    onSuccess: async (_data, { agentId }) => {
      // Invalidate to ensure we're in sync with server
      queryClient.invalidateQueries({ queryKey: conversationKeys.list(agentId) });
    },
  });
}

// Send a message with streaming response
export function useSendMessageStreaming() {
  const queryClient = useQueryClient();
  const [streamingContent, setStreamingContent] = useState<string>('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingConversationId, setStreamingConversationId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toolAcceptanceMessage, setToolAcceptanceMessage] = useState<string | null>(null);
  const [toolAcceptanceTimestampMs, setToolAcceptanceTimestampMs] = useState<number | null>(null);
  const [inferredToolProgress, setInferredToolProgress] = useState<InferredToolProgressEvent[]>([]);
  const inferredToolProgressRef = useRef<InferredToolProgressEvent[]>([]);
  const inferredRunByToolRef = useRef<Map<string, string>>(new Map());
  const inferredRunByCallIdRef = useRef<Map<string, string>>(new Map());
  const inferredSequenceRef = useRef(0);
  const inferredRunCounterRef = useRef(0);
  const hasPublishedToolAcceptanceRef = useRef(false);

  const sendMessage = useCallback(async (request: SendMessageRequest): Promise<Message> => {
    const acceptanceNow = Date.now();
    setIsStreaming(true);
    setStreamingConversationId(request.conversation_id);
    setStreamingContent('');
    setError(null);
    setToolAcceptanceMessage('Accepted. Working on your request now.');
    setToolAcceptanceTimestampMs(acceptanceNow);
    setInferredToolProgress([]);
    inferredToolProgressRef.current = [];
    inferredRunByToolRef.current = new Map();
    inferredRunByCallIdRef.current = new Map();
    inferredSequenceRef.current = 0;
    hasPublishedToolAcceptanceRef.current = false;

    // Optimistically add user message to cache (like useSendMessage does)
    await queryClient.cancelQueries({
      queryKey: conversationKeys.messages(request.conversation_id)
    });

    const previousMessages = queryClient.getQueryData<Message[]>(
      conversationKeys.messages(request.conversation_id)
    );
    const parentId = getOptimisticParentId(previousMessages);

    const userMessage: Message = {
      id: `temp-${Date.now()}`,
      conversation_id: request.conversation_id,
      role: 'user',
      content: request.content,
      message_type: 'text',
      metadata: {},
      created_at: new Date().toISOString(),
      parent_id: parentId ?? undefined,
    };

    queryClient.setQueryData<Message[]>(
      conversationKeys.messages(request.conversation_id),
      (old = []) => [...old, userMessage]
    );

    const channel = new Channel<StreamEvent>();

    return new Promise((resolve, reject) => {
      let hasResolved = false;
      let tempAssistantMessageId: string | null = null;

      channel.onmessage = (event: StreamEvent) => {
        switch (event.type) {
          case 'Started':
            console.log('Streaming started');
            break;
          case 'Delta':
            {
              const lines = event.data.content.split('\n').map((line) => line.trim()).filter(Boolean);
              const progressBatch: InferredToolProgressEvent[] = [];
              for (const line of lines) {
                if (!hasPublishedToolAcceptanceRef.current) {
                  const acceptance = buildAcceptanceMessageFromLine(line);
                  if (acceptance) {
                    hasPublishedToolAcceptanceRef.current = true;
                    setToolAcceptanceMessage(acceptance);
                    setToolAcceptanceTimestampMs(Date.now());
                  }
                }
                const structuredEventMatch = line.match(
                  /^\[event:([^\]]+)\]\[provider:([^\]]+)\](?:\[tool:([^\]]+)\])?\s*(.*)$/
                );
                if (structuredEventMatch) {
                  const eventCode = structuredEventMatch[1].trim();
                  const toolKeyRaw = (structuredEventMatch[3] ?? '').trim();
                  const toolKey = normalizeInferredImplementationKey(toolKeyRaw);
                  const rawMessage = (structuredEventMatch[4] ?? '').trim();
                  if (!toolKey) {
                    continue;
                  }
                  const callId = rawMessage.match(/\bcall_id=([^\s]+)/)?.[1] ?? null;
                  let clientRunId = callId
                    ? inferredRunByCallIdRef.current.get(callId)
                    : inferredRunByToolRef.current.get(toolKey);
                  if (!clientRunId) {
                    inferredRunCounterRef.current += 1;
                    clientRunId = callId
                      ? `inferred-${toolKey}-${callId}`
                      : `inferred-${toolKey}-${Date.now()}-${inferredRunCounterRef.current}`;
                    inferredRunByToolRef.current.set(toolKey, clientRunId);
                    if (callId) {
                      inferredRunByCallIdRef.current.set(callId, clientRunId);
                    }
                  }
                  inferredSequenceRef.current += 1;
                  progressBatch.push({
                    clientRunId,
                    conversationId: request.conversation_id,
                    implementationKey: toolKey,
                    runId: rawMessage.match(/\brun_id=([^\s]+)/)?.[1] ?? null,
                    status: inferStatusFromToolEvent(eventCode, rawMessage),
                    message: rawMessage || eventCode.replace(/_/g, ' '),
                    sequence: inferredSequenceRef.current,
                    timestampMs: Date.now(),
                  });
                  continue;
                }

                const toolStepStartMatch = line.match(
                  /^\[tool-chain\]\s+phase=tool_step_started\s+step=\d+\s+tool=([^\s]+)\s+call_id=([^\s]+)$/
                );
                if (toolStepStartMatch) {
                  const toolName = toolStepStartMatch[1].trim();
                  const callId = toolStepStartMatch[2].trim();
                  const implementationKey = normalizeInferredImplementationKey(toolName);
                  inferredRunCounterRef.current += 1;
                  const clientRunId = `inferred-${implementationKey}-${callId}`;
                  inferredRunByToolRef.current.set(implementationKey, clientRunId);
                  inferredRunByCallIdRef.current.set(callId, clientRunId);
                  inferredSequenceRef.current += 1;
                  progressBatch.push({
                    clientRunId,
                    conversationId: request.conversation_id,
                    implementationKey,
                    runId: null,
                    status: 'running',
                    message: `Starting ${implementationKey}`,
                    sequence: inferredSequenceRef.current,
                    timestampMs: Date.now(),
                  });
                  continue;
                }

                if (line.startsWith('[tool:')) {
                  const startMatch = line.match(/^\[tool:([^\]]+)\]\s+starting\s+(.+)$/);
                  if (startMatch) {
                    const implementationKey = normalizeInferredImplementationKey(startMatch[1]);
                    let clientRunId = inferredRunByToolRef.current.get(implementationKey);
                    if (!clientRunId) {
                      inferredRunCounterRef.current += 1;
                      clientRunId = `inferred-${implementationKey}-${Date.now()}-${inferredRunCounterRef.current}`;
                      inferredRunByToolRef.current.set(implementationKey, clientRunId);
                    }
                    inferredSequenceRef.current += 1;
                    progressBatch.push({
                      clientRunId,
                      conversationId: request.conversation_id,
                      implementationKey,
                      runId: null,
                      status: 'running',
                      message: `Starting ${implementationKey}`,
                      sequence: inferredSequenceRef.current,
                      timestampMs: Date.now(),
                    });
                    continue;
                  }

                  const toolMatch = line.match(/^\[tool:([^\]]+)\](?:\[([^\]]+)\])?\s+(.+)$/);
                  if (!toolMatch) continue;
                  const implementationKey = normalizeInferredImplementationKey(toolMatch[1]);
                  const sourceType = (toolMatch[2] || '').toLowerCase();
                  const message = toolMatch[3].trim();
                  let clientRunId = inferredRunByToolRef.current.get(implementationKey);
                  if (!clientRunId) {
                    inferredRunCounterRef.current += 1;
                    clientRunId = `inferred-${implementationKey}-${Date.now()}-${inferredRunCounterRef.current}`;
                    inferredRunByToolRef.current.set(implementationKey, clientRunId);
                  }
                  const normalized = `${sourceType} ${message}`.toLowerCase();
                  const status = normalized.includes('succeeded')
                    ? 'succeeded'
                    : normalized.includes('failed') || normalized.includes('error')
                    ? 'failed'
                    : normalized.includes('cancelled')
                    ? 'cancelled'
                    : normalized.includes('timed_out')
                    ? 'timed_out'
                    : 'running';
                  inferredSequenceRef.current += 1;
                  progressBatch.push({
                    clientRunId,
                    conversationId: request.conversation_id,
                    implementationKey,
                    runId: null,
                    status,
                    message,
                    sequence: inferredSequenceRef.current,
                    timestampMs: Date.now(),
                  });
                }
              }
              if (progressBatch.length > 0) {
                const nextProgress = [...inferredToolProgressRef.current, ...progressBatch];
                inferredToolProgressRef.current = nextProgress;
                setInferredToolProgress(nextProgress);
              }
            }
            setStreamingContent(prev => prev + toUserFriendlyStreamingDelta(event.data.content));
            break;
          case 'Done':
            // Add assistant message to cache immediately (optimistic)
            const assistantMessage: Message = {
              id: `temp-assistant-${Date.now()}`,
              conversation_id: request.conversation_id,
              role: 'assistant',
              content: event.data.full_content,
              message_type: 'text',
              metadata: {},
              created_at: new Date().toISOString(),
              parent_id: userMessage.id,
            };
            tempAssistantMessageId = assistantMessage.id;
            queryClient.setQueryData<Message[]>(
              conversationKeys.messages(request.conversation_id),
              (old = []) => [...old, assistantMessage]
            );
            // Now safe to end streaming display
            setStreamingContent('');
            setIsStreaming(false);
            setStreamingConversationId(null);
            console.log('Streaming completed');
            break;
          case 'Error':
            setIsStreaming(false);
            setStreamingConversationId(null);
            setError(event.data.message);
            if (!hasResolved) {
              hasResolved = true;
              // Rollback to previous messages on error
              if (previousMessages !== undefined) {
                queryClient.setQueryData(
                  conversationKeys.messages(request.conversation_id),
                  previousMessages
                );
              }
              reject(new Error(event.data.message));
            }
            break;
        }
      };

      tauriCommandClient.sendMessageStreaming(request, channel)
        .then((message) => {
          if (hasResolved) return; // Already handled error
          hasResolved = true;
          setIsStreaming(false);
          setStreamingConversationId(null);

          const agentId = getAgentIdForConversation(queryClient, request.conversation_id);
          const persistedRuns = groupInferredRunsForPersistence(inferredToolProgressRef.current);
          const inferredMetadata: Record<string, unknown> = {
            ...(message.metadata ?? {}),
          };
          if (persistedRuns.length > 0) {
            inferredMetadata.inferred_tool_runs = persistedRuns;
          }
          if (toolAcceptanceMessage) {
            inferredMetadata.tool_acceptance_message = toolAcceptanceMessage;
            if (toolAcceptanceTimestampMs) {
              inferredMetadata.tool_acceptance_timestamp_ms = toolAcceptanceTimestampMs;
            }
          }
          const messageWithInferredRuns: Message = {
            ...message,
            metadata: inferredMetadata,
          };

          // Reconcile optimistic temp messages with DB IDs while preserving
          // inferred tool run metadata for reload hydration.
          queryClient.setQueryData<Message[]>(
            conversationKeys.messages(request.conversation_id),
            (old = []) => {
              const replaced = old.map((item) => {
                if (tempAssistantMessageId && item.id === tempAssistantMessageId) {
                  return messageWithInferredRuns;
                }
                return item;
              });
              if (replaced.some((item) => item.id === messageWithInferredRuns.id)) {
                return replaced;
              }
              return [...replaced, messageWithInferredRuns];
            }
          );

          // Update conversation timestamp
          queryClient.invalidateQueries({
            queryKey: conversationKeys.detail(request.conversation_id)
          });
          if (agentId) {
            invalidateAgentDashboardQueries(queryClient, agentId);
          } else {
            invalidateFallbackDashboardQueries(queryClient);
          }

          resolve(messageWithInferredRuns);
        })
        .catch((error) => {
          if (hasResolved) return; // Already handled error
          hasResolved = true;
          setIsStreaming(false);
          setStreamingConversationId(null);
          setError(error.message || 'Failed to send message');

          // Rollback to previous messages on error
          if (previousMessages !== undefined) {
            queryClient.setQueryData(
              conversationKeys.messages(request.conversation_id),
              previousMessages
            );
          }

          reject(error);
        });
    });
  }, [
    queryClient,
    toolAcceptanceMessage,
    toolAcceptanceTimestampMs,
  ]);

  return {
    sendMessage,
    streamingContent,
    isStreaming,
    streamingConversationId,
    error,
    toolAcceptanceMessage,
    toolAcceptanceTimestampMs,
    inferredToolProgress,
    clearError: useCallback(() => setError(null), [])
  };
}

// Delete a single message (and its assistant response if it's a user message)
export function useDeleteMessage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ messageId }: { messageId: string; conversationId: string }): Promise<string[]> => {
      return tauriCommandClient.deleteMessage(messageId);
    },
    onMutate: async ({ messageId, conversationId }) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({
        queryKey: conversationKeys.messages(conversationId)
      });

      // Snapshot previous messages
      const previousMessages = queryClient.getQueryData<Message[]>(
        conversationKeys.messages(conversationId)
      );

      // Get the message to check if it's a user message
      const message = previousMessages?.find(m => m.id === messageId);
      
      // Optimistically remove the message and its child (if user message)
      if (previousMessages) {
        let messageIdsToRemove = [messageId];
        
        // If it's a user message, also remove child assistant messages
        if (message?.role === 'user') {
          const childMessages = previousMessages.filter(
            m => m.parent_id === messageId && m.role === 'assistant'
          );
          messageIdsToRemove = [...messageIdsToRemove, ...childMessages.map(m => m.id)];
        }
        
        queryClient.setQueryData<Message[]>(
          conversationKeys.messages(conversationId),
          previousMessages.filter(m => !messageIdsToRemove.includes(m.id))
        );
      }

      return { previousMessages };
    },
    onError: (err, { conversationId }, context) => {
      console.error('Failed to delete message:', err);
      
      // Rollback on error
      if (context?.previousMessages) {
        queryClient.setQueryData(
          conversationKeys.messages(conversationId),
          context.previousMessages
        );
      }
    },
    onSuccess: (_data, { conversationId }) => {
      // Invalidate to ensure sync with server
      queryClient.invalidateQueries({
        queryKey: conversationKeys.messages(conversationId)
      });
    },
  });
}

// Edit message request type
export interface EditMessageRequest {
  message_id: string;
  conversation_id: string;
  new_content: string;
  image_base64?: string;
}

// Edit a message (creates a new branch with AI response) - streaming version
export function useEditMessageStreaming() {
  const queryClient = useQueryClient();
  const [streamingContent, setStreamingContent] = useState<string>('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const editMessage = useCallback(async (request: EditMessageRequest): Promise<[Message, Message]> => {
    setIsStreaming(true);
    setStreamingContent('');
    setError(null);

    // Optimistically add user message to cache
    await queryClient.cancelQueries({
      queryKey: conversationKeys.messages(request.conversation_id)
    });

    const previousMessages = queryClient.getQueryData<Message[]>(
      conversationKeys.messages(request.conversation_id)
    );

    // Find the original message to get its parent_id for the sibling
    const originalMessage = previousMessages?.find(m => m.id === request.message_id);
    const tempUserMessageId = `temp-edit-${Date.now()}`;
    const tempAssistantMessageId = `temp-assistant-edit-${Date.now()}`;

    const newUserMessage: Message = {
      id: tempUserMessageId,
      conversation_id: request.conversation_id,
      role: 'user',
      content: request.new_content,
      message_type: 'text',
      metadata: { edited_from: request.message_id },
      created_at: new Date().toISOString(),
      parent_id: originalMessage?.parent_id,
    };

    queryClient.setQueryData<Message[]>(
      conversationKeys.messages(request.conversation_id),
      (old = []) => [...old, newUserMessage]
    );

    const channel = new Channel<StreamEvent>();

    return new Promise((resolve, reject) => {
      let hasResolved = false;

      channel.onmessage = (event: StreamEvent) => {
        switch (event.type) {
          case 'Started':
            console.log('Edit streaming started');
            break;
          case 'Delta':
            setStreamingContent(prev => prev + toUserFriendlyStreamingDelta(event.data.content));
            break;
          case 'Done':
            // Keep streaming bubble visible until invoke resolves and we reconcile
            // temp IDs with real DB IDs.
            console.log('Edit streaming completed');
            break;
          case 'Error':
            setIsStreaming(false);
            setError(event.data.message);
            if (!hasResolved) {
              hasResolved = true;
              // Rollback to previous messages on error
              if (previousMessages !== undefined) {
                queryClient.setQueryData(
                  conversationKeys.messages(request.conversation_id),
                  previousMessages
                );
              }
              reject(new Error(event.data.message));
            }
            break;
        }
      };

      tauriCommandClient.editMessageStreaming(
        request.message_id,
        request.new_content,
        channel,
        request.image_base64
      )
        .then((result) => {
          if (hasResolved) return;
          hasResolved = true;
          setIsStreaming(false);
          setStreamingContent('');

          const [savedUserMessage, savedAssistantMessage] = result;

          // Reconcile optimistic temp messages with real DB messages immediately.
          queryClient.setQueryData<Message[]>(
            conversationKeys.messages(request.conversation_id),
            (old = []) => {
              const withoutTemps = old.filter(
                (message) =>
                  message.id !== tempUserMessageId &&
                  message.id !== tempAssistantMessageId
              );
              return [...withoutTemps, savedUserMessage, savedAssistantMessage];
            }
          );

          const agentId = getAgentIdForConversation(queryClient, request.conversation_id);

          // Invalidate messages to reconcile branch/message IDs
          queryClient.invalidateQueries({
            queryKey: conversationKeys.messages(request.conversation_id)
          });

          if (agentId) {
            invalidateAgentDashboardQueries(queryClient, agentId);
          } else {
            invalidateFallbackDashboardQueries(queryClient);
          }

          resolve(result);
        })
        .catch((error) => {
          if (hasResolved) return;
          hasResolved = true;
          setIsStreaming(false);
          setError(error.message || 'Failed to edit message');

          // Rollback
          if (previousMessages !== undefined) {
            queryClient.setQueryData(
              conversationKeys.messages(request.conversation_id),
              previousMessages
            );
          }

          reject(error);
        });
    });
  }, [queryClient]);

  return {
    editMessage,
    streamingContent,
    isStreaming,
    error,
    clearError: useCallback(() => setError(null), [])
  };
}