import type { RunnerEnv } from "./env.js";
import type { RequestedPermission } from "./permission-broker.js";

const CREDENTIAL_PERMISSION_PREFIX = "secrets.";

export type RequestedCredentialScope = {
  scope: string;
  required: boolean;
  permissionKey: string;
};

export type CredentialDecision =
  | {
      allowed: true;
      resolvedCredentials: Record<string, string>;
    }
  | {
      allowed: false;
      reason: string;
      deniedScope: string;
    };

function normalizeScope(value: string): string | null {
  const normalized = value.trim().toLowerCase();
  if (!/^[a-z0-9._:-]+$/.test(normalized)) {
    return null;
  }
  return normalized;
}

function parseStringScope(scope: unknown): string[] {
  if (typeof scope !== "string") {
    return [];
  }
  const normalized = normalizeScope(scope);
  return normalized ? [normalized] : [];
}

function parseArrayScope(scopes: unknown): string[] {
  if (!Array.isArray(scopes)) {
    return [];
  }
  return scopes
    .flatMap((value) => parseStringScope(value))
    .filter((value, index, values) => values.indexOf(value) === index);
}

function parseScopesFromPermission(permission: RequestedPermission): string[] {
  const derivedFromKey = permission.permissionKey.startsWith(CREDENTIAL_PERMISSION_PREFIX)
    ? parseStringScope(permission.permissionKey.slice(CREDENTIAL_PERMISSION_PREFIX.length))
    : [];

  const fromScope = parseStringScope(permission.permissionScope["credentialScope"]);
  const fromCredential = parseStringScope(permission.permissionScope["credential"]);
  const fromCredentials = parseArrayScope(permission.permissionScope["credentials"]);

  return [...derivedFromKey, ...fromScope, ...fromCredential, ...fromCredentials].filter(
    (value, index, values) => values.indexOf(value) === index
  );
}

function parseScopeEnvMap(value: string): Map<string, string> {
  const entries = value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  const map = new Map<string, string>();
  for (const entry of entries) {
    const separatorIndex = entry.indexOf("=");
    if (separatorIndex <= 0 || separatorIndex >= entry.length - 1) {
      continue;
    }
    const scope = normalizeScope(entry.slice(0, separatorIndex));
    const envVar = entry.slice(separatorIndex + 1).trim();
    if (!scope || envVar.length === 0) {
      continue;
    }
    map.set(scope, envVar);
  }
  return map;
}

export function extractRequestedCredentialScopes(
  permissions: RequestedPermission[]
): RequestedCredentialScope[] {
  const byScope = new Map<string, RequestedCredentialScope>();

  for (const permission of permissions) {
    const scopes = parseScopesFromPermission(permission);
    for (const scope of scopes) {
      const existing = byScope.get(scope);
      if (!existing) {
        byScope.set(scope, {
          scope,
          required: permission.required,
          permissionKey: permission.permissionKey
        });
        continue;
      }

      if (!existing.required && permission.required) {
        byScope.set(scope, {
          scope,
          required: true,
          permissionKey: permission.permissionKey
        });
      }
    }
  }

  return [...byScope.values()];
}

export function resolveCredentialRequest(
  requestedScopes: RequestedCredentialScope[],
  env: RunnerEnv,
  processEnv: NodeJS.ProcessEnv = process.env
): CredentialDecision {
  const scopeEnvMap = parseScopeEnvMap(env.RUNTIME_CREDENTIAL_SCOPE_MAP);
  const requiredScopes = requestedScopes.filter((scope) => scope.required);
  const resolved: Record<string, string> = {};

  for (const requestedScope of requiredScopes) {
    const envVar = scopeEnvMap.get(requestedScope.scope);
    if (!envVar) {
      return {
        allowed: false,
        deniedScope: requestedScope.scope,
        reason: `Credential scope "${requestedScope.scope}" is not mapped in RUNTIME_CREDENTIAL_SCOPE_MAP.`
      };
    }

    const value = processEnv[envVar];
    if (!value || value.trim().length === 0) {
      return {
        allowed: false,
        deniedScope: requestedScope.scope,
        reason: `Credential scope "${requestedScope.scope}" is mapped to "${envVar}" but no value is configured.`
      };
    }

    resolved[requestedScope.scope] = value;
  }

  return {
    allowed: true,
    resolvedCredentials: resolved
  };
}
