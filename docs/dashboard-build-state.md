# Dashboard build state

Where the `/dashboard` rebuild actually got to. Read this before touching it.
The requirement and reasoning live in `dashboard-upgrade-plan.md`; this file is
just the current state of the code.

Last updated at the end of the first build session.

---

## What exists now

The dashboard is three separate renders chosen by one function, with all data
coming from server routes rather than browser queries.

| File | What it is |
|---|---|
| `app/dashboard/page.tsx` | Server component. Resolves the variant, renders one of three dashboards |
| `lib/dashboard/variant.ts` | **The seam.** `getDashboardVariant()` is the only thing that decides which dashboard you see |
| `app/api/dashboard/rep/route.ts` | All rep widget data in one round trip |
| `app/api/dashboard/exec/route.ts` | Company-wide aggregates, crossing RLS on purpose |
| `components/dashboard/RepDashboard.tsx` | Sales rep view, widgets 1 to 9 |
| `components/dashboard/ExecDashboard.tsx` | Exec view, separate render and separate queries |
| `components/dashboard/SupportDashboard.tsx` | Marketer view, deliberately a shell |
| `components/dashboard/VariantSwitch.tsx` | Admin-only preview switch, temporary |
| `components/kit/primitives.tsx` | The shared UI kit components, first of their kind in this repo |
| `app/kit-tokens.css` | Kit design tokens, wired in without disturbing other screens |
| `supabase/migrations/001_dashboard.sql` | Additive schema. **Not yet run** |

## How the kit got wired in without a mass rebrand

This was the constraint: add the kit as an improvements library, not a
replacement. It works like this.

`app/kit-tokens.css` is derived from `design-system/tokens.css` with the font
face block and CSS reset removed, because Panton is already self-hosted from
`public/fonts` and declared in `globals.css`. The kit ships its dark palette
under `[data-stc-theme="dark"]`; the file binds `[data-theme="dark"]` alongside
it so the app's existing theme toggle drives kit components with no other
change.

It is imported **before** `globals.css` in `app/layout.tsx`, and that order is
load bearing. Eight token names overlap between the two files:

```
--accent  --bg  --border  --border-strong  --shadow-1  --shadow-3  --stc-navy  --stc-red
```

All eight are also defined by `globals.css`, which loads second and therefore
wins at `:root`. Every screen that has not been rebranded looks exactly as it
did. Verified against the compiled CSS, not assumed.

Kit surfaces opt back in through a `.kit` class, which redefines the three
colour tokens on the element itself. A directly applied custom property beats an
inherited one, so the dashboard gets true kit colours while `:root` still serves
the old theme to everything else. Today `.kit` is on the dashboard only.

`tailwind.config.ts` has the kit's scales merged in additively. Names that would
have clobbered the legacy tokens (`bg`, `accent`, `border`) and the base text
sizes (`sm`, `base`, `lg`) were deliberately left out.

**To extend the kit to another screen:** wrap it in `.kit` and build with
`components/kit/primitives`. Nothing else needs to change. **To retire the old
theme eventually:** delete the `.kit` block from `kit-tokens.css` and remove the
colliding definitions from `globals.css`, at which point the kit values apply
everywhere.

## Widget status

Everything renders today. Widgets whose tables do not exist show a "not wired up
yet" state naming exactly what they need, rather than failing or showing fake
numbers.

| Widget | State | Notes |
|---|---|---|
| 1. Next actions | Working, derived | Built from today's meetings and stalled deals. Labelled as derived in the UI. Becomes real when `dashboard_actions` exists |
| 2. Gone quiet | Working, provisional signal | Uses `last_activity_at` when present, else falls back to `last_contact` then `updated_at`. The UI says so. Run the migration to make it honest |
| 3. Proposals in flight | Working | Existing means the company has a closed deal or a linked sold trailer. **This rule needs Dave or Tom to confirm** |
| 4. Biggest stuck deals | Working | Same query as widget 2, top five by value |
| 5. My portfolio | Working, approximate | Matched on the free-text `assigned_to` field. Exact once `account_ownership` is populated |
| 6. Meetings | Working, CRM only | Next seven days from `calendar_events`. Outlook joins later |
| 7. Notifications | Not provisioned | Table created by the migration but nothing writes to it yet. **Write points still to build** |
| 8. Revenue vs target | Not provisioned | Gauge is built and works. Needs a row in `revenue_targets` |
| 9. Quick actions | Working | Routes to existing screens. Natural language search is a disabled placeholder, as specified |

Exec view: revenue and pipeline by rep are live. Year-on-year, invoice volume and
the Friday digest all show their blocked state, since Protean and the digest job
do not exist.

## What to do next, in order

1. **Run `supabase/migrations/001_dashboard.sql`.** Nothing depends on it to
   render, but it turns three approximations into real data. Read its comments
   first: the `account_ownership` backfill is commented out on purpose because it
   matches on free-text names.
2. **Set `profiles.dashboard_variant`** for whoever should get the exec view, and
   add the control to `components/AdminPanel.tsx`. Until then everyone lands on
   the rep view and only admins can preview the others through `VariantSwitch`.
3. **Build the notification write points.** The table and the panel exist; what
   is missing is anything that creates a row. Lead assignment is the obvious
   first one.
4. **Delete `VariantSwitch`** once step 2 is done. It exists only because role
   cannot currently distinguish a rep from an exec.

## Things deliberately not done

- **`profiles_update_self` is still open.** It is a live privilege escalation and
  it makes the exec view unprotected, since any user can rewrite their own row.
  Left alone because it is a security fix that deserves its own change, not a
  line buried in a dashboard commit.
- **No browser-direct queries were added.** Both dashboards fetch from `/api/`.
  The existing 75 calls in other screens were left untouched.
- **The support view is a shell.** The meeting left its contents undecided, so it
  shows the marketing tools that already exist and says plainly that the rest is
  not agreed. Guessing at widgets would have quietly become the spec.

## Verification done

- TypeScript compiles clean
- Production build passes
- Token precedence checked against the compiled CSS, not assumed
- No em dashes in any new file, per `CLAUDE.md`. The three that appear are the
  standalone placeholder glyph, which is the documented carve-out

**Not verified:** nobody has seen this render against real data. It was built and
built-checked without database credentials, so the first run against live
Supabase may surface shape mismatches in the query results. Widget 3's
prospective versus existing split and widget 5's name matching are the two most
likely to look wrong first.
