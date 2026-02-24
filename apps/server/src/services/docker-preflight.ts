import { spawn } from "node:child_process";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type DockerPreflightMode = "remote" | "local_docker";

export type DockerPreflightInput = {
  title: string;
  skillId?: string;
  aiInput?: string;
  scriptBytes: Buffer;
  exampleBytes: Buffer;
  mode: DockerPreflightMode;
  onChunk?: (stream: "stdout" | "stderr", chunk: string) => void;
};

export type DockerPreflightResult = {
  status: "passed" | "failed";
  exitCode: number;
  stdout: string;
  stderr: string;
  startedAt: string;
  finishedAt: string;
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
  npm: "node",
  pnpm: "node",
  yarn: "node",
  py: "python",
  python3: "python",
  pip: "python",
  pip3: "python",
  rs: "rust"
};

type RuntimeInference = {
  profile: string;
  source: "script_shebang" | "script_heuristic" | "skill_id" | "runtime_missing_retry" | "default";
};

type ExampleNormalization = {
  jsonText: string;
  source: "json" | "wrapped_attachment";
  fileType: "json" | "csv" | "text";
};

function normalizeRuntimeProfile(value: string | null | undefined): string {
  const normalized = (value ?? "").trim().toLowerCase();
  return normalized.length > 0 ? normalized : "default";
}

function canonicalizeRuntimeProfile(value: string | null | undefined): string {
  const normalized = normalizeRuntimeProfile(value);
  return CANONICAL_RUNTIME_PROFILE_ALIASES[normalized] ?? normalized;
}

function inferRuntimeProfileFromSkillId(skillId: string | null | undefined): RuntimeInference | null {
  const normalized = (skillId ?? "").trim().toLowerCase();
  if (normalized.startsWith("coreagent.py.")) {
    return { profile: "python", source: "skill_id" };
  }
  if (normalized.startsWith("coreagent.rs.")) {
    return { profile: "rust", source: "skill_id" };
  }
  if (normalized.startsWith("coreagent.js.")) {
    return { profile: "node", source: "skill_id" };
  }
  return null;
}

export function detectRuntimeProfileFromScript(script: string): RuntimeInference | null {
  const firstLine = script.split(/\r?\n/, 1)[0]?.trim().toLowerCase() ?? "";
  const shebangMatch = firstLine.match(/^#!\s*(?:\/usr\/bin\/env\s+)?([a-z0-9_.+-]+)/);
  const shebangBinary = shebangMatch?.[1] ? canonicalizeRuntimeProfile(shebangMatch[1]) : null;
  if (shebangBinary && shebangBinary !== "default") {
    return { profile: shebangBinary, source: "script_shebang" };
  }

  const normalized = script.toLowerCase();
  const heuristicChecks: Array<{ profile: string; pattern: RegExp }> = [
    { profile: "python", pattern: /\bpython3?\b|\bpip3?\b|python\s+-m\s+pip/ },
    { profile: "node", pattern: /\bnode\b|\bnpm\b|\bpnpm\b|\byarn\b/ },
    { profile: "rust", pattern: /\bcargo\b|\brustc\b/ }
  ];
  const matched = heuristicChecks.find((candidate) => candidate.pattern.test(normalized));
  if (matched) {
    return { profile: matched.profile, source: "script_heuristic" };
  }
  return null;
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

function resolveDockerImage(
  runtimeProfile: string,
  profileMap: Map<string, string>,
  defaultImage: string | undefined
): string {
  const profile = canonicalizeRuntimeProfile(runtimeProfile);
  return (
    profileMap.get(profile) ??
    BUILTIN_PROFILE_IMAGES[profile] ??
    profileMap.get("default") ??
    defaultImage ??
    "node:20-alpine"
  );
}

export function extractMissingRuntimeBinary(stderr: string): string | null {
  const match = stderr.match(/LOCAL_RUNTIME_MISSING:([A-Za-z0-9_.+-]+)/);
  return match?.[1] ?? null;
}

export function inferRuntimeProfileFromMissingBinary(stderr: string): RuntimeInference | null {
  const missingBinary = extractMissingRuntimeBinary(stderr);
  if (!missingBinary) {
    return null;
  }
  const profile = canonicalizeRuntimeProfile(missingBinary);
  if (profile === "default") {
    return null;
  }
  return { profile, source: "runtime_missing_retry" };
}

function looksLikeCsv(text: string): boolean {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length < 2) {
    return false;
  }
  const header = lines[0] ?? "";
  const sample = lines[1] ?? "";
  return header.includes(",") && sample.includes(",");
}

export function normalizeExampleInput(exampleBytes: Buffer, aiInput?: string): ExampleNormalization {
  const rawText = exampleBytes.toString("utf8");
  const normalizedAiInput = aiInput?.trim();
  try {
    const parsed = JSON.parse(rawText);
    if (
      normalizedAiInput &&
      parsed &&
      typeof parsed === "object" &&
      !Array.isArray(parsed)
    ) {
      const payload = parsed as Record<string, unknown>;
      const existingContext =
        payload.messageContext && typeof payload.messageContext === "object" && !Array.isArray(payload.messageContext)
          ? (payload.messageContext as Record<string, unknown>)
          : {};
      return {
        jsonText: JSON.stringify({
          ...payload,
          messageContext: {
            ...existingContext,
            userMessage: normalizedAiInput
          }
        }),
        source: "json",
        fileType: "json"
      };
    }
    return {
      jsonText: JSON.stringify(parsed),
      source: "json",
      fileType: "json"
    };
  } catch {
    const fileType: "csv" | "text" = looksLikeCsv(rawText) ? "csv" : "text";
    const excerpt = rawText.slice(0, 64_000);
    const payload = {
      attachmentContent: [
        {
          fileType,
          contentExcerpt: excerpt
        }
      ],
      messageContext: {
        userMessage: normalizedAiInput ?? rawText.slice(0, 2_000)
      }
    };
    return {
      jsonText: JSON.stringify(payload),
      source: "wrapped_attachment",
      fileType
    };
  }
}

function buildContainerEnvironment(): string[] {
  return [
    "PATH=/usr/local/cargo/bin:/root/.cargo/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
    "TMPDIR=/tmp",
    "PIP_CACHE_DIR=/tmp/pip-cache",
    "XDG_CACHE_HOME=/tmp/.cache",
    "COREAGENT_TMP_DIR=/tmp"
  ];
}

export async function runDockerSkillPreflight(
  input: DockerPreflightInput
): Promise<DockerPreflightResult> {
  const workspace = await mkdtemp(join(tmpdir(), "coreagent-skill-preflight-"));
  const startedAt = new Date().toISOString();
  let stdout = "";
  let stderr = "";
  let exitCode = 1;
  const profileMap = parseImageProfileMap(process.env.RUNTIME_LOCAL_DOCKER_IMAGE_PROFILES ?? "");
  const defaultImage = process.env.RUNTIME_LOCAL_DOCKER_IMAGE?.trim();
  const scriptText = input.scriptBytes.toString("utf8");
  const initialInference =
    detectRuntimeProfileFromScript(scriptText) ??
    inferRuntimeProfileFromSkillId(input.skillId) ?? { profile: "default", source: "default" as const };

  try {
    await writeFile(join(workspace, "run.sh"), input.scriptBytes);
    await chmod(join(workspace, "run.sh"), 0o755);
    const normalizedExample = normalizeExampleInput(input.exampleBytes, input.aiInput);
    await writeFile(join(workspace, "input.json"), normalizedExample.jsonText, "utf8");
    await writeFile(join(workspace, "title.txt"), input.title, "utf8");

    async function executeAttempt(image: string, attempt: number, source: RuntimeInference["source"]) {
      const args = [
        "run",
        "--rm",
        "-v",
        `${workspace}:/workspace:ro`,
        "-w",
        "/workspace",
        ...buildContainerEnvironment().flatMap((entry) => ["-e", entry]),
        ...(input.mode === "remote" ? [] : ["--pull=missing"]),
        image,
        "/bin/sh",
        "-lc",
        "echo \"[preflight-attempt] " +
          attempt +
          "\" && echo \"[preflight-mode] " +
          input.mode +
          "\" && echo \"[preflight-input-source] " +
          normalizedExample.source +
          "\" && echo \"[preflight-input-type] " +
          normalizedExample.fileType +
          "\" && echo \"[preflight-runtime-source] " +
          source +
          "\" && echo \"[preflight-image] " +
          image +
          "\" && ./run.sh"
      ];

      let attemptStdout = "";
      let attemptStderr = "";
      let attemptExitCode = 1;
      await new Promise<void>((resolve) => {
        const child = spawn("docker", args, {
          env: process.env,
          stdio: ["ignore", "pipe", "pipe"]
        });

        child.stdout.on("data", (chunk: Buffer | string) => {
          const text = chunk.toString();
          attemptStdout += text;
          input.onChunk?.("stdout", text);
        });
        child.stderr.on("data", (chunk: Buffer | string) => {
          const text = chunk.toString();
          attemptStderr += text;
          input.onChunk?.("stderr", text);
        });
        child.on("error", (error) => {
          attemptStderr += `Failed to run docker preflight: ${error.message}\n`;
          attemptExitCode = 1;
          resolve();
        });
        child.on("close", (code) => {
          attemptExitCode = code ?? 1;
          resolve();
        });
      });

      return { attemptStdout, attemptStderr, attemptExitCode };
    }

    const firstImage = resolveDockerImage(initialInference.profile, profileMap, defaultImage);
    const firstAttempt = await executeAttempt(firstImage, 1, initialInference.source);
    stdout += firstAttempt.attemptStdout;
    stderr += firstAttempt.attemptStderr;
    exitCode = firstAttempt.attemptExitCode;

    if (exitCode !== 0) {
      const retryInference = inferRuntimeProfileFromMissingBinary(firstAttempt.attemptStderr);
      if (retryInference) {
        const retryImage = resolveDockerImage(retryInference.profile, profileMap, defaultImage);
        if (retryImage !== firstImage) {
          stdout += "[preflight-retry] runtime missing detected; retrying with remapped profile\n";
          const retryAttempt = await executeAttempt(retryImage, 2, retryInference.source);
          stdout += retryAttempt.attemptStdout;
          stderr += retryAttempt.attemptStderr;
          exitCode = retryAttempt.attemptExitCode;
        }
      }
    }
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }

  const finishedAt = new Date().toISOString();
  return {
    status: exitCode === 0 ? "passed" : "failed",
    exitCode,
    stdout,
    stderr,
    startedAt,
    finishedAt
  };
}
