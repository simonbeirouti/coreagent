import type { Pool } from "pg";

import type {
  AdvisoryFeedPage,
  SkillPermission,
  SkillAdvisory,
  SkillDetails,
  SkillSummary,
  SkillVersion
} from "../domain/skill.js";
import type { SkillRepository } from "./skill-repository.js";

type SkillSummaryRow = {
  skillId: string;
  name: string;
  description: string;
  latestVersion: string | null;
  risk: SkillSummary["risk"];
};

type SkillVersionRow = {
  version: string;
  digest: string;
  signature: string;
  runtime: "command" | "http" | "wasm";
  entrypoint: string;
  artifactUri: string | null;
  compatibilityMinAppVersion: string | null;
  compatibilityMaxAppVersion: string | null;
  policyStatus: "pending" | "approved" | "rejected" | "revoked";
  revokedAt: string | null;
};

type AdvisoryRow = {
  id: string;
  skillId: string;
  version: string | null;
  advisoryType: SkillAdvisory["advisoryType"];
  severity: SkillAdvisory["severity"];
  title: string;
  summary: string;
  publishedAt: string;
  sequenceCursor: string;
  forceDisable: boolean;
  resolvedAt: string | null;
};

type PermissionRow = {
  skillVersion: string;
  permissionKey: string;
  required: boolean;
  riskLevel: SkillPermission["riskLevel"];
  permissionScope: Record<string, unknown>;
};

type AdvisoryCursor = {
  publishedAt: string;
  id: string;
};

function encodeAdvisoryCursor(value: AdvisoryCursor): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function decodeAdvisoryCursor(value: string): AdvisoryCursor | null {
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Partial<AdvisoryCursor>;
    if (typeof parsed.publishedAt !== "string" || typeof parsed.id !== "string") {
      return null;
    }
    return {
      publishedAt: parsed.publishedAt,
      id: parsed.id
    };
  } catch {
    return null;
  }
}

export class PostgresSkillRepository implements SkillRepository {
  public constructor(private readonly pool: Pool) {}

  public async listSkills(query?: string): Promise<SkillSummary[]> {
    const sql = `
      SELECT
        s.skill_id AS "skillId",
        s.name,
        s.description,
        latest_version.version AS "latestVersion",
        s.risk_level AS "risk"
      FROM skills s
      LEFT JOIN LATERAL (
        SELECT sv.version
        FROM skill_versions sv
        WHERE sv.skill_ref_id = s.id
          AND sv.policy_status = 'approved'
          AND sv.revoked_at IS NULL
        ORDER BY COALESCE(sv.published_at, sv.created_at) DESC
        LIMIT 1
      ) latest_version ON TRUE
      WHERE s.status <> 'disabled'
        AND (
          $1::text IS NULL
          OR s.skill_id ILIKE '%' || $1::text || '%'
          OR s.name ILIKE '%' || $1::text || '%'
          OR s.description ILIKE '%' || $1::text || '%'
        )
      ORDER BY s.updated_at DESC, s.name ASC
      LIMIT 100
    `;

    const result = await this.pool.query<SkillSummaryRow>(sql, [query ?? null]);
    return result.rows.map((row) => ({
      skillId: row.skillId,
      name: row.name,
      description: row.description,
      latestVersion: row.latestVersion ?? "",
      risk: row.risk
    }));
  }

  public async getSkill(skillId: string): Promise<SkillDetails | null> {
    const skillSql = `
      SELECT
        s.skill_id AS "skillId",
        s.name,
        s.description,
        latest_version.version AS "latestVersion",
        s.risk_level AS "risk"
      FROM skills s
      LEFT JOIN LATERAL (
        SELECT sv.version
        FROM skill_versions sv
        WHERE sv.skill_ref_id = s.id
          AND sv.policy_status = 'approved'
          AND sv.revoked_at IS NULL
        ORDER BY COALESCE(sv.published_at, sv.created_at) DESC
        LIMIT 1
      ) latest_version ON TRUE
      WHERE s.skill_id = $1::text
        AND s.status <> 'disabled'
      LIMIT 1
    `;

    const skillResult = await this.pool.query<SkillSummaryRow>(skillSql, [skillId]);
    const summary = skillResult.rows[0];
    if (!summary) {
      return null;
    }

    const versionsSql = `
      SELECT
        sv.version,
        sv.digest,
        sv.signature,
        sv.runtime,
        sv.entrypoint,
        sv.artifact_uri AS "artifactUri",
        sv.compatibility_min_app_version AS "compatibilityMinAppVersion",
        sv.compatibility_max_app_version AS "compatibilityMaxAppVersion",
        sv.policy_status AS "policyStatus",
        sv.revoked_at::text AS "revokedAt"
      FROM skill_versions sv
      JOIN skills s ON s.id = sv.skill_ref_id
      WHERE s.skill_id = $1::text
        AND sv.policy_status = 'approved'
      ORDER BY COALESCE(sv.published_at, sv.created_at) DESC
    `;

    const versionsResult = await this.pool.query<SkillVersionRow>(versionsSql, [skillId]);
    const permissionResult = await this.pool.query<PermissionRow>(
      `
        SELECT
          sv.version AS "skillVersion",
          sp.permission_key AS "permissionKey",
          sp.required AS required,
          sp.risk_level AS "riskLevel",
          sp.permission_scope AS "permissionScope"
        FROM skill_permissions sp
        JOIN skill_versions sv ON sv.id = sp.skill_version_id
        JOIN skills s ON s.id = sv.skill_ref_id
        WHERE s.skill_id = $1::text
      `,
      [skillId]
    );
    const permissionsByVersion = new Map<string, SkillPermission[]>();
    for (const row of permissionResult.rows) {
      const existing = permissionsByVersion.get(row.skillVersion) ?? [];
      existing.push({
        permissionKey: row.permissionKey,
        required: row.required,
        riskLevel: row.riskLevel,
        permissionScope: row.permissionScope
      });
      permissionsByVersion.set(row.skillVersion, existing);
    }

    const versions: SkillVersion[] = versionsResult.rows.map((row) => ({
      version: row.version,
      digest: row.digest,
      signature: row.signature,
      runtime: row.runtime,
      entrypoint: row.entrypoint,
      artifactUri: row.artifactUri ?? undefined,
      compatibilityMinAppVersion: row.compatibilityMinAppVersion,
      compatibilityMaxAppVersion: row.compatibilityMaxAppVersion,
      policyStatus: row.policyStatus,
      revokedAt: row.revokedAt,
      permissions: permissionsByVersion.get(row.version)
    }));

    return {
      skillId: summary.skillId,
      name: summary.name,
      description: summary.description,
      latestVersion: summary.latestVersion ?? "",
      risk: summary.risk,
      versions
    };
  }

  public async getSkillVersion(skillId: string, version: string): Promise<SkillVersion | null> {
    const sql = `
      SELECT
        sv.version,
        sv.digest,
        sv.signature,
        sv.runtime,
        sv.entrypoint,
        sv.artifact_uri AS "artifactUri",
        sv.compatibility_min_app_version AS "compatibilityMinAppVersion",
        sv.compatibility_max_app_version AS "compatibilityMaxAppVersion",
        sv.policy_status AS "policyStatus",
        sv.revoked_at::text AS "revokedAt"
      FROM skill_versions sv
      JOIN skills s ON s.id = sv.skill_ref_id
      WHERE s.skill_id = $1::text
        AND sv.version = $2::text
      LIMIT 1
    `;

    const result = await this.pool.query<SkillVersionRow>(sql, [skillId, version]);
    const row = result.rows[0];
    if (!row) {
      return null;
    }

    const permissions = await this.pool.query<PermissionRow>(
      `
        SELECT
          sp.permission_key AS "permissionKey",
          sp.required AS required,
          sp.risk_level AS "riskLevel",
          sp.permission_scope AS "permissionScope"
        FROM skill_permissions sp
        JOIN skill_versions sv ON sv.id = sp.skill_version_id
        JOIN skills s ON s.id = sv.skill_ref_id
        WHERE s.skill_id = $1::text
          AND sv.version = $2::text
      `,
      [skillId, version]
    );

    return {
      version: row.version,
      digest: row.digest,
      signature: row.signature,
      runtime: row.runtime,
      entrypoint: row.entrypoint,
      artifactUri: row.artifactUri ?? undefined,
      compatibilityMinAppVersion: row.compatibilityMinAppVersion,
      compatibilityMaxAppVersion: row.compatibilityMaxAppVersion,
      policyStatus: row.policyStatus,
      revokedAt: row.revokedAt,
      permissions: permissions.rows.map((permission) => ({
        permissionKey: permission.permissionKey,
        required: permission.required,
        riskLevel: permission.riskLevel,
        permissionScope: permission.permissionScope
      }))
    };
  }

  public async listAdvisories(): Promise<SkillAdvisory[]> {
    const sql = `
      SELECT
        sa.id::text AS id,
        s.skill_id AS "skillId",
        sv.version AS version,
        sa.advisory_type AS "advisoryType",
        sa.severity AS severity,
        sa.title,
        sa.summary,
        COALESCE(sa.published_at, sa.created_at)::text AS "publishedAt",
        CONCAT(COALESCE(sa.published_at, sa.created_at)::text, ':', sa.id::text) AS "sequenceCursor",
        (sa.advisory_type = 'revocation') AS "forceDisable",
        sa.resolved_at::text AS "resolvedAt"
      FROM skill_advisories sa
      JOIN skills s ON s.id = sa.skill_ref_id
      LEFT JOIN skill_versions sv ON sv.id = sa.skill_version_id
      ORDER BY sa.published_at DESC, sa.created_at DESC
      LIMIT 200
    `;

    const result = await this.pool.query<AdvisoryRow>(sql);
    return result.rows.map((row) => ({
      id: row.id,
      skillId: row.skillId,
      version: row.version,
      advisoryType: row.advisoryType,
      severity: row.severity,
      title: row.title,
      summary: row.summary,
      publishedAt: row.publishedAt,
      sequenceCursor: row.sequenceCursor,
      forceDisable: row.forceDisable,
      resolvedAt: row.resolvedAt
    }));
  }

  public async listAdvisoryFeed(options?: {
    cursor?: string;
    limit?: number;
  }): Promise<AdvisoryFeedPage> {
    const decodedCursor = options?.cursor ? decodeAdvisoryCursor(options.cursor) : null;
    const limit = Math.max(1, Math.min(options?.limit ?? 50, 200));

    const sql = `
      SELECT
        sa.id::text AS id,
        s.skill_id AS "skillId",
        sv.version AS version,
        sa.advisory_type AS "advisoryType",
        sa.severity AS severity,
        sa.title,
        sa.summary,
        COALESCE(sa.published_at, sa.created_at)::text AS "publishedAt",
        CONCAT(COALESCE(sa.published_at, sa.created_at)::text, ':', sa.id::text) AS "sequenceCursor",
        (sa.advisory_type = 'revocation') AS "forceDisable",
        sa.resolved_at::text AS "resolvedAt"
      FROM skill_advisories sa
      JOIN skills s ON s.id = sa.skill_ref_id
      LEFT JOIN skill_versions sv ON sv.id = sa.skill_version_id
      WHERE (
        $1::timestamptz IS NULL
        OR COALESCE(sa.published_at, sa.created_at) > $1::timestamptz
        OR (
          COALESCE(sa.published_at, sa.created_at) = $1::timestamptz
          AND sa.id::text > $2::text
        )
      )
      ORDER BY COALESCE(sa.published_at, sa.created_at) ASC, sa.id ASC
      LIMIT $3::int
    `;

    const result = await this.pool.query<AdvisoryRow>(sql, [
      decodedCursor?.publishedAt ?? null,
      decodedCursor?.id ?? "",
      limit + 1
    ]);

    const pageRows = result.rows.slice(0, limit);
    const advisories = pageRows.map((row) => ({
      id: row.id,
      skillId: row.skillId,
      version: row.version,
      advisoryType: row.advisoryType,
      severity: row.severity,
      title: row.title,
      summary: row.summary,
      publishedAt: row.publishedAt,
      sequenceCursor: row.sequenceCursor,
      forceDisable: row.forceDisable,
      resolvedAt: row.resolvedAt
    }));

    const lastRow = pageRows[pageRows.length - 1];
    const nextCursor =
      pageRows.length > 0 && lastRow
        ? encodeAdvisoryCursor({ publishedAt: lastRow.publishedAt, id: lastRow.id })
        : null;

    return {
      advisories,
      nextCursor,
      hasMore: result.rows.length > limit
    };
  }
}
