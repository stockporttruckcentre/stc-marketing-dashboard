# What the command bar can actually do

Run it: `npm run check:audit`

Every other check in this repo calls a parser in memory and asserts what
comes back. That proves the bar **understood** a sentence. It proves
nothing about whether pressing Enter does anything, and the two have
been reported as though they were the same thing.

The question that exposed it: *"cancel Friday's site visit" can score a
perfect parse against a diary containing no site visit, and nobody would
know the difference from any output this repo produces.*

That is correct, and the gap is large.

---

## The headline

| | |
|---|---|
| Actions declared in `actions.ts` | **149** |
| Actions that carry out their operation from the bar | **0** |
| Actions that open the screen where a person does it by hand | 90 |
| Actions that seed a phrase back into the bar | 4 |
| **Actions that do nothing at all when picked** | **55** |

Of fifty write commands put to it: **37 understood, 10 wired to
something that carries them out.**

The gap between 37 and 10 is the honest state of the bar.

---

## Why zero

`CommandActionSpec` has exactly two ways to lead anywhere:

```ts
path?: string;   // opens a screen
seed?: string;   // types a phrase back into the bar
```

There is no field naming an execution handler. So no action in the
registry can carry out an operation, by construction, however
convincingly it is labelled. `cal.cancel` exists, scores correctly on
"cancel Friday's site visit", appears in the bar, and has neither a path
nor a seed. Picking it does nothing.

An action like that is worse than not being offered. It teaches people
the bar is unreliable, which is the exact failure the capability gating
was built to avoid.

## The one path that genuinely works

`/api/command/edit`, reached by `parseEdit`, for a field write on a
named record. It does the right thing and should be the model for
everything else:

1. parse the record, the field and the value
2. ask the server for a preview
3. show the record it matched, the field, and the value before and after
4. write only after deliberate confirmation

All 10 of the working commands go through it.

---

## Three coverage states, never conflated again

**PARSE** the sentence resolved to the right action, entity and arguments.
**RESOLVE** the referenced record can be found; zero matches says so, several matches asks which.
**EXECUTE** a real backend capability performs the same operation the UI performs.

An action in the registry is evidence of none of these.

---

## The 55 dead actions, by area

| Area | Dead actions |
|---|---|
| Calendar | `cal.edit` `cal.reschedule` `cal.cancel` `cal.visibility` `cal.invite` `cal.accept` `cal.decline` `cal.propose` |
| Social | `social.submit` `social.approve` `social.reject` `social.queue` `social.schedule` `social.markPosted` `social.delete` `social.removeImage` |
| Stock | `stock.bulkStatus` `stock.bulkLocation` `stock.duplicate` `stock.sendToTracker` |
| CRM lists | `crm.deleteList` `crm.shareList` `crm.unshareList` `crm.moveToList` |
| CRM records | `crm.unlink` `crm.addLink` `crm.removeLink` `crm.removeAddress` `crm.primaryAddress` |
| Maps | `crm.showMap` `crm.addPin` `crm.undoPin` `crm.regeocode` |
| Records | `rec.assign` `rec.unassign` `rec.markSold` `rec.delete` `rec.link` `rec.docusign` |
| Tracker | `tracker.linkStock` `tracker.duplicate` |
| Data | `data.exportCustomer` `data.exportList` `data.import` `data.enrich` `data.lushaBalance` |
| Export | `export.copy` `export.email` `export.print` |
| Other | `make.proposal` `me.signOut` `brand.delete` `news.delete` `finder.add` `finder.addBulk` |

## Parses that are wrong, not merely incomplete

These are the dangerous ones, because a write previewed against the
wrong record is a write somebody might confirm:

| Typed | Understood as |
|---|---|
| `assign this account to Dave` | Set Owner to Dave **on a record called Dave** |
| `duplicate STC143580 as another stock unit` | Add an amount to **Trucks** |
| `upload this logo to the brand kit` | Set **Make** to "kit" |
| `add a note to this customer saying fleet review completed` | Set **Customer** to "saying fleet review completed" |
| `take this account off me and put it back in the unassigned pool` | **Accept an invitation** |
| `share this CRM list with Dave` | **Accept an invitation** |
| `create a new LinkedIn post` | **Add a link to a record** |

The preview step means a person would see the wrong record before it
was written, which is the safety net working. It is still wrong.

## "This" and "these" reach nothing

Eleven of the fifty say *this customer*, *this post*, *this meeting*.
Nothing in the bar knows what is on screen, so every one of them is
missing its target. A selection context is a prerequisite for that whole
class of command, not a phrasing problem.

---

## What testing these properly requires

Parsing can be checked in memory, as now. Resolution and execution
cannot, and must never be checked against real records:

```
create a fixture     a calendar event, Friday 10:00, "Site visit"
parse                assert action = cal.cancel, date = Friday
resolve              assert exactly one event matches the fixture
execute              run the real handler in a test environment
assert               the fixture is cancelled
clean up             remove the fixture
```

Your own diary should never need to contain a convenient record for a
check to pass, and no check should ever touch a production row.

---

## Order I would fix this in

1. **Give `CommandActionSpec` a way to execute.** Without it, every
   number in this file stays where it is. One field naming a handler,
   and a handler registry the execute route dispatches on.
2. **Delete or wire the 55 dead entries.** An action that does nothing
   should not be offered. Whichever way each one goes, the count must
   reach zero.
3. **A selection context**, so "this customer" means the record on
   screen. Unlocks eleven of the fifty at once.
4. **Fixture-based resolve and execute checks**, one per handler, in a
   test environment.
5. **Then** the wrong parses above, which are ordinary bugs and the
   least urgent thing on this list.

Until 1 and 2 are done, "the bar can reach every function" is not true,
and no parser score should be quoted as though it were.
