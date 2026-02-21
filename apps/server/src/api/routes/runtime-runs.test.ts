import { rm } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "../../app.js";
import type { AppEnv } from "../../security/env.js";
import { signTestJwt } from "../../security/request-auth.js";

const TEST_JWT_SECRET = "runtime-runs-jwt-secret";
const TEST_ARTIFACT_DIR = join(process.cwd(), ".test-artifacts-runtime-runs");

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
  SIGNING_KEY_ID: "test-signing-key-id",
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

describe("runtime run routes", () => {
  const appsToClose: ReturnType<typeof buildApp>[] = [];

  afterEach(async () => {
    await Promise.all(appsToClose.map(async (app) => app.close()));
    appsToClose.length = 0;
    await rm(TEST_ARTIFACT_DIR, { recursive: true, force: true });
  });

  it("creates, fetches, and cancels a runtime run", async () => {
    const app = buildApp(testEnv);
    appsToClose.push(app);

    const createResponse = await app.inject({
      method: "POST",
      url: "/v1/runtime/runs",
      headers: authHeader(),
      payload: {
        skillId: "coreagent.repo.search",
        version: "1.0.0",
        executionMode: "remote",
        input: {
          query: "find integration tests"
        }
      }
    });

    expect(createResponse.statusCode).toBe(201);
    const created = createResponse.json() as {
      data: {
        runId: string;
        status: string;
      };
    };
    expect(created.data.status).toBe("queued");

    const getResponse = await app.inject({
      method: "GET",
      url: `/v1/runtime/runs/${created.data.runId}`,
      headers: authHeader()
    });

    expect(getResponse.statusCode).toBe(200);
    expect(getResponse.json()).toMatchObject({
      data: {
        runId: created.data.runId,
        status: "queued"
      }
    });

    const eventsResponse = await app.inject({
      method: "GET",
      url: `/v1/runtime/runs/${created.data.runId}/events`,
      headers: authHeader()
    });

    expect(eventsResponse.statusCode).toBe(200);
    const eventsBody = eventsResponse.json() as {
      data: Array<{ type: string; status?: string }>;
    };
    expect(eventsBody.data.length).toBeGreaterThanOrEqual(1);
    expect(eventsBody.data[0]).toMatchObject({
      type: "state_transition",
      status: "queued"
    });

    const cancelResponse = await app.inject({
      method: "POST",
      url: `/v1/runtime/runs/${created.data.runId}/cancel`,
      headers: authHeader()
    });

    expect(cancelResponse.statusCode).toBe(200);
    expect(cancelResponse.json()).toMatchObject({
      data: {
        runId: created.data.runId,
        status: "cancelled"
      }
    });
  });

  it("rejects unauthenticated run creation", async () => {
    const app = buildApp(testEnv);
    appsToClose.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/v1/runtime/runs",
      payload: {
        skillId: "coreagent.repo.search"
      }
    });

    expect(response.statusCode).toBe(401);
  });

  it("prevents cross-user access to run details", async () => {
    const app = buildApp(testEnv);
    appsToClose.push(app);

    const createResponse = await app.inject({
      method: "POST",
      url: "/v1/runtime/runs",
      headers: authHeader("11111111-1111-4111-8111-111111111111"),
      payload: {
        skillId: "coreagent.repo.search"
      }
    });

    expect(createResponse.statusCode).toBe(201);
    const created = createResponse.json() as { data: { runId: string } };

    const otherUserResponse = await app.inject({
      method: "GET",
      url: `/v1/runtime/runs/${created.data.runId}`,
      headers: authHeader("22222222-2222-4222-8222-222222222222")
    });

    expect(otherUserResponse.statusCode).toBe(404);
  });

  it("accepts local_docker execution mode", async () => {
    const app = buildApp(testEnv);
    appsToClose.push(app);

    const createResponse = await app.inject({
      method: "POST",
      url: "/v1/runtime/runs",
      headers: authHeader(),
      payload: {
        skillId: "coreagent.repo.search",
        executionMode: "local_docker"
      }
    });

    expect(createResponse.statusCode).toBe(201);
    expect(createResponse.json()).toMatchObject({
      data: {
        executionMode: "local_docker"
      }
    });
  });

  it("keeps create-run contract consistent between remote and local_docker", async () => {
    const app = buildApp(testEnv);
    appsToClose.push(app);

    const payload = {
      skillId: "coreagent.repo.search",
      version: "1.0.0",
      timeoutSeconds: 90,
      input: {
        query: "parity-check"
      }
    };

    const [remoteResponse, localResponse] = await Promise.all([
      app.inject({
        method: "POST",
        url: "/v1/runtime/runs",
        headers: authHeader(),
        payload: {
          ...payload,
          executionMode: "remote"
        }
      }),
      app.inject({
        method: "POST",
        url: "/v1/runtime/runs",
        headers: authHeader(),
        payload: {
          ...payload,
          executionMode: "local_docker"
        }
      })
    ]);

    expect(remoteResponse.statusCode).toBe(201);
    expect(localResponse.statusCode).toBe(201);

    const remoteBody = remoteResponse.json() as {
      data: {
        runId: string;
        skillId: string;
        version: string;
        status: string;
        executionMode: string;
        timeoutSeconds: number;
        input: Record<string, unknown>;
        output: Record<string, unknown> | null;
        error: { code: string; message: string } | null;
      };
    };
    const localBody = localResponse.json() as typeof remoteBody;

    expect(remoteBody.data.runId).not.toEqual(localBody.data.runId);
    expect(remoteBody.data.skillId).toBe(localBody.data.skillId);
    expect(remoteBody.data.version).toBe(localBody.data.version);
    expect(remoteBody.data.status).toBe("queued");
    expect(localBody.data.status).toBe("queued");
    expect(remoteBody.data.executionMode).toBe("remote");
    expect(localBody.data.executionMode).toBe("local_docker");
    expect(remoteBody.data.timeoutSeconds).toBe(localBody.data.timeoutSeconds);
    expect(remoteBody.data.input).toEqual(localBody.data.input);
    expect(remoteBody.data.output).toBeNull();
    expect(localBody.data.output).toBeNull();
    expect(remoteBody.data.error).toBeNull();
    expect(localBody.data.error).toBeNull();
  });

  it("rejects unsupported execution mode values", async () => {
    const app = buildApp(testEnv);
    appsToClose.push(app);

    const createResponse = await app.inject({
      method: "POST",
      url: "/v1/runtime/runs",
      headers: authHeader(),
      payload: {
        skillId: "coreagent.repo.search",
        executionMode: "edge_runtime"
      }
    });

    expect(createResponse.statusCode).toBe(400);
    expect(createResponse.json()).toMatchObject({
      message: "Invalid request payload."
    });
  });

});
