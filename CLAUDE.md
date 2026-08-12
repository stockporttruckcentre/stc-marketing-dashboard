# STC Marketing Dashboard

Next.js 14 (App Router) + Supabase + Tailwind. Internal tool for Stockport Truck
Centre. CRM tables are AG Grid; charts are Recharts and Nivo; icons are Lucide.

Key surfaces: `app/dashboard/**` (pages), `components/**` (all UI), `lib/supabase`
(clients), `supabase/schema.sql` (schema + RLS).

---

## The design system is mandatory for CRM work

`design-system/` is the STC UI kit. **It governs every piece of CRM interface
built from now on.** There is no CRM UI work that is exempt from it.

### When this triggers

Before writing or editing any UI in the CRM — `app/dashboard/crm/**`,
`components/Crm*.tsx`, and any component, dialog, table, form, chart, empty
state or shell that a CRM screen renders — read the kit first. Specifically,
trigger on any of:

- Creating or restyling a CRM component, page, panel, drawer or dialog
- Adding any control: button, input, select, checkbox, switch, date picker
- Touching an AG Grid column definition, cell renderer, header or row style
- Adding a badge, status dot, avatar, empty state, skeleton, toast or alert
- Adding or restyling a chart, KPI card, stat strip or progress indicator
- Any change to CRM spacing, colour, type, radius, elevation, focus or motion
- Any request phrased as "make it look…", "tidy up", "polish", "redesign"

If you are about to pick a colour, a size or a corner radius for the CRM, the
trigger has already fired. Do not guess a value that the kit specifies.

### What "use the kit" means

1. **Read `design-system/README.md` first.** It is the contract — tokens, the
   four rules, the full component inventory, and the interaction and state
   specifications. Read it before writing code, not after.
2. **Open the matching reference page** and match it:

   | Building | Read |
   |---|---|
   | Colour, type, spacing, radius, elevation, motion | `reference/01-foundations.html` |
   | Any input or control | `reference/02-forms.html` |
   | Tables, badges, avatars, charts, KPIs, empty states | `reference/03-data.html` |
   | Shell, sidebar, tabs, menus, command palette, pagination | `reference/04-navigation.html` |
   | Alerts, toasts, dialogs, drawers, tooltips, loading | `reference/05-feedback.html` |
   | Whole screens — dashboard, list+detail, settings | `reference/06-patterns.html` |

3. **Recreate, never lift.** The reference HTML is a prototype, not production
   code. Rebuild it as React + Tailwind using this codebase's own patterns.
   `reference/support.js` must never ship.
4. **Semantic tokens only.** Use `var(--surface)`, `var(--text-muted)`,
   `var(--accent)` — never a raw hex, never a one-off colour. If a value you
   need has no token, that is a signal to ask, not to invent one.
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
- **Navy mismatch.** The kit's navy is `#09163A`; `tailwind.config.ts` has
  `stc.navy` at `#071458`. Red matches at `#CF2417`.
- **Theme mechanism differs.** The kit switches on `data-stc-theme` on `<html>`
  persisted to `localStorage['stc-ui-theme']`. The app has its own
  `ThemeToggle.tsx`.
- **Fonts are already self-hosted.** `public/fonts/` has seven Panton weights as
  `.otf` and `globals.css` already declares the `@font-face` rules. The kit's
  `design-system/fonts/` duplicates four of them. Point at `public/fonts/`.
