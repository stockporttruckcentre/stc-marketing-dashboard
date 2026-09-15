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
| 13 | Save as xlsx or PDF | export route, print view | `check:rate-card-export`, drive check |
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
