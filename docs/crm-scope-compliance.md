# CRM scope: what is built and what is not

Tracks `docs/source/crm-page-scope.md` section 1 (CRM Contacts) against the code,
plus the cross cutting items in section 15 that the CRM tab depends on.

The source document is the record of what was asked for and is never edited.
This file is where the answer lives. If the two disagree, the source is right
about the requirement and this file is wrong about the status.

Last audited after the prospect flag, DocuSign shortcut and Lusha lockout.

---

## Section 1: CRM (Contacts)

### New features requested

| # | Item | Status | Where |
|---|---|---|---|
| 1.1 | Generate Proposal on the customer account, prompting trailer sales, maintenance or rental | **Built** | `components/crm/GenerateProposalPicker.tsx`, opened from the drawer. Rental and refurb say plainly their tool is not built and raise the proposal anyway |
| 1.2 | "What to do next?" prompt after adding a new prospect | **Built** | `components/crm/NextActionPrompt.tsx`, fires on create. The options list is still the open question the meeting flagged |
| 1.3 | Prospect vs existing customer flag driving split proposal pipelines | **Built** | Migration 004 adds `relationship`, set on the record next to status in the drawer and carried onto every proposal raised. The dashboard split is now possible; building that view is dashboard work |
| 1.4 | DocuSign shortcut opening the DocuSign home page | **Built** | A DocuSign button in the drawer, on quoted, won and customer records only. Opens the home page and stops there, per the meeting: the CRM is behind the VPN so anything it generates is a file rather than something signable through a link |
| 1.5 | Natural language search bar | **Built** | `lib/command/`, `components/dashboard/CommandBar.tsx`. In the global top bar on every page, alongside a contact lookup that replaced the old second search box |
| 1.6 | Restricted role for Rama | **Partial** | `lib/crm/permissions.ts` expresses it as the `marketer` capability set: reads and edits, no lists, proposals, credits or deletes. The genuinely stock scoped version needs the admin panel, because it is scoped to a table rather than a verb |

### Changes to existing features

| # | Item | Status | Where |
|---|---|---|---|
| 1.7 | Same account in both Trailer Sales and Maintenance without duplicating it | **Built** | Migration 003, `app/api/crm/link/route.ts`, "Same customer" in the drawer. Needs migration 003 run |
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

**It is not enforcement.** These are interface gates. A determined user with the
browser console still has whatever RLS allows, and RLS does not currently know
about any of this. Closing that is a database change and belongs with the admin
panel, not buried in a UI commit.

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
3. **Import on the stock list and sales tracker.** The dialog, mapping,
   duplicate check and review are shared; each tab needs its own dictionary,
   validators and duplicate key.
4. **Row level security for the capability model.** `lib/crm/permissions.ts`
   gates the interface and nothing else. The database does not know about any
   of it. That belongs with the admin panel.

Still blocked, unchanged: Protean for revenue and auto promotion, ITG for
Outlook and the spreadsheet sync, the admin panel for Rama's stock scoped
role.
