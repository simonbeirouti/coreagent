import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

type SeedManifest = {
  skillId: string;
  artifactPath?: string;
  manifest?: {
    runtime_profile?: string;
  };
  permissions?: Array<{
    permissionKey: string;
  }>;
};

async function loadSeedManifests(): Promise<SeedManifest[]> {
  const manifestPath = join(process.cwd(), "data/seed/markdown-skills.manifests.json");
  const raw = await readFile(manifestPath, "utf8");
  return JSON.parse(raw) as SeedManifest[];
}

async function loadArtifactScript(artifactPath: string): Promise<string> {
  const absolutePath = join(process.cwd(), "data/seed", artifactPath);
  return readFile(absolutePath, "utf8");
}

function getManifest(manifests: SeedManifest[], skillId: string): SeedManifest {
  const manifest = manifests.find((item) => item.skillId === skillId);
  expect(manifest).toBeDefined();
  return manifest as SeedManifest;
}

describe("runtime seed manifests", () => {
  it("keeps manifest schemas aligned with top-level schemas", async () => {
    const manifests = await loadSeedManifests();
    for (const manifest of manifests) {
      const topLevelInput = (manifest as unknown as Record<string, unknown>).inputSchema;
      const topLevelOutput = (manifest as unknown as Record<string, unknown>).outputSchema;
      const runtimeInput = (manifest as unknown as Record<string, unknown>).manifest &&
        typeof (manifest as unknown as Record<string, unknown>).manifest === "object"
          ? ((manifest as unknown as Record<string, unknown>).manifest as Record<string, unknown>).input_schema
          : undefined;
      const runtimeOutput = (manifest as unknown as Record<string, unknown>).manifest &&
        typeof (manifest as unknown as Record<string, unknown>).manifest === "object"
          ? ((manifest as unknown as Record<string, unknown>).manifest as Record<string, unknown>).output_schema
          : undefined;

      expect(runtimeInput, `${manifest.skillId} input schema drift`).toEqual(topLevelInput);
      expect(runtimeOutput, `${manifest.skillId} output schema drift`).toEqual(topLevelOutput);
    }
  });

  it("includes python package-install use-case", async () => {
    const manifests = await loadSeedManifests();
    const manifest = getManifest(manifests, "coreagent.py.pandas_summary");

    expect(manifest.manifest?.runtime_profile).toBe("python");
    expect(manifest.permissions?.map((item) => item.permissionKey)).toContain("network.http");
    expect(manifest.permissions?.map((item) => item.permissionKey)).toContain("process.exec");

    const script = await loadArtifactScript(manifest.artifactPath as string);
    expect(script).toContain("python3 -m pip install");
    expect(script).toContain("\"summary\"");
    expect(script).toContain("\"top_rows\"");
  });

  it("includes node package-install use-case", async () => {
    const manifests = await loadSeedManifests();
    const manifest = getManifest(manifests, "coreagent.js.dayjs_timeline");

    expect(manifest.manifest?.runtime_profile).toBe("default");
    expect(manifest.permissions?.map((item) => item.permissionKey)).toContain("network.http");
    expect(manifest.permissions?.map((item) => item.permissionKey)).toContain("process.exec");

    const script = await loadArtifactScript(manifest.artifactPath as string);
    expect(script).toContain("npm install");
    expect(script).toContain("timeline,");
    expect(script).toContain("generatedAt:");
  });

  it("includes rust crate-install use-case", async () => {
    const manifests = await loadSeedManifests();
    const manifest = getManifest(manifests, "coreagent.rs.regex_advisor");

    expect(manifest.manifest?.runtime_profile).toBe("rust");
    expect(manifest.permissions?.map((item) => item.permissionKey)).toContain("network.http");
    expect(manifest.permissions?.map((item) => item.permissionKey)).toContain("process.exec");

    const script = await loadArtifactScript(manifest.artifactPath as string);
    expect(script).toContain("cargo run --quiet --manifest-path");
    expect(script).toContain("\"matchCount\"");
    expect(script).toContain("\"advisory\"");
  });

  it("uses runtime-driven validation instead of static fallback defaults", async () => {
    const manifests = await loadSeedManifests();
    const pythonManifest = getManifest(manifests, "coreagent.py.deep_analysis");
    const pandasManifest = getManifest(manifests, "coreagent.py.pandas_summary");
    const nodeManifest = getManifest(manifests, "coreagent.js.dayjs_timeline");
    const rustManifest = getManifest(manifests, "coreagent.rs.regex_advisor");

    const [pythonScript, pandasScript, nodeScript, rustScript] = await Promise.all([
      loadArtifactScript(pythonManifest.artifactPath as string),
      loadArtifactScript(pandasManifest.artifactPath as string),
      loadArtifactScript(nodeManifest.artifactPath as string),
      loadArtifactScript(rustManifest.artifactPath as string)
    ]);

    expect(pythonScript).toContain("VALIDATION_ERROR");
    expect(pandasScript).toContain("VALIDATION_ERROR");
    expect(nodeScript).toContain("VALIDATION_ERROR");
    expect(rustScript).toContain("VALIDATION_ERROR");
    expect(pythonScript).not.toContain("[1.0, 3.0, 7.0, 12.0, 18.0]");
    expect(pandasScript).not.toContain("{\"team\": \"alpha\", \"score\": 10}");
  });

  it("includes attachment_read runtime skill mapping entry", async () => {
    const manifests = await loadSeedManifests();
    const manifest = getManifest(manifests, "coreagent.py.attachment_read");

    expect(manifest.manifest?.runtime_profile).toBe("python");
    expect(manifest.permissions?.map((item) => item.permissionKey)).toContain("process.exec");

    const script = await loadArtifactScript(manifest.artifactPath as string);
    expect(script).toContain("attachmentContent");
    expect(script).toContain("\"readCount\"");
    expect(script).toContain("VALIDATION_ERROR:no attachments provided");
    expect(script).toContain("entry_status");
    expect(script).toContain("normalized_status");
  });
});
