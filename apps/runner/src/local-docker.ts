import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { PassThrough, type Readable } from "node:stream";

import Docker, { type Container, type ContainerCreateOptions } from "dockerode";

import type { RunnerEnv } from "./env.js";
import type { RuntimeRunJobData } from "./worker.js";

type LocalDockerExecutionResult = {
  executionMode: "local_docker";
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

type LocalDockerExecutionOptions = {
  onLog?: (message: string, stream: "stdout" | "stderr") => Promise<void> | void;
};

type PreparedArtifact = {
  hostWorkdir: string;
  containerEntrypoint: string;
  cleanup: () => Promise<void>;
};

function normalizeRuntimeProfile(value: string | null | undefined): string {
  const normalized = (value ?? "").trim().toLowerCase();
  return normalized.length > 0 ? normalized : "default";
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
    const profile = normalizeRuntimeProfile(entry.slice(0, separatorIndex));
    const image = entry.slice(separatorIndex + 1).trim();
    if (image.length === 0) {
      continue;
    }
    map.set(profile, image);
  }

  return map;
}

function resolveLocalDockerImage(job: RuntimeRunJobData, env: RunnerEnv): string {
  const profile = normalizeRuntimeProfile(job.skillRuntime.runtimeProfile);
  const profileMap = parseImageProfileMap(env.RUNTIME_LOCAL_DOCKER_IMAGE_PROFILES);

  return (
    profileMap.get(profile) ??
    profileMap.get("default") ??
    env.RUNTIME_LOCAL_DOCKER_IMAGE
  );
}

function ensureSafeRelativePath(value: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new Error("LOCAL_DOCKER_FAILED:Entrypoint cannot be empty.");
  }
  if (isAbsolute(normalized) || normalized.includes("..")) {
    throw new Error("LOCAL_DOCKER_FAILED:Entrypoint must be a safe relative path.");
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

async function resolveArtifactBytes(uri: string, env: RunnerEnv): Promise<Buffer> {
  if (uri.startsWith("http://") || uri.startsWith("https://")) {
    const response = await fetch(uri);
    if (!response.ok) {
      throw new Error(`LOCAL_DOCKER_FAILED:Failed to download artifact (${response.status}).`);
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

  throw new Error(`LOCAL_DOCKER_FAILED:Unsupported artifact URI scheme "${uri}".`);
}

async function prepareArtifactWorkspace(job: RuntimeRunJobData, env: RunnerEnv): Promise<PreparedArtifact> {
  if (job.skillRuntime.runtimeType !== "command") {
    throw new Error(`LOCAL_DOCKER_FAILED:Unsupported local_docker runtime type "${job.skillRuntime.runtimeType}".`);
  }
  if (!job.skillRuntime.artifactUri) {
    throw new Error("LOCAL_DOCKER_FAILED:Skill artifact URI is required for local_docker execution.");
  }

  const hostWorkdir = await mkdtemp(join(tmpdir(), "coreagent-runtime-"));
  const cleanup = async () => {
    await rm(hostWorkdir, { recursive: true, force: true });
  };

  try {
    const artifactBytes = await resolveArtifactBytes(job.skillRuntime.artifactUri, env);
    const safeEntrypoint = ensureSafeRelativePath(job.skillRuntime.entrypoint);
    const entrypointHostPath = resolve(hostWorkdir, safeEntrypoint);
    if (!entrypointHostPath.startsWith(hostWorkdir)) {
      throw new Error("LOCAL_DOCKER_FAILED:Entrypoint escaped workspace bounds.");
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

export async function executeLocalDockerRun(
  job: RuntimeRunJobData,
  env: RunnerEnv,
  options?: LocalDockerExecutionOptions
): Promise<LocalDockerExecutionResult> {
  if (!env.RUNTIME_ENABLE_LOCAL_DOCKER) {
    throw new Error("LOCAL_DOCKER_DENY:Local Docker execution mode is disabled.");
  }

  const docker = new Docker();
  await docker.ping();
  const selectedImage = resolveLocalDockerImage(job, env);

  if (env.RUNTIME_LOCAL_DOCKER_PULL_IF_MISSING) {
    await ensureImage(docker, selectedImage);
  }

  const workspace = await prepareArtifactWorkspace(job, env);
  const containerCmd = ["/bin/sh", "-lc", `chmod +x "${workspace.containerEntrypoint}" && "${workspace.containerEntrypoint}"`];

  const createOptions: ContainerCreateOptions = {
    Image: selectedImage,
    Cmd: containerCmd,
    WorkingDir: "/workspace",
    AttachStdout: true,
    AttachStderr: true,
    HostConfig: {
      AutoRemove: false,
      ReadonlyRootfs: true,
      Binds: [`${workspace.hostWorkdir}:/workspace:ro`],
      Memory: env.RUNTIME_LOCAL_DOCKER_MEMORY_MB * 1024 * 1024,
      CpuShares: env.RUNTIME_LOCAL_DOCKER_CPU_SHARES,
      ...(env.RUNTIME_LOCAL_DOCKER_NETWORK_DISABLED ? { NetworkMode: "none" } : {})
    }
  };

  const container = await docker.createContainer(createOptions);
  let timedOut = false;
  try {
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
          reject(new Error("LOCAL_DOCKER_TIMEOUT:Local docker execution exceeded timeout."));
        }, timeoutMs);
      })
    ]);

    stdout.end();
    stderr.end();
    const [rawStdout, rawStderr] = await Promise.all([stdoutPromise, stderrPromise]);

    const exitCode = waitResult.StatusCode ?? 0;
    if (exitCode !== 0) {
      throw new Error(`LOCAL_DOCKER_FAILED:Container exited with status ${exitCode}. ${rawStderr.trim()}`);
    }

    return {
      executionMode: "local_docker",
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
    if (error instanceof Error && error.message.startsWith("LOCAL_DOCKER_TIMEOUT:")) {
      try {
        await container.kill();
      } catch {
        // best effort
      }
      throw error;
    }
    const message = error instanceof Error ? error.message : "Unknown local docker failure.";
    throw new Error(message.startsWith("LOCAL_DOCKER_") ? message : `LOCAL_DOCKER_FAILED:${message}`);
  } finally {
    await removeContainer(container);
    await workspace.cleanup();
  }
}
