"use client";

import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type {
  AgentState,
  AgentsData,
  JobsData,
  OverviewData,
  SkillsData,
  ToolsData,
  UsersData,
} from "@/lib/admin/types";

const REFRESH_INTERVAL_MS = 20_000;

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    method: "GET",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`);
  }

  return (await response.json()) as T;
}

async function patchJson<T, TVars>(url: string, body: TVars): Promise<T> {
  const response = await fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Failed to patch ${url}: ${response.status} ${message}`);
  }

  return (await response.json()) as T;
}

export const adminQueryKeys = {
  overview: ["admin", "overview"] as const,
  users: ["admin", "users"] as const,
  agents: ["admin", "agents"] as const,
  skills: ["admin", "skills"] as const,
  jobs: ["admin", "jobs"] as const,
  tools: ["admin", "tools"] as const,
};

export const overviewOptions = queryOptions({
  queryKey: adminQueryKeys.overview,
  queryFn: () => fetchJson<OverviewData>("/api/admin/overview"),
  refetchInterval: REFRESH_INTERVAL_MS,
});

export const usersOptions = queryOptions({
  queryKey: adminQueryKeys.users,
  queryFn: () => fetchJson<UsersData>("/api/admin/users"),
  refetchInterval: REFRESH_INTERVAL_MS,
});

export const agentsOptions = queryOptions({
  queryKey: adminQueryKeys.agents,
  queryFn: () => fetchJson<AgentsData>("/api/admin/agents"),
  refetchInterval: REFRESH_INTERVAL_MS,
});

export const skillsOptions = queryOptions({
  queryKey: adminQueryKeys.skills,
  queryFn: () => fetchJson<SkillsData>("/api/admin/skills"),
  refetchInterval: REFRESH_INTERVAL_MS,
});

export const jobsOptions = queryOptions({
  queryKey: adminQueryKeys.jobs,
  queryFn: () => fetchJson<JobsData>("/api/admin/jobs"),
  refetchInterval: REFRESH_INTERVAL_MS,
});

export const toolsOptions = queryOptions({
  queryKey: adminQueryKeys.tools,
  queryFn: () => fetchJson<ToolsData>("/api/admin/tools"),
  refetchInterval: REFRESH_INTERVAL_MS,
});

export function useOverviewQuery() {
  return useQuery(overviewOptions);
}

export function useUsersQuery() {
  return useQuery(usersOptions);
}

export function useAgentsQuery() {
  return useQuery(agentsOptions);
}

export function useSkillsQuery() {
  return useQuery(skillsOptions);
}

export function useJobsQuery() {
  return useQuery(jobsOptions);
}

export function useToolsQuery() {
  return useQuery(toolsOptions);
}

type UpdateAgentStateVars = {
  agentId: string;
  state: AgentState;
};

type UpdateAgentStateResult = {
  ok: true;
  state: AgentState;
};

export function useUpdateAgentStateMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationKey: ["admin", "agents", "update-state"],
    mutationFn: ({ agentId, state }: UpdateAgentStateVars) =>
      patchJson<UpdateAgentStateResult, { state: AgentState }>(
        `/api/admin/agents/${agentId}/state`,
        { state },
      ),
    onMutate: async ({ agentId, state }) => {
      await queryClient.cancelQueries({ queryKey: adminQueryKeys.agents });
      const previous = queryClient.getQueryData<AgentsData>(adminQueryKeys.agents);

      queryClient.setQueryData<AgentsData>(adminQueryKeys.agents, (current) => {
        if (!current) {
          return current;
        }

        return {
          ...current,
          rows: current.rows.map((row) =>
            row.id === agentId
              ? {
                  ...row,
                  state,
                  updatedAt: new Date().toISOString(),
                }
              : row,
          ),
        };
      });

      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(adminQueryKeys.agents, context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: adminQueryKeys.agents });
      queryClient.invalidateQueries({ queryKey: adminQueryKeys.overview });
    },
  });
}
