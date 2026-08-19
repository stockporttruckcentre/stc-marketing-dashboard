# STC Marketing Dashboard

Internal marketing dashboard for Stockport Truck Centre. Next.js 14 + Supabase + Tailwind + AG Grid.

## Features

- **Auth + roles** — admin / marketer / sales / viewer, enforced via Postgres RLS.
- **CRM** — AG Grid (sort, filter, inline edit, floating filters), Lusha email enrichment, CSV import / export.
- **Social planner** — draft / pending review / approved / scheduled / posted workflow, admin approves.
- **Company finder** — searches Lusha for companies near any of 6 depots, one-click add to CRM.
- **Brand kit** — Supabase Storage uploads (logos, fonts, templates), colour swatches.
- **Industry news** — pulls RSS from Commercial Motor, Fleet News, Transport Engineer.
- **Lusha balance** — live in header, decremented server-side after each call.

## Local development

```bash
npm install
cp .env.example .env.local   # fill in real values
npm run dev                  # http://localhost:3000
```

## Required environment variables

| Variable | Where | Why |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Settings → API | Browser + server |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Settings → API | Browser + server |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Settings → API | Server only — never expose |
| `LUSHA_API_KEY` | Lusha account | Server only — proxied via `/api/lusha/*` |

## Supabase setup (one time)

1. Create a Supabase project (EU West region for UK).
2. SQL Editor → paste the entire contents of `supabase/schema.sql` → Run.
3. Authentication → URL Configuration → add your Vercel domain to **Site URL** and **Redirect URLs** (`https://your-app.vercel.app/auth/callback`).
4. Sign up an account at `/signup`. It will create a row in `profiles` with role `viewer`.
5. SQL Editor → promote yourself:
   ```sql
   UPDATE profiles SET role = 'admin' WHERE email = 'you@stc-uk.com';
   ```
6. Lusha credits — the schema seeds 2500. If yours differ:
   ```sql
   UPDATE lusha_credits SET balance = <your actual balance>;
   ```

## Deploy to Vercel

1. Push this folder to a GitHub repo.
2. vercel.com → Add New → Project → import the repo.
3. Add the four env vars above in the Vercel project settings.
4. Deploy. The first build provisions everything.
5. Back in Supabase Authentication → Site URL and Redirect URLs, add the Vercel domain.

## Roles cheat sheet

| Role | CRM | Social | Finder | Trailers | Brand | News |
|---|---|---|---|---|---|---|
| admin | RWD | RWD + approve | RW | RWD | RWD | RWD |
| marketer | RW | RW (needs approval) | RW | R | RW | RW |
| sales | RW | — | RW | RW | R | R |
| viewer | R | R | R | R | R | R |

Granted via:
```sql
UPDATE profiles SET role = 'marketer' WHERE email = '...';
```

## File map

```
app/
  page.tsx                  - root, redirects to /dashboard or /login
  login/, signup/           - email+password auth pages
  auth/callback/, signout/  - Supabase session handlers
  dashboard/
    layout.tsx              - header + nav + role-based tab visibility
    crm/, social/, finder/, sales/, brand/, news/
  api/
    lusha/{enrich,search,balance}  - proxies, key never reaches browser
    crm/import              - CSV → bulk insert with column auto-detection
    news/fetch              - RSS fetcher
components/                 - all dashboard widgets
lib/
  supabase/{client,server,middleware}.ts
  lusha.ts                  - Lusha API helper, server only
  types.ts
middleware.ts               - protects /dashboard and /api/*
supabase/schema.sql         - tables, RLS, triggers, storage bucket, seed
```

## Build script (Vercel auto-detects)

- `npm run dev`   — local dev server
- `npm run build` — production build (verified passing)
- `npm run start` — serve the production build

## What's not included yet (the things to come back to)

- Direct social posting to Facebook / LinkedIn (currently manual "Mark posted")
- Automated nightly Excel-on-shared-drive watcher for trailers. The stock list imports a supplier file from the screen and from the command bar; there is no watcher
- Email campaign sender from CRM segments
- Industry news AI summaries
- Mobile app
