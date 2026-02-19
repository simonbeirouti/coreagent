import { describe, expect, it } from "vitest";

import type { RunnerEnv } from "./env.js";
import { extractRequestedCredentialScopes, resolveCredentialRequest } from "./credential-broker.js";
import type { RequestedPermission } from "./permission-broker.js";

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

describe("credential broker", () => {
  it("extracts scopes from secrets.* permissions", () => {
    const permissions: RequestedPermission[] = [
      {
        permissionKey: "secrets.openai_api_key",
        required: true,
        permissionScope: {}
      }
    ];

    expect(extractRequestedCredentialScopes(permissions)).toEqual([
      {
        scope: "openai_api_key",
        required: true,
        permissionKey: "secrets.openai_api_key"
      }
    ]);
  });

  it("denies required scopes that are not mapped", () => {
    const scopes = extractRequestedCredentialScopes([
      {
        permissionKey: "secrets.openai_api_key",
        required: true,
        permissionScope: {}
      }
    ]);

    const decision = resolveCredentialRequest(scopes, baseEnv(), {});
    expect(decision.allowed).toBe(false);
  });

  it("denies mapped scopes that have no configured env value", () => {
    const scopes = extractRequestedCredentialScopes([
      {
        permissionKey: "secrets.openai_api_key",
        required: true,
        permissionScope: {}
      }
    ]);

    const decision = resolveCredentialRequest(
      scopes,
      baseEnv({
        RUNTIME_CREDENTIAL_SCOPE_MAP: "openai_api_key=OPENAI_API_KEY"
      }),
      {}
    );
    expect(decision.allowed).toBe(false);
  });

  it("allows required scopes when mapped values are configured", () => {
    const scopes = extractRequestedCredentialScopes([
      {
        permissionKey: "secrets.openai_api_key",
        required: true,
        permissionScope: {}
      }
    ]);

    const decision = resolveCredentialRequest(
      scopes,
      baseEnv({
        RUNTIME_CREDENTIAL_SCOPE_MAP: "openai_api_key=OPENAI_API_KEY"
      }),
      {
        OPENAI_API_KEY: "test-key"
      }
    );

    expect(decision).toEqual({
      allowed: true,
      resolvedCredentials: {
        openai_api_key: "test-key"
      }
    });
  });

  it("extracts and de-duplicates scopes from permission scope payload fields", () => {
    const permissions: RequestedPermission[] = [
      {
        permissionKey: "network.http",
        required: false,
        permissionScope: {
          credentialScope: "OPENAI_API_KEY",
          credential: "openai_api_key",
          credentials: ["OPENAI_API_KEY", "anthropic_api_key"]
        }
      },
      {
        permissionKey: "secrets.anthropic_api_key",
        required: true,
        permissionScope: {}
      }
    ];

    expect(extractRequestedCredentialScopes(permissions)).toEqual([
      {
        scope: "openai_api_key",
        required: false,
        permissionKey: "network.http"
      },
      {
        scope: "anthropic_api_key",
        required: true,
        permissionKey: "secrets.anthropic_api_key"
      }
    ]);
  });
});
