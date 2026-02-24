import { invoke } from '@tauri-apps/api/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { registryKeys } from '@/lib/query-keys';
import { cacheFirstStaticQueryPolicy } from '@/lib/query-policies';

export interface PermissionProfile {
  id: string;
  title: string;
  description: string;
  permissions: Array<{
    permissionKey: string;
    required: boolean;
    riskLevel: string;
    permissionScope: Record<string, unknown>;
  }>;
}

export interface PublishPermissionInput {
  permissionKey: string;
  required?: boolean;
  riskLevel?: 'low' | 'moderate' | 'high' | string;
  permissionScope?: Record<string, unknown>;
}

export interface PublishSkillInput {
  skillId: string;
  implementationKey: string;
  title: string;
  riskLevel?: 'low' | 'moderate' | 'high' | string;
  source?: string;
  version: string;
  runtime: 'command' | 'http' | 'wasm' | string;
  entrypoint?: string;
  artifactDigest: string;
  preflightRunId?: string;
  permissionProfileId?: string;
  manifest?: Record<string, unknown>;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  healthcheck?: Record<string, unknown>;
  heartbeatPolicy?: Record<string, unknown>;
  compatibilityMinAppVersion?: string;
  compatibilityMaxAppVersion?: string;
  permissions?: PublishPermissionInput[];
}

export interface PublishSkillResponse {
  skillId: string;
  version: string;
  digest: string;
  artifactUri: string;
  implementationKey: string;
  dryRun?: boolean;
  published?: boolean;
}

export interface ArtifactUploadResponse {
  digest: string;
  artifactUri: string;
  sizeBytes: number;
  stored: boolean;
}

export interface SkillReviewInput {
  reviewStatus: 'in_review' | 'approved' | 'rejected';
  summary: string;
  trustedBadgeEligible: boolean;
  checks?: {
    reviewedCode?: boolean;
    securityTests?: boolean;
    reliabilityChecks?: boolean;
  };
}

export interface DockerPreflightInput {
  title: string;
  skillId?: string;
  aiInput?: string;
  scriptArtifactDigest: string;
  exampleArtifactDigest: string;
  mode?: 'remote' | 'local_docker';
}

export interface DockerPreflightResponse {
  runId: string;
  scriptArtifactDigest: string;
  exampleArtifactDigest: string;
  mode: 'remote' | 'local_docker' | string;
  status: 'running' | 'passed' | 'failed' | string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  startedAt: string;
  finishedAt: string | null;
}

function toBackendPublishPayload(input: PublishSkillInput): Record<string, unknown> {
  return {
    skillId: input.skillId,
    implementationKey: input.implementationKey,
    name: input.title,
    description: input.title,
    riskLevel: input.riskLevel ?? 'moderate',
    source: input.source ?? 'coreagent_registry',
    version: input.version,
    runtime: input.runtime,
    artifactDigest: input.artifactDigest,
    manifest: input.manifest ?? {},
    inputSchema: input.inputSchema ?? {},
    outputSchema: input.outputSchema ?? {},
    healthcheck: input.healthcheck ?? {},
    heartbeatPolicy: input.heartbeatPolicy ?? {},
    permissions: (input.permissions ?? []).map((permission) => ({
      permissionKey: permission.permissionKey,
      required: permission.required ?? true,
      riskLevel: permission.riskLevel ?? 'moderate',
      permissionScope: permission.permissionScope ?? {},
    })),
    ...(input.entrypoint ? { entrypoint: input.entrypoint } : {}),
    ...(input.preflightRunId ? { preflightRunId: input.preflightRunId } : {}),
    ...(input.permissionProfileId ? { permissionProfileId: input.permissionProfileId } : {}),
    ...(input.compatibilityMinAppVersion ? { compatibilityMinAppVersion: input.compatibilityMinAppVersion } : {}),
    ...(input.compatibilityMaxAppVersion ? { compatibilityMaxAppVersion: input.compatibilityMaxAppVersion } : {}),
  };
}

export function useRegistryPermissionProfiles() {
  return useQuery({
    queryKey: registryKeys.permissionProfiles(),
    queryFn: async (): Promise<PermissionProfile[]> => invoke('list_registry_permission_profiles'),
    ...cacheFirstStaticQueryPolicy,
  });
}

export function useUploadRegistrySkillArtifact() {
  return useMutation({
    mutationFn: async (input: {
      artifactBase64: string;
      digest?: string;
    }): Promise<ArtifactUploadResponse> =>
      invoke('upload_registry_skill_artifact', {
        artifactBase64: input.artifactBase64,
        digest: input.digest ?? null,
      }),
  });
}

export function useDryRunPublishRegistrySkill() {
  return useMutation({
    mutationFn: async (input: PublishSkillInput): Promise<PublishSkillResponse> =>
      invoke('dry_run_publish_registry_skill', {
        payload: toBackendPublishPayload(input),
      }),
  });
}

export function useRunDockerSkillPreflight() {
  return useMutation({
    mutationFn: async (input: DockerPreflightInput): Promise<DockerPreflightResponse> =>
      invoke('preflight_registry_skill', {
        payload: {
          title: input.title,
          scriptArtifactDigest: input.scriptArtifactDigest,
          exampleArtifactDigest: input.exampleArtifactDigest,
          mode: input.mode ?? 'local_docker',
          ...(input.skillId?.trim() ? { skillId: input.skillId.trim() } : {}),
          ...(input.aiInput?.trim() ? { aiInput: input.aiInput.trim() } : {}),
        },
      }),
  });
}

export function useStartDockerSkillPreflight() {
  return useMutation({
    mutationFn: async (input: DockerPreflightInput): Promise<DockerPreflightResponse> =>
      invoke('start_preflight_registry_skill', {
        payload: {
          title: input.title,
          scriptArtifactDigest: input.scriptArtifactDigest,
          exampleArtifactDigest: input.exampleArtifactDigest,
          mode: input.mode ?? 'local_docker',
          ...(input.skillId?.trim() ? { skillId: input.skillId.trim() } : {}),
          ...(input.aiInput?.trim() ? { aiInput: input.aiInput.trim() } : {}),
        },
      }),
  });
}

export async function getDockerSkillPreflight(runId: string): Promise<DockerPreflightResponse> {
  return invoke('get_preflight_registry_skill', { runId });
}

export function usePublishRegistrySkill() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: PublishSkillInput): Promise<PublishSkillResponse> =>
      invoke('publish_registry_skill', {
        payload: toBackendPublishPayload(input),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: registryKeys.skills(), refetchType: 'all' });
      queryClient.invalidateQueries({ queryKey: registryKeys.trustedSkills(), refetchType: 'all' });
    },
  });
}

export function useReviewRegistrySkill() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      skillId: string;
      version: string;
      review: SkillReviewInput;
    }) =>
      invoke('review_registry_skill', {
        skillId: input.skillId,
        version: input.version,
        review: {
          reviewStatus: input.review.reviewStatus,
          summary: input.review.summary,
          trustedBadgeEligible: input.review.trustedBadgeEligible,
          checks: input.review.checks ?? {},
        },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: registryKeys.skills(), refetchType: 'all' });
      queryClient.invalidateQueries({ queryKey: registryKeys.trustedSkills(), refetchType: 'all' });
    },
  });
}
