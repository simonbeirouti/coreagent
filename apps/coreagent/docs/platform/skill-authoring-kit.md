# Skill Authoring Kit

This guide defines the canonical local workflow for creating and validating skills before publish.

## Starter assets

- Markdown template: `apps/server/templates/skills/markdown-starter.md`
- Manifest template: `apps/server/templates/skills/manifest-template.json`
- Publish payload example: `apps/server/templates/skills/publish-payload-example.json`

## Local validation

Run manifest + policy validation using server-side validation logic:

```bash
pnpm --filter server skill:validate apps/server/templates/skills/publish-payload-example.json
```

The command returns normalized manifest output, resolved permission profile usage, and effective policy status.

## Publish dry-run

Validate upload/publish payload against live admin API without persisting skill metadata:

```bash
pnpm --filter server skill:publish:dry-run apps/server/templates/skills/publish-payload-example.json
```

Required env:

- `SKILLS_REGISTRY_BASE_URL`
- `ADMIN_API_TOKEN`

## Curated permission profiles

Profiles are available via:

- `GET /v1/permissions/profiles`
- `GET /v1/admin/permissions/profiles`

Default profile IDs:

- `read_only`
- `filesystem_scoped`
- `network_limited`
- `browser_automation`

Use `permissionProfileId` in publish payloads when explicit `permissions` are omitted.
