import type { FastifyPluginAsync } from "fastify";
import type { Pool } from "pg";

import type { AppEnv } from "../../security/env.js";
import type { LocalArtifactStore } from "../../services/artifact-store.js";
import type { MetricsService } from "../../services/metrics-service.js";
import type { RuntimeQueueService } from "../../services/runtime-queue.js";

type HealthRoutesOptions = {
  env: AppEnv;
  dbPool: Pool | null;
  artifactStore: LocalArtifactStore;
  metrics: MetricsService;
  runtimeQueue: RuntimeQueueService;
};

export const healthRoutes: FastifyPluginAsync<HealthRoutesOptions> = async (app, options) => {
  const staleQueuedMinutes = 5;
  const staleRunningMinutes = 15;

  app.get("/health", async () => {
    return {
      status: "ok",
      service: "skills-registry",
      timestamp: new Date().toISOString()
    };
  });

  app.get("/ready", async (request, reply) => {
    const runtimeQueueHealth = await options.runtimeQueue.getHealth();

    if (!options.dbPool) {
      return reply.code(503).send({
        status: "not_ready",
        service: "skills-registry",
        checks: {
          database: "unconfigured",
          runtimeQueue: runtimeQueueHealth.status
        },
        timestamp: new Date().toISOString()
      });
    }

    try {
      await options.dbPool.query("SELECT 1");
      if (runtimeQueueHealth.enabled && runtimeQueueHealth.status !== "ok") {
        return reply.code(503).send({
          status: "not_ready",
          service: "skills-registry",
          checks: {
            database: "ok",
            runtimeQueue: "failed"
          },
          timestamp: new Date().toISOString()
        });
      }
      return {
        status: "ready",
        service: "skills-registry",
        checks: {
          database: "ok",
          runtimeQueue: runtimeQueueHealth.status
        },
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      request.log.error(error, "readiness database check failed");
      return reply.code(503).send({
        status: "not_ready",
        service: "skills-registry",
        checks: {
          database: "failed",
          runtimeQueue: runtimeQueueHealth.status
        },
        timestamp: new Date().toISOString()
      });
    }
  });

  app.get("/diagnostics", async () => {
    const dbConfigured = Boolean(options.dbPool);
    const metrics = options.metrics.snapshot();
    const runtimeQueueHealth = await options.runtimeQueue.getHealth();
    return {
      status: "ok",
      service: "skills-registry",
      timestamp: new Date().toISOString(),
      readiness: {
        databaseConfigured: dbConfigured
      },
      diagnostics: {
        runtime: {
          nodeVersion: process.version,
          environment: options.env.NODE_ENV
        },
        config: {
          host: options.env.HOST,
          port: options.env.PORT,
          publicApiRateLimitMax: options.env.PUBLIC_API_RATE_LIMIT_MAX,
          publicApiRateLimitWindowSeconds: options.env.PUBLIC_API_RATE_LIMIT_WINDOW_SECONDS,
          runtimeQueueEnabled: runtimeQueueHealth.enabled
        },
        artifactStorage: {
          writableProbe: "deferred",
          maxBytes: options.env.ARTIFACT_MAX_BYTES,
          probeArtifactUriExample: options.artifactStore.toArtifactUri(
            "0000000000000000000000000000000000000000000000000000000000000000"
          )
        },
        runtimeQueue: runtimeQueueHealth,
        metrics
      }
    };
  });

  app.get("/v1/runtime/health", async (request, reply) => {
    const runtimeQueueHealth = await options.runtimeQueue.getHealth();

    if (!options.dbPool) {
      return {
        status: runtimeQueueHealth.enabled && runtimeQueueHealth.status !== "ok" ? "degraded" : "ok",
        service: "skills-runtime",
        timestamp: new Date().toISOString(),
        checks: {
          database: "unconfigured",
          runtimeQueue: runtimeQueueHealth.status
        },
        stalePolicy: {
          queuedOrPreparingAfterMinutes: staleQueuedMinutes,
          runningAfterMinutes: staleRunningMinutes
        },
        runtime: {
          queue: runtimeQueueHealth,
          inFlight: {
            total: null,
            oldestSeconds: null
          },
          staleRuns: {
            queuedOrPreparing: null,
            running: null
          }
        }
      };
    }

    try {
      const staleCounts = await options.dbPool.query<{
        inFlightTotal: number;
        staleQueuedOrPreparing: number;
        staleRunning: number;
        oldestInFlightSeconds: number | null;
      }>(
        `
          SELECT
            (COUNT(*) FILTER (WHERE sr.status IN ('queued', 'preparing', 'running')))::int AS "inFlightTotal",
            (COUNT(*) FILTER (
              WHERE sr.status IN ('queued', 'preparing')
                AND sr.started_at < NOW() - ($1::text || ' minutes')::interval
            ))::int AS "staleQueuedOrPreparing",
            (COUNT(*) FILTER (
              WHERE sr.status = 'running'
                AND sr.started_at < NOW() - ($2::text || ' minutes')::interval
            ))::int AS "staleRunning",
            COALESCE(
              FLOOR(EXTRACT(EPOCH FROM NOW() - MIN(sr.started_at)))
                FILTER (WHERE sr.status IN ('queued', 'preparing', 'running')),
              NULL
            )::int AS "oldestInFlightSeconds"
          FROM skill_runs sr
        `,
        [String(staleQueuedMinutes), String(staleRunningMinutes)]
      );

      const counts = staleCounts.rows[0] ?? {
        inFlightTotal: 0,
        staleQueuedOrPreparing: 0,
        staleRunning: 0,
        oldestInFlightSeconds: null
      };
      const staleDetected = counts.staleQueuedOrPreparing > 0 || counts.staleRunning > 0;
      const queueFailed = runtimeQueueHealth.enabled && runtimeQueueHealth.status !== "ok";

      return {
        status: staleDetected || queueFailed ? "degraded" : "ok",
        service: "skills-runtime",
        timestamp: new Date().toISOString(),
        checks: {
          database: "ok",
          runtimeQueue: runtimeQueueHealth.status
        },
        stalePolicy: {
          queuedOrPreparingAfterMinutes: staleQueuedMinutes,
          runningAfterMinutes: staleRunningMinutes
        },
        runtime: {
          queue: runtimeQueueHealth,
          inFlight: {
            total: counts.inFlightTotal,
            oldestSeconds: counts.oldestInFlightSeconds
          },
          staleRuns: {
            queuedOrPreparing: counts.staleQueuedOrPreparing,
            running: counts.staleRunning
          }
        }
      };
    } catch (error) {
      request.log.error(error, "runtime health query failed");
      return reply.code(503).send({
        status: "not_ready",
        service: "skills-runtime",
        timestamp: new Date().toISOString(),
        checks: {
          database: "failed",
          runtimeQueue: runtimeQueueHealth.status
        },
        stalePolicy: {
          queuedOrPreparingAfterMinutes: staleQueuedMinutes,
          runningAfterMinutes: staleRunningMinutes
        }
      });
    }
  });
};
