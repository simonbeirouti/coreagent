import { describe, expect, it } from "vitest";

import {
  PublishValidationError,
  validateAndNormalizePublishManifest,
  type PublishValidationInput
} from "./manifest-validation.js";

function baseInput(): PublishValidationInput {
  return {
    skillId: "coreagent.phase3.example",
    implementationKey: "coreagent.phase3.example",
    name: "Phase 3 Example",
    description: "Example manifest",
    version: "1.0.0",
    runtime: "command",
    entrypoint: "scripts/run.sh",
    manifest: {},
    inputSchema: {},
    outputSchema: {},
    healthcheck: {},
    heartbeatPolicy: {},
    permissions: []
  };
}

describe("validateAndNormalizePublishManifest", () => {
  it("builds a normalized manifest for valid input", () => {
    const result = validateAndNormalizePublishManifest(baseInput());

    expect(result.compatibilityMinAppVersion).toBeNull();
    expect(result.compatibilityMaxAppVersion).toBeNull();
    expect(result.normalizedManifest).toMatchObject({
      skill_id: "coreagent.phase3.example",
      version: "1.0.0",
      runtime: "command",
      entrypoint: "scripts/run.sh"
    });
  });

  it("rejects invalid semver version", () => {
    expect(() =>
      validateAndNormalizePublishManifest({
        ...baseInput(),
        version: "v1"
      })
    ).toThrowError(PublishValidationError);
  });

  it("rejects unsafe entrypoint traversal", () => {
    expect(() =>
      validateAndNormalizePublishManifest({
        ...baseInput(),
        entrypoint: "../scripts/run.sh"
      })
    ).toThrowError(PublishValidationError);
  });

  it("rejects compatibility ranges where min is greater than max", () => {
    expect(() =>
      validateAndNormalizePublishManifest({
        ...baseInput(),
        compatibilityMinAppVersion: "2.0.0",
        compatibilityMaxAppVersion: "1.0.0"
      })
    ).toThrowError(PublishValidationError);
  });
});
