import { QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { createTestQueryClient } from "@/test/utils";
import { conversationKeys, useSendMessageStreaming } from "./useConversations";
import type { Conversation, Message, StreamEvent } from "@/types";

const sendMessageStreamingMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  Channel: class<T> {
    onmessage?: (event: T) => void;
  },
}));

vi.mock("@/lib/tauri-store", () => ({
  getCachedData: vi.fn(() => undefined),
  getCachedDataUpdatedAt: vi.fn(() => undefined),
}));

vi.mock("@/lib/tauri-command-client", () => ({
  tauriCommandClient: {
    sendMessageStreaming: (...args: unknown[]) => sendMessageStreamingMock(...args),
  },
}));

describe("useSendMessageStreaming structured tool events", () => {
  it("suppresses [event:*] deltas and persists inferred tool progress", async () => {
    const queryClient = createTestQueryClient();
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: queryClient }, children);

    const conversation: Conversation = {
      id: "c-stream",
      agent_id: "agent-1",
      user_id: "u1",
      title: "Streaming",
      created_at: "2026-02-22T00:00:00.000Z",
      updated_at: "2026-02-22T00:00:00.000Z",
    };
    queryClient.setQueryData(conversationKeys.detail(conversation.id), conversation);
    queryClient.setQueryData<Message[]>(conversationKeys.messages(conversation.id), []);

    sendMessageStreamingMock.mockImplementationOnce(
      async (
        _request: { conversation_id: string; content: string },
        channel: { onmessage?: (event: StreamEvent) => void }
      ) => {
        channel.onmessage?.({ type: "Started" });
        channel.onmessage?.({
          type: "Delta",
          data: {
            content:
              "[event:tool_call_started][provider:openai][tool:coreagent_rs.screenshot] starting screenshot\nvisible output",
          },
        });
        channel.onmessage?.({
          type: "Delta",
          data: {
            content:
              "[event:tool_call_succeeded][provider:openai][tool:coreagent_rs.screenshot] screenshot saved",
          },
        });
        channel.onmessage?.({
          type: "Done",
          data: { full_content: "Screenshot captured." },
        });

        return {
          id: "assistant-1",
          conversation_id: "c-stream",
          role: "assistant",
          content: "Screenshot captured.",
          message_type: "text",
          metadata: {},
          created_at: "2026-02-22T00:00:01.000Z",
          parent_id: null,
        } satisfies Message;
      }
    );

    const { result } = renderHook(() => useSendMessageStreaming(), { wrapper });

    let response!: Message;
    await act(async () => {
      response = await result.current.sendMessage({
        conversation_id: conversation.id,
        content: "take a screenshot",
      });
    });

    await waitFor(() => {
      expect(result.current.isStreaming).toBe(false);
    });

    expect(result.current.streamingContent).toBe("");
    expect(result.current.inferredToolProgress).toHaveLength(2);
    expect(result.current.inferredToolProgress[0]?.implementationKey).toBe("screenshot");
    expect(result.current.inferredToolProgress[1]?.status).toBe("succeeded");
    expect(response.metadata?.inferred_tool_runs).toBeDefined();
    expect(response.metadata?.inferred_tool_runs).toHaveLength(1);
  });

  it("maps failure-style [event:*] tool lifecycle markers to failed progress status", async () => {
    const queryClient = createTestQueryClient();
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: queryClient }, children);

    const conversation: Conversation = {
      id: "c-stream-failed",
      agent_id: "agent-1",
      user_id: "u1",
      title: "Streaming failed",
      created_at: "2026-02-22T00:00:00.000Z",
      updated_at: "2026-02-22T00:00:00.000Z",
    };
    queryClient.setQueryData(conversationKeys.detail(conversation.id), conversation);
    queryClient.setQueryData<Message[]>(conversationKeys.messages(conversation.id), []);

    sendMessageStreamingMock.mockImplementationOnce(
      async (
        _request: { conversation_id: string; content: string },
        channel: { onmessage?: (event: StreamEvent) => void }
      ) => {
        channel.onmessage?.({ type: "Started" });
        channel.onmessage?.({
          type: "Delta",
          data: {
            content:
              "[event:tool_call_started][provider:openai][tool:coreagent_rs.screenshot] starting screenshot",
          },
        });
        channel.onmessage?.({
          type: "Delta",
          data: {
            content:
              "[event:tool_budget_exhausted][provider:openai][tool:coreagent_rs.screenshot] tool budget exhausted",
          },
        });
        channel.onmessage?.({
          type: "Done",
          data: { full_content: "Could not complete tool run due to budget limits." },
        });

        return {
          id: "assistant-2",
          conversation_id: "c-stream-failed",
          role: "assistant",
          content: "Could not complete tool run due to budget limits.",
          message_type: "text",
          metadata: {},
          created_at: "2026-02-22T00:00:02.000Z",
          parent_id: null,
        } satisfies Message;
      }
    );

    const { result } = renderHook(() => useSendMessageStreaming(), { wrapper });

    await act(async () => {
      await result.current.sendMessage({
        conversation_id: conversation.id,
        content: "please take a screenshot",
      });
    });

    await waitFor(() => {
      expect(result.current.isStreaming).toBe(false);
    });

    expect(result.current.inferredToolProgress).toHaveLength(2);
    expect(result.current.inferredToolProgress[0]?.status).toBe("running");
    expect(result.current.inferredToolProgress[1]?.status).toBe("failed");
    expect(result.current.inferredToolProgress[1]?.message).toContain("budget exhausted");
  });

  it("correlates mixed tool progress lines by call_id into one persisted run", async () => {
    const queryClient = createTestQueryClient();
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: queryClient }, children);

    const conversation: Conversation = {
      id: "c-stream-call-id",
      agent_id: "agent-1",
      user_id: "u1",
      title: "Streaming call id merge",
      created_at: "2026-02-22T00:00:00.000Z",
      updated_at: "2026-02-22T00:00:00.000Z",
    };
    queryClient.setQueryData(conversationKeys.detail(conversation.id), conversation);
    queryClient.setQueryData<Message[]>(conversationKeys.messages(conversation.id), []);

    sendMessageStreamingMock.mockImplementationOnce(
      async (
        _request: { conversation_id: string; content: string },
        channel: { onmessage?: (event: StreamEvent) => void }
      ) => {
        channel.onmessage?.({ type: "Started" });
        channel.onmessage?.({
          type: "Delta",
          data: {
            content:
              "[tool-chain] phase=tool_step_started step=1 tool=coreagent_py_attachment_read call_id=call_merge_1",
          },
        });
        channel.onmessage?.({
          type: "Delta",
          data: {
            content:
              "[event:tool_call_started][provider:openai][tool:coreagent_py_attachment_read] step=1 call_id=call_merge_1",
          },
        });
        channel.onmessage?.({
          type: "Delta",
          data: {
            content:
              "[tool:attachment_read] starting coreagent.py.attachment_read",
          },
        });
        channel.onmessage?.({
          type: "Delta",
          data: {
            content:
              "[event:tool_call_succeeded][provider:openai][tool:coreagent_py_attachment_read] step=1 call_id=call_merge_1 run_id=run_merge_1 status=succeeded",
          },
        });
        channel.onmessage?.({
          type: "Done",
          data: { full_content: "Attachment read completed." },
        });

        return {
          id: "assistant-call-id-1",
          conversation_id: "c-stream-call-id",
          role: "assistant",
          content: "Attachment read completed.",
          message_type: "text",
          metadata: {},
          created_at: "2026-02-22T00:00:03.000Z",
          parent_id: null,
        } satisfies Message;
      }
    );

    const { result } = renderHook(() => useSendMessageStreaming(), { wrapper });

    let response!: Message;
    await act(async () => {
      response = await result.current.sendMessage({
        conversation_id: conversation.id,
        content: "read the attachment",
      });
    });

    await waitFor(() => {
      expect(result.current.isStreaming).toBe(false);
    });

    const persistedRuns = response.metadata?.inferred_tool_runs as
      | Array<Record<string, unknown>>
      | undefined;
    expect(persistedRuns).toBeDefined();
    expect(persistedRuns).toHaveLength(1);
    expect(persistedRuns?.[0]?.implementationKey).toBe("attachment_read");
    expect(persistedRuns?.[0]?.runId).toBe("run_merge_1");
    expect(persistedRuns?.[0]?.status).toBe("succeeded");
  });
});
