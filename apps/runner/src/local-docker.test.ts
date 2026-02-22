import { describe, expect, it } from "vitest";

import type { RunnerEnv } from "./env.js";
import {
  buildContainerEnvironment,
  collectRuntimeDockerImages,
  executeLocalDockerRun,
  executeRemoteDockerRun,
  renderMarkdownTemplate,
  resolveDockerImageForJob,
  shouldDisableDockerNetwork
} from "./local-docker.js";
import type { RuntimeRunJobData } from "./worker.js";

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

const job: RuntimeRunJobData = {
  runId: "11111111-1111-4111-8111-111111111111",
  userId: "11111111-1111-4111-8111-111111111111",
  skillId: "coreagent.repo.search",
  version: "1.0.0",
  executionMode: "local_docker",
  timeoutSeconds: 30,
  input: { query: "hello" },
  skillRuntime: {
    runtimeType: "command",
    entrypoint: "echo hello",
    artifactUri: null,
    digest: "0000000000000000000000000000000000000000000000000000000000000000"
  },
  requestedPermissions: []
};

describe("local docker execution", () => {
  it("denies local docker mode when disabled", async () => {
    await expect(executeLocalDockerRun(job, baseEnv())).rejects.toThrow(
      "LOCAL_DOCKER_DENY:Local Docker execution mode is disabled."
    );
  });

  it("denies remote docker mode when disabled", async () => {
    await expect(
      executeRemoteDockerRun(
        { ...job, executionMode: "remote" },
        baseEnv({
          RUNTIME_ENABLE_REMOTE_DOCKER: false
        })
      )
    ).rejects.toThrow("REMOTE_DOCKER_DENY:Remote Docker execution mode is disabled.");
  });

  it("uses builtin python image for python runtime profile when profile map is unset", () => {
    const image = resolveDockerImageForJob(
      {
        ...job,
        skillId: "coreagent.py.deep_analysis",
        skillRuntime: {
          ...job.skillRuntime,
          runtimeProfile: "python"
        }
      },
      baseEnv()
    );

    expect(image).toBe("python:3.12-alpine");
  });

  it("falls back to python image from skill ID when runtime profile is missing/default", () => {
    const image = resolveDockerImageForJob(
      {
        ...job,
        skillId: "coreagent.py.deep_analysis",
        skillRuntime: {
          ...job.skillRuntime
        }
      },
      baseEnv()
    );

    expect(image).toBe("python:3.12-alpine");
  });

  it("falls back to rust image from skill ID when runtime profile is missing/default", () => {
    const image = resolveDockerImageForJob(
      {
        ...job,
        skillId: "coreagent.rs.regex_advisor",
        skillRuntime: {
          ...job.skillRuntime
        }
      },
      baseEnv()
    );

    expect(image).toBe("rust:1.83-alpine");
  });

  it("resolves language aliases to canonical profile images", () => {
    const env = baseEnv({
      RUNTIME_LOCAL_DOCKER_IMAGE_PROFILES:
        "node=ghcr.io/acme/node:1.0.0,python=ghcr.io/acme/python:1.0.0,rust=ghcr.io/acme/rust:1.0.0"
    });
    const jsImage = resolveDockerImageForJob(
      {
        ...job,
        skillRuntime: {
          ...job.skillRuntime,
          runtimeProfile: "javascript"
        }
      },
      env
    );
    const pyImage = resolveDockerImageForJob(
      {
        ...job,
        skillRuntime: {
          ...job.skillRuntime,
          runtimeProfile: "py"
        }
      },
      env
    );
    const rsImage = resolveDockerImageForJob(
      {
        ...job,
        skillRuntime: {
          ...job.skillRuntime,
          runtimeProfile: "rs"
        }
      },
      env
    );

    expect(jsImage).toBe("ghcr.io/acme/node:1.0.0");
    expect(pyImage).toBe("ghcr.io/acme/python:1.0.0");
    expect(rsImage).toBe("ghcr.io/acme/rust:1.0.0");
  });

  it("falls back to node image from skill ID when runtime profile is missing/default", () => {
    const image = resolveDockerImageForJob(
      {
        ...job,
        skillId: "coreagent.js.dayjs_timeline",
        skillRuntime: {
          ...job.skillRuntime
        }
      },
      baseEnv()
    );

    expect(image).toBe("node:20-alpine");
  });

  it("collects configured + builtin runtime images for pre-pull warmup", () => {
    const images = collectRuntimeDockerImages(
      baseEnv({
        RUNTIME_LOCAL_DOCKER_IMAGE: "node:20-alpine",
        RUNTIME_LOCAL_DOCKER_IMAGE_PROFILES:
          "python=python:3.12-alpine,rust=rust:1.83-alpine,custom=ghcr.io/acme/custom:1.0.0"
      })
    );

    expect(images).toContain("node:20-alpine");
    expect(images).toContain("python:3.12-alpine");
    expect(images).toContain("rust:1.83-alpine");
    expect(images).toContain("ghcr.io/acme/custom:1.0.0");
  });

  it("dedupes alias profiles to one image per language during warmup", () => {
    const images = collectRuntimeDockerImages(
      baseEnv({
        RUNTIME_LOCAL_DOCKER_IMAGE: "node:20-alpine",
        RUNTIME_LOCAL_DOCKER_IMAGE_PROFILES:
          "js=node:20-alpine,javascript=node:20-alpine,py=python:3.12-alpine,python=python:3.12-alpine,rs=rust:1.83-alpine,rust=rust:1.83-alpine,custom=ghcr.io/acme/custom:1.0.0"
      })
    );

    expect(images.filter((image) => image === "node:20-alpine")).toHaveLength(1);
    expect(images.filter((image) => image === "python:3.12-alpine")).toHaveLength(1);
    expect(images.filter((image) => image === "rust:1.83-alpine")).toHaveLength(1);
    expect(images).toContain("ghcr.io/acme/custom:1.0.0");
  });

  it("keeps rust toolchain paths on rust profile", () => {
    const env = buildContainerEnvironment("rust");

    expect(env).toContain("CARGO_HOME=/tmp/coreagent_cargo_home");
    expect(env).toContain("RUSTUP_HOME=/usr/local/rustup");
    expect(env).toContain("RUSTUP_NO_UPDATE_CHECK=1");
    expect(env.some((entry) => entry.startsWith("RUSTUP_TOOLCHAIN="))).toBe(false);
  });

  it("does not set rust-specific env for non-rust profiles", () => {
    const env = buildContainerEnvironment("node");

    expect(env).toContain("CARGO_HOME=/tmp/coreagent_cargo_home");
    expect(env.some((entry) => entry.startsWith("RUSTUP_HOME="))).toBe(false);
    expect(env.some((entry) => entry.startsWith("RUSTUP_TOOLCHAIN="))).toBe(false);
  });

  it("keeps network enabled for jobs that request network permissions", () => {
    const disableNetwork = shouldDisableDockerNetwork(
      {
        ...job,
        requestedPermissions: [
          {
            permissionKey: "network.http",
            required: true,
            permissionScope: {
              domains: ["pypi.org"]
            }
          }
        ]
      },
      baseEnv({
        RUNTIME_LOCAL_DOCKER_NETWORK_DISABLED: true
      })
    );

    expect(disableNetwork).toBe(false);
  });

  it("renders markdown templates with loops and conditionals", () => {
    const template = [
      "# Decision",
      "{{decision_title}}",
      "{{#if messageContext.userMessage}}",
      "Context: {{messageContext.userMessage}}",
      "{{/if}}",
      "{{#each items}}",
      "- {{this}}",
      "{{/each}}"
    ].join("\n");
    const rendered = renderMarkdownTemplate(template, {
      decision_title: "Adopt dynamic runtime context",
      messageContext: { userMessage: "Use attached file content." },
      items: ["first", "second"]
    });

    expect(rendered).toContain("Adopt dynamic runtime context");
    expect(rendered).toContain("Context: Use attached file content.");
    expect(rendered).toContain("- first");
    expect(rendered).toContain("- second");
  });
});
