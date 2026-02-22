import { z } from "zod";

export const RuntimeExecutionModeSchema = z.enum(["remote", "local_docker"]);
export type RuntimeExecutionMode = z.infer<typeof RuntimeExecutionModeSchema>;

export const RuntimeRunStatusSchema = z.enum([
  "queued",
  "preparing",
  "running",
  "succeeded",
  "failed",
  "timed_out",
  "cancelled"
]);
export type RuntimeRunStatus = z.infer<typeof RuntimeRunStatusSchema>;

export const CreateRuntimeRunRequestSchema = z.object({
  skillId: z.string().trim().min(1),
  version: z.string().trim().min(1).optional(),
  agentId: z.string().uuid().optional(),
  input: z.record(z.string(), z.unknown()).optional().default({}),
  messageContext: z
    .object({
      userMessage: z.string().trim().min(1),
      source: z.string().trim().optional(),
      conversationId: z.string().uuid().optional()
    })
    .optional(),
  attachments: z
    .array(
      z.object({
        storagePath: z.string().trim().min(1),
        fileName: z.string().trim().optional(),
        fileType: z.string().trim().optional(),
        sizeBytes: z.number().int().min(1).max(5 * 1024 * 1024).optional()
      })
    )
    .optional(),
  attachmentContent: z
    .array(
      z.object({
        storagePath: z.string().trim().min(1),
        fileType: z.string().trim().optional(),
        contentExcerpt: z.string().optional(),
        summary: z.string().optional(),
        truncated: z.boolean().optional(),
        sizeBytes: z.number().int().min(1).max(5 * 1024 * 1024).optional()
      })
    )
    .optional(),
  executionMode: RuntimeExecutionModeSchema.optional().default("remote"),
  timeoutSeconds: z.number().int().min(1).max(3600).optional().default(120)
});
export type CreateRuntimeRunRequest = z.infer<typeof CreateRuntimeRunRequestSchema>;

export const RuntimeRunEventSchema = z.object({
  eventId: z.string().uuid(),
  runId: z.string().uuid(),
  sequence: z.number().int().nonnegative(),
  type: z.enum(["state_transition", "log", "policy_block"]),
  status: RuntimeRunStatusSchema.optional(),
  message: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  timestamp: z.string().datetime()
});
export type RuntimeRunEvent = z.infer<typeof RuntimeRunEventSchema>;

export const RuntimeRunSummarySchema = z.object({
  runId: z.string().uuid(),
  userId: z.string().uuid(),
  skillId: z.string().trim().min(1),
  version: z.string().trim().min(1),
  agentId: z.string().uuid().nullable(),
  executionMode: RuntimeExecutionModeSchema,
  status: RuntimeRunStatusSchema,
  timeoutSeconds: z.number().int().min(1).max(3600),
  input: z.record(z.string(), z.unknown()),
  output: z.record(z.string(), z.unknown()).nullable(),
  error: z
    .object({
      code: z.string(),
      message: z.string()
    })
    .nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  startedAt: z.string().datetime().nullable(),
  finishedAt: z.string().datetime().nullable()
});
export type RuntimeRunSummary = z.infer<typeof RuntimeRunSummarySchema>;

export const RuntimeRunEventsQuerySchema = z.object({
  cursor: z.coerce.number().int().min(0).optional().default(0),
  limit: z.coerce.number().int().min(1).max(500).optional().default(100)
});
export type RuntimeRunEventsQuery = z.infer<typeof RuntimeRunEventsQuerySchema>;
