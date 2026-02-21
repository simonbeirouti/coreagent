# Skills Registry Service

This service is the backend for CoreAgent's vetted Skills Registry.  
It provides a trusted catalog, artifact validation/signing, publish/revoke workflows, install/assignment APIs, and runtime handshake metadata for local skill execution.

## PRD Summary

Source PRD: `/Users/simonbeirouti/Developer/ai/coreagent/skills_registry_prd.md`  
Current PRD phase: **Phase 6 (Testing And Release Gates)** as of **2026-02-17**.

### Core goals
- Enable in-app skill install/use without CLI workflows.
- Allow only policy-compliant, signed skill artifacts.
- Support safe updates, rollback/revocation, and forced disable.
- Keep execution local while the registry remains remote.
- Provide health, diagnostics, and auditability.

### What this service contains
- Registry catalog APIs for listing skills, details, versions, and advisories.
- Admin APIs for artifact upload, publish, and revoke.
- Manifest validation (schema, semver compatibility, entrypoint safety, forbidden fields).
- Permission/risk policy evaluation before publication.
- Digest-keyed immutable artifact storage (`artifact://sha256/<digest>`).
- HMAC-based signature generation and verification metadata.
- Revocation/advisory feed with cursor pagination.
- Runtime handshake contract for install/runtime enforcement data.
- JWT auth for user-scoped APIs and token auth for admin APIs.
- Observability: correlation IDs, metrics, readiness, diagnostics, rate limiting.

## API Surface (v1)

### Public/runtime
- `GET /health`
- `GET /ready`
- `GET /diagnostics`
- `GET /v1/skills`
- `GET /v1/skills/:skillId`
- `GET /v1/skills/:skillId/versions/:version`
- `GET /v1/advisories`
- `GET /v1/advisories/feed`
- `GET /v1/runtime/skills/:skillId/versions/:version/handshake`

### User-scoped (JWT required)
- `POST /v1/skills/:skillId/install`
- `DELETE /v1/skills/:skillId/install`
- `POST /v1/skills/:skillId/install/pin`
- `GET /v1/skills/installed`
- `POST /v1/skills/:skillId/assign`
- `GET /v1/agents/:agentId/skills`

### Admin (feature-flagged)
- `POST /v1/admin/artifacts/upload`
- `POST /v1/admin/skills/publish`
- `POST /v1/admin/skills/:skillId/versions/:version/revoke`

## Data Model

Primary tables introduced by registry migration:
- `skills`
- `skill_versions`
- `skill_permissions`
- `skill_advisories`
- `skill_publication_events`
- `skill_installs`

Integration with existing CoreAgent model:
- Published skills sync into `abilities` by `implementation_key`.
- Agent enablement/config is preserved via `agent_abilities`.

## Security And Reliability Highlights

- Signed artifact workflow with digest pinning.
- Policy rejection for blocked/invalid permissions.
- Static safety checks for package metadata and entrypoints.
- Forced-disable metadata propagation on revocation.
- Request correlation IDs and structured lifecycle logging.
- Public catalog rate limiting and standard retry headers.
- Health/readiness/diagnostics endpoints for operations.

## Testing And CI Gates

Phase 6 gates are wired in this service:
- Unit tests for manifest, policy, artifact validation, and signing.
- Integration test for publish-to-catalog availability.
- Security/resilience tests for revocation enforcement and failure paths.
- CI gate command: `pnpm --filter server check:ci`

`check:ci` runs:
1. `check-types`
2. `lint`
3. `test`
4. migration validation (`validate:migrations`)
5. `build`

GitHub Actions workflow:
- `/Users/simonbeirouti/Developer/ai/coreagent/.github/workflows/skills-registry-ci.yml`

## Local Development

From repo root:

```bash
pnpm --filter server dev
```

Useful commands:

```bash
pnpm --filter server test
pnpm --filter server lint
pnpm --filter server check-types
pnpm --filter server validate:migrations
pnpm --filter server check:ci
```

## Runtime Mode Parity Verification

Use this to validate that `remote` and `local_docker` execution produce equivalent outcomes for the same skill input.

Preflight:
- Server env: `ENABLE_RUNTIME_QUEUE=true`
- Runner env: `RUNTIME_ENABLE_REMOTE_DOCKER=true` and `RUNTIME_ENABLE_LOCAL_DOCKER=true`
- Docker daemon is reachable on the runner host and required runtime images are available/pullable.

Run from repo root:

```bash
pnpm --filter server verify:runtime-modes -- \
  --authToken "<jwt-token>" \
  --skillId "coreagent.rs.regex_advisor" \
  --version "1.0.0" \
  --input '{"text":"foo-123"}'
```

Pass criteria:
- Both runs reach `succeeded`
- No runtime `error` payloads
- Output schema/shape parity
- Event lifecycle/log parity checks succeed
