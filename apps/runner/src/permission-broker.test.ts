import { describe, expect, it } from "vitest";

import { evaluatePermissionRequest } from "./permission-broker.js";
import type { RunnerEnv } from "./env.js";

function baseEnv(overrides?: Partial<RunnerEnv>): RunnerEnv {
  return {
    NODE_ENV: "test",
    LOG_LEVEL: "error",
    REDIS_URL: "redis://127.0.0.1:6379",
    RUNTIME_RUN_QUEUE_NAME: "runtime-runs",
    RUNTIME_RUN_CONCURRENCY: 1,
    RUNTIME_ALLOW_NETWORK: false,
    RUNTIME_ALLOW_FILESYSTEM: false,
    RUNTIME_ALLOW_BROWSER: false,
    RUNTIME_ALLOW_PROCESS: false,
    RUNTIME_NETWORK_DOMAIN_ALLOWLIST: "",
    RUNTIME_CREDENTIAL_SCOPE_MAP: "",
    RUNTIME_ENABLE_REMOTE_DOCKER: true,
    RUNTIME_ENABLE_LOCAL_DOCKER: false,
    RUNTIME_LOCAL_DOCKER_IMAGE: "node:20-alpine",
    RUNTIME_LOCAL_DOCKER_IMAGE_PROFILES: "",
    RUNTIME_LOCAL_DOCKER_MEMORY_MB: 256,
    RUNTIME_LOCAL_DOCKER_CPU_SHARES: 256,
    RUNTIME_LOCAL_DOCKER_NETWORK_DISABLED: true,
    RUNTIME_LOCAL_DOCKER_PULL_IF_MISSING: true,
    RUNTIME_ARTIFACT_STORAGE_DIR: "../server/data/artifacts",
    ...overrides
  };
}

describe("permission broker", () => {
  it("denies required permission by default", () => {
    const decision = evaluatePermissionRequest(
      [
        {
          permissionKey: "network.http",
          required: true,
          permissionScope: {}
        }
      ],
      baseEnv()
    );

    expect(decision.allowed).toBe(false);
  });

  it("allows required network permission when network is enabled and domain in allowlist", () => {
    const decision = evaluatePermissionRequest(
      [
        {
          permissionKey: "network.http",
          required: true,
          permissionScope: {
            domains: ["api.openai.com"]
          }
        }
      ],
      baseEnv({
        RUNTIME_ALLOW_NETWORK: true,
        RUNTIME_NETWORK_DOMAIN_ALLOWLIST: "api.openai.com"
      })
    );

    expect(decision.allowed).toBe(true);
  });

  it("denies required network permission when requested domain is outside allowlist", () => {
    const decision = evaluatePermissionRequest(
      [
        {
          permissionKey: "network.http",
          required: true,
          permissionScope: {
            domains: ["example.com"]
          }
        }
      ],
      baseEnv({
        RUNTIME_ALLOW_NETWORK: true,
        RUNTIME_NETWORK_DOMAIN_ALLOWLIST: "api.openai.com"
      })
    );

    expect(decision.allowed).toBe(false);
  });
});
