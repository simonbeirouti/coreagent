import { Queue, QueueEvents } from "bullmq";
import { z } from "zod";
import type { FastifyBaseLogger } from "fastify";

import type { RuntimeExecutionMode, RuntimeRunStore } from "./runtime-run-store.js";

function isRedisProtocol(value: string): boolean {
  try {
    const protocol = new URL(value).protocol;
    return protocol === "redis:" || protocol === "rediss:";
  } catch {
    return false;
  }
}

const RuntimeQueueEnvSchema = z.object({
  ENABLE_RUNTIME_QUEUE: z.coerce.boolean().default(false),
  REDIS_URL: z
    .string()
    .url()
    .refine(isRedisProtocol, "REDIS_URL must use redis:// or rediss://")
    .default("redis://127.0.0.1:6379"),
  RUNTIME_RUN_QUEUE_NAME: z.string().trim().min(1).default("runtime-runs"),
  RUNTIME_RUN_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(3),
  RUNTIME_RUN_RETRY_BACKOFF_MS: z.coerce.number().int().min(0).max(60_000).default(1_000),
  RUNTIME_AUTOSCALE_MIN_REPLICAS: z.coerce.number().int().min(1).max(200).default(1),
  RUNTIME_AUTOSCALE_MAX_REPLICAS: z.coerce.number().int().min(1).max(200).default(20),
  RUNTIME_AUTOSCALE_TARGET_CONCURRENCY_PER_REPLICA: z.coerce.number().int().min(1).max(200).default(4)
});

type RuntimeQueueEnv = z.infer<typeof RuntimeQueueEnvSchema>;

type EnqueueRuntimeRunInput = {
  runId: string;
  userId: string;
  skillId: string;
  version: string;
  executionMode: RuntimeExecutionMode;
  timeoutSeconds: number;
  input: Record<string, unknown>;
  skillRuntime: {
    runtimeType: "command" | "http" | "wasm";
    entrypoint: string;
    artifactUri: string | null;
    digest: string;
    runtimeProfile?: string | null;
  };
  requestedPermissions: Array<{
    permissionKey: string;
    required: boolean;
    permissionScope: Record<string, unknown>;
  }>;
};

function parseQueueEnv(): RuntimeQueueEnv {
  return RuntimeQueueEnvSchema.parse(process.env);
}

function parseReturnValue(returnValue?: string): Record<string, unknown> | null {
  if (!returnValue) {
    return null;
  }

  try {
    const parsed = JSON.parse(returnValue) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return {
      result: parsed
    };
  } catch {
    return {
      result: returnValue
    };
  }
}

export type RuntimeQueueService = {
  readonly enabled: boolean;
  getHealth(): Promise<{
    enabled: boolean;
    queueName: string;
    status: "disabled" | "ok" | "failed";
    redisProtocol: "redis" | "rediss" | "unknown";
    queuedJobs: number | null;
    activeJobs: number | null;
    delayedJobs: number | null;
    waitingJobs: number | null;
    failedJobs: number | null;
    autoscaling: {
      minReplicas: number;
      maxReplicas: number;
      targetConcurrencyPerReplica: number;
      recommendedReplicas: number | null;
      reasoning: string;
    };
    message: string | null;
  }>;
  enqueueRun(input: EnqueueRuntimeRunInput): Promise<{ jobId: string }>;
  cancelRunByJobId(jobId: string): Promise<{ cancelledInQueue: boolean; active: boolean }>;
  close(): Promise<void>;
};

export function computeAutoscalingRecommendation(input: {
  queuedJobs: number;
  activeJobs: number;
  minReplicas: number;
  maxReplicas: number;
  targetConcurrencyPerReplica: number;
}): number {
  const normalizedMin = Math.max(1, input.minReplicas);
  const normalizedMax = Math.max(normalizedMin, input.maxReplicas);
  const targetConcurrency = Math.max(1, input.targetConcurrencyPerReplica);
  const totalDemand = Math.max(0, input.queuedJobs) + Math.max(0, input.activeJobs);
  const desired = Math.ceil(totalDemand / targetConcurrency);
  return Math.min(normalizedMax, Math.max(normalizedMin, desired));
}

export function createRuntimeQueueService(
  logger: FastifyBaseLogger,
  runStore: RuntimeRunStore
): RuntimeQueueService {
  const env = parseQueueEnv();
  if (!env.ENABLE_RUNTIME_QUEUE) {
    return {
      enabled: false,
      async getHealth() {
        return {
          enabled: false,
          queueName: env.RUNTIME_RUN_QUEUE_NAME,
          status: "disabled",
          redisProtocol: env.REDIS_URL.startsWith("rediss://")
            ? "rediss"
            : env.REDIS_URL.startsWith("redis://")
              ? "redis"
              : "unknown",
          queuedJobs: null,
          activeJobs: null,
          delayedJobs: null,
          waitingJobs: null,
          failedJobs: null,
          autoscaling: {
            minReplicas: env.RUNTIME_AUTOSCALE_MIN_REPLICAS,
            maxReplicas: env.RUNTIME_AUTOSCALE_MAX_REPLICAS,
            targetConcurrencyPerReplica: env.RUNTIME_AUTOSCALE_TARGET_CONCURRENCY_PER_REPLICA,
            recommendedReplicas: null,
            reasoning: "Runtime queue is disabled."
          },
          message: "Runtime queue is disabled."
        };
      },
      async enqueueRun() {
        throw new Error("Runtime queue is disabled.");
      },
      async cancelRunByJobId() {
        return { cancelledInQueue: false, active: false };
      },
      async close() {}
    };
  }

  const queue = new Queue(env.RUNTIME_RUN_QUEUE_NAME, {
    connection: {
      url: env.REDIS_URL,
      enableReadyCheck: false,
      connectTimeout: 10_000,
      keepAlive: 30_000,
      retryStrategy(times) {
        return Math.min(times * 200, 2_000);
      },
      maxRetriesPerRequest: null
    }
  });
  const queueEvents = new QueueEvents(env.RUNTIME_RUN_QUEUE_NAME, {
    connection: {
      url: env.REDIS_URL,
      enableReadyCheck: false,
      connectTimeout: 10_000,
      keepAlive: 30_000,
      retryStrategy(times) {
        return Math.min(times * 200, 2_000);
      },
      maxRetriesPerRequest: null
    }
  });

  queueEvents.on("active", ({ jobId }) => {
    void (async () => {
      try {
        const runId = await runStore.findRunIdByQueueJobId(jobId);
        if (!runId) {
          return;
        }
        await runStore.transitionRunStatus(runId, "running", "Run started on runner.", {
          queueJobId: jobId
        });
      } catch (error) {
        logger.error({ error, jobId }, "failed to process runtime queue active event");
      }
    });
  });

  queueEvents.on("completed", ({ jobId, returnvalue }) => {
    void (async () => {
      try {
        const runId = await runStore.findRunIdByQueueJobId(jobId);
        if (!runId) {
          return;
        }
        await runStore.markSucceeded(runId, parseReturnValue(returnvalue));
      } catch (error) {
        logger.error({ error, jobId }, "failed to process runtime queue completed event");
      }
    })();
  });

  queueEvents.on("progress", ({ jobId, data }) => {
    void (async () => {
      try {
        const runId = await runStore.findRunIdByQueueJobId(jobId);
        if (!runId) {
          return;
        }
        if (!data || typeof data !== "object" || Array.isArray(data)) {
          return;
        }
        const payload = data as Record<string, unknown>;
        const type = typeof payload.type === "string" ? payload.type : null;
        if (type !== "log") {
          return;
        }
        const message = typeof payload.message === "string" ? payload.message : null;
        if (!message || message.trim().length === 0) {
          return;
        }
        await runStore.appendLogEvent(runId, message, {
          queueJobId: jobId,
          source: "runner",
          ...(typeof payload.stream === "string" ? { stream: payload.stream } : {}),
          ...(typeof payload.timestamp === "string" ? { timestamp: payload.timestamp } : {})
        });
      } catch (error) {
        logger.error({ error, jobId }, "failed to process runtime queue progress event");
      }
    })();
  });

  queueEvents.on("failed", ({ jobId, failedReason }) => {
    void (async () => {
      try {
        const runId = await runStore.findRunIdByQueueJobId(jobId);
        if (!runId) {
          return;
        }

        const reason = failedReason ?? "Runtime run failed in queue worker.";
        const timedOut = /timed?\s*out|timeout/i.test(reason);
        if (timedOut) {
          await runStore.transitionRunStatus(runId, "timed_out", reason, {
            failureSource: "runtime_queue"
          });
          return;
        }
        const permissionDenied = reason.includes("PERMISSION_BROKER_DENY:");
        if (permissionDenied) {
          const brokerReason = reason.replace("PERMISSION_BROKER_DENY:", "").trim();
          await runStore.markFailed(runId, {
            code: "runtime_permission_denied",
            message: brokerReason.length > 0 ? brokerReason : "Runtime permission broker denied run."
          });
          return;
        }
        const credentialDenied = reason.includes("CREDENTIAL_BROKER_DENY:");
        if (credentialDenied) {
          const brokerReason = reason.replace("CREDENTIAL_BROKER_DENY:", "").trim();
          await runStore.markFailed(runId, {
            code: "runtime_credential_denied",
            message: brokerReason.length > 0 ? brokerReason : "Runtime credential broker denied run."
          });
          return;
        }
        const localDockerDenied = reason.includes("LOCAL_DOCKER_DENY:");
        if (localDockerDenied) {
          const brokerReason = reason.replace("LOCAL_DOCKER_DENY:", "").trim();
          await runStore.markFailed(runId, {
            code: "runtime_local_docker_denied",
            message: brokerReason.length > 0 ? brokerReason : "Local Docker execution was denied."
          });
          return;
        }
        const localDockerFailed = reason.includes("LOCAL_DOCKER_FAILED:");
        if (localDockerFailed) {
          const failureReason = reason.replace("LOCAL_DOCKER_FAILED:", "").trim();
          await runStore.markFailed(runId, {
            code: "runtime_local_docker_failed",
            message: failureReason.length > 0 ? failureReason : "Local Docker execution failed."
          });
          return;
        }
        await runStore.markFailed(runId, {
          code: "runtime_queue_failed",
          message: reason
        });
      } catch (error) {
        logger.error({ error, jobId }, "failed to process runtime queue failed event");
      }
    })();
  });

  queueEvents.on("error", (error) => {
    logger.error({ error }, "runtime queue event listener failed");
  });

  return {
    enabled: true,
    async getHealth() {
      try {
        const counts = await queue.getJobCounts("wait", "active", "delayed", "failed");
        const waitingJobsCount = counts.wait ?? 0;
        const delayedJobsCount = counts.delayed ?? 0;
        const activeJobs = counts.active ?? 0;
        const failedJobsCount = counts.failed ?? 0;
        const queuedJobs = waitingJobsCount + delayedJobsCount;
        const recommendedReplicas = computeAutoscalingRecommendation({
          queuedJobs,
          activeJobs,
          minReplicas: env.RUNTIME_AUTOSCALE_MIN_REPLICAS,
          maxReplicas: env.RUNTIME_AUTOSCALE_MAX_REPLICAS,
          targetConcurrencyPerReplica: env.RUNTIME_AUTOSCALE_TARGET_CONCURRENCY_PER_REPLICA
        });
        return {
          enabled: true,
          queueName: env.RUNTIME_RUN_QUEUE_NAME,
          status: "ok",
          redisProtocol: env.REDIS_URL.startsWith("rediss://")
            ? "rediss"
            : env.REDIS_URL.startsWith("redis://")
              ? "redis"
              : "unknown",
          queuedJobs,
          activeJobs,
          delayedJobs: delayedJobsCount,
          waitingJobs: waitingJobsCount,
          failedJobs: failedJobsCount,
          autoscaling: {
            minReplicas: env.RUNTIME_AUTOSCALE_MIN_REPLICAS,
            maxReplicas: env.RUNTIME_AUTOSCALE_MAX_REPLICAS,
            targetConcurrencyPerReplica: env.RUNTIME_AUTOSCALE_TARGET_CONCURRENCY_PER_REPLICA,
            recommendedReplicas,
            reasoning:
              recommendedReplicas > env.RUNTIME_AUTOSCALE_MIN_REPLICAS
                ? "Queue pressure above baseline capacity."
                : "Queue pressure within baseline capacity."
          },
          message: null
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed runtime queue health check.";
        return {
          enabled: true,
          queueName: env.RUNTIME_RUN_QUEUE_NAME,
          status: "failed",
          redisProtocol: env.REDIS_URL.startsWith("rediss://")
            ? "rediss"
            : env.REDIS_URL.startsWith("redis://")
              ? "redis"
              : "unknown",
          queuedJobs: null,
          activeJobs: null,
          delayedJobs: null,
          waitingJobs: null,
          failedJobs: null,
          autoscaling: {
            minReplicas: env.RUNTIME_AUTOSCALE_MIN_REPLICAS,
            maxReplicas: env.RUNTIME_AUTOSCALE_MAX_REPLICAS,
            targetConcurrencyPerReplica: env.RUNTIME_AUTOSCALE_TARGET_CONCURRENCY_PER_REPLICA,
            recommendedReplicas: null,
            reasoning: "No recommendation available while queue health is failed."
          },
          message
        };
      }
    },
    async enqueueRun(input) {
      const jobOptions: {
        removeOnComplete: number;
        removeOnFail: number;
        attempts: number;
        timeout: number;
        backoff?: {
          type: "exponential";
          delay: number;
        };
      } = {
        removeOnComplete: 1000,
        removeOnFail: 1000,
        attempts: env.RUNTIME_RUN_MAX_ATTEMPTS,
        timeout: input.timeoutSeconds * 1000
      };
      if (env.RUNTIME_RUN_RETRY_BACKOFF_MS > 0) {
        jobOptions.backoff = {
          type: "exponential",
          delay: env.RUNTIME_RUN_RETRY_BACKOFF_MS
        };
      }
      const job = await queue.add("runtime.run", input, jobOptions);

      const jobId = String(job.id ?? "");
      if (jobId.length === 0) {
        throw new Error("Queue returned empty job id.");
      }

      return { jobId };
    },
    async cancelRunByJobId(jobId) {
      const job = await queue.getJob(jobId);
      if (!job) {
        return { cancelledInQueue: false, active: false };
      }

      const state = await job.getState();
      if (state === "waiting" || state === "delayed" || state === "prioritized") {
        await job.remove();
        return { cancelledInQueue: true, active: false };
      }

      if (state === "active") {
        return { cancelledInQueue: false, active: true };
      }

      return { cancelledInQueue: false, active: false };
    },
    async close() {
      await queueEvents.close();
      await queue.close();
    }
  };
}
