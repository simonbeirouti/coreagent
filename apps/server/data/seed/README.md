# Seeded Open Skills

This folder contains starter manifests for markdown and command-runtime skills that can be published to the local Skills Registry.

## Files
- `markdown-skills.manifests.json`: 7 starter skills
  - `coreagent.md.research_brief`
  - `coreagent.md.decision_log`
  - `coreagent.md.registry_operator`
  - `coreagent.py.deep_analysis`
  - `coreagent.py.pandas_summary`
  - `coreagent.js.dayjs_timeline`
  - `coreagent.rs.regex_advisor`

## Publish Command

From repo root:

```bash
ADMIN_API_TOKEN=<token> ENABLE_ADMIN_API=true pnpm --filter server seed:open-skills
```

Optional overrides:

```bash
SKILLS_REGISTRY_BASE_URL=http://127.0.0.1:4010
OPEN_SKILLS_MANIFEST_PATH=data/seed/markdown-skills.manifests.json
```

Each manifest points to a local artifact under:
- `apps/server/data/skills/markdown/...`
- `apps/server/data/skills/command/...`
