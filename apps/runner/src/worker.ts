import { Worker, type Job } from "bullmq";
import pino from "pino";

import type { RunnerEnv } from "./env.js";
import { extractRequestedCredentialScopes, resolveCredentialRequest } from "./credential-broker.js";
import {
  executeLocalDockerRun,
  executeRemoteDockerRun,
  prepareLocalDockerImages,
  resolveDockerImageForJob,
  shouldDisableDockerNetwork
} from "./local-docker.js";
import { evaluatePermissionRequest, type RequestedPermission } from "./permission-broker.js";

export type RuntimeRunJobData = {
  runId: string;
  userId: string;
  skillId: string;
  version: string;
  executionMode: "remote" | "local_docker";
  timeoutSeconds: number;
  input: Record<string, unknown>;
  messageContext?: Record<string, unknown>;
  attachments?: Record<string, unknown>[];
  attachmentContent?: Record<string, unknown>[];
  skillRuntime: {
    runtimeType: "command" | "http" | "wasm";
    entrypoint: string;
    artifactUri: string | null;
    digest: string;
    runtimeProfile?: string | null;
  };
  requestedPermissions: RequestedPermission[];
};

export function createRuntimeWorker(env: RunnerEnv) {
  const log = pino({
    level: env.LOG_LEVEL
  });

  const worker = new Worker<RuntimeRunJobData>(
    env.RUNTIME_RUN_QUEUE_NAME,
    async (job: Job<RuntimeRunJobData>) => {
      log.info(
        {
          runId: job.data.runId,
          jobId: job.id,
          skillId: job.data.skillId,
          version: job.data.version,
          executionMode: job.data.executionMode,
          requestedPermissions: job.data.requestedPermissions.length
        },
        "runtime run job received"
      );

      const decision = evaluatePermissionRequest(job.data.requestedPermissions, env);
      if (!decision.allowed) {
        log.warn(
          {
            runId: job.data.runId,
            deniedPermissionKey: decision.deniedPermissionKey,
            reason: decision.reason
          },
          "runtime permission broker denied run"
        );
        throw new Error(`PERMISSION_BROKER_DENY:${decision.reason}`);
      }

      const requestedCredentialScopes = extractRequestedCredentialScopes(job.data.requestedPermissions);
      const credentialDecision = resolveCredentialRequest(requestedCredentialScopes, env);
      if (!credentialDecision.allowed) {
        log.warn(
          {
            runId: job.data.runId,
            deniedScope: credentialDecision.deniedScope,
            reason: credentialDecision.reason
          },
          "runtime credential broker denied run"
        );
        throw new Error(`CREDENTIAL_BROKER_DENY:${credentialDecision.reason}`);
      }

      const onLog = async (message: string, stream: "stdout" | "stderr") => {
        await job.updateProgress({
          type: "log",
          message,
          stream,
          timestamp: new Date().toISOString()
        });
      };

      if (job.data.executionMode === "local_docker") {
        const selectedImage = resolveDockerImageForJob(job.data, env);
        const networkDisabled = shouldDisableDockerNetwork(job.data, env);
        log.info(
          {
            runId: job.data.runId,
            jobId: job.id,
            skillId: job.data.skillId,
            runtimeProfile: job.data.skillRuntime.runtimeProfile ?? null,
            selectedImage,
            networkDisabled
          },
          "runtime local docker image selected"
        );
        const localDockerResult = await executeLocalDockerRun(job.data, env, { onLog });
        return {
          accepted: true,
          runId: job.data.runId,
          requestedCredentialScopes: requestedCredentialScopes.length,
          resolvedCredentialScopes: Object.keys(credentialDecision.resolvedCredentials).length,
          dockerExecution: localDockerResult,
          localDocker: localDockerResult
        };
      }

      const remoteDockerResult = await executeRemoteDockerRun(job.data, env, { onLog });

      return {
        accepted: true,
        runId: job.data.runId,
        requestedCredentialScopes: requestedCredentialScopes.length,
        resolvedCredentialScopes: Object.keys(credentialDecision.resolvedCredentials).length,
        dockerExecution: remoteDockerResult,
        remoteDocker: remoteDockerResult
      };
    },
    {
      connection: {
        url: env.REDIS_URL,
        enableReadyCheck: false,
        connectTimeout: 10_000,
        keepAlive: 30_000,
        retryStrategy(times) {
          return Math.min(times * 200, 2_000);
        },
        maxRetriesPerRequest: null
      },
      concurrency: env.RUNTIME_RUN_CONCURRENCY
    }
  );

  worker.on("ready", () => {
    log.info(
      {
        queue: env.RUNTIME_RUN_QUEUE_NAME,
        concurrency: env.RUNTIME_RUN_CONCURRENCY
      },
      "runtime worker ready"
    );
  });

  if (env.RUNTIME_ENABLE_LOCAL_DOCKER) {
    void prepareLocalDockerImages(env)
      .then((images) => {
        log.info({ images }, "runtime local docker images prepared");
      })
      .catch((error) => {
        log.warn(
          { error: error instanceof Error ? error.message : String(error) },
          "runtime local docker image warmup failed; will retry on first run"
        );
      });
  }

  worker.on("completed", (job) => {
    log.info(
      {
        runId: job.data.runId,
        jobId: job.id
      },
      "runtime run job completed"
    );
  });

  worker.on("failed", (job, error) => {
    log.error(
      {
        runId: job?.data.runId,
        jobId: job?.id,
        error: error.message
      },
      "runtime run job failed"
    );
  });

  worker.on("error", (error) => {
    const code = (error as NodeJS.ErrnoException).code;
    if (["ECONNRESET", "ETIMEDOUT", "EPIPE", "ECONNREFUSED"].includes(String(code))) {
      log.warn({ code, error: error.message }, "runtime worker redis transient connection issue (will retry)");
      return;
    }
    log.error({ code, error: error.message }, "runtime worker error");
  });

  return {
    worker,
    log,
    async close(): Promise<void> {
      await worker.close();
    }
  };
}
