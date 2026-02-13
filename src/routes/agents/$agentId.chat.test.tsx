import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import React from "react";
import { createTestQueryClient } from "@/test/utils";

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

vi.mock("@/hooks/useConversations", () => ({
  useConversations: () => ({ data: [], isLoading: false }),
  useCreateConversation: () => ({ mutateAsync: vi.fn() }),
  useMessages: () => ({ data: [], isLoading: false }),
  useSendMessage: () => ({ isPending: false }),
  useSendMessageStreaming: () => ({
    isStreaming: false,
    streamingContent: "",
    error: null,
    sendMessage: vi.fn(),
    clearError: vi.fn(),
  }),
  useGenerateConversationTitle: () => ({ mutate: vi.fn() }),
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
  });
});
