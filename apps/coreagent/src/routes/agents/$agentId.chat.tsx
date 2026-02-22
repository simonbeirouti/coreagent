import { createFileRoute } from '@tanstack/react-router';
import { useAgent } from '@/hooks/useAgents';
import { useConversations, useCreateConversation, useMessages, useSendMessage, useSendMessageStreaming, useGenerateConversationTitle, useDeleteConversation, useDeleteMessage, useEditMessageStreaming } from '@/hooks/useConversations';
import { useAuth } from '@/hooks/use-auth';
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  MessageSquare,
  Send,
  Plus,
  X,
  Image as ImageIcon,
  Loader2,
  MoreHorizontal,
  Pencil,
  Trash2,
  ChevronLeft,
  ChevronRight,
  Check,
  Paperclip,
} from 'lucide-react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { MicrophoneButton } from '@/components/perception/microphone-button';
import { ScreenshotButton } from '@/components/perception/screenshot-button';
import { AttachButton } from '@/components/perception/attach-button';
import { MessageFeedback } from '@/components/feedback/message-feedback';
import { MarkdownContent } from '@/components/ui/markdown-content';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { useConversationDimensionFeedback } from '@/hooks/useFeedback';
import { useAgentRegistrySkills, useAgentToolSettings } from '@/hooks/useAbilities';
import { useVision } from '@/hooks/usePerception';
import { useInstalledSkills } from '@/hooks/useRegistrySkills';
import { getScreenshotSignedUrl, getUserFileSignedUrl } from '@/lib/storage';
import type { UserFileRecord } from '@/lib/storage';
import { Message } from '@/types';
import { resolveVisibleThread, getBranchInfo, selectBranch, BranchSelections, BranchInfo } from '@/lib/message-tree';
import { invoke } from '@tauri-apps/api/core';

// Maximum message length (matches backend validation)
const MAX_MESSAGE_LENGTH = 32000;
const MAX_PENDING_USER_FILES = 10;
const CORE_RUNTIME_TOOLS = new Set([
  'conversation',
  'memory_retrieval',
  'vision_screenshot',
  'vision_analysis',
  'audio_transcription',
  'voice_synthesis',
  'attachment_read',
]);
const DIRECT_TOOL_INTENT_VERBS = [
  'run',
  'execute',
  'launch',
  'start',
  'trigger',
] as const;
const RUNTIME_TOOL_CONTEXT_START = '[RuntimeToolContext]';
const RUNTIME_TOOL_CONTEXT_END = '[/RuntimeToolContext]';
const DIRECT_TOOL_RESULT_CONTEXT_START = '[DirectToolResultContext]';
const DIRECT_TOOL_RESULT_CONTEXT_END = '[/DirectToolResultContext]';

function slugifySlashToken(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-_]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function asObjectRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function choosePreferredTextField(
  parametersSchema?: Record<string, unknown>
): string | null {
  const schema = asObjectRecord(parametersSchema);
  const properties = asObjectRecord(schema?.properties);
  if (!properties) {
    return null;
  }

  const preferredKeys = ['text', 'query', 'prompt', 'input', 'message', 'content', 'instructions'];
  for (const key of preferredKeys) {
    const property = asObjectRecord(properties[key]);
    if (property?.type === 'string') {
      return key;
    }
  }

  const required = Array.isArray(schema?.required) ? schema.required : [];
  for (const requiredKey of required) {
    if (typeof requiredKey !== 'string') continue;
    const property = asObjectRecord(properties[requiredKey]);
    if (property?.type === 'string') {
      return requiredKey;
    }
  }

  return null;
}

function toTextEnvelope(rawText: string, parametersSchema?: Record<string, unknown>): Record<string, unknown> {
  const text = rawText.trim();
  if (!text) {
    return {};
  }

  const envelope: Record<string, unknown> = {
    text,
    query: text,
    input: text,
  };
  const preferredField = choosePreferredTextField(parametersSchema);
  if (preferredField) {
    envelope[preferredField] = text;
  }
  return envelope;
}

function parseDirectToolInput(
  argsText: string,
  options?: { parametersSchema?: Record<string, unknown> }
): Record<string, unknown> {
  if (!argsText) {
    return {};
  }

  try {
    const parsed = JSON.parse(argsText) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    if (typeof parsed === 'string') {
      return toTextEnvelope(parsed, options?.parametersSchema);
    }
    return { input: parsed };
  } catch {
    return toTextEnvelope(argsText, options?.parametersSchema);
  }
}

type SlashCommand = {
  id: string;
  commandToken: string;
  label: string;
  insertText: string;
  description: string;
  implementationKey: string;
  skillId?: string;
  parametersSchema?: Record<string, unknown>;
  executionMode: 'agent_runtime' | 'registry_direct';
  kind: 'runtime' | 'screenshot';
};

type DirectRuntimeToolRunResult = {
  implementationKey: string;
  skillId: string;
  version: string;
  executionMode: 'remote' | 'local_docker';
  runId: string;
  status: string;
  output?: Record<string, unknown> | null;
  error?: Record<string, unknown> | null;
  logMessages: string[];
};

type DirectRuntimeToolProgressEvent = {
  clientRunId: string;
  implementationKey: string;
  runId?: string | null;
  status?: string | null;
  message: string;
  sequence: number;
  timestampMs: number;
};

type DirectToolTimelineEntry = {
  id: string;
  message: string;
  level: 'info' | 'success' | 'error';
  timestampMs: number;
  sequence?: number;
};

type DirectToolRunStatus = 'running' | 'succeeded' | 'failed' | 'timed_out' | 'cancelled';

type DirectToolRunViewModel = {
  clientRunId: string;
  startedAtMs: number;
  implementationKey: string;
  skillId?: string;
  version?: string;
  executionMode?: 'remote' | 'local_docker';
  runId?: string;
  status: DirectToolRunStatus;
  timeline: DirectToolTimelineEntry[];
  output?: Record<string, unknown> | null;
  error?: Record<string, unknown> | null;
};

function inferTimelineLevel(message: string, status?: string | null): DirectToolTimelineEntry['level'] {
  const normalized = `${status ?? ''} ${message}`.toLowerCase();
  if (
    normalized.includes('failed') ||
    normalized.includes('error') ||
    normalized.includes('timed_out') ||
    normalized.includes('cancelled')
  ) {
    return 'error';
  }
  if (normalized.includes('succeeded') || normalized.includes('success')) {
    return 'success';
  }
  return 'info';
}

function appendUniqueTimelineEntries(
  existing: DirectToolTimelineEntry[],
  incoming: DirectToolTimelineEntry[]
): DirectToolTimelineEntry[] {
  if (incoming.length === 0) return existing;
  const seen = new Set(existing.map((entry) => entry.id));
  const next = [...existing];
  for (const entry of incoming) {
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    next.push(entry);
  }
  return next.sort((a, b) => {
    const aSeq = a.sequence ?? Number.POSITIVE_INFINITY;
    const bSeq = b.sequence ?? Number.POSITIVE_INFINITY;
    if (aSeq !== bSeq) {
      return aSeq - bSeq;
    }
    return a.timestampMs - b.timestampMs;
  });
}

function normalizeRuntimeImplementationKey(raw: string | null | undefined): string {
  const value = (raw ?? '').trim();
  if (!value) return '';
  return value
    .replace(/^coreagent_(rs|py|js|md)_/, '')
    .replace(/^coreagent_(rs|py|js|md)\./, '')
    .replace(/^coreagent\.(rs|py|js|md)\./, '')
    .trim();
}

function findRunIndexByCorrelation(
  runs: DirectToolRunViewModel[],
  payload: Pick<DirectRuntimeToolProgressEvent, 'clientRunId' | 'runId' | 'implementationKey'>
): number {
  const byClient = runs.findIndex((run) => run.clientRunId === payload.clientRunId);
  if (byClient !== -1) return byClient;

  if (payload.runId) {
    const byRunId = runs.findIndex((run) => run.runId === payload.runId);
    if (byRunId !== -1) return byRunId;
  }

  const normalizedKey = normalizeRuntimeImplementationKey(payload.implementationKey);
  if (normalizedKey) {
    const byKey = runs.findIndex((run) => {
      if (run.status !== 'running') return false;
      return normalizeRuntimeImplementationKey(run.implementationKey) === normalizedKey;
    });
    if (byKey !== -1) return byKey;
  }

  return -1;
}

function formatToolRunLabel(implementationKey: string): string {
  const shortKey = implementationKey.split('.').pop() || implementationKey;
  return shortKey.replace(/[_-]+/g, ' ').trim();
}

function shouldAttachRuntimeToolContext(content: string): boolean {
  const normalized = content.trim();
  if (!normalized || normalized.startsWith('/')) {
    return false;
  }

  const hasToolNoun = /\b(tool|tools|skill|skills|ability|abilities|command|commands)\b/i.test(
    normalized
  );
  const hasActionVerb = new RegExp(`\\b(?:${DIRECT_TOOL_INTENT_VERBS.join('|')})\\b`, 'i').test(
    normalized
  );
  const hasExplicitSelection = /\b(use|choose|pick|select|best|right|appropriate)\s+(tool|skill|ability|command)s?\b/i.test(
    normalized
  );
  const hasDiscoveryRequest = /\b(what|which|list|show)\b[\s\S]*\b(tool|skill|ability|command)s?\b/i.test(
    normalized
  );
  const hasImplementationKeyLikeToken = /\b[a-z0-9]+(?:[._-][a-z0-9]+){2,}\b/i.test(normalized);
  const hasInvokeWithToolNoun =
    /\b(run|execute|launch|start|trigger)\b[\s\S]*\b(tool|skill|ability|command)\b/i.test(
      normalized
    );

  return (
    hasImplementationKeyLikeToken ||
    hasExplicitSelection ||
    hasDiscoveryRequest ||
    hasInvokeWithToolNoun ||
    (hasToolNoun && hasActionVerb)
  );
}

function toRuntimeToolContext(tools: SlashCommand[]): string {
  if (tools.length === 0) {
    return '';
  }

  const catalog = tools
    .map((tool) => {
      const shortKey = tool.implementationKey.split('.').pop() || tool.implementationKey;
      const readableName = shortKey.replace(/[_-]+/g, ' ').trim();
      return `- ${readableName}: ${tool.description}`;
    })
    .join('\n');

  return [
    RUNTIME_TOOL_CONTEXT_START,
    'Semantic tool intent catalog for disambiguation only.',
    'When calling tools, use only exact tool/function names already exposed by runtime.',
    'Never invent tool names, and do not retry a failing tool more than once.',
    catalog,
    RUNTIME_TOOL_CONTEXT_END,
  ].join('\n');
}

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

type ParsedFileMarker = {
  storagePath: string;
  fileName: string;
  fileType: string;
};

function extractFileMarkers(content: string): ParsedFileMarker[] {
  const markers: ParsedFileMarker[] = [];
  const regex = /\[File:path:([^\]|]+)\|name:([^\]|]+)\|type:([^\]]+)\]/g;
  let match: RegExpExecArray | null = regex.exec(content);

  while (match) {
    markers.push({
      storagePath: match[1],
      fileName: decodeURIComponent(match[2]),
      fileType: match[3],
    });
    match = regex.exec(content);
  }

  return markers;
}

// Helper to get text content without the screenshot/image markers (handles both formats)
function getTextContent(content: string): string {
  return content
    .replace(/\[Screenshot:path:[^\]]+\]\n?/g, '') // New path format
    .replace(/\[Screenshot: https?:\/\/[^\]]+\]\n?/g, '') // Legacy URL format
    .replace(/\[File:path:[^\]|]+\|name:[^\]|]+\|type:[^\]]+\]\n?/g, '') // File marker format
    .replace(/\[Image Description: [\s\S]*?\]\n?/g, '') // Image description (for AI, not display)
    .replace(/\[RuntimeToolContext\][\s\S]*?\[\/RuntimeToolContext\]\n?/g, '') // Runtime tool context (for AI, not display)
    .replace(/\[DirectToolResultContext\][\s\S]*?\[\/DirectToolResultContext\]\n?/g, '') // Direct tool result context (for AI, not display)
    .replace(/\[ToolExecutionContext\][\s\S]*?\[\/ToolExecutionContext\]\n?/g, '') // Tool execution context (for reload hydration)
    .trim();
}

function parseToolExecutionContext(content: string): Record<string, unknown> | null {
  const match = content.match(
    /\[ToolExecutionContext\]([\s\S]*?)\[\/ToolExecutionContext\]/
  );
  if (!match?.[1]) return null;
  return safeParseObjectJson(match[1].trim());
}

function isDirectToolResultContextContent(content: string): boolean {
  return (
    content.includes(DIRECT_TOOL_RESULT_CONTEXT_START) &&
    content.includes(DIRECT_TOOL_RESULT_CONTEXT_END)
  );
}

function parseDirectToolRunStatus(value: string | null | undefined): DirectToolRunStatus {
  const normalized = (value ?? '').trim().toLowerCase();
  if (
    normalized === 'running' ||
    normalized === 'succeeded' ||
    normalized === 'failed' ||
    normalized === 'timed_out' ||
    normalized === 'cancelled'
  ) {
    return normalized;
  }
  return 'running';
}

function safeParseObjectJson(value: string | null): Record<string, unknown> | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

function parsePersistedDirectToolRuns(message: Message): DirectToolRunViewModel[] {
  const runs: DirectToolRunViewModel[] = [];
  const contextPayload = parseToolExecutionContext(message.content);

  const metadataRuns = Array.isArray(message.metadata?.inferred_tool_runs)
    ? (message.metadata.inferred_tool_runs as Array<Record<string, unknown>>)
    : Array.isArray(contextPayload?.runs)
    ? (contextPayload.runs as Array<Record<string, unknown>>)
    : [];
  for (const rawRun of metadataRuns) {
    const implementationKey =
      typeof rawRun.implementationKey === 'string' ? rawRun.implementationKey : null;
    if (!implementationKey) continue;
    const timelineRaw = Array.isArray(rawRun.timeline) ? rawRun.timeline : [];
    const timeline: DirectToolTimelineEntry[] = timelineRaw
      .map((entry, idx) => {
        if (!entry || typeof entry !== 'object') return null;
        const item = entry as Record<string, unknown>;
        const entryMessage = typeof item.message === 'string' ? item.message : '';
        if (!entryMessage) return null;
        const timestampMs =
          typeof item.timestampMs === 'number'
            ? item.timestampMs
            : Date.parse(message.created_at) || Date.now();
        const sequence = typeof item.sequence === 'number' ? item.sequence : idx;
        const level =
          item.level === 'success' || item.level === 'error' || item.level === 'info'
            ? (item.level as DirectToolTimelineEntry['level'])
            : inferTimelineLevel(
                entryMessage,
                typeof rawRun.status === 'string' ? rawRun.status : null
              );
        return {
          id:
            typeof item.id === 'string'
              ? item.id
              : `persisted-${message.id}-${implementationKey}-${sequence}`,
          message: entryMessage,
          level,
          timestampMs,
          sequence,
        };
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
    const status = parseDirectToolRunStatus(
      typeof rawRun.status === 'string' ? rawRun.status : undefined
    );
    const startedAtMs =
      typeof rawRun.startedAtMs === 'number'
        ? rawRun.startedAtMs
        : timeline[0]?.timestampMs || Date.parse(message.created_at) || Date.now();
    runs.push({
      clientRunId:
        typeof rawRun.clientRunId === 'string'
          ? rawRun.clientRunId
          : `persisted-meta-${message.id}-${implementationKey}`,
      startedAtMs,
      implementationKey,
      runId: typeof rawRun.runId === 'string' ? rawRun.runId : undefined,
      status,
      timeline:
        timeline.length > 0
          ? timeline
          : [
              {
                id: `persisted-meta-${message.id}-${implementationKey}-completed`,
                message: `Run completed with status ${status}.`,
                level: inferTimelineLevel(`Run completed with status ${status}.`, status),
                timestampMs: startedAtMs,
                sequence: Number.MAX_SAFE_INTEGER,
              },
            ],
    });
  }

  if (runs.length > 0) {
    return runs;
  }

  if (message.role !== 'user') return [];
  const match = message.content.match(
    /\[DirectToolResultContext\]([\s\S]*?)\[\/DirectToolResultContext\]/
  );
  if (!match?.[1]) return [];
  const block = match[1];
  const tool = block.match(/^\s*Tool:\s*(.+)$/m)?.[1]?.trim();
  if (!tool) return [];
  const runId = block.match(/^\s*Run ID:\s*(.+)$/m)?.[1]?.trim();
  const statusValue = block.match(/^\s*Status:\s*(.+)$/m)?.[1]?.trim();
  const executionMode = block.match(/^\s*Execution mode:\s*(.+)$/m)?.[1]?.trim();
  const outputJson = safeParseObjectJson(
    block.match(/Tool output JSON:\s*([\s\S]*?)\nTool error JSON:/)?.[1]?.trim() ?? null
  );
  const errorJson = safeParseObjectJson(
    block
      .match(
        /Tool error JSON:\s*([\s\S]*?)\nPlease provide a concise user-facing response based on this tool result\./
      )
      ?.[1]
      ?.trim() ?? null
  );
  const status = parseDirectToolRunStatus(statusValue);
  const startedAtMs = Date.parse(message.created_at) || Date.now();
  const completedMessage = `Run completed with status ${status}.`;
  return [{
    clientRunId: `persisted-${runId || message.id}`,
    startedAtMs,
    implementationKey: tool,
    runId: runId || undefined,
    status,
    executionMode:
      executionMode === 'remote' || executionMode === 'local_docker' ? executionMode : undefined,
    output: outputJson,
    error: errorJson,
    timeline: [
      {
        id: `persisted-${message.id}-completed`,
        message: completedMessage,
        level: inferTimelineLevel(completedMessage, status),
        timestampMs: startedAtMs,
        sequence: Number.MAX_SAFE_INTEGER,
      },
    ],
  }];
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
        // Remove legacy/new bucket prefixes since helper expects just object path
        const pathWithoutBucket = storagePath
          .replace(/^screenshots\//, '')
          .replace(/^user-files\//, '');
        
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

function DirectToolRunCard({ run }: { run: DirectToolRunViewModel }) {
  const latestEntry = run.timeline[run.timeline.length - 1];
  const statusToneClass =
    run.status === 'succeeded'
      ? 'text-green-700 dark:text-green-400'
      : run.status === 'failed' || run.status === 'timed_out' || run.status === 'cancelled'
      ? 'text-destructive'
      : 'text-muted-foreground';
  const statusLabel =
    run.status === 'running' ? 'Running' : run.status.replace(/_/g, ' ');

  return (
    <Card className="w-full min-w-0 max-w-[80%] overflow-hidden border-border/80 bg-muted p-0">
      <CardContent className="min-w-0 p-3">
        <Accordion type="single" collapsible>
          <AccordionItem value={`run-${run.clientRunId}`} className="border-b-0">
            <AccordionTrigger className="min-w-0 py-1 hover:no-underline">
              <div className="flex min-w-0 w-full flex-1 flex-col items-start gap-1 overflow-hidden">
                <div className="flex min-w-0 w-full items-center gap-2 overflow-hidden">
                  {run.status === 'running' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                  <span className="truncate text-sm font-medium min-w-0">
                    {formatToolRunLabel(run.implementationKey)}
                  </span>
                  <span className={cn('text-xs capitalize', statusToneClass)}>{statusLabel}</span>
                </div>
                {latestEntry ? (
                  <div className="line-clamp-1 w-full max-w-full overflow-hidden break-all text-xs text-muted-foreground">
                    {latestEntry.message}
                  </div>
                ) : null}
              </div>
            </AccordionTrigger>
            <AccordionContent className="min-w-0 pt-1">
              <div className="space-y-2">
                {run.executionMode ? (
                  <div className="text-xs text-muted-foreground">
                    execution mode: <span className="font-medium">{run.executionMode}</span>
                  </div>
                ) : null}
                {run.runId ? (
                  <div className="text-xs text-muted-foreground">
                    run id: <span className="font-medium">{run.runId}</span>
                  </div>
                ) : null}
                <div className="min-w-0 space-y-1.5 rounded-md border bg-background p-2">
                  {run.timeline.length > 0 ? (
                    run.timeline.map((entry) => (
                      <div key={entry.id} className="min-w-0 max-w-full text-xs break-all">
                        <span
                          className={cn(
                            'mr-2 font-medium',
                            entry.level === 'error'
                              ? 'text-destructive'
                              : entry.level === 'success'
                              ? 'text-green-700 dark:text-green-400'
                              : 'text-muted-foreground'
                          )}
                        >
                          {new Date(entry.timestampMs).toLocaleTimeString()}
                        </span>
                        <span className="break-all">{entry.message}</span>
                      </div>
                    ))
                  ) : (
                    <div className="text-xs text-muted-foreground">Waiting for runner updates...</div>
                  )}
                </div>
                {run.output ? (
                  <div className="space-y-1">
                    <div className="text-xs font-medium">Output</div>
                    <pre className="max-h-48 w-full max-w-full overflow-auto whitespace-pre-wrap break-words rounded-md border bg-background p-2 text-[11px]">
                      {JSON.stringify(run.output, null, 2)}
                    </pre>
                  </div>
                ) : null}
                {run.error ? (
                  <div className="space-y-1">
                    <div className="text-xs font-medium text-destructive">Error</div>
                    <pre className="max-h-56 w-full max-w-full overflow-auto whitespace-pre-wrap break-words rounded-md border border-destructive/40 bg-background p-2 text-[11px]">
                      {JSON.stringify(run.error, null, 2)}
                    </pre>
                  </div>
                ) : null}
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </CardContent>
    </Card>
  );
}

export const Route = createFileRoute('/agents/$agentId/chat')({
  validateSearch: (search: Record<string, unknown>) => ({
    conversationId:
      typeof search.conversationId === 'string' ? search.conversationId : undefined,
  }),
  component: AgentChatPage,
});

function AgentChatPage() {
  const { agentId } = Route.useParams();
  const { conversationId } = Route.useSearch();
  const navigate = Route.useNavigate();
  const { user } = useAuth();
  const userId = user?.id || '';
  
  const { data: agent, isLoading: agentLoading } = useAgent(agentId);
  const { data: toolSettings = [] } = useAgentToolSettings(agentId);
  const { data: agentRegistrySkills = [] } = useAgentRegistrySkills(agentId);
  const { data: installedSkills = [] } = useInstalledSkills();
  const { captureScreen } = useVision(agentId);
  const { data: conversations, isLoading: conversationsLoading } = useConversations(agentId);
  const createConversation = useCreateConversation();
  const sendMessage = useSendMessage();
  const sendMessageStreaming = useSendMessageStreaming();
  const generateConversationTitle = useGenerateConversationTitle();
  const deleteConversation = useDeleteConversation();
  const deleteMessage = useDeleteMessage();
  const editMessageStreaming = useEditMessageStreaming();

  const activeConversationId = conversationId ?? null;
  const [isComposingNewConversation, setIsComposingNewConversation] = useState(false);
  const setActiveConversationId = useCallback(
    (nextConversationId: string | null) => {
      navigate({
        to: '/agents/$agentId/chat',
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

  const [messageInput, setMessageInput] = useState('');
  const [pendingScreenshot, setPendingScreenshot] = useState<{
    base64: string;
    storagePath?: string; // Path in Supabase storage
    signedUrl?: string; // Temporary signed URL for immediate display
  } | null>(null);
  const [pendingUserFiles, setPendingUserFiles] = useState<UserFileRecord[]>([]);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isDirectToolRunning, setIsDirectToolRunning] = useState(false);
  const [directToolRuns, setDirectToolRuns] = useState<DirectToolRunViewModel[]>([]);
  const [showSlashCommands, setShowSlashCommands] = useState(false);
  const isActiveConversationStreaming =
    sendMessageStreaming.isStreaming &&
    Boolean(activeConversationId) &&
    sendMessageStreaming.streamingConversationId === activeConversationId;
  const applyToolProgressEvent = useCallback((payload: DirectRuntimeToolProgressEvent) => {
    setDirectToolRuns((prev) => {
      const index = findRunIndexByCorrelation(prev, payload);
      if (index === -1) {
        // Ignore orphan events from runs started in another chat/view.
        return prev;
      }
      const timelineEntry: DirectToolTimelineEntry = {
        id: `${payload.clientRunId}-progress-${payload.sequence}`,
        message: payload.message,
        level: inferTimelineLevel(payload.message, payload.status),
        timestampMs: payload.timestampMs || Date.now(),
        sequence: payload.sequence,
      };

      const next = [...prev];
      const target = next[index];
      next[index] = {
        ...target,
        clientRunId: payload.clientRunId || target.clientRunId,
        implementationKey: payload.implementationKey || target.implementationKey,
        runId: payload.runId ?? target.runId,
        status: (payload.status as DirectToolRunStatus) || target.status,
        timeline: appendUniqueTimelineEntries(target.timeline, [timelineEntry]),
      };
      return next;
    });
  }, []);


  // Message branching state
  const [branchSelections, setBranchSelections] = useState<BranchSelections>({});
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const [deleteConfirmMessageId, setDeleteConfirmMessageId] = useState<string | null>(null);

  const { data: messages, isLoading: messagesLoading } = useMessages(activeConversationId || '');
  const { data: feedbackByMessage = {} } = useConversationDimensionFeedback(activeConversationId || '', userId);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const prevMessagesCountRef = useRef<number>(0);
  const prevToolRunsSignalRef = useRef<string>('');

  // Compute visible thread based on branch selections
  const visibleMessages = useMemo(
    () => (messages ? resolveVisibleThread(messages, branchSelections) : []),
    [messages, branchSelections]
  );
  const displayMessages = useMemo(
    () =>
      visibleMessages.filter(
        (message) =>
          !(message.role === 'user' && isDirectToolResultContextContent(message.content))
      ),
    [visibleMessages]
  );
  const persistedToolRuns = useMemo(
    () =>
      visibleMessages
        .flatMap((message) => parsePersistedDirectToolRuns(message))
        .filter((run): run is DirectToolRunViewModel => run !== null),
    [visibleMessages]
  );
  const persistedAcceptanceItems = useMemo(
    () =>
      visibleMessages
        .map((message) => {
          if (message.role !== 'assistant') return null;
          const contextPayload = parseToolExecutionContext(message.content);
          const content =
            typeof message.metadata?.tool_acceptance_message === 'string'
              ? message.metadata.tool_acceptance_message
              : typeof contextPayload?.acceptanceMessage === 'string'
              ? contextPayload.acceptanceMessage
              : null;
          if (!content) return null;
          const metadataTimestamp =
            typeof message.metadata?.tool_acceptance_timestamp_ms === 'number'
              ? message.metadata.tool_acceptance_timestamp_ms
              : typeof contextPayload?.acceptanceTimestampMs === 'number'
              ? contextPayload.acceptanceTimestampMs
              : null;
          return {
            kind: 'acceptance' as const,
            id: `acceptance-${message.id}`,
            timestampMs: metadataTimestamp ?? Math.max(0, (Date.parse(message.created_at) || 0) - 1),
            index: 0,
            content,
          };
        })
        .filter((item): item is { kind: 'acceptance'; id: string; timestampMs: number; index: number; content: string } => item !== null),
    [visibleMessages]
  );
  const allToolRuns = useMemo(() => {
    const liveRunIds = new Set(directToolRuns.map((run) => run.runId).filter(Boolean));
    const liveRunKeys = new Set(
      directToolRuns.map((run) => `${run.implementationKey}:${run.startedAtMs}`)
    );
    const hydratedRuns = persistedToolRuns.filter((run) => {
      if (run.runId && liveRunIds.has(run.runId)) {
        return false;
      }
      return !liveRunKeys.has(`${run.implementationKey}:${run.startedAtMs}`);
    });
    return [...hydratedRuns, ...directToolRuns];
  }, [persistedToolRuns, directToolRuns]);
  const branchInfoMap = useMemo(
    () => (messages ? getBranchInfo(messages, branchSelections) : new Map<string, BranchInfo>()),
    [messages, branchSelections]
  );
  const chatTimelineItems = useMemo(() => {
    const messageItems = displayMessages.map((message, index) => ({
      kind: 'message' as const,
      id: `message-${message.id}`,
      timestampMs: Date.parse(message.created_at) || 0,
      index,
      message,
    }));
    const runItems = allToolRuns.map((run, index) => ({
      kind: 'run' as const,
      id: `run-${run.clientRunId}`,
      timestampMs: run.startedAtMs || run.timeline[0]?.timestampMs || Number.MAX_SAFE_INTEGER,
      index,
      run,
    }));
    const firstRunTimestampMs =
      runItems.length > 0 ? Math.min(...runItems.map((item) => item.timestampMs)) : null;
    const acceptanceTimestampMs =
      firstRunTimestampMs !== null
        ? Math.max(
            0,
            Math.min(
              sendMessageStreaming.toolAcceptanceTimestampMs ?? firstRunTimestampMs,
              firstRunTimestampMs - 1
            )
          )
        : sendMessageStreaming.toolAcceptanceTimestampMs;
    const acceptanceItems =
      isActiveConversationStreaming &&
      sendMessageStreaming.toolAcceptanceMessage &&
      acceptanceTimestampMs
        ? [
            {
              kind: 'acceptance' as const,
              id: 'streaming-tool-acceptance',
              timestampMs: acceptanceTimestampMs,
              index: Number.MAX_SAFE_INTEGER - 1,
              content: sendMessageStreaming.toolAcceptanceMessage,
            },
          ]
        : [];
    return [...messageItems, ...persistedAcceptanceItems, ...acceptanceItems, ...runItems].sort((a, b) => {
      if (a.timestampMs !== b.timestampMs) {
        return a.timestampMs - b.timestampMs;
      }
      if (a.kind !== b.kind) {
        if (a.kind === 'message') return -1;
        if (b.kind === 'message') return 1;
        if (a.kind === 'acceptance') return -1;
        if (b.kind === 'acceptance') return 1;
        return 0;
      }
      return a.index - b.index;
    });
  }, [
    displayMessages,
    allToolRuns,
    sendMessageStreaming.isStreaming,
    isActiveConversationStreaming,
    sendMessageStreaming.toolAcceptanceMessage,
    sendMessageStreaming.toolAcceptanceTimestampMs,
    persistedAcceptanceItems,
  ]);
  const runtimeSlashCommands = useMemo<SlashCommand[]>(() => {
    return toolSettings
      .filter((tool) => tool.enabled && !CORE_RUNTIME_TOOLS.has(tool.implementation_key))
      .map((tool) => {
        const commandToken = tool.implementation_key.toLowerCase();
        return {
          id: tool.implementation_key,
          commandToken,
          label: `/${commandToken}`,
          insertText: `/${commandToken} `,
          description: tool.description || `Run ${tool.ability_name}`,
          implementationKey: tool.implementation_key,
          parametersSchema: tool.parameters_schema,
          executionMode: 'agent_runtime' as const,
          kind: 'runtime' as const,
        };
      });
  }, [toolSettings]);
  const registrySlashCommands = useMemo<SlashCommand[]>(() => {
    return agentRegistrySkills
      .filter((skill) => skill.enabled)
      .map((skill) => {
        const commandToken = skill.implementationKey.toLowerCase();
        return {
          id: `registry:${skill.implementationKey}`,
          commandToken,
          label: `/${commandToken}`,
          insertText: `/${commandToken} `,
          description: `Run assigned skill ${skill.name}`,
          implementationKey: skill.implementationKey,
          skillId: skill.skillId,
          executionMode: 'registry_direct' as const,
          kind: 'runtime' as const,
        };
      });
  }, [agentRegistrySkills]);
  const installedSlashCommands = useMemo<SlashCommand[]>(() => {
    return installedSkills
      .filter((skill) => ['installed', 'ready'].includes(skill.installState))
      .map((skill) => {
        const commandToken = skill.implementationKey.toLowerCase();
        return {
          id: `installed:${skill.skillId}`,
          commandToken,
          label: `/${commandToken}`,
          insertText: `/${commandToken} `,
          description: `Run installed skill ${skill.name}`,
          implementationKey: skill.implementationKey,
          skillId: skill.skillId,
          executionMode: 'registry_direct' as const,
          kind: 'runtime' as const,
        };
      });
  }, [installedSkills]);
  const slashCommands = useMemo<SlashCommand[]>(() => {
    const byImplementationKey = new Map<string, SlashCommand>();
    for (const command of [
      ...runtimeSlashCommands,
      ...registrySlashCommands,
      ...installedSlashCommands,
    ]) {
      if (!byImplementationKey.has(command.implementationKey)) {
        byImplementationKey.set(command.implementationKey, command);
      }
    }

    const usedTokens = new Set<string>(['screenshot']);
    const uniqueRuntimeCommands = Array.from(byImplementationKey.values()).map((command) => {
      const baseToken =
        command.commandToken ||
        slugifySlashToken(command.implementationKey.split('.').pop() || command.implementationKey);
      let token = baseToken;
      let suffix = 2;
      while (usedTokens.has(token)) {
        token = `${baseToken}-${suffix}`;
        suffix += 1;
      }
      usedTokens.add(token);
      return {
        ...command,
        commandToken: token,
        label: `/${token}`,
        insertText: `/${token} `,
      };
    });

    return [
      {
        id: 'screenshot',
        commandToken: 'screenshot',
        label: '/screenshot',
        insertText: '/screenshot ',
        description: 'Capture and attach a screenshot',
        implementationKey: 'vision_screenshot',
        executionMode: 'agent_runtime',
        kind: 'screenshot' as const,
      },
      ...uniqueRuntimeCommands,
    ];
  }, [runtimeSlashCommands, registrySlashCommands, installedSlashCommands]);
  const slashQuery = messageInput.startsWith('/') ? messageInput.slice(1).toLowerCase() : '';
  const filteredSlashCommands = useMemo(() => {
    if (!slashQuery) return slashCommands;
    return slashCommands.filter((cmd) =>
      cmd.label.slice(1).toLowerCase().includes(slashQuery) ||
      cmd.description.toLowerCase().includes(slashQuery)
    );
  }, [slashCommands, slashQuery]);

  useEffect(() => {
    setShowSlashCommands(messageInput.startsWith('/') && !messageInput.slice(1).includes(' '));
  }, [messageInput]);

  useEffect(() => {
    let dispose: UnlistenFn | null = null;
    let cancelled = false;

    listen<DirectRuntimeToolProgressEvent>('direct-runtime-tool-progress', (event) => {
      if (cancelled) return;
      applyToolProgressEvent(event.payload);
    })
      .then((unlisten) => {
        dispose = unlisten;
      })
      .catch((error) => {
        console.error('Failed to subscribe to direct runtime tool progress:', error);
      });

    return () => {
      cancelled = true;
      if (dispose) {
        dispose();
      }
    };
  }, [applyToolProgressEvent]);

  useEffect(() => {
    if (!sendMessageStreaming.inferredToolProgress.length) return;
    for (const event of sendMessageStreaming.inferredToolProgress) {
      if (!activeConversationId || event.conversationId !== activeConversationId) {
        continue;
      }
      setDirectToolRuns((prev) => {
        if (findRunIndexByCorrelation(prev, event as DirectRuntimeToolProgressEvent) !== -1) {
          return prev;
        }
        return [
          ...prev,
          {
            clientRunId: event.clientRunId,
            startedAtMs: event.timestampMs || Date.now(),
            implementationKey: event.implementationKey,
            runId: event.runId ?? undefined,
            status: (event.status as DirectToolRunStatus) || 'running',
            timeline: [],
          },
        ];
      });
      applyToolProgressEvent(event as DirectRuntimeToolProgressEvent);
    }
  }, [sendMessageStreaming.inferredToolProgress, applyToolProgressEvent, activeConversationId]);

  // Reset branch selections when switching conversations
  useEffect(() => {
    setBranchSelections({});
    setEditingMessageId(null);
    setEditContent('');
    setDirectToolRuns([]);
  }, [activeConversationId]);

  // Reset local state when switching agents
  useEffect(() => {
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

  // Auto-scroll when live tool runs are appended/updated.
  useEffect(() => {
    const signal = directToolRuns
      .map((run) => `${run.clientRunId}:${run.timeline.length}:${run.status}`)
      .join('|');
    if (!signal) {
      prevToolRunsSignalRef.current = '';
      return;
    }
    if (signal !== prevToolRunsSignalRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      prevToolRunsSignalRef.current = signal;
    }
  }, [directToolRuns]);


  const handleStartNewConversation = () => {
    // Prevent switching while a message is actively streaming
    if (sendMessageStreaming.isStreaming || editMessageStreaming.isStreaming) return;

    // If already composing a new conversation, do nothing
    if (isComposingNewConversation) return;

    // Switch to compose mode for a fresh chat
    setActiveConversationId(null);
    setIsComposingNewConversation(true);
    setMessageInput('');
    setPendingScreenshot(null);
  };

  const sendPreparedMessage = async (content: string, imageBase64?: string) => {
    if (!content.trim()) return;
    if (!activeConversationId) {
      const newConversation = await createConversation.mutateAsync({
        agent_id: agentId,
        user_id: userId,
        title: `Chat with ${agent?.name || 'Agent'}`,
      });
      setActiveConversationId(newConversation.id);
      setIsComposingNewConversation(false);
      await sendMessageStreaming.sendMessage({
        conversation_id: newConversation.id,
        content,
        image_base64: imageBase64,
      });
      generateConversationTitle.mutate({
        conversationId: newConversation.id,
        firstMessage: content,
      });
      return;
    }

    await sendMessageStreaming.sendMessage({
      conversation_id: activeConversationId,
      content,
      image_base64: imageBase64,
    });
  };

  const runtimeDirectCommands = useMemo(
    () => slashCommands.filter((entry) => entry.kind === 'runtime'),
    [slashCommands]
  );
  const runtimeToolContext = useMemo(
    () => toRuntimeToolContext(runtimeDirectCommands),
    [runtimeDirectCommands]
  );

  const executeDirectRuntimeTool = useCallback(
    async (
      tool: SlashCommand,
      parsedInput: Record<string, unknown>,
      rawInputText: string
    ): Promise<boolean> => {
      const clientRunId =
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `tool-run-${Date.now()}`;
      const startedAt = Date.now();

      setDirectToolRuns((prev) => [
        ...prev,
        {
          clientRunId,
          startedAtMs: startedAt,
          implementationKey: tool.implementationKey,
          status: 'running',
          timeline: [
            {
              id: `${clientRunId}-queued`,
              message: `Queued ${tool.label} with input ${JSON.stringify(parsedInput)}`,
              level: 'info',
              timestampMs: startedAt,
              sequence: -1,
            },
          ],
        },
      ]);
      setIsDirectToolRunning(true);
      try {
        if (tool.executionMode === 'registry_direct' && !tool.skillId) {
          throw new Error(`Missing skillId for ${tool.implementationKey}`);
        }
        const result =
          tool.executionMode === 'registry_direct'
            ? await invoke<DirectRuntimeToolRunResult>('run_registry_skill_direct', {
                agentId,
                skillId: tool.skillId!,
                input: parsedInput,
                clientRunId,
              })
            : await invoke<DirectRuntimeToolRunResult>('run_agent_runtime_tool', {
                agentId,
                implementationKey: tool.implementationKey,
                input: parsedInput,
                clientRunId,
              });

        setDirectToolRuns((prev) =>
          prev.map((run) => {
            if (run.clientRunId !== clientRunId) return run;

            const appendedTimeline: DirectToolTimelineEntry[] = [];
            const hasProgressLogs = run.timeline.some(
              (entry) => entry.id.startsWith(`${clientRunId}-progress-`) && (entry.sequence ?? -1) > 0
            );
            if (!hasProgressLogs) {
              for (const message of result.logMessages) {
                appendedTimeline.push({
                  id: `${clientRunId}-log-fallback-${startedAt}-${appendedTimeline.length}`,
                  message,
                  level: inferTimelineLevel(message, result.status),
                  timestampMs: Date.now(),
                  sequence: appendedTimeline.length + 1,
                });
              }
            }

            return {
              ...run,
              implementationKey: result.implementationKey,
              skillId: result.skillId,
              version: result.version,
              executionMode: result.executionMode,
              runId: result.runId,
              status: (result.status as DirectToolRunStatus) || 'running',
              output: result.output ?? null,
              error: result.error ?? null,
              timeline: appendUniqueTimelineEntries(run.timeline, [
                ...appendedTimeline,
                {
                  id: `${clientRunId}-completed`,
                  message: `Run completed with status ${result.status}.`,
                  level: inferTimelineLevel(`Run completed with status ${result.status}.`, result.status),
                  timestampMs: Date.now(),
                  sequence: Number.MAX_SAFE_INTEGER,
                },
              ]),
            };
          })
        );

        const followupPrompt = [
          DIRECT_TOOL_RESULT_CONTEXT_START,
          `A direct runtime tool run has completed.`,
          `Tool: ${result.implementationKey}`,
          `Run ID: ${result.runId}`,
          `Status: ${result.status}`,
          `Execution mode: ${result.executionMode}`,
          `User-provided tool text: ${rawInputText || '(none)'}`,
          `Tool input: ${JSON.stringify(parsedInput)}`,
          `Tool output JSON: ${JSON.stringify(result.output ?? {}, null, 2)}`,
          `Tool error JSON: ${JSON.stringify(result.error ?? null, null, 2)}`,
          `Please provide a concise user-facing response based on this tool result.`,
          DIRECT_TOOL_RESULT_CONTEXT_END,
        ].join('\n');

        await sendPreparedMessage(followupPrompt);
        setMessageInput('');
        toast.success(`Executed ${tool.label}`);
        return true;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        setDirectToolRuns((prev) =>
          prev.map((run) =>
            run.clientRunId === clientRunId
              ? {
                  ...run,
                  status: 'failed',
                  timeline: appendUniqueTimelineEntries(run.timeline, [
                    {
                      id: `${clientRunId}-failed`,
                      message: errorMessage,
                      level: 'error',
                      timestampMs: Date.now(),
                      sequence: Number.MAX_SAFE_INTEGER,
                    },
                  ]),
                  error: { message: errorMessage },
                }
              : run
          )
        );
        toast.error(errorMessage || `Failed to execute ${tool.label}`);
        return false;
      } finally {
        setIsDirectToolRunning(false);
      }
    },
    [agentId, sendPreparedMessage]
  );

  const executeSlashCommand = async (rawInput: string): Promise<boolean> => {
    if (!rawInput.startsWith('/')) return false;
    const [rawCommand, ...rest] = rawInput.trim().split(/\s+/);
    const command = rawCommand.slice(1).trim().toLowerCase();
    if (!command) return false;

    if (command === 'screenshot') {
      const result = await captureScreen.mutateAsync({
        autoUpload: true,
        conversationId: activeConversationId || undefined,
      });
      handleScreenshot(result.image_base64, result.storage_path, result.signed_url);
      if (rest.length > 0) {
        setMessageInput(rest.join(' '));
      } else {
        setMessageInput('');
      }
      return true;
    }

    const tool = slashCommands.find(
      (entry) => entry.kind === 'runtime' && entry.commandToken === command
    );
    if (!tool) {
      return false;
    }

    const rawArgsText = rest.join(' ').trim();
    const parsedInput = parseDirectToolInput(rawArgsText, {
      parametersSchema: tool.parametersSchema,
    });
    return executeDirectRuntimeTool(tool, parsedInput, rawArgsText);
  };

  const handleSendMessage = async () => {
    if (!messageInput.trim() && !pendingScreenshot && pendingUserFiles.length === 0) return;
    const trimmedMessageInput = messageInput.trim();
    const imageBase64 = pendingScreenshot?.base64;
    const includeRuntimeToolContext =
      Boolean(runtimeToolContext) && shouldAttachRuntimeToolContext(trimmedMessageInput);
    let contentWithoutRuntimeToolContext = trimmedMessageInput;
    let finalContent = trimmedMessageInput;

    try {
      if (trimmedMessageInput.startsWith('/')) {
        const executed = await executeSlashCommand(trimmedMessageInput);
        if (executed) return;
      }

      if (includeRuntimeToolContext && runtimeToolContext) {
        finalContent = `${runtimeToolContext}\n${finalContent}`;
      }
      if (pendingScreenshot) {
        if (pendingScreenshot.storagePath) {
          contentWithoutRuntimeToolContext = `[Screenshot:path:${pendingScreenshot.storagePath}]\n${contentWithoutRuntimeToolContext}`;
          finalContent = `[Screenshot:path:${pendingScreenshot.storagePath}]\n${finalContent}`;
        } else {
          console.warn('Screenshot was captured but not uploaded to storage');
        }
      }
      if (pendingUserFiles.length > 0) {
        const preflightChecks = await Promise.all(
          pendingUserFiles.map(async (file) => ({
            file,
            signedUrl: await getUserFileSignedUrl(file.storage_path, 60),
          }))
        );
        const hasVerifiedAttachment = preflightChecks.some((entry) => Boolean(entry.signedUrl));
        const validFiles = hasVerifiedAttachment
          ? preflightChecks.filter((entry) => Boolean(entry.signedUrl)).map((entry) => entry.file)
          : pendingUserFiles;
        const staleFiles = hasVerifiedAttachment
          ? preflightChecks.filter((entry) => !entry.signedUrl).map((entry) => entry.file.file_name)
          : [];
        if (staleFiles.length > 0) {
          toast.warning(
            `Some attachments are no longer available in storage and were skipped: ${staleFiles.join(', ')}`
          );
        }
        if (!hasVerifiedAttachment) {
          console.warn('Attachment storage preflight verification unavailable; proceeding with selected attachments.');
        }
        if (validFiles.length === 0 && !trimmedMessageInput && !pendingScreenshot) {
          toast.error('All selected attachments are unavailable. Re-upload the files and try again.');
          return;
        }

        const markers = validFiles.map((file) => {
          const encodedName = encodeURIComponent(file.file_name);
          return `[File:path:${file.storage_path}|name:${encodedName}|type:${file.file_ext}]`;
        });
        if (markers.length > 0) {
          const markerBlock = `${markers.join('\n')}\n`;
          contentWithoutRuntimeToolContext = `${markerBlock}${contentWithoutRuntimeToolContext}`;
          finalContent = `${markerBlock}${finalContent}`;
        }
      }
      if (!finalContent.trim()) return;

      setMessageInput('');
      setPendingScreenshot(null);
      setPendingUserFiles([]);
      await sendPreparedMessage(finalContent, imageBase64);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error ?? '');
      const combinedErrorMessage = `${sendMessageStreaming.error || ''} ${errorMessage}`.toLowerCase();
      const isToolLoopError = combinedErrorMessage.includes(
        'tool-call loop exceeded maximum iterations without terminal assistant response'
      );

      if (includeRuntimeToolContext && isToolLoopError && contentWithoutRuntimeToolContext.trim()) {
        try {
          await sendPreparedMessage(contentWithoutRuntimeToolContext, imageBase64);
          return;
        } catch (retryError) {
          console.error('Retry send message error:', retryError);
        }
      }

      toast.error(sendMessageStreaming.error || 'Failed to send message');
      console.error('Send message error:', error);
      setIsComposingNewConversation(false);
      sendMessageStreaming.clearError();
    }
  };

  const handleSelectSlashCommand = (command: SlashCommand) => {
    setMessageInput(command.insertText);
    setShowSlashCommands(false);
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
      toast.success('Screenshot ready');
    } else {
      toast.warning('Screenshot captured but not saved to storage');
    }
  };

  const handleAttachUserFile = (file: UserFileRecord) => {
    if (file.id.startsWith('temp-') || file.storage_path.startsWith('pending/')) {
      toast.warning('File is still uploading. Please wait and attach it again once ready.');
      return;
    }

    const alreadyAttached = pendingUserFiles.some(
      (entry) => entry.id === file.id || entry.storage_path === file.storage_path
    );
    if (alreadyAttached) {
      toast.info(`${file.file_name} is already attached`);
      return;
    }

    if (pendingUserFiles.length >= MAX_PENDING_USER_FILES) {
      toast.warning(`You can attach up to ${MAX_PENDING_USER_FILES} files per message`);
      return;
    }

    setPendingUserFiles((prev) => [...prev, file]);
    toast.success(`${file.file_name} attached`);
  };

  const clearPendingScreenshot = () => {
    setPendingScreenshot(null);
  };

  const clearPendingUserFile = (fileId: string) => {
    setPendingUserFiles((prev) => prev.filter((file) => file.id !== fileId));
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

  // Message edit/delete handlers
  const handleStartEdit = useCallback((message: Message) => {
    setEditingMessageId(message.id);
    setEditContent(getTextContent(message.content));
  }, []);

  const handleCancelEdit = useCallback(() => {
    setEditingMessageId(null);
    setEditContent('');
  }, []);

  const handleConfirmEdit = useCallback(async () => {
    if (!editingMessageId || !activeConversationId || !editContent.trim()) return;

    let rollbackBranch:
      | {
          parentId: string | null;
          previousIndex: number;
        }
      | null = null;

    // Immediately switch branch selection to the new sibling so the edited message
    // appears in the active thread right away (before refetch).
    const originalMessage = messages?.find((message) => message.id === editingMessageId);
    if (originalMessage) {
      const parentId = originalMessage.parent_id ?? null;
      const branchKey = parentId ?? 'root';
      const siblings =
        messages?.filter((message) => (message.parent_id ?? null) === parentId) ?? [];
      const previousIndex = branchSelections[branchKey] ?? 0;
      const newIndex = siblings.length; // optimistic sibling appended at end

      rollbackBranch = { parentId, previousIndex };
      setBranchSelections((prev) => selectBranch(prev, parentId, newIndex));
    }

    try {
      await editMessageStreaming.editMessage({
        message_id: editingMessageId,
        conversation_id: activeConversationId,
        new_content: editContent.trim(),
      });
      setEditingMessageId(null);
      setEditContent('');
    } catch (error) {
      if (rollbackBranch) {
        setBranchSelections((prev) =>
          selectBranch(prev, rollbackBranch.parentId, rollbackBranch.previousIndex)
        );
      }
      toast.error('Failed to edit message');
      console.error('Edit message error:', error);
    }
  }, [
    editingMessageId,
    activeConversationId,
    editContent,
    editMessageStreaming,
    messages,
    branchSelections,
  ]);

  const handleDeleteMessage = useCallback(async () => {
    if (!deleteConfirmMessageId || !activeConversationId) return;
    
    try {
      await deleteMessage.mutateAsync({
        messageId: deleteConfirmMessageId,
        conversationId: activeConversationId,
      });
      setDeleteConfirmMessageId(null);
      toast.success('Message deleted');
    } catch (error) {
      toast.error('Failed to delete message');
      console.error('Delete message error:', error);
    }
  }, [deleteConfirmMessageId, activeConversationId, deleteMessage]);

  const handleBranchNavigate = useCallback((parentId: string | null, newIndex: number) => {
    setBranchSelections(prev => selectBranch(prev, parentId, newIndex));
  }, []);

  const renderedTimelineItems = useMemo(
    () =>
      chatTimelineItems.map((item) => {
        if (item.kind === 'run') {
          return (
            <div key={item.id} className="flex min-w-0 max-w-full justify-start overflow-hidden">
              <DirectToolRunCard run={item.run} />
            </div>
          );
        }
        if (item.kind === 'acceptance') {
          return (
            <div key={item.id} className="flex justify-start">
              <Card className="max-w-[80%] min-w-0 overflow-hidden p-0 bg-muted">
                <CardContent className="min-w-0 p-3">
                  <MarkdownContent
                    content={item.content}
                    className="min-w-0 max-w-full overflow-x-auto"
                  />
                </CardContent>
              </Card>
            </div>
          );
        }

        const message = item.message;
        const branchInfo = branchInfoMap.get(message.id);
        const isEditing = editingMessageId === message.id;
        const isUserMessage = message.role === 'user';
        const fileMarkers = extractFileMarkers(message.content);

        return (
          <div key={item.id} className="group min-w-0">
            <div
              className={cn(
                "flex min-w-0",
                isUserMessage ? 'justify-end' : 'justify-start'
              )}
            >
              <div className="relative min-w-0 max-w-[80%]">
                {/* Hover dropdown menu */}
                <div className={cn(
                  "absolute right-1 top-1 z-10 opacity-0 transition-opacity group-hover:opacity-100"
                )}>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-6 w-6">
                        <MoreHorizontal className="h-3 w-3" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align={isUserMessage ? "end" : "start"}>
                      {isUserMessage && (
                        <DropdownMenuItem onClick={() => handleStartEdit(message)}>
                          <Pencil className="h-4 w-4 mr-2" />
                          Edit
                        </DropdownMenuItem>
                      )}
                      {message.role === 'assistant' && userId ? (
                        <DropdownMenuSub>
                          <DropdownMenuSubTrigger>
                            Feedback
                          </DropdownMenuSubTrigger>
                          <DropdownMenuSubContent className="w-52">
                            <MessageFeedback
                              agentId={agentId}
                              conversationId={activeConversationId || ''}
                              messageId={message.id}
                              userId={userId}
                              selected={feedbackByMessage[message.id]}
                              mode="menu"
                            />
                          </DropdownMenuSubContent>
                        </DropdownMenuSub>
                      ) : null}
                      <DropdownMenuItem
                        variant="destructive"
                        onClick={() => setDeleteConfirmMessageId(message.id)}
                      >
                        <Trash2 className="h-4 w-4 mr-2" />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>

                <Card
                  className={cn(
                    "min-w-0 overflow-hidden p-0",
                    isUserMessage
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted'
                  )}
                >
                  <CardContent className="min-w-0 p-3 pr-10">
                    {isEditing ? (
                      /* Inline edit mode */
                      <div className="space-y-2">
                        <Textarea
                          value={editContent}
                          onChange={(e) => setEditContent(e.target.value)}
                          className="min-h-[60px] text-sm bg-background text-foreground"
                          placeholder="Edit your message..."
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === 'Escape') {
                              handleCancelEdit();
                            } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                              handleConfirmEdit();
                            }
                          }}
                        />
                        <div className="flex gap-1 justify-end">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={handleCancelEdit}
                            className="h-7 text-xs"
                          >
                            <X className="h-3 w-3 mr-1" />
                            Cancel
                          </Button>
                          <Button
                            size="sm"
                            onClick={handleConfirmEdit}
                            disabled={!editContent.trim() || editMessageStreaming.isStreaming}
                            className="h-7 text-xs"
                          >
                            {editMessageStreaming.isStreaming ? (
                              <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                            ) : (
                              <Check className="h-3 w-3 mr-1" />
                            )}
                            Save
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <>
                        {/* Render screenshot if present */}
                        <MessageImage content={message.content} />
                        {fileMarkers.length > 0 && (
                          <div className="mb-2 flex flex-wrap gap-2">
                            {fileMarkers.map((file) => (
                              <div
                                key={`${message.id}-${file.storagePath}`}
                                className="inline-flex items-center gap-1 rounded-md border bg-background/60 px-2 py-1 text-xs text-foreground"
                              >
                                <Paperclip className="h-3 w-3" />
                                <span className="max-w-[200px] truncate">{file.fileName}</span>
                                <span className="uppercase text-muted-foreground">{file.fileType}</span>
                              </div>
                            ))}
                          </div>
                        )}
                        {/* Render text content */}
                        {getTextContent(message.content) && (
                          <MarkdownContent
                            content={getTextContent(message.content)}
                            className="min-w-0 max-w-full overflow-x-auto"
                          />
                        )}
                        <div className="text-xs opacity-70 mt-2">
                          {new Date(message.created_at).toLocaleTimeString()}
                        </div>
                      </>
                    )}
                  </CardContent>
                </Card>

                {/* Branch navigation arrows */}
                {branchInfo && branchInfo.siblingCount > 1 && (
                  <div className={cn(
                    "flex items-center gap-1 mt-1",
                    isUserMessage ? "justify-end" : "justify-start"
                  )}>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-5 w-5"
                      disabled={branchInfo.currentIndex === 0}
                      onClick={() => handleBranchNavigate(branchInfo.parentId, branchInfo.currentIndex - 1)}
                    >
                      <ChevronLeft className="h-3 w-3" />
                    </Button>
                    <span className="text-xs text-muted-foreground">
                      {branchInfo.currentIndex + 1}/{branchInfo.siblingCount}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-5 w-5"
                      disabled={branchInfo.currentIndex === branchInfo.siblingCount - 1}
                      onClick={() => handleBranchNavigate(branchInfo.parentId, branchInfo.currentIndex + 1)}
                    >
                      <ChevronRight className="h-3 w-3" />
                    </Button>
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      }),
    [
      chatTimelineItems,
      branchInfoMap,
      editingMessageId,
      handleStartEdit,
      userId,
      agentId,
      activeConversationId,
      feedbackByMessage,
      editContent,
      editMessageStreaming.isStreaming,
      handleCancelEdit,
      handleConfirmEdit,
      handleBranchNavigate,
    ]
  );

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
    <div className="flex h-full min-h-0 w-full overflow-hidden">
      {/* History Sidebar - Always visible */}
      <div className="flex h-full min-h-0 w-64 shrink-0 flex-col overflow-hidden border-r bg-background">
        <div className="p-2 border-b shrink-0">
          <Button
            onClick={handleStartNewConversation}
            disabled={isComposingNewConversation || sendMessageStreaming.isStreaming || editMessageStreaming.isStreaming}
            className="w-full"
            variant="outline"
          >
            <Plus className="mr-2 h-4 w-4" />
            New Conversation
          </Button>
        </div>
        <div className="p-2 flex flex-col flex-1 min-h-0">
          <ScrollArea className="flex-1 min-h-0">
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
                          className="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
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
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {/* Messages */}
        <div className="flex min-h-0 flex-1 overflow-hidden">
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
          ) : ((chatTimelineItems.length > 0) || isActiveConversationStreaming || editMessageStreaming.isStreaming) ? (
            <ScrollArea className="h-full w-full">
              <div className="w-full min-w-0 space-y-4 px-4 pt-4">
                {renderedTimelineItems}
                {/* Streaming message display for edit */}
                {editMessageStreaming.isStreaming && editMessageStreaming.streamingContent && (
                  <div className="flex justify-start">
                    <Card className="max-w-[80%] min-w-0 overflow-hidden p-0 bg-muted">
                      <CardContent className="min-w-0 p-3">
                        <MarkdownContent
                          content={editMessageStreaming.streamingContent}
                          className="min-w-0 max-w-full overflow-x-auto"
                        />
                        <div className="flex items-center gap-2 mt-2">
                          <Loader2 className="h-3 w-3 animate-spin" />
                          <span className="text-xs opacity-70">AI is responding...</span>
                        </div>
                      </CardContent>
                    </Card>
                  </div>
                )}
                {/* Streaming message display for new message */}
                {isActiveConversationStreaming && (
                  <>
                    {sendMessageStreaming.streamingContent ? (
                      <div className="flex justify-start">
                        <Card className="max-w-[80%] min-w-0 overflow-hidden p-0 bg-muted">
                          <CardContent className="min-w-0 p-3">
                            <MarkdownContent
                              content={sendMessageStreaming.streamingContent}
                              className="min-w-0 max-w-full overflow-x-auto"
                            />
                            <div className="flex items-center gap-2 mt-2">
                              <Loader2 className="h-3 w-3 animate-spin" />
                              <span className="text-xs opacity-70">AI is typing...</span>
                            </div>
                          </CardContent>
                        </Card>
                      </div>
                    ) : (
                      <div className="flex justify-start">
                        <Card className="max-w-[80%] min-w-0 overflow-hidden p-0 bg-muted">
                          <CardContent className="min-w-0 p-3">
                            <div className="flex items-center gap-2">
                              <Loader2 className="h-3 w-3 animate-spin" />
                              <span className="text-xs opacity-70">AI is thinking...</span>
                            </div>
                          </CardContent>
                        </Card>
                      </div>
                    )}
                  </>
                )}
                <div ref={messagesEndRef} />
              </div>
            </ScrollArea>
          ) : (
            <div className="flex h-full w-full flex-1 flex-col items-center justify-center text-center text-muted-foreground">
              <MessageSquare className="h-12 w-12 mb-4 opacity-50" />
              <p className="text-lg font-medium">Start a conversation</p>
              <p className="text-sm">Send a message to chat with {agent.name}</p>
            </div>
          )}
        </div>

        {/* Message Input - Show when we have an active conversation or are composing a new one */}
        {(activeConversationId || isComposingNewConversation) && (
          <div className="shrink-0 border-t bg-background p-4">
            {showSlashCommands && filteredSlashCommands.length > 0 && (
              <div className="mb-3 max-h-40 w-full overflow-auto">
                {filteredSlashCommands.map((command) => (
                  <button
                    key={command.id}
                    type="button"
                    className="mb-1 w-full rounded-md border bg-card px-3 py-2 text-left transition-colors hover:bg-accent/60"
                    onClick={() => handleSelectSlashCommand(command)}
                  >
                    <div className="text-sm font-medium">{command.label}</div>
                    <div className="text-xs text-muted-foreground">{command.description}</div>
                  </button>
                ))}
              </div>
            )}
            {/* Pending Screenshot Preview */}
            {pendingScreenshot && (
              <div className="mb-3 flex w-full items-center gap-2 rounded-md bg-muted p-2">
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
            {pendingUserFiles.length > 0 && (
              <div className="mb-2 flex flex-wrap items-center gap-2">
                {pendingUserFiles.map((file) => (
                  <div
                    key={file.id}
                    className="inline-flex max-w-full items-center gap-2 rounded-md border bg-muted/60 px-2 py-1 text-xs"
                  >
                    <Paperclip className="h-3 w-3" />
                    <span className="max-w-[180px] truncate">{file.file_name}</span>
                    <span className="uppercase text-muted-foreground">{file.file_ext}</span>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-5 w-5"
                      onClick={() => clearPendingUserFile(file.id)}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
            {/* Message Input Row */}
            <div className="flex w-full gap-2">
              <MicrophoneButton
                agentId={agentId}
                userId={userId}
                onTranscription={handleTranscription}
                disabled={sendMessage.isPending || isDirectToolRunning}
                conversationId={activeConversationId || undefined}
              />
              <ScreenshotButton
                agentId={agentId}
                conversationId={activeConversationId || undefined}
                onScreenshot={handleScreenshot}
                disabled={sendMessage.isPending || isDirectToolRunning}
              />
              <AttachButton
                onAttach={handleAttachUserFile}
                disabled={sendMessage.isPending || isDirectToolRunning}
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
                    disabled={sendMessage.isPending || isDirectToolRunning}
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
                disabled={(!messageInput.trim() && !pendingScreenshot && pendingUserFiles.length === 0) || sendMessage.isPending || sendMessageStreaming.isStreaming || isDirectToolRunning}
                size="icon"
              >
                {isDirectToolRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Delete Message Confirmation Dialog */}
      <AlertDialog open={!!deleteConfirmMessageId} onOpenChange={(open) => !open && setDeleteConfirmMessageId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Message</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this message? If it's a user message, the AI's response will also be deleted. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteMessage}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
