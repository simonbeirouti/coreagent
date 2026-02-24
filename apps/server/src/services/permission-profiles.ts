import { z } from "zod";

export const PermissionProfileIdSchema = z.enum([
  "read_only",
  "filesystem_scoped",
  "network_limited",
  "browser_automation"
]);

export type PermissionProfileId = z.infer<typeof PermissionProfileIdSchema>;

export type PermissionProfilePermission = {
  permissionKey: string;
  required: boolean;
  riskLevel: "low" | "moderate" | "high";
  permissionScope: Record<string, unknown>;
};

export type PermissionProfile = {
  id: PermissionProfileId;
  title: string;
  description: string;
  permissions: PermissionProfilePermission[];
};

const PROFILES: Record<PermissionProfileId, PermissionProfile> = {
  read_only: {
    id: "read_only",
    title: "Read-only",
    description: "Safe read-only profile for retrieval and introspection tools.",
    permissions: [
      {
        permissionKey: "filesystem.read",
        required: true,
        riskLevel: "low",
        permissionScope: {
          mode: "read_only",
          allowedPaths: ["workspace"]
        }
      }
    ]
  },
  filesystem_scoped: {
    id: "filesystem_scoped",
    title: "Filesystem Scoped",
    description: "Filesystem profile constrained to sandboxed workspace paths.",
    permissions: [
      {
        permissionKey: "filesystem.read_write",
        required: true,
        riskLevel: "moderate",
        permissionScope: {
          allowedPaths: ["workspace"],
          denyOutsideWorkspace: true
        }
      }
    ]
  },
  network_limited: {
    id: "network_limited",
    title: "Network Limited",
    description: "Outbound network access with explicit allowlist requirements.",
    permissions: [
      {
        permissionKey: "network.http",
        required: true,
        riskLevel: "moderate",
        permissionScope: {
          mode: "allowlist_required",
          allowedDomains: []
        }
      }
    ]
  },
  browser_automation: {
    id: "browser_automation",
    title: "Browser Automation",
    description: "Browser interaction profile with restricted automation boundary.",
    permissions: [
      {
        permissionKey: "browser.automation",
        required: true,
        riskLevel: "high",
        permissionScope: {
          sandboxed: true
        }
      }
    ]
  }
};

export function listPermissionProfiles(): PermissionProfile[] {
  return Object.values(PROFILES);
}

export function resolvePermissionProfile(profileId: string | null | undefined): PermissionProfile | null {
  if (!profileId) {
    return null;
  }
  const parsed = PermissionProfileIdSchema.safeParse(profileId);
  if (!parsed.success) {
    return null;
  }
  return PROFILES[parsed.data];
}
