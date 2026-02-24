import type { FastifyPluginAsync } from "fastify";
import type { Pool, PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import { ZodError, z } from "zod";

import type { AppEnv } from "../../security/env.js";
import { ArtifactStoreError, isSha256Digest, type LocalArtifactStore } from "../../services/artifact-store.js";
import type { ArtifactScanner } from "../../services/artifact-scanner.js";
import {
  PublishValidationError,
  validateAndNormalizePublishManifest
} from "../../services/manifest-validation.js";
import { listPermissionProfiles } from "../../services/permission-profiles.js";
import { evaluatePublishPolicy } from "../../services/policy-evaluator.js";
import type { MetricsService } from "../../services/metrics-service.js";
import { SignatureServiceError, type HmacSignatureService } from "../../services/signature-service.js";
import {
  runDockerSkillPreflight,
  type DockerPreflightInput,
  type DockerPreflightResult
} from "../../services/docker-preflight.js";

const publishPermissionSchema = z.object({
  permissionKey: z.string().trim().min(1),
  required: z.boolean().optional().default(true),
  riskLevel: z.enum(["low", "moderate", "high"]).optional().default("moderate"),
  permissionScope: z.record(z.string(), z.unknown()).optional().default({})
});

const artifactUploadRequestSchema = z.object({
  artifactBase64: z.string().trim().min(1),
  digest: z.string().trim().min(1).optional()
});

const publishRequestSchema = z.object({
  skillId: z.string().trim().min(1),
  implementationKey: z.string().trim().min(1),
  name: z.string().trim().min(1),
  description: z.string().trim().min(1),
  riskLevel: z.enum(["low", "moderate", "high"]).optional().default("moderate"),
  source: z.string().trim().min(1).optional().default("coreagent_registry"),
  version: z.string().trim().min(1),
  runtime: z.enum(["command", "http", "wasm"]),
  entrypoint: z.string().trim().min(1).optional(),
  digest: z.string().trim().min(1).optional(),
  artifactDigest: z.string().trim().min(1).optional(),
  preflightRunId: z.string().uuid().optional(),
  artifactUri: z.string().trim().min(1).optional(),
  manifest: z.record(z.string(), z.unknown()).optional().default({}),
  inputSchema: z.record(z.string(), z.unknown()).optional().default({}),
  outputSchema: z.record(z.string(), z.unknown()).optional().default({}),
  healthcheck: z.record(z.string(), z.unknown()).optional().default({}),
  heartbeatPolicy: z.record(z.string(), z.unknown()).optional().default({}),
  compatibilityMinAppVersion: z.string().trim().min(1).optional(),
  compatibilityMaxAppVersion: z.string().trim().min(1).optional(),
  permissionProfileId: z.string().trim().min(1).optional(),
  permissions: z.array(publishPermissionSchema).optional().default([])
});

const dockerPreflightRequestSchema = z.object({
  title: z.string().trim().min(1),
  skillId: z.string().trim().min(1).optional(),
  aiInput: z.string().trim().min(1).max(4000).optional(),
  scriptArtifactDigest: z.string().trim().min(1),
  exampleArtifactDigest: z.string().trim().min(1),
  mode: z.enum(["remote", "local_docker"]).default("local_docker")
});
const dockerPreflightRunParamsSchema = z.object({
  runId: z.string().uuid()
});

const reviewRequestSchema = z.object({
  reviewStatus: z.enum(["in_review", "approved", "rejected"]),
  summary: z.string().trim().min(1),
  trustedBadgeEligible: z.boolean().optional().default(false),
  checks: z
    .object({
      reviewedCode: z.boolean().optional().default(false),
      securityTests: z.boolean().optional().default(false),
      reliabilityChecks: z.boolean().optional().default(false)
    })
    .optional()
});

const revokeParamsSchema = z.object({
  skillId: z.string().trim().min(1),
  version: z.string().trim().min(1)
});

const revokeBodySchema = z.object({
  title: z.string().trim().min(1).default("Skill version revoked"),
  summary: z.string().trim().min(1),
  severity: z.enum(["low", "moderate", "high", "critical"]).default("high")
});

type AdminSkillRoutesOptions = {
  env: AppEnv;
  dbPool: Pool | null;
  artifactStore: LocalArtifactStore;
  artifactScanner: ArtifactScanner;
  signatureService: HmacSignatureService;
  metrics: MetricsService;
  runDockerPreflight?: (input: DockerPreflightInput) => Promise<DockerPreflightResult>;
};

type PublishRequest = z.infer<typeof publishRequestSchema>;
type DockerPreflightRequest = z.infer<typeof dockerPreflightRequestSchema>;

type PreflightRecord = {
  id: string;
  scriptDigest: string;
  exampleDigest: string;
  mode: "remote" | "local_docker";
  status: "running" | "passed" | "failed";
  result: DockerPreflightResult | null;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  startedAt: string;
  finishedAt: string | null;
  createdAtMs: number;
};

const PREFLIGHT_TTL_MS = 30 * 60 * 1000;
const preflightRuns = new Map<string, PreflightRecord>();

function isPgUniqueViolation(error: unknown, constraintName: string): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const maybe = error as { code?: string; constraint?: string };
  return maybe.code === "23505" && maybe.constraint === constraintName;
}

function readAdminTokenHeader(headers: Record<string, unknown>): string | null {
  const value = headers["x-admin-token"];
  if (typeof value === "string") {
    return value;
  }

  return null;
}

function ensureAdminAccess(
  env: AppEnv,
  headers: Record<string, unknown>
): { ok: true } | { ok: false; statusCode: number; message: string } {
  if (!env.ENABLE_ADMIN_API) {
    return { ok: false, statusCode: 404, message: "Admin API is disabled." };
  }

  if (!env.ADMIN_API_TOKEN) {
    return { ok: false, statusCode: 503, message: "Admin API token is not configured." };
  }

  const token = readAdminTokenHeader(headers);
  if (!token || token !== env.ADMIN_API_TOKEN) {
    return { ok: false, statusCode: 401, message: "Invalid admin token." };
  }

  return { ok: true };
}

function handleAdminRouteError(
  app: { log: { error: (error: unknown, message: string) => void } },
  reply: { code: (statusCode: number) => { send: (payload: unknown) => unknown } },
  metrics: MetricsService,
  error: unknown,
  fallbackMessage: string,
  options?: { includeErrorDetail?: boolean }
) {
  if (error instanceof ZodError) {
    metrics.recordValidationFailure();
    return reply.code(400).send({
      message: "Invalid request payload.",
      issues: error.issues
    });
  }

  if (
    error instanceof PublishValidationError ||
    error instanceof ArtifactStoreError ||
    error instanceof SignatureServiceError
  ) {
    if (error instanceof PublishValidationError) {
      metrics.recordValidationFailure();
    }
    return reply.code(error.statusCode).send({ message: error.message });
  }

  app.log.error(error, fallbackMessage);
  const detail =
    options?.includeErrorDetail && error instanceof Error ? { detail: error.message } : {};
  return reply.code(500).send({ message: fallbackMessage, ...detail });
}

async function insertSkillPermissions(
  tx: PoolClient,
  skillVersionId: string,
  permissions: z.infer<typeof publishPermissionSchema>[]
) {
  await tx.query("DELETE FROM skill_permissions WHERE skill_version_id = $1::uuid", [skillVersionId]);

  for (const permission of permissions) {
    await tx.query(
      `
        INSERT INTO skill_permissions (
          id, skill_version_id, permission_key, permission_scope, required, risk_level, created_at
        )
        VALUES (
          gen_random_uuid(),
          $1::uuid,
          $2::text,
          $3::jsonb,
          $4::bool,
          $5::text,
          NOW()
        )
      `,
      [
        skillVersionId,
        permission.permissionKey,
        JSON.stringify(permission.permissionScope),
        permission.required,
        permission.riskLevel
      ]
    );
  }
}

async function insertPublicationEvent(
  tx: PoolClient,
  skillVersionId: string,
  eventType: "submitted" | "validated" | "approved" | "rejected" | "signed" | "published" | "revoked",
  payload: Record<string, unknown>
) {
  await tx.query(
    `
      INSERT INTO skill_publication_events (
        id, skill_version_id, event_type, actor_user_id, payload, created_at
      )
      VALUES (
        gen_random_uuid(),
        $1::uuid,
        $2::text,
        NULL,
        $3::jsonb,
        NOW()
      )
    `,
    [skillVersionId, eventType, JSON.stringify(payload)]
  );
}

async function upsertAbilityForPublishedSkill(tx: PoolClient, body: PublishRequest): Promise<void> {
  const parametersSchema = JSON.stringify(body.inputSchema ?? {});
  const updated = await tx.query(
    `
      UPDATE abilities
      SET
        name = $2::text,
        description = $3::text,
        parameters_schema = $4::jsonb
      WHERE implementation_key = $1::text
      RETURNING id::text
    `,
    [body.implementationKey, body.name, body.description, parametersSchema]
  );

  if (updated.rowCount && updated.rowCount > 0) {
    return;
  }

  try {
    await tx.query(
      `
        INSERT INTO abilities (
          id,
          name,
          description,
          category,
          implementation_key,
          is_premium,
          parameters_schema,
          created_at
        )
        VALUES (
          gen_random_uuid(),
          $1::text,
          $2::text,
          'automation',
          $3::text,
          false,
          $4::jsonb,
          NOW()
        )
      `,
      [body.name, body.description, body.implementationKey, parametersSchema]
    );
  } catch (error) {
    if (!isPgUniqueViolation(error, "abilities_name_key")) {
      throw error;
    }

    const fallbackName = `${body.name} (${body.implementationKey})`;
    await tx.query(
      `
        INSERT INTO abilities (
          id,
          name,
          description,
          category,
          implementation_key,
          is_premium,
          parameters_schema,
          created_at
        )
        VALUES (
          gen_random_uuid(),
          $1::text,
          $2::text,
          'automation',
          $3::text,
          false,
          $4::jsonb,
          NOW()
        )
        ON CONFLICT (implementation_key)
        DO UPDATE SET
          name = EXCLUDED.name,
          description = EXCLUDED.description,
          parameters_schema = EXCLUDED.parameters_schema
      `,
      [fallbackName, body.description, body.implementationKey, parametersSchema]
    );
  }
}

function resolvePublishDigest(body: PublishRequest): string {
  const digest = body.artifactDigest ?? body.digest;
  if (!digest) {
    throw new PublishValidationError(
      400,
      "artifactDigest (or legacy digest) is required for publish."
    );
  }

  const normalized = digest.trim().toLowerCase();
  if (!isSha256Digest(normalized)) {
    throw new PublishValidationError(400, "artifactDigest must be a SHA-256 hex digest.");
  }

  return normalized;
}

function resolveEntrypoint(body: PublishRequest): string {
  if (body.runtime === "command") {
    return "run.sh";
  }
  if (!body.entrypoint) {
    throw new PublishValidationError(400, "entrypoint is required for non-command runtimes.");
  }
  return body.entrypoint;
}

function readPreflightRecord(runId: string): PreflightRecord | null {
  const record = preflightRuns.get(runId) ?? null;
  if (!record) {
    return null;
  }
  if (Date.now() - record.createdAtMs > PREFLIGHT_TTL_MS) {
    preflightRuns.delete(runId);
    return null;
  }
  return record;
}

function assertPublishPreflight(body: PublishRequest, digest: string): PreflightRecord {
  const runId = body.preflightRunId;
  if (!runId) {
    throw new PublishValidationError(
      409,
      "Docker preflight is required before publish. Run /v1/admin/skills/preflight first."
    );
  }
  const record = readPreflightRecord(runId);
  if (!record) {
    throw new PublishValidationError(
      409,
      "Docker preflight not found or expired. Re-run preflight before publish."
    );
  }
  if (record.scriptDigest !== digest) {
    throw new PublishValidationError(
      409,
      "Artifact digest changed since Docker preflight. Re-run preflight before publish."
    );
  }
  if (record.status !== "passed" || !record.result || record.result.status !== "passed") {
    throw new PublishValidationError(
      409,
      "Latest Docker preflight failed. Fix script/example and re-run preflight."
    );
  }
  return record;
}

export const adminSkillRoutes: FastifyPluginAsync<AdminSkillRoutesOptions> = async (
  app,
  options
) => {
  app.get("/v1/admin/permissions/profiles", async (request, reply) => {
    const access = ensureAdminAccess(options.env, request.headers as Record<string, unknown>);
    if (!access.ok) {
      return reply.code(access.statusCode).send({ message: access.message });
    }
    return {
      data: listPermissionProfiles()
    };
  });

  app.post("/v1/admin/artifacts/upload", async (request, reply) => {
    const access = ensureAdminAccess(options.env, request.headers as Record<string, unknown>);
    if (!access.ok) {
      return reply.code(access.statusCode).send({ message: access.message });
    }

    try {
      const body = artifactUploadRequestSchema.parse(request.body);
      const putArtifactInput = body.digest
        ? {
            artifactBase64: body.artifactBase64,
            declaredDigest: body.digest
          }
        : {
            artifactBase64: body.artifactBase64
          };
      const storedArtifact = await options.artifactStore.putArtifact(putArtifactInput);

      return {
        data: {
          digest: storedArtifact.digest,
          artifactUri: storedArtifact.artifactUri,
          sizeBytes: storedArtifact.sizeBytes,
          stored: storedArtifact.stored
        }
      };
    } catch (error) {
      return handleAdminRouteError(
        app,
        reply,
        options.metrics,
        error,
        "Failed to upload artifact."
      );
    }
  });

  app.post("/v1/admin/skills/preflight", async (request, reply) => {
    const access = ensureAdminAccess(options.env, request.headers as Record<string, unknown>);
    if (!access.ok) {
      return reply.code(access.statusCode).send({ message: access.message });
    }

    try {
      const body: DockerPreflightRequest = dockerPreflightRequestSchema.parse(request.body);
      const scriptDigest = body.scriptArtifactDigest.trim().toLowerCase();
      const exampleDigest = body.exampleArtifactDigest.trim().toLowerCase();
      if (!isSha256Digest(scriptDigest) || !isSha256Digest(exampleDigest)) {
        return reply.code(400).send({
          message: "scriptArtifactDigest and exampleArtifactDigest must be SHA-256 hex digests."
        });
      }

      const scriptBytes = await options.artifactStore.readDigest(scriptDigest);
      const exampleBytes = await options.artifactStore.readDigest(exampleDigest);
      if (!scriptBytes || !exampleBytes) {
        return reply.code(400).send({
          message: "Script/example artifacts not found in local storage. Upload both artifacts first."
        });
      }

      const preflightRunner = options.runDockerPreflight ?? runDockerSkillPreflight;
      const result = await preflightRunner({
        title: body.title,
        ...(body.skillId ? { skillId: body.skillId } : {}),
        ...(body.aiInput ? { aiInput: body.aiInput } : {}),
        scriptBytes,
        exampleBytes,
        mode: body.mode
      });

      const runId = randomUUID();
      preflightRuns.set(runId, {
        id: runId,
        scriptDigest,
        exampleDigest,
        mode: body.mode,
        status: result.status,
        result,
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        startedAt: result.startedAt,
        finishedAt: result.finishedAt,
        createdAtMs: Date.now()
      });

      return {
        data: {
          runId,
          scriptArtifactDigest: scriptDigest,
          exampleArtifactDigest: exampleDigest,
          mode: body.mode,
          ...result
        }
      };
    } catch (error) {
      return handleAdminRouteError(
        app,
        reply,
        options.metrics,
        error,
        "Failed to run docker preflight."
      );
    }
  });

  app.post("/v1/admin/skills/preflight/start", async (request, reply) => {
    const access = ensureAdminAccess(options.env, request.headers as Record<string, unknown>);
    if (!access.ok) {
      return reply.code(access.statusCode).send({ message: access.message });
    }

    try {
      const body: DockerPreflightRequest = dockerPreflightRequestSchema.parse(request.body);
      const scriptDigest = body.scriptArtifactDigest.trim().toLowerCase();
      const exampleDigest = body.exampleArtifactDigest.trim().toLowerCase();
      if (!isSha256Digest(scriptDigest) || !isSha256Digest(exampleDigest)) {
        return reply.code(400).send({
          message: "scriptArtifactDigest and exampleArtifactDigest must be SHA-256 hex digests."
        });
      }

      const scriptBytes = await options.artifactStore.readDigest(scriptDigest);
      const exampleBytes = await options.artifactStore.readDigest(exampleDigest);
      if (!scriptBytes || !exampleBytes) {
        return reply.code(400).send({
          message: "Script/example artifacts not found in local storage. Upload both artifacts first."
        });
      }

      const runId = randomUUID();
      const startedAt = new Date().toISOString();
      preflightRuns.set(runId, {
        id: runId,
        scriptDigest,
        exampleDigest,
        mode: body.mode,
        status: "running",
        result: null,
        stdout: "",
        stderr: "",
        exitCode: null,
        startedAt,
        finishedAt: null,
        createdAtMs: Date.now()
      });

      const preflightRunner = options.runDockerPreflight ?? runDockerSkillPreflight;
      void preflightRunner({
        title: body.title,
        ...(body.skillId ? { skillId: body.skillId } : {}),
        ...(body.aiInput ? { aiInput: body.aiInput } : {}),
        scriptBytes,
        exampleBytes,
        mode: body.mode,
        onChunk: (stream, chunk) => {
          const record = preflightRuns.get(runId);
          if (!record) {
            return;
          }
          if (stream === "stdout") {
            record.stdout += chunk;
          } else {
            record.stderr += chunk;
          }
        }
      })
        .then((result) => {
          const record = preflightRuns.get(runId);
          if (!record) {
            return;
          }
          record.status = result.status;
          record.result = result;
          record.stdout = result.stdout;
          record.stderr = result.stderr;
          record.exitCode = result.exitCode;
          record.startedAt = result.startedAt;
          record.finishedAt = result.finishedAt;
        })
        .catch((error) => {
          const record = preflightRuns.get(runId);
          if (!record) {
            return;
          }
          const finishedAt = new Date().toISOString();
          record.status = "failed";
          record.result = {
            status: "failed",
            exitCode: 1,
            stdout: record.stdout,
            stderr: `${record.stderr}${record.stderr.endsWith("\n") || record.stderr.length === 0 ? "" : "\n"}${error instanceof Error ? error.message : String(error)}\n`,
            startedAt: record.startedAt,
            finishedAt
          };
          record.stdout = record.result.stdout;
          record.stderr = record.result.stderr;
          record.exitCode = 1;
          record.finishedAt = finishedAt;
        });

      return {
        data: {
          runId,
          scriptArtifactDigest: scriptDigest,
          exampleArtifactDigest: exampleDigest,
          mode: body.mode,
          status: "running",
          exitCode: null,
          stdout: "",
          stderr: "",
          startedAt,
          finishedAt: null
        }
      };
    } catch (error) {
      return handleAdminRouteError(
        app,
        reply,
        options.metrics,
        error,
        "Failed to start docker preflight."
      );
    }
  });

  app.get("/v1/admin/skills/preflight/:runId", async (request, reply) => {
    const access = ensureAdminAccess(options.env, request.headers as Record<string, unknown>);
    if (!access.ok) {
      return reply.code(access.statusCode).send({ message: access.message });
    }

    const { runId } = dockerPreflightRunParamsSchema.parse(request.params);
    const record = readPreflightRecord(runId);
    if (!record) {
      return reply.code(404).send({ message: "Docker preflight run not found or expired." });
    }

    return {
      data: {
        runId: record.id,
        scriptArtifactDigest: record.scriptDigest,
        exampleArtifactDigest: record.exampleDigest,
        mode: record.mode,
        status: record.status,
        exitCode: record.exitCode,
        stdout: record.stdout,
        stderr: record.stderr,
        startedAt: record.startedAt,
        finishedAt: record.finishedAt
      }
    };
  });

  app.post("/v1/admin/skills/publish/dry-run", async (request, reply) => {
    const access = ensureAdminAccess(options.env, request.headers as Record<string, unknown>);
    if (!access.ok) {
      return reply.code(access.statusCode).send({ message: access.message });
    }

    try {
      const body = publishRequestSchema.parse(request.body);
      const digest = resolvePublishDigest(body);
      const entrypoint = resolveEntrypoint(body);
      const artifactExists = await options.artifactStore.hasDigest(digest);

      if (!artifactExists && !body.artifactUri) {
        options.metrics.recordValidationFailure();
        return reply.code(400).send({
          message: "Artifact digest not found in local storage. Upload first or provide artifactUri."
        });
      }

      const manifestValidation = validateAndNormalizePublishManifest({
        skillId: body.skillId,
        implementationKey: body.implementationKey,
        name: body.name,
        description: body.description,
        version: body.version,
        runtime: body.runtime,
        entrypoint,
        manifest: body.manifest,
        inputSchema: body.inputSchema,
        outputSchema: body.outputSchema,
        healthcheck: body.healthcheck,
        heartbeatPolicy: body.heartbeatPolicy,
        permissions: body.permissions,
        ...(body.permissionProfileId ? { permissionProfileId: body.permissionProfileId } : {}),
        ...(body.compatibilityMinAppVersion
          ? { compatibilityMinAppVersion: body.compatibilityMinAppVersion }
          : {}),
        ...(body.compatibilityMaxAppVersion
          ? { compatibilityMaxAppVersion: body.compatibilityMaxAppVersion }
          : {}),
        ...(options.env.APP_RUNTIME_VERSION ? { appRuntimeVersion: options.env.APP_RUNTIME_VERSION } : {})
      });
      const policy = evaluatePublishPolicy({
        declaredRiskLevel: body.riskLevel,
        permissions: manifestValidation.normalizedPermissions
      });

      const artifactUri = body.artifactUri ?? options.artifactStore.toArtifactUri(digest);
      const artifactBytes = artifactExists ? await options.artifactStore.readDigest(digest) : null;
      const scanResult: { status: "clean" | "blocked"; provider: string; reason?: string } = artifactBytes
        ? await options.artifactScanner.scan({
            digest,
            artifactBytes,
            manifest: manifestValidation.normalizedManifest
          })
        : { status: "clean", provider: "remote-uri" as const };

      return {
        data: {
          dryRun: true,
          skillId: body.skillId,
          version: body.version,
          digest,
          artifactUri,
          entrypoint,
          policy,
          scan: scanResult,
          appliedPermissionProfileId: manifestValidation.appliedPermissionProfileId,
          normalizedManifest: manifestValidation.normalizedManifest,
          normalizedPermissions: manifestValidation.normalizedPermissions
        }
      };
    } catch (error) {
      return handleAdminRouteError(
        app,
        reply,
        options.metrics,
        error,
        "Failed to dry-run publish validation."
      );
    }
  });

  app.post("/v1/admin/skills/publish", async (request, reply) => {
    const access = ensureAdminAccess(options.env, request.headers as Record<string, unknown>);
    if (!access.ok) {
      return reply.code(access.statusCode).send({ message: access.message });
    }

    if (!options.dbPool) {
      return reply.code(503).send({ message: "DATABASE_URL is not configured." });
    }

    try {
      const body = publishRequestSchema.parse(request.body);
      const digest = resolvePublishDigest(body);
      const entrypoint = resolveEntrypoint(body);
      const preflight = body.runtime === "command" ? assertPublishPreflight(body, digest) : null;
      const artifactExists = await options.artifactStore.hasDigest(digest);

      if (!artifactExists && !body.artifactUri) {
        options.metrics.recordPublishAttempt(false);
        return reply.code(400).send({
          message: "Artifact digest not found in local storage. Upload first or provide artifactUri."
        });
      }

      const manifestValidation = validateAndNormalizePublishManifest({
        skillId: body.skillId,
        implementationKey: body.implementationKey,
        name: body.name,
        description: body.description,
        version: body.version,
        runtime: body.runtime,
        entrypoint,
        manifest: body.manifest,
        inputSchema: body.inputSchema,
        outputSchema: body.outputSchema,
        healthcheck: body.healthcheck,
        heartbeatPolicy: body.heartbeatPolicy,
        permissions: body.permissions,
        ...(body.permissionProfileId ? { permissionProfileId: body.permissionProfileId } : {}),
        ...(body.compatibilityMinAppVersion
          ? { compatibilityMinAppVersion: body.compatibilityMinAppVersion }
          : {}),
        ...(body.compatibilityMaxAppVersion
          ? { compatibilityMaxAppVersion: body.compatibilityMaxAppVersion }
          : {}),
        ...(options.env.APP_RUNTIME_VERSION ? { appRuntimeVersion: options.env.APP_RUNTIME_VERSION } : {})
      });
      const policy = evaluatePublishPolicy({
        declaredRiskLevel: body.riskLevel,
        permissions: manifestValidation.normalizedPermissions
      });

      if (policy.status === "rejected") {
        options.metrics.recordValidationFailure();
        options.metrics.recordPublishAttempt(false);
        return reply.code(422).send({
          message: policy.summary,
          policy
        });
      }

      const artifactUri = body.artifactUri ?? options.artifactStore.toArtifactUri(digest);
      const artifactBytes = artifactExists ? await options.artifactStore.readDigest(digest) : null;
      const scanResult: { status: "clean" | "blocked"; provider: string; reason?: string } = artifactBytes
        ? await options.artifactScanner.scan({
            digest,
            artifactBytes,
            manifest: manifestValidation.normalizedManifest
          })
        : { status: "clean", provider: "remote-uri" as const };

      if (scanResult.status === "blocked") {
        options.metrics.recordPublishAttempt(false);
        return reply.code(422).send({
          message: "Artifact blocked by scanner.",
          reason: scanResult.reason
        });
      }

      const signedDigest = options.signatureService.signDigest(digest);
      const tx = await options.dbPool.connect();

      try {
        await tx.query("BEGIN");

        const skillUpsert = await tx.query<{ id: string }>(
          `
            INSERT INTO skills (
              id, skill_id, implementation_key, name, description, source, status, risk_level, metadata, created_at, updated_at
            )
            VALUES (
              gen_random_uuid(),
              $1::text,
              $2::text,
              $3::text,
              $4::text,
              $5::text,
              'active',
              $6::text,
              '{}'::jsonb,
              NOW(),
              NOW()
            )
            ON CONFLICT (skill_id)
            DO UPDATE SET
              implementation_key = EXCLUDED.implementation_key,
              name = EXCLUDED.name,
              description = EXCLUDED.description,
              source = EXCLUDED.source,
              risk_level = EXCLUDED.risk_level,
              status = 'active',
              updated_at = NOW()
            RETURNING id::text
          `,
          [
            body.skillId,
            body.implementationKey,
            body.name,
            body.description,
            body.source,
            policy.effectiveRiskLevel
          ]
        );

        const skillRefId = skillUpsert.rows[0]?.id;
        if (!skillRefId) {
          throw new Error("Failed to upsert skill.");
        }

        const versionUpsert = await tx.query<{ id: string }>(
          `
            INSERT INTO skill_versions (
              id,
              skill_ref_id,
              version,
              runtime,
              entrypoint,
              manifest,
              input_schema,
              output_schema,
              healthcheck,
              heartbeat_policy,
              artifact_uri,
              digest,
              signature,
              compatibility_min_app_version,
              compatibility_max_app_version,
              policy_status,
              review_status,
              trust_badge,
              trust_badge_metadata,
              published_at,
              revoked_at,
              created_at
            )
            VALUES (
              gen_random_uuid(),
              $1::uuid,
              $2::text,
              $3::text,
              $4::text,
              $5::jsonb,
              $6::jsonb,
              $7::jsonb,
              $8::jsonb,
              $9::jsonb,
              $10::text,
              $11::text,
              $12::text,
              $13::text,
              $14::text,
              'approved',
              'not_submitted',
              false,
              '{}'::jsonb,
              NOW(),
              NULL,
              NOW()
            )
            ON CONFLICT (skill_ref_id, version)
            DO UPDATE SET
              runtime = EXCLUDED.runtime,
              entrypoint = EXCLUDED.entrypoint,
              manifest = EXCLUDED.manifest,
              input_schema = EXCLUDED.input_schema,
              output_schema = EXCLUDED.output_schema,
              healthcheck = EXCLUDED.healthcheck,
              heartbeat_policy = EXCLUDED.heartbeat_policy,
              artifact_uri = EXCLUDED.artifact_uri,
              digest = EXCLUDED.digest,
              signature = EXCLUDED.signature,
              compatibility_min_app_version = EXCLUDED.compatibility_min_app_version,
              compatibility_max_app_version = EXCLUDED.compatibility_max_app_version,
              policy_status = 'approved',
              review_status = 'not_submitted',
              trust_badge = false,
              trust_badge_metadata = '{}'::jsonb,
              published_at = NOW(),
              revoked_at = NULL
            RETURNING id::text
          `,
          [
            skillRefId,
            body.version,
            body.runtime,
            entrypoint,
            JSON.stringify(manifestValidation.normalizedManifest),
            JSON.stringify(body.inputSchema),
            JSON.stringify(body.outputSchema),
            JSON.stringify(body.healthcheck),
            JSON.stringify(body.heartbeatPolicy),
            artifactUri,
            digest,
            signedDigest.signature,
            manifestValidation.compatibilityMinAppVersion,
            manifestValidation.compatibilityMaxAppVersion
          ]
        );

        const skillVersionId = versionUpsert.rows[0]?.id;
        if (!skillVersionId) {
          throw new Error("Failed to upsert skill version.");
        }

        await insertSkillPermissions(tx, skillVersionId, manifestValidation.normalizedPermissions);

        await insertPublicationEvent(tx, skillVersionId, "validated", {
          artifact_uri: artifactUri,
          digest,
          scanner: scanResult,
          policy
        });
        await insertPublicationEvent(tx, skillVersionId, "signed", {
          digest,
          signature: signedDigest.signature,
          signature_metadata: signedDigest.metadata
        });
        await insertPublicationEvent(tx, skillVersionId, "published", {
          skill_id: body.skillId,
          version: body.version,
          digest,
          preflight_run_id: preflight?.id ?? null,
          preflight_mode: preflight?.mode ?? null,
          signature_metadata: signedDigest.metadata
        });

        await tx.query("COMMIT");
        let abilitySynced = true;
        try {
          const abilityTx = await options.dbPool.connect();
          try {
            await abilityTx.query("BEGIN");
            await upsertAbilityForPublishedSkill(abilityTx, body);
            await abilityTx.query("COMMIT");
          } catch (abilityError) {
            abilitySynced = false;
            await abilityTx.query("ROLLBACK");
            app.log.warn(
              {
                error: abilityError,
                skillId: body.skillId,
                implementationKey: body.implementationKey
              },
              "ability sync failed during admin publish; publish committed"
            );
          } finally {
            abilityTx.release();
          }
        } catch (abilityConnectionError) {
          abilitySynced = false;
          app.log.warn(
            {
              error: abilityConnectionError,
              skillId: body.skillId,
              implementationKey: body.implementationKey
            },
            "ability sync connection failed during admin publish; publish committed"
          );
        }
        options.metrics.recordPublishAttempt(true);

        return {
          data: {
            skillId: body.skillId,
            version: body.version,
            digest,
            artifactUri,
            signature: signedDigest.signature,
            signatureMetadata: signedDigest.metadata,
            implementationKey: body.implementationKey,
            appliedPermissionProfileId: manifestValidation.appliedPermissionProfileId,
            reviewStatus: "not_submitted",
            trustBadge: false,
            preflightRunId: preflight?.id ?? null,
            preflightStatus: preflight?.status ?? null,
            policy,
            scan: scanResult,
            abilitySynced,
            published: true
          }
        };
      } catch (error) {
        await tx.query("ROLLBACK");
        throw error;
      } finally {
        tx.release();
      }
    } catch (error) {
      options.metrics.recordPublishAttempt(false);
      if (isPgUniqueViolation(error, "skill_versions_digest_key")) {
        return reply.code(409).send({
          message:
            "Artifact digest is already published by another skill/version. Update script contents or publish a new version with a different artifact digest."
        });
      }
      return handleAdminRouteError(
        app,
        reply,
        options.metrics,
        error,
        "Failed to publish skill version.",
        { includeErrorDetail: options.env.NODE_ENV !== "production" }
      );
    }
  });

  app.post("/v1/admin/skills/:skillId/versions/:version/revoke", async (request, reply) => {
    const access = ensureAdminAccess(options.env, request.headers as Record<string, unknown>);
    if (!access.ok) {
      return reply.code(access.statusCode).send({ message: access.message });
    }

    if (!options.dbPool) {
      return reply.code(503).send({ message: "DATABASE_URL is not configured." });
    }

    const params = revokeParamsSchema.parse(request.params);
    const body = revokeBodySchema.parse(request.body);
    const tx = await options.dbPool.connect();

    try {
      await tx.query("BEGIN");

      const updated = await tx.query<{ skillVersionId: string; skillRefId: string }>(
        `
          UPDATE skill_versions sv
          SET
            policy_status = 'revoked',
            revoked_at = NOW()
          FROM skills s
          WHERE sv.skill_ref_id = s.id
            AND s.skill_id = $1::text
            AND sv.version = $2::text
          RETURNING sv.id::text AS "skillVersionId", sv.skill_ref_id::text AS "skillRefId"
        `,
        [params.skillId, params.version]
      );

      const row = updated.rows[0];
      if (!row) {
        await tx.query("ROLLBACK");
        return reply.code(404).send({ message: "Skill version not found." });
      }

      const advisoryKey = `${params.skillId}:${params.version}:revocation:${Date.now()}`;

      await tx.query(
        `
          INSERT INTO skill_advisories (
            id,
            advisory_key,
            skill_ref_id,
            skill_version_id,
            advisory_type,
            severity,
            title,
            summary,
            metadata,
            published_at,
            created_at
          )
          VALUES (
            gen_random_uuid(),
            $1::text,
            $2::uuid,
            $3::uuid,
            'revocation',
            $4::text,
            $5::text,
            $6::text,
            $7::jsonb,
            NOW(),
            NOW()
          )
        `,
        [
          advisoryKey,
          row.skillRefId,
          row.skillVersionId,
          body.severity,
          body.title,
          body.summary,
          JSON.stringify({
            force_disable: true,
            applies_to: "single_version",
            reason: body.summary
          })
        ]
      );

      await insertPublicationEvent(tx, row.skillVersionId, "revoked", {
        skill_id: params.skillId,
        version: params.version,
        summary: body.summary
      });

      await tx.query("COMMIT");
      options.metrics.recordAdvisoryPublished();

      return {
        data: {
          skillId: params.skillId,
          version: params.version,
          revoked: true
        }
      };
    } catch (error) {
      await tx.query("ROLLBACK");
      app.log.error(error, "admin revoke failed");
      return reply.code(500).send({ message: "Failed to revoke skill version." });
    } finally {
      tx.release();
    }
  });

  app.post("/v1/admin/skills/:skillId/versions/:version/review", async (request, reply) => {
    const access = ensureAdminAccess(options.env, request.headers as Record<string, unknown>);
    if (!access.ok) {
      return reply.code(access.statusCode).send({ message: access.message });
    }
    if (!options.dbPool) {
      return reply.code(503).send({ message: "DATABASE_URL is not configured." });
    }

    const { skillId, version } = revokeParamsSchema.parse(request.params);
    const body = reviewRequestSchema.parse(request.body);
    const tx = await options.dbPool.connect();
    try {
      await tx.query("BEGIN");
      const update = await tx.query<{
        skillVersionId: string;
        trustBadge: boolean;
        reviewStatus: "not_submitted" | "in_review" | "approved" | "rejected";
      }>(
        `
          UPDATE skill_versions sv
          SET
            review_status = $3::text,
            trust_badge = CASE
              WHEN $3::text = 'approved' AND $4::bool = true THEN true
              ELSE false
            END,
            trust_badge_metadata = jsonb_build_object(
              'summary', $5::text,
              'checks', $6::jsonb,
              'reviewed_at', NOW()::text
            )
          FROM skills s
          WHERE sv.skill_ref_id = s.id
            AND s.skill_id = $1::text
            AND sv.version = $2::text
          RETURNING
            sv.id::text AS "skillVersionId",
            sv.trust_badge AS "trustBadge",
            sv.review_status AS "reviewStatus"
        `,
        [
          skillId,
          version,
          body.reviewStatus,
          body.trustedBadgeEligible,
          body.summary,
          JSON.stringify(body.checks || {})
        ]
      );
      const row = update.rows[0];
      if (!row) {
        await tx.query("ROLLBACK");
        return reply.code(404).send({ message: "Skill version not found." });
      }

      await insertPublicationEvent(tx, row.skillVersionId, "approved", {
        review_status: body.reviewStatus,
        trusted_badge: row.trustBadge,
        summary: body.summary,
        checks: body.checks ?? {}
      });
      await tx.query("COMMIT");
      return {
        data: {
          skillId,
          version,
          reviewStatus: row.reviewStatus,
          trustBadge: row.trustBadge
        }
      };
    } catch (error) {
      await tx.query("ROLLBACK");
      app.log.error(error, "admin review update failed");
      return reply.code(500).send({ message: "Failed to update review status." });
    } finally {
      tx.release();
    }
  });
};
