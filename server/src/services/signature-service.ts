import { createHmac } from "node:crypto";

export class SignatureServiceError extends Error {
  public readonly statusCode: number;

  public constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

export type SignatureMetadata = {
  algorithm: "hmac-sha256";
  keyId: string;
  signedAt: string;
};

export type SignedDigest = {
  signature: string;
  metadata: SignatureMetadata;
};

function toBase64Url(value: Buffer): string {
  return value
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export class HmacSignatureService {
  public constructor(
    private readonly signingSecret: string | undefined,
    private readonly keyId: string
  ) {}

  public signDigest(digest: string): SignedDigest {
    if (!this.signingSecret) {
      throw new SignatureServiceError(503, "SIGNING_SECRET is not configured.");
    }

    const signedAt = new Date().toISOString();
    const payload = `sha256:${digest}:${signedAt}`;
    const signatureBytes = createHmac("sha256", this.signingSecret).update(payload).digest();
    const signature = `hmac-sha256.${toBase64Url(signatureBytes)}`;

    return {
      signature,
      metadata: {
        algorithm: "hmac-sha256",
        keyId: this.keyId,
        signedAt
      }
    };
  }

  public verifyDigest(
    digest: string,
    signature: string,
    signedAt: string
  ): boolean {
    if (!this.signingSecret) {
      throw new SignatureServiceError(503, "SIGNING_SECRET is not configured.");
    }

    if (!signature.startsWith("hmac-sha256.")) {
      return false;
    }

    const timestamp = Date.parse(signedAt);
    if (Number.isNaN(timestamp)) {
      return false;
    }

    const payload = `sha256:${digest}:${new Date(timestamp).toISOString()}`;
    const expectedBytes = createHmac("sha256", this.signingSecret).update(payload).digest();
    const expectedSignature = `hmac-sha256.${toBase64Url(expectedBytes)}`;
    return expectedSignature === signature;
  }
}
