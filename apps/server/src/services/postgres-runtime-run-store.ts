import { createHash, randomUUID } from "node:crypto";

import { Redis } from "ioredis";
import type { FastifyBaseLogger } from "fastify";
import type { Pool } from "pg";
import { z } from "zod";

import type {
  CreateRuntimeRunInput,
  RuntimeRunError,
  RuntimeRunEvent,
  RuntimeRunEventsPage,
  RuntimeRunRecord,
  RuntimeRunStatus,
  RuntimeRunStore
} from "./runtime-run-store.js";

const RedisConfigSchema = z.object({
  REDIS_URL: z
    .string()
    .optional(),
  ENABLE_RUNTIME_REDIS_CACHE: z.coerce.boolean().default(true)
});

type RuntimeStoreMetadata = {
  executionMode: RuntimeRunRecord["executionMode"];
  timeoutSeconds: number;
  input: Record<string, unknown>;
  output?: Record<string, unknown> | null | undefined;
  queueJobId?: string | null | undefined;
  updatedAt?: string | undefined;
};

type SkillVersionRow = {
  skillRefId: string;
  skillId: string;
  version: string;
  skillVersionId: string;
};

type RunRow = {
  runId: string;
  userId: string;
  skillRefId: string;
  skillVersionId: string | null;
  skillId: string;
  version: string;
  agentId: string | null;
  status: RuntimeRunStatus;
  metadata: Record<string, unknown>;
  errorClass: string | null;
  errorMessage: string | null;
  createdAt: string;
  completedAt: string | null;
};

function computeInputHash(input: Record<string, unknown>): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

function nowIso(): string {
  return new Date().toISOString();
}

function toMetadata(record: RuntimeRunRecord): RuntimeStoreMetadata {
  return {
    executionMode: record.executionMode,
    timeoutSeconds: record.timeoutSeconds,
    input: record.input,
    output: record.output,
    queueJobId: record.queueJobId,
    updatedAt: record.updatedAt
  };
}

function parseMetadata(metadata: Record<string, unknown>): RuntimeStoreMetadata {
  const parsed = z
    .object({
      executionMode: z.enum(["remote", "local_docker"]).default("remote"),
      timeoutSeconds: z.number().int().min(1).max(3600).default(120),
      input: z.record(z.string(), z.unknown()).default({}),
      output: z.record(z.string(), z.unknown()).nullable().optional(),
      queueJobId: z.string().optional().nullable(),
      updatedAt: z.string().datetime().optional()
    })
    .safeParse(metadata);

  if (!parsed.success) {
    return {
      executionMode: "remote",
      timeoutSeconds: 120,
      input: {}
    };
  }

  return parsed.data;
}

function runCacheKey(runId: string): string {
  return `runtime:run:${runId}`;
}

function runEventsKey(runId: string): string {
  return `runtime:run:${runId}:events`;
}

function queueJobMapKey(jobId: string): string {
  return `runtime:queue-job:${jobId}`;
}

export class PostgresRedisRuntimeRunStore implements RuntimeRunStore {
  private readonly redis: Redis | null;

  public constructor(
    private readonly dbPool: Pool,
    private readonly logger: FastifyBaseLogger
  ) {
    const redisConfig = RedisConfigSchema.parse(process.env);
    this.redis = redisConfig.REDIS_URL
      && redisConfig.ENABLE_RUNTIME_REDIS_CACHE
      ? new Redis(redisConfig.REDIS_URL, {
          enableReadyCheck: false,
          connectTimeout: 10_000,
          keepAlive: 30_000,
          retryStrategy(times) {
            return Math.min(times * 200, 2_000);
          },
          maxRetriesPerRequest: null
        })
      : null;

    this.redis?.on("error", (error: unknown) => {
      if (
        error instanceof Error &&
        ("code" in error) &&
        (error as NodeJS.ErrnoException).code &&
        ["ECONNRESET", "ETIMEDOUT", "EPIPE", "ECONNREFUSED"].includes(
          String((error as NodeJS.ErrnoException).code)
        )
      ) {
        this.logger.warn({ error }, "runtime redis cache transient connection issue (will retry)");
        return;
      }
      this.logger.error({ error }, "runtime redis cache error");
    });
  }

  public async createRun(input: CreateRuntimeRunInput): Promise<RuntimeRunRecord> {
    const resolved = await this.resolveSkillVersion(input.skillId, input.version);
    if (!resolved) {
      throw new Error(`Skill version not found or not installable: ${input.skillId}@${input.version}`);
    }

    const createdAt = nowIso();
    const metadata: RuntimeStoreMetadata = {
      executionMode: input.executionMode,
      timeoutSeconds: input.timeoutSeconds,
      input: input.input,
      output: null,
      queueJobId: null,
      updatedAt: createdAt
    };

    const created = await this.dbPool.query<{
      runId: string;
      createdAt: string;
    }>(
      `
        INSERT INTO skill_runs (
          id,
          user_id,
          agent_id,
          skill_ref_id,
          skill_version_id,
          input_hash,
          status,
          metadata,
          started_at
        )
        VALUES (
          gen_random_uuid(),
          $1::uuid,
          $2::uuid,
          $3::uuid,
          $4::uuid,
          $5::text,
          'queued',
          $6::jsonb,
          NOW()
        )
        RETURNING id::text AS "runId", started_at::text AS "createdAt"
      `,
      [
        input.userId,
        input.agentId,
        resolved.skillRefId,
        resolved.skillVersionId,
        computeInputHash(input.input),
        JSON.stringify(metadata)
      ]
    );

    const row = created.rows[0];
    if (!row) {
      throw new Error("Failed to create runtime run.");
    }

    const record: RuntimeRunRecord = {
      runId: row.runId,
      userId: input.userId,
      skillId: resolved.skillId,
      version: resolved.version,
      agentId: input.agentId,
      executionMode: input.executionMode,
      timeoutSeconds: input.timeoutSeconds,
      input: input.input,
      output: null,
      error: null,
      status: "queued",
      createdAt: row.createdAt,
      updatedAt: row.createdAt,
      startedAt: null,
      finishedAt: null,
      queueJobId: null
    };

    await this.appendEvent(record.runId, {
      type: "state_transition",
      status: "queued",
      message: "Run queued."
    });
    await this.cacheRun(record);
    return record;
  }

  public async setQueueJobId(runId: string, queueJobId: string): Promise<RuntimeRunRecord | null> {
    const current = await this.getRun(runId);
    if (!current) {
      return null;
    }

    const updatedAt = nowIso();
    const metadata = toMetadata({
      ...current,
      queueJobId,
      updatedAt
    });

    await this.dbPool.query(
      `
        UPDATE skill_runs
        SET metadata = $2::jsonb
        WHERE id = $1::uuid
      `,
      [runId, JSON.stringify(metadata)]
    );

    const updated = {
      ...current,
      queueJobId,
      updatedAt
    };
    await this.cacheRun(updated);
    await this.redis?.set(queueJobMapKey(queueJobId), runId, "EX", 60 * 60 * 24);
    return updated;
  }

  public async getRun(runId: string): Promise<RuntimeRunRecord | null> {
    const cached = await this.getCachedRun(runId);
    if (cached) {
      return cached;
    }

    const row = await this.fetchRunRow(runId);
    if (!row) {
      return null;
    }

    const record = this.toRecord(row);
    await this.cacheRun(record);
    return record;
  }

  public async listEvents(runId: string, cursor: number, limit: number): Promise<RuntimeRunEventsPage | null> {
    const safeCursor = Math.max(0, cursor);
    const cachedPage = await this.getCachedEvents(runId, safeCursor, limit);
    if (cachedPage) {
      return cachedPage;
    }

    const rows = await this.dbPool.query<{
      eventId: string;
      runId: string;
      sequence: number;
      type: "state_transition" | "log" | "policy_block";
      status: RuntimeRunStatus | null;
      message: string | null;
      metadata: Record<string, unknown>;
      timestamp: string;
    }>(
      `
        SELECT
          sre.id::text AS "eventId",
          sre.skill_run_id::text AS "runId",
          sre.sequence AS "sequence",
          sre.event_type AS "type",
          sre.status AS "status",
          sre.message AS "message",
          sre.metadata AS "metadata",
          sre.created_at::text AS "timestamp"
        FROM skill_run_events sre
        WHERE sre.skill_run_id = $1::uuid
          AND sre.sequence >= $2::int
        ORDER BY sre.sequence ASC
        LIMIT $3::int
      `,
      [runId, safeCursor, limit + 1]
    );

    if (rows.rowCount === 0) {
      const exists = await this.dbPool.query<{ exists: boolean }>(
        `
          SELECT EXISTS(
            SELECT 1 FROM skill_runs WHERE id = $1::uuid
          ) AS "exists"
        `,
        [runId]
      );
      if (!exists.rows[0]?.exists) {
        return null;
      }
    }

    const hasMore = rows.rows.length > limit;
    const pageRows = hasMore ? rows.rows.slice(0, limit) : rows.rows;
    const events: RuntimeRunEvent[] = pageRows.map((row) => ({
      eventId: row.eventId,
      runId: row.runId,
      sequence: row.sequence,
      type: row.type,
      timestamp: row.timestamp,
      ...(row.status ? { status: row.status } : {}),
      ...(row.message ? { message: row.message } : {}),
      ...(row.metadata ? { metadata: row.metadata } : {})
    }));

    const nextCursor = safeCursor + events.length;
    return {
      events,
      nextCursor: hasMore ? String(nextCursor) : null,
      hasMore
    };
  }

  public async cancelRun(runId: string): Promise<RuntimeRunRecord | null> {
    const current = await this.getRun(runId);
    if (!current) {
      return null;
    }

    if (this.isTerminalStatus(current.status)) {
      return current;
    }

    const finishedAt = nowIso();
    const updatedAt = finishedAt;
    const metadata = toMetadata({
      ...current,
      updatedAt
    });

    await this.dbPool.query(
      `
        UPDATE skill_runs
        SET
          status = 'cancelled',
          completed_at = NOW(),
          metadata = $2::jsonb
        WHERE id = $1::uuid
      `,
      [runId, JSON.stringify(metadata)]
    );

    await this.appendEvent(runId, {
      type: "state_transition",
      status: "cancelled",
      message: "Run cancelled."
    });

    const updated: RuntimeRunRecord = {
      ...current,
      status: "cancelled",
      updatedAt,
      finishedAt
    };
    await this.recordSkillHealthEvent(runId, "degraded", "Run cancelled.", {
      runtimeStatus: "cancelled"
    });
    await this.cacheRun(updated);
    return updated;
  }

  public async transitionRunStatus(
    runId: string,
    status: RuntimeRunStatus,
    message: string,
    metadata?: Record<string, unknown>
  ): Promise<RuntimeRunRecord | null> {
    const current = await this.getRun(runId);
    if (!current) {
      return null;
    }

    if (this.isTerminalStatus(current.status)) {
      return current;
    }

    const updatedAt = nowIso();
    const startedAt = status === "running" && !current.startedAt ? updatedAt : current.startedAt;
    const finishedAt = this.isTerminalStatus(status) ? updatedAt : current.finishedAt;
    const nextMetadata = toMetadata({
      ...current,
      status,
      updatedAt,
      startedAt,
      finishedAt
    });

    await this.dbPool.query(
      `
        UPDATE skill_runs
        SET
          status = $2::text,
          completed_at = CASE
            WHEN $2::text IN ('succeeded', 'failed', 'timed_out', 'cancelled') THEN NOW()
            ELSE completed_at
          END,
          metadata = $3::jsonb
        WHERE id = $1::uuid
      `,
      [runId, status, JSON.stringify(nextMetadata)]
    );

    await this.appendEvent(runId, {
      type: "state_transition",
      status,
      message,
      ...(metadata ? { metadata } : {})
    });

    const updated: RuntimeRunRecord = {
      ...current,
      status,
      updatedAt,
      startedAt,
      finishedAt
    };
    if (status === "running") {
      await this.recordSkillHealthEvent(runId, "healthy", "Run started.", {
        runtimeStatus: "running"
      });
    }
    if (status === "timed_out") {
      await this.recordSkillHealthEvent(runId, "unhealthy", "Run timed out.", {
        runtimeStatus: "timed_out"
      });
    }
    await this.cacheRun(updated);
    return updated;
  }

  public async markSucceeded(runId: string, output: Record<string, unknown> | null): Promise<RuntimeRunRecord | null> {
    const current = await this.getRun(runId);
    if (!current) {
      return null;
    }

    if (this.isTerminalStatus(current.status)) {
      return current;
    }

    const finishedAt = nowIso();
    const updatedAt = finishedAt;
    const startedAt = current.startedAt ?? updatedAt;
    const nextMetadata = toMetadata({
      ...current,
      output,
      status: "succeeded",
      startedAt,
      updatedAt,
      finishedAt
    });

    await this.dbPool.query(
      `
        UPDATE skill_runs
        SET
          status = 'succeeded',
          output_summary = $2::text,
          error_class = NULL,
          error_message = NULL,
          completed_at = NOW(),
          metadata = $3::jsonb
        WHERE id = $1::uuid
      `,
      [runId, output ? JSON.stringify(output).slice(0, 1000) : null, JSON.stringify(nextMetadata)]
    );

    await this.appendEvent(runId, {
      type: "state_transition",
      status: "succeeded",
      message: "Run succeeded."
    });

    const updated: RuntimeRunRecord = {
      ...current,
      status: "succeeded",
      output,
      error: null,
      startedAt,
      updatedAt,
      finishedAt
    };
    await this.recordSkillHealthEvent(runId, "healthy", "Run succeeded.", {
      runtimeStatus: "succeeded"
    });
    await this.cacheRun(updated);
    return updated;
  }

  public async markFailed(runId: string, error: RuntimeRunError): Promise<RuntimeRunRecord | null> {
    const current = await this.getRun(runId);
    if (!current) {
      return null;
    }

    if (this.isTerminalStatus(current.status)) {
      return current;
    }

    const finishedAt = nowIso();
    const updatedAt = finishedAt;
    const startedAt = current.startedAt ?? updatedAt;
    const nextMetadata = toMetadata({
      ...current,
      status: "failed",
      startedAt,
      updatedAt,
      finishedAt
    });

    await this.dbPool.query(
      `
        UPDATE skill_runs
        SET
          status = 'failed',
          error_class = $2::text,
          error_message = $3::text,
          completed_at = NOW(),
          metadata = $4::jsonb
        WHERE id = $1::uuid
      `,
      [runId, error.code, error.message, JSON.stringify(nextMetadata)]
    );

    await this.appendEvent(runId, {
      type: "state_transition",
      status: "failed",
      message: error.message,
      metadata: {
        code: error.code
      }
    });

    const updated: RuntimeRunRecord = {
      ...current,
      status: "failed",
      error,
      startedAt,
      updatedAt,
      finishedAt
    };
    await this.recordSkillHealthEvent(runId, "unhealthy", "Run failed.", {
      runtimeStatus: "failed",
      errorCode: error.code
    });
    await this.cacheRun(updated);
    return updated;
  }

  public async appendLogEvent(
    runId: string,
    message: string,
    metadata?: Record<string, unknown>
  ): Promise<boolean> {
    const current = await this.getRun(runId);
    if (!current) {
      return false;
    }
    if (this.isTerminalStatus(current.status)) {
      return false;
    }

    await this.appendEvent(runId, {
      type: "log",
      message,
      ...(metadata ? { metadata } : {})
    });
    return true;
  }

  public async findStaleRuns(maxAgeSeconds: number, limit: number): Promise<string[]> {
    const rows = await this.dbPool.query<{ runId: string }>(
      `
        SELECT sr.id::text AS "runId"
        FROM skill_runs sr
        WHERE sr.status IN ('queued', 'preparing', 'running')
          AND sr.started_at < NOW() - ($1::text || ' seconds')::interval
        ORDER BY sr.started_at ASC
        LIMIT $2::int
      `,
      [String(maxAgeSeconds), limit]
    );

    return rows.rows.map((row) => row.runId);
  }

  public async findRunIdByQueueJobId(queueJobId: string): Promise<string | null> {
    const cachedRunId = await this.redis?.get(queueJobMapKey(queueJobId));
    if (cachedRunId) {
      return cachedRunId;
    }

    const lookup = await this.dbPool.query<{ runId: string }>(
      `
        SELECT sr.id::text AS "runId"
        FROM skill_runs sr
        WHERE sr.metadata ->> 'queueJobId' = $1::text
        ORDER BY sr.started_at DESC
        LIMIT 1
      `,
      [queueJobId]
    );

    const runId = lookup.rows[0]?.runId ?? null;
    if (runId) {
      await this.redis?.set(queueJobMapKey(queueJobId), runId, "EX", 60 * 60 * 24);
    }
    return runId;
  }

  public async close(): Promise<void> {
    if (!this.redis) {
      return;
    }

    await this.redis.quit();
  }

  private async appendEvent(
    runId: string,
    event: Omit<RuntimeRunEvent, "eventId" | "runId" | "sequence" | "timestamp">
  ): Promise<void> {
    const sequenceResult = await this.dbPool.query<{ nextSequence: number }>(
      `
        SELECT COALESCE(MAX(sequence), -1) + 1 AS "nextSequence"
        FROM skill_run_events
        WHERE skill_run_id = $1::uuid
      `,
      [runId]
    );
    const nextSequence = sequenceResult.rows[0]?.nextSequence ?? 0;

    const insertResult = await this.dbPool.query<{
      eventId: string;
      timestamp: string;
    }>(
      `
        INSERT INTO skill_run_events (
          id,
          skill_run_id,
          user_id,
          sequence,
          event_type,
          status,
          message,
          metadata
        )
        VALUES (
          gen_random_uuid(),
          $1::uuid,
          (SELECT user_id FROM skill_runs WHERE id = $1::uuid),
          $2::int,
          $3::text,
          $4::text,
          $5::text,
          $6::jsonb
        )
        RETURNING id::text AS "eventId", created_at::text AS "timestamp"
      `,
      [
        runId,
        nextSequence,
        event.type,
        event.status ?? null,
        event.message ?? null,
        JSON.stringify(event.metadata ?? {})
      ]
    );

    const row = insertResult.rows[0];
    if (!row) {
      return;
    }

    const eventRecord: RuntimeRunEvent = {
      eventId: row.eventId,
      runId,
      sequence: nextSequence,
      type: event.type,
      timestamp: row.timestamp,
      ...(event.status ? { status: event.status } : {}),
      ...(event.message ? { message: event.message } : {}),
      ...(event.metadata ? { metadata: event.metadata } : {})
    };
    await this.redis?.rpush(runEventsKey(runId), JSON.stringify(eventRecord));
    await this.redis?.expire(runEventsKey(runId), 60 * 60 * 24);
  }

  private async resolveSkillVersion(skillId: string, requestedVersion: string): Promise<SkillVersionRow | null> {
    const rows = requestedVersion === "latest"
      ? await this.dbPool.query<SkillVersionRow>(
          `
            SELECT
              s.id::text AS "skillRefId",
              s.skill_id AS "skillId",
              sv.version AS "version",
              sv.id::text AS "skillVersionId"
            FROM skills s
            JOIN skill_versions sv ON sv.skill_ref_id = s.id
            WHERE s.skill_id = $1::text
              AND s.status <> 'disabled'
              AND sv.policy_status = 'approved'
              AND sv.revoked_at IS NULL
            ORDER BY COALESCE(sv.published_at, sv.created_at) DESC
            LIMIT 1
          `,
          [skillId]
        )
      : await this.dbPool.query<SkillVersionRow>(
          `
            SELECT
              s.id::text AS "skillRefId",
              s.skill_id AS "skillId",
              sv.version AS "version",
              sv.id::text AS "skillVersionId"
            FROM skills s
            JOIN skill_versions sv ON sv.skill_ref_id = s.id
            WHERE s.skill_id = $1::text
              AND s.status <> 'disabled'
              AND sv.version = $2::text
              AND sv.policy_status = 'approved'
              AND sv.revoked_at IS NULL
            LIMIT 1
          `,
          [skillId, requestedVersion]
        );

    return rows.rows[0] ?? null;
  }

  private async fetchRunRow(runId: string): Promise<RunRow | null> {
    const result = await this.dbPool.query<RunRow>(
      `
        SELECT
          sr.id::text AS "runId",
          sr.user_id::text AS "userId",
          sr.skill_ref_id::text AS "skillRefId",
          sr.skill_version_id::text AS "skillVersionId",
          s.skill_id AS "skillId",
          COALESCE(sv.version, 'unknown') AS "version",
          sr.agent_id::text AS "agentId",
          sr.status AS "status",
          sr.metadata AS "metadata",
          sr.error_class AS "errorClass",
          sr.error_message AS "errorMessage",
          sr.started_at::text AS "createdAt",
          sr.completed_at::text AS "completedAt"
        FROM skill_runs sr
        JOIN skills s ON s.id = sr.skill_ref_id
        LEFT JOIN skill_versions sv ON sv.id = sr.skill_version_id
        WHERE sr.id = $1::uuid
        LIMIT 1
      `,
      [runId]
    );

    return result.rows[0] ?? null;
  }

  private async recordSkillHealthEvent(
    runId: string,
    status: "healthy" | "degraded" | "unhealthy" | "disabled" | "revoked",
    summary: string,
    details: Record<string, unknown>
  ): Promise<void> {
    await this.dbPool.query(
      `
        INSERT INTO skill_health_events (
          id,
          user_id,
          agent_id,
          skill_ref_id,
          skill_version_id,
          skill_install_id,
          status,
          summary,
          details,
          observed_at
        )
        SELECT
          gen_random_uuid(),
          sr.user_id,
          sr.agent_id,
          sr.skill_ref_id,
          sr.skill_version_id,
          sr.skill_install_id,
          $2::text,
          $3::text,
          $4::jsonb,
          NOW()
        FROM skill_runs sr
        WHERE sr.id = $1::uuid
      `,
      [runId, status, summary, JSON.stringify(details)]
    );
  }

  private toRecord(row: RunRow): RuntimeRunRecord {
    const metadata = parseMetadata(row.metadata ?? {});
    const updatedAt = metadata.updatedAt ?? row.completedAt ?? row.createdAt;
    const startedAt = row.status === "queued" || row.status === "preparing" ? null : row.createdAt;

    return {
      runId: row.runId,
      userId: row.userId,
      skillId: row.skillId,
      version: row.version,
      agentId: row.agentId,
      executionMode: metadata.executionMode,
      timeoutSeconds: metadata.timeoutSeconds,
      input: metadata.input,
      output: metadata.output ?? null,
      error:
        row.errorClass && row.errorMessage
          ? {
              code: row.errorClass,
              message: row.errorMessage
            }
          : null,
      status: row.status,
      createdAt: row.createdAt,
      updatedAt,
      startedAt,
      finishedAt: row.completedAt,
      queueJobId: metadata.queueJobId ?? null
    };
  }

  private async cacheRun(record: RuntimeRunRecord): Promise<void> {
    await this.redis?.set(runCacheKey(record.runId), JSON.stringify(record), "EX", 60 * 60 * 24);
  }

  private async getCachedRun(runId: string): Promise<RuntimeRunRecord | null> {
    const cached = await this.redis?.get(runCacheKey(runId));
    if (!cached) {
      return null;
    }

    const parsed = z
      .object({
        runId: z.string().uuid(),
        userId: z.string().uuid(),
        skillId: z.string(),
        version: z.string(),
        agentId: z.string().uuid().nullable(),
        executionMode: z.enum(["remote", "local_docker"]),
        timeoutSeconds: z.number().int(),
        input: z.record(z.string(), z.unknown()),
        output: z.record(z.string(), z.unknown()).nullable(),
        error: z
          .object({
            code: z.string(),
            message: z.string()
          })
          .nullable(),
        status: z.enum(["queued", "preparing", "running", "succeeded", "failed", "timed_out", "cancelled"]),
        createdAt: z.string().datetime(),
        updatedAt: z.string().datetime(),
        startedAt: z.string().datetime().nullable(),
        finishedAt: z.string().datetime().nullable(),
        queueJobId: z.string().nullable()
      })
      .safeParse(JSON.parse(cached));

    return parsed.success ? parsed.data : null;
  }

  private async getCachedEvents(
    runId: string,
    cursor: number,
    limit: number
  ): Promise<RuntimeRunEventsPage | null> {
    if (!this.redis) {
      return null;
    }

    const end = cursor + limit;
    const [items, totalCount] = await Promise.all([
      this.redis.lrange(runEventsKey(runId), cursor, end),
      this.redis.llen(runEventsKey(runId))
    ]);
    if (items.length === 0) {
      return null;
    }

    const parsedEvents = items
      .map((item: string) => {
        try {
          return JSON.parse(item) as RuntimeRunEvent;
        } catch {
          return null;
        }
      })
      .filter((event: RuntimeRunEvent | null): event is RuntimeRunEvent => Boolean(event))
      .slice(0, limit);
    const nextCursor = cursor + parsedEvents.length;
    const hasMore = nextCursor < totalCount;

    return {
      events: parsedEvents,
      nextCursor: hasMore ? String(nextCursor) : null,
      hasMore
    };
  }

  private isTerminalStatus(status: RuntimeRunStatus): boolean {
    return status === "succeeded" || status === "failed" || status === "timed_out" || status === "cancelled";
  }
}
