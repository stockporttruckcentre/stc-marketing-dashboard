# STC Roles — implementation handoff

**Read this before writing any code.** This folder contains the approved design as
real, runnable files. It is not a reference to work from. It is the implementation.

## Start here

Open `preview.html` in a browser. Every component in this pack renders there, from
these exact files, with no build step. That is the target. Click a node or a rail name
in the first one and the inspector follows, with no JavaScript involved.

## The rule

Reproduce each `.html` file and the stylesheets **exactly**. Do not rebuild, re-layout,
re-name, restructure or improve. If your output does not diff cleanly against these
files, it is wrong, however close it looks.

Do not reconstruct markup out of `STC-UI-09b-*.html` or `STC-UI-09c-*.html`. Those are
rendered documentation with the markup inside script strings. Anything pulled from them
is a reconstruction, which is the failure this pack exists to prevent. Every component
below is extracted from the same source the documentation renders from.

## What is in here

### Stylesheets — do not edit

| File | What it is |
|---|---|
| `roles-tokens.css` | 69 design tokens, light and dark. The only place a colour is defined. |
| `roles-components.css` | 356 named classes, one per distinct style in the design. Shared by every component below, so the same style always has the same class. |
| `roles-behaviour.css` | Selection sync and the view switcher. Radios and CSS, no JavaScript. |
| `roles-fonts.css` + `fonts/` | Panton, four weights. |

### Components — copy as they are, then bind data

| File | Component | Backend | Priority |
|---|---|---|---|
| `roles-page.html` | The screen | Wired already | Done |
| `roles-edit-permissions.html` | Edit permissions modal | `set_role_capability`, migration 108 | **1** |
| `roles-tab-permissions.html` | Permissions tab body | Same source as the screen | 1 |
| `roles-tab-people.html` | People tab body | Existing assignment call | 2 |
| `roles-tab-history.html` | History tab body | `role_capability_history` | 2 |
| `roles-view-grid.html` | Grid view | Same data as the chart | 3 |
| `roles-view-matrix.html` | Matrix view | Same data as the chart | 3 |
| `roles-compare.html` | Compare view | Two roles, same data | 3 |
| `roles-role-menu.html` | Role menu popover | Existing actions | 3 |
| `roles-new-role.html` | New role modal | **Does not exist** | Hold |
| `roles-access-review.html` | Access review modal | **Does not exist** | Hold |

Each file's opening comment names its repeating regions and any wiring note. Loop those
regions; keep every wrapper element, every class, and the nesting order.

## Scope calls

**New role and Access review are out of scope for now.** Both are extracted and in the
pack so the design is settled, but neither should be wired yet. New role needs a role
template create endpoint, and the seed currently owns that table. Access review needs a
definition of what the pack contains before the export means anything. Build the other
nine first; come back to these two once those two questions have answers.

**Do not ship a placeholder editor.** If Edit permissions is not ready, leave the button
disabled with a tooltip rather than wiring a plain list of switches. A placeholder with
no design claim still teaches people the wrong screen, and they will have learned it by
the time the real one lands. `roles-edit-permissions.html` is in this pack and needs no
new backend work, so the gap should be days, not weeks.

**People can ship read only.** The list is the valuable half. "Assign someone" can stay
disabled until you want to reuse the existing assignment call.

## Hard constraints

These are not preferences. Each one is a defect found in review.

- **Never rename or merge a class.** The names are the contract. `.r-7c` looks arbitrary
  and is not: it is one exact style from the approved design, shared across files.
- **Never replace a token with a literal colour.** `var(--accent)`, not `#CF2417`.
  Dark mode works only through the tokens.
- **The three fixed regions stay at 218px, 250px and 352px.** The canvas takes the
  remainder. Do not make them fluid or percentage-based.
- **`.roles-canvas-body` must keep `overflow:auto`.** The chart is intrinsically sized
  and will be wider than its region. With `hidden`, roles disappear silently. This
  defect occurred three times in review.
- **Keep the `overflow-x` wrapper and `min-width` on the grid and matrix views.** Without
  them the text columns collapse to around 12px wide.
- **Selection is radio-driven, not JavaScript.** One `<input type="radio">` per role, and
  `roles-behaviour.css` does the rest. Do not replace it with click handlers and state:
  the chart, the rail and the inspector must always agree, and this guarantees it.
- **Default styles belong in the class, never inline.** An inline style beats a
  stylesheet rule, so an inline default silently kills the `:checked` highlight. Twice
  in review.
- **Nothing animates position.** Colour, shadow and opacity only, 120 to 200ms. The
  chart never re-centres, slides or reflows on selection.
- **No new dependencies.** No chart library, no tree library, no CSS framework. Every
  component here is flexbox and radio groups.

## Data

`roles-data.json` holds the 24 roles with their divisions, reporting lines, holder
counts and capability counts. It is a placeholder standing in for the real permission
model: swap it for the real thing, and no markup or CSS changes are needed.

## Full documentation

- `STC-UI-09b-Roles-Page.html` — the screen, region anatomy, design rationale, edge cases.
- `STC-UI-09c-Roles-Behaviour.html` — the three views, compare and density, inspector
  tabs, what every button opens, the gesture and keyboard spec, the motion table with
  durations, and the scaling rules.

Read these for the reasoning. Take the code from the files above.
