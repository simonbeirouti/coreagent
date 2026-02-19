import { createHash } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { dirname, join, resolve } from "node:path";

const base64Pattern = /^[A-Za-z0-9+/]+={0,2}$/;
const sha256DigestPattern = /^[a-f0-9]{64}$/;

export class ArtifactStoreError extends Error {
  public readonly statusCode: number;

  public constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

export type ArtifactPutInput = {
  artifactBase64: string;
  declaredDigest?: string;
};

export type StoredArtifact = {
  digest: string;
  artifactUri: string;
  absolutePath: string;
  sizeBytes: number;
  stored: boolean;
};

function normalizeDigest(digest: string): string {
  return digest.trim().toLowerCase();
}

function decodeArtifactBase64(artifactBase64: string): Buffer {
  const normalized = artifactBase64.trim();
  if (normalized.length === 0) {
    throw new ArtifactStoreError(400, "artifactBase64 is required.");
  }

  if (normalized.length % 4 !== 0 || !base64Pattern.test(normalized)) {
    throw new ArtifactStoreError(400, "artifactBase64 must be valid base64.");
  }

  return Buffer.from(normalized, "base64");
}

function digestBytes(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export class LocalArtifactStore {
  private readonly rootDirectory: string;

  public constructor(
    rootDirectory: string,
    private readonly maxBytes: number
  ) {
    this.rootDirectory = resolve(rootDirectory);
  }

  public async putArtifact(input: ArtifactPutInput): Promise<StoredArtifact> {
    const bytes = decodeArtifactBase64(input.artifactBase64);
    if (bytes.byteLength === 0) {
      throw new ArtifactStoreError(400, "Artifact payload cannot be empty.");
    }

    if (bytes.byteLength > this.maxBytes) {
      throw new ArtifactStoreError(
        413,
        `Artifact payload exceeds max allowed size (${this.maxBytes} bytes).`
      );
    }

    const computedDigest = digestBytes(bytes);
    const declaredDigest = input.declaredDigest ? normalizeDigest(input.declaredDigest) : undefined;

    if (declaredDigest) {
      if (!sha256DigestPattern.test(declaredDigest)) {
        throw new ArtifactStoreError(400, "digest must be a lowercase SHA-256 hex string.");
      }

      if (declaredDigest !== computedDigest) {
        throw new ArtifactStoreError(400, "Provided digest does not match artifact content.");
      }
    }

    const digest = computedDigest;
    const absolutePath = this.resolveDigestPath(digest);
    await mkdir(dirname(absolutePath), { recursive: true });

    let stored = false;
    try {
      await writeFile(absolutePath, bytes, { flag: "wx" });
      stored = true;
    } catch (error) {
      if (
        !error ||
        typeof error !== "object" ||
        !("code" in error) ||
        (error as { code?: string }).code !== "EEXIST"
      ) {
        throw error;
      }
    }

    return {
      digest,
      artifactUri: this.toArtifactUri(digest),
      absolutePath,
      sizeBytes: bytes.byteLength,
      stored
    };
  }

  public async hasDigest(digest: string): Promise<boolean> {
    const normalized = normalizeDigest(digest);
    if (!sha256DigestPattern.test(normalized)) {
      return false;
    }

    const path = this.resolveDigestPath(normalized);
    try {
      await access(path, fsConstants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  public async readDigest(digest: string): Promise<Buffer | null> {
    const normalized = normalizeDigest(digest);
    if (!sha256DigestPattern.test(normalized)) {
      return null;
    }

    const path = this.resolveDigestPath(normalized);
    try {
      return await readFile(path);
    } catch {
      return null;
    }
  }

  public toArtifactUri(digest: string): string {
    return `artifact://sha256/${normalizeDigest(digest)}`;
  }

  private resolveDigestPath(digest: string): string {
    const prefix = digest.slice(0, 2);
    return join(this.rootDirectory, prefix, `${digest}.bin`);
  }
}

export function isSha256Digest(value: string): boolean {
  return sha256DigestPattern.test(value.trim().toLowerCase());
}
