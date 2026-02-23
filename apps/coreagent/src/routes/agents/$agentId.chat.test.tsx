import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { createTestQueryClient } from "@/test/utils";
import { toast } from "sonner";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(async () => vi.fn()),
  sendMessageStreaming: vi.fn(),
  clearStreamingError: vi.fn(),
  createConversation: vi.fn(async () => ({ id: "conversation-1" })),
  generateConversationTitle: vi.fn(),
  messagesData: [] as Array<Record<string, unknown>>,
  recentFilesData: [] as Array<Record<string, unknown>>,
  scrollIntoView: vi.fn(),
  attachClickCount: 0,
  forcePendingAttach: false,
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
      {
        implementation_key: "attachment_read",
        ability_name: "Attachment Read",
        description: "Read attached files in chat",
        enabled: true,
        parameters_schema: {
          type: "object",
          properties: {},
          required: [],
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

vi.mock("@/hooks/useUserFiles", () => ({
  useRecentUserFiles: () => ({ data: mocks.recentFilesData }),
  useUploadUserFile: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useUserFiles: () => ({ data: [], isLoading: false }),
}));

vi.mock("@/components/perception/attach-button", () => ({
  AttachButton: ({ onAttach }: { onAttach: (file: Record<string, unknown>) => void }) => (
    <button
      type="button"
      onClick={() => {
        mocks.attachClickCount += 1;
        const suffix = String(mocks.attachClickCount);
        if (mocks.forcePendingAttach) {
          onAttach({
            id: `temp-${suffix}`,
            user_id: "user-1",
            storage_path: `pending/manual-${suffix}.txt`,
            file_name: `manual-${suffix}.txt`,
            file_ext: "txt",
            mime_type: "text/plain",
            size_bytes: 14,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          });
          return;
        }
        onAttach({
          id: `file-${suffix}`,
          user_id: "user-1",
          storage_path: `user-1/manual-${suffix}.txt`,
          file_name: `manual-${suffix}.txt`,
          file_ext: "txt",
          mime_type: "text/plain",
          size_bytes: 14,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
      }}
    >
      Mock Attach
    </button>
  ),
}));

vi.mock("@/hooks/useConversations", () => ({
  useConversations: () => ({ data: [], isLoading: false }),
  useCreateConversation: () => ({ mutateAsync: mocks.createConversation }),
  useMessages: () => ({ data: mocks.messagesData, isLoading: false }),
  useSendMessage: () => ({ isPending: false }),
  useSendMessageStreaming: () => ({
    isStreaming: false,
    streamingContent: "",
    streamingConversationId: null,
    inferredToolProgress: [],
    toolAcceptanceMessage: null,
    toolAcceptanceTimestampMs: null,
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
    mocks.invoke.mockResolvedValue(undefined);
    mocks.listen.mockClear();
    mocks.sendMessageStreaming.mockReset();
    mocks.clearStreamingError.mockReset();
    mocks.createConversation.mockClear();
    mocks.generateConversationTitle.mockReset();
    mocks.messagesData = [];
    mocks.recentFilesData = [];
    mocks.attachClickCount = 0;
    mocks.forcePendingAttach = false;
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
    expect((composerInput as HTMLInputElement).value).toBe("/");
    expect(screen.queryByText("/screenshot")).not.toBeInTheDocument();
  });

  it("attaches selected file marker from attach button flow", async () => {
    const ChatComponent = (Route as unknown as { component: React.ComponentType }).component;
    const queryClient = createTestQueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <ChatComponent />
      </QueryClientProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: "New Conversation" }));
    fireEvent.click(screen.getByRole("button", { name: "Mock Attach" }));
    fireEvent.change(screen.getByPlaceholderText("Message Test Agent..."), {
      target: { value: "use this file" },
    });
    fireEvent.keyPress(screen.getByPlaceholderText("Message Test Agent..."), {
      key: "Enter",
      code: "Enter",
      charCode: 13,
    });

    await waitFor(() => {
      expect(mocks.sendMessageStreaming).toHaveBeenCalledTimes(1);
    });
    const payload = mocks.sendMessageStreaming.mock.calls[0]?.[0] as
      | { content?: string }
      | undefined;
    expect(payload?.content).toContain("[File:path:user-1/manual-1.txt|name:manual-1.txt|type:txt]");
    expect(payload?.content).toContain("use this file");
  });

  it("includes multiple attached files in a single message", async () => {
    const ChatComponent = (Route as unknown as { component: React.ComponentType }).component;
    const queryClient = createTestQueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <ChatComponent />
      </QueryClientProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: "New Conversation" }));
    fireEvent.click(screen.getByRole("button", { name: "Mock Attach" }));
    fireEvent.click(screen.getByRole("button", { name: "Mock Attach" }));
    fireEvent.change(screen.getByPlaceholderText("Message Test Agent..."), {
      target: { value: "use these files" },
    });
    fireEvent.keyPress(screen.getByPlaceholderText("Message Test Agent..."), {
      key: "Enter",
      code: "Enter",
      charCode: 13,
    });

    await waitFor(() => {
      expect(mocks.sendMessageStreaming).toHaveBeenCalledTimes(1);
    });

    const payload = mocks.sendMessageStreaming.mock.calls[0]?.[0] as
      | { content?: string }
      | undefined;
    expect(payload?.content).toContain("[File:path:user-1/manual-1.txt|name:manual-1.txt|type:txt]");
    expect(payload?.content).toContain("[File:path:user-1/manual-2.txt|name:manual-2.txt|type:txt]");
    expect(payload?.content).toContain("use these files");
  });

  it("caps pending attachments at 10 files per message", async () => {
    const ChatComponent = (Route as unknown as { component: React.ComponentType }).component;
    const queryClient = createTestQueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <ChatComponent />
      </QueryClientProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: "New Conversation" }));
    for (let i = 0; i < 11; i += 1) {
      fireEvent.click(screen.getByRole("button", { name: "Mock Attach" }));
    }
    fireEvent.change(screen.getByPlaceholderText("Message Test Agent..."), {
      target: { value: "include max files" },
    });
    fireEvent.keyPress(screen.getByPlaceholderText("Message Test Agent..."), {
      key: "Enter",
      code: "Enter",
      charCode: 13,
    });

    await waitFor(() => {
      expect(mocks.sendMessageStreaming).toHaveBeenCalledTimes(1);
    });

    const payload = mocks.sendMessageStreaming.mock.calls[0]?.[0] as
      | { content?: string }
      | undefined;
    const markerMatches = payload?.content?.match(/\[File:path:/g) ?? [];
    expect(markerMatches).toHaveLength(10);
    expect(payload?.content).not.toContain("[File:path:user-1/manual-11.txt|name:manual-11.txt|type:txt]");
  });

  it("does not include pending file markers in outgoing messages", async () => {
    mocks.forcePendingAttach = true;
    const ChatComponent = (Route as unknown as { component: React.ComponentType }).component;
    const queryClient = createTestQueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <ChatComponent />
      </QueryClientProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: "New Conversation" }));
    fireEvent.click(screen.getByRole("button", { name: "Mock Attach" }));
    fireEvent.change(screen.getByPlaceholderText("Message Test Agent..."), {
      target: { value: "summarize attached files" },
    });
    fireEvent.keyPress(screen.getByPlaceholderText("Message Test Agent..."), {
      key: "Enter",
      code: "Enter",
      charCode: 13,
    });

    await waitFor(() => {
      expect(mocks.sendMessageStreaming).toHaveBeenCalledTimes(1);
    });

    const payload = mocks.sendMessageStreaming.mock.calls[0]?.[0] as
      | { content?: string }
      | undefined;
    expect(payload?.content).not.toContain("[File:path:pending/");
    expect(toast.warning).toHaveBeenCalledWith(
      "File is still uploading. Please wait and attach it again once ready."
    );
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
