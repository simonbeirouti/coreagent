import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { createTestQueryClient } from "@/test/utils";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(async () => vi.fn()),
  sendMessageStreaming: vi.fn(),
  clearStreamingError: vi.fn(),
  createConversation: vi.fn(async () => ({ id: "conversation-1" })),
  generateConversationTitle: vi.fn(),
  messagesData: [] as Array<Record<string, unknown>>,
  scrollIntoView: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: mocks.listen,
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () =>
    (config: { component: React.ComponentType }) => ({
      component: config.component,
      useParams: () => ({ agentId: "agent-1" }),
      useSearch: () => ({ conversationId: undefined }),
      useNavigate: () => vi.fn(),
    }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ user: { id: "user-1" } }),
}));

vi.mock("@/hooks/useAgents", () => ({
  useAgent: () => ({ data: { id: "agent-1", name: "Test Agent" }, isLoading: false }),
}));

vi.mock("@/hooks/useAbilities", () => ({
  useAgentToolSettings: () => ({
    data: [
      {
        implementation_key: "coreagent.py.deep_analysis",
        ability_name: "Deep Analysis",
        description: "Run deep analysis",
        enabled: true,
        parameters_schema: {
          type: "object",
          properties: {
            text: { type: "string" },
          },
          required: ["text"],
          additionalProperties: true,
        },
      },
    ],
  }),
  useAgentRegistrySkills: () => ({
    data: [
      {
        skillId: "skill.deep.analysis",
        implementationKey: "coreagent.py.deep_analysis",
        name: "Deep Analysis",
        enabled: true,
      },
    ],
  }),
}));

vi.mock("@/hooks/useRegistrySkills", () => ({
  useInstalledSkills: () => ({
    data: [
      {
        skillId: "skill.deep.analysis",
        implementationKey: "coreagent.py.deep_analysis",
        name: "Deep Analysis",
        installState: "ready",
      },
      {
        skillId: "skill.weather.lookup",
        implementationKey: "coreagent.py.weather_lookup",
        name: "Weather Lookup",
        installState: "installed",
      },
    ],
  }),
}));

vi.mock("@/hooks/usePerception", () => ({
  useVision: () => ({
    captureScreen: { mutateAsync: vi.fn() },
  }),
}));

vi.mock("@/hooks/useConversations", () => ({
  useConversations: () => ({ data: [], isLoading: false }),
  useCreateConversation: () => ({ mutateAsync: mocks.createConversation }),
  useMessages: () => ({ data: mocks.messagesData, isLoading: false }),
  useSendMessage: () => ({ isPending: false }),
  useSendMessageStreaming: () => ({
    isStreaming: false,
    streamingContent: "",
    error: null,
    sendMessage: mocks.sendMessageStreaming,
    clearError: mocks.clearStreamingError,
  }),
  useGenerateConversationTitle: () => ({ mutate: mocks.generateConversationTitle }),
  useDeleteConversation: () => ({ mutateAsync: vi.fn() }),
  useDeleteMessage: () => ({ mutateAsync: vi.fn() }),
  useEditMessageStreaming: () => ({
    isStreaming: false,
    streamingContent: "",
    editMessage: vi.fn(),
  }),
}));

vi.mock("@/hooks/useFeedback", () => ({
  useConversationDimensionFeedback: () => ({ data: {} }),
}));

import { Route } from "./$agentId.chat";

describe("chat route runtime", () => {
  beforeEach(() => {
    mocks.invoke.mockReset();
    mocks.listen.mockClear();
    mocks.sendMessageStreaming.mockReset();
    mocks.clearStreamingError.mockReset();
    mocks.createConversation.mockClear();
    mocks.generateConversationTitle.mockReset();
    mocks.messagesData = [];
    mocks.scrollIntoView.mockReset();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: mocks.scrollIntoView,
    });
  });

  it("renders empty state and opens composer from New Conversation", () => {
    const ChatComponent = (Route as unknown as { component: React.ComponentType }).component;
    const queryClient = createTestQueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <ChatComponent />
      </QueryClientProvider>
    );

    const newConversationButton = screen.getByRole("button", { name: "New Conversation" });
    expect(newConversationButton).toBeInTheDocument();
    expect(screen.getByText("No conversations yet")).toBeInTheDocument();
    expect(screen.getByText("Start a conversation")).toBeInTheDocument();
    expect(screen.getByText("Send a message to chat with Test Agent")).toBeInTheDocument();

    fireEvent.click(newConversationButton);
    const composerInput = screen.getByPlaceholderText("Message Test Agent...");
    expect(composerInput).toBeInTheDocument();
    expect(screen.getByText("0/32000")).toBeInTheDocument();

    fireEvent.change(composerInput, { target: { value: "hello" } });
    expect(screen.getByText("5/32000")).toBeInTheDocument();

    fireEvent.change(composerInput, { target: { value: "/" } });
    expect(screen.getByText("/screenshot")).toBeInTheDocument();
    expect(screen.getByText("/coreagent.py.deep_analysis")).toBeInTheDocument();
    expect(screen.getByText("/coreagent.py.weather_lookup")).toBeInTheDocument();
    expect(screen.getAllByText("/coreagent.py.deep_analysis")).toHaveLength(1);

    fireEvent.click(
      screen.getByRole("button", {
        name: /\/coreagent\.py\.deep_analysis/i,
      })
    );
    expect((composerInput as HTMLInputElement).value).toBe("/coreagent.py.deep_analysis ");
  });

  it("adds runtime tool context for tool-intent prompts and lets the agent decide execution", async () => {
    const ChatComponent = (Route as unknown as { component: React.ComponentType }).component;
    const queryClient = createTestQueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <ChatComponent />
      </QueryClientProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: "New Conversation" }));
    const composerInput = screen.getByPlaceholderText("Message Test Agent...");

    fireEvent.change(composerInput, { target: { value: "run the deep analysis tool" } });
    fireEvent.keyPress(composerInput, { key: "Enter", code: "Enter", charCode: 13 });

    await waitFor(() => {
      expect(mocks.sendMessageStreaming).toHaveBeenCalledTimes(1);
    });

    const payload = mocks.sendMessageStreaming.mock.calls[0]?.[0] as
      | { content?: string }
      | undefined;
    expect(payload?.content).toContain("[RuntimeToolContext]");
    expect(payload?.content).toContain("deep analysis: Run deep analysis");
    expect(payload?.content).toContain("run the deep analysis tool");
    expect(mocks.invoke).not.toHaveBeenCalledWith(
      "run_agent_runtime_tool",
      expect.anything()
    );
  });

  it("does not add runtime tool context for normal prompts", async () => {
    const ChatComponent = (Route as unknown as { component: React.ComponentType }).component;
    const queryClient = createTestQueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <ChatComponent />
      </QueryClientProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: "New Conversation" }));
    const composerInput = screen.getByPlaceholderText("Message Test Agent...");

    fireEvent.change(composerInput, { target: { value: "hello there" } });
    fireEvent.keyPress(composerInput, { key: "Enter", code: "Enter", charCode: 13 });

    await waitFor(() => {
      expect(mocks.sendMessageStreaming).toHaveBeenCalledTimes(1);
    });

    const payload = mocks.sendMessageStreaming.mock.calls[0]?.[0] as
      | { content?: string }
      | undefined;
    expect(payload?.content).toBe("hello there");
  });

  it("adds runtime tool context for explicit tool-selection prompts", async () => {
    const ChatComponent = (Route as unknown as { component: React.ComponentType }).component;
    const queryClient = createTestQueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <ChatComponent />
      </QueryClientProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: "New Conversation" }));
    const composerInput = screen.getByPlaceholderText("Message Test Agent...");

    fireEvent.change(composerInput, { target: { value: "choose the best tool for this task" } });
    fireEvent.keyPress(composerInput, { key: "Enter", code: "Enter", charCode: 13 });

    await waitFor(() => {
      expect(mocks.sendMessageStreaming).toHaveBeenCalledTimes(1);
    });

    const payload = mocks.sendMessageStreaming.mock.calls[0]?.[0] as
      | { content?: string }
      | undefined;
    expect(payload?.content).toContain("[RuntimeToolContext]");
  });

  it("does not add runtime tool context for generic action prompts without tool intent", async () => {
    const ChatComponent = (Route as unknown as { component: React.ComponentType }).component;
    const queryClient = createTestQueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <ChatComponent />
      </QueryClientProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: "New Conversation" }));
    const composerInput = screen.getByPlaceholderText("Message Test Agent...");

    fireEvent.change(composerInput, { target: { value: "run a quick summary of this" } });
    fireEvent.keyPress(composerInput, { key: "Enter", code: "Enter", charCode: 13 });

    await waitFor(() => {
      expect(mocks.sendMessageStreaming).toHaveBeenCalledTimes(1);
    });

    const payload = mocks.sendMessageStreaming.mock.calls[0]?.[0] as
      | { content?: string }
      | undefined;
    expect(payload?.content).not.toContain("[RuntimeToolContext]");
  });

  it("retries once without runtime tool context on tool-call loop errors", async () => {
    mocks.sendMessageStreaming
      .mockRejectedValueOnce(
        new Error("Tool-call loop exceeded maximum iterations without terminal assistant response.")
      )
      .mockResolvedValueOnce(undefined);

    const ChatComponent = (Route as unknown as { component: React.ComponentType }).component;
    const queryClient = createTestQueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <ChatComponent />
      </QueryClientProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: "New Conversation" }));
    const composerInput = screen.getByPlaceholderText("Message Test Agent...");

    fireEvent.change(composerInput, { target: { value: "run the deep analysis tool" } });
    fireEvent.keyPress(composerInput, { key: "Enter", code: "Enter", charCode: 13 });

    await waitFor(() => {
      expect(mocks.sendMessageStreaming).toHaveBeenCalledTimes(2);
    });

    const firstPayload = mocks.sendMessageStreaming.mock.calls[0]?.[0] as
      | { content?: string }
      | undefined;
    const secondPayload = mocks.sendMessageStreaming.mock.calls[1]?.[0] as
      | { content?: string }
      | undefined;

    expect(firstPayload?.content).toContain("[RuntimeToolContext]");
    expect(secondPayload?.content).toBe("run the deep analysis tool");
  });

  it("renders direct tool execution inside chat and then asks AI for follow-up", async () => {
    mocks.invoke.mockResolvedValueOnce({
      implementationKey: "coreagent.py.deep_analysis",
      skillId: "skill.deep.analysis",
      version: "1.0.0",
      executionMode: "local_docker",
      runId: "run-123",
      status: "failed",
      output: {},
      error: { message: "Container exited with status 1" },
      logMessages: [
        "runtime run job received",
        "runtime run job received",
        "runtime run job failed",
      ],
    });

    const ChatComponent = (Route as unknown as { component: React.ComponentType }).component;
    const queryClient = createTestQueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <ChatComponent />
      </QueryClientProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: "New Conversation" }));
    const composerInput = screen.getByPlaceholderText("Message Test Agent...");
    fireEvent.change(composerInput, { target: { value: "/coreagent.py.deep_analysis {}" } });
    fireEvent.keyPress(composerInput, { key: "Enter", code: "Enter", charCode: 13 });

    await waitFor(() => {
      expect(screen.getByText(/deep analysis/i)).toBeInTheDocument();
      expect(screen.getByText(/run completed with status failed/i)).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(mocks.sendMessageStreaming).toHaveBeenCalledTimes(1);
    });

    const payload = mocks.sendMessageStreaming.mock.calls[0]?.[0] as
      | { content?: string }
      | undefined;
    expect(payload?.content).toContain("A direct runtime tool run has completed.");
    expect(payload?.content).toContain("Tool: coreagent.py.deep_analysis");
    expect(payload?.content).toContain("Status: failed");
  });

  it("maps raw slash-command text into schema-aware tool input envelope", async () => {
    mocks.invoke.mockResolvedValueOnce({
      implementationKey: "coreagent.py.deep_analysis",
      skillId: "skill.deep.analysis",
      version: "1.0.0",
      executionMode: "local_docker",
      runId: "run-123",
      status: "succeeded",
      output: {},
      error: null,
      logMessages: [],
    });

    const ChatComponent = (Route as unknown as { component: React.ComponentType }).component;
    const queryClient = createTestQueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <ChatComponent />
      </QueryClientProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: "New Conversation" }));
    const composerInput = screen.getByPlaceholderText("Message Test Agent...");
    fireEvent.change(composerInput, { target: { value: "/coreagent.py.deep_analysis analyze this csv" } });
    fireEvent.keyPress(composerInput, { key: "Enter", code: "Enter", charCode: 13 });

    await waitFor(() => {
      expect(mocks.invoke).toHaveBeenCalledWith(
        "run_agent_runtime_tool",
        expect.objectContaining({
          implementationKey: "coreagent.py.deep_analysis",
          input: expect.objectContaining({
            text: "analyze this csv",
            query: "analyze this csv",
            input: "analyze this csv",
          }),
        })
      );
    });
  });

  it("keeps direct tool timeline ordered by progress sequence", async () => {
    let progressHandler:
      | ((event: { payload: Record<string, unknown> }) => void)
      | null = null;
    (mocks.listen as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(async (...args: unknown[]) => {
      progressHandler = args[1] as (event: { payload: Record<string, unknown> }) => void;
      return vi.fn();
    });
    const randomUuidSpy = vi
      .spyOn(globalThis.crypto, "randomUUID")
      .mockReturnValue("11111111-1111-1111-1111-111111111111");
    mocks.invoke.mockImplementationOnce(async () => {
      progressHandler?.({
        payload: {
          clientRunId: "11111111-1111-1111-1111-111111111111",
          implementationKey: "coreagent.py.deep_analysis",
          runId: "run-123",
          status: "running",
          message: "step two",
          sequence: 2,
          timestampMs: 2000,
        },
      });
      progressHandler?.({
        payload: {
          clientRunId: "11111111-1111-1111-1111-111111111111",
          implementationKey: "coreagent.py.deep_analysis",
          runId: "run-123",
          status: "running",
          message: "step one",
          sequence: 1,
          timestampMs: 1000,
        },
      });
      return {
        implementationKey: "coreagent.py.deep_analysis",
        skillId: "skill.deep.analysis",
        version: "1.0.0",
        executionMode: "local_docker",
        runId: "run-123",
        status: "succeeded",
        output: {},
        error: null,
        logMessages: ["step one", "step two"],
      };
    });

    const ChatComponent = (Route as unknown as { component: React.ComponentType }).component;
    const queryClient = createTestQueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <ChatComponent />
      </QueryClientProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: "New Conversation" }));
    const composerInput = screen.getByPlaceholderText("Message Test Agent...");
    fireEvent.change(composerInput, { target: { value: "/coreagent.py.deep_analysis {}" } });
    fireEvent.keyPress(composerInput, { key: "Enter", code: "Enter", charCode: 13 });

    await waitFor(() => {
      expect(screen.getByText(/run completed with status succeeded/i)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /deep analysis/i }));
    const stepOne = await screen.findByText("step one");
    const stepTwo = await screen.findByText("step two");
    expect(stepOne.compareDocumentPosition(stepTwo) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getAllByText("step one")).toHaveLength(1);
    expect(screen.getAllByText("step two")).toHaveLength(1);
    expect(mocks.scrollIntoView).toHaveBeenCalled();

    randomUuidSpy.mockRestore();
  });

  it("hides persisted direct tool context payload messages", async () => {
    mocks.messagesData = [
      {
        id: "m-user-1",
        role: "user",
        content:
          "[DirectToolResultContext]\nA direct runtime tool run has completed.\nTool: coreagent.py.pandas_summary\n[/DirectToolResultContext]",
        created_at: "2026-02-20T12:00:00.000Z",
        parent_id: null,
      },
      {
        id: "m-assistant-1",
        role: "assistant",
        content: "Tool execution completed successfully.",
        created_at: "2026-02-20T12:00:01.000Z",
        parent_id: "m-user-1",
      },
    ];

    const ChatComponent = (Route as unknown as { component: React.ComponentType }).component;
    const queryClient = createTestQueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <ChatComponent />
      </QueryClientProvider>
    );

    expect(screen.queryByText(/A direct runtime tool run has completed\./i)).not.toBeInTheDocument();
    expect(screen.getByText("Tool execution completed successfully.")).toBeInTheDocument();
    expect(screen.getByText("pandas summary")).toBeInTheDocument();
  });
});
