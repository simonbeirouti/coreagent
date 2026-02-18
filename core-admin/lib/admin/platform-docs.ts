export const CORE_TOOL_CLASSES = [
  {
    name: "Core Tools (Always-On)",
    keys: ["memory", "perception", "communication"],
    notes: "Mandatory, local runtime, not user-disableable.",
  },
  {
    name: "Registry-Managed Tools",
    keys: ["install", "assign", "runtime handshake", "policy/advisory"],
    notes: "Toggleable per agent and can be force-disabled by registry policy.",
  },
  {
    name: "Orchestration Runtime Tools",
    keys: ["required ability keys", "delegation prechecks", "blocked transitions"],
    notes: "Assignments fail safely when capabilities are unavailable.",
  },
] as const;

export const SKILLS_REGISTRY_LIFECYCLE = [
  "discovered",
  "installed",
  "assigned",
  "runtime_validated",
  "active",
  "revoked/force_disabled",
] as const;
