import { QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { createTestQueryClient } from "@/test/utils";
import { useFeedbackStats, useSubmitFeedback } from "./useFeedback";
import { feedbackKeys } from "@/lib/query-keys";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@/lib/tauri-store", () => ({
  getCachedData: vi.fn(() => undefined),
  getCachedDataUpdatedAt: vi.fn(() => undefined),
}));

describe("useFeedback hooks", () => {
  it("loads feedback stats", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({ positive: 4, negative: 2, neutral: 1 });

    const queryClient = createTestQueryClient();
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: queryClient }, children);

    const { result } = renderHook(() => useFeedbackStats("agent-1"), { wrapper });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data?.positive).toBe(4);
    expect(invokeMock).toHaveBeenCalledWith("get_agent_feedback_stats", { agentId: "agent-1" });
  });

  it("applies optimistic conversation feedback entry on mutate", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce(undefined);

    const queryClient = createTestQueryClient();
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: queryClient }, children);
    const { result } = renderHook(() => useSubmitFeedback("agent-1"), { wrapper });

    await result.current.mutateAsync({
      message_id: "m1",
      user_id: "u1",
      feedback_type: "positive",
      conversation_id: "c1",
      dimension_ratings: { tone: "up" },
    });

    const thumbs = queryClient.getQueryData<Record<string, string>>(feedbackKeys.conversation("c1", "u1"));
    expect(thumbs?.m1).toBe("positive");
  });

  it("rolls back conversation + stats + monthly feedback caches on mutation error", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockRejectedValueOnce(new Error("submit failed"));
    const queryClient = createTestQueryClient();
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: queryClient }, children);

    queryClient.setQueryData(feedbackKeys.conversation("c1", "u1"), { m1: "positive" });
    queryClient.setQueryData([...feedbackKeys.conversation("c1", "u1"), "dimensions"], {
      m1: { tone: "up" },
    });
    queryClient.setQueryData(feedbackKeys.stats("agent-1"), {
      positive: 3,
      negative: 1,
      neutral: 0,
    });
    queryClient.setQueryData(feedbackKeys.monthly("agent-1"), [
      { month: "2026-02", positive: 3, negative: 1 },
    ]);

    const { result } = renderHook(() => useSubmitFeedback("agent-1"), { wrapper });
    await expect(
      result.current.mutateAsync({
        message_id: "m1",
        user_id: "u1",
        feedback_type: "negative",
        conversation_id: "c1",
        dimension_ratings: { tone: "down" },
      })
    ).rejects.toThrow("submit failed");

    const thumbs = queryClient.getQueryData<Record<string, string>>(feedbackKeys.conversation("c1", "u1"));
    const dimensions = queryClient.getQueryData<Record<string, { tone?: string }>>([
      ...feedbackKeys.conversation("c1", "u1"),
      "dimensions",
    ]);
    const stats = queryClient.getQueryData<{ positive: number; negative: number; neutral: number }>(
      feedbackKeys.stats("agent-1")
    );
    const monthly = queryClient.getQueryData<Array<{ month: string; positive: number; negative: number }>>(
      feedbackKeys.monthly("agent-1")
    );

    expect(thumbs?.m1).toBe("positive");
    expect(dimensions?.m1?.tone).toBe("up");
    expect(stats).toEqual({ positive: 3, negative: 1, neutral: 0 });
    expect(monthly).toEqual([{ month: "2026-02", positive: 3, negative: 1 }]);
  });
});
