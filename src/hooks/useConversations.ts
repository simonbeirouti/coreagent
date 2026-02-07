import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { invoke } from '@tauri-apps/api/core';
import { Conversation, Message, CreateConversationRequest, SendMessageRequest } from '../types';
import { getCachedData, getCachedDataUpdatedAt } from '../lib/tauri-store';

// Query keys
export const conversationKeys = {
  all: ['conversations'] as const,
  lists: () => [...conversationKeys.all, 'list'] as const,
  list: (agentId: string) => [...conversationKeys.lists(), agentId] as const,
  details: () => [...conversationKeys.all, 'detail'] as const,
  detail: (id: string) => [...conversationKeys.details(), id] as const,
  messages: (conversationId: string) => [...conversationKeys.all, 'messages', conversationId] as const,
};

// Fetch conversations for an agent
export function useConversations(agentId: string) {
  const initialData = getCachedData<Conversation[]>(conversationKeys.list(agentId));
  const initialDataUpdatedAt = getCachedDataUpdatedAt(conversationKeys.list(agentId));

  return useQuery({
    queryKey: conversationKeys.list(agentId),
    queryFn: async (): Promise<Conversation[]> => {
      return await invoke('list_conversations', { agentId });
    },
    enabled: !!agentId,
    initialData,
    initialDataUpdatedAt,
  });
}

// Fetch a single conversation
export function useConversation(conversationId: string) {
  const initialData = getCachedData<Conversation>(conversationKeys.detail(conversationId));
  const initialDataUpdatedAt = getCachedDataUpdatedAt(conversationKeys.detail(conversationId));

  return useQuery({
    queryKey: conversationKeys.detail(conversationId),
    queryFn: async (): Promise<Conversation> => {
      return await invoke('get_conversation', { conversationId });
    },
    enabled: !!conversationId,
    initialData,
    initialDataUpdatedAt,
  });
}

// Fetch messages for a conversation
export function useMessages(conversationId: string) {
  const initialData = getCachedData<Message[]>(conversationKeys.messages(conversationId));
  const initialDataUpdatedAt = getCachedDataUpdatedAt(conversationKeys.messages(conversationId));

  return useQuery({
    queryKey: conversationKeys.messages(conversationId),
    queryFn: async (): Promise<Message[]> => {
      return await invoke('get_conversation_messages', { conversationId });
    },
    enabled: !!conversationId,
    initialData,
    initialDataUpdatedAt,
  });
}

// Create a new conversation
export function useCreateConversation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (request: CreateConversationRequest): Promise<Conversation> => {
      return await invoke('create_conversation', { request });
    },
    onSuccess: (data) => {
      // Invalidate conversations list for this agent
      queryClient.invalidateQueries({ queryKey: conversationKeys.list(data.agent_id) });
    },
  });
}

// Send a message to a conversation
export function useSendMessage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (request: SendMessageRequest): Promise<Message> => {
      return await invoke('send_message', {
        conversationId: request.conversation_id,
        content: request.content,
      });
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
      // Replace the entire messages list with fresh data from server
      // The server returns the AI response, so we need to refetch to get both messages
      queryClient.invalidateQueries({ 
        queryKey: conversationKeys.messages(request.conversation_id) 
      });
      
      // Also invalidate conversation details to update timestamp
      queryClient.invalidateQueries({ 
        queryKey: conversationKeys.detail(request.conversation_id) 
      });
      
      // Invalidate conversation list to update "last message" previews
      queryClient.invalidateQueries({ 
        queryKey: conversationKeys.lists() 
      });
    },
  });
}