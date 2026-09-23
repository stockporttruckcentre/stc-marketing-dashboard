# STC Marketing Dashboard

Internal tool for Stockport Truck Centre. Next.js 14 (App Router), Supabase,
Tailwind, AG Grid.

It started as a CRM and a social planner. It is now the system the sales desk
runs on: customers, leads across three divisions, stock, maintenance contracts,
rate cards, the invoicing that comes out of Protean, the reporting on top of all
of it, and a command bar that reaches every screen by typing.

## What is in it

**Sales and CRM**

- CRM records: companies, contacts, addresses, notes, health flags, merges,
  groups, CSV in and out.
- Sales tracker: leads in three divisions (trailer sales, maintenance, rental),
  one per pitch, with the money on the pitch rather than the company.
- Stock list: trailers, their status, and the deal each one is attached to.
- Company finder: searches Lusha near any of the six depots and adds straight to
  the CRM.

**Documents and pricing**

- FleetSmart+: builds a maintenance contract from a fleet, prices it off the
  rate card, sends it, and raises the lead behind it.
- Rate cards: the labour and parts pricing, ported from the design pack in
  `docs/source/rate_cards/`, exported as the customer's workbook or a PDF of it.
- Proposals and order forms off a customer record.

**Money**

- Revenue: the Protean invoice and open job exports, imported, matched to CRM
  customers, and reconciled per division.
- Analytics: company, division and personal views, financial year to April,
  targets, year on year, and who moved.
- Reports: built from filters and exported.

**Running the business**

- Work: tasks, projects, views, release requests and approvals.
- Calendar, diary and meeting invitations.
- Social planner: draft, review, approve, schedule, post.
- Brand kit and industry news.
- Admin: eleven roles, ninety five capabilities, per person overrides,
  audit log, view-as.

**The command bar**

One box that reaches every screen, action and shortcut, and understands however
somebody types it. It answers questions ("how many curtainsiders at Carrington")
and carries out instructions ("add £1k refurb value to STC143980"). Every write
is previewed before it happens, and nothing you are not allowed to do is ever
offered. `lib/command/` is the whole of it.

## Local development

```bash
npm install
cp .env.example .env.local   # fill in real values
npm run dev                  # http://localhost:3000
```

## Environment

| Variable | Where from | Used by |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase, Settings, API | browser and server |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase, Settings, API | browser and server |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase, Settings, API | server only, never expose |
| `POSTGRES_URL` | Supabase, Settings, Database | the few routes that need direct SQL |
| `LUSHA_API_KEY` | Lusha account | server only, proxied through `/api/lusha/*` |
| `NEXT_PUBLIC_SITE_URL` | your own domain | auth redirects |

## Supabase setup

1. Create a project in EU West.
2. SQL editor, run `supabase/schema.sql`. That is the tables, the RLS policies,
   the triggers and the storage buckets.
3. SQL editor, run the migrations in `supabase/migrations/` in the order given
   by `scripts/sql/order.txt`. Use the bundler rather than pasting them one at a
   time:

   ```bash
   ./scripts/sql/bundle-migrations.sh > catch-up.sql
   ```

   The bundle is safe to run more than once. Every statement in it either
   replaces or skips, and `./scripts/sql/bundle-twice-check.sh` proves that by
   running it twice against a real database before you hand it over.
4. Authentication, URL Configuration: add your domain to Site URL and Redirect
   URLs (`https://your-domain/auth/callback`).
5. Sign up at `/signup`, then make yourself an administrator:

   ```sql
   UPDATE profiles
      SET role_template_id = (SELECT id FROM role_templates WHERE slug = 'developer')
    WHERE email = 'you@stc-uk.com';
   ```

## Who can do what

Eleven roles, from Developer down to Office Admin, described in
`lib/platform/permissions/roles.ts`. That file is the only place they are
written out: `supabase/migrations/103_the_eleven_roles.sql` is generated from it
by `npm run gen:roles`, and `npm run check:roles` fails if the two drift.

A role is a bundle of capabilities, not a switch. There are ninety five of them,
listed in `lib/platform/permissions/catalog.ts` and registered in the database by
`supabase/migrations/053_capability_catalog.sql`. Anybody can be granted or
refused a single capability without changing their role, which is what the
overrides table is for.

Nothing in the interface decides what somebody may do. Every screen asks
`command_may()`, every route asks `requireCapability()`, and every table has a
policy that asks the same question again. The three have to agree or
`npm run check:permission-wiring` fails.

## Layout

```
app/
  dashboard/        one folder per screen: crm, leads, sales, revenue,
                    analytics, reports, work, social, fleetsmart,
                    rate-cards, calendar, finder, brand, news, team,
                    admin, settings, requests
  api/              route handlers, all behind requireCapability
components/         every piece of interface, grouped by area
  kit/              the shared primitives: buttons, fields, badges, drawers
lib/
  command/          the command bar: parser, lexicon, actions, fields, IR
  crm/              lead identity, status, value, conversion, merging
  platform/         permissions, roles, page guards
  protean/          the invoice and open job importers
  supabase/         the clients
docs/
  source/           documents received from the business, stored as they
                    arrived and never edited
design-system/      the STC UI kit
scripts/            the checks, the generators, the SQL tooling
supabase/
  schema.sql        tables, policies, triggers, buckets
  migrations/       everything since, in scripts/sql/order.txt order
```

## The checks

There are 131 of them. `npm run check:all` runs the lot.

They are not unit tests. Most of them drive the real thing: a disposable
PostgreSQL built from `schema.sql` and every migration, a headless browser
against a running dev server, or the production code paths with a fake
PostgREST in front of them. The ones worth knowing about:

```bash
npm run check:command         # the command bar parser, against real phrasings
npm run check:coverage        # every screen reachable, and the combinations
npm run check:permissions     # who can do what, role by role, both directions
npm run check:dead-controls   # no button that does nothing
npm run check:postgres        # the migrations against a real database
npm run check:bundle-twice    # the catch-up bundle is safe to run twice
```

The rule behind most of them: a check of the form "does this look right" is
kept by whoever wrote the thing being checked, which is nobody. So they are
mechanical. `check:dead-controls` parses the source and fails on a `<button>`
with no handler. `check:invention` counts hand written design values and lets
the number fall and never rise. `check:roles` diffs the generated migration
against the file it was generated from.

Setting up the disposable database is in `scripts/sql/README.md`.

## Conventions

`CLAUDE.md` is the working agreement and is worth reading before changing
anything. The parts that bite:

- No em dashes anywhere in the repository. There is one carve out, the standalone
  glyph used as a "no value" placeholder in a table cell.
- The CRM is built to a written spec, `docs/source/crm-page-scope.md`. Read the
  relevant section first.
- `design-system/` governs CRM interface. Recreate it in React, never lift the
  reference HTML.
- A design sent for a specific screen, in `docs/source/`, is ported exactly
  rather than interpreted. No value is chosen.
- Nothing half built ships. Every control either works or is disabled with a
  title saying what is missing.
- Any SQL somebody has to run is handed over as a file, with a second file that
  reads back what the first one did.

## Deploying

Vercel. Import the repo, set the environment variables above, deploy. Then add
the domain to Supabase under Authentication, URL Configuration.

`npm run build` is the same build Vercel runs.

## Not built yet

- Posting straight to Facebook and LinkedIn. The planner schedules and somebody
  marks it posted.
- A watcher on the supplier stock file. Imports happen from the screen and from
  the command bar.
- Email campaigns out of CRM segments.
- Anything mobile beyond the responsive layout.
