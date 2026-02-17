import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { config as loadDotenv } from "dotenv";
import { z } from "zod";

const emptyToUndefined = (value: unknown): unknown => {
  if (typeof value !== "string") {
    return value;
  }

  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
};

const optionalUrl = z.preprocess(emptyToUndefined, z.string().url().optional());
const optionalNonEmptyString = z.preprocess(
  emptyToUndefined,
  z.string().trim().min(1).optional()
);

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().default("127.0.0.1"),
  PORT: z.coerce.number().int().min(1).max(65535).default(4010),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  SUPABASE_URL: optionalUrl,
  JWT_JWKS_URL: optionalUrl,
  JWT_SECRET: optionalNonEmptyString,
  JWT_ISSUER: optionalNonEmptyString,
  JWT_AUDIENCE: z.string().trim().min(1).default("authenticated"),
  JWT_REQUIRE_AUTHENTICATED_ROLE: z.coerce.boolean().default(true),
  JWT_CLOCK_SKEW_SECONDS: z.coerce.number().int().min(0).max(300).default(30),
  DATABASE_URL: optionalNonEmptyString,
  DATABASE_SSL: z.coerce.boolean().default(false),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
  ARTIFACT_STORAGE_DIR: z.string().trim().min(1).default("data/artifacts"),
  ARTIFACT_MAX_BYTES: z.coerce.number().int().min(1).max(100 * 1024 * 1024).default(10 * 1024 * 1024),
  ENABLE_HEURISTIC_ARTIFACT_SCANNER: z.coerce.boolean().default(false),
  SIGNING_SECRET: optionalNonEmptyString,
  SIGNING_KEY_ID: z.string().trim().min(1).default("skills-registry-hmac-v1"),
  APP_RUNTIME_VERSION: optionalNonEmptyString,
  ENABLE_ADMIN_API: z.coerce.boolean().default(false),
  ADMIN_API_TOKEN: optionalNonEmptyString,
  PUBLIC_API_RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(10_000).default(120),
  PUBLIC_API_RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().min(1).max(3600).default(60)
});

export type AppEnv = z.infer<typeof EnvSchema>;

function hydrateEnvFromDotenvFiles(): void {
  const cwd = process.cwd();
  const rootEnvPath = resolve(cwd, "../.env");
  const serverEnvPath = resolve(cwd, ".env");

  if (existsSync(rootEnvPath)) {
    loadDotenv({ path: rootEnvPath, override: false });
  }

  if (existsSync(serverEnvPath)) {
    loadDotenv({ path: serverEnvPath, override: true });
  }
}

export function loadEnv(): AppEnv {
  hydrateEnvFromDotenvFiles();
  return EnvSchema.parse(process.env);
}
