import type { FastifyBaseLogger } from "fastify";

interface AdvisorySyncJob {
  start(): void;
  stop(): void;
}

export function createAdvisorySyncJob(logger: FastifyBaseLogger): AdvisorySyncJob {
  let timer: ReturnType<typeof setInterval> | null = null;

  return {
    start() {
      if (timer) {
        return;
      }

      timer = setInterval(() => {
        logger.debug("advisory sync heartbeat");
      }, 60_000);
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
