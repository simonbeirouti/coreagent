import type { RunnerEnv } from "./env.js";

export type RequestedPermission = {
  permissionKey: string;
  required: boolean;
  permissionScope: Record<string, unknown>;
};

export type PermissionDecision =
  | {
      allowed: true;
    }
  | {
      allowed: false;
      reason: string;
      deniedPermissionKey: string;
    };

function normalizeAllowlist(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter((item) => item.length > 0);
}

function classifyPermission(permissionKey: string): "network" | "filesystem" | "browser" | "process" | "unknown" {
  if (permissionKey.startsWith("network") || permissionKey.includes("http")) {
    return "network";
  }
  if (permissionKey.startsWith("filesystem") || permissionKey.startsWith("fs")) {
    return "filesystem";
  }
  if (permissionKey.startsWith("browser")) {
    return "browser";
  }
  if (permissionKey.startsWith("process") || permissionKey.startsWith("exec")) {
    return "process";
  }
  return "unknown";
}

function allowedByClass(classification: ReturnType<typeof classifyPermission>, env: RunnerEnv): boolean {
  switch (classification) {
    case "network":
      return env.RUNTIME_ALLOW_NETWORK;
    case "filesystem":
      return env.RUNTIME_ALLOW_FILESYSTEM;
    case "browser":
      return env.RUNTIME_ALLOW_BROWSER;
    case "process":
      return env.RUNTIME_ALLOW_PROCESS;
    default:
      return false;
  }
}

function extractDomains(scope: Record<string, unknown>): string[] {
  const domains = scope["domains"];
  if (!Array.isArray(domains)) {
    return [];
  }
  return domains
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.toLowerCase().trim())
    .filter((value) => value.length > 0);
}

export function evaluatePermissionRequest(
  permissions: RequestedPermission[],
  env: RunnerEnv
): PermissionDecision {
  const requiredPermissions = permissions.filter((permission) => permission.required);
  if (requiredPermissions.length === 0) {
    return { allowed: true };
  }

  const networkAllowlist = normalizeAllowlist(env.RUNTIME_NETWORK_DOMAIN_ALLOWLIST);

  for (const permission of requiredPermissions) {
    const classification = classifyPermission(permission.permissionKey);
    if (!allowedByClass(classification, env)) {
      return {
        allowed: false,
        deniedPermissionKey: permission.permissionKey,
        reason: `Permission denied by runtime broker for class "${classification}".`
      };
    }

    if (classification === "network" && networkAllowlist.length > 0) {
      const requestedDomains = extractDomains(permission.permissionScope);
      const hasDeniedDomain = requestedDomains.some(
        (domain) => !networkAllowlist.includes(domain)
      );
      if (hasDeniedDomain) {
        return {
          allowed: false,
          deniedPermissionKey: permission.permissionKey,
          reason: "Network domain is outside runtime allowlist."
        };
      }
    }
  }

  return {
    allowed: true
  };
}
