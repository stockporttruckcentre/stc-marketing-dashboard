# STC Rate Card Builder — implementation handoff

**Read this before writing any code.** This folder contains the approved design as
real, runnable files. It is not a reference to work from. It is the implementation.

## Start here

Open `preview.html` in a browser. All 24 components render there, from these exact
files, with no build step. That is the target.

Then open `rate-model.json`. It is the reason the screen works, and the part most
likely to be got wrong.

## The rule

Reproduce each `.html` file and the stylesheets **exactly**. Do not rebuild,
re-layout, re-name, restructure or improve. If your output does not diff cleanly
against these files, it is wrong, however close it looks.

Do not reconstruct markup out of `STC-UI-10-Rate-Cards.html`. That is rendered
documentation with the markup inside script strings. Every component below is
extracted from the same source the documentation renders from.

## The idea, in one paragraph

A rate card has 45 rates. Only 5 of them are decisions: the labour rates. 19 more are
`hours × labour`, so they follow automatically. 6 are DVSA fees that must never move.
10 are STC's own flat charges, and 5 are still TBC. That is why the labour band sits
above the table and why every row shows its basis: a salesman sets one number, sees
what moved, and sends the card. Changing individual rates is possible but never
required.

## What is in here

### Data contract — read first

`rate-model.json` holds the labour pools, all 45 rates with their basis, the parts
markup rows and the 23 FleetSmart+ inclusions by tier.

- `basis: "derived"` stores `hours` + `pool`. **Store hours, never the price.** The
  price is computed on read, so a labour change needs no migration and no batch job.
- `hours × labourPools[pool]` reproduces `value2026` for all 19 derived rates, which
  is how the generic template matches the signed-off KNDS card to the penny. Those
  hours were back-calculated from it; they are the starting point, not gospel.
- `basis: "statutory"` is a DVSA fee with an optional `cap` and `capBy`. Labour
  changes and bulk uplifts must skip these **by type**, not via a checkbox someone
  has to remember to untick.
- `basis: "fixed"` is STC's own flat charge. Upliftable, but not labour-driven. Brake
  Test carries `perAxle: 18`, so its four columns are 18/36/54/72.
- `basis: "tbc"` and `"blank"` are exportable on purpose — the master card ships with
  TBCs in it. They must be a choice, not an oversight.
- `axles` lists which axle columns are priced. A missing column renders hatched, which
  means "not priced on this axle" and is different from zero.

### Stylesheets — do not edit

| File | What it is |
|---|---|
| `rate-card-tokens.css` | 69 design tokens, light and dark. The only place a colour is defined. |
| `rate-card-components.css` | 335 named classes, one per distinct style in the design, shared by every component so the same style always has the same class. |
| `rate-card-fonts.css` + `fonts/` | Panton, four weights. |

### Components — copy as they are, then bind data

| File | Component | Priority |
|---|---|---|
| `rate-hub.html` | The Rate Cards tab | **1** |
| `rate-builder.html` | The builder, resting | **1** |
| `rate-row-bases.html` | Rate rows, all five bases | **1** |
| `rate-row-states.html` | Row states: default, hover, editing, override, changed | **1** |
| `rate-builder-editing.html` | Builder with an inline editor open | 1 |
| `rate-builder-ripple.html` | Builder with a staged labour change | 1 |
| `modal-new-card.html` | New rate card | 1 |
| `modal-set-rate.html` | Set a rate manually | 1 |
| `modal-review-changes.html` | Review the change set | 1 |
| `rate-fs-panel.html` | FleetSmart+ inclusions, live contract | 2 |
| `rate-fs-hidden.html` | Same panel, hidden from the card | 2 |
| `rate-fs-none.html` | Customer with no contract | 2 |
| `rate-fs-extras.html` | Extra inclusions agreed | 2 |
| `modal-export.html` | Export dialog | 2 |
| `modal-bulk-uplift.html` | Bulk uplift | 2 |
| `modal-hide-fs.html` | Hide FleetSmart+ confirmation | 2 |
| `modal-unsaved.html` | Unsaved changes | 2 |
| `modal-approve.html` | Send for approval | 3 |
| `rate-history.html` | Change log | 3 |
| `rate-versions.html` | Version rail | 3 |
| `menus.html` | Four popovers: card, rate, basis filter, axle column | 3 |
| `toasts.html` | Success, info and error toasts | 3 |
| `states.html` | Empty, loading, missing data, contract changed | 3 |
| `rate-basis-chips.html` | The six chips, for reference | — |

Each file's opening comment names its repeating regions. Loop those; keep every
wrapper element, every class, and the nesting order.

## XLSX export

The workbook has to be indistinguishable from the master, because customers compare
year on year. `master/KNDS UK - Customer Rates 2026.xlsx` is the real file.

**Build the export by writing cell values into a copy of the master, never by
generating a sheet from scratch.** Styles, merges, column widths, row heights, the
logo drawing and the print area then survive, and only values change.

What the master contains, for reference:

- Extent `A1:O72`, one sheet, logo as a floating drawing in the header
- Column widths: A 24.29, B 38.86, H 12.71, I 11.71, K 45, L 14.86, M 13.14, N 16.86
- 25 merge ranges, including `A1:I1`, `C2:I2`, `B3:I6`, `K8:N9`, `B70:I70`, and the
  section bands `A20/A35/A55/A59:I`
- Row heights: r1 15.75, r2 24, r3 26.25, r9 18.75, r10 39, body 15, r70 75.75, r72 18.75
- Rates occupy `A10:I58`; parts markup `A60:I68`; the authority block `A70:I72`
- FleetSmart+ panel occupies `K6:N35`
- **The tick in the inclusions matrix is the letter `P` in Wingdings**, not a Unicode
  checkmark. Using ✓ is the tell that a card was not generated from the master.
- `n/a` and `TBC` are text, not zero. Money is two decimals.

## Behaviour that is not optional

- **Derivation is stored as hours.** Never persist a derived price.
- **Statutory rates are protected by type.** A cap warns in amber and still saves —
  caps change, and the tool should not refuse a rate the business has decided on.
- **An override is a flag, not a delete.** Store the manual price alongside the
  original hours so revert is always available and always exact.
- **A labour change is staged; everything else commits immediately.** A labour edit
  moves many rows, so it needs review. A single rate edit does not.
- **Axle columns are independent.** A rate can be derived on one column and overridden
  on another; the row badge shows the strongest state present.
- **Autosave on blur, debounced 400ms.** The unsaved count in the toolbar is the
  truth. A save button must never be the only way to persist.
- **The labour band never scrolls away.** The rate table is the only scroller.
- **Bulk and destructive actions are undoable for 10 seconds**, not confirmed twice.
- **The FleetSmart+ section is generated from the contract, never typed.** Hiding it
  is presentational only and must not unlink the contract.
- **Nothing in the rate table animates position.** Colour and opacity only, 120–200ms.
- **Rounding**: half-up to two decimals at display and export. Never round stored hours.

## Auto-generation from a FleetSmart+ contract

Out of scope for this pack, and deliberately so — it belongs in the FleetSmart+
builder. What it owes this screen:

1. On contract create, make a rate card for that customer from the current template,
   with `fleetsmartContractId` set and `showFleetsmartSection: true`.
2. Set the card's effective date to the contract start date.
3. The card appears in the hub as a draft. Nobody has to know it was created.
4. On contract change (tier, extras, cancellation), update every card referencing it
   and write a `System` row into each card's change log. `states.html` has the
   "contract changed underneath you" banner for a card open at the time.

## Layout variants

The design doc's last section sets out four ways to assemble these components:
**A single table** (built here), **B guided steps**, **C two pane**, **D card preview
first**, each with what it is good and bad at. The component library is the same for
all four. Build A first; the others are a re-arrangement, not a rewrite.

Six things must hold whichever is chosen: the labour band stays visible while editing
rates; every row shows its basis; statutory rates are typed rather than hand-flagged;
overrides are counted at card level; the FleetSmart+ section is generated; and hiding
it never unlinks the contract.

## Full documentation

`STC-UI-10-Rate-Cards.html` — the hub and builder anatomy, all five rate bases, the
labour ripple, the FleetSmart+ section in four states, every modal and popover, the
export contract, versions and history, the empty and error states, the behaviour spec
with motion and keyboard tables, and the four layout variants.

Read it for the reasoning. Take the code from the files above.
