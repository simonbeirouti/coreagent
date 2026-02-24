import { readFile } from "node:fs/promises";
import path from "node:path";

import { config as loadDotenv } from "dotenv";
import { z } from "zod";

import { validateAndNormalizePublishManifest } from "../src/services/manifest-validation.js";
import { evaluatePublishPolicy } from "../src/services/policy-evaluator.js";

loadDotenv({ path: path.resolve(process.cwd(), ".env"), override: false });

const payloadSchema = z.object({
  skillId: z.string().min(1),
  implementationKey: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  version: z.string().min(1),
  runtime: z.enum(["command", "http", "wasm"]),
  entrypoint: z.string().min(1),
  riskLevel: z.enum(["low", "moderate", "high"]).optional().default("moderate"),
  manifest: z.record(z.string(), z.unknown()).optional().default({}),
  inputSchema: z.record(z.string(), z.unknown()).optional().default({}),
  outputSchema: z.record(z.string(), z.unknown()).optional().default({}),
  healthcheck: z.record(z.string(), z.unknown()).optional().default({}),
  heartbeatPolicy: z.record(z.string(), z.unknown()).optional().default({}),
  compatibilityMinAppVersion: z.string().optional(),
  compatibilityMaxAppVersion: z.string().optional(),
  permissionProfileId: z.string().optional(),
  permissions: z
    .array(
      z.object({
        permissionKey: z.string().min(1),
        required: z.boolean().optional().default(true),
        riskLevel: z.enum(["low", "moderate", "high"]).optional().default("moderate"),
        permissionScope: z.record(z.string(), z.unknown()).optional().default({})
      })
    )
    .optional()
    .default([])
});

async function main() {
  const payloadPath = process.argv[2];
  if (!payloadPath) {
    throw new Error("Usage: pnpm skill:validate <path-to-publish-payload.json>");
  }

  const absolutePath = path.isAbsolute(payloadPath)
    ? payloadPath
    : path.resolve(process.cwd(), payloadPath);
  const payloadRaw = await readFile(absolutePath, "utf8");
  const parsed = payloadSchema.parse(JSON.parse(payloadRaw));
  const validation = validateAndNormalizePublishManifest({
    skillId: parsed.skillId,
    implementationKey: parsed.implementationKey,
    name: parsed.name,
    description: parsed.description,
    version: parsed.version,
    runtime: parsed.runtime,
    entrypoint: parsed.entrypoint,
    manifest: parsed.manifest,
    inputSchema: parsed.inputSchema,
    outputSchema: parsed.outputSchema,
    healthcheck: parsed.healthcheck,
    heartbeatPolicy: parsed.heartbeatPolicy,
    compatibilityMinAppVersion: parsed.compatibilityMinAppVersion,
    compatibilityMaxAppVersion: parsed.compatibilityMaxAppVersion,
    ...(parsed.permissionProfileId ? { permissionProfileId: parsed.permissionProfileId } : {}),
    permissions: parsed.permissions,
    ...(process.env.APP_RUNTIME_VERSION ? { appRuntimeVersion: process.env.APP_RUNTIME_VERSION } : {})
  });
  const policy = evaluatePublishPolicy({
    declaredRiskLevel: parsed.riskLevel,
    permissions: validation.normalizedPermissions
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        appliedPermissionProfileId: validation.appliedPermissionProfileId,
        compatibility: {
          minAppVersion: validation.compatibilityMinAppVersion,
          maxAppVersion: validation.compatibilityMaxAppVersion
        },
        policy,
        normalizedManifest: validation.normalizedManifest,
        normalizedPermissions: validation.normalizedPermissions
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
