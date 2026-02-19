import { rm } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ArtifactStoreError, LocalArtifactStore } from "./artifact-store.js";

const TEST_ROOT = join(process.cwd(), ".test-artifact-store");

describe("LocalArtifactStore", () => {
  afterEach(async () => {
    await rm(TEST_ROOT, { recursive: true, force: true });
  });

  it("rejects tampered content when declared digest does not match", async () => {
    const store = new LocalArtifactStore(TEST_ROOT, 1024 * 1024);
    const payload = Buffer.from("trusted payload", "utf8").toString("base64");

    await expect(
      store.putArtifact({
        artifactBase64: payload,
        declaredDigest: "b".repeat(64)
      })
    ).rejects.toThrowError(ArtifactStoreError);
  });

  it("rejects truncated base64 payloads (partial upload)", async () => {
    const store = new LocalArtifactStore(TEST_ROOT, 1024 * 1024);

    await expect(
      store.putArtifact({
        artifactBase64: "ZXhhbXBsZS"
      })
    ).rejects.toThrowError(ArtifactStoreError);
  });
});
