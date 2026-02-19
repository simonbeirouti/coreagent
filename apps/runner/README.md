# Runner

Background runtime worker for skill execution jobs.

## Purpose

- Consumes `runtime-runs` queue jobs from Redis
- Executes runtime job lifecycle handlers
- Reports completion/failure through queue events

## Setup

```bash
cp .env.example .env
```

## Environment

- `NODE_ENV` (default: `development`)
- `LOG_LEVEL` (default: `info`)
- `REDIS_URL` (default: `redis://127.0.0.1:6379`)
- `RUNTIME_RUN_QUEUE_NAME` (default: `runtime-runs`)
- `RUNTIME_RUN_CONCURRENCY` (default: `4`)
- `RUNTIME_ALLOW_NETWORK` (default: `false`)
- `RUNTIME_ALLOW_FILESYSTEM` (default: `false`)
- `RUNTIME_ALLOW_BROWSER` (default: `false`)
- `RUNTIME_ALLOW_PROCESS` (default: `false`)
- `RUNTIME_NETWORK_DOMAIN_ALLOWLIST` (default: empty)
- `RUNTIME_CREDENTIAL_SCOPE_MAP` (default: empty; format `scope=ENV_VAR`)
- `RUNTIME_ENABLE_LOCAL_DOCKER` (default: `false`)
- `RUNTIME_LOCAL_DOCKER_IMAGE` (default: `node:20-alpine`)
- `RUNTIME_LOCAL_DOCKER_MEMORY_MB` (default: `256`)
- `RUNTIME_LOCAL_DOCKER_CPU_SHARES` (default: `256`)
- `RUNTIME_LOCAL_DOCKER_NETWORK_DISABLED` (default: `true`)
- `RUNTIME_LOCAL_DOCKER_PULL_IF_MISSING` (default: `true`)
- `RUNTIME_ARTIFACT_STORAGE_DIR` (default: `../server/data/artifacts`; used for `artifact://sha256/...` URIs)

## Run

```bash
pnpm --filter runner dev
```

## Check

```bash
pnpm --dir apps/runner check-types
```
