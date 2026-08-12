# CRM scope: what is built and what is not

Tracks `docs/source/crm-page-scope.md` section 1 (CRM Contacts) against the code,
plus the cross cutting items in section 15 that the CRM tab depends on.

The source document is the record of what was asked for and is never edited.
This file is where the answer lives. If the two disagree, the source is right
about the requirement and this file is wrong about the status.

Last audited after the CRM interface rebuild.

---

## Section 1: CRM (Contacts)

### New features requested

| # | Item | Status | Where |
|---|---|---|---|
| 1.1 | Generate Proposal on the customer account, prompting trailer sales, maintenance or rental | **Built** | `components/crm/GenerateProposalPicker.tsx`, opened from the drawer. Rental and refurb say plainly their tool is not built and raise the proposal anyway |
| 1.2 | "What to do next?" prompt after adding a new prospect | **Built** | `components/crm/NextActionPrompt.tsx`, fires on create. The options list is still the open question the meeting flagged |
| 1.3 | Prospect vs existing customer flag driving split proposal pipelines | **Not built** | Needs a column. `status` has `lead` and `customer` but nothing distinguishes a prospect proposal from an existing customer proposal, which is what Tom asked to split |
| 1.4 | DocuSign shortcut opening the DocuSign home page | **Not built** | A single link on a converting prospect. Deliberately no envelope pre population, per the meeting |
| 1.5 | Natural language search bar | **Built** | `lib/command/`, `components/dashboard/CommandBar.tsx`. Currently on the dashboard only. Moving it to the global top bar is task 3 |
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
| Spend a Lusha credit | yes | yes | no | no |
| Import | yes | yes | no | no |
| Export | yes | yes | yes | yes |

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
| Lusha lockout at rollout | **Not built.** Trivial and the meeting wanted it at go live: gate `crm.enrich` off for everyone until a usage policy exists |

---

## What to do next on this tab, in order

1. **Run migrations 001, 002 and 003.** Three features currently show a "not
   wired up yet" state that would otherwise work.
2. **The import flow** (task 1). The current one writes straight to the database
   with no mapping and no duplicate check, which on a real spreadsheet is how a
   CRM gets poisoned in one click.
3. **Prospect vs existing flag** (1.3). Small, and it unblocks the split
   proposal pipelines Tom asked for on the dashboard.
4. **DocuSign shortcut** (1.4). One button.
5. **Lusha lockout.** One capability, and the meeting asked for it at go live.
