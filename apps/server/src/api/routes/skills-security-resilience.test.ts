import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

import { adminSkillRoutes } from "./admin-skills.js";
import { skillRoutes } from "./skills.js";
import type { AppEnv } from "../../security/env.js";
import { signTestJwt } from "../../security/request-auth.js";
import { MetricsService } from "../../services/metrics-service.js";
import { InMemoryRateLimiter } from "../../services/rate-limiter.js";
import { HmacSignatureService } from "../../services/signature-service.js";
import type { SkillRepository } from "../../repositories/skill-repository.js";

const TEST_JWT_SECRET = "phase6-jwt-secret";

vi.mock("../../services/runtime-environment-builder.js", () => ({
  ensureRuntimeEnvironmentReady: async () => ({
    runtimeEnvironmentId: "runtime-env-test"
  })
}));

function createEnv(overrides?: Partial<AppEnv>): AppEnv {
  return {
    NODE_ENV: "test",
    HOST: "127.0.0.1",
    PORT: 4010,
    LOG_LEVEL: "error",
    SUPABASE_URL: undefined,
    JWT_JWKS_URL: undefined,
    JWT_SECRET: TEST_JWT_SECRET,
    JWT_ISSUER: undefined,
    JWT_AUDIENCE: "authenticated",
    JWT_REQUIRE_AUTHENTICATED_ROLE: true,
    JWT_CLOCK_SKEW_SECONDS: 30,
    DATABASE_URL: "postgres://phase6-security",
    DATABASE_SSL: false,
    DATABASE_POOL_MAX: 2,
    ARTIFACT_STORAGE_DIR: ".unused",
    ARTIFACT_MAX_BYTES: 1024 * 1024,
    ENABLE_HEURISTIC_ARTIFACT_SCANNER: false,
    SIGNING_SECRET: "phase6-signing-secret",
    SIGNING_KEY_ID: "phase6-signing-key",
    APP_RUNTIME_VERSION: "1.0.0",
    ENABLE_ADMIN_API: true,
    ADMIN_API_TOKEN: "admin-token",
    PUBLIC_API_RATE_LIMIT_MAX: 120,
    PUBLIC_API_RATE_LIMIT_WINDOW_SECONDS: 60,
    ...overrides
  };
}

function authHeader(userId = "11111111-1111-4111-8111-111111111111"): Record<string, string> {
  const token = signTestJwt(
    {
      sub: userId,
      aud: "authenticated",
      role: "authenticated",
      exp: Math.floor(Date.now() / 1000) + 3600
    },
    TEST_JWT_SECRET
  );

  return {
    authorization: `Bearer ${token}`
  };
}

const emptyRepository: SkillRepository = {
  async listSkills() {
    return [];
  },
  async getSkill() {
    return null;
  },
  async getSkillVersion() {
    return null;
  },
  async listAdvisories() {
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

describe("skills security and resilience", () => {
  const appsToClose: FastifyInstance[] = [];

  afterEach(async () => {
    await Promise.all(appsToClose.map(async (app) => app.close()));
    appsToClose.length = 0;
  });

  it("forces disable during runtime handshake when version is revoked", async () => {
    const env = createEnv();
    const app = Fastify({ logger: false });
    appsToClose.push(app);

    const dbPool = {
      async query<T>(text: string): Promise<{ rows: T[]; rowCount: number }> {
        if (text.includes("FROM skills s") && text.includes("LEFT JOIN skill_installs")) {
          return {
            rows: [
              {
                skillRefId: "skill-ref-id",
                implementationKey: "coreagent.phase6.security",
                name: "Phase 6 Security Skill",
                riskLevel: "high",
                runtime: "command",
                entrypoint: "scripts/run.sh",
                artifactUri: "artifact://sha256/a".padEnd(82, "a"),
                digest: "a".repeat(64),
                signature: "hmac-sha256.sig",
                compatibilityMinAppVersion: null,
                compatibilityMaxAppVersion: null,
                policyStatus: "revoked",
                revokedAt: "2026-02-17T00:00:00.000Z",
                installId: "install-id",
                installState: "installed",
                autoUpdate: true,
                installConfig: {},
                pinnedVersion: "1.0.0"
              } as T
            ],
            rowCount: 1
          };
        }

        if (text.includes("FROM skill_permissions sp")) {
          return {
            rows: [],
            rowCount: 0
          };
        }

        if (text.includes("FROM skill_advisories sa")) {
          return {
            rows: [],
            rowCount: 0
          };
        }

        throw new Error(`Unhandled SQL in test pool: ${text.slice(0, 64)}`);
      }
    };

    await app.register(skillRoutes, {
      repository: emptyRepository,
      dbPool: dbPool as never,
      env,
      metrics: new MetricsService(),
      rateLimiter: new InMemoryRateLimiter(100, 60_000)
    });

    const response = await app.inject({
      method: "GET",
      url: "/v1/runtime/skills/coreagent.phase6.security/versions/1.0.0/handshake",
      headers: authHeader()
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      data: {
        forceDisable: { required: boolean; reason: string | null };
      };
    };
    expect(body.data.forceDisable.required).toBe(true);
    expect(body.data.forceDisable.reason).toBe("Skill version is revoked.");
  });

  it("returns 500 for artifact upload storage failure", async () => {
    const env = createEnv();
    const app = Fastify({ logger: false });
    appsToClose.push(app);

    await app.register(adminSkillRoutes, {
      env,
      dbPool: null,
      artifactStore: {
        async putArtifact() {
          throw new Error("storage offline");
        }
      } as never,
      artifactScanner: {
        async scan() {
          return { status: "clean", provider: "test" } as const;
        }
      },
      signatureService: new HmacSignatureService(env.SIGNING_SECRET, env.SIGNING_KEY_ID),
      metrics: new MetricsService()
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/admin/artifacts/upload",
      headers: {
        "x-admin-token": env.ADMIN_API_TOKEN ?? ""
      },
      payload: {
        artifactBase64: Buffer.from("phase6", "utf8").toString("base64")
      }
    });

    expect(response.statusCode).toBe(500);
  });

  it("returns 503 for publish when signing secret is missing", async () => {
    const env = createEnv({
      SIGNING_SECRET: undefined
    });
    const app = Fastify({ logger: false });
    appsToClose.push(app);

    const dbPool = {
      async connect() {
        return {
          async query<T>() {
            return { rows: [] as T[], rowCount: 0 };
          },
          release() {}
        };
      }
    };

    await app.register(adminSkillRoutes, {
      env,
      dbPool: dbPool as never,
      artifactStore: {
        async hasDigest() {
          return true;
        },
        async readDigest() {
          return Buffer.from("phase6", "utf8");
        },
        toArtifactUri(digest: string) {
          return `artifact://sha256/${digest}`;
        }
      } as never,
      artifactScanner: {
        async scan() {
          return { status: "clean", provider: "test" } as const;
        }
      },
      signatureService: new HmacSignatureService(env.SIGNING_SECRET, env.SIGNING_KEY_ID),
      metrics: new MetricsService()
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/admin/skills/publish",
      headers: {
        "x-admin-token": env.ADMIN_API_TOKEN ?? ""
      },
      payload: {
        skillId: "coreagent.phase6.signing",
        implementationKey: "coreagent.phase6.signing",
        name: "Phase 6 Signing Skill",
        description: "Validates signing failure path.",
        version: "1.0.0",
        runtime: "command",
        entrypoint: "scripts/run.sh",
        artifactDigest: "a".repeat(64),
        permissions: []
      }
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      message: "Docker preflight is required before publish. Run /v1/admin/skills/preflight first."
    });
  });

  it("records handshake failures and blocked execution reasons metrics", async () => {
    const env = createEnv();
    const app = Fastify({ logger: false });
    appsToClose.push(app);
    const metrics = new MetricsService();

    const dbPool = {
      async query<T>(text: string): Promise<{ rows: T[]; rowCount: number }> {
        if (text.includes("FROM skills s") && text.includes("LEFT JOIN skill_installs")) {
          return {
            rows: [
              {
                skillRefId: "skill-ref-id",
                implementationKey: "coreagent.phase6.metrics",
                name: "Phase 6 Metrics Skill",
                riskLevel: "high",
                runtime: "command",
                entrypoint: "scripts/run.sh",
                artifactUri: "artifact://sha256/a".padEnd(82, "a"),
                digest: "a".repeat(64),
                signature: "hmac-sha256.sig",
                compatibilityMinAppVersion: null,
                compatibilityMaxAppVersion: null,
                policyStatus: "rejected",
                revokedAt: null,
                installId: null,
                installState: null,
                autoUpdate: null,
                installConfig: {},
                pinnedVersion: null
              } as T
            ],
            rowCount: 1
          };
        }
        if (text.includes("FROM skill_permissions sp")) {
          return { rows: [], rowCount: 0 };
        }
        if (text.includes("FROM skill_advisories sa")) {
          return { rows: [], rowCount: 0 };
        }
        throw new Error(`Unhandled SQL in test pool: ${text.slice(0, 64)}`);
      }
    };

    await app.register(skillRoutes, {
      repository: emptyRepository,
      dbPool: dbPool as never,
      env,
      metrics,
      rateLimiter: new InMemoryRateLimiter(100, 60_000)
    });

    const unauthorized = await app.inject({
      method: "GET",
      url: "/v1/runtime/skills/coreagent.phase6.metrics/versions/1.0.0/handshake"
    });
    expect(unauthorized.statusCode).toBe(401);

    const handshake = await app.inject({
      method: "GET",
      url: "/v1/runtime/skills/coreagent.phase6.metrics/versions/1.0.0/handshake",
      headers: authHeader()
    });
    expect(handshake.statusCode).toBe(200);

    const snapshot = metrics.snapshot();
    expect(snapshot.handshake.failures).toBe(1);
    expect(snapshot.runtimeGate.blockedExecutionsByReason["policy_status:rejected"]).toBe(1);
    expect(snapshot.runtimeGate.blockedExecutionsByReason.install_missing).toBe(1);
  });

  it("covers install -> assign -> runtime validate and revocation force-disable lifecycle", async () => {
    const env = createEnv();
    const app = Fastify({ logger: false });
    appsToClose.push(app);

    const state = {
      installState: null as string | null,
      installId: "install-lifecycle-1",
      revoked: false,
      agentId: "22222222-2222-4222-8222-222222222222"
    };

    const dbPool = {
      async query<T>(text: string, values: unknown[]): Promise<{ rows: T[]; rowCount: number }> {
        if (
          text.includes("FROM skills s") &&
          text.includes("WHERE s.skill_id = $1::text") &&
          text.includes("status <> 'disabled'") &&
          !text.includes("abilityId")
        ) {
          return {
            rows: [{ skillRefId: "skill-ref", implementationKey: "coreagent.phase6.lifecycle" } as T],
            rowCount: 1
          };
        }
        if (text.includes("FROM skill_versions sv") && text.includes("sv.version = $2::text")) {
          return {
            rows: [{ skillVersionId: "skill-version-ref", version: "1.0.0", digest: "b".repeat(64) } as T],
            rowCount: 1
          };
        }
        if (text.includes("INSERT INTO skill_installs")) {
          state.installState = "resolving";
          return {
            rows: [{ installId: state.installId } as T],
            rowCount: 1
          };
        }
        if (text.includes("UPDATE skill_installs") && text.includes("install_state = 'ready'")) {
          state.installState = "ready";
          return { rows: [] as T[], rowCount: 1 };
        }
        if (text.includes("LEFT JOIN abilities ab")) {
          return {
            rows: [
              {
                skillRefId: "skill-ref",
                implementationKey: "coreagent.phase6.lifecycle",
                abilityId: "ability-id"
              } as T
            ],
            rowCount: 1
          };
        }
        if (text.includes("install_state IN ('installed', 'ready')")) {
          return {
            rows: state.installState === "ready" ? ([{ id: state.installId }] as T[]) : [],
            rowCount: state.installState === "ready" ? 1 : 0
          };
        }
        if (text.includes("FROM agents a")) {
          const requestedAgent = String(values[0] ?? "");
          return {
            rows: requestedAgent === state.agentId ? ([{ id: state.agentId }] as T[]) : [],
            rowCount: requestedAgent === state.agentId ? 1 : 0
          };
        }
        if (text.includes("INSERT INTO agent_abilities")) {
          return {
            rows: [{ agentAbilityId: "agent-ability-id" } as T],
            rowCount: 1
          };
        }
        if (text.includes("FROM skills s") && text.includes("LEFT JOIN skill_installs")) {
          return {
            rows: [
              {
                skillRefId: "skill-ref",
                implementationKey: "coreagent.phase6.lifecycle",
                name: "Phase 6 Lifecycle Skill",
                riskLevel: "moderate",
                runtime: "command",
                entrypoint: "scripts/run.sh",
                artifactUri: `artifact://sha256/${"b".repeat(64)}`,
                digest: "b".repeat(64),
                signature: "hmac-sha256.sig",
                compatibilityMinAppVersion: null,
                compatibilityMaxAppVersion: null,
                policyStatus: "approved",
                revokedAt: state.revoked ? "2026-02-26T00:00:00.000Z" : null,
                installId: state.installState === "ready" ? state.installId : null,
                installState: state.installState,
                autoUpdate: true,
                installConfig: {},
                pinnedVersion: "1.0.0"
              } as T
            ],
            rowCount: 1
          };
        }
        if (text.includes("FROM skill_permissions sp")) {
          return { rows: [], rowCount: 0 };
        }
        if (text.includes("FROM skill_advisories sa")) {
          if (!state.revoked) {
            return { rows: [], rowCount: 0 };
          }
          return {
            rows: [
              {
                advisoryId: "adv-1",
                advisoryType: "revocation",
                title: "Revoked",
                summary: "Version revoked via advisory.",
                severity: "critical",
                publishedAt: "2026-02-26T00:00:00.000Z",
                metadata: { force_disable: true }
              } as T
            ],
            rowCount: 1
          };
        }
        throw new Error(`Unhandled SQL in lifecycle test pool: ${text.slice(0, 80)}`);
      }
    };

    await app.register(skillRoutes, {
      repository: emptyRepository,
      dbPool: dbPool as never,
      env,
      metrics: new MetricsService(),
      rateLimiter: new InMemoryRateLimiter(100, 60_000)
    });

    const install = await app.inject({
      method: "POST",
      url: "/v1/skills/coreagent.phase6.lifecycle/install",
      headers: authHeader(),
      payload: {
        version: "1.0.0",
        autoUpdate: true,
        installConfig: {}
      }
    });
    expect(install.statusCode).toBe(200);

    const assign = await app.inject({
      method: "POST",
      url: "/v1/skills/coreagent.phase6.lifecycle/assign",
      headers: authHeader(),
      payload: {
        agentId: state.agentId,
        enabled: true,
        config: {}
      }
    });
    expect(assign.statusCode).toBe(200);

    const validate = await app.inject({
      method: "GET",
      url: "/v1/runtime/skills/coreagent.phase6.lifecycle/versions/1.0.0/handshake",
      headers: authHeader()
    });
    expect(validate.statusCode).toBe(200);
    expect(validate.json()).toMatchObject({
      data: {
        install: { installed: true, installState: "ready" },
        forceDisable: { required: false }
      }
    });

    state.revoked = true;
    const revokedValidate = await app.inject({
      method: "GET",
      url: "/v1/runtime/skills/coreagent.phase6.lifecycle/versions/1.0.0/handshake",
      headers: authHeader()
    });
    expect(revokedValidate.statusCode).toBe(200);
    expect(revokedValidate.json()).toMatchObject({
      data: {
        forceDisable: { required: true }
      }
    });
  });

  it("records advisory feed recovery after transient failure", async () => {
    const env = createEnv();
    const app = Fastify({ logger: false });
    appsToClose.push(app);
    const metrics = new MetricsService();
    let failOnce = true;

    const recoveringRepository: SkillRepository = {
      ...emptyRepository,
      async listAdvisoryFeed() {
        if (failOnce) {
          failOnce = false;
          throw new Error("registry temporarily unavailable");
        }
        return {
          advisories: [
            {
              id: "adv-recover-1",
              skillId: "coreagent.phase6.lifecycle",
              version: "1.0.0",
              advisoryType: "warning",
              severity: "moderate",
              title: "Recovery advisory",
              summary: "Recovered",
              sequenceCursor: "42",
              forceDisable: false,
              publishedAt: new Date(Date.now() - 2_000).toISOString(),
              resolvedAt: null
            }
          ],
          nextCursor: null,
          hasMore: false
        };
      }
    };

    await app.register(skillRoutes, {
      repository: recoveringRepository,
      dbPool: null,
      env,
      metrics,
      rateLimiter: new InMemoryRateLimiter(100, 60_000)
    });

    const first = await app.inject({ method: "GET", url: "/v1/advisories/feed?limit=5" });
    expect(first.statusCode).toBe(500);

    const second = await app.inject({ method: "GET", url: "/v1/advisories/feed?limit=5" });
    expect(second.statusCode).toBe(200);

    const snapshot = metrics.snapshot();
    expect(snapshot.advisories.propagationFailures).toBe(1);
    expect(snapshot.advisories.propagationLagMs.samples).toBeGreaterThanOrEqual(1);
  });

  it("blocks permission escalation when assigning to another user's agent", async () => {
    const env = createEnv();
    const app = Fastify({ logger: false });
    appsToClose.push(app);

    const dbPool = {
      async query<T>(text: string): Promise<{ rows: T[]; rowCount: number }> {
        if (text.includes("LEFT JOIN abilities ab")) {
          return {
            rows: [
              {
                skillRefId: "skill-ref",
                implementationKey: "coreagent.phase6.escalation",
                abilityId: "ability-id"
              } as T
            ],
            rowCount: 1
          };
        }
        if (text.includes("install_state IN ('installed', 'ready')")) {
          return {
            rows: [{ id: "install-id" } as T],
            rowCount: 1
          };
        }
        if (text.includes("FROM agents a")) {
          return { rows: [], rowCount: 0 };
        }
        throw new Error(`Unhandled SQL in escalation test pool: ${text.slice(0, 80)}`);
      }
    };

    await app.register(skillRoutes, {
      repository: emptyRepository,
      dbPool: dbPool as never,
      env,
      metrics: new MetricsService(),
      rateLimiter: new InMemoryRateLimiter(100, 60_000)
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/skills/coreagent.phase6.escalation/assign",
      headers: authHeader(),
      payload: {
        agentId: "33333333-3333-4333-8333-333333333333",
        enabled: true,
        config: {}
      }
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ message: "Agent not found." });
  });

  it("does not leak bearer token values in auth failure responses", async () => {
    const env = createEnv();
    const app = Fastify({ logger: false });
    appsToClose.push(app);

    await app.register(skillRoutes, {
      repository: emptyRepository,
      dbPool: null,
      env,
      metrics: new MetricsService(),
      rateLimiter: new InMemoryRateLimiter(100, 60_000)
    });

    const rawToken = "raw-super-secret-token-value";
    const response = await app.inject({
      method: "GET",
      url: "/v1/skills/installed",
      headers: {
        authorization: `Bearer ${rawToken}`
      }
    });

    expect(response.statusCode).toBe(401);
    const bodyText = response.body;
    expect(bodyText).not.toContain(rawToken);
    expect(bodyText.toLowerCase()).not.toContain("bearer raw-super-secret-token-value");
  });
});
