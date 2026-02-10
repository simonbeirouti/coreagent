import { createFileRoute } from '@tanstack/react-router';
import { useAgent } from '@/hooks/useAgents';
import { useRealtimeVoiceChat } from '@/hooks/useRealtimeVoiceChat';
import { useBackgroundPerception } from '@/hooks/useBackgroundPerception';
import { useConversations, useCreateConversation, useCreateConversationInstant, useDeleteConversation, useGenerateConversationTitle } from '@/hooks/useConversations';
import { useAuth } from '@/hooks/use-auth';
import { AudioVisualizer } from '@/components/voice/audio-visualizer';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Phone, PhoneOff, Trash2, Plus, Mic, MoreHorizontal, Pencil, Eye, Camera } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useEffect, useRef, useState, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { invoke } from '@tauri-apps/api/core';

export const Route = createFileRoute('/agents/$agentId/voice')({
  validateSearch: (search: Record<string, unknown>) => ({
    conversationId:
      typeof search.conversationId === 'string' ? search.conversationId : undefined,
  }),
  component: AgentVoicePage,
});

function AgentVoicePage() {
  const { agentId } = Route.useParams();
  const { conversationId } = Route.useSearch();
  const navigate = Route.useNavigate();
  const { user } = useAuth();
  const userId = user?.id || '';
  const { data: agent, isLoading: agentLoading } = useAgent(agentId);
  const { data: conversations, isLoading: conversationsLoading } = useConversations(agentId);
  const { createInstant } = useCreateConversationInstant();
  const createConversation = useCreateConversation();
  const deleteConversation = useDeleteConversation();
  const generateConversationTitle = useGenerateConversationTitle();
  const transcriptEndRef = useRef<HTMLDivElement>(null);
  
  const [activeConversationId, setActiveConversationIdState] = useState<string | null>(
    conversationId ?? null
  );
  const setActiveConversationId = useCallback(
    (nextConversationId: string | null) => {
      setActiveConversationIdState(nextConversationId);
      navigate({
        to: '/agents/$agentId/voice',
        params: { agentId },
        search: (prev) => ({
          ...prev,
          conversationId: nextConversationId ?? undefined,
        }),
        replace: true,
      });
    },
    [agentId, navigate]
  );

  useEffect(() => {
    setActiveConversationIdState(conversationId ?? null);
  }, [conversationId]);

  const [isSaving, setIsSaving] = useState(false);
  const [screenAwarenessEnabled, setScreenAwarenessEnabled] = useState(false);

  // Filter to only show voice conversations
  const voiceConversations = conversations?.filter(c => c.title?.includes('Voice Chat')) || [];

  // Build agent instructions from identity
  // Include vision capability instructions when screen awareness is enabled
  const agentInstructions = agent
    ? `You are ${agent.name}. ${agent.persona || ''} ${agent.mission ? `Your mission: ${agent.mission}` : ''} ${agent.values ? `Your values: ${agent.values}` : ''} Be conversational and helpful.${screenAwarenessEnabled ? ' You can see the user\'s screen. When they share screenshots, describe what you see and help them with tasks visible on screen.' : ''}`
    : undefined;

  const {
    state,
    isConnected,
    error,
    transcript,
    currentUserText,
    currentAssistantText,
    inputAudioLevel,
    outputAudioLevel,
    connect,
    disconnect,
    clearTranscript,
    sendImage,
  } = useRealtimeVoiceChat({
    agentInstructions,
    // Use semantic VAD for better voice isolation in noisy environments
    vadMode: 'semantic_vad',
    vadEagerness: 'low', // Less likely to interrupt
    // Fallback server VAD settings (used if semantic_vad not available)
    silenceDurationMs: 1000,
    vadThreshold: 0.6, // Higher threshold for better noise rejection
  });

  // Background perception for screen awareness
  const {
    isRunning: isPerceptionRunning,
    screenshotCount,
    captureNow,
  } = useBackgroundPerception({
    enabled: screenAwarenessEnabled && isConnected,
    agentId,
    intervalMs: 15000, // Capture every 15 seconds when enabled
    compress: true,
    quality: 0.2, // 80% quality reduction for minimal bandwidth
    maxWidth: 1280,
    sendImage,
    onScreenshot: () => {
      // Optional: show subtle indicator when screenshot is taken
    },
  });

  // Auto-scroll transcript
  useEffect(() => {
    if (transcriptEndRef.current) {
      transcriptEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [transcript, currentUserText, currentAssistantText]);

  // Show error toast
  useEffect(() => {
    if (error) {
      toast.error(error);
    }
  }, [error]);

  // Reset state when switching agents
  useEffect(() => {
    setActiveConversationId(null);
    clearTranscript();
  }, [agentId, clearTranscript]);

  const handleStartNewVoiceChat = () => {
    // Create instantly - returns temp ID immediately
    const tempId = createInstant(
      {
        agent_id: agentId,
        user_id: userId,
        title: `Voice Chat with ${agent?.name || 'Agent'} - ${new Date().toLocaleDateString()}`,
      },
      (realId) => {
        // Update to real ID once backend confirms
        setActiveConversationId(realId);
      }
    );
    
    // Set active conversation immediately with temp ID
    setActiveConversationId(tempId);
    clearTranscript();
  };

  const handleDeleteConversation = async (conversationId: string) => {
    try {
      await deleteConversation.mutateAsync({ conversationId, agentId });
      
      // If we deleted the active conversation, clear it
      if (activeConversationId === conversationId) {
        setActiveConversationId(null);
      }
      
      toast.success('Conversation deleted');
    } catch (error) {
      toast.error('Failed to delete conversation');
      console.error('Delete conversation error:', error);
    }
  };

  const handleConnect = async () => {
    try {
      await connect('alloy');
      toast.success('Connected to voice chat');
    } catch (err) {
      toast.error('Failed to connect');
    }
  };

  const handleDisconnect = useCallback(async () => {
    // Capture transcript BEFORE disconnecting (to avoid closure issues)
    const transcriptToSave = [...transcript];
    const currentConversationId = activeConversationId;
    
    console.log('[VOICE] Disconnecting, transcript length:', transcriptToSave.length);
    console.log('[VOICE] Transcript entries:', transcriptToSave);
    
    // Disconnect immediately
    disconnect();
    
    // Automatically save transcript if there are entries
    if (transcriptToSave.length > 0) {
      setIsSaving(true);
      try {
        let conversationId = currentConversationId;
        
        // Check if we have a valid conversation ID (not null and not a temp ID)
        const needsNewConversation = !conversationId || conversationId.startsWith('temp-');
        
        console.log('[VOICE] Current conversationId:', conversationId, 'needsNew:', needsNewConversation);

        // Create a new conversation if none exists or if it's a temp ID
        if (needsNewConversation) {
          console.log('[VOICE] Creating new conversation...');
          const newConversation = await createConversation.mutateAsync({
            agent_id: agentId,
            user_id: userId,
            title: `Voice Chat with ${agent?.name || 'Agent'} - ${new Date().toLocaleDateString()}`,
          });
          conversationId = newConversation.id;
          setActiveConversationId(conversationId);
          console.log('[VOICE] Created conversation:', conversationId);
        }

        // Format transcript entries for the backend
        const entries = transcriptToSave.map((entry) => ({
          role: entry.role,
          text: entry.text,
          timestamp: entry.timestamp.toISOString(),
        }));
        
        console.log('[VOICE] Saving', entries.length, 'entries to conversation:', conversationId);

        // Save to database via Tauri command
        await invoke('save_voice_transcript', {
          conversationId,
          entries,
        });

        console.log('[VOICE] Save successful!');
        toast.success(`Voice chat saved (${transcriptToSave.length} messages)`);

        // Generate a proper title based on the first user message (only for new conversations)
        if (needsNewConversation && conversationId) {
          const firstUserMessage = transcriptToSave.find(entry => entry.role === 'user')?.text;
          if (firstUserMessage) {
            console.log('[VOICE] Generating conversation title from first message:', firstUserMessage);
            generateConversationTitle.mutate({
              conversationId,
              firstMessage: firstUserMessage,
            });
          }
        }

        clearTranscript();
      } catch (err) {
        console.error('[VOICE] Failed to auto-save transcript:', err);
        toast.error('Failed to save voice chat');
      } finally {
        setIsSaving(false);
      }
    } else {
      console.log('[VOICE] No transcript to save');
      toast.info('Disconnected from voice chat');
    }
  }, [disconnect, transcript, activeConversationId, agentId, userId, agent?.name, createConversation, clearTranscript]);

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

        {/* Voice Area Skeleton */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          <div className="flex-1 flex items-center justify-center">
            <Skeleton className="h-64 w-64 rounded-full" />
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
            onClick={handleStartNewVoiceChat} 
            className="w-full"
            variant="outline"
          >
            <Plus className="mr-2 h-4 w-4" />
            New Voice Chat
          </Button>
        </div>
        <div className="p-2 flex flex-col flex-1 min-h-0">
          <ScrollArea className="flex-1">
            <div className="space-y-1">
              {voiceConversations.length > 0 ? (
                voiceConversations.map((conv) => (
                  <div key={conv.id} className="w-60 group relative">
                    <button
                      onClick={() => {
                        setActiveConversationId(conv.id);
                        clearTranscript();
                        toast.info('Conversation selected');
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
                          className="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start" side="right" className="w-32">
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
                  No voice conversations yet
                </div>
              )}
            </div>
          </ScrollArea>
        </div>
      </div>

      {/* Voice Chat Area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
        {activeConversationId ? (
          <>
            {/* Background transcript - faded behind the visualizer */}
            <div className="absolute inset-0 overflow-hidden z-0">
              <ScrollArea className="h-full">
                <div className="mx-auto max-w-2xl space-y-4 p-4 pt-8 pb-48 opacity-30">
                  {transcript.map((entry, index) => (
                    <div
                      key={index}
                      className={cn(
                        'p-3 rounded-lg max-w-[80%]',
                        entry.role === 'user'
                          ? 'ml-auto bg-primary/20 text-foreground'
                          : 'mr-auto bg-muted text-foreground'
                      )}
                    >
                      <p className="text-xs font-medium mb-1">
                        {entry.role === 'user' ? 'You' : agent.name}
                      </p>
                      <p className="text-sm">{entry.text}</p>
                    </div>
                  ))}

                  {/* Current user speech (in progress) */}
                  {currentUserText && (
                    <div className="ml-auto p-3 rounded-lg max-w-[80%] bg-primary/20 text-foreground">
                      <p className="text-xs font-medium mb-1">You (speaking...)</p>
                      <p className="text-sm">{currentUserText}</p>
                    </div>
                  )}

                  {/* Current assistant speech (in progress) */}
                  {currentAssistantText && (
                    <div className="mr-auto p-3 rounded-lg max-w-[80%] bg-muted text-foreground">
                      <p className="text-xs font-medium mb-1">{agent.name} (speaking...)</p>
                      <p className="text-sm">{currentAssistantText}</p>
                    </div>
                  )}

                  <div ref={transcriptEndRef} />
                </div>
              </ScrollArea>
            </div>

            {/* Semi-opaque backdrop behind visualizer */}
            <div className="absolute inset-0 bg-background/80 z-10 pointer-events-none" />

            {/* Centered visualizer overlay */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-20">
              <div className="pointer-events-auto">
                <AudioVisualizer
                  state={state}
                  inputAudioLevel={inputAudioLevel}
                  outputAudioLevel={outputAudioLevel}
                />
              </div>
            </div>

            {/* Bottom controls */}
            <div className="absolute bottom-0 left-0 right-0 p-6 bg-linear-to-t from-background via-background to-transparent z-30">
              {/* Screen Awareness Controls */}
              <div className="mx-auto max-w-md flex items-center justify-center gap-4 mb-4">
                <div className="flex items-center gap-2 bg-background/80 rounded-full px-4 py-2 border">
                  <Eye className={cn(
                    "h-4 w-4 transition-colors",
                    isPerceptionRunning ? "text-green-500" : "text-muted-foreground"
                  )} />
                  <Label htmlFor="screen-awareness" className="text-sm">
                    Screen Awareness
                  </Label>
                  <Switch
                    id="screen-awareness"
                    checked={screenAwarenessEnabled}
                    onCheckedChange={setScreenAwarenessEnabled}
                  />
                  {isPerceptionRunning && (
                    <span className="text-xs text-muted-foreground ml-1">
                      ({screenshotCount})
                    </span>
                  )}
                </div>

                {/* Manual screenshot button */}
                {isConnected && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="outline"
                        size="icon"
                        className="rounded-full h-10 w-10"
                        onClick={async () => {
                          const result = await captureNow();
                          if (result) {
                            toast.success('Screenshot sent to agent');
                          }
                        }}
                      >
                        <Camera className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Capture screen now</p>
                    </TooltipContent>
                  </Tooltip>
                )}
              </div>

              <div className="mx-auto max-w-md flex items-center justify-center gap-4">
                {/* Main call button */}
                {isConnected ? (
                  <Button
                    variant="destructive"
                    size="lg"
                    className="rounded-full h-16 w-16"
                    onClick={handleDisconnect}
                    title="End call (auto-saves transcript)"
                    disabled={isSaving}
                  >
                    <PhoneOff className="h-6 w-6" />
                  </Button>
                ) : (
                  <Button
                    variant="default"
                    size="lg"
                    className="rounded-full h-16 w-16 bg-green-600 hover:bg-green-700"
                    onClick={handleConnect}
                    disabled={state === 'connecting' || isSaving}
                    title="Start call"
                  >
                    <Phone className="h-6 w-6" />
                  </Button>
                )}
              </div>

              {/* Connection status */}
              <div className="text-center mt-4 text-sm text-muted-foreground">
                {isSaving && 'Saving conversation...'}
                {!isSaving && state === 'idle' && !isConnected && 'Tap to start voice chat'}
                {!isSaving && state === 'connecting' && 'Connecting...'}
                {!isSaving && state === 'listening' && 'Listening... speak now'}
                {!isSaving && state === 'thinking' && 'Processing...'}
                {!isSaving && state === 'speaking' && `${agent.name} is speaking...`}
              </div>
            </div>
          </>
        ) : (
          /* Empty state - no conversation selected */
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
            <Mic className="h-12 w-12 mb-4 opacity-50" />
            <p className="text-lg font-medium">Start a voice conversation</p>
            <p className="text-sm mb-4">Select a conversation or start a new one</p>
            <Button onClick={handleStartNewVoiceChat} variant="outline">
              <Plus className="mr-2 h-4 w-4" />
              New Voice Chat
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
