# STC Marketing Dashboard

Next.js 14 (App Router) + Supabase + Tailwind. Internal tool for Stockport Truck
Centre. CRM tables are AG Grid; charts are Recharts and Nivo; icons are Lucide.

Key surfaces: `app/dashboard/**` (pages), `components/**` (all UI), `lib/supabase`
(clients), `supabase/schema.sql` (schema + RLS).

---

## No em dashes. Anywhere.

The em dash character (`—`, U+2014) is banned across this entire repository. This
is not a CRM-only or design-system-only rule. It applies to everything written
here:

- UI copy: labels, placeholders, empty states, tooltips, toasts, error messages
- Code comments and section banners
- Commit messages, PR titles and bodies
- Markdown docs, including this file
- Chat replies written while working in this repo

Also banned in prose: the en dash used as a sentence break (`–`, U+2013) and the
horizontal bar (`―`, U+2015). They read as the same punctuation and are the usual
way the ban gets sidestepped.

### Write this instead

An em dash is almost always doing one of four jobs. Each has a plain replacement:

| Instead of | Use |
|---|---|
| An aside mid-sentence | Commas, or brackets if the aside is genuinely parenthetical |
| A pause before a payoff | A colon |
| Joining two related statements | A full stop and a second sentence |
| A trailing afterthought | A full stop and a second sentence |

Before: `'Active leads — chasing the deal'`
After: `'Active leads, chasing the deal'`

Before: `// Intercept status change FROM 'sold' — warn about the sale being undone.`
After: `// Intercept status change FROM 'sold'. Warn about the sale being undone.`

Before: `No contact found in our role cascade — only company-level fields populate.`
After: `No contact found in our role cascade, so only company-level fields populate.`

If a sentence genuinely needs a dash to work, the sentence needs rewriting. Two
shorter sentences are always available and are usually better anyway.

### The one carve-out

A lone `—` standing by itself as the "no value here" glyph in a table cell, a
select option, or a stat box is **not** punctuation and stays allowed:

```tsx
{p.value == null ? <span>—</span> : <span className="tnum">{p.value}</span>}
```

That is a typographic placeholder, not writing. The ban is on the em dash used as
punctuation inside a sentence. If you would rather that glyph go too, say so and
it becomes a one-pass change across roughly ten render sites.

### Checking your work

Before finishing any task that touched text in this repo, grep your own output:

```bash
grep -rn '—\|–\|―\|&mdash;\|&ndash;\|&#8212;\|&#8211;' \
  --include="*.tsx" --include="*.ts" --include="*.css" \
  --include="*.md" --include="*.sql" app components lib supabase
```

Anything that comes back and is not the standalone placeholder glyph is a defect
and gets fixed before the work is called done.

The HTML entities are in that pattern for a reason. `&mdash;` renders as an em
dash and reads as one, but a search for the literal character walks straight past
it. One had been sitting in the Lusha dialog since before the ban existed.

---

## The CRM is built to a written spec

`docs/source/crm-page-scope.md` is the per page CRM build spec, derived from the
Tom, Dave and Alex meeting, with provenance on every item. It covers every tab.

**Read section 1 before doing anything on the CRM tab, and the relevant section
before touching any other tab.** `docs/crm-scope-compliance.md` tracks what is
built against it and is updated as part of the work, not afterwards.

`docs/source/` holds documents received from the business, stored exactly as they
arrived. Nothing in that folder is edited, reformatted or tidied, and **it is the
one exception to the em dash ban below.** The ban governs prose written for this
repository. It does not govern a document somebody else wrote.

---

## The design system is mandatory for CRM work

`design-system/` is the STC UI kit. **It governs every piece of CRM interface
built from now on.** There is no CRM UI work that is exempt from it.

### When this triggers

Before writing or editing any UI in the CRM, read the kit first. That means
`app/dashboard/crm/**`, `components/Crm*.tsx`, and any component, dialog, table,
form, chart, empty state or shell that a CRM screen renders. Specifically,
trigger on any of:

- Creating or restyling a CRM component, page, panel, drawer or dialog
- Adding any control: button, input, select, checkbox, switch, date picker
- Touching an AG Grid column definition, cell renderer, header or row style
- Adding a badge, status dot, avatar, empty state, skeleton, toast or alert
- Adding or restyling a chart, KPI card, stat strip or progress indicator
- Any change to CRM spacing, colour, type, radius, elevation, focus or motion
- Any request phrased as "make it look...", "tidy up", "polish", "redesign"

If you are about to pick a colour, a size or a corner radius for the CRM, the
trigger has already fired. Do not guess a value that the kit specifies.

### What "use the kit" means

1. **Read `design-system/README.md` first.** It is the contract: tokens, the four
   rules, the full component inventory, and the interaction and state
   specifications. Read it before writing code, not after.
2. **Open the matching reference page** and match it:

   | Building | Read |
   |---|---|
   | Colour, type, spacing, radius, elevation, motion | `reference/01-foundations.html` |
   | Any input or control | `reference/02-forms.html` |
   | Tables, badges, avatars, charts, KPIs, empty states | `reference/03-data.html` |
   | Shell, sidebar, tabs, menus, command palette, pagination | `reference/04-navigation.html` |
   | Alerts, toasts, dialogs, drawers, tooltips, loading | `reference/05-feedback.html` |
   | Whole screens: dashboard, list and detail, settings | `reference/06-patterns.html` |

3. **Recreate, never lift.** The reference HTML is a prototype, not production
   code. Rebuild it as React + Tailwind using this codebase's own patterns.
   `reference/support.js` must never ship.
4. **Semantic tokens only.** Use `var(--surface)`, `var(--text-muted)`,
   `var(--accent)`. Never a raw hex, never a one-off colour. If a value you need
   has no token, that is a signal to ask, not to invent one.
5. **Icons come from `lucide-react`**, already a dependency. Do not extract the
   inline SVGs from the reference files.

### The four rules, in short

1. **Navy acts, red points.** Navy carries primary actions and structure. Red is
   the single most important action on a screen, plus destructive intent. Three
   red buttons on a screen means none.
2. **Density is a feature.** 32px controls, 36px table rows, 14px base text.
   Whitespace goes between groups, not inside them.
3. **Borders before shadows.** 1px rules and honest alignment. Elevation is only
   for things that genuinely float.
4. **Panton earns its size.** Panton for headings, numbers and labels with
   authority; Inter for anything read at length. Never Panton below 11px.

---

## The command bar is never finished

The global command bar is a first class part of this product, not a search
box. It has to reach **every** function, screen, shortcut and action the CRM
has, and understand however somebody chooses to type it: their word order,
their jargon, their typos, the words they leave out.

**Whenever you add a feature, action or screen anywhere in the app, you add
its words to `lib/command/lexicon.ts` and a case to
`scripts/command-coverage-check.ts` in the same change.** A feature the bar
cannot reach is invisible, and the original bug was exactly that: eight
intents against twelve screens, so typing "meeting" did nothing.

### Generated, not listed

Do not write variants out longhand. A lookup table of phrasings goes stale
the day somebody adds a depot, cannot handle a sentence nobody predicted,
and is unreadable at the size it would have to be.

The coverage comes from combining small structured groups: synonym sets,
word order independence, filler stripping, fuzzy matching. A few hundred
groups in `lexicon.ts` already cover millions of sentences.

The volume belongs in the checks instead. `npm run check:coverage` sweeps
every state word against every body type, depot, period and sentence shape
and asserts what comes out. A phrasing listed in the lexicon is a guess. A
phrasing asserted in the check is a promise.

### Three checks, all of which must pass

```bash
npm run check:command    # the parser, against real phrasings
npm run check:query      # query composition
npm run check:coverage   # every screen reachable, and the combinations
```

Writing these has found real bugs every single time, including a filler
word that silently changed whose numbers a question answered.

---

## Rebranding is gradual and user-ordered

The rebrand happens in the order the user sets, one piece at a time.

- **Do not** proactively migrate screens, swap tokens, or "bring things in line"
  with the kit because you noticed a mismatch. Flag it and move on.
- **Do not** rebrand non-CRM surfaces (social planner, trailer sales, news,
  brand kit, analytics) unless asked for that surface by name.
- The rule above governs **how** CRM UI is built when the user asks for it. It
  is not a licence to start the migration.

## The kit is not wired in yet

Nothing in `design-system/` currently affects the build. Before any of it takes
effect, someone has to deliberately:

- Import `design-system/tokens.css` into the app
- Merge `design-system/tailwind.config.js` into root `tailwind.config.ts`
  (root `content` globs cover only `app/**` and `components/**`, so the kit's
  own config is inert)

**Do not do either of those on your own initiative.** They are rebrand steps and
belong to the user's ordering. If a task genuinely cannot proceed without them,
say so and ask.

Known frictions to expect when that step arrives:

- **Token name collisions.** `app/globals.css` already defines `--bg`,
  `--accent` and `--border` for the current dark theme, with different values.
  They will collide with the kit's tokens.
- **Navy mismatch.** The kit's navy is `#09163A`. `tailwind.config.ts` has
  `stc.navy` at `#071458`. Red matches at `#CF2417`.
- **Theme mechanism differs.** The kit switches on `data-stc-theme` on `<html>`
  persisted to `localStorage['stc-ui-theme']`. The app uses `data-theme`, an
  `stc_theme` cookie, and a `profiles.theme` column, applied by an inline script
  in `app/layout.tsx` before first paint.
- **Fonts are already self-hosted.** `public/fonts/` has seven Panton weights as
  `.otf` and `globals.css` already declares the `@font-face` rules. The kit's
  `design-system/fonts/` duplicates four of them. Point at `public/fonts/`.
