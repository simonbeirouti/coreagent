import { useState, useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { invoke, Channel } from '@tauri-apps/api/core';
import { Conversation, Message, CreateConversationRequest, SendMessageRequest, StreamEvent } from '../types';
import { getCachedData, getCachedDataUpdatedAt, removeCachedQueriesMatching, persistMemoryCache } from '../lib/tauri-store';

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
      // Add the new conversation to the cache
      queryClient.setQueryData<Conversation[]>(
        conversationKeys.list(data.agent_id),
        (old = []) => {
          // Check if it already exists (avoid duplicates)
          if (old.some(conv => conv.id === data.id)) {
            return old;
          }
          return [data, ...old];
        }
      );

      // Set up the conversation's cache entries
      queryClient.setQueryData<Conversation>(
        conversationKeys.detail(data.id),
        data
      );

      // Pre-populate empty messages for the conversation
      queryClient.setQueryData<Message[]>(
        conversationKeys.messages(data.id),
        []
      );
    },
  });
}

// Create a conversation instantly with optimistic update
// Returns the temporary ID immediately, then updates to real ID via callback
export function useCreateConversationInstant() {
  const queryClient = useQueryClient();
  const [pendingCreates, setPendingCreates] = useState<Map<string, string>>(new Map());

  const createInstant = useCallback((
    request: CreateConversationRequest,
    onRealIdReady?: (realId: string) => void
  ): string => {
    const tempId = `temp-${Date.now()}`;
    
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
    setPendingCreates(prev => new Map(prev).set(tempId, 'pending'));

    // Create in background
    invoke<Conversation>('create_conversation', { request })
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
        setPendingCreates(prev => {
          const next = new Map(prev);
          next.delete(tempId);
          return next;
        });

        // Notify caller of real ID
        onRealIdReady?.(realConversation.id);
      })
      .catch((error) => {
        console.error('Failed to create conversation:', error);
        
        // Remove the optimistic conversation
        queryClient.setQueryData<Conversation[]>(
          conversationKeys.list(request.agent_id),
          (old = []) => old.filter(conv => conv.id !== tempId)
        );
        queryClient.removeQueries({ queryKey: conversationKeys.messages(tempId) });

        setPendingCreates(prev => {
          const next = new Map(prev);
          next.delete(tempId);
          return next;
        });
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
      return await invoke('send_message', {
        conversationId: request.conversation_id,
        content: request.content,
        imageBase64: request.image_base64,
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

// Update conversation title
export function useUpdateConversationTitle() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ conversationId, title }: { conversationId: string; title: string | null }): Promise<Conversation> => {
      return await invoke('update_conversation_title', { conversationId, title });
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
      return await invoke('generate_conversation_title', { conversationId, firstMessage });
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
    onError: (error) => {
      // Silently log title generation errors - don't show to user since this is background operation
      console.warn('Failed to generate conversation title:', error);
    },
  });
}

// Delete a conversation
export function useDeleteConversation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ conversationId }: { conversationId: string; agentId: string }): Promise<void> => {
      return await invoke('delete_conversation', { conversationId });
    },
    onMutate: async ({ conversationId, agentId }) => {
      // Cancel any outgoing refetches to prevent overwriting our optimistic update
      await queryClient.cancelQueries({ queryKey: conversationKeys.list(agentId) });

      // Snapshot the previous conversations
      const previousConversations = queryClient.getQueryData<Conversation[]>(
        conversationKeys.list(agentId)
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
      return { previousConversations };
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
    },
    onSuccess: async (_data, { agentId, conversationId }) => {
      // Invalidate to ensure we're in sync with server
      queryClient.invalidateQueries({ queryKey: conversationKeys.list(agentId) });

      // Also remove from the persisted Tauri store cache
      removeCachedQueriesMatching((queryKey: unknown) => {
        if (!Array.isArray(queryKey)) return false;
        // Remove conversation detail, messages, and list entries containing this conversation
        return (
          (queryKey[0] === 'conversations' && queryKey[1] === 'detail' && queryKey[2] === conversationId) ||
          (queryKey[0] === 'conversations' && queryKey[1] === 'messages' && queryKey[2] === conversationId)
        );
      });

      // Persist the updated cache to disk
      await persistMemoryCache();
    },
  });
}

// Send a message with streaming response
export function useSendMessageStreaming() {
  const queryClient = useQueryClient();
  const [streamingContent, setStreamingContent] = useState<string>('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sendMessage = useCallback(async (request: SendMessageRequest): Promise<Message> => {
    setIsStreaming(true);
    setStreamingContent('');
    setError(null);

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

      channel.onmessage = (event: StreamEvent) => {
        switch (event.type) {
          case 'Started':
            console.log('Streaming started');
            break;
          case 'Delta':
            setStreamingContent(prev => prev + event.data.content);
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
            queryClient.setQueryData<Message[]>(
              conversationKeys.messages(request.conversation_id),
              (old = []) => [...old, assistantMessage]
            );
            // Now safe to end streaming display
            setStreamingContent('');
            setIsStreaming(false);
            console.log('Streaming completed');
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

      invoke<Message>('send_message_streaming', {
        conversationId: request.conversation_id,
        content: request.content,
        imageBase64: request.image_base64,
        onEvent: channel,
      })
        .then((message) => {
          if (hasResolved) return; // Already handled error
          hasResolved = true;
          setIsStreaming(false);

          // Invalidate messages to refetch both user and assistant messages from DB
          // This ensures we get both messages with correct IDs
          queryClient.invalidateQueries({
            queryKey: conversationKeys.messages(request.conversation_id)
          });

          // Update conversation timestamp
          queryClient.invalidateQueries({
            queryKey: conversationKeys.detail(request.conversation_id)
          });
          queryClient.invalidateQueries({
            queryKey: conversationKeys.lists()
          });

          resolve(message);
        })
        .catch((error) => {
          if (hasResolved) return; // Already handled error
          hasResolved = true;
          setIsStreaming(false);
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
  }, [queryClient]);

  return {
    sendMessage,
    streamingContent,
    isStreaming,
    error,
    clearError: useCallback(() => setError(null), [])
  };
}

// Delete a single message (and its assistant response if it's a user message)
export function useDeleteMessage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ messageId }: { messageId: string; conversationId: string }): Promise<string[]> => {
      return await invoke('delete_message', { messageId });
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
            setStreamingContent(prev => prev + event.data.content);
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

      invoke<[Message, Message]>('edit_message_streaming', {
        messageId: request.message_id,
        newContent: request.new_content,
        imageBase64: request.image_base64,
        onEvent: channel,
      })
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

          // Invalidate messages to refetch all messages with correct IDs
          queryClient.invalidateQueries({
            queryKey: conversationKeys.messages(request.conversation_id)
          });

          // Update conversation timestamp
          queryClient.invalidateQueries({
            queryKey: conversationKeys.lists()
          });

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