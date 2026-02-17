import { describe, expect, it } from "vitest";

import { evaluatePublishPolicy } from "./policy-evaluator.js";

describe("evaluatePublishPolicy", () => {
  it("raises effective risk when permission risk is higher than declared", () => {
    const result = evaluatePublishPolicy({
      declaredRiskLevel: "low",
      permissions: [
        {
          permissionKey: "network.http",
          required: true,
          riskLevel: "high",
          permissionScope: {}
        }
      ]
    });

    expect(result.status).toBe("approved");
    expect(result.effectiveRiskLevel).toBe("high");
    expect(result.reasons).toContain("declared_risk_increased");
  });

  it("rejects blocked required permissions", () => {
    const result = evaluatePublishPolicy({
      declaredRiskLevel: "moderate",
      permissions: [
        {
          permissionKey: "network.unrestricted",
          required: true,
          riskLevel: "high",
          permissionScope: {}
        }
      ]
    });

    expect(result.status).toBe("rejected");
    expect(result.reasons).toContain("permission_denied");
  });

  it("rejects invalid permission keys", () => {
    const result = evaluatePublishPolicy({
      declaredRiskLevel: "moderate",
      permissions: [
        {
          permissionKey: "Network/Write",
          required: true,
          riskLevel: "moderate",
          permissionScope: {}
        }
      ]
    });

    expect(result.status).toBe("rejected");
    expect(result.reasons).toContain("invalid_permission_key");
  });
});
