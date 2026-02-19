import { rm } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "../../app.js";
import type { AppEnv } from "../../security/env.js";
import { signTestJwt } from "../../security/request-auth.js";

const TEST_JWT_SECRET = "test-jwt-secret";
const TEST_ARTIFACT_DIR = join(process.cwd(), ".test-artifacts");

const testEnv: AppEnv = {
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
  DATABASE_URL: undefined,
  DATABASE_SSL: false,
  DATABASE_POOL_MAX: 10,
  ARTIFACT_STORAGE_DIR: TEST_ARTIFACT_DIR,
  ARTIFACT_MAX_BYTES: 1024 * 1024,
  ENABLE_HEURISTIC_ARTIFACT_SCANNER: false,
  SIGNING_SECRET: "test-signing-secret",
  SIGNING_KEY_ID: "test-key-id",
  APP_RUNTIME_VERSION: "1.0.0",
  ENABLE_ADMIN_API: false,
  ADMIN_API_TOKEN: undefined,
  PUBLIC_API_RATE_LIMIT_MAX: 120,
  PUBLIC_API_RATE_LIMIT_WINDOW_SECONDS: 60
};

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

describe("skills registry routes", () => {
  const appsToClose: ReturnType<typeof buildApp>[] = [];

  afterEach(async () => {
    await Promise.all(appsToClose.map(async (app) => app.close()));
    appsToClose.length = 0;
    await rm(TEST_ARTIFACT_DIR, { recursive: true, force: true });
  });

  it("returns health response", async () => {
    const app = buildApp(testEnv);
    appsToClose.push(app);

    const response = await app.inject({
      method: "GET",
      url: "/health"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: "ok",
      service: "skills-registry"
    });
    expect(response.headers["x-correlation-id"]).toBeDefined();
  });

  it("returns ready=not_ready when database is not configured", async () => {
    const app = buildApp(testEnv);
    appsToClose.push(app);

    const response = await app.inject({
      method: "GET",
      url: "/ready"
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      status: "not_ready",
      service: "skills-registry"
    });
  });

  it("returns diagnostics payload with metrics snapshot", async () => {
    const app = buildApp(testEnv);
    appsToClose.push(app);

    const response = await app.inject({
      method: "GET",
      url: "/diagnostics"
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      diagnostics: {
        metrics: {
          requests: { total: number };
          publish: { total: number };
        };
      };
    };
    expect(body.diagnostics.metrics.requests.total).toBeGreaterThanOrEqual(0);
    expect(body.diagnostics.metrics.publish.total).toBeGreaterThanOrEqual(0);
  });

  it("returns runtime health payload when database is not configured", async () => {
    const app = buildApp(testEnv);
    appsToClose.push(app);

    const response = await app.inject({
      method: "GET",
      url: "/v1/runtime/health"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      service: "skills-runtime",
      checks: {
        database: "unconfigured"
      }
    });
  });

  it("lists skills", async () => {
    const app = buildApp(testEnv);
    appsToClose.push(app);

    const response = await app.inject({
      method: "GET",
      url: "/v1/skills"
    });

    expect(response.statusCode).toBe(200);
    const data = response.json() as { data: Array<{ skillId: string }> };
    expect(data.data.length).toBeGreaterThan(0);
    const firstSkill = data.data[0];
    expect(firstSkill).toBeDefined();
    expect(firstSkill?.skillId).toBe("coreagent.repo.search");
  });

  it("returns advisory feed page envelope", async () => {
    const app = buildApp(testEnv);
    appsToClose.push(app);

    const response = await app.inject({
      method: "GET",
      url: "/v1/advisories/feed?limit=10"
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { data: unknown[]; page: { nextCursor: string | null; hasMore: boolean } };
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.page).toMatchObject({
      nextCursor: null,
      hasMore: false
    });
  });

  it("rate limits public catalog APIs after configured threshold", async () => {
    const app = buildApp({
      ...testEnv,
      PUBLIC_API_RATE_LIMIT_MAX: 2,
      PUBLIC_API_RATE_LIMIT_WINDOW_SECONDS: 60
    });
    appsToClose.push(app);

    const first = await app.inject({
      method: "GET",
      url: "/v1/skills"
    });
    const second = await app.inject({
      method: "GET",
      url: "/v1/skills"
    });
    const third = await app.inject({
      method: "GET",
      url: "/v1/skills"
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(third.statusCode).toBe(429);
    expect(third.headers["retry-after"]).toBeDefined();
  });

  it("returns 404 when admin API is disabled", async () => {
    const app = buildApp(testEnv);
    appsToClose.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/v1/admin/skills/publish",
      payload: {}
    });

    expect(response.statusCode).toBe(404);
  });

  it("returns 401 when admin token is missing", async () => {
    const app = buildApp({
      ...testEnv,
      ENABLE_ADMIN_API: true,
      ADMIN_API_TOKEN: "test-token"
    });
    appsToClose.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/v1/admin/skills/publish",
      payload: {}
    });

    expect(response.statusCode).toBe(401);
  });

  it("returns 503 when admin API is enabled but DATABASE_URL is missing", async () => {
    const app = buildApp({
      ...testEnv,
      ENABLE_ADMIN_API: true,
      ADMIN_API_TOKEN: "test-token"
    });
    appsToClose.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/v1/admin/skills/publish",
      headers: {
        "x-admin-token": "test-token"
      },
      payload: {}
    });

    expect(response.statusCode).toBe(503);
  });

  it("uploads artifact with digest-keyed storage", async () => {
    const app = buildApp({
      ...testEnv,
      ENABLE_ADMIN_API: true,
      ADMIN_API_TOKEN: "test-token"
    });
    appsToClose.push(app);

    const artifactPayload = Buffer.from("echo hello from skills registry", "utf8").toString("base64");
    const response = await app.inject({
      method: "POST",
      url: "/v1/admin/artifacts/upload",
      headers: {
        "x-admin-token": "test-token"
      },
      payload: {
        artifactBase64: artifactPayload
      }
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { data: { digest: string; artifactUri: string; sizeBytes: number } };
    expect(body.data.digest).toMatch(/^[a-f0-9]{64}$/);
    expect(body.data.artifactUri).toBe(`artifact://sha256/${body.data.digest}`);
    expect(body.data.sizeBytes).toBeGreaterThan(0);
  });

  it("returns 400 when artifact upload payload is not valid base64", async () => {
    const app = buildApp({
      ...testEnv,
      ENABLE_ADMIN_API: true,
      ADMIN_API_TOKEN: "test-token"
    });
    appsToClose.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/v1/admin/artifacts/upload",
      headers: {
        "x-admin-token": "test-token"
      },
      payload: {
        artifactBase64: "not-base64!!"
      }
    });

    expect(response.statusCode).toBe(400);
  });

  it("returns 401 when install is called without Authorization", async () => {
    const app = buildApp(testEnv);
    appsToClose.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/v1/skills/coreagent.repo.search/install",
      payload: {}
    });

    expect(response.statusCode).toBe(401);
  });

  it("returns 401 when Authorization token format is invalid", async () => {
    const app = buildApp(testEnv);
    appsToClose.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/v1/skills/coreagent.repo.search/install",
      headers: {
        authorization: "Bearer invalid"
      },
      payload: {}
    });

    expect(response.statusCode).toBe(401);
  });

  it("returns 401 when Authorization token subject is not a UUID", async () => {
    const app = buildApp(testEnv);
    appsToClose.push(app);

    const token = signTestJwt(
      {
        sub: "not-a-uuid",
        aud: "authenticated",
        role: "authenticated",
        exp: Math.floor(Date.now() / 1000) + 3600
      },
      TEST_JWT_SECRET
    );

    const response = await app.inject({
      method: "POST",
      url: "/v1/skills/coreagent.repo.search/install",
      headers: {
        authorization: `Bearer ${token}`
      },
      payload: {}
    });

    expect(response.statusCode).toBe(401);
  });

  it("returns 403 when JWT role is not authenticated", async () => {
    const app = buildApp(testEnv);
    appsToClose.push(app);

    const token = signTestJwt(
      {
        sub: "11111111-1111-4111-8111-111111111111",
        aud: "authenticated",
        role: "anon",
        exp: Math.floor(Date.now() / 1000) + 3600
      },
      TEST_JWT_SECRET
    );

    const response = await app.inject({
      method: "POST",
      url: "/v1/skills/coreagent.repo.search/install",
      headers: {
        authorization: `Bearer ${token}`
      },
      payload: {}
    });

    expect(response.statusCode).toBe(403);
  });

  it("returns 503 when install is called with valid JWT but no DATABASE_URL", async () => {
    const app = buildApp(testEnv);
    appsToClose.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/v1/skills/coreagent.repo.search/install",
      headers: authHeader(),
      payload: {}
    });

    expect(response.statusCode).toBe(503);
  });

  it("returns 503 when assign is called with valid JWT but no DATABASE_URL", async () => {
    const app = buildApp(testEnv);
    appsToClose.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/v1/skills/coreagent.repo.search/assign",
      headers: authHeader(),
      payload: {
        agentId: "22222222-2222-4222-8222-222222222222"
      }
    });

    expect(response.statusCode).toBe(503);
  });

  it("returns 401 when installed skills list is called without Authorization", async () => {
    const app = buildApp(testEnv);
    appsToClose.push(app);

    const response = await app.inject({
      method: "GET",
      url: "/v1/skills/installed"
    });

    expect(response.statusCode).toBe(401);
  });

  it("returns 503 when installed skills list is called with valid JWT but no DATABASE_URL", async () => {
    const app = buildApp(testEnv);
    appsToClose.push(app);

    const response = await app.inject({
      method: "GET",
      url: "/v1/skills/installed",
      headers: authHeader()
    });

    expect(response.statusCode).toBe(503);
  });

  it("returns 503 when agent skills list is called with valid JWT but no DATABASE_URL", async () => {
    const app = buildApp(testEnv);
    appsToClose.push(app);

    const response = await app.inject({
      method: "GET",
      url: "/v1/agents/22222222-2222-4222-8222-222222222222/skills",
      headers: authHeader()
    });

    expect(response.statusCode).toBe(503);
  });

  it("returns 503 when JWT_SECRET is not configured", async () => {
    const app = buildApp({
      ...testEnv,
      JWT_SECRET: undefined
    });
    appsToClose.push(app);

    const response = await app.inject({
      method: "GET",
      url: "/v1/skills/installed",
      headers: {
        authorization: "Bearer malformed.token.value"
      }
    });

    expect(response.statusCode).toBe(503);
  });

  it("returns 401 when runtime handshake is called without Authorization", async () => {
    const app = buildApp(testEnv);
    appsToClose.push(app);

    const response = await app.inject({
      method: "GET",
      url: "/v1/runtime/skills/coreagent.repo.search/versions/0.1.0/handshake"
    });

    expect(response.statusCode).toBe(401);
  });

  it("returns 503 when runtime handshake is called with valid JWT but no DATABASE_URL", async () => {
    const app = buildApp(testEnv);
    appsToClose.push(app);

    const response = await app.inject({
      method: "GET",
      url: "/v1/runtime/skills/coreagent.repo.search/versions/0.1.0/handshake",
      headers: authHeader()
    });

    expect(response.statusCode).toBe(503);
  });
});
