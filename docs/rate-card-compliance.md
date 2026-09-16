# Rate Card Builder: every requirement, and what proves it

Every line the business asked for, with the check that holds it. A row
with no evidence is a row that is not built, whatever the screen looks
like.

This list is the source, not a summary written afterwards. It is
maintained as part of the work.

---

## From the original request

| # | Asked for | Where it is | Proved by |
|---|---|---|---|
| 1 | `.sidebar__item` 7px top and bottom | `app/globals.css` | `check:rate-cards-drive` measures the rendered row |
| 2 | A new tab under Sales, Rate Card Builder | `lib/nav.ts`, `app/dashboard/rate-cards` | `check:nav`, `check:permission-wiring` |
| 3 | Self generates when a FleetSmart+ contract is built | migration 113 trigger | `check:rate-card` |
| 4 | Made by hand by picking a customer | `NewCardModal` | `check:rate-cards-drive` |
| 5 | Minimal effort, changes optional on creation | only the customer is required | `check:rate-cards-drive` |
| 6 | Most rates calculate from the labour rate | 19 derived of 45 | `check:rate-card`, `check:rate-card-export` |
| 7 | Set one labour rate, the rest follow | `rate_card_set_labour` | `check:rate-card` (21 move), drive check |
| 8 | Individual rates can still be set | `rate_card_set_rate` | `check:rate-card`, drive check |
| 9 | Non derived rates overridden directly | fixed and statutory rows | drive check |
| 10 | Well thought out UX and UI | ported from the pack | `check:rate-card-port` |
| 11 | Cards show on the Rate Card Builder tab | `rate_cards_list` | drive check |
| 12 | A card can be amended easily | inline editors, autosave on blur | drive check |
| 13 | Save as xlsx or PDF | export route, both built from `sheetGrid` | `check:rate-card-export`, `check:rate-card-pdf`, drive check |
| 14 | The xlsx identical to the attached | written into a copy of the master | `check:rate-card-export` |
| 15 | FleetSmart+ inclusions generated from the contract | `rate_card_read` | `check:rate-card`, drive check |
| 16 | A customer who already holds a contract gets it | migrations 113 and 115 | `check:rate-card` |
| 17 | The whole FleetSmart+ section can be hidden | `rate_card_show_fleetsmart` | `check:rate-card`, drive check |
| 18 | A custom labour rate, STC against customer | `charge_to` | `check:rate-card`, drive check |
| 19 | A salesman understands every field | help under every control | drive check reads them |
| 20 | A preview of the sheet inside the app | `SheetPreview` | drive check |
| 21 | Download the rate card from the FS+ builder | `RateCardFromContract` | drive check |
| 22 | Never two cards for one customer | partial unique index | `check:rate-card` |
| 23 | Say if one exists and ask before proceeding | `rate_card_for_customer` | `check:rate-card`, drive check |
| 24 | Tell the account manager at eleven months | `rate_card_sweep_stale` | `check:rate-card` |
| 25 | Do not warn about cards years past their year | four verdicts, not two | `check:rate-card` |
| 26 | Account manager from the CRM, overridable, extra ones | `rate_card_managers` | drive check |
| 27 | Pull address, contacts, phone, email; flag what is missing | `rate_card_create`, `missing` | `check:rate-card`, drive check |
| 28 | Fully wired end to end before delivery | every check below | all of them |
| 29 | Follow the UI, no navy sidebar | `.rc-6b` never rendered | `check:rate-card-port` |
| 30 | No overly thick borders | 12 declarations brought to 1px | `check:rate-card-port` |
| 31 | No typing field the height of its text | every control 32px | `check:rate-card-port`, drive check |

## Added while building

| # | Asked for | Where it is | Proved by |
|---|---|---|---|
| 32 | Every role has full access | migration 110, cross join | `check:permission-wiring`, readback |
| 33 | A full log that cannot be removed | triggers on both logs | `check:rate-card` drives all three ways |
| 34 | Reset to default rates on a card | `rate_card_reset` | `check:rate-card`, drive check |
| 35 | A tab to amend the defaults | `DefaultRates` | drive check |
| 36 | A defaults change reaches future cards | `rate_card_create` reads the template | `check:rate-card` |
| 37 | And asks about existing ones, singly or all | `rate_card_resync` | `check:rate-card`, drive check |

## Reported from the live screen, and fixed

| # | Reported | Cause | Proved by |
|---|---|---|---|
| 38 | Toasts load under the sidebar | `.main` is a stacking context at z-index 1 | drive check asserts the toast paints over the sidebar |
| 39 | Text messy on the labour cards, wrong font, too small | the long printing label on a card sized for a short one, at 9.5px mono | drive check reads the computed font |
| 40 | Prices randomly scattered | a single price spans four columns and was left aligned | drive check compares right edges |
| 41 | `rc-2e` too small, wrong font, wrong colour | the same 9.5px mono label style | drive check reads the computed font |
| 42 | The scrim is 60% of the page | `.rc-6a`'s own height beat `inset: 0` | drive check measures it |
| 43 | Start from offers only the defaults | half the kit's control was built | drive check counts the options |
| 44 | The cursor vanishes after one letter | the focus effect re-ran on every render | drive check types a whole word |
| 45 | No contract shown for a customer who holds one | nothing looked from the card to the contract | `check:rate-card` |
| 46 | Ported with no respect for the rest of the app | the kit's prototype frame was kept | the harness now renders the app shell |

---

## The audits, and what each one cannot see

| Check | What it holds | What it is blind to |
|---|---|---|
| `check:rate-card-port` | The kit's stylesheet byte for byte, 334 classes, every departure declared and quoted, no border over 1px | Anything about behaviour |
| `check:rate-card-export` | The workbook against the master: merges, widths, heights, the logo, every cell's format, font, fill, border and alignment, every priced cell on the signed figure, 58 Wingdings ticks | Whether the route returns it |
| `check:rate-card-routes` | Both ways a card leaves the application, over HTTP, including that a signed out request gets the login screen and not a workbook | Whether the file is right |
| `check:rate-card` | Fifteen rules against real PostgreSQL, including all three ways a log row could be removed | Anything on screen |
| `check:rate-cards-drive` | 65 assertions in a browser, including both themes, two viewport widths, and every fault reported from the live screen | Only the controls somebody listed |
| `check:rate-cards-sweep` | Every interactive element on nine screens found and pressed, 147 of them, each having to change something or be disabled with a reason | Whether what it changed was the RIGHT thing |

The last two are deliberately different shapes. The drive check knows
what each control should do; the sweep does not care, and only asks
whether it does anything at all. A control added tomorrow and left
unwired fails the sweep without anybody adding it to a list.

## Faults the audits found in themselves

Worth recording, because an audit that has never been wrong about
anything has probably never been tested.

- The harness drew no sidebar, so the toast stacking fault could not
  have been caught. It renders the application's own shell now.
- The sweep stopped at the first press that navigated, reporting "1
  element" on a screen with seventeen.
- The sweep compared markup LENGTH, so swapping one five character class
  for another looked like nothing happening.
- The export check compared style objects with `JSON.stringify`, which
  is key-order sensitive, and reported 774 font differences where there
  were none.
- The routes check followed redirects, so a correctly protected route
  answering 307 looked like an open one answering 200.
- The first PDF parity check read the file's raw bytes. PDF content
  streams are Flate compressed, so it found no text at all and reported
  every one of 171 values missing from a PDF that had all of them.
- Inflated, it then looked for `(text) Tj`. pdf-lib writes hex strings,
  `<74657874> Tj`, so it still read nothing.
- Reading hex, it decoded byte for byte. The master writes 'Loaded
  blocks - Trailers' with an en dash, which WinAnsi puts at 0x96 and
  Latin-1 leaves empty, so a value that was on the page read as missing.
- It compared the order of prices by looking each one up with `indexOf`.
  £70.00 is on the card four times and all four found the same first
  occurrence, so it could report a reordered card while nothing was out
  of order, and could not have noticed one that was.
- Worst of the lot: it only ever asked whether the cells a CARD writes
  were on the page. The master's own 83 labels are not card values, so a
  PDF that printed the prices with nothing naming any of them passed.

## Task 6 of the agreed development scope

> There is one Rate Card design. The existing Excel Rate Card is the
> authoritative design. The PDF must be the PDF representation of that
> same Rate Card. [...] There must not remain two independently authored
> layouts that can drift.

There were two, and now there is one.

`lib/ratecards/sheet.ts` holds the grid: the master's fifteen columns,
its column widths in its own units, every cell a card writes, and the 83
labels the master itself prints, read out of the file by
`scripts/rate-card-sheet-map.py`. Three things draw it and none of them
decides anything about it:

| Renderer | What it adds |
|---|---|
| `lib/ratecards/export-xlsx.ts` | writes the values into a copy of the master, so the customer's own styling, merges and logo survive |
| `lib/ratecards/export-pdf.ts` | draws the grid on A4 landscape |
| `components/sales/ratecards/SheetGridTable.tsx` | draws it in the browser, for the in-app preview and the print view |

`/api/rate-cards/[id]/export?format=pdf` returns a real PDF, and the
Export dialog downloads it rather than opening the print view.

`npm run check:rate-card-pdf` builds the workbook and the PDF from one
card and reads both back: every one of the 254 cells, every price in
sheet order, the terms, the extra inclusions and their ticks, and the
master's own labels. It was proved by putting three faults back in, one
at a time, and watching it fail on each.
