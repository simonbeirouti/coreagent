import { isAbsolute } from "node:path";

import { z } from "zod";

import { compareSemver, isValidSemver } from "./semver.js";

const runtimeSchema = z.enum(["command", "http", "wasm"]);
const riskLevelSchema = z.enum(["low", "moderate", "high"]);

const permissionSchema = z.object({
  permissionKey: z.string().trim().min(1),
  required: z.boolean().optional().default(true),
  riskLevel: riskLevelSchema.optional().default("moderate"),
  permissionScope: z.record(z.string(), z.unknown()).optional().default({})
});

const manifestPermissionSchema = z.object({
  permission_key: z.string().trim().min(1),
  required: z.boolean().optional().default(true),
  risk_level: riskLevelSchema.optional().default("moderate"),
  permission_scope: z.record(z.string(), z.unknown()).optional().default({})
});

const manifestSchema = z.object({
  skill_id: z.string().trim().min(1),
  name: z.string().trim().min(1),
  version: z.string().trim().min(1),
  description: z.string().trim().min(1),
  entrypoint: z.string().trim().min(1),
  runtime: runtimeSchema,
  input_schema: z.record(z.string(), z.unknown()).optional().default({}),
  output_schema: z.record(z.string(), z.unknown()).optional().default({}),
  permissions: z.array(manifestPermissionSchema).optional().default([]),
  compatibility: z
    .object({
      min_app_version: z.string().trim().min(1).optional(),
      max_app_version: z.string().trim().min(1).optional()
    })
    .optional()
    .default({}),
  healthcheck: z.record(z.string(), z.unknown()).optional().default({}),
  heartbeat_policy: z.record(z.string(), z.unknown()).optional().default({})
});

const forbiddenManifestFields = new Set([
  "secrets",
  "env",
  "postinstall",
  "install",
  "hooks",
  "shell"
]);

export type PublishPermissionInput = z.infer<typeof permissionSchema>;

export type PublishValidationInput = {
  skillId: string;
  implementationKey: string;
  name: string;
  description: string;
  version: string;
  runtime: "command" | "http" | "wasm";
  entrypoint: string;
  manifest: Record<string, unknown>;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  healthcheck: Record<string, unknown>;
  heartbeatPolicy: Record<string, unknown>;
  compatibilityMinAppVersion?: string;
  compatibilityMaxAppVersion?: string;
  permissions: PublishPermissionInput[];
  appRuntimeVersion?: string;
};

export type ManifestValidationResult = {
  normalizedManifest: Record<string, unknown>;
  normalizedPermissions: PublishPermissionInput[];
  compatibilityMinAppVersion: string | null;
  compatibilityMaxAppVersion: string | null;
};

export class PublishValidationError extends Error {
  public readonly statusCode: number;

  public constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

function ensureNoForbiddenManifestFields(manifest: Record<string, unknown>): void {
  const found = Object.keys(manifest).find((key) => forbiddenManifestFields.has(key));
  if (found) {
    throw new PublishValidationError(400, `Manifest field "${found}" is not allowed.`);
  }
}

function ensureEntrypointIsSafe(runtime: "command" | "http" | "wasm", entrypoint: string): void {
  if (entrypoint.includes("\u0000")) {
    throw new PublishValidationError(400, "Entrypoint cannot contain null bytes.");
  }

  if (runtime === "http") {
    let parsed: URL;
    try {
      parsed = new URL(entrypoint);
    } catch {
      throw new PublishValidationError(400, "HTTP runtime entrypoint must be a valid URL.");
    }

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new PublishValidationError(400, "HTTP runtime entrypoint must use http/https.");
    }
    return;
  }

  if (isAbsolute(entrypoint)) {
    throw new PublishValidationError(400, "Entrypoint must be relative for local runtimes.");
  }

  if (entrypoint.includes("..")) {
    throw new PublishValidationError(400, "Entrypoint path traversal is not allowed.");
  }

  if (entrypoint.includes("://")) {
    throw new PublishValidationError(400, "Entrypoint cannot include URI schemes for local runtimes.");
  }

  if (!/^[A-Za-z0-9._/-]+$/.test(entrypoint)) {
    throw new PublishValidationError(400, "Entrypoint contains unsupported characters.");
  }
}

function ensureSemverRangeIsValid(
  minVersion: string | null,
  maxVersion: string | null,
  appRuntimeVersion?: string
): void {
  if (minVersion && !isValidSemver(minVersion)) {
    throw new PublishValidationError(400, "compatibility min_app_version must be a semver value.");
  }

  if (maxVersion && !isValidSemver(maxVersion)) {
    throw new PublishValidationError(400, "compatibility max_app_version must be a semver value.");
  }

  if (minVersion && maxVersion) {
    const compared = compareSemver(minVersion, maxVersion);
    if (compared === null || compared > 0) {
      throw new PublishValidationError(
        400,
        "compatibility min_app_version must be less than or equal to max_app_version."
      );
    }
  }

  if (appRuntimeVersion) {
    if (!isValidSemver(appRuntimeVersion)) {
      throw new PublishValidationError(500, "APP_RUNTIME_VERSION is not a valid semver value.");
    }

    if (minVersion) {
      const minComparison = compareSemver(appRuntimeVersion, minVersion);
      if (minComparison === null || minComparison < 0) {
        throw new PublishValidationError(
          400,
          "Skill compatibility min_app_version is newer than APP_RUNTIME_VERSION."
        );
      }
    }

    if (maxVersion) {
      const maxComparison = compareSemver(appRuntimeVersion, maxVersion);
      if (maxComparison === null || maxComparison > 0) {
        throw new PublishValidationError(
          400,
          "Skill compatibility max_app_version is older than APP_RUNTIME_VERSION."
        );
      }
    }
  }
}

function normalizePermissions(
  requestPermissions: PublishPermissionInput[],
  manifestPermissions: z.infer<typeof manifestPermissionSchema>[]
): PublishPermissionInput[] {
  if (requestPermissions.length === 0 && manifestPermissions.length > 0) {
    return manifestPermissions.map((permission) => ({
      permissionKey: permission.permission_key,
      required: permission.required,
      riskLevel: permission.risk_level,
      permissionScope: permission.permission_scope
    }));
  }

  if (requestPermissions.length > 0 && manifestPermissions.length > 0) {
    const requestKeys = requestPermissions.map((permission) => permission.permissionKey).sort();
    const manifestKeys = manifestPermissions.map((permission) => permission.permission_key).sort();
    if (JSON.stringify(requestKeys) !== JSON.stringify(manifestKeys)) {
      throw new PublishValidationError(
        400,
        "Manifest permissions and request permissions must reference the same permission keys."
      );
    }
  }

  return requestPermissions.map((permission) => permissionSchema.parse(permission));
}

function resolveCompatibility(
  input: PublishValidationInput,
  manifestCompatibility: z.infer<typeof manifestSchema>["compatibility"]
): { minVersion: string | null; maxVersion: string | null } {
  const requestMin = input.compatibilityMinAppVersion ?? null;
  const requestMax = input.compatibilityMaxAppVersion ?? null;
  const manifestMin = manifestCompatibility?.min_app_version ?? null;
  const manifestMax = manifestCompatibility?.max_app_version ?? null;

  if (requestMin && manifestMin && requestMin !== manifestMin) {
    throw new PublishValidationError(
      400,
      "compatibilityMinAppVersion must match manifest compatibility.min_app_version."
    );
  }

  if (requestMax && manifestMax && requestMax !== manifestMax) {
    throw new PublishValidationError(
      400,
      "compatibilityMaxAppVersion must match manifest compatibility.max_app_version."
    );
  }

  return {
    minVersion: requestMin ?? manifestMin,
    maxVersion: requestMax ?? manifestMax
  };
}

function buildCanonicalManifest(
  input: PublishValidationInput,
  permissions: PublishPermissionInput[],
  minVersion: string | null,
  maxVersion: string | null
): Record<string, unknown> {
  const compatibility: Record<string, string> = {};
  if (minVersion) {
    compatibility.min_app_version = minVersion;
  }
  if (maxVersion) {
    compatibility.max_app_version = maxVersion;
  }

  return {
    skill_id: input.skillId,
    implementation_key: input.implementationKey,
    name: input.name,
    version: input.version,
    description: input.description,
    runtime: input.runtime,
    entrypoint: input.entrypoint,
    input_schema: input.inputSchema,
    output_schema: input.outputSchema,
    permissions: permissions.map((permission) => ({
      permission_key: permission.permissionKey,
      required: permission.required,
      risk_level: permission.riskLevel,
      permission_scope: permission.permissionScope
    })),
    compatibility,
    healthcheck: input.healthcheck,
    heartbeat_policy: input.heartbeatPolicy
  };
}

export function validateAndNormalizePublishManifest(
  input: PublishValidationInput
): ManifestValidationResult {
  if (!isValidSemver(input.version)) {
    throw new PublishValidationError(400, "version must be a semver value.");
  }

  const rawManifest = input.manifest;
  ensureNoForbiddenManifestFields(rawManifest);
  const parsedManifest = manifestSchema.parse({
    ...rawManifest,
    skill_id: rawManifest.skill_id ?? input.skillId,
    name: rawManifest.name ?? input.name,
    version: rawManifest.version ?? input.version,
    description: rawManifest.description ?? input.description,
    runtime: rawManifest.runtime ?? input.runtime,
    entrypoint: rawManifest.entrypoint ?? input.entrypoint,
    input_schema: rawManifest.input_schema ?? input.inputSchema,
    output_schema: rawManifest.output_schema ?? input.outputSchema,
    permissions: rawManifest.permissions ?? [],
    healthcheck: rawManifest.healthcheck ?? input.healthcheck,
    heartbeat_policy: rawManifest.heartbeat_policy ?? input.heartbeatPolicy
  });

  if (parsedManifest.skill_id !== input.skillId) {
    throw new PublishValidationError(400, "Manifest skill_id must match request skillId.");
  }
  if (parsedManifest.name !== input.name) {
    throw new PublishValidationError(400, "Manifest name must match request name.");
  }
  if (parsedManifest.version !== input.version) {
    throw new PublishValidationError(400, "Manifest version must match request version.");
  }
  if (parsedManifest.runtime !== input.runtime) {
    throw new PublishValidationError(400, "Manifest runtime must match request runtime.");
  }
  if (parsedManifest.entrypoint !== input.entrypoint) {
    throw new PublishValidationError(400, "Manifest entrypoint must match request entrypoint.");
  }

  ensureEntrypointIsSafe(input.runtime, input.entrypoint);

  const compatibility = resolveCompatibility(input, parsedManifest.compatibility);
  ensureSemverRangeIsValid(compatibility.minVersion, compatibility.maxVersion, input.appRuntimeVersion);
  const permissions = normalizePermissions(input.permissions, parsedManifest.permissions);

  return {
    normalizedManifest: buildCanonicalManifest(
      {
        ...input,
        inputSchema: parsedManifest.input_schema,
        outputSchema: parsedManifest.output_schema,
        healthcheck: parsedManifest.healthcheck,
        heartbeatPolicy: parsedManifest.heartbeat_policy
      },
      permissions,
      compatibility.minVersion,
      compatibility.maxVersion
    ),
    normalizedPermissions: permissions,
    compatibilityMinAppVersion: compatibility.minVersion,
    compatibilityMaxAppVersion: compatibility.maxVersion
  };
}
