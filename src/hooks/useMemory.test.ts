import { QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { createTestQueryClient } from "@/test/utils";
import { useRetrievalTuningStatus } from "./useMemory";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@/lib/tauri-store", () => ({
  getCachedData: vi.fn(() => undefined),
  getCachedDataUpdatedAt: vi.fn(() => undefined),
}));

describe("useMemory hooks", () => {
  it("loads retrieval tuning status", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      current_threshold: 0.7,
      min_threshold: 0.55,
      max_threshold: 0.9,
      auto_tune_enabled: true,
      cooldown_minutes: 30,
      last_tuned_at: null,
      last_decision_reason: null,
      quality: {
        sample_size: 0,
        hit_rate: 0,
        avg_top_similarity: 0,
        p95_latency_ms: 0,
        hit_rate_stddev: 0,
        judged_precision: null,
        quality_score: 0,
        passes_guardrails: false,
        reasons: ["insufficient_sample_size"],
        source_mix: {
          user_override_count: 0,
          weighted_blend_count: 0,
          agent_only_count: 0,
          heuristic_fallback_count: 0,
        },
        confidence_target: 0.7,
        confidence_scored_sample_size: 0,
        confidence_above_target_count: 0,
        confidence_above_target_ratio: 0,
        evaluated_at: new Date().toISOString(),
      },
      recent_decisions: [],
    });

    const queryClient = createTestQueryClient();
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: queryClient }, children);

    const { result } = renderHook(() => useRetrievalTuningStatus("agent-1"), { wrapper });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data?.current_threshold).toBe(0.7);
    expect(invokeMock).toHaveBeenCalledWith("get_agent_retrieval_tuning_status", { agentId: "agent-1" });
  });
});
