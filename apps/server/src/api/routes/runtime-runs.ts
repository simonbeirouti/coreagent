import type { FastifyPluginAsync } from "fastify";
import type { Pool } from "pg";
import { z } from "zod";

import type { AppEnv } from "../../security/env.js";
import { resolveUserIdFromRequest } from "../../security/request-auth.js";
import type { RuntimeQueueService } from "../../services/runtime-queue.js";
import type { RuntimeRunStore } from "../../services/runtime-run-store.js";

const createRunBodySchema = z.object({
  skillId: z.string().trim().min(1),
  version: z.string().trim().min(1).optional().default("latest"),
  agentId: z.string().uuid().optional(),
  input: z.record(z.string(), z.unknown()).optional().default({}),
  messageContext: z
    .object({
      userMessage: z.string().trim().min(1).max(32_000),
      source: z.string().trim().max(128).optional(),
      conversationId: z.string().uuid().optional()
    })
    .optional(),
  attachments: z
    .array(
      z.object({
        storagePath: z.string().trim().min(1).max(512),
        fileName: z.string().trim().min(1).max(256).optional(),
        fileType: z.string().trim().min(1).max(32).optional(),
        sizeBytes: z.coerce.number().int().min(1).max(5 * 1024 * 1024).optional()
      })
    )
    .max(10)
    .optional(),
  attachmentContent: z
    .array(
      z.object({
        storagePath: z.string().trim().min(1).max(512),
        fileType: z.string().trim().min(1).max(32).optional(),
        contentExcerpt: z.string().max(64_000).optional(),
        summary: z.string().max(16_000).optional(),
        truncated: z.boolean().optional(),
        sizeBytes: z.coerce.number().int().min(1).max(5 * 1024 * 1024).optional()
      })
    )
    .max(10)
    .optional(),
  executionMode: z.enum(["remote", "local_docker"]).optional().default("remote"),
  timeoutSeconds: z.coerce.number().int().min(1).max(3600).optional().default(120)
});

const runIdParamsSchema = z.object({
  runId: z.string().uuid()
});

const runEventsQuerySchema = z.object({
  cursor: z.coerce.number().int().min(0).optional().default(0),
  limit: z.coerce.number().int().min(1).max(500).optional().default(100)
});

type RuntimeRunRoutesOptions = {
  env: AppEnv;
  dbPool: Pool | null;
  runtimeRunStore: RuntimeRunStore;
  runtimeQueue: RuntimeQueueService;
};

function parseOrBadRequest<T>(
  schema: z.ZodType<T>,
  payload: unknown,
  reply: { code: (statusCode: number) => { send: (body: unknown) => unknown } }
): T | null {
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    reply.code(400).send({
      message: "Invalid request payload.",
      issues: parsed.error.issues
    });
    return null;
  }
  return parsed.data;
}

export const runtimeRunRoutes: FastifyPluginAsync<RuntimeRunRoutesOptions> = async (app, options) => {
  app.post("/v1/runtime/runs", async (request, reply) => {
    const user = await resolveUserIdFromRequest(request.headers as Record<string, unknown>, options.env);
    if (!user.ok) {
      return reply.code(user.statusCode).send({ message: user.message });
    }

    const body = parseOrBadRequest(createRunBodySchema, request.body, reply);
    if (!body) {
      return;
    }
    const enrichedInput: Record<string, unknown> = {
      ...body.input
    };
    if (body.messageContext) {
      enrichedInput.messageContext = body.messageContext;
    }
    if (body.attachments) {
      enrichedInput.attachments = body.attachments;
    }
    if (body.attachmentContent) {
      enrichedInput.attachmentContent = body.attachmentContent;
    }

    let run;
    try {
      run = await options.runtimeRunStore.createRun({
        userId: user.userId,
        skillId: body.skillId,
        version: body.version,
        agentId: body.agentId ?? null,
        executionMode: body.executionMode,
        timeoutSeconds: body.timeoutSeconds,
        input: enrichedInput
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to create runtime run.";
      return reply.code(404).send({ message });
    }

    if (options.runtimeQueue.enabled) {
      try {
        const permissionRows = options.dbPool
          ? await options.dbPool.query<{
              permissionKey: string;
              required: boolean;
              permissionScope: Record<string, unknown>;
            }>(
              `
                SELECT
                  sp.permission_key AS "permissionKey",
                  sp.required AS "required",
                  sp.permission_scope AS "permissionScope"
                FROM skill_permissions sp
                JOIN skill_versions sv ON sv.id = sp.skill_version_id
                JOIN skills s ON s.id = sv.skill_ref_id
                WHERE s.skill_id = $1::text
                  AND sv.version = $2::text
                ORDER BY sp.permission_key ASC
              `,
              [run.skillId, run.version]
            )
          : { rows: [] };

        const runtimeRow = options.dbPool
          ? await options.dbPool.query<{
              runtimeType: "command" | "http" | "wasm";
              entrypoint: string;
              artifactUri: string | null;
              digest: string;
              runtimeProfile: string | null;
            }>(
              `
                SELECT
                  sv.runtime AS "runtimeType",
                  sv.entrypoint AS "entrypoint",
                  sv.artifact_uri AS "artifactUri",
                  sv.digest AS "digest",
                  sv.manifest ->> 'runtime_profile' AS "runtimeProfile"
                FROM skill_versions sv
                JOIN skills s ON s.id = sv.skill_ref_id
                WHERE s.skill_id = $1::text
                  AND sv.version = $2::text
                LIMIT 1
              `,
              [run.skillId, run.version]
            )
          : { rows: [] };
        const skillRuntime = runtimeRow.rows[0];
        if (!skillRuntime) {
          throw new Error(`Skill runtime metadata not found: ${run.skillId}@${run.version}`);
        }

        const messageContext =
          run.input && typeof run.input.messageContext === "object" && run.input.messageContext
            ? (run.input.messageContext as Record<string, unknown>)
            : null;
        const attachments =
          run.input && Array.isArray(run.input.attachments)
            ? (run.input.attachments as Record<string, unknown>[])
            : null;
        const attachmentContent =
          run.input && Array.isArray(run.input.attachmentContent)
            ? (run.input.attachmentContent as Record<string, unknown>[])
            : null;

        const queueResult = await options.runtimeQueue.enqueueRun({
          runId: run.runId,
          userId: run.userId,
          skillId: run.skillId,
          version: run.version,
          executionMode: run.executionMode,
          timeoutSeconds: run.timeoutSeconds,
          input: run.input,
          ...(messageContext ? { messageContext } : {}),
          ...(attachments ? { attachments } : {}),
          ...(attachmentContent ? { attachmentContent } : {}),
          skillRuntime,
          requestedPermissions: permissionRows.rows
        });
        await options.runtimeRunStore.setQueueJobId(run.runId, queueResult.jobId);
        await options.runtimeRunStore.transitionRunStatus(run.runId, "preparing", "Run accepted by runtime queue.", {
          queueJobId: queueResult.jobId
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to enqueue runtime run.";
        await options.runtimeRunStore.markFailed(run.runId, {
          code: "runtime_queue_enqueue_failed",
          message
        });
        return reply.code(503).send({
          message: "Runtime queue is unavailable.",
          data: await options.runtimeRunStore.getRun(run.runId)
        });
      }
    }
    return reply.code(201).send({
      data: await options.runtimeRunStore.getRun(run.runId)
    });
  });

  app.get("/v1/runtime/runs/:runId", async (request, reply) => {
    const user = await resolveUserIdFromRequest(request.headers as Record<string, unknown>, options.env);
    if (!user.ok) {
      return reply.code(user.statusCode).send({ message: user.message });
    }

    const params = parseOrBadRequest(runIdParamsSchema, request.params, reply);
    if (!params) {
      return;
    }
    const { runId } = params;
    const run = await options.runtimeRunStore.getRun(runId);
    if (!run || run.userId !== user.userId) {
      return reply.code(404).send({ message: "Run not found." });
    }

    return {
      data: run
    };
  });

  app.get("/v1/runtime/runs/:runId/events", async (request, reply) => {
    const user = await resolveUserIdFromRequest(request.headers as Record<string, unknown>, options.env);
    if (!user.ok) {
      return reply.code(user.statusCode).send({ message: user.message });
    }

    const params = parseOrBadRequest(runIdParamsSchema, request.params, reply);
    if (!params) {
      return;
    }
    const { runId } = params;
    const run = await options.runtimeRunStore.getRun(runId);
    if (!run || run.userId !== user.userId) {
      return reply.code(404).send({ message: "Run not found." });
    }

    const query = parseOrBadRequest(runEventsQuerySchema, request.query, reply);
    if (!query) {
      return;
    }
    const { cursor, limit } = query;
    const events = await options.runtimeRunStore.listEvents(runId, cursor, limit);
    if (!events) {
      return reply.code(404).send({ message: "Run not found." });
    }

    return {
      data: events.events,
      page: {
        nextCursor: events.nextCursor,
        hasMore: events.hasMore
      }
    };
  });

  app.post("/v1/runtime/runs/:runId/cancel", async (request, reply) => {
    const user = await resolveUserIdFromRequest(request.headers as Record<string, unknown>, options.env);
    if (!user.ok) {
      return reply.code(user.statusCode).send({ message: user.message });
    }

    const params = parseOrBadRequest(runIdParamsSchema, request.params, reply);
    if (!params) {
      return;
    }
    const { runId } = params;
    const run = await options.runtimeRunStore.getRun(runId);
    if (!run || run.userId !== user.userId) {
      return reply.code(404).send({ message: "Run not found." });
    }

    const cancelledRun = await options.runtimeRunStore.cancelRun(runId);
    if (!cancelledRun) {
      return reply.code(404).send({ message: "Run not found." });
    }

    const queueCancelResult =
      cancelledRun.queueJobId && options.runtimeQueue.enabled
        ? await options.runtimeQueue.cancelRunByJobId(cancelledRun.queueJobId)
        : { cancelledInQueue: false, active: false };

    return {
      data: {
        ...cancelledRun,
        cancellation: {
          cancelledInQueue: queueCancelResult.cancelledInQueue,
          activeAtCancelRequest: queueCancelResult.active
        }
      }
    };
  });
};
