import type { FastifyBaseLogger } from "fastify";
import { z } from "zod";

import type { RuntimeRunStore } from "../services/runtime-run-store.js";

type RuntimeReaperJob = {
  start(): void;
  stop(): void;
};

const RuntimeReaperEnvSchema = z.object({
  RUNTIME_REAPER_ENABLED: z.coerce.boolean().default(true),
  RUNTIME_REAPER_INTERVAL_SECONDS: z.coerce.number().int().min(5).max(3600).default(30),
  RUNTIME_REAPER_STALE_AFTER_SECONDS: z.coerce.number().int().min(30).max(86400).default(900),
  RUNTIME_REAPER_BATCH_LIMIT: z.coerce.number().int().min(1).max(1000).default(200)
});

export function createRuntimeReaperJob(
  logger: FastifyBaseLogger,
  runtimeRunStore: RuntimeRunStore
): RuntimeReaperJob {
  const env = RuntimeReaperEnvSchema.parse(process.env);
  let timer: ReturnType<typeof setInterval> | null = null;
  let running = false;

  const tick = async () => {
    if (running) {
      return;
    }
    running = true;
    try {
      const staleRunIds = await runtimeRunStore.findStaleRuns(
        env.RUNTIME_REAPER_STALE_AFTER_SECONDS,
        env.RUNTIME_REAPER_BATCH_LIMIT
      );
      for (const runId of staleRunIds) {
        await runtimeRunStore.transitionRunStatus(
          runId,
          "timed_out",
          "Run timed out by runtime reaper.",
          {
            source: "runtime_reaper",
            staleAfterSeconds: env.RUNTIME_REAPER_STALE_AFTER_SECONDS
          }
        );
      }
      if (staleRunIds.length > 0) {
        logger.warn(
          {
            staleRunCount: staleRunIds.length
          },
          "runtime reaper timed out stale runs"
        );
      }
    } catch (error) {
      logger.error({ error }, "runtime reaper tick failed");
    } finally {
      running = false;
    }
  };

  return {
    start() {
      if (!env.RUNTIME_REAPER_ENABLED || timer) {
        return;
      }
      timer = setInterval(() => {
        void tick();
      }, env.RUNTIME_REAPER_INTERVAL_SECONDS * 1000);
    },
    stop() {
      if (!timer) {
        return;
      }
      clearInterval(timer);
      timer = null;
    }
  };
}
