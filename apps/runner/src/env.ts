import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { config as loadDotenv } from "dotenv";
import { z } from "zod";

function isRedisProtocol(value: string): boolean {
  try {
    const protocol = new URL(value).protocol;
    return protocol === "redis:" || protocol === "rediss:";
  } catch {
    return false;
  }
}

const RunnerEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  REDIS_URL: z
    .string()
    .url()
    .refine(isRedisProtocol, "REDIS_URL must use redis:// or rediss://")
    .default("redis://127.0.0.1:6379"),
  RUNTIME_RUN_QUEUE_NAME: z.string().trim().min(1).default("runtime-runs"),
  RUNTIME_RUN_CONCURRENCY: z.coerce.number().int().min(1).max(100).default(4),
  RUNTIME_ALLOW_NETWORK: z.coerce.boolean().default(false),
  RUNTIME_ALLOW_FILESYSTEM: z.coerce.boolean().default(false),
  RUNTIME_ALLOW_BROWSER: z.coerce.boolean().default(false),
  RUNTIME_ALLOW_PROCESS: z.coerce.boolean().default(false),
  RUNTIME_NETWORK_DOMAIN_ALLOWLIST: z.string().default(""),
  RUNTIME_CREDENTIAL_SCOPE_MAP: z.string().default(""),
  RUNTIME_ENABLE_LOCAL_DOCKER: z.coerce.boolean().default(false),
  RUNTIME_LOCAL_DOCKER_IMAGE: z.string().trim().min(1).default("node:20-alpine"),
  RUNTIME_LOCAL_DOCKER_IMAGE_PROFILES: z.string().default(""),
  RUNTIME_LOCAL_DOCKER_MEMORY_MB: z.coerce.number().int().min(64).max(16_384).default(256),
  RUNTIME_LOCAL_DOCKER_CPU_SHARES: z.coerce.number().int().min(2).max(1024).default(256),
  RUNTIME_LOCAL_DOCKER_NETWORK_DISABLED: z.coerce.boolean().default(true),
  RUNTIME_LOCAL_DOCKER_PULL_IF_MISSING: z.coerce.boolean().default(true),
  RUNTIME_ARTIFACT_STORAGE_DIR: z.string().trim().min(1).default("../server/data/artifacts")
});

export type RunnerEnv = z.infer<typeof RunnerEnvSchema>;

function hydrateEnvFromDotenvFiles(): void {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const serviceEnvPath = resolve(moduleDir, "../.env");
  if (existsSync(serviceEnvPath)) {
    loadDotenv({ path: serviceEnvPath, override: false });
  }
}

export function loadRunnerEnv(): RunnerEnv {
  hydrateEnvFromDotenvFiles();
  return RunnerEnvSchema.parse(process.env);
}
