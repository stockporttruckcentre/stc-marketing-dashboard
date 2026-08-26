# CRM scope: what is built and what is not

Tracks `docs/source/crm-page-scope.md` section 1 (CRM Contacts) against the code,
plus the cross cutting items in section 15 that the CRM tab depends on.

The source document is the record of what was asked for and is never edited.
This file is where the answer lives. If the two disagree, the source is right
about the requirement and this file is wrong about the status.

Last audited after the command runtime work: the clarification path, the
sale projection, and the five operations the screens had and the bar did not.

---

## Section 1: CRM (Contacts)

### New features requested

| # | Item | Status | Where |
|---|---|---|---|
| 1.1 | Generate Proposal on the customer account, prompting trailer sales, maintenance or rental | **Built** | `components/crm/GenerateProposalPicker.tsx`, opened from the drawer. Rental and refurb say plainly their tool is not built and raise the proposal anyway |
| 1.2 | "What to do next?" prompt after adding a new prospect | **Built** | `components/crm/NextActionPrompt.tsx`, fires on create. The options list is still the open question the meeting flagged |
| 1.3 | Prospect vs existing customer flag driving split proposal pipelines | **Built** | Migration 004 adds `relationship`, set on the record next to status in the drawer and carried onto every proposal raised. The dashboard split is now possible; building that view is dashboard work |
| 1.4 | DocuSign shortcut opening the DocuSign home page | **Built** | A DocuSign button in the drawer, on quoted, won and customer records only. Opens the home page and stops there, per the meeting: the CRM is behind the VPN so anything it generates is a file rather than something signable through a link |
| 1.5 | Natural language search bar | **Built** | `lib/command/`, `components/dashboard/CommandBar.tsx`. In the global top bar on every page, alongside a contact lookup that replaced the old second search box. It answers questions and carries out instructions, previewing every write before it happens, and a sentence it understands but that is short of one value asks for that value rather than refusing |
| 1.6 | Restricted role for Rama | **Partial** | `lib/crm/permissions.ts` expresses it as the `marketer` capability set: reads and edits, no lists, proposals, credits or deletes. The genuinely stock scoped version needs the admin panel, because it is scoped to a table rather than a verb |

### Changes to existing features

| # | Item | Status | Where |
|---|---|---|---|
| 1.7 | Same account in both Trailer Sales and Maintenance without duplicating it | **Built** | Migration 003, `app/api/crm/link/route.ts`, "Same customer" in the drawer. Reachable from the command bar too, as `contact.link`: "link these two customer records as the same account" asks which one is the main account rather than picking the first, and "link Dawson Maintenance to Dawson Group as the main account" says it in one breath. Needs migration 003 run |
| 1.8 | Bi directional sync with the legacy Excel files during transition | **Blocked** | ITG server dependency |
| 1.9 | Auto promote prospect to portfolio when Protean marks them active | **Blocked** | Protean feed, Wayne dependency |
| 1.10 | Add stock form: stock number first, fewer fields | **Not built, wrong tab** | Belongs to Trailer Stock. Tracked as task 2 |

### Bugs and complaints

| # | Item | Status | Where |
|---|---|---|---|
| 1.11 | Inline row entry is fiddly, Dave prefers a modal | **Built** | `AddContactModal` in `components/CrmWorkspace.tsx`. Company, contact, email, phone and owner. Only the company name is required, because a prospect off a phone call often is only a name |
| 1.12 | "Move to list" reads as "move because you lost them" | **Built** | Renamed. The bulk bar says "Add to a list" and "Copy to a list", the menu says "Move onto which list" and carries a line of help text saying it is not a won or lost outcome |
| 1.13 | Dean sending proposals through DocuSign, which charges per envelope | **Not a code item** | The counter measure is 1.1 being obviously easier, which it now is |

### Data and reporting

| # | Item | Status |
|---|---|---|
| 1.14 | Per account revenue and invoice volume vs last year on the contact record | **Blocked** on Protean |

---

## Role based rendering

The user's summary was: the CRM defaults to your own accounts, the global list
needs a role, sending proposals for other people needs a role. That is now
`lib/crm/permissions.ts`, and every gate on the tab reads from it rather than
testing `profile.role` in place.

| Capability | Admin | Sales | Restricted | Read only |
|---|---|---|---|---|
| See the tab | yes | yes | yes | yes |
| See the shared global list | yes | yes | yes | yes |
| See a named colleague's portfolio | yes | no | no | no |
| Edit contacts | yes | yes | yes | no |
| Create and delete | yes | yes | no | no |
| Assign an owner | yes | yes | no | no |
| Book into another diary | yes | yes | no | no |
| Manage and share lists | yes | yes | no | no |
| Raise a proposal | yes | yes | no | no |
| Raise one in somebody else's name | yes | no | no | no |
| Spend a Lusha credit | yes* | yes* | no | no |
| Import | yes | yes | no | no |
| Export | yes | yes | yes | yes |

\* Lusha is locked off for everybody at rollout, admins included, by
`LUSHA_LOCKED`. The row shows who gets it back when that lifts.

Sales gets assign and delegate because both came straight out of the meeting:
claiming an unowned lead is everyday work, and Dave taking a call while Dean is
away and putting the follow up in Dean's diary was the worked example.

**The CRM opens on your own accounts.** Anyone who can own accounts lands on
`mine`. Anyone who cannot has no portfolio to open into and lands on the shared
list instead.

Two things to know about this file:

- **It is a stopgap and is written as one.** Role becomes capability in exactly
  one function, `capabilitiesFor`. When the admin panel lands it passes per user
  grants in as `overrides` and they win outright, so a person can be given or
  denied a single capability without inventing a role for them. Nothing else in
  the CRM changes.
- **It stays the authority after Microsoft sign in.** Permissions cannot come
  from Entra groups, because only IT can see Entra and the CRM needs its own full
  admin control. Sign in answers who you are. This answers what you may do.

**It is not enforcement, and one hole makes it decorative.**

`profiles_update_self` is `FOR UPDATE USING (id = auth.uid())`. Row level
security is row level: it decides which rows you may touch, not which columns.
So a policy meant to let somebody edit their own name lets them edit every field
in that row, including `role`. One line in the browser console promotes a viewer
to admin.

Everything here hangs off `profiles.role`. Until that is closed, the capability
model, the portfolio scoping and the Lusha lock are a tidy interface rather than
a permission system, and the exec dashboard is readable by anybody who wants it.

`supabase/migrations/005_role_escalation.sql` closes it with a trigger, because
Supabase runs users and admins as the same Postgres role, so a column level
revoke would lock admins out too. **Run it before go live.**

Beyond that one fix, RLS still knows nothing about the capability model. Closing
that properly is a bigger database change and belongs with the admin panel.

---

## Section 15 items the CRM tab depends on

| Item | Status |
|---|---|
| Notifications system | Table exists, nothing writes to it. Four other features wait on this |
| Outlook integration | Not started, needs ITG |
| Protean via ITG server | Not started, and possibly re scoped if Wayne picks Transora |
| File and CRM bi directional sync | Not started, needs ITG |
| Admin panel permissions | `lib/crm/permissions.ts` is the CRM half. The panel itself is not built |
| Delegated actions across users | Built for calls and meetings. Owner cannot yet edit a meeting booked for them, because the calendar policies let only the creator edit |
| UI kit refresh | CRM tab done. Other tabs untouched, per the instruction that the rebrand is ordered by the user |
| Lusha lockout at rollout | **Built.** `LUSHA_LOCKED` in `lib/crm/permissions.ts` strips `crm.enrich` from everyone including admins, and the search, enrich and check routes refuse server side, because hiding a button is not a lock. The finder page says why. One constant to lift it |

---

## Section 6: Calendar

Rebuilt as the Diary, `/dashboard/calendar`, in the STC kit. Three views over
one filtered list: the month for orientation, the week for laying seven days
side by side, and what is next for the morning.

The invitation model in migration 006 and the operations in migration 021 had
existed since they went in and no screen had ever called either. That is what
"clicking into a meeting request does not have the full wiring" was.

### New features requested

| # | Item | Status | Where |
|---|---|---|---|
| 6.1 | Call reminders, not just meetings | **Built** | `lib/calendar/kind.ts` reads what a row is from what somebody typed. A call, a site visit, an inspection and a meeting are told apart, filtered separately and drawn differently, and the strip counts calls on their own. The classification is derived rather than stored, so no existing row needs backfilling and nothing goes stale when a title is edited |
| 6.2 | Outlook sync, so it reaches a phone | **Blocked** | Needs ITG, unchanged. Nothing in the application sends mail yet, and a button that claimed to would be a button that quietly did nothing |
| 6.3 | Delegation of diary items across people | **Built** | Booking something with somebody on it sends them a real invitation. They accept it, say they cannot make it, or suggest another time, and it goes back and forth until somebody accepts. The whole exchange is on the entry, so the record shows how the time was arrived at rather than only the time |
| 6.4 | A next action prompt after a quote | **Built** | `components/crm/NextActionPrompt.tsx`, unchanged by this work |

### Changes to existing features

| # | Item | Status | Where |
|---|---|---|---|
| 6.5 | A meeting and a call should look different | **Built** | Its own glyph, its own chip and its own count, on both screens that list them |
| 6.6 | The day labels do not line up | **Fixed** | The names were a `repeat(7, 1fr)` grid above a second one. A `1fr` track is `minmax(auto, 1fr)`, so a cell holding a long title widened its own column, the header had no content to push back with, and every name after it drifted. The names are now the first row of the same grid and the tracks are `minmax(0, 1fr)`. `npm run check:calendar` asserts every cell of every month for twenty years sits under the name of its own day |
| 6.7 | You cannot see who attends, or set it when booking | **Built** | The entry drawer lists everybody on it with where each of them stands, and the compose form picks people off the team and actually asks them |

### Beyond the meeting spec

| Item | Where |
|---|---|
| The same diary on the Work tab | A Meetings and calls tab beside Tasks, off `lib/calendar/diary.ts`, the same module the diary screen reads. Half of "what is on me" was in a calendar somebody had to go and open |
| Deep links | `?event=` opens an entry, `?view=` opens a view. An invitation link now leads to the meeting rather than to whatever month it happens to be |
| British Summer Time | `dayKey` reads the local parts rather than the ISO string. Keyed on UTC, anything before 1am lands in yesterday's box for seven months of the year. Asserted across both clock changes |

### What is still not there

A proper hour by hour week grid. With two or three entries a day it would be
mostly empty rows, and the thing somebody wants from a week here is all seven
days at once without scrolling. Worth revisiting when the diary is busier.

---

## Section 13: Fleet Smart Plus builder

Built as its own tab under Sales, `/dashboard/fleetsmart`. The rate card, the
inclusion matrix and the wording all came out of
`FleetSmart_Contract_Builder.xlsx`, which stays the source of the prices.
What moved into the application is the act of building one for a named
customer, which the workbook cannot do because it has no idea who the
customer is.

The engine is `lib/fleetsmart/price.ts`, the wizard is
`components/fleetsmart/wizard.tsx` and the printable contract is
`components/fleetsmart/document.tsx`. The price is computed on the server in
`/api/fleetsmart/contracts` and never accepted from a browser.

### New features requested

| # | Item | Status | Where |
|---|---|---|---|
| 13.1 | Customer details block | **Built** | Customer step, picked off the CRM rather than typed twice. The account and the lead it came out of are both stored on the contract |
| 13.2 | Silver, Gold and Platinum selector | **Built** | Plan step, with what each plan buys written next to it. The plan drives the inclusion matrix, so changing it reprices every line |
| 13.3 | Contract term selector, minimum 12 months | **Built** | 12, 24, 36, 48 and 60 months, defaulting to 36. The end date writes itself |
| 13.4 | Longer terms multiply the price, and a 5% annual increase inside that multiplier | **Not built** | The workbook prices a year and treats the term as a date range, so there is nothing to port. It needs the multiplier matrix from the business before it can be built rather than invented |
| 13.5 | Mileage, defaulting to 60,000 a year | **Partial** | Per asset, and it drives the wear and tear allowance: 60,000 miles counts as a year of ageing. The wider "higher mileage adds a percentage per the forecast matrix" needs that matrix |
| 13.6 | Labour rates, £85 truck and van, £65 trailer | **Built** | Plan step, and they price collection and delivery and print in the Charges block |
| 13.7 | Multi asset entry, one row per reg | **Built** | Fleet step. A reg and an asset type is enough; every other column has a default and shows it as a placeholder, so a blank cell is a standard value rather than missing data. Rows copy, which is the eight identical trailers case |
| 13.8 | Inspection interval per asset | **Built** | In weeks, 4 to 26, and the visit count follows it |
| 13.9 | Laden brake test count per asset | **Built** | Four a year on a vehicle, one at MOT on a trailer, none on a van, all typed over |
| 13.10 | Days against nights working pattern | **Built** | Days, nights at 1.25 and combined at 1.125, applied to labour lines only, with a further 5% for out of hours |
| 13.11 | Per asset cost and a total build cost | **Built** | Annual, monthly and weekly per asset, and the contract total in the wizard footer while it is being built |
| 13.12 | Notes flagging missing data | **Built** | Per asset warnings on the fleet step and again on the review step. Nothing blocks: every one of them is a question to answer before it goes out |
| 13.13 | The contract builds itself from the pricing data | **Built** | Eight wording blocks that write themselves from the fleet and the plan, each overridable. The document only claims what was actually charged, so a trailer only fleet does not promise bulbs |
| 13.14 | Miscellaneous expense line, separate from wear and tear | **Built** | Per asset, and it prints as its own line |
| 13.15 | Laden RBT include or exclude, with a count | **Built** | Setting it to zero removes it, and the asset then says so in its warnings |
| 13.16 | One pricing unit, never mixed | **Built** | One annual figure, shown as annual, monthly or weekly. There is no second calculation to disagree with the first |
| 13.17 | PMI intervals in weeks, not months | **Built** | Weeks everywhere, in the field label and in the wording |
| 13.18 | Tyres section | **Not built** | Waiting on the supplier decision, same as the workbook, whose Tyres tab is a placeholder |
| 13.19 | Telematics as an add on line | **Built** | A per asset annual figure. Pricing it changes the warnings on that asset: an asset on brake performance monitoring may not need the extra RBTs next to it |
| 13.20 | Manual override on any line | **Partial** | Wear and tear, miscellaneous and telematics take a typed figure, and every frequency is overridable, which between them cover the cases in the meeting. An arbitrary override on any of the forty rate card lines is not built |
| 13.21 | An EMS API for real parts pricing | **Not built** | Long term, flagged as such in the meeting |

### Beyond the meeting spec

| Item | Where |
|---|---|
| A manager's discount with its own permission | `fleetsmart.discount`. Sales builds and sends at rate card and cannot discount, and the control is not drawn for them. A request carrying one is dropped in `lib/fleetsmart/wire.ts` rather than refused, because the only way to send one is a modified client |
| The price snapshot | `priced` is stored alongside `input`, so a contract signed at one rate card still prints its own numbers after prices move |
| A sent contract is frozen | Row level security, not a disabled button. Proved in `scripts/sql/fleetsmart-check.sql`, which caught the first version letting anybody who could send edit what they had sent |

### The bug in the workbook, not carried over

`Contract!H43` is `SUM(H18:H22)`. The asset block runs to row 42, so a fleet of
six or more prints a monthly total lower than the sum of its own lines.
`scripts/fleetsmart-price-check.ts` asserts the opposite: six identical assets
cost six times one.

Worth telling whoever is still using the spreadsheet.

---

## What to do next on this tab, in order

Section 1 is now built out as far as it can go without Protean, the ITG
server or the admin panel. What is left is not CRM page work.

1. **Run the migrations.** 002 and 003 are short, additive and safe. 004 adds
   the relationship column. 001 is the long one and has two dependencies worth
   checking first: it calls `current_role_safe()` and references
   `stock_trailers`, and `schema.sql` is known to have drifted from what is
   deployed. Its ownership backfill is commented out on purpose because it
   matches people on free text first names.
2. **The split proposal view on the dashboard.** The flag exists and every
   proposal now carries it, so this is a dashboard query rather than a CRM
   change.
3. ~~**Import on the stock list and sales tracker.**~~ Built. The dialog,
   mapping, duplicate check and review are shared, each tab has its own
   dictionary, and the same import runs from the command bar with a file
   attached: `rows.import` for customers and `stock.import` for units, both
   in one transaction with the preview saying how many are new and how many
   are duplicates of records already here.
4. **Row level security for the capability model.** `lib/crm/permissions.ts`
   gates the interface and nothing else. The database does not know about any
   of it. That belongs with the admin panel.

Still blocked, unchanged: Protean for revenue and auto promotion, ITG for
Outlook and the spreadsheet sync, the admin panel for Rama's stock scoped
role.
