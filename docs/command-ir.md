# The canonical IR, revised

Supersedes section D of `command-architecture-audit.md`. Four defects in
that draft are corrected here, and the corrections change the shape of
the types rather than adding notes to them.

---

## Correction 1: steps were an ordered list, not a dataflow graph

`steps: Step[]` gave sequence and nothing else. There was no way to
write "those results" or "that new list", so the chaining claim was
false. Two additions fix it:

- every step carries an **id** and declares **what it produces**
- a **`ResultRef`** can name a previous step's rows, record, scalar,
  field or artefact, and a `ResultRef` is usable anywhere a source or a
  value is accepted

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
  | { kind: 'series' }
  | { kind: 'artefact' };

/**
 * A reference to something an earlier step produced.
 *
 * This is the whole of the dataflow model. It is deliberately generic:
 * `record` is any single row a step created or resolved, `rows` is any
 * set, `field` reaches inside a produced record, `artefact` is a file
 * or document. Nothing here knows what kind of record it is.
 */
type ResultRef =
  | { ref: 'rows';     step: StepId }
  | { ref: 'record';   step: StepId }
  | { ref: 'field';    step: StepId; field: string }
  | { ref: 'scalar';   step: StepId; as?: string }
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
