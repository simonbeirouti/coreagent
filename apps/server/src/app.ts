import { randomUUID } from "node:crypto";

import compress from "@fastify/compress";
import cors from "@fastify/cors";
import Fastify, { type FastifyInstance } from "fastify";

import { createAdvisorySyncJob } from "./jobs/advisory-sync.job.js";
import { createRuntimeReaperJob } from "./jobs/runtime-reaper.job.js";
import { adminSkillRoutes } from "./api/routes/admin-skills.js";
import { healthRoutes } from "./api/routes/health.js";
import { runtimeRunRoutes } from "./api/routes/runtime-runs.js";
import { skillRoutes } from "./api/routes/skills.js";
import { createDbPool } from "./repositories/db.js";
import { PostgresSkillRepository } from "./repositories/postgres-skill-repository.js";
import { InMemorySkillRepository } from "./repositories/skill-repository.js";
import type { AppEnv } from "./security/env.js";
import { LocalArtifactStore } from "./services/artifact-store.js";
import { HeuristicArtifactScanner, NoopArtifactScanner } from "./services/artifact-scanner.js";
import { MetricsService } from "./services/metrics-service.js";
import { PostgresRedisRuntimeRunStore } from "./services/postgres-runtime-run-store.js";
import { createRuntimeQueueService } from "./services/runtime-queue.js";
import { InMemoryRateLimiter } from "./services/rate-limiter.js";
import { InMemoryRuntimeRunStore, type RuntimeRunStore } from "./services/runtime-run-store.js";
import { HmacSignatureService } from "./services/signature-service.js";

export function buildApp(env: AppEnv): FastifyInstance {
  const app = Fastify({
    genReqId: () => randomUUID(),
    logger: {
      level: env.LOG_LEVEL
    }
  });

  const dbPool = createDbPool(env);
  const skillRepository = dbPool ? new PostgresSkillRepository(dbPool) : new InMemorySkillRepository();
  const artifactStore = new LocalArtifactStore(env.ARTIFACT_STORAGE_DIR, env.ARTIFACT_MAX_BYTES);
  const artifactScanner = env.ENABLE_HEURISTIC_ARTIFACT_SCANNER
    ? new HeuristicArtifactScanner()
    : new NoopArtifactScanner();
  const signatureService = new HmacSignatureService(env.SIGNING_SECRET, env.SIGNING_KEY_ID);
  const metrics = new MetricsService();
  const rateLimiter = new InMemoryRateLimiter(
    env.PUBLIC_API_RATE_LIMIT_MAX,
    env.PUBLIC_API_RATE_LIMIT_WINDOW_SECONDS * 1000
  );
  const runtimeRunStore: RuntimeRunStore = dbPool
    ? new PostgresRedisRuntimeRunStore(dbPool, app.log)
    : new InMemoryRuntimeRunStore();
  const runtimeQueue = createRuntimeQueueService(app.log, runtimeRunStore);

  const advisorySyncJob = createAdvisorySyncJob(app.log);
  const runtimeReaperJob = createRuntimeReaperJob(app.log, runtimeRunStore);

  app.addHook("onReady", async () => {
    if (dbPool) {
      app.log.info("skills repository: postgres");
    } else {
      app.log.warn("skills repository: in-memory fallback (DATABASE_URL not configured)");
    }
    if (runtimeQueue.enabled) {
      app.log.info("runtime queue: enabled");
    } else {
      app.log.warn("runtime queue: disabled (set ENABLE_RUNTIME_QUEUE=true to enable)");
    }
    advisorySyncJob.start();
    runtimeReaperJob.start();
  });

  app.addHook("onClose", async () => {
    advisorySyncJob.stop();
    runtimeReaperJob.stop();
    await runtimeQueue.close();
    await runtimeRunStore.close();
    if (dbPool) {
      await dbPool.end();
    }
  });

  app.addHook("onRequest", async (request, reply) => {
    const correlationId = request.id;
    reply.header("x-correlation-id", correlationId);
    request.log = request.log.child({ correlationId });
    request.log.info(
      {
        method: request.method,
        route: request.routeOptions.url,
        path: request.url,
        remoteAddress: request.ip
      },
      "request started"
    );
  });

  app.addHook("onResponse", async (request, reply) => {
    const responseTimeMs = reply.elapsedTime;
    const statusCode = reply.statusCode;
    metrics.recordHttpRequest(statusCode);
    request.log.info(
      {
        method: request.method,
        route: request.routeOptions.url,
        statusCode,
        responseTimeMs
      },
      "request completed"
    );
  });

  void app.register(cors, {
    origin: true
  });
  void app.register(compress);
  void app.register(healthRoutes, {
    env,
    dbPool,
    artifactStore,
    metrics,
    runtimeQueue
  });
  void app.register(skillRoutes, {
    repository: skillRepository,
    dbPool,
    env,
    metrics,
    rateLimiter
  });
  void app.register(runtimeRunRoutes, {
    env,
    dbPool,
    runtimeRunStore,
    runtimeQueue
  });
  void app.register(adminSkillRoutes, {
    env,
    dbPool,
    artifactStore,
    artifactScanner,
    signatureService,
    metrics
  });

  return app;
}
