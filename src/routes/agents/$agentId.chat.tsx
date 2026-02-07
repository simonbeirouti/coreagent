import { createFileRoute } from '@tanstack/react-router';
import { useAgent } from '@/hooks/useAgents';
import { useConversations, useCreateConversation, useMessages, useSendMessage } from '@/hooks/useConversations';
import { useAuth } from '@/hooks/use-auth';
import { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import { MessageSquare, Send, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

export const Route = createFileRoute('/agents/$agentId/chat')({
  component: AgentChatPage,
});

function AgentChatPage() {
  const { agentId } = Route.useParams();
  const { user } = useAuth();
  const userId = user?.id || '';
  
  const { data: agent, isLoading: agentLoading } = useAgent(agentId);
  const { data: conversations, isLoading: conversationsLoading } = useConversations(agentId);
  const createConversation = useCreateConversation();
  const sendMessage = useSendMessage();

  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [messageInput, setMessageInput] = useState('');

  const { data: messages, isLoading: messagesLoading } = useMessages(activeConversationId || '');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const prevMessagesCountRef = useRef<number>(0);

  // Reset message count when switching conversations
  useEffect(() => {
    prevMessagesCountRef.current = messages?.length || 0;
  }, [activeConversationId]);

  // Auto-scroll to bottom only when new messages are added
  useEffect(() => {
    const currentMessageCount = messages?.length || 0;
    const previousMessageCount = prevMessagesCountRef.current;

    // Only scroll if messages were genuinely added (count increased)
    if (currentMessageCount > previousMessageCount && previousMessageCount > 0) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }

    // Update the ref with current count
    prevMessagesCountRef.current = currentMessageCount;
  }, [messages]);

  // Auto-scroll to bottom when conversation loads or switches
  useEffect(() => {
    if (messages && messages.length > 0) {
      // Scroll immediately when loading a conversation or switching to one
      messagesEndRef.current?.scrollIntoView({ behavior: 'instant' });
    }
  }, [activeConversationId, messages]);


  const handleStartNewConversation = async () => {
    try {
      const newConversation = await createConversation.mutateAsync({
        agent_id: agentId,
        user_id: userId,
        title: `Chat with ${agent?.name || 'Agent'}`,
      });
      setActiveConversationId(newConversation.id);
      toast.success('New conversation started');
    } catch (error) {
      toast.error('Failed to start conversation');
      console.error('Create conversation error:', error);
    }
  };

  const handleSendMessage = async () => {
    if (!messageInput.trim()) return;
    
    if (!activeConversationId) {
      // Create a new conversation if none exists
      try {
        const newConversation = await createConversation.mutateAsync({
          agent_id: agentId,
          user_id: userId,
          title: `Chat with ${agent?.name || 'Agent'}`,
        });
        setActiveConversationId(newConversation.id);
        
        // Send the message to the new conversation
        await sendMessage.mutateAsync({
          conversation_id: newConversation.id,
          content: messageInput,
        });
        setMessageInput('');
      } catch (error) {
        toast.error('Failed to send message');
        console.error('Send message error:', error);
      }
    } else {
      try {
        await sendMessage.mutateAsync({
          conversation_id: activeConversationId,
          content: messageInput,
        });
        setMessageInput('');
      } catch (error) {
        toast.error('Failed to send message');
        console.error('Send message error:', error);
      }
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  if (agentLoading || conversationsLoading) {
    return (
      <div className="flex h-full overflow-hidden">
        {/* History Sidebar Skeleton */}
        <div className="w-64 border-r bg-background flex flex-col h-full">
          <div className="p-2 border-b shrink-0">
            <Skeleton className="h-10 w-full" />
          </div>
          <div className="p-2 flex flex-col flex-1 min-h-0">
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="px-3 py-2">
                  <Skeleton className="h-4 w-full mb-1" />
                  <Skeleton className="h-3 w-3/4" />
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Chat Area Skeleton */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          {/* Empty State Placeholder */}
          <div className="flex-1 overflow-hidden">
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
              <Skeleton className="h-12 w-12 mb-4" />
              <Skeleton className="h-4 w-40 mb-4" />
              <Skeleton className="h-3 w-60 mb-4" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!agent) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-destructive">Agent not found</div>
      </div>
    );
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* History Sidebar - Always visible */}
      <div className="w-64 border-r bg-background flex flex-col h-full">
        <div className="p-2 border-b shrink-0">
          <Button 
            onClick={handleStartNewConversation} 
            className="w-full"
            variant="outline"
          >
            <Plus className="mr-2 h-4 w-4" />
            New Conversation
          </Button>
        </div>
        <div className="p-2 flex flex-col flex-1 min-h-0">
          <ScrollArea className="flex-1">
            <div className="space-y-2">
              {conversations && conversations.length > 0 ? (
                conversations.map((conv) => (
                  <button
                    key={conv.id}
                    onClick={() => setActiveConversationId(conv.id)}
                    className={cn(
                      "w-full text-left px-3 py-2 rounded-md text-sm transition-colors",
                      activeConversationId === conv.id
                        ? "bg-accent text-accent-foreground"
                        : "hover:bg-accent/50"
                    )}
                  >
                    <div className="font-medium truncate">
                      {conv.title || 'Untitled'}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {new Date(conv.updated_at).toLocaleDateString()}
                    </div>
                  </button>
                ))
              ) : (
                <div className="text-sm text-muted-foreground">
                  No conversations yet
                </div>
              )}
            </div>
          </ScrollArea>
        </div>
      </div>

      {/* Chat Area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Messages */}
        <div className="flex-1 overflow-hidden">
          {activeConversationId && messagesLoading ? (
            /* Loading skeleton when messages are being fetched */
            <div className="space-y-4 pt-4 px-4">
              {Array.from({ length: 9 }).map((_, i) => (
                <div key={i} className={`flex ${i % 2 === 0 ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[80%] p-0`}>
                    <Skeleton className="h-16 w-64" />
                  </div>
                </div>
              ))}
            </div>
          ) : messages && messages.length > 0 ? (
            <ScrollArea className="h-full">
              <div className="space-y-4 px-4 pt-4">
                {messages.map((message) => (
                  <div
                    key={message.id}
                    className={cn(
                      "flex",
                      message.role === 'user' ? 'justify-end' : 'justify-start'
                    )}
                  >
                    <Card
                      className={cn(
                        "max-w-[80%] p-0",
                        message.role === 'user'
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-muted'
                      )}
                    >
                      <CardContent className="p-3">
                        <div className="text-sm whitespace-pre-wrap">
                          {message.content}
                        </div>
                        <div className="text-xs opacity-70 mt-2">
                          {new Date(message.created_at).toLocaleTimeString()}
                        </div>
                      </CardContent>
                    </Card>
                  </div>
                ))}
                <div ref={messagesEndRef} />
              </div>
            </ScrollArea>
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
              <MessageSquare className="h-12 w-12 mb-4 opacity-50" />
              <p className="text-lg font-medium">Start a conversation</p>
              <p className="text-sm">Send a message to chat with {agent.name}</p>
            </div>
          )}
        </div>

        {/* Message Input - Only show when we have an active conversation */}
        {activeConversationId && (
          <div className="border-t p-4 shrink-0 bg-background">
            <div className="mx-auto flex gap-2">
              <Input
                value={messageInput}
                onChange={(e) => setMessageInput(e.target.value)}
                onKeyPress={handleKeyPress}
                placeholder={`Message ${agent.name}...`}
                disabled={sendMessage.isPending}
                className="flex-1"
              />
              <Button
                onClick={handleSendMessage}
                disabled={!messageInput.trim() || sendMessage.isPending}
                size="icon"
              >
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
