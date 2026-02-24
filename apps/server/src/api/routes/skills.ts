import type { FastifyPluginAsync } from "fastify";
import type { Pool } from "pg";
import { z } from "zod";

import { CatalogService } from "../../services/catalog-service.js";
import { listPermissionProfiles } from "../../services/permission-profiles.js";
import type { MetricsService } from "../../services/metrics-service.js";
import type { InMemoryRateLimiter } from "../../services/rate-limiter.js";
import { ensureRuntimeEnvironmentReady } from "../../services/runtime-environment-builder.js";
import type { SkillRepository } from "../../repositories/skill-repository.js";
import type { AppEnv } from "../../security/env.js";
import { resolveUserIdFromRequest } from "../../security/request-auth.js";

const listSkillsQuerySchema = z.object({
  query: z.string().trim().min(1).optional(),
  trustedOnly: z.coerce.boolean().optional().default(false)
});

const advisoryFeedQuerySchema = z.object({
  cursor: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional().default(50)
});

const skillParamsSchema = z.object({
  skillId: z.string().trim().min(1)
});

const skillVersionParamsSchema = skillParamsSchema.extend({
  version: z.string().trim().min(1)
});

const agentParamsSchema = z.object({
  agentId: z.string().uuid()
});

const installBodySchema = z.object({
  version: z.string().trim().min(1).optional(),
  autoUpdate: z.boolean().optional().default(true),
  installConfig: z.record(z.string(), z.unknown()).optional().default({})
});

const pinVersionBodySchema = z.object({
  version: z.string().trim().min(1)
});

const assignBodySchema = z.object({
  agentId: z.string().uuid(),
  enabled: z.boolean().optional().default(true),
  config: z.record(z.string(), z.unknown()).optional().default({})
});

type SkillRoutesOptions = {
  repository: SkillRepository;
  dbPool: Pool | null;
  env: AppEnv;
  metrics: MetricsService;
  rateLimiter: InMemoryRateLimiter;
};

export const skillRoutes: FastifyPluginAsync<SkillRoutesOptions> = async (app, options) => {
  const catalogService = new CatalogService(options.repository);
  const catalogRoutePatterns = new Set([
    "/v1/skills",
    "/v1/skills/:skillId",
    "/v1/skills/:skillId/versions/:version",
    "/v1/permissions/profiles",
    "/v1/advisories",
    "/v1/advisories/feed"
  ]);

  app.addHook("onRequest", async (request, reply) => {
    if (request.method !== "GET") {
      return;
    }

    const routePattern = request.routeOptions.url;
    if (!routePattern) {
      return;
    }
    if (!catalogRoutePatterns.has(routePattern)) {
      return;
    }

    const ip = request.ip;
    const decision = options.rateLimiter.check(`${ip}:${routePattern}`);
    reply.header("x-ratelimit-limit", String(options.env.PUBLIC_API_RATE_LIMIT_MAX));
    reply.header("x-ratelimit-remaining", String(decision.remaining));
    reply.header("x-ratelimit-reset", String(decision.resetSeconds));
    if (!decision.allowed) {
      reply.header("retry-after", String(decision.retryAfterSeconds));
      return reply.code(429).send({
        message: "Too many requests. Please retry later."
      });
    }
  });

  app.addHook("onResponse", async (request, reply) => {
    const routePattern = request.routeOptions.url;
    const latencyMs = reply.elapsedTime;
    const statusCode = reply.statusCode;
    if (routePattern === "/v1/skills") {
      options.metrics.recordCatalogLatency("GET /v1/skills", statusCode, latencyMs);
      return;
    }
    if (routePattern === "/v1/skills/:skillId") {
      options.metrics.recordCatalogLatency("GET /v1/skills/:skillId", statusCode, latencyMs);
      return;
    }
    if (routePattern === "/v1/skills/:skillId/versions/:version") {
      options.metrics.recordCatalogLatency(
        "GET /v1/skills/:skillId/versions/:version",
        statusCode,
        latencyMs
      );
      return;
    }
    if (routePattern === "/v1/advisories") {
      options.metrics.recordCatalogLatency("GET /v1/advisories", statusCode, latencyMs);
      return;
    }
    if (routePattern === "/v1/advisories/feed") {
      options.metrics.recordCatalogLatency("GET /v1/advisories/feed", statusCode, latencyMs);
    }
  });

  app.get("/v1/skills", async (request) => {
    const { query, trustedOnly } = listSkillsQuerySchema.parse(request.query);
    const skills = await catalogService.listSkills(query, { trustedOnly });
    return { data: skills };
  });

  app.get("/v1/permissions/profiles", async () => {
    return {
      data: listPermissionProfiles()
    };
  });

  app.get("/v1/skills/installed", async (request, reply) => {
    const user = await resolveUserIdFromRequest(request.headers as Record<string, unknown>, options.env);
    if (!user.ok) {
      return reply.code(user.statusCode).send({ message: user.message });
    }

    if (!options.dbPool) {
      return reply.code(503).send({ message: "DATABASE_URL is not configured." });
    }

    const installs = await options.dbPool.query<{
      installId: string;
      skillId: string;
      implementationKey: string;
      name: string;
      installState: string;
      autoUpdate: boolean;
      pinnedVersion: string | null;
      updatedAt: string;
    }>(
      `
        SELECT
          si.id::text AS "installId",
          s.skill_id AS "skillId",
          s.implementation_key AS "implementationKey",
          s.name AS name,
          si.install_state AS "installState",
          si.auto_update AS "autoUpdate",
          sv.version AS "pinnedVersion",
          si.updated_at::text AS "updatedAt"
        FROM skill_installs si
        JOIN skills s ON s.id = si.skill_ref_id
        LEFT JOIN skill_versions sv ON sv.id = si.pinned_version_id
        WHERE si.user_id = $1::uuid
        ORDER BY si.updated_at DESC
      `,
      [user.userId]
    );

    return {
      data: installs.rows
    };
  });

  app.get("/v1/skills/:skillId", async (request, reply) => {
    const { skillId } = skillParamsSchema.parse(request.params);
    const skill = await catalogService.getSkill(skillId);

    if (!skill) {
      return reply.code(404).send({ message: "Skill not found." });
    }

    return { data: skill };
  });

  app.get("/v1/skills/:skillId/versions/:version", async (request, reply) => {
    const { skillId, version } = skillVersionParamsSchema.parse(request.params);
    const skillVersion = await catalogService.getSkillVersion(skillId, version);

    if (!skillVersion) {
      return reply.code(404).send({ message: "Skill version not found." });
    }

    return { data: skillVersion };
  });

  app.get("/v1/runtime/skills/:skillId/versions/:version/handshake", async (request, reply) => {
    const user = await resolveUserIdFromRequest(request.headers as Record<string, unknown>, options.env);
    if (!user.ok) {
      return reply.code(user.statusCode).send({ message: user.message });
    }

    if (!options.dbPool) {
      return reply.code(503).send({ message: "DATABASE_URL is not configured." });
    }

    const { skillId, version } = skillVersionParamsSchema.parse(request.params);
    const versionRecord = await options.dbPool.query<{
      skillRefId: string;
      implementationKey: string;
      name: string;
      riskLevel: "low" | "moderate" | "high";
      runtime: "command" | "http" | "wasm";
      entrypoint: string;
      artifactUri: string | null;
      digest: string;
      signature: string;
      compatibilityMinAppVersion: string | null;
      compatibilityMaxAppVersion: string | null;
      policyStatus: "pending" | "approved" | "rejected" | "revoked";
      revokedAt: string | null;
      installId: string | null;
      installState: string | null;
      autoUpdate: boolean | null;
      installConfig: Record<string, unknown> | null;
      pinnedVersion: string | null;
    }>(
      `
        SELECT
          s.id::text AS "skillRefId",
          s.implementation_key AS "implementationKey",
          s.name AS name,
          s.risk_level AS "riskLevel",
          sv.runtime AS runtime,
          sv.entrypoint AS entrypoint,
          sv.artifact_uri AS "artifactUri",
          sv.digest AS digest,
          sv.signature AS signature,
          sv.compatibility_min_app_version AS "compatibilityMinAppVersion",
          sv.compatibility_max_app_version AS "compatibilityMaxAppVersion",
          sv.policy_status AS "policyStatus",
          sv.revoked_at::text AS "revokedAt",
          si.id::text AS "installId",
          si.install_state AS "installState",
          si.auto_update AS "autoUpdate",
          si.install_config AS "installConfig",
          pinned.version AS "pinnedVersion"
        FROM skills s
        JOIN skill_versions sv ON sv.skill_ref_id = s.id
        LEFT JOIN skill_installs si ON si.skill_ref_id = s.id AND si.user_id = $3::uuid
        LEFT JOIN skill_versions pinned ON pinned.id = si.pinned_version_id
        WHERE s.skill_id = $1::text
          AND sv.version = $2::text
        LIMIT 1
      `,
      [skillId, version, user.userId]
    );

    const row = versionRecord.rows[0];
    if (!row) {
      return reply.code(404).send({ message: "Skill version not found." });
    }

    const permissions = await options.dbPool.query<{
      permissionKey: string;
      required: boolean;
      riskLevel: "low" | "moderate" | "high";
      permissionScope: Record<string, unknown>;
    }>(
      `
        SELECT
          sp.permission_key AS "permissionKey",
          sp.required AS required,
          sp.risk_level AS "riskLevel",
          sp.permission_scope AS "permissionScope"
        FROM skill_permissions sp
        JOIN skill_versions sv ON sv.id = sp.skill_version_id
        JOIN skills s ON s.id = sv.skill_ref_id
        WHERE s.skill_id = $1::text
          AND sv.version = $2::text
        ORDER BY sp.permission_key ASC
      `,
      [skillId, version]
    );

    const latestAdvisory = await options.dbPool.query<{
      advisoryId: string;
      advisoryType: "warning" | "revocation" | "deprecation" | "security";
      title: string;
      summary: string;
      severity: "low" | "moderate" | "high" | "critical";
      publishedAt: string;
      metadata: Record<string, unknown>;
    }>(
      `
        SELECT
          sa.id::text AS "advisoryId",
          sa.advisory_type AS "advisoryType",
          sa.title AS title,
          sa.summary AS summary,
          sa.severity AS severity,
          COALESCE(sa.published_at, sa.created_at)::text AS "publishedAt",
          sa.metadata AS metadata
        FROM skill_advisories sa
        JOIN skills s ON s.id = sa.skill_ref_id
        LEFT JOIN skill_versions sv ON sv.id = sa.skill_version_id
        WHERE s.skill_id = $1::text
          AND sa.resolved_at IS NULL
          AND (sv.version = $2::text OR sa.skill_version_id IS NULL)
        ORDER BY COALESCE(sa.published_at, sa.created_at) DESC
        LIMIT 1
      `,
      [skillId, version]
    );

    const advisory = latestAdvisory.rows[0];
    const forceDisableFromAdvisory =
      advisory?.advisoryType === "revocation" || advisory?.metadata?.force_disable === true;
    const forceDisable = Boolean(row.revokedAt) || Boolean(forceDisableFromAdvisory);
    const forceDisableReason = row.revokedAt
      ? "Skill version is revoked."
      : advisory
        ? advisory.summary
        : null;

    return {
      data: {
        skillId,
        implementationKey: row.implementationKey,
        name: row.name,
        version,
        install: {
          installId: row.installId,
          installed: Boolean(row.installId),
          installState: row.installState,
          autoUpdate: row.autoUpdate,
          pinnedVersion: row.pinnedVersion,
          installConfig: row.installConfig ?? {}
        },
        runtime: {
          type: row.runtime,
          entrypoint: row.entrypoint,
          compatibility: {
            minAppVersion: row.compatibilityMinAppVersion,
            maxAppVersion: row.compatibilityMaxAppVersion
          }
        },
        artifact: {
          uri: row.artifactUri,
          digest: row.digest,
          signature: row.signature,
          signatureAlgorithm: row.signature.startsWith("hmac-sha256.") ? "hmac-sha256" : "unknown"
        },
        policy: {
          status: row.policyStatus,
          riskLevel: row.riskLevel
        },
        permissions: permissions.rows,
        forceDisable: {
          required: forceDisable,
          reason: forceDisableReason,
          advisory: advisory
            ? {
                advisoryId: advisory.advisoryId,
                advisoryType: advisory.advisoryType,
                title: advisory.title,
                summary: advisory.summary,
                severity: advisory.severity,
                publishedAt: advisory.publishedAt
              }
            : null
        }
      }
    };
  });

  app.get("/v1/advisories", async () => {
    const advisories = await catalogService.listAdvisories();
    return { data: advisories };
  });

  app.get("/v1/advisories/feed", async (request) => {
    const { cursor, limit } = advisoryFeedQuerySchema.parse(request.query);
    const feed = await catalogService.listAdvisoryFeed({
      ...(cursor ? { cursor } : {}),
      limit
    });
    for (const advisory of feed.advisories) {
      const publishedAtMs = Date.parse(advisory.publishedAt);
      if (Number.isNaN(publishedAtMs)) {
        continue;
      }
      const lagMs = Date.now() - publishedAtMs;
      if (lagMs >= 0) {
        options.metrics.recordAdvisoryPropagationLagMs(lagMs);
      }
    }

    return {
      data: feed.advisories,
      page: {
        nextCursor: feed.nextCursor,
        hasMore: feed.hasMore
      }
    };
  });

  app.get("/v1/agents/:agentId/skills", async (request, reply) => {
    const user = await resolveUserIdFromRequest(request.headers as Record<string, unknown>, options.env);
    if (!user.ok) {
      return reply.code(user.statusCode).send({ message: user.message });
    }

    if (!options.dbPool) {
      return reply.code(503).send({ message: "DATABASE_URL is not configured." });
    }

    const { agentId } = agentParamsSchema.parse(request.params);

    const agentCheck = await options.dbPool.query(
      `
        SELECT a.id
        FROM agents a
        WHERE a.id = $1::uuid
          AND a.user_id = $2::uuid
        LIMIT 1
      `,
      [agentId, user.userId]
    );

    if ((agentCheck.rowCount ?? 0) === 0) {
      return reply.code(404).send({ message: "Agent not found." });
    }

    const rows = await options.dbPool.query<{
      agentAbilityId: string;
      skillId: string;
      implementationKey: string;
      name: string;
      enabled: boolean;
      config: Record<string, unknown>;
      installState: string | null;
      pinnedVersion: string | null;
    }>(
      `
        SELECT
          aa.id::text AS "agentAbilityId",
          s.skill_id AS "skillId",
          s.implementation_key AS "implementationKey",
          s.name AS name,
          aa.enabled AS enabled,
          aa.config AS config,
          si.install_state AS "installState",
          sv.version AS "pinnedVersion"
        FROM agent_abilities aa
        JOIN abilities ab ON ab.id = aa.ability_id
        JOIN skills s ON s.implementation_key = ab.implementation_key
        LEFT JOIN skill_installs si ON si.skill_ref_id = s.id AND si.user_id = $2::uuid
        LEFT JOIN skill_versions sv ON sv.id = si.pinned_version_id
        WHERE aa.agent_id = $1::uuid
        ORDER BY s.name ASC
      `,
      [agentId, user.userId]
    );

    return {
      data: rows.rows
    };
  });

  app.post("/v1/skills/:skillId/install", async (request, reply) => {
    const user = await resolveUserIdFromRequest(request.headers as Record<string, unknown>, options.env);
    if (!user.ok) {
      return reply.code(user.statusCode).send({ message: user.message });
    }

    if (!options.dbPool) {
      return reply.code(503).send({ message: "DATABASE_URL is not configured." });
    }

    const { skillId } = skillParamsSchema.parse(request.params);
    const body = installBodySchema.parse(request.body);

    const skillLookup = await options.dbPool.query<{ skillRefId: string; implementationKey: string }>(
      `
        SELECT
          s.id::text AS "skillRefId",
          s.implementation_key AS "implementationKey"
        FROM skills s
        WHERE s.skill_id = $1::text
          AND s.status <> 'disabled'
        LIMIT 1
      `,
      [skillId]
    );

    const skill = skillLookup.rows[0];
    if (!skill) {
      return reply.code(404).send({ message: "Skill not found." });
    }

    const versionLookup = body.version
      ? await options.dbPool.query<{ skillVersionId: string; version: string; digest: string }>(
          `
            SELECT
              sv.id::text AS "skillVersionId",
              sv.version,
              sv.digest
            FROM skill_versions sv
            WHERE sv.skill_ref_id = $1::uuid
              AND sv.version = $2::text
              AND sv.policy_status = 'approved'
              AND sv.revoked_at IS NULL
            LIMIT 1
          `,
          [skill.skillRefId, body.version]
        )
      : await options.dbPool.query<{ skillVersionId: string; version: string; digest: string }>(
          `
            SELECT
              sv.id::text AS "skillVersionId",
              sv.version,
              sv.digest
            FROM skill_versions sv
            WHERE sv.skill_ref_id = $1::uuid
              AND sv.policy_status = 'approved'
              AND sv.revoked_at IS NULL
            ORDER BY COALESCE(sv.published_at, sv.created_at) DESC
            LIMIT 1
          `,
          [skill.skillRefId]
        );

    const version = versionLookup.rows[0];
    if (!version) {
      return reply.code(404).send({ message: "No installable skill version found." });
    }

    const installResult = await options.dbPool.query<{ installId: string }>(
      `
        INSERT INTO skill_installs (
          id,
          user_id,
          skill_ref_id,
          pinned_version_id,
          installed_via,
          install_state,
          auto_update,
          install_config,
          installed_at,
          updated_at
        )
        VALUES (
          gen_random_uuid(),
          $1::uuid,
          $2::uuid,
          $3::uuid,
          'catalog',
          'resolving',
          $4::bool,
          $5::jsonb,
          NOW(),
          NOW()
        )
        ON CONFLICT (user_id, skill_ref_id)
        DO UPDATE SET
          pinned_version_id = EXCLUDED.pinned_version_id,
          install_state = 'resolving',
          auto_update = EXCLUDED.auto_update,
          install_config = EXCLUDED.install_config,
          last_error = NULL,
          updated_at = NOW()
        RETURNING id::text AS "installId"
      `,
      [user.userId, skill.skillRefId, version.skillVersionId, body.autoUpdate, JSON.stringify(body.installConfig)]
    );

    const installId = installResult.rows[0]?.installId;
    if (!installId) {
      return reply.code(500).send({ message: "Failed to install skill." });
    }

    let runtimeEnvironmentId: string;
    try {
      const runtimeEnvironment = await ensureRuntimeEnvironmentReady({
        dbPool: options.dbPool,
        skillRefId: skill.skillRefId,
        skillVersionId: version.skillVersionId,
        skillId,
        version: version.version,
        digest: version.digest,
        source: "install_flow",
        installId
      });
      runtimeEnvironmentId = runtimeEnvironment.runtimeEnvironmentId;
    } catch (error) {
      request.log.error({ error, skillId, version: version.version }, "failed to initialize runtime environment");
      return reply.code(500).send({ message: "Failed to initialize runtime environment." });
    }

    await options.dbPool.query(
      `
        UPDATE skill_installs
        SET
          install_state = 'ready',
          updated_at = NOW()
        WHERE id = $1::uuid
      `,
      [installId]
    );

    return {
      data: {
        installId,
        skillId,
        version: version.version,
        implementationKey: skill.implementationKey,
        installed: true,
        installState: "ready",
        runtimeEnvironmentId
      }
    };
  });

  app.delete("/v1/skills/:skillId/install", async (request, reply) => {
    const user = await resolveUserIdFromRequest(request.headers as Record<string, unknown>, options.env);
    if (!user.ok) {
      return reply.code(user.statusCode).send({ message: user.message });
    }

    if (!options.dbPool) {
      return reply.code(503).send({ message: "DATABASE_URL is not configured." });
    }

    const { skillId } = skillParamsSchema.parse(request.params);
    const result = await options.dbPool.query<{ installId: string }>(
      `
        UPDATE skill_installs si
        SET
          install_state = 'disabled',
          updated_at = NOW()
        FROM skills s
        WHERE si.skill_ref_id = s.id
          AND si.user_id = $1::uuid
          AND s.skill_id = $2::text
        RETURNING si.id::text AS "installId"
      `,
      [user.userId, skillId]
    );

    const row = result.rows[0];
    if (!row) {
      return reply.code(404).send({ message: "Skill install not found." });
    }

    return {
      data: {
        installId: row.installId,
        skillId,
        uninstalled: true
      }
    };
  });

  app.post("/v1/skills/:skillId/install/pin", async (request, reply) => {
    const user = await resolveUserIdFromRequest(request.headers as Record<string, unknown>, options.env);
    if (!user.ok) {
      return reply.code(user.statusCode).send({ message: user.message });
    }

    if (!options.dbPool) {
      return reply.code(503).send({ message: "DATABASE_URL is not configured." });
    }

    const { skillId } = skillParamsSchema.parse(request.params);
    const body = pinVersionBodySchema.parse(request.body);

    const versionLookup = await options.dbPool.query<{ skillVersionId: string }>(
      `
        SELECT
          sv.id::text AS "skillVersionId"
        FROM skill_versions sv
        JOIN skills s ON s.id = sv.skill_ref_id
        WHERE s.skill_id = $1::text
          AND sv.version = $2::text
          AND sv.policy_status = 'approved'
          AND sv.revoked_at IS NULL
        LIMIT 1
      `,
      [skillId, body.version]
    );

    const version = versionLookup.rows[0];
    if (!version) {
      return reply.code(404).send({ message: "Skill version not found." });
    }

    const installUpdate = await options.dbPool.query<{ installId: string }>(
      `
        UPDATE skill_installs si
        SET
          pinned_version_id = $3::uuid,
          install_state = 'ready',
          last_error = NULL,
          updated_at = NOW()
        FROM skills s
        WHERE si.skill_ref_id = s.id
          AND si.user_id = $1::uuid
          AND s.skill_id = $2::text
        RETURNING si.id::text AS "installId"
      `,
      [user.userId, skillId, version.skillVersionId]
    );

    const row = installUpdate.rows[0];
    if (!row) {
      return reply.code(404).send({ message: "Skill install not found." });
    }

    return {
      data: {
        installId: row.installId,
        skillId,
        version: body.version,
        pinned: true,
        installState: "ready"
      }
    };
  });

  app.post("/v1/skills/:skillId/assign", async (request, reply) => {
    const user = await resolveUserIdFromRequest(request.headers as Record<string, unknown>, options.env);
    if (!user.ok) {
      return reply.code(user.statusCode).send({ message: user.message });
    }

    if (!options.dbPool) {
      return reply.code(503).send({ message: "DATABASE_URL is not configured." });
    }

    const { skillId } = skillParamsSchema.parse(request.params);
    const body = assignBodySchema.parse(request.body);

    const skillLookup = await options.dbPool.query<{
      skillRefId: string;
      implementationKey: string;
      abilityId: string | null;
    }>(
      `
        SELECT
          s.id::text AS "skillRefId",
          s.implementation_key AS "implementationKey",
          ab.id::text AS "abilityId"
        FROM skills s
        LEFT JOIN abilities ab ON ab.implementation_key = s.implementation_key
        WHERE s.skill_id = $1::text
          AND s.status <> 'disabled'
        LIMIT 1
      `,
      [skillId]
    );

    const skill = skillLookup.rows[0];
    if (!skill) {
      return reply.code(404).send({ message: "Skill not found." });
    }

    if (!skill.abilityId) {
      return reply.code(409).send({ message: "Ability mapping missing for this skill." });
    }

    const installCheck = await options.dbPool.query(
      `
        SELECT si.id
        FROM skill_installs si
        WHERE si.user_id = $1::uuid
          AND si.skill_ref_id = $2::uuid
          AND si.install_state IN ('installed', 'ready')
        LIMIT 1
      `,
      [user.userId, skill.skillRefId]
    );

    if ((installCheck.rowCount ?? 0) === 0) {
      return reply.code(404).send({ message: "Skill is not installed for this user." });
    }

    const agentCheck = await options.dbPool.query(
      `
        SELECT a.id
        FROM agents a
        WHERE a.id = $1::uuid
          AND a.user_id = $2::uuid
        LIMIT 1
      `,
      [body.agentId, user.userId]
    );

    if ((agentCheck.rowCount ?? 0) === 0) {
      return reply.code(404).send({ message: "Agent not found." });
    }

    const agentAbilityUpsert = await options.dbPool.query<{ agentAbilityId: string }>(
      `
        INSERT INTO agent_abilities (
          id,
          agent_id,
          ability_id,
          acquired_at,
          usage_count,
          success_count,
          proficiency,
          last_used_at,
          enabled,
          config
        )
        VALUES (
          gen_random_uuid(),
          $1::uuid,
          $2::uuid,
          NOW(),
          0,
          0,
          0.0,
          NULL,
          $3::bool,
          $4::jsonb
        )
        ON CONFLICT (agent_id, ability_id)
        DO UPDATE SET
          enabled = EXCLUDED.enabled,
          config = EXCLUDED.config
        RETURNING id::text AS "agentAbilityId"
      `,
      [body.agentId, skill.abilityId, body.enabled, JSON.stringify(body.config)]
    );

    const row = agentAbilityUpsert.rows[0];
    if (!row) {
      return reply.code(500).send({ message: "Failed assigning skill to agent." });
    }

    return {
      data: {
        agentAbilityId: row.agentAbilityId,
        agentId: body.agentId,
        skillId,
        implementationKey: skill.implementationKey,
        assigned: true
      }
    };
  });
};
