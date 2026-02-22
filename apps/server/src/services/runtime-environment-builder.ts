import type { Pool } from "pg";

type EnsureRuntimeEnvironmentInput = {
  dbPool: Pool;
  skillRefId: string;
  skillVersionId: string;
  skillId: string;
  version: string;
  digest: string;
  source: "install_flow" | "run_flow";
  installId?: string;
};

export type EnsuredRuntimeEnvironment = {
  runtimeEnvironmentId: string;
  imageRef: string;
};

function sanitizeImageToken(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function buildImageRef(skillId: string, version: string, digest: string): string {
  const skillToken = sanitizeImageToken(skillId);
  const versionToken = sanitizeImageToken(version);
  const digestToken = sanitizeImageToken(digest).slice(0, 16);
  return `coreagent-skill/${skillToken}:${versionToken}-${digestToken}`;
}

export async function ensureRuntimeEnvironmentReady(
  input: EnsureRuntimeEnvironmentInput
): Promise<EnsuredRuntimeEnvironment> {
  const imageRef = buildImageRef(input.skillId, input.version, input.digest);
  const metadata: Record<string, unknown> = {
    source: input.source,
    environmentKey: {
      skillId: input.skillId,
      version: input.version,
      digest: input.digest
    },
    immutableImage: {
      enabled: true,
      imageRef,
      digest: input.digest
    }
  };
  if (input.installId) {
    metadata["installId"] = input.installId;
  }

  const runtimeEnvironment = await input.dbPool.query<{
    runtimeEnvironmentId: string;
    persistedImageRef: string | null;
  }>(
    `
      INSERT INTO runtime_environments (
        id,
        skill_ref_id,
        skill_version_id,
        digest,
        image_ref,
        readiness_status,
        metadata,
        created_at,
        updated_at
      )
      VALUES (
        gen_random_uuid(),
        $1::uuid,
        $2::uuid,
        $3::text,
        $4::text,
        'building',
        $5::jsonb,
        NOW(),
        NOW()
      )
      ON CONFLICT (skill_version_id, digest)
      DO UPDATE SET
        image_ref = COALESCE(runtime_environments.image_ref, EXCLUDED.image_ref),
        readiness_status = CASE
          WHEN runtime_environments.readiness_status = 'failed' THEN 'building'
          ELSE runtime_environments.readiness_status
        END,
        metadata = runtime_environments.metadata || EXCLUDED.metadata,
        updated_at = NOW()
      RETURNING id::text AS "runtimeEnvironmentId", image_ref AS "persistedImageRef"
    `,
    [input.skillRefId, input.skillVersionId, input.digest, imageRef, JSON.stringify(metadata)]
  );

  const runtimeEnvironmentId = runtimeEnvironment.rows[0]?.runtimeEnvironmentId;
  const persistedImageRef = runtimeEnvironment.rows[0]?.persistedImageRef;
  if (!runtimeEnvironmentId) {
    throw new Error("Failed to initialize runtime environment.");
  }
  if (persistedImageRef && persistedImageRef !== imageRef) {
    throw new Error("Runtime environment image metadata is immutable and does not match requested key.");
  }

  await input.dbPool.query(
    `
      INSERT INTO runtime_environment_builds (
        id,
        runtime_environment_id,
        build_status,
        started_at,
        completed_at,
        logs_uri,
        metadata
      )
      VALUES (
        gen_random_uuid(),
        $1::uuid,
        'succeeded',
        NOW(),
        NOW(),
        NULL,
        $2::jsonb
      )
    `,
    [
      runtimeEnvironmentId,
      JSON.stringify({
        source: input.source,
        imageRef,
        message: "Environment build placeholder recorded; runner build pipeline pending."
      })
    ]
  );

  await input.dbPool.query(
    `
      UPDATE runtime_environments
      SET
        readiness_status = 'ready',
        updated_at = NOW()
      WHERE id = $1::uuid
    `,
    [runtimeEnvironmentId]
  );

  return {
    runtimeEnvironmentId,
    imageRef
  };
}
