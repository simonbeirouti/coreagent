import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { PassThrough, type Readable } from "node:stream";

import Docker, { type Container, type ContainerCreateOptions } from "dockerode";

import type { RunnerEnv } from "./env.js";
import type { RuntimeRunJobData } from "./worker.js";

export type DockerExecutionMode = "remote" | "local_docker";

type DockerExecutionResultBase = {
  executionMode: DockerExecutionMode;
  image: string;
  containerId: string;
  exitCode: number;
  timedOut: boolean;
  output: Record<string, unknown>;
  artifact: {
    uri: string | null;
    runtimeType: "command" | "http" | "wasm";
    entrypoint: string;
  };
};

type LocalDockerExecutionResult = DockerExecutionResultBase & {
  executionMode: "local_docker";
};

type RemoteDockerExecutionResult = DockerExecutionResultBase & {
  executionMode: "remote";
};

type LocalDockerExecutionOptions = {
  onLog?: (message: string, stream: "stdout" | "stderr") => Promise<void> | void;
};

type PreparedArtifact = {
  hostWorkdir: string;
  containerEntrypoint: string;
  cleanup: () => Promise<void>;
};

const BUILTIN_PROFILE_IMAGES: Record<string, string> = {
  default: "node:20-alpine",
  node: "node:20-alpine",
  python: "python:3.12-alpine",
  rust: "rust:1.83-alpine"
};
const CANONICAL_RUNTIME_PROFILE_ALIASES: Record<string, string> = {
  js: "node",
  javascript: "node",
  nodejs: "node",
  py: "python",
  python3: "python",
  rs: "rust"
};
const CANONICAL_BUILTIN_PROFILE_KEYS = new Set(Object.keys(BUILTIN_PROFILE_IMAGES));

function normalizeRuntimeProfile(value: string | null | undefined): string {
  const normalized = (value ?? "").trim().toLowerCase();
  return normalized.length > 0 ? normalized : "default";
}

function canonicalizeRuntimeProfile(value: string | null | undefined): string {
  const normalized = normalizeRuntimeProfile(value);
  return CANONICAL_RUNTIME_PROFILE_ALIASES[normalized] ?? normalized;
}

function parseImageProfileMap(value: string): Map<string, string> {
  const map = new Map<string, string>();
  const entries = value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  for (const entry of entries) {
    const separatorIndex = entry.indexOf("=");
    if (separatorIndex <= 0 || separatorIndex >= entry.length - 1) {
      continue;
    }
    const profile = canonicalizeRuntimeProfile(entry.slice(0, separatorIndex));
    const image = entry.slice(separatorIndex + 1).trim();
    if (image.length === 0) {
      continue;
    }
    map.set(profile, image);
  }

  return map;
}

function inferRuntimeProfileFromSkillId(skillId: string): string | null {
  const normalized = skillId.trim().toLowerCase();
  if (normalized.startsWith("coreagent.py.")) {
    return "python";
  }
  if (normalized.startsWith("coreagent.rs.")) {
    return "rust";
  }
  if (normalized.startsWith("coreagent.js.")) {
    return "node";
  }
  return null;
}

function resolveRuntimeProfile(job: RuntimeRunJobData): string {
  const declaredProfile = canonicalizeRuntimeProfile(job.skillRuntime.runtimeProfile);
  const inferredProfile =
    declaredProfile === "default" ? inferRuntimeProfileFromSkillId(job.skillId) : null;
  return canonicalizeRuntimeProfile(inferredProfile ?? declaredProfile);
}

function jobRequestsNetworkAccess(job: RuntimeRunJobData): boolean {
  return job.requestedPermissions.some((permission) => {
    const key = permission.permissionKey.toLowerCase();
    return key.startsWith("network") || key.includes("http");
  });
}

export function shouldDisableDockerNetwork(job: RuntimeRunJobData, env: RunnerEnv): boolean {
  if (!env.RUNTIME_LOCAL_DOCKER_NETWORK_DISABLED) {
    return false;
  }
  return !jobRequestsNetworkAccess(job);
}

export function collectRuntimeDockerImages(env: RunnerEnv): string[] {
  const profileMap = parseImageProfileMap(env.RUNTIME_LOCAL_DOCKER_IMAGE_PROFILES);
  const canonicalImages = Object.keys(BUILTIN_PROFILE_IMAGES).map((profile) =>
    profileMap.get(profile) ??
    BUILTIN_PROFILE_IMAGES[profile] ??
    profileMap.get("default") ??
    env.RUNTIME_LOCAL_DOCKER_IMAGE ??
    BUILTIN_PROFILE_IMAGES.default
  );
  const customProfileImages = [...profileMap.entries()]
    .filter(([profile]) => !CANONICAL_BUILTIN_PROFILE_KEYS.has(profile))
    .map(([, image]) => image);
  const images = [...canonicalImages, ...customProfileImages]
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  return [...new Set(images)];
}

export async function prepareLocalDockerImages(env: RunnerEnv): Promise<string[]> {
  const docker = new Docker();
  await docker.ping();
  const images = collectRuntimeDockerImages(env);
  for (const image of images) {
    await ensureImage(docker, image);
  }
  return images;
}

function resolveDockerImage(job: RuntimeRunJobData, env: RunnerEnv): string {
  const profile = resolveRuntimeProfile(job);
  const profileMap = parseImageProfileMap(env.RUNTIME_LOCAL_DOCKER_IMAGE_PROFILES);
  return (
    profileMap.get(profile) ??
    BUILTIN_PROFILE_IMAGES[profile] ??
    profileMap.get("default") ??
    env.RUNTIME_LOCAL_DOCKER_IMAGE ??
    BUILTIN_PROFILE_IMAGES.default
  );
}

export function resolveDockerImageForJob(job: RuntimeRunJobData, env: RunnerEnv): string {
  return resolveDockerImage(job, env);
}

function getExecutionErrorPrefix(mode: DockerExecutionMode): string {
  return mode === "remote" ? "REMOTE_DOCKER" : "LOCAL_DOCKER";
}

function createExecutionError(mode: DockerExecutionMode, kind: "DENY" | "FAILED" | "TIMEOUT", message: string): Error {
  return new Error(`${getExecutionErrorPrefix(mode)}_${kind}:${message}`);
}

function ensureSafeRelativePath(value: string, mode: DockerExecutionMode): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw createExecutionError(mode, "FAILED", "Entrypoint cannot be empty.");
  }
  if (isAbsolute(normalized) || normalized.includes("..")) {
    throw createExecutionError(mode, "FAILED", "Entrypoint must be a safe relative path.");
  }
  return normalized;
}

async function ensureImage(docker: Docker, image: string): Promise<void> {
  try {
    await docker.getImage(image).inspect();
    return;
  } catch {
    await new Promise<void>((resolvePull, rejectPull) => {
      docker.pull(image, (error: Error | null, stream: Readable | null) => {
        if (error || !stream) {
          rejectPull(error ?? new Error("Docker image pull failed."));
          return;
        }
        docker.modem.followProgress(stream, (followError) => {
          if (followError) {
            rejectPull(followError);
            return;
          }
          resolvePull();
        });
      });
    });
  }
}

function parseArtifactDigest(uri: string): string | null {
  const match = /^artifact:\/\/sha256\/([a-f0-9]{64})$/i.exec(uri.trim());
  return match?.[1]?.toLowerCase() ?? null;
}

async function resolveArtifactBytes(uri: string, env: RunnerEnv, mode: DockerExecutionMode): Promise<Buffer> {
  if (uri.startsWith("http://") || uri.startsWith("https://")) {
    const response = await fetch(uri);
    if (!response.ok) {
      throw createExecutionError(mode, "FAILED", `Failed to download artifact (${response.status}).`);
    }
    return Buffer.from(await response.arrayBuffer());
  }

  if (uri.startsWith("file://")) {
    const path = new URL(uri).pathname;
    return readFile(path);
  }

  const digest = parseArtifactDigest(uri);
  if (digest) {
    const storageRoot = resolve(process.cwd(), env.RUNTIME_ARTIFACT_STORAGE_DIR);
    const path = join(storageRoot, digest.slice(0, 2), `${digest}.bin`);
    return readFile(path);
  }

  throw createExecutionError(mode, "FAILED", `Unsupported artifact URI scheme "${uri}".`);
}

async function prepareArtifactWorkspace(
  job: RuntimeRunJobData,
  env: RunnerEnv,
  mode: DockerExecutionMode
): Promise<PreparedArtifact> {
  if (job.skillRuntime.runtimeType !== "command") {
    throw createExecutionError(mode, "FAILED", `Unsupported runtime type "${job.skillRuntime.runtimeType}".`);
  }
  if (!job.skillRuntime.artifactUri) {
    throw createExecutionError(mode, "FAILED", "Skill artifact URI is required for Docker execution.");
  }

  const hostWorkdir = await mkdtemp(join(tmpdir(), "coreagent-runtime-"));
  const cleanup = async () => {
    await rm(hostWorkdir, { recursive: true, force: true });
  };

  try {
    const artifactBytes = await resolveArtifactBytes(job.skillRuntime.artifactUri, env, mode);
    const safeEntrypoint = ensureSafeRelativePath(job.skillRuntime.entrypoint, mode);
    const entrypointHostPath = resolve(hostWorkdir, safeEntrypoint);
    if (!entrypointHostPath.startsWith(hostWorkdir)) {
      throw createExecutionError(mode, "FAILED", "Entrypoint escaped workspace bounds.");
    }
    await mkdir(dirname(entrypointHostPath), { recursive: true });
    await writeFile(entrypointHostPath, artifactBytes, { mode: 0o755 });

    const inputPath = join(hostWorkdir, "input.json");
    await writeFile(inputPath, JSON.stringify(job.input, null, 2));

    return {
      hostWorkdir,
      containerEntrypoint: `/workspace/${safeEntrypoint}`,
      cleanup
    };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

function parseContainerOutput(rawStdout: string): Record<string, unknown> {
  const trimmed = rawStdout.trim();
  if (trimmed.length === 0) {
    return {};
  }
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return { result: parsed };
  } catch {
    return { stdout: trimmed };
  }
}

export function buildContainerEnvironment(runtimeProfile: string): string[] {
  const env = [
    "PATH=/usr/local/cargo/bin:/root/.cargo/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
    "TMPDIR=/tmp",
    "PIP_CACHE_DIR=/tmp/pip-cache",
    "XDG_CACHE_HOME=/tmp/.cache",
    "COREAGENT_TMP_DIR=/tmp",
    "CARGO_HOME=/tmp/coreagent_cargo_home"
  ];
  if (runtimeProfile === "rust") {
    // Use image-provisioned rustup/toolchains and only keep cargo cache writable in /tmp.
    env.push("RUSTUP_HOME=/usr/local/rustup");
    env.push("RUSTUP_NO_UPDATE_CHECK=1");
  }
  return env;
}

function streamByLine(
  source: Readable,
  streamType: "stdout" | "stderr",
  onLog?: LocalDockerExecutionOptions["onLog"]
): Promise<string> {
  let buffer = "";
  let raw = "";
  return new Promise((resolveStream, rejectStream) => {
    source.on("data", (chunk: Buffer | string) => {
      const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
      raw += text;
      buffer += text;
      let newlineIndex = buffer.indexOf("\n");
      while (newlineIndex >= 0) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (line.length > 0 && onLog) {
          void onLog(line, streamType);
        }
        newlineIndex = buffer.indexOf("\n");
      }
    });

    source.on("end", () => {
      const remainder = buffer.trim();
      if (remainder.length > 0 && onLog) {
        void onLog(remainder, streamType);
      }
      resolveStream(raw);
    });

    source.on("error", (error) => {
      rejectStream(error);
    });
  });
}

async function removeContainer(container: Container): Promise<void> {
  try {
    await container.remove({ force: true });
  } catch {
    // best-effort cleanup
  }
}

async function executeDockerRun(
  job: RuntimeRunJobData,
  env: RunnerEnv,
  mode: DockerExecutionMode,
  options?: LocalDockerExecutionOptions
): Promise<DockerExecutionResultBase> {
  if (mode === "local_docker" && !env.RUNTIME_ENABLE_LOCAL_DOCKER) {
    throw createExecutionError(mode, "DENY", "Local Docker execution mode is disabled.");
  }
  if (mode === "remote" && !env.RUNTIME_ENABLE_REMOTE_DOCKER) {
    throw createExecutionError(mode, "DENY", "Remote Docker execution mode is disabled.");
  }

  const errorPrefix = getExecutionErrorPrefix(mode);
  const docker = new Docker();
  const runtimeProfile = resolveRuntimeProfile(job);
  const selectedImage = resolveDockerImage(job, env);
  const disableNetwork = shouldDisableDockerNetwork(job, env);
  let workspace: PreparedArtifact | null = null;
  let container: Container | null = null;
  let timedOut = false;
  try {
    await docker.ping();
    if (mode === "local_docker" || env.RUNTIME_LOCAL_DOCKER_PULL_IF_MISSING) {
      await ensureImage(docker, selectedImage);
    }

    workspace = await prepareArtifactWorkspace(job, env, mode);
    const containerCmd = ["/bin/sh", "-c", workspace.containerEntrypoint];

    const containerEnv = buildContainerEnvironment(runtimeProfile);

    const tmpfsMounts: Record<string, string> = {
      "/tmp": "rw,exec,size=268435456",
      "/var/tmp": "rw,exec,size=268435456",
      "/root/.cache": "rw,size=134217728"
    };
    if (runtimeProfile === "rust") {
      // rustup may still create temp files under $RUSTUP_HOME/tmp even when toolchain is preinstalled.
      tmpfsMounts["/usr/local/rustup/tmp"] = "rw,size=67108864";
    }

    const createOptions: ContainerCreateOptions = {
      Image: selectedImage,
      Cmd: containerCmd,
      WorkingDir: "/workspace",
      Env: containerEnv,
      AttachStdout: true,
      AttachStderr: true,
      HostConfig: {
        AutoRemove: false,
        ReadonlyRootfs: true,
        Binds: [`${workspace.hostWorkdir}:/workspace:ro`],
        Tmpfs: tmpfsMounts,
        Memory: env.RUNTIME_LOCAL_DOCKER_MEMORY_MB * 1024 * 1024,
        CpuShares: env.RUNTIME_LOCAL_DOCKER_CPU_SHARES,
        ...(disableNetwork ? { NetworkMode: "none" } : {})
      }
    };

    container = await docker.createContainer(createOptions);
    await container.start();

    const logStream = await container.logs({
      follow: true,
      stdout: true,
      stderr: true,
      timestamps: false
    });
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    // dockerode demuxes multiplexed stream into stdout/stderr streams.
    docker.modem.demuxStream(logStream, stdout, stderr);

    const stdoutPromise = streamByLine(stdout, "stdout", options?.onLog);
    const stderrPromise = streamByLine(stderr, "stderr", options?.onLog);

    const timeoutMs = job.timeoutSeconds * 1000;
    const waitResult = await Promise.race([
      container.wait(),
      new Promise<never>((_, reject) => {
        setTimeout(() => {
          timedOut = true;
          reject(createExecutionError(mode, "TIMEOUT", "Docker execution exceeded timeout."));
        }, timeoutMs);
      })
    ]);

    stdout.end();
    stderr.end();
    const [rawStdout, rawStderr] = await Promise.all([stdoutPromise, stderrPromise]);

    const exitCode = waitResult.StatusCode ?? 0;
    if (exitCode !== 0) {
      throw createExecutionError(mode, "FAILED", `Container exited with status ${exitCode}. ${rawStderr.trim()}`);
    }

    return {
      executionMode: mode,
      image: selectedImage,
      containerId: container.id,
      exitCode,
      timedOut,
      output: parseContainerOutput(rawStdout),
      artifact: {
        uri: job.skillRuntime.artifactUri,
        runtimeType: job.skillRuntime.runtimeType,
        entrypoint: job.skillRuntime.entrypoint
      }
    };
  } catch (error) {
    if (error instanceof Error && error.message.startsWith(`${errorPrefix}_TIMEOUT:`) && container) {
      try {
        await container.kill();
      } catch {
        // best effort
      }
      throw error;
    }
    const message = error instanceof Error ? error.message : "Unknown Docker execution failure.";
    throw new Error(message.startsWith(`${errorPrefix}_`) ? message : `${errorPrefix}_FAILED:${message}`);
  } finally {
    if (container) {
      await removeContainer(container);
    }
    if (workspace) {
      await workspace.cleanup();
    }
  }
}

export async function executeLocalDockerRun(
  job: RuntimeRunJobData,
  env: RunnerEnv,
  options?: LocalDockerExecutionOptions
): Promise<LocalDockerExecutionResult> {
  return executeDockerRun(job, env, "local_docker", options) as Promise<LocalDockerExecutionResult>;
}

export async function executeRemoteDockerRun(
  job: RuntimeRunJobData,
  env: RunnerEnv,
  options?: LocalDockerExecutionOptions
): Promise<RemoteDockerExecutionResult> {
  return executeDockerRun(job, env, "remote", options) as Promise<RemoteDockerExecutionResult>;
}
