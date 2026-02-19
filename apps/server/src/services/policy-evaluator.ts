import type { SkillRisk } from "../domain/skill.js";
import type { PublishPermissionInput } from "./manifest-validation.js";

type PolicyDecisionStatus = "approved" | "rejected";
type PolicyReasonCode =
  | "invalid_permission_key"
  | "permission_denied"
  | "declared_risk_increased";

export type PolicyEvaluationInput = {
  declaredRiskLevel: SkillRisk;
  permissions: PublishPermissionInput[];
};

export type PolicyEvaluationResult = {
  status: PolicyDecisionStatus;
  effectiveRiskLevel: SkillRisk;
  reasons: PolicyReasonCode[];
  forcedDisableOnRevocation: boolean;
  summary: string;
};

const blockedPermissionKeys = new Set([
  "filesystem.host_write",
  "network.unrestricted",
  "secrets.raw_env"
]);

const riskWeight: Record<SkillRisk, number> = {
  low: 1,
  moderate: 2,
  high: 3
};

function maxRisk(left: SkillRisk, right: SkillRisk): SkillRisk {
  return riskWeight[left] >= riskWeight[right] ? left : right;
}

function isPermissionKeyValid(value: string): boolean {
  return /^[a-z0-9._:-]+$/.test(value);
}

export function evaluatePublishPolicy(input: PolicyEvaluationInput): PolicyEvaluationResult {
  const reasons: PolicyReasonCode[] = [];
  let effectiveRiskLevel = input.declaredRiskLevel;

  for (const permission of input.permissions) {
    if (!isPermissionKeyValid(permission.permissionKey)) {
      reasons.push("invalid_permission_key");
      return {
        status: "rejected",
        effectiveRiskLevel,
        reasons,
        forcedDisableOnRevocation: true,
        summary: "Policy rejected: permission keys must use lowercase dotted identifiers."
      };
    }

    if (permission.required && blockedPermissionKeys.has(permission.permissionKey)) {
      reasons.push("permission_denied");
      return {
        status: "rejected",
        effectiveRiskLevel,
        reasons,
        forcedDisableOnRevocation: true,
        summary: `Policy rejected: permission "${permission.permissionKey}" is not publishable.`
      };
    }

    effectiveRiskLevel = maxRisk(effectiveRiskLevel, permission.riskLevel);
  }

  if (effectiveRiskLevel !== input.declaredRiskLevel) {
    reasons.push("declared_risk_increased");
  }

  const forcedDisableOnRevocation =
    effectiveRiskLevel === "high" || input.permissions.some((permission) => permission.required);

  return {
    status: "approved",
    effectiveRiskLevel,
    reasons,
    forcedDisableOnRevocation,
    summary:
      reasons.length > 0
        ? "Policy approved with risk normalization."
        : "Policy approved with no adjustments."
  };
}
