import { createFileRoute } from '@tanstack/react-router';
import { useAgent } from '@/hooks/useAgents';
import { useConversations, useCreateConversation, useMessages, useSendMessage, useSendMessageStreaming, useGenerateConversationTitle, useDeleteConversation } from '@/hooks/useConversations';
import { useAuth } from '@/hooks/use-auth';
import { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import { MessageSquare, Send, Plus, X, Image as ImageIcon, Loader2, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { MicrophoneButton } from '@/components/perception/microphone-button';
import { ScreenshotButton } from '@/components/perception/screenshot-button';
import { AttachButton } from '@/components/perception/attach-button';
import { getScreenshotSignedUrl } from '@/lib/storage';

// Maximum message length (matches backend validation)
const MAX_MESSAGE_LENGTH = 32000;

// Helper to extract storage path from message content (new format)
function extractStoragePath(content: string): string | null {
  const match = content.match(/\[Screenshot:path:([^\]]+)\]/);
  return match ? match[1] : null;
}

// Helper to extract legacy image URL from message content (old format - for backwards compatibility)
function extractLegacyImageUrl(content: string): string | null {
  const match = content.match(/\[Screenshot: (https?:\/\/[^\]]+)\]/);
  return match ? match[1] : null;
}

// Helper to get text content without the screenshot/image markers (handles both formats)
function getTextContent(content: string): string {
  return content
    .replace(/\[Screenshot:path:[^\]]+\]\n?/g, '') // New path format
    .replace(/\[Screenshot: https?:\/\/[^\]]+\]\n?/g, '') // Legacy URL format
    .replace(/\[Image Description: [\s\S]*?\]\n?/g, '') // Image description (for AI, not display)
    .trim();
}

// Cache for signed URLs to avoid regenerating on every render
const signedUrlCache = new Map<string, { url: string; expiresAt: number }>();

// Component that resolves storage paths to signed URLs
function MessageImage({ content }: { content: string }) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(false);

  const storagePath = extractStoragePath(content);
  const legacyUrl = extractLegacyImageUrl(content);

  useEffect(() => {
    let cancelled = false;

    async function resolveUrl() {
      // Legacy format: use URL directly (may not work for private buckets)
      if (legacyUrl) {
        setImageUrl(legacyUrl);
        setIsLoading(false);
        return;
      }

      // New path format: get signed URL
      if (storagePath) {
        // Remove "screenshots/" prefix if present since getScreenshotSignedUrl expects just the path
        const pathWithoutBucket = storagePath.replace(/^screenshots\//, '');
        
        // Check cache first
        const cached = signedUrlCache.get(pathWithoutBucket);
        const now = Date.now();
        
        if (cached && cached.expiresAt > now + 60000) { // Still valid for at least 1 minute
          setImageUrl(cached.url);
          setIsLoading(false);
          return;
        }

        try {
          // Generate new signed URL (1 hour expiry)
          const signedUrl = await getScreenshotSignedUrl(pathWithoutBucket, 3600);
          
          if (cancelled) return;
          
          if (signedUrl) {
            // Cache with 50 minute expiry (leave buffer before actual 1 hour expiry)
            signedUrlCache.set(pathWithoutBucket, {
              url: signedUrl,
              expiresAt: now + 50 * 60 * 1000,
            });
            setImageUrl(signedUrl);
          } else {
            setError(true);
          }
        } catch (err) {
          console.error('Failed to get signed URL:', err);
          if (!cancelled) setError(true);
        }
      }

      if (!cancelled) setIsLoading(false);
    }

    resolveUrl();
    return () => { cancelled = true; };
  }, [storagePath, legacyUrl]);

  if (!storagePath && !legacyUrl) {
    return null;
  }

  if (isLoading) {
    return (
      <div className="mb-2 flex items-center justify-center h-32 bg-muted rounded-md">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !imageUrl) {
    return (
      <div className="mb-2 flex items-center justify-center h-32 bg-muted rounded-md text-muted-foreground text-sm">
        <ImageIcon className="h-4 w-4 mr-2" />
        Image unavailable
      </div>
    );
  }

  return (
    <div className="mb-2">
      <img
        src={imageUrl}
        alt="Screenshot"
        className="max-w-full rounded-md border cursor-pointer hover:opacity-90 transition-opacity"
        onClick={() => window.open(imageUrl, '_blank')}
        onError={() => setError(true)}
      />
    </div>
  );
}

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
  const sendMessageStreaming = useSendMessageStreaming();
  const generateConversationTitle = useGenerateConversationTitle();
  const deleteConversation = useDeleteConversation();

  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [isComposingNewConversation, setIsComposingNewConversation] = useState(false);
  const [messageInput, setMessageInput] = useState('');
  const [pendingScreenshot, setPendingScreenshot] = useState<{
    base64: string;
    storagePath?: string; // Path in Supabase storage
    signedUrl?: string; // Temporary signed URL for immediate display
  } | null>(null);
  const [isTranscribing, setIsTranscribing] = useState(false);

  const { data: messages, isLoading: messagesLoading } = useMessages(activeConversationId || '');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const prevMessagesCountRef = useRef<number>(0);

  // Reset local state when switching agents
  useEffect(() => {
    setActiveConversationId(null);
    setIsComposingNewConversation(false);
    setMessageInput('');
  }, [agentId]);

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

  // Auto-scroll when streaming content updates
  useEffect(() => {
    if (sendMessageStreaming.isStreaming && sendMessageStreaming.streamingContent) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [sendMessageStreaming.streamingContent, sendMessageStreaming.isStreaming]);


  const handleStartNewConversation = () => {
    // If we already have an active conversation or are composing, do nothing
    if (activeConversationId || isComposingNewConversation) return;

    // Just enable composing mode - don't create conversation yet
    setIsComposingNewConversation(true);
  };

  const handleSendMessage = async () => {
    if (!messageInput.trim() && !pendingScreenshot) return;

    let finalContent = messageInput.trim();
    
    // Store the image base64 before clearing pendingScreenshot
    const imageBase64 = pendingScreenshot?.base64;
    
    // Add screenshot to message if pending (already uploaded)
    if (pendingScreenshot) {
      if (pendingScreenshot.storagePath) {
        // Include the image path for display in the conversation
        // The actual image data will be passed separately for AI processing
        finalContent = `[Screenshot:path:${pendingScreenshot.storagePath}]\n${messageInput}`;
      } else {
        // Fallback: screenshot wasn't uploaded (user not authenticated?)
        console.warn('Screenshot was captured but not uploaded to storage');
      }
    }
    
    if (!finalContent.trim()) return;
    
    // Clear input immediately when sending (before waiting for AI response)
    setMessageInput('');
    setPendingScreenshot(null);
    
    if (!activeConversationId) {
      // Create a new conversation if none exists
      try {
        const newConversation = await createConversation.mutateAsync({
          agent_id: agentId,
          user_id: userId,
          title: `Chat with ${agent?.name || 'Agent'}`,
        });
        setActiveConversationId(newConversation.id);
        setIsComposingNewConversation(false); // Exit composing mode now that we have a real conversation

        // Send the message to the new conversation with streaming
        await sendMessageStreaming.sendMessage({
          conversation_id: newConversation.id,
          content: finalContent,
          image_base64: imageBase64,
        });

        // Generate a proper title based on the first message (background operation)
        generateConversationTitle.mutate({
          conversationId: newConversation.id,
          firstMessage: finalContent,
        });
      } catch (error) {
        toast.error(sendMessageStreaming.error || 'Failed to send message');
        console.error('Send message error:', error);
        // Reset composing state on error so user can try again
        setIsComposingNewConversation(false);
        sendMessageStreaming.clearError();
      }
    } else {
      try {
        await sendMessageStreaming.sendMessage({
          conversation_id: activeConversationId,
          content: finalContent,
          image_base64: imageBase64,
        });
      } catch (error) {
        toast.error(sendMessageStreaming.error || 'Failed to send message');
        console.error('Send message error:', error);
        sendMessageStreaming.clearError();
      }
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handleTranscription = (text: string, options?: { streaming?: boolean; isTranscribing?: boolean }) => {
    // Update transcribing state for loading indicator
    setIsTranscribing(options?.isTranscribing ?? false);
    
    if (options?.streaming) {
      // For streaming updates, replace the entire input with the current transcript
      setMessageInput(text);
    } else {
      // For final/appended transcription, add to existing input
      setMessageInput(prev => prev + (prev ? ' ' : '') + text);
      toast.success('Transcription added to message');
    }
  };

  const handleScreenshot = (imageBase64: string, storagePath?: string, signedUrl?: string) => {
    // Store the screenshot with its storage path and temporary signed URL
    setPendingScreenshot({ base64: imageBase64, storagePath, signedUrl });

    if (storagePath) {
      toast.success('Screenshot ready - send your message to include it');
    } else {
      toast.warning('Screenshot captured but not saved to storage');
    }
  };

  const clearPendingScreenshot = () => {
    setPendingScreenshot(null);
  };

  const handleDeleteConversation = async (conversationId: string) => {
    try {
      await deleteConversation.mutateAsync({ conversationId, agentId });
      
      // If we deleted the active conversation, clear it
      if (activeConversationId === conversationId) {
        setActiveConversationId(null);
        setIsComposingNewConversation(false);
      }
      
      toast.success('Conversation deleted');
    } catch (error) {
      toast.error('Failed to delete conversation');
      console.error('Delete conversation error:', error);
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
            disabled={activeConversationId !== null || isComposingNewConversation}
            className="cursor-pointer w-full"
            variant="outline"
          >
            <Plus className="mr-2 h-4 w-4" />
            New Conversation
          </Button>
        </div>
        <div className="p-2 flex flex-col flex-1 min-h-0">
          <ScrollArea className="flex-1">
            <div className="space-y-1">
              {conversations && conversations.length > 0 ? (
                conversations.map((conv) => (
                  <div key={conv.id} className="w-60 group relative">
                    <button
                      onClick={() => {
                        setActiveConversationId(conv.id);
                        setIsComposingNewConversation(false); // Exit composing mode when selecting existing conversation
                      }}
                      className={cn(
                        "cursor-pointer w-full text-left px-3 py-2 rounded-md text-sm transition-colors pr-8",
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
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="cursor-pointer absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start" className="w-32" side="right">
                        <DropdownMenuItem
                          onClick={() => {
                            // TODO: Implement edit functionality
                            toast.info('Edit coming soon');
                          }}
                        >
                          <Pencil className="h-4 w-4" />
                          Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          variant="destructive"
                          onClick={() => handleDeleteConversation(conv.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                ))
              ) : (
                <div className="text-sm text-muted-foreground px-3 py-2">
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
          ) : ((messages && messages.length > 0) || sendMessageStreaming.isStreaming) ? (
            <ScrollArea className="h-full">
              <div className="space-y-4 px-4 pt-4">
                {messages && messages.map((message) => (
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
                        {/* Render screenshot if present (handles both new path format and legacy URL format) */}
                        <MessageImage content={message.content} />
                        {/* Render text content */}
                        {getTextContent(message.content) && (
                          <div className="text-sm whitespace-pre-wrap">
                            {getTextContent(message.content)}
                          </div>
                        )}
                        <div className="text-xs opacity-70 mt-2">
                          {new Date(message.created_at).toLocaleTimeString()}
                        </div>
                      </CardContent>
                    </Card>
                  </div>
                ))}
                {/* Streaming message display */}
                {sendMessageStreaming.isStreaming && (
                  <div className="flex justify-start">
                    <Card className="max-w-[80%] p-0 bg-muted">
                      <CardContent className="p-3">
                        {sendMessageStreaming.streamingContent ? (
                          <div className="text-sm whitespace-pre-wrap">
                            {sendMessageStreaming.streamingContent}
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <Loader2 className="h-3 w-3 animate-spin" />
                            <span className="text-xs opacity-70">AI is thinking...</span>
                          </div>
                        )}
                        {sendMessageStreaming.streamingContent && (
                          <div className="flex items-center gap-2 mt-2">
                            <Loader2 className="h-3 w-3 animate-spin" />
                            <span className="text-xs opacity-70">AI is typing...</span>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  </div>
                )}
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

        {/* Message Input - Show when we have an active conversation or are composing a new one */}
        {(activeConversationId || isComposingNewConversation) && (
          <div className="border-t p-4 shrink-0 bg-background">
            {/* Pending Screenshot Preview */}
            {pendingScreenshot && (
              <div className="mx-auto mb-3 flex items-center gap-2 p-2 bg-muted rounded-md">
                <div className="relative">
                  <img 
                    src={`data:image/png;base64,${pendingScreenshot.base64}`}
                    alt="Pending screenshot"
                    className="h-16 w-auto rounded border"
                  />
                  <Button
                    size="icon"
                    variant="destructive"
                    className="absolute -top-2 -right-2 h-5 w-5"
                    onClick={clearPendingScreenshot}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
                <div className="flex items-center gap-1 text-sm text-muted-foreground">
                  <ImageIcon className="h-4 w-4" />
                  <span>Screenshot attached</span>
                </div>
              </div>
            )}

            {/* Message Input Row */}
            <div className="mx-auto flex gap-2">
              <MicrophoneButton
                agentId={agentId}
                userId={userId}
                onTranscription={handleTranscription}
                disabled={sendMessage.isPending}
                conversationId={activeConversationId || undefined}
              />
              <ScreenshotButton
                agentId={agentId}
                conversationId={activeConversationId || undefined}
                onScreenshot={handleScreenshot}
                disabled={sendMessage.isPending}
              />
              <AttachButton
                onAttach={handleScreenshot}
                disabled={sendMessage.isPending}
              />
              <div className="relative flex-1">
                {isTranscribing && (
                  <div className="absolute left-3 top-1/2 -translate-y-1/2 z-10">
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  </div>
                )}
                <div className="relative">
                  <Input
                    value={messageInput}
                    onChange={(e) => {
                      const value = e.target.value;
                      if (value.length <= MAX_MESSAGE_LENGTH) {
                        setMessageInput(value);
                      }
                    }}
                    onKeyPress={handleKeyPress}
                    placeholder={isTranscribing ? 'Transcribing...' : `Message ${agent.name}...`}
                    disabled={sendMessage.isPending || sendMessageStreaming.isStreaming}
                    className={cn("w-full pr-16", isTranscribing && "pl-9")}
                    maxLength={MAX_MESSAGE_LENGTH}
                  />
                  <div className={cn(
                    "absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground",
                    messageInput.length > MAX_MESSAGE_LENGTH * 0.9 && "text-amber-600",
                    messageInput.length > MAX_MESSAGE_LENGTH * 0.95 && "text-red-600"
                  )}>
                    {messageInput.length}/{MAX_MESSAGE_LENGTH}
                  </div>
                </div>
              </div>
              <Button
                onClick={handleSendMessage}
                disabled={(!messageInput.trim() && !pendingScreenshot) || sendMessage.isPending || sendMessageStreaming.isStreaming}
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
