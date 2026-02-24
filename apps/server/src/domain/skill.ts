import { z } from "zod";

export const SkillRiskSchema = z.enum(["low", "moderate", "high"]);

export const SkillPermissionSchema = z.object({
  permissionKey: z.string(),
  required: z.boolean(),
  riskLevel: SkillRiskSchema,
  permissionScope: z.record(z.string(), z.unknown())
});

export const SkillVersionSchema = z.object({
  version: z.string(),
  digest: z.string(),
  signature: z.string(),
  runtime: z.enum(["command", "http", "wasm"]).optional(),
  entrypoint: z.string().optional(),
  artifactUri: z.string().optional(),
  compatibilityMinAppVersion: z.string().nullable().optional(),
  compatibilityMaxAppVersion: z.string().nullable().optional(),
  policyStatus: z.enum(["pending", "approved", "rejected", "revoked"]).optional(),
  reviewStatus: z.enum(["not_submitted", "in_review", "approved", "rejected"]).optional(),
  trustBadge: z.boolean().optional(),
  trustBadgeMetadata: z.record(z.string(), z.unknown()).optional(),
  revokedAt: z.string().nullable().optional(),
  permissions: z.array(SkillPermissionSchema).optional()
});

export const SkillSummarySchema = z.object({
  skillId: z.string(),
  name: z.string(),
  description: z.string(),
  latestVersion: z.string(),
  risk: SkillRiskSchema,
  trusted: z.boolean().optional()
});

export const SkillDetailsSchema = SkillSummarySchema.extend({
  versions: z.array(SkillVersionSchema)
});

export const SkillAdvisorySchema = z.object({
  id: z.string(),
  skillId: z.string(),
  version: z.string().nullable(),
  advisoryType: z.enum(["warning", "revocation", "deprecation", "security"]),
  severity: z.enum(["low", "moderate", "high", "critical"]),
  title: z.string(),
  summary: z.string(),
  sequenceCursor: z.string().optional(),
  forceDisable: z.boolean().optional(),
  publishedAt: z.string(),
  resolvedAt: z.string().nullable()
});

export const AdvisoryFeedPageSchema = z.object({
  advisories: z.array(SkillAdvisorySchema),
  nextCursor: z.string().nullable(),
  hasMore: z.boolean()
});

export type SkillRisk = z.infer<typeof SkillRiskSchema>;
export type SkillPermission = z.infer<typeof SkillPermissionSchema>;
export type SkillVersion = z.infer<typeof SkillVersionSchema>;
export type SkillSummary = z.infer<typeof SkillSummarySchema>;
export type SkillDetails = z.infer<typeof SkillDetailsSchema>;
export type SkillAdvisory = z.infer<typeof SkillAdvisorySchema>;
export type AdvisoryFeedPage = z.infer<typeof AdvisoryFeedPageSchema>;
