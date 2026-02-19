import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { createTestQueryClient } from "@/test/utils";
import { useAgents, useCreateAgent, agentKeys } from "./useAgents";
import type { Agent } from "@/types/agent";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@/lib/tauri-store", () => ({
  getCachedData: vi.fn(() => undefined),
  getCachedDataUpdatedAt: vi.fn(() => undefined),
}));

describe("useAgents", () => {
  it("loads agent list from tauri invoke", async () => {
    const invokeMock = vi.mocked(invoke);
    const agent: Agent = {
      id: "a1",
      user_id: "u1",
      name: "Agent One",
      persona: "test",
      provider_type: "openai",
      model_id: "gpt-4o-mini",
      state: "active",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    invokeMock.mockResolvedValueOnce([agent]);

    const queryClient = createTestQueryClient();
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: queryClient }, children);

    const { result } = renderHook(() => useAgents("u1"), { wrapper });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toEqual([agent]);
    expect(invokeMock).toHaveBeenCalledWith("list_agents", { userId: "u1" });
  });

  it("applies optimistic create and rolls back on error", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockRejectedValueOnce(new Error("create failed"));
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const queryClient = createTestQueryClient();
    queryClient.setQueryData(agentKeys.list("u1"), [
      {
        id: "existing",
        user_id: "u1",
        name: "Existing",
        persona: "base",
        provider_type: "openai",
        model_id: "gpt-4o-mini",
        state: "active",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } as Agent,
    ]);

    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: queryClient }, children);
    const { result } = renderHook(() => useCreateAgent(), { wrapper });

    await expect(
      result.current.mutateAsync({
        user_id: "u1",
        name: "New Agent",
        persona: "test",
        provider_type: "openai",
        model_id: "gpt-4o-mini",
      })
    ).rejects.toThrow("create failed");

    const data = queryClient.getQueryData<Agent[]>(agentKeys.list("u1"));
    expect(data).toHaveLength(1);
    expect(data?.[0]?.id).toBe("existing");
    expect(consoleErrorSpy).toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });
});
