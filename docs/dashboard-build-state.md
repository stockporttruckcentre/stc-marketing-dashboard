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
| `components/dashboard/CommandBar.tsx` | The toolbar: understands a sentence, asks for what is missing, does it |
| `lib/command/` | The language engine. `normalise` folds words, `entities` pulls values, `intents` scores and fills, `features` maps every screen |
| `scripts/command-parse-check.ts` | Pins the parser against real phrasings. `npm run check:command` |
| `app/api/command/*` | `resolve` disambiguates references, `execute` carries the action out |
| `app/api/admin/seed-demo/route.ts` | Demo data, all marked DEMO, with a wipe |
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

## The toolbar

One input on the dashboard that parses a sentence, resolves what it refers
to against the database, asks only for what it genuinely could not work
out, and finishes with a link to whatever it made. No model involved.

`lib/command/features.ts` is the part that matters for keeping it useful:
it lists every screen, what people call it, and what you can do there.
**If a screen is added to the sidebar and not to that file, the toolbar
cannot reach it**, and typing its name will hit a dead end. That was the
original bug: eight intents against twelve screens, so a bare word like
"meeting" matched nothing and the bar sat there doing nothing.

Two rules that keep it honest:

- Never do nothing. Anything typed either matches an intent, matches a
  feature, or gets shown three examples that work.
- A bare noun is a browse, not a command. Below a confidence of 6 only
  the suggestions show, so typing "stock" offers to open the stock list
  rather than presenting as "add a trailer".

Add a phrasing that gets misread to `scripts/command-parse-check.ts`
before fixing it. Three real bugs came out of writing that file rather
than assuming: "gold" fuzzy-matching "sold", words inside company names
voting on intent, and three free-text slots all filling with the same
name.

## Kit rollout so far

| Screen | State |
|---|---|
| Dashboard | Fully kit-native. Wrapped in `.kit`, built from `components/kit/primitives` |
| CRM pipeline | Kit-native apart from the AG Grid table itself. Contact drawer, page head, list tabs, toolbar, selection bar, every floating menu, and all four modals. Export, scheduling and the site map too |
| Customer export | New tab at `/dashboard/crm/export/[id]`. PDF, Excel, Word, clipboard and email from one document |
| News | Controls and type only. `PageHead`, `Button`, `Tabs`, `Chip`, `SearchInput`, `Alert` and `EmptyState` are kit; the card grid is deliberately untouched because that layout is signed off |
| Everything else | Untouched, on the original theme |

The News conversion is the pattern for a signed-off screen: put `.kit` on
the control clusters rather than the page, so kit tokens reach the buttons
and type without recolouring the layout underneath. `app/globals.css` was
not modified, which is what guarantees the cards still render as approved.

`components/kit/primitives.tsx` covers: `Button` `Chip` `Tabs`
`SearchInput` `Alert` `PageHead` `SectionHead` `Label` `Card` `Kpi`
`Figure` `Bar` `Badge` `Row` `EmptyState` `NotProvisioned` `Skeleton`.

`components/kit/forms.tsx` covers: `Field` `TextInput` `TextArea`
`Select` `Segmented` `OptionCard` `Checkbox` `Modal`. Separate file
because every one of them holds focus or keyboard state, so it is a
client boundary, and `primitives.tsx` has to stay importable from server
components.

The form controls put the border on a wrapper and leave the control
inside transparent and borderless. That is what lets a field carry a
leading icon, a trailing unit or a clear button on the same 32px baseline
without any of them fighting the input's own box, and it keeps focus and
error as one rule in one place instead of one per control type.

## CRM meeting items

From the CRM meeting transcript. Four are built, four are blocked on work
already documented in `dashboard-upgrade-plan.md`.

| # | Item | State |
|---|---|---|
| 1 | Duplicate accounts, sales and maintenance as separate entities | **Built.** `parent_customer_id` self-reference, migration 003, `/api/crm/link`, and a "Same customer" section in the drawer that shows deliberate twins and probable duplicates together. Needs migration 003 run; until then the section says so rather than failing |
| 2 | Portfolio-per-user filtering | **Built** without `account_ownership`. Everyone, My accounts and Unassigned in one switch, plus a picker for a named colleague. See below for why the free-text problem did not stop it |
| 3 | "What next?" prompt after adding a prospect | **Built.** `NextActionPrompt`, offering a call, a proposal, a note or a reminder |
| 4 | Generate proposal on the contact record | **Built.** `GenerateProposalPicker` with the four types. Trailer sales and maintenance route to the tracker; rental and refurb say plainly that their tool is not built and raise the proposal anyway |
| 5 | Delegate a call to another diary | **Partly built.** The whose-diary picker works and shares the event with the owner. Pushing to Outlook needs Graph, and the owner still cannot edit their own delegated meeting until the calendar policies are rewritten |
| 6 | Protean sync populating customer records | **Blocked** on Wayne sign-off and the server move |
| 7 | Restricted stock-only role for Rama | **Blocked** on the granular permissions panel |

The AG Grid table itself is still untouched. Bulk actions, CSV import and
the Lusha flow gained an owner picker and a kit restyle but no change in
behaviour.

### Twinned accounts, and why not a customers table

The textbook answer is a `customers` table above `crm_contacts` owning
several account records. It is also the wrong move right now.
`crm_contacts` is already doing three jobs, every query and every RLS
policy in the app reads from it, and the platform is about to move off
Supabase. Restructuring the busiest table in the product immediately
before that migration is not a trade worth making.

So migration 003 adds a self-reference and a trigger that keeps links one
level deep, which means "the same customer" always has exactly one
answer. It is additive, no existing query or policy changes, and if the
customers table is ever built this column is the map for the backfill.

### Portfolio filtering without `account_ownership`

This was parked as blocked because there was nothing dependable to filter
on. `assigned_to` is free text holding whatever somebody typed into a
spreadsheet: "Alex", "alex ellis", "A.Ellis", an email address, and a lot
of blanks. Equality against a profile name would have hidden most of a
rep's portfolio, which is worse than no filter.

`lib/crm/ownership.ts` fixes it at both ends. Reading is generous: a
person is identified by their name, their email, its local part and their
first name, and a contact matches on any of those, which covers the
history already in the database. Writing is exact: the Assigned column is
a picker of real people, so everything set from today is canonical and
the generous matching only ever cleans up the past.

The loose first-name rule has one failure mode, two colleagues sharing a
first name. The list says so on screen rather than handing one of them
the other's accounts.

**When `account_ownership` arrives** it becomes the source of truth and
this becomes the backfill. `ownerKeys` is the function that maps the old
free text onto a real user id.

## Customer export

One model in `lib/crm/export-model.ts`, rendered five ways. Built once on
the server so the formats cannot drift apart, which is how a field ends up
in the PDF but missing from the Word version.

| Format | How | Notes |
|---|---|---|
| PDF | Browser print, with a print stylesheet | No dependency. Sections are kept off page breaks |
| Excel | `exceljs` | A real workbook: four sheets, numbers stored as numbers with currency formats, dates as dates, frozen headers |
| Word | `docx` | A real document: styled headings, bordered tables, notes as readable paragraphs |
| Clipboard | `ClipboardItem` | Rich text and plain text together, so it pastes properly into either |
| Email | Clipboard, then `mailto` | Two visible steps. The formatted HTML is copied inside the click, then a panel says so and offers the compose window. **To finish when Microsoft sign-in is live:** attach the PDF and send from the user's own mailbox through Graph |

Neither file format is a renamed HTML file. That was explicitly asked for
and is worth keeping: a spreadsheet somebody cannot sort or sum is not a
spreadsheet.

Two things about this page that are easy to get wrong again:

- **It lives at `/export`, not under `/dashboard`.** It was under the
  dashboard layout at first, which meant the sidebar and top bar were
  printed into the PDF. The bare layout in `app/export/layout.tsx` is the
  fix, and middleware protects `/export` alongside `/dashboard`.
- **It scrolls itself.** `globals.css` puts `overflow: hidden` on the
  body and lets `.content` inside the dashboard shell scroll, so a page
  outside that shell has to bring its own scroll container. The print
  rules release it again, or printing would only ever capture the first
  window's worth.

The email step is a paste rather than a prefilled draft because the
signature is the point. Outlook only inserts one when a person starts a
message in the client, so a draft built by the server or by `mailto`
arrives without it. Graph does not change that either. The Office ribbon
add-in is what removes the paste, and it is a separate piece of work.

## Maps

Leaflet with OpenStreetMap tiles and Nominatim geocoding, proxied through
`/api/geo`. **No API key needed.** The full decision, the limits of the
free tier and what to move to if it outgrows them is in `docs/maps.md`.

## What to do next, in order

1. **Run `supabase/migrations/001_dashboard.sql`.** Nothing depends on it to
   render, and the seeder now works without it, but it turns three
   approximations into real data. Read its comments first: the
   `account_ownership` backfill is commented out on purpose because it matches
   on free-text names. Until it runs, the seed response lists which columns it
   had to skip.
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
