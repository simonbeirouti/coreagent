import { QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { createTestQueryClient } from "@/test/utils";
import { useConversations, useCreateConversation, conversationKeys } from "./useConversations";
import type { Conversation } from "@/types/conversation";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  Channel: class {},
}));

vi.mock("@/lib/tauri-store", () => ({
  getCachedData: vi.fn(() => undefined),
  getCachedDataUpdatedAt: vi.fn(() => undefined),
}));

describe("useConversations", () => {
  it("loads conversation list by agent", async () => {
    const invokeMock = vi.mocked(invoke);
    const conversations: Conversation[] = [
      {
        id: "c1",
        agent_id: "a1",
        user_id: "u1",
        title: "Test Conversation",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ];
    invokeMock.mockResolvedValueOnce(conversations);

    const queryClient = createTestQueryClient();
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: queryClient }, children);

    const { result } = renderHook(() => useConversations("a1"), { wrapper });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toEqual(conversations);
    expect(invokeMock).toHaveBeenCalledWith("list_conversations", { agentId: "a1" });
  });

  it("applies optimistic create and reconciles temp id on success", async () => {
    const invokeMock = vi.mocked(invoke);
    const queryClient = createTestQueryClient();
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: queryClient }, children);
    const existingConversation: Conversation = {
      id: "existing-1",
      agent_id: "a1",
      user_id: "u1",
      title: "Existing",
      created_at: "2026-02-13T00:00:00.000Z",
      updated_at: "2026-02-13T00:00:00.000Z",
    };
    queryClient.setQueryData(conversationKeys.list("a1"), [existingConversation]);

    let resolveCreate!: (value: Conversation) => void;
    const createPromise = new Promise<Conversation>((resolve) => {
      resolveCreate = resolve;
    });
    invokeMock.mockImplementationOnce(async (command) => {
      if (command === "create_conversation") {
        return createPromise;
      }
      throw new Error(`unexpected command: ${String(command)}`);
    });

    const { result } = renderHook(() => useCreateConversation(), { wrapper });
    const mutatePromise = result.current.mutateAsync({
      agent_id: "a1",
      user_id: "u1",
      title: "New Conversation",
    });

    let tempId = "";
    await waitFor(() => {
      const optimisticList = queryClient.getQueryData<Conversation[]>(conversationKeys.list("a1")) ?? [];
      expect(optimisticList).toHaveLength(2);
      expect(optimisticList[0]?.id.startsWith("temp-conversation-")).toBe(true);
      tempId = optimisticList[0]!.id;
    });

    expect(queryClient.getQueryData(conversationKeys.detail(tempId))).toBeDefined();
    expect(queryClient.getQueryData(conversationKeys.messages(tempId))).toEqual([]);

    resolveCreate({
      id: "server-1",
      agent_id: "a1",
      user_id: "u1",
      title: "Server Conversation",
      created_at: "2026-02-13T00:01:00.000Z",
      updated_at: "2026-02-13T00:01:00.000Z",
    });
    await mutatePromise;

    const settledList = queryClient.getQueryData<Conversation[]>(conversationKeys.list("a1")) ?? [];
    expect(settledList.map((item) => item.id)).toContain("server-1");
    expect(settledList.map((item) => item.id)).not.toContain(tempId);
    expect(queryClient.getQueryData(conversationKeys.detail("server-1"))).toBeDefined();
    expect(queryClient.getQueryData(conversationKeys.detail(tempId))).toBeUndefined();
    expect(queryClient.getQueryData(conversationKeys.messages(tempId))).toBeUndefined();
  });

  it("rolls back optimistic create when request fails", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockRejectedValueOnce(new Error("create failed"));
    const queryClient = createTestQueryClient();
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: queryClient }, children);
    const baseline: Conversation[] = [
      {
        id: "existing-2",
        agent_id: "a1",
        user_id: "u1",
        title: "Baseline",
        created_at: "2026-02-13T00:00:00.000Z",
        updated_at: "2026-02-13T00:00:00.000Z",
      },
    ];
    queryClient.setQueryData(conversationKeys.list("a1"), baseline);

    const { result } = renderHook(() => useCreateConversation(), { wrapper });
    await expect(
      result.current.mutateAsync({
        agent_id: "a1",
        user_id: "u1",
        title: "Should Rollback",
      })
    ).rejects.toThrow("create failed");

    expect(queryClient.getQueryData(conversationKeys.list("a1"))).toEqual(baseline);
  });
});
