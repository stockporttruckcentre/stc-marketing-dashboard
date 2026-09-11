# STC Roles page — implementation handoff

**Read this before writing any code.** This folder contains the approved design as
real, runnable files. It is not a reference to work from. It is the implementation.

## The rule

Reproduce `roles-page.html` and its three stylesheets **exactly**. Do not rebuild,
re-layout, re-name, restructure or improve. If your output does not diff cleanly
against these files, it is wrong, however close it looks.

This has failed before by being rebuilt "close enough". A permissions screen is not a
visual exercise: the region widths, the selection sync and the overflow rules each fix
a specific defect found in review, and a fresh layout reintroduces them.

## What is in here

| File | What it is | May you change it? |
|---|---|---|
| `roles-page.html` | The screen, extracted verbatim from the approved build | Only to bind data |
| `roles-tokens.css` | 69 design tokens, light and dark | No |
| `roles-page.css` | 241 named classes, one per distinct style in the design | No |
| `roles-behaviour.css` | Selection sync, driven by radios and CSS only | No |
| `roles-data.json` | The 24 roles, their divisions, reporting lines and counts | Replace with real data |
| `roles-fonts.css` + `fonts/` | Panton, four weights | No |
| `preview.html` | **Open this first.** The reference render your build must match | No |

## Start here

Open `preview.html` in a browser. That is the target. It is not a mockup or an
approximation: it is the same markup and CSS you are being asked to ship, running
standalone with no build step. Click any node or any name in the left rail and the
inspector follows. Your implementation must look and behave identically.

## How to use it

1. Copy all four files into the project as they are.
2. Replace the static markup **inside** repeating regions with a loop over
   `roles-data.json`. Keep every wrapper element, every class and the nesting order.
3. Bind the real role data. The shape is in `roles-data.json`.
4. Diff your rendered output against `roles-page.html`. It should differ only in the
   repeated content, never in structure or class names.

## Hard constraints

These are not preferences. Each one is a fixed defect.

- **Never rename or merge a class.** The names are the contract. `.r-7c` looks
  arbitrary and is not: it is one exact style from the approved design.
- **Never replace a token with a literal colour.** `var(--accent)`, not `#CF2417`.
  Dark mode works only through the tokens.
- **The three fixed regions stay at 218px, 250px and 352px.** The canvas takes the
  remainder. Do not make them fluid or percentage-based.
- **`.roles-canvas-body` must keep `overflow:auto`.** The chart is intrinsically
  sized and will be wider than its region. With `hidden`, roles disappear silently.
  This defect occurred three times in review.
- **Selection is radio-driven, not JavaScript.** One `<input type="radio">` per role,
  and `roles-behaviour.css` does the rest. Do not replace it with click handlers and
  state: the chart, the rail and the inspector must always agree, and this guarantees it.
- **Default styles belong in the class, never inline.** An inline style beats a
  stylesheet rule, so an inline default silently kills the `:checked` highlight.
  Twice in review.
- **Nothing animates position.** Colour, shadow and opacity only, 120 to 200ms.
  The chart never re-centres, slides or reflows on selection.
- **No new dependencies.** No chart library, no tree library, no CSS framework. The
  whole screen is flexbox and two radio groups.

## Where the rest is documented

- `STC UI Roles.dc.html` — the component library: every node state, connector,
  verdict, scope chip and comparison view, with its states.
- `STC UI Roles Screen.dc.html` — the screen, region anatomy, design rationale, edge cases.
- `STC UI Roles Behaviour.dc.html` — the three views, inspector tabs, what every button
  opens, the full gesture and keyboard spec, the motion table, and the scaling rules.

## Still to supply

The 24 roles and the 148-capability count are placeholders standing in for the real
permission model. Swap `roles-data.json` for the real thing. No markup or CSS changes
are needed to do it.
