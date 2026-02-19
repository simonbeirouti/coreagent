# CoreAgent Admin (`apps/admin`)

Independent Next.js admin panel for operational visibility into:
- users (`profiles`, `user_profiles`)
- agents and agent abilities
- skills registry tables
- orchestration jobs/runs/tasks
- AI core tools policy mapping

## Environment

Create `apps/admin/.env.local` from `apps/admin/.env.local.example`.

Required variables:
- `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Quick check:

```bash
npm run env:check
```

## Development

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Notes

- Data is fetched server-side from Supabase PostgREST using the service role key.
- The app is intentionally isolated from the desktop app env; configure only inside `apps/admin/.env.local`.
