import { createHmac, timingSafeEqual } from "node:crypto";
import { createRemoteJWKSet, jwtVerify, type JWTPayload, type JWTVerifyOptions } from "jose";
import { z } from "zod";

import type { AppEnv } from "./env.js";

type AuthResolution =
  | {
      ok: true;
      userId: string;
      source: "jwt";
    }
  | {
      ok: false;
      statusCode: number;
      message: string;
    };

type JwtPayload = {
  sub?: string;
  exp?: number;
  nbf?: number;
  iss?: string;
  aud?: string | string[];
  role?: string;
};

const uuidSchema = z.string().uuid();
const remoteJwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
type LocalVerifyResult =
  | { ok: true; payload: JwtPayload }
  | { ok: false; statusCode: number; message: string };

function parseBearerToken(headers: Record<string, unknown>): string | null {
  const raw = headers.authorization;
  if (typeof raw !== "string") {
    return null;
  }

  const prefix = "Bearer ";
  if (!raw.startsWith(prefix)) {
    return null;
  }

  const token = raw.slice(prefix.length).trim();
  return token.length > 0 ? token : null;
}

function encodeBase64Url(input: Buffer): string {
  return input
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function decodeBase64Url(input: string): Buffer {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const paddingLength = (4 - (normalized.length % 4)) % 4;
  const padding = "=".repeat(paddingLength);
  return Buffer.from(normalized + padding, "base64");
}

function parseJwtLocally(token: string): {
  header: { alg?: string };
  payload: JwtPayload;
  signatureInput: string;
  signature: string;
} | null {
  const parts = token.split(".");
  if (parts.length !== 3) {
    return null;
  }

  const [encodedHeader, encodedPayload, signature] = parts;
  if (!encodedHeader || !encodedPayload || !signature) {
    return null;
  }

  try {
    const header = JSON.parse(decodeBase64Url(encodedHeader).toString("utf8")) as { alg?: string };
    const payload = JSON.parse(decodeBase64Url(encodedPayload).toString("utf8")) as JwtPayload;
    return {
      header,
      payload,
      signatureInput: `${encodedHeader}.${encodedPayload}`,
      signature
    };
  } catch {
    return null;
  }
}

function verifyHs256Signature(signatureInput: string, signature: string, secret: string): boolean {
  const expected = createHmac("sha256", secret).update(signatureInput).digest();
  const actual = decodeBase64Url(signature);
  if (expected.length !== actual.length) {
    return false;
  }

  return timingSafeEqual(expected, actual);
}

function stripTrailingSlash(input: string): string {
  return input.endsWith("/") ? input.slice(0, -1) : input;
}

function resolveIssuer(env: AppEnv): string | undefined {
  if (env.JWT_ISSUER) {
    return env.JWT_ISSUER;
  }

  if (env.SUPABASE_URL) {
    return `${stripTrailingSlash(env.SUPABASE_URL)}/auth/v1`;
  }

  return undefined;
}

function resolveJwksUrl(env: AppEnv): string | undefined {
  if (env.JWT_JWKS_URL) {
    return env.JWT_JWKS_URL;
  }

  if (env.SUPABASE_URL) {
    return `${stripTrailingSlash(env.SUPABASE_URL)}/auth/v1/.well-known/jwks.json`;
  }

  return undefined;
}

function audienceMatches(payloadAudience: JwtPayload["aud"], expectedAudience: string): boolean {
  if (typeof payloadAudience === "string") {
    return payloadAudience === expectedAudience;
  }

  if (Array.isArray(payloadAudience)) {
    return payloadAudience.includes(expectedAudience);
  }

  return false;
}

function verifyLocallyWithSharedSecret(token: string, env: AppEnv): LocalVerifyResult {
  if (!env.JWT_SECRET) {
    return { ok: false, statusCode: 503, message: "JWT_SECRET is not configured." };
  }

  const parsed = parseJwtLocally(token);
  if (!parsed) {
    return { ok: false, statusCode: 401, message: "Invalid JWT format." };
  }

  if (parsed.header.alg !== "HS256") {
    return { ok: false, statusCode: 401, message: "Unsupported JWT algorithm." };
  }

  if (!verifyHs256Signature(parsed.signatureInput, parsed.signature, env.JWT_SECRET)) {
    return { ok: false, statusCode: 401, message: "Invalid JWT signature." };
  }

  const now = Math.floor(Date.now() / 1000);
  const skew = env.JWT_CLOCK_SKEW_SECONDS;

  if (typeof parsed.payload.nbf === "number" && parsed.payload.nbf > now + skew) {
    return { ok: false, statusCode: 401, message: "JWT not active yet." };
  }

  if (typeof parsed.payload.exp === "number" && parsed.payload.exp < now - skew) {
    return { ok: false, statusCode: 401, message: "JWT expired." };
  }

  const issuer = resolveIssuer(env);
  if (issuer && parsed.payload.iss !== issuer) {
    return { ok: false, statusCode: 401, message: "JWT issuer mismatch." };
  }

  if (env.JWT_AUDIENCE && !audienceMatches(parsed.payload.aud, env.JWT_AUDIENCE)) {
    return { ok: false, statusCode: 401, message: "JWT audience mismatch." };
  }

  return { ok: true, payload: parsed.payload };
}

function toVerifyOptions(env: AppEnv): JWTVerifyOptions {
  const options: JWTVerifyOptions = {
    clockTolerance: env.JWT_CLOCK_SKEW_SECONDS
  };

  const issuer = resolveIssuer(env);
  if (issuer) {
    options.issuer = issuer;
  }

  if (env.JWT_AUDIENCE) {
    options.audience = env.JWT_AUDIENCE;
  }

  return options;
}

async function verifyWithJwks(
  token: string,
  jwksUrl: string,
  options: JWTVerifyOptions
): Promise<JWTPayload> {
  let jwks = remoteJwksCache.get(jwksUrl);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(jwksUrl));
    remoteJwksCache.set(jwksUrl, jwks);
  }

  const { payload } = await jwtVerify(token, jwks, options);
  return payload;
}

async function parseUserIdFromJwt(token: string, env: AppEnv): Promise<AuthResolution> {
  try {
    const jwksUrl = resolveJwksUrl(env);
    let payload: JwtPayload | JWTPayload | null = null;

    if (jwksUrl) {
      const options = toVerifyOptions(env);
      payload = await verifyWithJwks(token, jwksUrl, options);
    } else if (env.JWT_SECRET) {
      const localVerification = verifyLocallyWithSharedSecret(token, env);
      if (!localVerification.ok) {
        return localVerification;
      }
      payload = localVerification.payload;
    } else {
      return {
        ok: false,
        statusCode: 503,
        message:
          "No JWT verification configuration found. Configure SUPABASE_URL/JWT_JWKS_URL or JWT_SECRET."
      };
    }

    if (env.JWT_REQUIRE_AUTHENTICATED_ROLE && payload.role !== "authenticated") {
      return {
        ok: false,
        statusCode: 403,
        message: "JWT role is not authorized for user-scoped routes."
      };
    }

    const parsedSub = uuidSchema.safeParse(payload.sub);
    if (!parsedSub.success) {
      return { ok: false, statusCode: 401, message: "JWT subject is not a valid user UUID." };
    }

    return {
      ok: true,
      userId: parsedSub.data,
      source: "jwt"
    };
  } catch (error) {
    if (error instanceof Error) {
      if (error.name.startsWith("JWT") || error.name.startsWith("JWS") || error.name.includes("JOSE")) {
        return { ok: false, statusCode: 401, message: "Invalid JWT token." };
      }
    }

    return { ok: false, statusCode: 503, message: "Failed to verify JWT token." };
  }
}

export async function resolveUserIdFromRequest(
  headers: Record<string, unknown>,
  env: AppEnv
): Promise<AuthResolution> {
  const token = parseBearerToken(headers);
  if (!token) {
    return { ok: false, statusCode: 401, message: "Missing Authorization Bearer token." };
  }

  return parseUserIdFromJwt(token, env);
}

export function signTestJwt(payload: JwtPayload, secret: string): string {
  const header = { alg: "HS256", typ: "JWT" };
  const encodedHeader = encodeBase64Url(Buffer.from(JSON.stringify(header), "utf8"));
  const encodedPayload = encodeBase64Url(Buffer.from(JSON.stringify(payload), "utf8"));
  const signatureInput = `${encodedHeader}.${encodedPayload}`;
  const signature = createHmac("sha256", secret).update(signatureInput).digest();
  return `${signatureInput}.${encodeBase64Url(signature)}`;
}
