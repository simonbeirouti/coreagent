import { randomUUID } from "node:crypto";

export type RuntimeExecutionMode = "remote" | "local_docker";

export type RuntimeRunStatus =
  | "queued"
  | "preparing"
  | "running"
  | "succeeded"
  | "failed"
  | "timed_out"
  | "cancelled";

export type RuntimeRunError = {
  code: string;
  message: string;
};

export type RuntimeRunEvent = {
  eventId: string;
  runId: string;
  sequence: number;
  type: "state_transition" | "log" | "policy_block";
  status?: RuntimeRunStatus;
  message?: string;
  metadata?: Record<string, unknown>;
  timestamp: string;
};

export type RuntimeRunRecord = {
  runId: string;
  userId: string;
  skillId: string;
  version: string;
  agentId: string | null;
  executionMode: RuntimeExecutionMode;
  timeoutSeconds: number;
  input: Record<string, unknown>;
  output: Record<string, unknown> | null;
  error: RuntimeRunError | null;
  status: RuntimeRunStatus;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  queueJobId: string | null;
};

export type RuntimeRunEventsPage = {
  events: RuntimeRunEvent[];
  nextCursor: string | null;
  hasMore: boolean;
};

export type CreateRuntimeRunInput = {
  userId: string;
  skillId: string;
  version: string;
  agentId: string | null;
  executionMode: RuntimeExecutionMode;
  timeoutSeconds: number;
  input: Record<string, unknown>;
};

export interface RuntimeRunStore {
  createRun(input: CreateRuntimeRunInput): Promise<RuntimeRunRecord>;
  setQueueJobId(runId: string, queueJobId: string): Promise<RuntimeRunRecord | null>;
  getRun(runId: string): Promise<RuntimeRunRecord | null>;
  listEvents(runId: string, cursor: number, limit: number): Promise<RuntimeRunEventsPage | null>;
  cancelRun(runId: string): Promise<RuntimeRunRecord | null>;
  transitionRunStatus(
    runId: string,
    status: RuntimeRunStatus,
    message: string,
    metadata?: Record<string, unknown>
  ): Promise<RuntimeRunRecord | null>;
  markSucceeded(runId: string, output: Record<string, unknown> | null): Promise<RuntimeRunRecord | null>;
  markFailed(runId: string, error: RuntimeRunError): Promise<RuntimeRunRecord | null>;
  appendLogEvent(runId: string, message: string, metadata?: Record<string, unknown>): Promise<boolean>;
  findStaleRuns(maxAgeSeconds: number, limit: number): Promise<string[]>;
  findRunIdByQueueJobId(queueJobId: string): Promise<string | null>;
  close(): Promise<void>;
}

type RunEntity = RuntimeRunRecord & {
  events: RuntimeRunEvent[];
  nextSequence: number;
};

export class InMemoryRuntimeRunStore implements RuntimeRunStore {
  private readonly runs = new Map<string, RunEntity>();

  public async createRun(input: CreateRuntimeRunInput): Promise<RuntimeRunRecord> {
    const timestamp = new Date().toISOString();
    const runId = randomUUID();
    const run: RunEntity = {
      runId,
      userId: input.userId,
      skillId: input.skillId,
      version: input.version,
      agentId: input.agentId,
      executionMode: input.executionMode,
      timeoutSeconds: input.timeoutSeconds,
      input: input.input,
      output: null,
      error: null,
      status: "queued",
      createdAt: timestamp,
      updatedAt: timestamp,
      startedAt: null,
      finishedAt: null,
      queueJobId: null,
      events: [],
      nextSequence: 0
    };

    this.runs.set(runId, run);
    this.appendEvent(runId, {
      type: "state_transition",
      status: "queued",
      message: "Run queued."
    });
    return this.toRecord(run);
  }

  public async setQueueJobId(runId: string, queueJobId: string): Promise<RuntimeRunRecord | null> {
    const run = this.runs.get(runId);
    if (!run) {
      return null;
    }

    run.queueJobId = queueJobId;
    run.updatedAt = new Date().toISOString();
    return this.toRecord(run);
  }

  public async getRun(runId: string): Promise<RuntimeRunRecord | null> {
    const run = this.runs.get(runId);
    return run ? this.toRecord(run) : null;
  }

  public async listEvents(runId: string, cursor: number, limit: number): Promise<RuntimeRunEventsPage | null> {
    const run = this.runs.get(runId);
    if (!run) {
      return null;
    }

    const safeCursor = Math.max(0, cursor);
    const events = run.events.slice(safeCursor, safeCursor + limit);
    const nextCursor = safeCursor + events.length;
    const hasMore = nextCursor < run.events.length;

    return {
      events: events.map((event) => ({ ...event })),
      nextCursor: hasMore ? String(nextCursor) : null,
      hasMore
    };
  }

  public async cancelRun(runId: string): Promise<RuntimeRunRecord | null> {
    const run = this.runs.get(runId);
    if (!run) {
      return null;
    }

    if (this.isTerminalStatus(run.status)) {
      return this.toRecord(run);
    }

    const now = new Date().toISOString();
    run.status = "cancelled";
    run.updatedAt = now;
    run.finishedAt = now;
    this.appendEvent(runId, {
      type: "state_transition",
      status: "cancelled",
      message: "Run cancelled."
    });

    return this.toRecord(run);
  }

  public async transitionRunStatus(
    runId: string,
    status: RuntimeRunStatus,
    message: string,
    metadata?: Record<string, unknown>
  ): Promise<RuntimeRunRecord | null> {
    const run = this.runs.get(runId);
    if (!run) {
      return null;
    }

    if (this.isTerminalStatus(run.status)) {
      return this.toRecord(run);
    }

    const now = new Date().toISOString();
    run.status = status;
    run.updatedAt = now;
    if (status === "running" && !run.startedAt) {
      run.startedAt = now;
    }
    if (this.isTerminalStatus(status)) {
      run.finishedAt = now;
    }

    this.appendEvent(runId, {
      type: "state_transition",
      status,
      message,
      ...(metadata ? { metadata } : {})
    });

    return this.toRecord(run);
  }

  public async markSucceeded(
    runId: string,
    output: Record<string, unknown> | null
  ): Promise<RuntimeRunRecord | null> {
    const run = this.runs.get(runId);
    if (!run) {
      return null;
    }

    if (this.isTerminalStatus(run.status)) {
      return this.toRecord(run);
    }

    const now = new Date().toISOString();
    run.status = "succeeded";
    run.output = output;
    run.error = null;
    run.updatedAt = now;
    run.finishedAt = now;
    if (!run.startedAt) {
      run.startedAt = now;
    }

    this.appendEvent(runId, {
      type: "state_transition",
      status: "succeeded",
      message: "Run succeeded."
    });

    return this.toRecord(run);
  }

  public async markFailed(runId: string, error: RuntimeRunError): Promise<RuntimeRunRecord | null> {
    const run = this.runs.get(runId);
    if (!run) {
      return null;
    }

    if (this.isTerminalStatus(run.status)) {
      return this.toRecord(run);
    }

    const now = new Date().toISOString();
    run.status = "failed";
    run.error = error;
    run.updatedAt = now;
    run.finishedAt = now;
    if (!run.startedAt) {
      run.startedAt = now;
    }

    this.appendEvent(runId, {
      type: "state_transition",
      status: "failed",
      message: error.message,
      metadata: {
        code: error.code
      }
    });

    return this.toRecord(run);
  }

  public async appendLogEvent(
    runId: string,
    message: string,
    metadata?: Record<string, unknown>
  ): Promise<boolean> {
    const run = this.runs.get(runId);
    if (!run) {
      return false;
    }
    if (this.isTerminalStatus(run.status)) {
      return false;
    }

    this.appendEvent(runId, {
      type: "log",
      message,
      ...(metadata ? { metadata } : {})
    });
    run.updatedAt = new Date().toISOString();
    return true;
  }

  public async findRunIdByQueueJobId(queueJobId: string): Promise<string | null> {
    for (const run of this.runs.values()) {
      if (run.queueJobId === queueJobId) {
        return run.runId;
      }
    }
    return null;
  }

  public async findStaleRuns(maxAgeSeconds: number, limit: number): Promise<string[]> {
    const nowMs = Date.now();
    const staleThresholdMs = maxAgeSeconds * 1000;
    const runIds: string[] = [];

    for (const run of this.runs.values()) {
      if (run.status !== "queued" && run.status !== "preparing" && run.status !== "running") {
        continue;
      }
      const startedAtMs = Date.parse(run.createdAt);
      if (Number.isNaN(startedAtMs)) {
        continue;
      }
      if (nowMs - startedAtMs < staleThresholdMs) {
        continue;
      }
      runIds.push(run.runId);
      if (runIds.length >= limit) {
        break;
      }
    }

    return runIds;
  }

  public async close(): Promise<void> {}

  private appendEvent(
    runId: string,
    input: Omit<RuntimeRunEvent, "eventId" | "runId" | "sequence" | "timestamp">
  ): void {
    const run = this.runs.get(runId);
    if (!run) {
      return;
    }

    const event: RuntimeRunEvent = {
      eventId: randomUUID(),
      runId,
      sequence: run.nextSequence,
      type: input.type,
      timestamp: new Date().toISOString(),
      ...(input.status ? { status: input.status } : {}),
      ...(input.message ? { message: input.message } : {}),
      ...(input.metadata ? { metadata: input.metadata } : {})
    };

    run.events.push(event);
    run.nextSequence += 1;
  }

  private isTerminalStatus(status: RuntimeRunStatus): boolean {
    return status === "succeeded" || status === "failed" || status === "timed_out" || status === "cancelled";
  }

  private toRecord(run: RunEntity): RuntimeRunRecord {
    return {
      runId: run.runId,
      userId: run.userId,
      skillId: run.skillId,
      version: run.version,
      agentId: run.agentId,
      executionMode: run.executionMode,
      timeoutSeconds: run.timeoutSeconds,
      input: { ...run.input },
      output: run.output ? { ...run.output } : null,
      error: run.error ? { ...run.error } : null,
      status: run.status,
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      queueJobId: run.queueJobId
    };
  }
}
