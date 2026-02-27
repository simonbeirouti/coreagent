import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { cacheFirstStaticQueryPolicy } from '@/lib/query-policies';
import { projectKeys } from '@/lib/query-keys';
import { tauriCommandClient } from '@/lib/tauri-command-client';

export interface ProjectRecord {
  id: string;
  owner_user_id: string;
  manager_agent_id: string;
  run_id: string;
  manager_conversation_id?: string | null;
  name: string;
  objective: string;
  status: string;
  manager_agent_name: string;
  manager_model_id: string;
  created_at: string;
  updated_at: string;
}

export function useProjects(enabled = true) {
  return useQuery({
    queryKey: projectKeys.list(),
    queryFn: (): Promise<ProjectRecord[]> => tauriCommandClient.listOrchestrationProjects(),
    enabled,
    ...cacheFirstStaticQueryPolicy,
  });
}

export function useCurrentProject(enabled = true) {
  return useQuery({
    queryKey: projectKeys.current(),
    queryFn: (): Promise<ProjectRecord | null> => tauriCommandClient.getCurrentOrchestrationProject(),
    enabled,
    ...cacheFirstStaticQueryPolicy,
  });
}

export function useSetCurrentProject() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (projectId: string): Promise<ProjectRecord | null> =>
      tauriCommandClient.setCurrentOrchestrationProject(projectId),
    onSuccess: (project) => {
      queryClient.setQueryData(projectKeys.current(), project);
      queryClient.invalidateQueries({ queryKey: projectKeys.list() });
    },
  });
}

export function useCreateProject() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (request: {
      manager_agent_id: string;
      name: string;
      objective: string;
      priority?: 'low' | 'normal' | 'high';
    }): Promise<ProjectRecord> => tauriCommandClient.createOrchestrationProject(request),
    onSuccess: (project) => {
      queryClient.setQueryData(projectKeys.current(), project);
      queryClient.invalidateQueries({ queryKey: projectKeys.list() });
      queryClient.invalidateQueries({ queryKey: projectKeys.current() });
    },
  });
}
