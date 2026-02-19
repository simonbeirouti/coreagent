import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { invoke } from '@tauri-apps/api/core';
import { Agent, CreateAgentRequest, UpdateAgentRequest } from '../types';
import { getCachedData, getCachedDataUpdatedAt } from '../lib/tauri-store';
import { agentKeys } from '@/lib/query-keys';

export { agentKeys };

// Fetch all agents for a user
export function useAgents(userId: string) {
  const initialData = getCachedData<Agent[]>(agentKeys.list(userId));
  const initialDataUpdatedAt = getCachedDataUpdatedAt(agentKeys.list(userId));

  return useQuery({
    queryKey: agentKeys.list(userId),
    queryFn: async (): Promise<Agent[]> => {
      return await invoke('list_agents', { userId });
    },
    enabled: !!userId,
    initialData,
    initialDataUpdatedAt,
  });
}

// Fetch a single agent
export function useAgent(agentId: string) {
  const initialData = getCachedData<Agent>(agentKeys.detail(agentId));
  const initialDataUpdatedAt = getCachedDataUpdatedAt(agentKeys.detail(agentId));

  return useQuery({
    queryKey: agentKeys.detail(agentId),
    queryFn: async (): Promise<Agent> => {
      return await invoke('get_agent', { agentId });
    },
    enabled: !!agentId,
    initialData,
    initialDataUpdatedAt,
  });
}

// Create a new agent
export function useCreateAgent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (request: CreateAgentRequest): Promise<Agent> => {
      return await invoke('create_agent', { request });
    },
    onMutate: async (request) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: agentKeys.list(request.user_id) });

      // Snapshot previous agents
      const previousAgents = queryClient.getQueryData<Agent[]>(
        agentKeys.list(request.user_id)
      );

      // Optimistically add new agent
      queryClient.setQueryData<Agent[]>(
        agentKeys.list(request.user_id),
        (old = []) => [
          ...old,
          {
            id: `temp-${Date.now()}`,
            user_id: request.user_id,
            name: request.name,
            persona: request.persona,
            provider_type: request.provider_type,
            model_id: request.model_id,
            state: 'active',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          } as Agent,
        ]
      );

      return { previousAgents, userId: request.user_id };
    },
    onError: (err, _request, context) => {
      console.error('Failed to create agent:', err);
      
      // Rollback on error
      if (context?.previousAgents) {
        queryClient.setQueryData(
          agentKeys.list(context.userId),
          context.previousAgents
        );
      }
    },
    onSettled: (_data, _error, request) => {
      // Refetch to ensure consistency
      queryClient.invalidateQueries({ queryKey: agentKeys.list(request.user_id) });
    },
  });
}

// Update an agent
export function useUpdateAgent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      agentId,
      updates,
    }: {
      agentId: string;
      updates: UpdateAgentRequest;
    }): Promise<Agent> => {
      return await invoke('update_agent', { agentId, updates });
    },
    onMutate: async ({ agentId, updates }) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: agentKeys.detail(agentId) });
      await queryClient.cancelQueries({ queryKey: agentKeys.lists() });

      // Snapshot previous data
      const previousAgent = queryClient.getQueryData<Agent>(agentKeys.detail(agentId));
      const previousLists = queryClient.getQueriesData<Agent[]>({ queryKey: agentKeys.lists() });

      // Optimistically update agent detail
      if (previousAgent) {
        queryClient.setQueryData<Agent>(agentKeys.detail(agentId), {
          ...previousAgent,
          ...updates,
          updated_at: new Date().toISOString(),
        });

        // Optimistically update in all list caches
        previousLists.forEach(([queryKey]) => {
          queryClient.setQueryData<Agent[]>(queryKey, (old = []) =>
            old.map((agent) =>
              agent.id === agentId
                ? { ...agent, ...updates, updated_at: new Date().toISOString() }
                : agent
            )
          );
        });
      }

      return { previousAgent, previousLists, agentId };
    },
    onError: (err, _variables, context) => {
      console.error('Failed to update agent:', err);
      
      // Rollback on error
      if (context?.previousAgent) {
        queryClient.setQueryData(agentKeys.detail(context.agentId), context.previousAgent);
      }
      if (context?.previousLists) {
        context.previousLists.forEach(([queryKey, data]) => {
          queryClient.setQueryData(queryKey, data);
        });
      }
    },
    onSettled: (_data, _error, variables) => {
      // Refetch to ensure consistency
      queryClient.invalidateQueries({ queryKey: agentKeys.detail(variables.agentId) });
      queryClient.invalidateQueries({ queryKey: agentKeys.lists() });
    },
  });
}

// Delete an agent
export function useDeleteAgent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (agentId: string): Promise<void> => {
      return await invoke('delete_agent', { agentId });
    },
    onMutate: async (agentId) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: agentKeys.lists() });

      // Snapshot previous lists
      const previousLists = queryClient.getQueriesData<Agent[]>({ queryKey: agentKeys.lists() });

      // Optimistically remove from all list caches
      previousLists.forEach(([queryKey]) => {
        queryClient.setQueryData<Agent[]>(queryKey, (old = []) =>
          old.filter((agent) => agent.id !== agentId)
        );
      });

      return { previousLists, agentId };
    },
    onError: (err, _agentId, context) => {
      console.error('Failed to delete agent:', err);
      
      // Rollback on error
      if (context?.previousLists) {
        context.previousLists.forEach(([queryKey, data]) => {
          queryClient.setQueryData(queryKey, data);
        });
      }
    },
    onSuccess: (_, agentId) => {
      // Remove from cache permanently
      queryClient.removeQueries({ queryKey: agentKeys.detail(agentId) });
    },
    onSettled: () => {
      // Refetch to ensure consistency
      queryClient.invalidateQueries({ queryKey: agentKeys.lists() });
    },
  });
}