# What the command bar can do, against what the screens can do

The question this answers is "can the command runtime perform this",
never "is there an action label for it". Every row was checked against
the actual routes and components in this repository, not against
`actions.ts`.

Five classifications:

- **generic** the canonical machinery already does it for every entity,
  and nothing entity-specific exists or is needed
- **operation** a business operation with a real handler, reached
  through `Invoke`
- **lifecycle** create, delete or field write through the canonical
  mutation path
- **navigation** the command bar opens the screen and the screen does
  the work, which is the right answer for anything that needs a canvas
- **not yet** the runtime cannot do it, with the reason

## CRM and the sales tracker

| Manual operation | Where it lives | Command runtime |
|---|---|---|
| Change any field on a contact or deal | `CrmWorkspace` grid editing | **generic** 103 writable fields, one record or a described set |
| Change a field on the selected rows | grid multi-select | **generic** through context: "assign these to Dave" |
| Add a note | `CrmWorkspace` note dialog | **generic** append to `notes`, including "add a note to this customer" |
| Create a lead, prospect or customer | `CrmWorkspace` new row | **lifecycle** "create a new lead for Smith Logistics" |
| Delete a contact | grid context menu | **lifecycle** one named record, or the records on the screen with the count typed to confirm. Never a described set |
| Assign an account owner | grid, `assigned_to` | **generic**, gated on `crm.assign` |
| Make a list from selected rows | `CrmWorkspace` move-to-list | **operation** `list.create`, one transaction |
| Move a contact into an existing list | move-to-list menu | **operation** `list.add`, the list resolved by name inside the transaction that does the move |
| Export a contact's own record | `ExportView`, docx and xlsx | **navigation**, and **generic** for row exports |
| Export any selection to CSV, XLSX, PDF or DOCX | not manually possible | **generic**, four formats, every entity, never truncated |
| Share a list with colleagues | list membership dialog | **operation** `rows.share`, one transaction, refuses the global list |
| Attach a file to a record | not manually possible | **operation** `record.attach`, bytes on the row under the record's own policy |
| Email a result out of the company | not manually possible | **not yet**: read, resolved, gated and confirmed, but there is no mail client in `package.json` and no SMTP or provider credentials anywhere in the environment |
| Import a CSV of contacts | `app/api/crm/import` | **operation** `rows.import`. The bar takes an attachment, the preview says how many are new and how many are duplicates of records already here, and the whole file lands in one transaction |
| Look a company up in Lusha | `app/api/lusha/enrich` | **operation** `contact.enrich`, through the purchase ledger: one claim per company, and only the claimant may call the provider. Switched off for every role by the rollout lock |
| Raise a proposal | `app/api/crm/proposal` | **operation** `crm.raiseProposal`, over one customer or a set |
| Log a follow-up | `app/api/crm/follow-up` | **generic** as a field write on `next_action` and `last_contact` |

## Stock

| Manual operation | Where it lives | Command runtime |
|---|---|---|
| Change any field on a trailer | `StockList` grid editing | **generic** |
| Move units between depots, in bulk | grid multi-select | **generic**: "move every available curtainsider at Hyde to Bredbury" |
| Add a trailer | `StockList` new row | **lifecycle** "new trailer STC142345" |
| Delete a trailer | grid context menu | **lifecycle**, named record only |
| Mark a deal sold | `app/api/tracker/mark-sold` | **operation** `deal.markSold`, in one transaction over a set |
| Send a unit to the tracker | `app/api/tracker/send-from-stock` | **operation** `stock.sendToTracker`, onto your own tracker rather than a list id from the payload |
| Sync trailers from the supplier feed | nothing: `app/api/trailers/sync` is deleted | **operation** `stock.import`. The old route wrote `trailer_sales`, which `schema.sql` marks as replaced by `stock_trailers`, and its only caller was a component deleted in 93388fc. There was no schedule: the README says the watcher was never built |
| Export the stock list | `StockList` export | **generic** |

## Calendar

| Manual operation | Where it lives | Command runtime |
|---|---|---|
| Change a meeting's fields | calendar dialog | **generic** for the writable ones |
| Cancel or delete a meeting | calendar dialog | **operation**. "Cancel Friday's site visit" works: a meeting is named compositionally, by a day, a time and what it is about, in any order and any of them absent |
| Invite somebody | `app/api/calendar/invite` | **operation** `meeting.invite`, the person resolved exactly and two of the same name asked about |
| Book a call | canonical `meeting.create` | **operation**. The legacy intent route is deleted; there is one runtime |

## Social planner

| Manual operation | Where it lives | Command runtime |
|---|---|---|
| Change a post's fields | social planner | **generic** |
| Approve outstanding posts | planner status control | **generic** as a status write, gated on `marketing.approve` |
| Schedule a post | planner date control | **generic** as a date write |
| Write or attach media | planner composer | **operation**. Writing is `post.create`, and a post with nothing to say asks what it should say rather than opening the composer. A picture is `post.setImage`, staged under a key that does not move and removed again if the transaction fails |

## Everything else

| Manual operation | Where it lives | Command runtime |
|---|---|---|
| Open any screen | sidebar | **navigation**, 149 actions in `actions.ts` |
| Ask any question about any entity | dashboards and grids | **generic**, the query engine |
| Change a role | `app/dashboard/admin` | **operation** `user.setRole`: the person resolved exactly, the old role and the new one in the preview, admin only in the database as well as in the runtime, and the last administrator refused |
| Seed demo data, diagnose reps | `app/api/admin/*` | **navigation**: maintenance routes, not product operations |
| Read the news feed | `app/dashboard/news` | **navigation** |
| Find a company in the finder | `app/dashboard/finder` | **operation** `crm.findCompanies`. A sentence with no place asks where rather than searching the country. Switched off for every role by the rollout lock, which is why the audit reports it as locked rather than as a gap |

## What is genuinely missing, and why

1. **Sending a result out of the company.** Emailing a file is read,
   resolved, gated and confirmed, and there is no mail client in
   `package.json`, no SMTP and no provider credentials anywhere in the
   environment. The transport is the only missing part and it does not
   exist in this repository.
2. **Anything that needs a canvas.** Drawing a route, choosing a
   photograph, cropping one. Not writing a post: "create a LinkedIn
   draft saying we have three new curtainsiders at Hyde" already
   contains everything the draft needs, and a post with nothing to say
   is asked what it should say rather than being handed to a screen.
3. **Inviting somebody who has not signed up.** People join by signing
   up and an admin promotes them, which the bar carries out. There is no
   invitation flow in this product and none was invented to make a
   sentence executable.

## What the bar does that no screen does

| Operation | Why it is here |
|---|---|
| `stock.duplicate` | The stock list has a Duplicate button and it built the copy in the browser out of whatever the grid held. Both call one function now |
| `deal.duplicate` | The tracker has a Duplicate item in a context menu nothing renders. The rule is stated in migration 038: the conversation carries, the sale resets |
| `deal.linkStock` | Nothing could put a unit against a deal that already exists. Sending from stock creates one with the link on it; marking sold reads it |
| `brand.upload` | The brand kit's upload button is a file input. The bar takes the same file as context and files it under the same rules |
| `contact.link` | Two accounts that are one business. Which one is the main account is asked rather than guessed, because a merge under the wrong parent is somebody ringing a depot that closed |
