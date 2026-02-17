import type { FastifyPluginAsync } from "fastify";
import type { Pool } from "pg";

import type { AppEnv } from "../../security/env.js";
import type { LocalArtifactStore } from "../../services/artifact-store.js";
import type { MetricsService } from "../../services/metrics-service.js";

type HealthRoutesOptions = {
  env: AppEnv;
  dbPool: Pool | null;
  artifactStore: LocalArtifactStore;
  metrics: MetricsService;
};

export const healthRoutes: FastifyPluginAsync<HealthRoutesOptions> = async (app, options) => {
  app.get("/health", async () => {
    return {
      status: "ok",
      service: "skills-registry",
      timestamp: new Date().toISOString()
    };
  });

  app.get("/ready", async (request, reply) => {
    if (!options.dbPool) {
      return reply.code(503).send({
        status: "not_ready",
        service: "skills-registry",
        checks: {
          database: "unconfigured"
        },
        timestamp: new Date().toISOString()
      });
    }

    try {
      await options.dbPool.query("SELECT 1");
      return {
        status: "ready",
        service: "skills-registry",
        checks: {
          database: "ok"
        },
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      request.log.error(error, "readiness database check failed");
      return reply.code(503).send({
        status: "not_ready",
        service: "skills-registry",
        checks: {
          database: "failed"
        },
        timestamp: new Date().toISOString()
      });
    }
  });

  app.get("/diagnostics", async () => {
    const dbConfigured = Boolean(options.dbPool);
    const metrics = options.metrics.snapshot();
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
          publicApiRateLimitWindowSeconds: options.env.PUBLIC_API_RATE_LIMIT_WINDOW_SECONDS
        },
        artifactStorage: {
          writableProbe: "deferred",
          maxBytes: options.env.ARTIFACT_MAX_BYTES,
          probeArtifactUriExample: options.artifactStore.toArtifactUri(
            "0000000000000000000000000000000000000000000000000000000000000000"
          )
        },
        metrics
      }
    };
  });
};
