import { useEffect, useState } from 'react';

export type RuntimeExecutionMode = 'remote' | 'local_docker';
export type RuntimeRunStatus = 'running' | 'succeeded' | 'failed' | 'timed_out' | 'cancelled';

export type RuntimeRunConsoleEvent = {
  id: string;
  clientRunId: string;
  implementationKey: string;
  message: string;
  sequence: number;
  timestampMs: number;
  source: 'direct' | 'inferred';
  runId?: string | null;
  status?: string | null;
  agentId?: string;
  conversationId?: string;
  executionMode?: RuntimeExecutionMode;
  fallbackFromMode?: RuntimeExecutionMode;
};

type RuntimeRunContext = {
  agentId?: string;
  conversationId?: string;
};

const MAX_EVENT_BUFFER = 1500;
const subscribers = new Set<(events: RuntimeRunConsoleEvent[]) => void>();
const runContextByClientId = new Map<string, RuntimeRunContext>();
const seenEventKeys = new Set<string>();
let eventBuffer: RuntimeRunConsoleEvent[] = [];

function emit(): void {
  for (const subscriber of subscribers) {
    subscriber(eventBuffer);
  }
}

function toEventKey(event: RuntimeRunConsoleEvent): string {
  return [
    event.source,
    event.clientRunId,
    event.sequence,
    event.timestampMs,
    event.message,
    event.runId ?? '',
    event.status ?? '',
  ].join('::');
}

function applyContext(event: RuntimeRunConsoleEvent): RuntimeRunConsoleEvent {
  const context = runContextByClientId.get(event.clientRunId);
  if (!context) return event;
  return {
    ...event,
    agentId: event.agentId ?? context.agentId,
    conversationId: event.conversationId ?? context.conversationId,
  };
}

export function registerRuntimeRunContext(clientRunId: string, context: RuntimeRunContext): void {
  if (!clientRunId) return;
  const existing = runContextByClientId.get(clientRunId);
  runContextByClientId.set(clientRunId, {
    agentId: context.agentId ?? existing?.agentId,
    conversationId: context.conversationId ?? existing?.conversationId,
  });
}

export function appendRuntimeRunConsoleEvents(incoming: RuntimeRunConsoleEvent[]): void {
  if (incoming.length === 0) return;

  const normalized: RuntimeRunConsoleEvent[] = [];
  for (const item of incoming) {
    const withContext = applyContext(item);
    const key = toEventKey(withContext);
    if (seenEventKeys.has(key)) continue;
    seenEventKeys.add(key);
    normalized.push(withContext);
  }
  if (normalized.length === 0) return;

  eventBuffer = [...eventBuffer, ...normalized].sort((a, b) => {
    if (a.timestampMs === b.timestampMs) return a.sequence - b.sequence;
    return a.timestampMs - b.timestampMs;
  });
  if (eventBuffer.length > MAX_EVENT_BUFFER) {
    const overflow = eventBuffer.length - MAX_EVENT_BUFFER;
    const removed = eventBuffer.splice(0, overflow);
    for (const item of removed) {
      seenEventKeys.delete(toEventKey(item));
    }
  }
  emit();
}

export function clearRuntimeRunConsoleEvents(): void {
  eventBuffer = [];
  seenEventKeys.clear();
  emit();
}

export function useRuntimeRunConsole() {
  const [events, setEvents] = useState<RuntimeRunConsoleEvent[]>(eventBuffer);

  useEffect(() => {
    const subscriber = (next: RuntimeRunConsoleEvent[]) => setEvents(next);
    subscribers.add(subscriber);
    return () => {
      subscribers.delete(subscriber);
    };
  }, []);

  return {
    events,
    clearEvents: clearRuntimeRunConsoleEvents,
  };
}
