# CoreAgent Admin (`core-admin`)

Independent Next.js admin panel for operational visibility into:
- users (`profiles`, `user_profiles`)
- agents and agent abilities
- skills registry tables
- orchestration jobs/runs/tasks
- AI core tools policy mapping

## Environment

Create `core-admin/.env.local` from `core-admin/.env.local.example`.

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
- The app is intentionally isolated from the root Vite app env; configure only inside `core-admin/.env.local`.
