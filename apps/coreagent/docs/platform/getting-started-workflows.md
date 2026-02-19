# CoreAgent Getting Started Workflows

This guide explains the practical day-to-day flow for running CoreAgent and validating core platform behavior.

## 1) Start The Platform

Prerequisites:
- Node.js 18+
- Rust 1.70+
- `pnpm`
- `.env` configured from `.env.example`

Run full stack:

```bash
pnpm run tauri dev
```

Useful alternatives:
- Frontend only: `pnpm dev`
- Full production build: `pnpm run tauri build`

## 2) Core Product Walkthrough

Recommended first pass:
1. Create or select an agent.
2. Open chat and send a message.
3. Add per-message feedback (quality dimensions).
4. Open dashboard and review transparency cards.
5. Confirm behavior updates are reflected in identity and retrieval surfaces.

## 3) Data Validation Loop

Use this loop after product changes:
1. Trigger real interactions in chat.
2. Inspect dashboard for updated metrics and states.
3. Verify expected retrieval and adaptation behavior.
4. Repeat with a few different prompt/feedback patterns.

This keeps UI-level behavior and underlying model/data interpretation aligned.

## 4) Quality Gates Before Merge

Run the test and check gates:

```bash
pnpm test
pnpm run check
```

If you need focused runs:
- Frontend tests: `pnpm test:frontend`
- Rust tests: `pnpm test:rust`
- TypeScript checks: `pnpm check:ts`
- Rust checks: `pnpm check:rust`

## 5) Synthetic Data Workflow (Optional)

To populate realistic dashboard data for development:

```bash
pnpm run seed:dashboard -- --userEmail you@example.com --userId 00000000-0000-0000-0000-000000000000
```

Optional flags:
- `--days <n>` (default: `14`)
- `--agents <n>` (default: `3`)

Use this when you need repeatable dashboard behavior without manually creating long interaction histories.
