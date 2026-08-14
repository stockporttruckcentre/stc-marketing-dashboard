# The canonical IR, revised

Supersedes section D of `command-architecture-audit.md`. Four defects in
that draft are corrected here, and the corrections change the shape of
the types rather than adding notes to them.

---

## Correction 1: steps were an ordered list, not a dataflow graph

`steps: Step[]` gave sequence and nothing else. There was no way to
write "those results" or "that new list", so the chaining claim was
false. Two additions fix it:

- every step carries an **id**, and **what it produces is derived from
  the step** by the validator. A step may also declare it, and the
  declaration is checked against the derivation rather than believed:
  a select over contacts that claims to produce one `crm_lists` record
  is refused, and so is a create of `crm_lists` claiming trailer rows
- a **`ResultRef`** can name a previous step's rows, record, scalar,
  series, field or artefact, and a `ResultRef` is usable anywhere a
  source or a value is accepted. Every member of `Produces` has a
  member here, so no shape can be produced and then not be consumable

Nothing here names a list, a share or a CRM concept.

## Correction 2: `requires` was described as the security boundary

It is not, and must never be. A plan arrives from a client and its
`requires` array is an assertion by the sender. It is retained for
preview and for filtering suggestions, and renamed so its status is
unambiguous.

The server derives the true set from the plan and the registries, and
does so **three times**: before resolution, before preview, and before
execution. The derivation walks every entity, field, relationship and
capability the plan touches, including those reached transitively
through a `ResultRef`. A plan whose derived set exceeds the caller's
capabilities is refused. The client's assertion is never consulted.

## Correction 3: relationships are not foreign keys

Measured in this repository: `stock_trailers` has no `contact_id`.
A trailer is linked to a customer by `stock_trailers.customer` (text)
matching `crm_contacts.company_name` (text). The rep link is
`sales_rep` to `assigned_to`, also text. **The primary business
relationship in this application has no foreign key.**

So a relationship is a first-class registry entry declaring its own join
mechanism, of which a foreign key is one case among several.

## Correction 4: the first migration must not rewrite parsing

Land the IR and the registries, then a **lossless `QueryPlan → Select`
adapter**, and prove semantic equivalence against the existing query
tests before any reader changes. Readers emit canonical IR directly only
after equivalence holds.

Also corrected from the audit: the 421 handler bindings are evidence of
**surface area**, not 421 capabilities. Many are the same operation
bound in several places, and many are presentational. The figure is
withdrawn as a capability count.

---

## The types

```ts
/* ================= identity and dataflow ================= */

type StepId = string;

/** What a step makes available to later steps. */
type Produces =
  | { kind: 'rows';   entity: string }
  | { kind: 'record'; entity: string }
  | { kind: 'scalar' }
  | { kind: 'series'; entity?: string }
  | { kind: 'artefact' };

/**
 * A reference to something an earlier step produced.
 *
 * This is the whole of the dataflow model. It is deliberately generic:
 * `record` is any single row a step created or resolved, `rows` is any
 * set, `series` is a grouped aggregate, `field` reaches inside a
 * produced record, `artefact` is a file or document. Nothing here knows
 * what kind of record it is.
 *
 * A `field` reference is satisfied by a `record` and NOT by `rows`. Ten
 * thousand contacts have ten thousand email addresses and no honest
 * single value, so reducing a set to one value goes through `agg`,
 * which says which reduction was meant.
 */
type ResultRef =
  | { ref: 'rows';     step: StepId }
  | { ref: 'record';   step: StepId }
  | { ref: 'field';    step: StepId; field: string }
  | { ref: 'scalar';   step: StepId; as?: string }
  | { ref: 'series';   step: StepId }
  | { ref: 'artefact'; step: StepId };

/** Anywhere a set of rows is accepted. */
type Source = EntityRef | ResultRef | Select;

/* ================= references ================= */

type EntityRef = { entity: string };
type FieldRef  = { entity: string; field: string };
/** A field reached by traversing declared relationships. */
type PathRef   = { entity: string; via: string[]; field: string };

/* ================= expressions ================= */

type Expr =
  | { kind: 'field';    of: FieldRef | PathRef }
  | { kind: 'literal';  value: string | number | boolean | null }
  | { kind: 'context';  slot: string }          // the caller, the selection, now
  | { kind: 'result';   of: ResultRef }         // dataflow into an expression
  | { kind: 'agg';      fn: AggFn; of?: Expr; where?: Cond; partitionBy?: Expr[] }
  | { kind: 'binary';   op: '+'|'-'|'*'|'/'|'%'; left: Expr; right: Expr }
  | { kind: 'duration'; from: Expr; to: Expr; unit: TimeUnit }
  | { kind: 'window';   fn: 'delta'|'growth'|'trend'|'rank'|'share'|'lag';
                        of: Expr; partitionBy?: Expr[]; orderBy?: Expr; offset?: number }
  | { kind: 'case';     when: { if: Cond; then: Expr }[]; else?: Expr };

type AggFn = 'count'|'sum'|'avg'|'min'|'max'|'median'|'distinct';
type TimeUnit = 'day'|'week'|'month'|'quarter'|'year';

/* ================= conditions ================= */

type Cond =
  | { kind: 'cmp';      op: CmpOp; left: Expr; right: Expr }
  | { kind: 'between';  of: Expr; from: Expr; to: Expr }
  | { kind: 'in';       of: Expr; values: Expr[] | Select | ResultRef }
  | { kind: 'empty';    of: Expr }
  | { kind: 'within';   of: Expr; period: Period }
  | { kind: 'near';     of: Expr; origin: Expr; radius: number; unit: 'mi'|'km' }
  | { kind: 'related';  via: string; where?: Cond; count?: { op: CmpOp; n: number } }
  | { kind: 'and';      of: Cond[] }
  | { kind: 'or';       of: Cond[] }
  | { kind: 'not';      of: Cond };

type CmpOp = 'eq'|'neq'|'lt'|'lte'|'gt'|'gte'|'contains'|'startsWith';

/* ================= time, scope, shape ================= */

type Period =
  | { kind: 'relative'; n: number; unit: TimeUnit; direction: 'past'|'next' }
  | { kind: 'named';    name: string }
  | { kind: 'absolute'; from: string; to: string }
  | { kind: 'bucketed'; span: Period; by: TimeUnit };

type Scope =
  | { kind: 'all' }
  | { kind: 'actor' }
  | { kind: 'user'; ref: Expr }
  | { kind: 'team'; ref: Expr }
  | { kind: 'unowned' };

type Shape = {
  groupBy?: Expr[];
  having?:  Cond;
  orderBy?: { by: Expr; direction: 'asc'|'desc' }[];
  limit?:   number;
  offset?:  number;
  compare?: { by: Expr; values?: Expr[] } | { periods: Period[] };
};

/* ================= output ================= */

type Output =
  | { kind: 'rows' } | { kind: 'scalar' } | { kind: 'series' } | { kind: 'table' }
  | { kind: 'file'; format: 'csv'|'xlsx'|'pdf'|'docx' };

type Destination =
  | { kind: 'display' }
  | { kind: 'download' }
  | { kind: 'share'; with: Expr[] }
  | { kind: 'email'; to: Expr[] }
  | { kind: 'attach'; to: Source };

/* ================= steps ================= */

type Select = {
  op: 'select';
  id?: StepId;
  from: Source;
  where?: Cond;
  scope?: Scope;
  select?: { as: string; expr: Expr }[];
  shape?: Shape;
};

type Mutate = {
  op: 'create' | 'update' | 'delete';
  id?: StepId;
  target: EntityRef;
  /** Which rows. A Select, or rows a previous step produced. */
  match?: Source;
  set?: { field: FieldRef; to: Expr; mode?: 'replace'|'add'|'append' }[];
};

type Invoke = {
  op: 'invoke';
  id?: StepId;
  capability: string;
  /** What it acts on: an entity, a query, or a previous step's result. */
  subject?: Source | ResultRef;
  args?: Record<string, Expr>;
};

type Emit = {
  op: 'emit';
  id?: StepId;
  from: Source | ResultRef;
  output: Output;
  to: Destination;
};

type Step = (Select | Mutate | Invoke | Emit) & { produces?: Produces };

/* ================= the plan ================= */

type Plan = {
  steps: Step[];
  /**
   * ADVISORY ONLY. Never a security boundary.
   *
   * Used to filter suggestions and to write the preview. The server
   * derives the real set from the plan and the registries before
   * resolution, before preview and before execution, and refuses on
   * the derived set alone. A plan that understates this is refused by
   * the derivation, not admitted by its own claim.
   */
  advisoryRequires?: string[];
  /** Anything requested that could not be represented. Never dropped. */
  unmet: { part: string; why: string }[];
};
```

## The relationship registry

```ts
type Relationship = {
  id: string;
  from: string;                 // entity id
  to: string;                   // entity id
  cardinality: 'one'|'many';    // from the `from` side
  /** The reverse edge, so traversal works both ways. */
  inverse?: string;
  join: Join;
  /** Capabilities needed to traverse. Both sides may be gated. */
  requires?: string[];
};

type Join =
  /** A declared key. Not assumed to exist. */
  | { via: 'key';      localField: string; remoteField: string }
  /** Value equality between two ordinary columns. The common case here. */
  | { via: 'match';    on: { local: string; remote: string; op: CmpOp }[] }
  /** A join table. */
  | { via: 'through';  table: string; localKey: string; remoteKey: string }
  /** Anything the database cannot express. Named server resolver. */
  | { via: 'resolver'; name: string };
```

The relationships this application actually has, by that model:

| id | from → to | join | why |
|---|---|---|---|
| `trailer.customer` | trailers → contacts | `match` on `customer` = `company_name` | no FK exists |
| `trailer.rep` | trailers → profiles | `match` on `sales_rep` = `name` | no FK exists |
| `contact.owner` | contacts → profiles | `match` on `assigned_to` = `name` | no FK exists |
| `contact.list` | contacts → crm_lists | `through` crm_list_members | join table |
| `contact.addresses` | contacts → contact_addresses | `key` on `contact_id` | real FK |
| `contact.notes` | contacts → contact_notes | `key` on `contact_id` | real FK |
| `meeting.invites` | meetings → calendar_invites | `key` on `event_id` | real FK |

Four of the seven are not foreign keys. A FK-only model would have
covered three.

---

## The four classes, represented

### Class 1: filtered set → export

`export curtainsiders at Carrington under £5k`

```
s1 select  from trailers
           where and[ cmp(contains, category, 'Curtainsider'),
                      cmp(eq, location, 'Carrington'),
                      cmp(lte, sales_price, 5000) ]
           produces rows

s2 emit    from ref(rows, s1)
           output {file, csv}
           to     {download}
```

The export is a step with a source, not a property lost between
parsers. This is the failure from `check:score` closed structurally.

### Class 2: filtered set → create record from results → act on the new record

`find customers near Hyde with more than 20 trailers, create a list called Hyde Prospects from those results, then share that new list with Dave`

```
s1 select  from contacts
           where and[ near(location, 'Hyde', 25, mi),
                      related(via 'contact.trailers', count {gt, 20}) ]
           produces rows{contacts}

s2 create  target crm_lists
           set    [ name → literal 'Hyde Prospects' ]
           produces record{crm_lists}

s3 invoke  capability 'collection.addMembers'
           subject   ref(record, s2)
           args      { members: ref(rows, s1) }

s4 invoke  capability 'collection.share'
           subject   ref(record, s2)
           args      { with: [context(user, 'Dave')] }
```

`s3` reads the rowset from `s1` **and** the record from `s2`. `s4`
references the record created two steps earlier. That is the dataflow
the previous draft could not express.

Note what is generic: `create` targets any entity, `collection.*` are
capability ids resolved from the registry, and `addMembers` takes a
`ResultRef` as an argument. Nothing is named for CRM lists in the IR
itself.

### Class 3: cross-entity analytical query → bucket by month → compare periods

`compare trailer sales profit with maintenance profit by month for the last 12 months`

```
s1 select  from deals
           select [ profit = agg(sum, field(profit)) ]
           shape  { groupBy: [ field(side) ],
                    compare: { periods: [ bucketed(relative 12 month past, by month) ] } }
           produces series

s2 emit    from ref(series, s1)
           output {series}
           to     {display}
```

And the accelerating variant adds one expression, not a new action:

```
select [ profit = agg(sum, field(profit)),
         accel  = window(trend, agg(sum, field(profit)),
                         partitionBy:[field(side)], orderBy: bucket) ]
shape  { orderBy: [ accel desc ], limit: 1 }
```

A cross-entity version traverses instead of adding a field:

```
where related(via 'trailer.customer',
              where cmp(gt, field(path trailers→contacts.turnover), 5000000))
```

### Class 4: contextual selection → bulk mutation → preview → execute

`move these trailers to Hyde`

```
s1 select  from context(slot 'selection')
           produces rows{trailers}

s2 update  target trailers
           match  ref(rows, s1)
           set    [ location → literal 'Hyde' ]
           produces rows{trailers}
```

Preview and execute are not steps. They are the two phases every plan
containing a `Mutate` or a non-idempotent `Invoke` passes through:

```
parse → plan → derive capabilities → resolve → PREVIEW → confirm
      → derive capabilities again → execute → assert
```

The preview renders from the plan: the matched rows, the field, and the
value before and after, which is the contract `/api/command/edit`
already implements for one record. Extending it to a `Source` rather
than one id is the change.

`context(slot 'selection')` is generic. The same slot mechanism carries
`this customer`, `my meetings` and `now`. No slot is named after a
screen.

---

## Why none of these needs a bespoke capability

Every one is a rearrangement of: `Select`, `Mutate`, `Invoke`, `Emit`,
joined by `ResultRef`. The only registry entries any of them require are
ones that describe the application generally:

- `collection.addMembers`, `collection.share` are capabilities of any
  entity that can hold members, not of CRM lists
- `contact.trailers` is a relationship, declared once
- `near` is a condition, usable on any entity with a location

Adding a second kind of collection, or a third entity with members,
requires registry entries and no IR change.

---

## What the validator enforces before anything runs

Five properties, each proved by `npm run check:ir-safety` with a refusal
and a matching acceptance, so a validator that rejected everything would
fail the suite as loudly as one that accepted everything. Every refusal
case also asserts the REASON it was refused, so a case cannot pass by
being rejected for an unrelated typo.

1. **Dataflow is typed, and every shape takes part.** A rowset cannot be
   consumed where a record is required. A series can be produced,
   referenced and emitted with no cast anywhere in the validator.

2. **A step's declared output is not believed.** The contract is derived
   from the step: a select yields rows of its source entity, or a scalar
   when it aggregates, or a series when it aggregates and groups; a
   create yields one record of its target; an update or delete yields
   rows of its target; an invoke yields whatever its capability
   declares, and nothing if the capability declares none. A declaration
   that disagrees is fatal, and references are judged on the derivation.

3. **Identity is checked, not only shape.** Rows of contacts cannot
   choose which trailers a write touches. A write to trailers cannot set
   a field belonging to contacts. A select over trailers cannot filter
   on a contacts column without going through a declared relationship.

4. **Capability contracts are enforced.** `operates` is checked against
   the step operation, `entities` against the subject, and an export to
   a file must name the capability that permits it. Requirements are
   derived from every entity, field and relationship the plan reaches,
   including entities reached only by traversal.

5. **An unresolved request produces no outcome.** A plan carrying an
   unmet part, whether the reader reported it or the validator found it,
   may put an answer on the screen and nothing else. It may not create,
   update, delete, invoke anything that is not repeatable, download,
   share, email or attach. Running the understood half of an instruction
   is worse than running none of it, because it looks like the
   instruction was carried out.

6. **Where a result goes decides what it is.** See below.

## Destinations are effects, not presentation

`Emit` was one step kind covering "put this on the screen" and "send
this to a customer", and the difference was written down nowhere. It was
therefore enforced nowhere: the unresolved-request gate exempted every
emit, so a sentence that was only half understood could not update a row
and could email the half it understood out of the company.

The difference lives in the registry, as data, for the same reason
relationships do. Nothing in the parser knows the word "email".

| Destination | Effect | Capability | Confirmed | May run unresolved |
|---|---|---|---|---|
| `display` | read | none | no | yes, as `partial` |
| `download` | artefact | `rows.export` | no | no |
| `share` | external | `rows.share` | yes | no |
| `email` | external | `rows.email` | yes | no |
| `attach` | mutation | `record.attach` | yes | no |

Building a file and deciding where it goes are two permissions. Emailing
a spreadsheet of the CRM derives both, and deriving only one of them let
the other through. `derivedRequirements` also walks the destination
itself: who a result is shared with and what it attaches to are
expressions and sources, and a requirement hiding in one of them is a
requirement nobody derived.

Naming the wrong capability is not naming one. `rows.export` authorises
building the file, not sending it to somebody, so an email that names it
is refused. A `display` emit that names any capability is also refused,
because it claims an effect the step does not have.

### The screen is allowed to be partial. Nothing else is.

`completion(plan)` returns one of three states, and the middle one is
the point:

```ts
type Completion =
  | { kind: 'refused'; problems: Problem[] }
  | { kind: 'partial'; unresolved: string[] }
  | { kind: 'complete' };
```

`partial` is not a softer `complete`. It carries what went unresolved so
the screen can show it beside the answer, and it exists so that neither
the executor nor the interface can describe the result as the command
having been carried out. A plan that would download, share, email or
attach never reaches `partial`: the gate refuses it first, because a
spreadsheet in somebody's downloads folder and an email in a customer's
inbox both arrive with no record of the question, which makes a partial
answer indistinguishable from a complete one.

`rows.share`, `rows.email` and `record.attach` are declared without
handlers. Nothing in this application shares or emails a result yet, and
recording a handler that does not exist is how a registry starts lying
about what the product can do. Coverage reports 4 of 7 capabilities with
a handler, which is the honest figure.

## Migration, corrected

**Step 1** IR types only. Nothing imports them.

**Step 2** Registries generated from `columns.ts` and `fields.ts`:
entities, fields with types and writability, and a hand-declared
relationship table (it cannot be generated, since four of seven
relationships are value matches rather than keys).

**Step 3** A lossless `QueryPlan → Select` adapter, plus an equivalence
check that runs the existing corpus through both and asserts the
`Select` carries every filter, group, order, limit, range and measure
the `QueryPlan` carried. **No reader changes.** The existing checks must
stay green throughout, unchanged.

Only when equivalence holds do readers begin emitting `Select`
directly, one at a time.

**Step 4, the first runtime slice.** Reads now run through the IR in the
application, not only in a check.

Before:

```
CommandBar
  text -> parseQuery -> QueryPlan
                        |  confidence >= 8 decides whether to run
                        |  summary decides what is shown
                        +- planToPayload -> POST /api/command/query
                                            route reads entityId,
                                            filters, measure ... off
                                            the request body
```

Two semantic authorities and no agreement between them. The `QueryPlan`
decided everything, the route trusted a query the client had built, and
the IR existed beside the arrangement with nothing consulting it.

After:

```
CommandBar
  text -> planCommand(text) -> CommandPlanning
                               plan, completion, requirements,
                               confirm, availability
                        |  availability decides whether to offer it
                        +- POST /api/command/query { text }

route
  text -> planCommand(text) -> CommandPlanning
          1 validate            is it well formed
          2 permissions         is this person allowed
          3 executability       does anything perform it
          4 completion          was the whole question understood
                        |
                        +- planningToQueryPayload
                             reads the canonical Select
                        -> existing executor
```

One semantic authority: the `Plan`. `parseQuery` is still underneath
`planCommand` and is untouched, but it is a reader now rather than an
authority, and `lib/command/plan.ts` is the only module in the
application that can reach it. `selectToQueryPayload` takes a `Select`
and cannot consult a `QueryPlan` even if somebody wanted it to, which is
a stronger guarantee than a comment asking them not to.

The bar posts the sentence rather than a query it assembled, so a client
cannot hand craft a request that never went through the canonical path,
and the plan the bar previewed is the plan that runs.

### Representable, permitted, executable

Three answers that used to be one word.

| | Question | Source |
|---|---|---|
| representable | Is the plan well formed | `validate` |
| permitted | Is this person allowed | `derivedRequirements`, permission entries |
| executable | Does anything actually perform it | `executability`, capability entries with a handler |

`Requirement` now says which of the last two it is. A `permission` entry
names an actor capability from `permissions.ts`. A `capability` entry
names a registry entry that must have a handler behind it.

A plan can pass the first two and fail the third. `rows.email` is a real
capability with a real permission and no handler, so a plan that emails
a result is representable, can be permitted, and is not something this
application can carry out. The bar filters on all three before offering
anything, because an action that appears and then fails teaches people
the tool is unreliable, and a handlerless capability is that same
failure wearing a different hat.

Creates and deletes are not executable either, because nothing in the
registry declares `operates: 'create'` or `'delete'` yet. That is the
honest state while the mutation readers are unmigrated, and it is
asserted rather than assumed.

### One planner is not one planning environment

The slice above put every read through `planCommand`, and that was not
enough. `planCommand` was being called in two places with two different
amounts of knowledge.

Nothing in any file says Chereau is a make. It is a make because it
appears in `stock_trailers.make`, so what a sentence means depends on
what the database currently holds. The browser loaded that vocabulary
from `/api/command/vocabulary`; the server planned the same text with an
empty index. Same function, same sentence, different plan, and every
gate passing on both sides because each was internally consistent.

So the meaning a person is shown now comes from the server:

```
preview    POST /api/command/plan  { text }
           requireCapability -> caps
           ensureVocabulary -> planCommand(text, caps)
           -> { summary, hash, runnable, confirm, completion,
                unresolved, blocked, availability, requirements }

execute    POST /api/command/query { text, hash }
           requireCapability -> caps
           ensureVocabulary -> planCommand(text, caps)
           hash must match the reading that was agreed to
           -> gates -> compatibility layer -> executor
```

`planAuthoritatively` loads the vocabulary before it plans, so a caller
cannot forget. The vocabulary route and the server planner share one
builder in `lib/command/server/vocabulary.ts`, because two functions
reading the same columns the same way are two functions that eventually
stop agreeing.

**The hash is a drift detector, not a token.** The server replans from
the raw text on execution whatever the client sends, so nothing rests on
it being unforgeable. What it catches is a sentence that honestly means
something different by the time somebody presses Enter, because a
trailer was sold or a customer was added and a word that named nothing
now names a make. That comes back as a 409 carrying the new reading, for
preview, rather than executing a question nobody asked. It is hashed
over the plan and not the summary, so a reworded summary does not refuse
every previewed command, and not over the actor, so who is asking does
not change it.

**A client plan is never accepted.** `planAuthoritatively` takes a
string. There is no parameter one could arrive through, which is a
property of the signature rather than of anybody's discipline.

The browser still plans locally, with the actor's capabilities, to
decide whether a half typed sentence is worth a round trip. That is a
filter on what to ask, never the answer.

### Vocabulary is not the same for everybody

The first version of the authoritative planner cached the live
vocabulary once per process, on the reasoning that it is a cache of what
the database contains and therefore identical for everyone. That was
wrong, and the reasoning was wrong because it was never checked against
the policies.

`stock_trailers`, `social_posts` and `calendar_events` all restrict
SELECT to `auth.role() = 'authenticated'`. Every signed in person sees
every row, so those values genuinely are the same for everybody.

`crm_contacts` does not:

```sql
CREATE POLICY "crm_select" ON crm_contacts FOR SELECT USING (
  auth.role() = 'authenticated' AND (
    list_id IS NULL
    OR EXISTS (SELECT 1 FROM crm_lists l WHERE l.id = crm_contacts.list_id
      AND (l.is_global OR l.owner_id = auth.uid()
           OR EXISTS (SELECT 1 FROM crm_list_members m
                      WHERE m.list_id = l.id AND m.user_id = auth.uid())))
  ));
```

`company_name`, `assigned_to`, `location` and `source` therefore differ
per person. `buildVocabulary` runs through the requesting user's client,
so whoever refreshed the shared cache put their own visible accounts
into it, and for the next minute everybody else's sentences resolved
against them. A company only one person could see became a company
everybody's bar understood.

A shorter TTL was not the fix: it shortens the window on a thing that
must never happen at all.

The first attempt classified tables as company wide or actor scoped and
cached the company wide half once for everybody. That classification was
read off `supabase/schema.sql`, where `calendar_events` is
`auth.role() = 'authenticated'`, and it was already wrong:
`migrations/006_meeting_invites.sql` replaces that policy with creator,
team, named users and invitees. Nothing leaked, because
`calendar_events` declares no free text column and so contributes no
vocabulary, but the classification was wrong within days of being
written and no test could have demanded it be updated.

The list is gone. The invariant is now unconditional:

```
authoritative vocabulary = the values visible through THIS actor's own
                           RLS session
```

Everything is read through the caller's client and cached against their
user id, with a TTL and a bounded LRU. There is no shared index and no
second opinion about what is public, so an RLS migration needs no
matching change here and the two cannot disagree. A hand maintained list
of "tables we believe everybody can see" is a second copy of the
security model kept in a different language in a different file, updated
by somebody remembering.

The cost is one query per entity per person per minute. If that ever
shows up in a profile the answer is a measurement and then a narrower
cache, not an assumption.

### Vocabulary is an input, not ambient state

```ts
planCommand(text, { actorCapabilities, vocabulary })
```

`vocabularyFor(supabase, userId)` returns an index; it installs nothing.
`planAuthoritatively` awaits it and hands it to `planCommand`, which
installs it and reads in one synchronous run:

```ts
if (opts?.vocabulary) installVocabulary(opts.vocabulary);
const read = parseQuery(text);
```

Those two statements are one unit. Nothing may be awaited between them,
because an await is where another request gets to install its own, and
`planCommand` is synchronous so nothing can interleave inside it. The
reader underneath still reads a module global; rewriting it to take the
index directly removes even that, and is a reader migration rather than
this job.

`check:authority` proves the isolation with two actors in ONE process,
interleaved and concurrent, with no reset between them. The previous
version of that check cleared the global index before every case, which
is exactly why it could not have caught this: a check that starts each
case from an empty world cannot notice that the world is shared.

**Still to come.** Mutation readers, the action registry, and the
executor rewritten against `Select` directly. When that lands,
`lib/command/ir/execute.ts` is deleted and nothing else changes.
