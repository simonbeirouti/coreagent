import { describe, expect, it } from "vitest";

import { HmacSignatureService, SignatureServiceError } from "./signature-service.js";

describe("HmacSignatureService", () => {
  it("signs and verifies digest with metadata timestamp", () => {
    const service = new HmacSignatureService("test-secret", "test-key");
    const signed = service.signDigest("a".repeat(64));

    expect(
      service.verifyDigest("a".repeat(64), signed.signature, signed.metadata.signedAt)
    ).toBe(true);
  });

  it("rejects signature verification when digest is tampered", () => {
    const service = new HmacSignatureService("test-secret", "test-key");
    const signed = service.signDigest("a".repeat(64));

    expect(
      service.verifyDigest("b".repeat(64), signed.signature, signed.metadata.signedAt)
    ).toBe(false);
  });

  it("rejects malformed signature prefixes and invalid timestamps", () => {
    const service = new HmacSignatureService("test-secret", "test-key");

    expect(service.verifyDigest("a".repeat(64), "sha256.invalid", new Date().toISOString())).toBe(false);
    expect(service.verifyDigest("a".repeat(64), "hmac-sha256.invalid", "not-a-date")).toBe(false);
  });

  it("throws when signing secret is missing", () => {
    const service = new HmacSignatureService(undefined, "test-key");

    expect(() => service.signDigest("a".repeat(64))).toThrowError(SignatureServiceError);
    expect(() =>
      service.verifyDigest("a".repeat(64), "hmac-sha256.anything", new Date().toISOString())
    ).toThrowError(SignatureServiceError);
  });
});
