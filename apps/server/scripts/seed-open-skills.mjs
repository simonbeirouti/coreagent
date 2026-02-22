import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { config as loadDotenv } from "dotenv";

function hydrateEnvFromDotenvFiles() {
  const cwd = process.cwd();
  const serverEnvPath = path.resolve(cwd, ".env");

  if (existsSync(serverEnvPath)) {
    loadDotenv({ path: serverEnvPath, override: false });
  }
}

hydrateEnvFromDotenvFiles();

const registryBaseUrl = process.env.SKILLS_REGISTRY_BASE_URL ?? "http://127.0.0.1:4010";
const adminToken = process.env.ADMIN_API_TOKEN;
const manifestsPath =
  process.env.OPEN_SKILLS_MANIFEST_PATH ?? "data/seed/markdown-skills.manifests.json";

if (!adminToken) {
  console.error("Missing ADMIN_API_TOKEN environment variable.");
  process.exit(1);
}

function required(value, fieldName, skillId) {
  if (value === undefined || value === null || String(value).trim() === "") {
    throw new Error(`Skill ${skillId}: missing required field "${fieldName}".`);
  }
  return value;
}

function normalizeBaseUrl(url) {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

function toAbsolutePath(baseDir, value) {
  return path.isAbsolute(value) ? value : path.resolve(baseDir, value);
}

function withRuntimeContextSchema(schema) {
  const baseSchema = schema && typeof schema === "object" ? { ...schema } : { type: "object" };
  const properties =
    baseSchema.properties && typeof baseSchema.properties === "object" ? { ...baseSchema.properties } : {};
  const required = Array.isArray(baseSchema.required)
    ? baseSchema.required.filter((value) => typeof value === "string")
    : [];

  properties.messageContext = {
    type: "object",
    properties: {
      userMessage: { type: "string" },
      source: { type: "string" },
      conversationId: { type: "string" }
    }
  };
  properties.attachments = {
    type: "array",
    items: {
      type: "object",
      properties: {
        storagePath: { type: "string" },
        fileName: { type: "string" },
        fileType: { type: "string" }
      }
    }
  };
  properties.attachmentContent = {
    type: "array",
    items: {
      type: "object",
      properties: {
        storagePath: { type: "string" },
        fileType: { type: "string" },
        summary: { type: "string" },
        contentExcerpt: { type: "string" },
        truncated: { type: "boolean" }
      }
    }
  };

  return {
    ...baseSchema,
    type: "object",
    properties,
    required
  };
}

async function uploadArtifact(baseUrl, token, artifactBase64, skillId) {
  const response = await fetch(`${baseUrl}/v1/admin/artifacts/upload`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-admin-token": token,
    },
    body: JSON.stringify({ artifactBase64 }),
  });

  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      `Skill ${skillId}: artifact upload failed (${response.status}) ${json.message ?? ""}`.trim(),
    );
  }

  if (!json?.data?.digest) {
    throw new Error(`Skill ${skillId}: upload response did not include a digest.`);
  }

  return json.data.digest;
}

async function publishSkill(baseUrl, token, publishPayload, skillId, version) {
  const response = await fetch(`${baseUrl}/v1/admin/skills/publish`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-admin-token": token,
    },
    body: JSON.stringify(publishPayload),
  });

  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      `Skill ${skillId}@${version}: publish failed (${response.status}) ${json.message ?? ""}`.trim(),
    );
  }
}

async function main() {
  const baseUrl = normalizeBaseUrl(registryBaseUrl);
  const baseDir = path.resolve(process.cwd());
  const manifestListAbsolutePath = toAbsolutePath(baseDir, manifestsPath);

  const raw = await readFile(manifestListAbsolutePath, "utf8");
  const manifests = JSON.parse(raw);
  if (!Array.isArray(manifests)) {
    throw new Error(`Expected array in ${manifestListAbsolutePath}`);
  }

  console.log(`Seeding ${manifests.length} markdown skills from ${manifestListAbsolutePath}`);

  for (const item of manifests) {
    const skillId = required(item.skillId, "skillId", "unknown");
    const version = required(item.version, "version", skillId);

    const artifactBase64 =
      typeof item.artifactBase64 === "string" && item.artifactBase64.trim().length > 0
        ? item.artifactBase64.trim()
        : Buffer.from(
            await readFile(
              toAbsolutePath(path.dirname(manifestListAbsolutePath), required(item.artifactPath, "artifactPath", skillId)),
              "utf8",
            ),
            "utf8",
          ).toString("base64");

    const digest = await uploadArtifact(baseUrl, adminToken, artifactBase64, skillId);

    const publishPayload = {
      skillId,
      implementationKey: required(item.implementationKey, "implementationKey", skillId),
      name: required(item.name, "name", skillId),
      description: required(item.description, "description", skillId),
      riskLevel: item.riskLevel ?? "low",
      source: item.source ?? "coreagent_markdown_starter",
      version,
      runtime: required(item.runtime, "runtime", skillId),
      entrypoint: required(item.entrypoint, "entrypoint", skillId),
      artifactDigest: digest,
      manifest: {
        ...(item.manifest ?? {}),
        input_schema: withRuntimeContextSchema(item.manifest?.input_schema ?? item.inputSchema ?? {})
      },
      inputSchema: withRuntimeContextSchema(item.inputSchema ?? {}),
      outputSchema: item.outputSchema ?? {},
      healthcheck: item.healthcheck ?? {},
      heartbeatPolicy: item.heartbeatPolicy ?? {},
      compatibilityMinAppVersion: item.compatibilityMinAppVersion,
      compatibilityMaxAppVersion: item.compatibilityMaxAppVersion,
      permissions: Array.isArray(item.permissions) ? item.permissions : [],
    };

    await publishSkill(baseUrl, adminToken, publishPayload, skillId, version);
    console.log(`Published ${skillId}@${version}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
