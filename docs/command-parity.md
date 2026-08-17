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
| Import a CSV of contacts | `app/api/crm/import` | **not yet**: needs a file, and the bar has no upload |
| Look a company up in Lusha | `app/api/lusha/enrich` | **not yet**: capability declared, handler is a route the runtime does not call |
| Raise a proposal | `app/api/crm/proposal` | **not yet**: the route builds a document from a template |
| Log a follow-up | `app/api/crm/follow-up` | **generic** as a field write on `next_action` and `last_contact` |

## Stock

| Manual operation | Where it lives | Command runtime |
|---|---|---|
| Change any field on a trailer | `StockList` grid editing | **generic** |
| Move units between depots, in bulk | grid multi-select | **generic**: "move every available curtainsider at Hyde to Bredbury" |
| Add a trailer | `StockList` new row | **lifecycle** "new trailer STC142345" |
| Delete a trailer | grid context menu | **lifecycle**, named record only |
| Mark a deal sold | `app/api/tracker/mark-sold` | **operation** `deal.markSold`, in one transaction over a set |
| Send a unit to the tracker | `app/api/tracker/send-from-stock` | **not yet**: creates a deal from a unit, no operation declared |
| Sync trailers from the supplier feed | `app/api/trailers/sync` | **navigation**: it is a scheduled import, not a command |
| Export the stock list | `StockList` export | **generic** |

## Calendar

| Manual operation | Where it lives | Command runtime |
|---|---|---|
| Change a meeting's fields | calendar dialog | **generic** for the writable ones |
| Cancel or delete a meeting | calendar dialog | **lifecycle** where the sentence names the meeting by title. "Cancel Friday's site visit" is **not yet**: a day and a description is not a record reference, and nothing resolves one |
| Invite somebody | `app/api/calendar/invite` | **not yet**: no operation declared |
| Book a call | command intent `schedule_call` | **navigation** through the legacy intent route, not the canonical path |

## Social planner

| Manual operation | Where it lives | Command runtime |
|---|---|---|
| Change a post's fields | social planner | **generic** |
| Approve outstanding posts | planner status control | **generic** as a status write, gated on `marketing.approve` |
| Schedule a post | planner date control | **generic** as a date write |
| Write or attach media | planner composer | **navigation**: it needs a canvas |

## Everything else

| Manual operation | Where it lives | Command runtime |
|---|---|---|
| Open any screen | sidebar | **navigation**, 149 actions in `actions.ts` |
| Ask any question about any entity | dashboards and grids | **generic**, the query engine |
| Change a role | `app/dashboard/admin` | **operation** `user.setRole`: the person resolved exactly, the old role and the new one in the preview, admin only in the database as well as in the runtime, and the last administrator refused |
| Seed demo data, diagnose reps | `app/api/admin/*` | **navigation**: maintenance routes, not product operations |
| Read the news feed | `app/dashboard/news` | **navigation** |
| Find a company in the finder | `app/dashboard/finder` | **navigation**, and Lusha enrichment is not yet reachable |

## What is genuinely missing, and why

1. **Anything that needs a file going in.** The CSV import takes an
   upload and the bar has no way to attach one. That is a task rather
   than an exclusion: the bar needs an attachment context, and the raw
   file is input context, not semantic authority. Nothing about the
   import's own validation would change.
2. **Anything that needs a canvas.** Drawing a route, choosing a
   photograph. Not writing a post: "create a LinkedIn draft saying we
   have three new curtainsiders at Hyde" already contains everything the
   draft needs, and calling it a canvas job is how a sentence that could
   simply run ends up opening a screen instead. A canvas is required
   where the sentence genuinely cannot carry the content, and nowhere
   else.
3. **Operations nobody has declared.** `send-from-stock`,
   `calendar/invite`, `crm/proposal` and `lusha/enrich` are real routes
   with real logic, and the logic is in the route rather than in a
   module. Each needs its body lifted into `lib/` the way
   `lib/crm/mark-sold.ts` already is, a capability with its inputs, and
   a dispatch entry in the store. None of them needs new machinery, and
   none of them may be reimplemented: two implementations of a proposal
   is how one of them stops carrying the relationship across.
4. **A meeting named by when it is.** "Friday's site visit" is a date
   and a description rather than a title, and nothing turns that into a
   record reference. Every other entity is named by its title.
5. **Sending a result out of the company.** See the CRM table: the only
   part that does not exist is the transport, and it does not exist
   anywhere in this repository or its environment.
