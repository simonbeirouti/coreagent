import { rm } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";

import { adminSkillRoutes } from "./admin-skills.js";
import { skillRoutes } from "./skills.js";
import type { AppEnv } from "../../security/env.js";
import type { SkillRepository } from "../../repositories/skill-repository.js";
import { LocalArtifactStore } from "../../services/artifact-store.js";
import { NoopArtifactScanner } from "../../services/artifact-scanner.js";
import { MetricsService } from "../../services/metrics-service.js";
import { InMemoryRateLimiter } from "../../services/rate-limiter.js";
import { HmacSignatureService } from "../../services/signature-service.js";
import type { SkillAdvisory, SkillDetails, SkillVersion } from "../../domain/skill.js";

const TEST_ARTIFACT_DIR = join(process.cwd(), ".test-artifacts-phase6-integration");

type PublishedSkillState = {
  skillRefId: string;
  skillVersionId: string;
  skillId: string;
  implementationKey: string;
  name: string;
  description: string;
  risk: "low" | "moderate" | "high";
  latestVersion: string;
  versions: SkillVersion[];
};

function createTestEnv(overrides?: Partial<AppEnv>): AppEnv {
  return {
    NODE_ENV: "test",
    HOST: "127.0.0.1",
    PORT: 4010,
    LOG_LEVEL: "error",
    SUPABASE_URL: undefined,
    JWT_JWKS_URL: undefined,
    JWT_SECRET: "test-jwt-secret",
    JWT_ISSUER: undefined,
    JWT_AUDIENCE: "authenticated",
    JWT_REQUIRE_AUTHENTICATED_ROLE: true,
    JWT_CLOCK_SKEW_SECONDS: 30,
    DATABASE_URL: "postgres://phase6-test",
    DATABASE_SSL: false,
    DATABASE_POOL_MAX: 2,
    ARTIFACT_STORAGE_DIR: TEST_ARTIFACT_DIR,
    ARTIFACT_MAX_BYTES: 1024 * 1024,
    ENABLE_HEURISTIC_ARTIFACT_SCANNER: false,
    SIGNING_SECRET: "test-signing-secret",
    SIGNING_KEY_ID: "phase6-test-key",
    APP_RUNTIME_VERSION: "1.0.0",
    ENABLE_ADMIN_API: true,
    ADMIN_API_TOKEN: "admin-token",
    PUBLIC_API_RATE_LIMIT_MAX: 120,
    PUBLIC_API_RATE_LIMIT_WINDOW_SECONDS: 60,
    ...overrides
  };
}

function createRepositoryFromState(state: { current: PublishedSkillState | null }): SkillRepository {
  return {
    async listSkills(_query?: string, options?: { trustedOnly?: boolean }) {
      if (!state.current) {
        return [];
      }
      const rows = [
        {
          skillId: state.current.skillId,
          name: state.current.name,
          description: state.current.description,
          latestVersion: state.current.latestVersion,
          risk: state.current.risk,
          trusted: false
        }
      ];
      return options?.trustedOnly ? [] : rows;
    },
    async getSkill(skillId: string): Promise<SkillDetails | null> {
      if (!state.current || state.current.skillId !== skillId) {
        return null;
      }
      return {
        skillId: state.current.skillId,
        name: state.current.name,
        description: state.current.description,
        latestVersion: state.current.latestVersion,
        risk: state.current.risk,
        versions: state.current.versions
      };
    },
    async getSkillVersion(skillId: string, version: string): Promise<SkillVersion | null> {
      if (!state.current || state.current.skillId !== skillId) {
        return null;
      }
      return state.current.versions.find((item) => item.version === version) ?? null;
    },
    async listAdvisories(): Promise<SkillAdvisory[]> {
      return [];
    },
    async listAdvisoryFeed() {
      return {
        advisories: [],
        nextCursor: null,
        hasMore: false
      };
    }
  };
}

function createPublishDbPool(state: { current: PublishedSkillState | null }) {
  const client = {
    async query<T>(text: string, values: unknown[] = []): Promise<{ rows: T[]; rowCount: number }> {
      if (text === "BEGIN" || text === "COMMIT" || text === "ROLLBACK") {
        return { rows: [], rowCount: 0 };
      }

      if (text.includes("INSERT INTO skills")) {
        const skillRefId = state.current?.skillRefId ?? randomUUID();
        state.current = {
          skillRefId,
          skillVersionId: state.current?.skillVersionId ?? randomUUID(),
          skillId: String(values[0] ?? ""),
          implementationKey: String(values[1] ?? ""),
          name: String(values[2] ?? ""),
          description: String(values[3] ?? ""),
          risk: (values[5] as "low" | "moderate" | "high") ?? "moderate",
          latestVersion: state.current?.latestVersion ?? "",
          versions: state.current?.versions ?? []
        };
        return {
          rows: [{ id: skillRefId } as T],
          rowCount: 1
        };
      }

      if (text.includes("INSERT INTO skill_versions")) {
        if (!state.current) {
          throw new Error("Skill must be inserted before version.");
        }

        const version = String(values[1] ?? "");
        const runtime = values[2] as "command" | "http" | "wasm";
        const entrypoint = String(values[3] ?? "");
        const artifactUri = String(values[9] ?? "");
        const digest = String(values[10] ?? "");
        const signature = String(values[11] ?? "");
        const compatibilityMinAppVersion = (values[12] as string | null) ?? null;
        const compatibilityMaxAppVersion = (values[13] as string | null) ?? null;
        const skillVersionId = state.current.skillVersionId;

        state.current.latestVersion = version;
        state.current.versions = [
          {
            version,
            digest,
            signature,
            runtime,
            entrypoint,
            artifactUri,
            compatibilityMinAppVersion,
            compatibilityMaxAppVersion,
            policyStatus: "approved",
            revokedAt: null,
            permissions: []
          }
        ];
        return {
          rows: [{ id: skillVersionId } as T],
          rowCount: 1
        };
      }

      if (text.includes("DELETE FROM skill_permissions")) {
        return { rows: [], rowCount: 0 };
      }

      if (text.includes("INSERT INTO skill_permissions")) {
        return { rows: [], rowCount: 1 };
      }

      if (text.includes("UPDATE abilities")) {
        return {
          rows: [{ id: randomUUID() } as T],
          rowCount: 1
        };
      }

      if (text.includes("INSERT INTO skill_publication_events")) {
        return { rows: [], rowCount: 1 };
      }

      throw new Error(`Unhandled SQL in test pool: ${text.slice(0, 64)}`);
    },
    release() {}
  };

  return {
    async connect() {
      return client;
    }
  };
}

describe("skills publish integration", () => {
  const appsToClose: FastifyInstance[] = [];

  afterEach(async () => {
    await Promise.all(appsToClose.map(async (app) => app.close()));
    appsToClose.length = 0;
    await rm(TEST_ARTIFACT_DIR, { recursive: true, force: true });
  });

  it("publishes a skill and exposes it in catalog/detail endpoints", async () => {
    const state: { current: PublishedSkillState | null } = { current: null };
    const env = createTestEnv();
    const app = Fastify({ logger: false });
    appsToClose.push(app);

    await app.register(adminSkillRoutes, {
      env,
      dbPool: createPublishDbPool(state) as never,
      artifactStore: new LocalArtifactStore(TEST_ARTIFACT_DIR, 1024 * 1024),
      artifactScanner: new NoopArtifactScanner(),
      signatureService: new HmacSignatureService(env.SIGNING_SECRET, env.SIGNING_KEY_ID),
      metrics: new MetricsService(),
      runDockerPreflight: async () => ({
        status: "passed",
        exitCode: 0,
        stdout: "ok",
        stderr: "",
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString()
      })
    });

    await app.register(skillRoutes, {
      repository: createRepositoryFromState(state),
      dbPool: null,
      env,
      metrics: new MetricsService(),
      rateLimiter: new InMemoryRateLimiter(100, 60_000)
    });

    const scriptPayload = Buffer.from("echo integration publish", "utf8").toString("base64");
    const uploadScript = await app.inject({
      method: "POST",
      url: "/v1/admin/artifacts/upload",
      headers: {
        "x-admin-token": env.ADMIN_API_TOKEN ?? ""
      },
      payload: {
        artifactBase64: scriptPayload
      }
    });
    expect(uploadScript.statusCode).toBe(200);
    const uploadScriptBody = uploadScript.json() as { data: { digest: string } };
    const examplePayload = Buffer.from("{\"message\":\"hello\"}", "utf8").toString("base64");
    const uploadExample = await app.inject({
      method: "POST",
      url: "/v1/admin/artifacts/upload",
      headers: {
        "x-admin-token": env.ADMIN_API_TOKEN ?? ""
      },
      payload: {
        artifactBase64: examplePayload
      }
    });
    expect(uploadExample.statusCode).toBe(200);
    const uploadExampleBody = uploadExample.json() as { data: { digest: string } };

    const preflight = await app.inject({
      method: "POST",
      url: "/v1/admin/skills/preflight",
      headers: {
        "x-admin-token": env.ADMIN_API_TOKEN ?? ""
      },
      payload: {
        title: "Phase 6 Integration Skill",
        scriptArtifactDigest: uploadScriptBody.data.digest,
        exampleArtifactDigest: uploadExampleBody.data.digest,
        mode: "local_docker"
      }
    });
    expect(preflight.statusCode).toBe(200);
    const preflightBody = preflight.json() as { data: { runId: string } };

    const publish = await app.inject({
      method: "POST",
      url: "/v1/admin/skills/publish",
      headers: {
        "x-admin-token": env.ADMIN_API_TOKEN ?? ""
      },
      payload: {
        skillId: "coreagent.phase6.integration",
        implementationKey: "coreagent.phase6.integration",
        name: "Phase 6 Integration Skill",
        description: "Verifies publish-to-catalog integration.",
        version: "1.2.3",
        runtime: "command",
        artifactDigest: uploadScriptBody.data.digest,
        preflightRunId: preflightBody.data.runId,
        permissions: []
      }
    });

    expect(publish.statusCode).toBe(200);

    const detail = await app.inject({
      method: "GET",
      url: "/v1/skills/coreagent.phase6.integration"
    });
    expect(detail.statusCode).toBe(200);
    const detailBody = detail.json() as { data: SkillDetails };
    expect(detailBody.data.latestVersion).toBe("1.2.3");
    expect(detailBody.data.versions).toHaveLength(1);

    const version = await app.inject({
      method: "GET",
      url: "/v1/skills/coreagent.phase6.integration/versions/1.2.3"
    });
    expect(version.statusCode).toBe(200);
    const versionBody = version.json() as { data: SkillVersion };
    expect(versionBody.data.digest).toBe(uploadScriptBody.data.digest);
    expect(versionBody.data.signature.startsWith("hmac-sha256.")).toBe(true);
  });

  it("blocks publish when docker preflight is missing", async () => {
    const state: { current: PublishedSkillState | null } = { current: null };
    const env = createTestEnv();
    const app = Fastify({ logger: false });
    appsToClose.push(app);

    await app.register(adminSkillRoutes, {
      env,
      dbPool: createPublishDbPool(state) as never,
      artifactStore: new LocalArtifactStore(TEST_ARTIFACT_DIR, 1024 * 1024),
      artifactScanner: new NoopArtifactScanner(),
      signatureService: new HmacSignatureService(env.SIGNING_SECRET, env.SIGNING_KEY_ID),
      metrics: new MetricsService(),
      runDockerPreflight: async () => ({
        status: "passed",
        exitCode: 0,
        stdout: "ok",
        stderr: "",
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString()
      })
    });

    const scriptPayload = Buffer.from("echo integration publish", "utf8").toString("base64");
    const uploadScript = await app.inject({
      method: "POST",
      url: "/v1/admin/artifacts/upload",
      headers: {
        "x-admin-token": env.ADMIN_API_TOKEN ?? ""
      },
      payload: {
        artifactBase64: scriptPayload
      }
    });
    expect(uploadScript.statusCode).toBe(200);
    const uploadBody = uploadScript.json() as { data: { digest: string } };

    const publish = await app.inject({
      method: "POST",
      url: "/v1/admin/skills/publish",
      headers: {
        "x-admin-token": env.ADMIN_API_TOKEN ?? ""
      },
      payload: {
        skillId: "coreagent.phase6.integration",
        implementationKey: "coreagent.phase6.integration",
        name: "Phase 6 Integration Skill",
        description: "Verifies publish gate behavior.",
        version: "1.2.3",
        runtime: "command",
        artifactDigest: uploadBody.data.digest,
        permissions: []
      }
    });

    expect(publish.statusCode).toBe(409);
  });
});
