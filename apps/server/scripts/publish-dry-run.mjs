import { readFile } from "node:fs/promises";
import path from "node:path";

import { config as loadDotenv } from "dotenv";

loadDotenv({ path: path.resolve(process.cwd(), ".env"), override: false });

async function main() {
  const payloadPath = process.argv[2];
  if (!payloadPath) {
    throw new Error("Usage: pnpm skill:publish:dry-run <path-to-publish-payload.json>");
  }

  const baseUrl = (process.env.SKILLS_REGISTRY_BASE_URL ?? "http://127.0.0.1:4010").replace(/\/$/, "");
  const adminToken = process.env.ADMIN_API_TOKEN;
  if (!adminToken) {
    throw new Error("Missing ADMIN_API_TOKEN environment variable.");
  }

  const absolutePath = path.isAbsolute(payloadPath)
    ? payloadPath
    : path.resolve(process.cwd(), payloadPath);
  const payloadRaw = await readFile(absolutePath, "utf8");
  const payload = JSON.parse(payloadRaw);

  const response = await fetch(`${baseUrl}/v1/admin/skills/publish/dry-run`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-admin-token": adminToken
    },
    body: JSON.stringify(payload)
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Dry-run failed (${response.status}): ${body.message ?? "unknown error"}`);
  }

  console.log(JSON.stringify(body, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
