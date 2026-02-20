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
    expect(script).toContain('cargo +"$RUSTUP_TOOLCHAIN" run');
    expect(script).toContain("\"matchCount\"");
    expect(script).toContain("\"advisory\"");
  });
});
