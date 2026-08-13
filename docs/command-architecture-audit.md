# Architecture audit: from an action list to a command language

No code changed to produce this. Every figure below was measured from
the repository, and the command that produced it is named so it can be
re-run.

The requirement this audits against: the command bar should be a
deterministic operating language over the application's data and
capabilities, where combinations nobody wrote down compose from
primitives. Not a larger list of actions.

---

## A. Current semantic architecture

### Every module that reads raw text

`lib/command` is 7,923 lines across 21 files. Eleven of them parse
English independently:

| Module | Lines | Reads a sentence into |
|---|---|---|
| `query.ts` | 1142 | entity, measure, filters, group, range, order, limit, derived, compare |
| `mutate.ts` | 876 | record reference, field, value, arithmetic |
| `grammar.ts` | 562 | order, limit, negate, compare, derive, empty |
| `select.ts` | 402 | conditions: eq, ilike, empty, present, gte, lte, before, after, owner |
| `intents.ts` | 293 | intent id, slot values |
| `resolve.ts` | 276 | candidate readings, scored (**not wired in**) |
| `finder.ts` | 231 | place, radius, industry, size, count |
| `compose.ts` | 230 | suggestion phrases |
| `params.ts` | 229 | count, radius, place, industry, employees |
| `attributes.ts` | 208 | which column a phrase names |
| `ontology.ts` | 301 | concepts, canonical surface forms (**not wired in**) |

Two of those, `resolve.ts` and `ontology.ts`, are complete parallel
interpreters that nothing calls. 577 lines of unreachable semantics.

### Where the same idea is parsed more than once

Measured by grepping each concept across all modules:

| Concept | Independently implemented in |
|---|---|
| dates and periods | `entities` `query` `select` `mutate` `grammar` `compose` `actions` `fields` `columns` `schema` |
| location / depot | 15 modules |
| limits and counts | `grammar` `params` `query` `finder` `compose` `mutate` `actions` `vocab` `features` |
| empty / present | `grammar` `query` `select` `mutate` |
| numeric comparison | `query` `select` `mutate` `fields` `columns` |
| ownership | `select` `actions` `schema` `attributes` `ontology` `arbitrate` |
| entity picking | `query.pickEntity` `select.pickEntityNoun` `schema.entityByNoun` |
| ordering | `grammar` `query` |
| grouping | `query` `arbitrate` |

**"Not contacted in 60 days" is implemented twice**, in `select.ts` and
`query.ts`, with different behaviour. **A price range is implemented
three times.** Every one of these is a place a fix has to be applied
more than once, and historically was not.

### The pipeline as it exists

```
sentence
   |
   +-- parseEdit ......... write?   -> /api/command/edit   -> preview -> execute
   +-- parseQuery ........ question? -> /api/command/query  -> rows
   +-- suggestActions .... action?   -> a screen, or nothing
   +-- parse (intents) ... intent?   -> /api/command/execute (9 handlers)
   +-- parseSelection .... rows?     -> used only by bulk edit
   |
   arbitrated by readsOnlyText / INSTRUCTION in arbitrate.ts
```

Five parsers race. The arbitration between them is two regular
expressions. There is no shared representation at any point: each
parser produces its own private shape, and nothing can express a
sentence that spans two of them. `export curtainsiders at Carrington
under £5k` needs `parseQuery` for the rows and an action for the export,
and no type exists that holds both, which is exactly why the export is
dropped.

---

## B. Current capability architecture

### What the 149 actions are

| Kind | Count | What it actually is |
|---|---|---|
| navigate | 57 | open a screen |
| record | 55 | an operation on a record |
| admin | 12 | user and role management |
| create | 10 | make a record |
| data | 9 | import, export, enrich |
| session | 6 | theme, sign out |

Wiring:

| | |
|---|---|
| open a screen (`path`) | 90 |
| retype a phrase (`seed`) | 12 |
| **neither: dead** | **47** |
| **perform their own operation** | **0** |

`CommandActionSpec` has `path` and `seed` and no field naming an
execution handler. No action can perform anything. 57 of the 149 are
navigation, so the registry is closer to a sitemap than a capability
model.

### What the application can do that the 149 do not represent

**Data the command bar cannot address at all:**

| | |
|---|---|
| Tables in `columns.ts` | 20 |
| Tables with a query entity | 4 |
| **Tables with no entity** | **16** |

Unreachable: `calendar_invites`, `contact_addresses`, `contact_notes`,
`crm_lists`, `crm_list_members`, `brand_assets`, `news_items`,
`news_sources`, `profiles`, `notifications`, `dashboard_actions`,
`revenue_targets`, `account_ownership`, `maint_accounts`,
`lusha_credits`, `trailer_sales`.

`revenue_targets` matters: no target question is answerable.
`crm_lists` matters: the list-creation example in the brief writes to a
table the language cannot name.

**Columns:**

| | Count | Of 180 non-system |
|---|---|---|
| filterable | 21 | 12% |
| groupable | 17 | 9% |
| measurable | 15 | 8% |
| declared as dates | 11 | 6% |
| writable | 104 | 58% |

More columns can be written than can be read.

**Relationships: zero.** No foreign key is declared anywhere in
`lib/command`. The schema has `contact_id`, `list_id`,
`stock_trailer_id`, `owner_id`, `author_id`, `user_id`,
`revenue_targets`. None is expressible. Every cross-entity question in
the brief is therefore unrepresentable, not merely unimplemented.

**UI capability:** 421 handler bindings in `components/` and
`app/dashboard/`; 170 catalogued in `docs/command-bar-inventory.md`.
Against 0 executable actions.

**Analytics that exist only as questions:** trend, acceleration,
period-over-period, share of total, conversion rate, contribution
margin. None has a screen, none has an action, and by the brief's
argument none should need either.

### Permissions

| Role | Capabilities | Actions visible |
|---|---|---|
| admin | 17 | 148 |
| sales | 12 | 117 |
| marketer | 6 | 107 |
| viewer | 3 | 71 |

17 distinct capabilities; 16 actions carry no gate at all. Gating is
applied to action *suggestion* only. `parseQuery` never consults
capabilities, so query planning is permission-blind: the gate is on the
menu, not on the language.

---

## C. Missing primitives

The command space is not combinatorial because these do not exist as
first-class, composable objects. Each absence removes a whole dimension
of the cross-product.

| Primitive | State | What its absence costs |
|---|---|---|
| **relationship** | absent | all cross-entity work: no join, no traversal, no "customers whose trailers…" |
| **boolean tree** (AND/OR/NOT) | absent | filters are a flat AND array; no OR, no nesting, negation is a per-filter flag |
| **arithmetic** | absent | no `profit / sale_price`, no ratio, no per-unit |
| **derived measure** | hardcoded | 4 named entries in `grammar.DERIVED`, not an expression |
| **time bucket** | absent | a period is one from/to; no "by month for 12 months" |
| **comparison across sets** | partial | one attribute, two values; not two measures, not two periods |
| **trend / window** | absent | no acceleration, no period-over-period |
| **output / destination** | absent | no representation of screen vs CSV vs list vs share. The export gap |
| **context** | absent | `this customer`, `these rows` reach nothing |
| **chaining** | absent | no plan can feed another; the brief's list example needs it |
| **entity as data** | partial | 5 hand-written entities; 16 tables have none |
| **capability as data** | absent | actions are a hand list, not derived from schema + permissions |
| **permission on the plan** | absent | gating happens on suggestions only |

Six exist and are sound: filter conditions, ordering, limit, grouping,
aggregate measure, empty/present. Those are also the six components
scoring highest in `check:score` (filters 12/12, shaping 6/6). The
pattern holds: what is a primitive works; what is a special case does
not.

---

## D. Proposed canonical IR

One representation for reads, analytics, writes and workflows. No field
is named after any example. Nothing below encodes a domain noun.

```ts
/* ---------- references ---------- */
type EntityRef = { entity: string };
type FieldRef  = { entity: string; field: string };
type Path      = { from: string; via: string[]; field: string };  // traversal

/* ---------- expressions: one tree for values, measures, arithmetic ---------- */
type Expr =
  | { kind: 'field';    ref: FieldRef | Path }
  | { kind: 'literal';  value: string | number | boolean | null }
  | { kind: 'param';    name: string }                    // filled by context
  | { kind: 'agg';      fn: 'count'|'sum'|'avg'|'min'|'max'|'median'|'distinct';
                        of?: Expr; over?: Scope }
  | { kind: 'binary';   op: '+'|'-'|'*'|'/'|'%'; left: Expr; right: Expr }
  | { kind: 'duration'; from: Expr; to: Expr; unit: 'day'|'week'|'month'|'year' }
  | { kind: 'window';   fn: 'delta'|'growth'|'trend'|'rank'|'share';
                        of: Expr; partitionBy?: Expr[]; orderBy?: Expr; offset?: number }
  | { kind: 'case';     when: { if: Cond; then: Expr }[]; else?: Expr };

/* ---------- conditions: a real boolean tree ---------- */
type Cond =
  | { kind: 'cmp';     op: 'eq'|'neq'|'lt'|'lte'|'gt'|'gte'|'contains'|'startsWith';
                       left: Expr; right: Expr }
  | { kind: 'between'; of: Expr; from: Expr; to: Expr }
  | { kind: 'in';      of: Expr; values: Expr[] }
  | { kind: 'empty';   of: Expr; negated?: boolean }
  | { kind: 'within';  of: Expr; period: Period }
  | { kind: 'exists';  via: string; where?: Cond }        // relationship-backed
  | { kind: 'and';     of: Cond[] }
  | { kind: 'or';      of: Cond[] }
  | { kind: 'not';     of: Cond };

/* ---------- time ---------- */
type Period =
  | { kind: 'relative'; n: number; unit: 'day'|'week'|'month'|'quarter'|'year';
                        direction: 'past'|'next' }
  | { kind: 'named';    name: 'today'|'this_week'|'this_month'|'this_quarter'|'this_year'
                            |'last_month'|'last_quarter'|'last_year'|'mtd'|'qtd'|'ytd' }
  | { kind: 'absolute'; from: string; to: string }
  | { kind: 'bucketed'; span: Period; by: 'day'|'week'|'month'|'quarter'|'year' };

/* ---------- who ---------- */
type Scope =
  | { kind: 'all' }
  | { kind: 'actor' }                                     // me
  | { kind: 'user';  ref: Expr }
  | { kind: 'team';  ref: Expr }
  | { kind: 'unowned' };

/* ---------- shaping ---------- */
type Shape = {
  groupBy?:  Expr[];
  having?:   Cond;
  orderBy?:  { by: Expr; direction: 'asc'|'desc' }[];      // list = tie-breaks
  limit?:    number;
  offset?:   number;
  compare?:  { dimension: Expr; values?: Expr[] }          // side by side
           | { periods: Period[] };                        // period over period
};

/* ---------- what to produce ---------- */
type Output =
  | { kind: 'rows' }
  | { kind: 'scalar' }
  | { kind: 'series' }
  | { kind: 'table' }
  | { kind: 'file';    format: 'csv'|'xlsx'|'pdf'|'docx' }
  | { kind: 'record';  entity: string }                    // materialise, eg a list
  | { kind: 'screen';  path: string };

type Destination =
  | { kind: 'display' }
  | { kind: 'download' }
  | { kind: 'share';   with: Expr[] }
  | { kind: 'email';   to: Expr[] }
  | { kind: 'attach';  to: EntityRef };

/* ---------- the plan ---------- */
type Select = {
  op: 'select';
  from: EntityRef;
  where?: Cond;
  scope?: Scope;
  select?: { as: string; expr: Expr }[];
  shape?: Shape;
};

type Mutate = {
  op: 'create' | 'update' | 'delete';
  target: EntityRef;
  match?: Select;                                          // which rows: a Select
  set?: { field: FieldRef; to: Expr; mode?: 'replace'|'add'|'append' }[];
};

type Invoke = {
  op: 'invoke';
  capability: string;                                      // from the registry
  subject?: Select | EntityRef;
  args?: Record<string, Expr>;
};

type Step = Select | Mutate | Invoke;

type Plan = {
  steps: Step[];                                           // chaining
  output?: Output;
  to?: Destination;
  /** Set by the planner, checked before preview. Never inferred later. */
  requires: string[];                                      // capability ids
  /** Anything requested that could not be represented. Never dropped. */
  unmet: { part: string; why: string }[];
};
```

Properties that matter:

- **`Expr` is recursive**, so `profit / sale_price` and
  `delta(sum(profit))` are the same kind of object as `profit`.
- **`Cond` is a tree**, so OR and nesting exist by construction.
- **`Mutate.match` is a `Select`**, so every filter usable in a question
  is usable to choose rows to write, with no second selector language.
- **`Invoke.subject` is a `Select`**, so any action applies to any set
  of rows the language can describe. This is the export gap closed
  structurally.
- **`steps` chains**, so create-then-share is one plan.
- **`requires` is on the plan**, so permission is checked against what
  the plan does, not against which menu item was matched.
- **`unmet` is mandatory**, so an unrepresentable request is reported
  rather than silently dropped.

Nothing in these types names a trailer, a depot, profit, or an export.

---

## E. Migration

Nothing is thrown away. Every module becomes either a **reader** (text
to IR fragments) or a **registry** (data the IR is built against). The
split is the point: readers stop producing private shapes.

| Module | Becomes | Keep |
|---|---|---|
| `grammar.ts` | reader: order, limit, negate, compare, derive, empty → `Shape`/`Cond` | all of it. It is already attribute-agnostic, which is the target shape |
| `attributes.ts` | registry: phrase → `FieldRef` | all of it. Already the single resolver |
| `vocab.ts` | registry: value → `FieldRef` + literal | all of it. Data-backed, already correct |
| `columns.ts` | **promoted**: the source of entities, fields and types | becomes primary. Today it is only a census |
| `schema.ts` | folded into the entity registry, generated from `columns.ts` + overrides | keep the vocabulary and labels; drop the hand-written entity list |
| `fields.ts` | folded in: writability and capability per field | keep. Merge with `columns.ts` so one table says readable, writable and gated |
| `query.ts` | reader → `Select`. `pickEntity` becomes entity resolution over the registry | keep the resolution order, the spread-column logic, the bracket subject logic, `unmet` |
| `select.ts` | **deleted as a parser.** Its conditions are `Cond` | keep `selectionSpace` for the census. Its clause vocabulary moves to the shared reader |
| `mutate.ts` | reader → `Mutate`. `parseEdit` splits: record resolution vs field/value | keep record resolution, arithmetic modes, the preview contract |
| `ontology.ts` | registry: canonical concept → `FieldRef`/literal. **Finally wired** | keep. This is the canonicalisation layer the IR needs |
| `resolve.ts` | planner: candidate `Plan`s scored on whole-sentence evidence, ambiguity → ask | keep. Rescore over IR fragments instead of raw words |
| `actions.ts` | capability registry entry for genuinely discrete operations | keep the 149 as *some* capabilities; add a handler field; stop treating it as the universe |
| `compose.ts` | discovery: generate continuations from the capability graph | keep the ranking; change the source from phrases to primitives |
| `intents.ts` | **retired.** Its 9 handled intents become capabilities | keep the slot-filling conversation |
| `finder.ts`/`params.ts` | readers → `Cond` (radius, industry, size) | keep. They are already parameterised |
| `arbitrate.ts` | planner: which `op` a sentence requests | keep |
| `/api/command/query` | executor for `Select` | keep the allowlist discipline. It is the safety model and must not loosen |
| `/api/command/edit` | executor for `Mutate` | keep. Preview-then-confirm is the model for all writes |
| `/api/command/execute` | executor for `Invoke`, dispatching on capability | extend from 9 hardcoded branches to a handler registry |
| `permissions.ts` | gate on `Plan.requires`, before planning and before execute | keep the 17 capabilities; apply them earlier |

Order, each step leaving the bar working:

1. Land the IR types. Nothing consumes them yet.
2. Generate the entity/field registry from `columns.ts` + `fields.ts`.
   Measures addressability directly.
3. `query.ts` emits `Select`; `/api/command/query` accepts `Select`.
   Behaviour unchanged, shape changed.
4. `select.ts` and `mutate.ts` conditions become `Cond`. Deletes the
   duplicate date, range and emptiness parsers.
5. Add `Output`/`Destination`. Export stops being dropped.
6. Add `Invoke` + handler registry. The 47 dead actions become wired or
   deleted.
7. Add relationships to the registry. Cross-entity work becomes
   possible.
8. Wire `ontology.ts` and `resolve.ts` as canonicaliser and planner.
9. Retire `intents.ts`.

Checks migrate with it: `check:score`'s thirteen components are the
acceptance harness. `check:fuzz` regenerates from IR primitives instead
of from sentence templates.

---

## F. Twenty commands, composed not written

None appears in any test, lexicon or example in this repository. Each is
shown as IR. No bespoke action exists for any of them.

**1.** `which depots hold more than 20% of unsold stock value`
`Select{from:trailers, where:not(eq(status,sold)), select:[share = window(share, agg(sum, sales_price), partitionBy:[location])], shape:{groupBy:[location], having: cmp(gt, share, 0.2)}}`
Primitives: window/share, group, having.

**2.** `customers whose trailers have all been dispatched`
`Select{from:contacts, where: not(exists(via:trailers, where: empty(dispatch_date)))}`
Primitives: relationship exists, negation.

**3.** `average days between order and dispatch by make this year`
`Select{from:trailers, select:[lead = duration(order_date, dispatch_date, day)], shape:{groupBy:[make]}, where: within(order_date, named:this_year)}`
Primitives: duration expression, group, period.

**4.** `reps whose average margin percentage is below the company average`
`Select{from:trailers, select:[m = agg(avg, binary(/, profit, sales_price))], shape:{groupBy:[sales_rep], having: cmp(lt, m, agg(avg, binary(/, profit, sales_price), over:{kind:'all'}))}}`
Primitives: arithmetic, aggregate over differing scopes.

**5.** `stock that arrived before its supplier's previous delivery was sold`
`Select{from:trailers, where: exists(via:supplier_prior, where: cmp(gt, path(received_date), path(dispatch_date)))}`
Primitives: relationship traversal, cross-row comparison.

**6.** `email the marketing team a csv of posts rejected twice`
`Plan{steps:[Select{from:posts, where: cmp(gte, rejection_count, 2)}], output:{file,csv}, to:{email, team}}`
Primitives: output, destination.

**7.** `flag every customer with no activity in two quarters as dormant`
`Mutate{op:update, target:contacts, match: Select{where: empty(last_contact) or within(last_contact, relative:2 quarter past) negated}, set:[{status → 'dormant'}]}`
Primitives: mutate over a Select, boolean tree.

**8.** `which body type has grown fastest in the last three quarters`
`Select{from:trailers, select:[g = window(growth, agg(count), orderBy: bucket)], shape:{groupBy:[category], compare:{periods: bucketed(3 quarter, by quarter)}, orderBy:[g desc], limit:1}}`
Primitives: bucketed time, growth window, rank.

**9.** `customers in the same town as an unassigned account`
`Select{from:contacts, where: in(location, Select{from:contacts, where: empty(assigned_to), select:[location]})}`
Primitives: subquery as a value set.

**10.** `total refurb spend as a share of book value by depot`
`Select{from:trailers, select:[r = binary(/, agg(sum, refurb_costs), agg(sum, nbv))], shape:{groupBy:[location]}}`
Primitives: arithmetic over two aggregates.

**11.** `add every trailer at Spalding older than 2019 to a list called Clearance and share it with the sales team`
`Plan{steps:[Select{...}, Mutate{create crm_lists, name:'Clearance'}, Invoke{capability:list.addMembers, subject:step0}], to:{share, sales team}}`
Primitives: chaining, materialised output, share destination.

**12.** `which reps have quoted more than they have sold this year`
`Select{from:deals, shape:{groupBy:[assigned_to], having: cmp(gt, agg(count, case(status=quoted)), agg(count, case(status=won)))}, where: within(date_of_enquiry, this_year)}`
Primitives: conditional aggregate, aggregate comparison.

**13.** `trailers whose refurb cost exceeds a fifth of their sale price`
`Select{from:trailers, where: cmp(gt, refurb_costs, binary(*, sales_price, 0.2))}`
Primitives: arithmetic inside a condition.

**14.** `set the next action on everything I own that has gone quiet to call them`
`Mutate{update contacts, match: Select{scope:{actor}, where: within(last_contact, past) negated}, set:[{next_action → 'call them'}]}`
Primitives: actor scope, mutate over a Select.

**15.** `compare this quarter against the same quarter last year by division`
`Select{from:deals, select:[p = agg(sum, profit)], shape:{groupBy:[side], compare:{periods:[this_quarter, same_quarter_last_year]}}}`
Primitives: period-over-period comparison.

**16.** `who has the most accounts nobody has contacted`
`Select{from:contacts, where: empty(last_contact), shape:{groupBy:[assigned_to], orderBy:[count desc], limit:1}}`
Primitives: empty, group, rank.

**17.** `download the trailers dispatched last month with no signed order as a spreadsheet`
`Plan{steps:[Select{where: and(within(dispatch_date, last_month), eq(signed_order,'No'))}], output:{file,xlsx}, to:{download}}`
Primitives: output format, destination.

**18.** `stock worth more than the average for its own body type`
`Select{from:trailers, where: cmp(gt, sales_price, agg(avg, sales_price, over:{partitionBy:[category]}))}`
Primitives: partitioned aggregate as a comparison operand.

**19.** `every customer with an address but no contact name, oldest first`
`Select{from:contacts, where: and(not(empty(address)), empty(contact_name)), shape:{orderBy:[created_at asc]}}`
Primitives: boolean tree, ordering.

**20.** `show revenue per employee for customers over 50 staff, worst ten`
`Select{from:contacts, where: cmp(gt, employee_count, 50), select:[rpe = binary(/, turnover, employee_count)], shape:{orderBy:[rpe asc], limit:10}}`
Primitives: arithmetic, rank, limit.

None requires a new action. Each is a different arrangement of the same
objects: `Expr`, `Cond`, `Period`, `Scope`, `Shape`, `Output`,
`Destination`, `Select`, `Mutate`, `Invoke`.

Eleven of the twenty are unrepresentable today, and the reason is always
a missing primitive rather than a missing phrase: relationships (2, 5,
9), arithmetic (4, 10, 13, 20), windows (1, 8), output and destination
(6, 17), chaining (11).

---

## What to measure instead of headline counts

| Metric | Definition | Now |
|---|---|---|
| data model addressable | non-system columns filterable | 21/180 = **12%** |
| entities addressable | tables with a query entity | 4/20 = **20%** |
| relationships addressable | FK paths expressible | 0/7 = **0%** |
| UI capability executable | actions that perform their operation | 0/149 = **0%** |
| dead capabilities | actions with no route | 47 |
| permission model represented | capabilities gating a plan | 0/17 = **0%** |
| semantic primitives | composable IR node kinds | 6 of ~19 |
| held-out success | `check:score`, all components | **0/20** |

Each has a precise denominator and can be recomputed.

---

## What I am asking to be allowed to do next

Steps 1 to 3 of section E only: land the IR types, generate the entity
and field registry from `columns.ts` and `fields.ts`, and make
`query.ts` emit `Select` with the query route accepting it.

That changes no behaviour and adds no phrases. It makes the
addressability figures move, which is the only honest early signal that
the architecture is turning combinatorial rather than the list getting
longer.
