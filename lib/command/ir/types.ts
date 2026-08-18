/* =============================================================
   The canonical semantic plan.

   One representation for reads, analytics, writes and workflows. Every
   reader eventually emits this and every executor eventually consumes
   it. Nothing in this file names a trailer, a depot, a profit, an
   export or a list: a type that knows about those is a type that has to
   grow when the business does.

   Two properties do the work.

   EXPRESSIONS ARE RECURSIVE. `profit` and `profit / sale_price` and
   `trend(sum(profit))` are the same kind of object, so an operator that
   accepts an Expr accepts all three. The old engine had a `derived`
   field with four hardcoded entries, which is what an expression looks
   like before anybody notices it is one.

   STEPS CARRY IDENTITY AND REFER TO EACH OTHER. An ordered array gives
   sequence and nothing else. `ResultRef` is what lets a later step say
   "those rows" or "that record", which is the difference between a list
   of operations and a program.

   Nothing here executes. See ./validate for the checks that run before
   anything does.
   ============================================================= */

/* =============================================================
   Identity and dataflow
   ============================================================= */

export type StepId = string;

/**
 * What a step makes available to later steps.
 *
 * A step MAY declare this, and the declaration is documentation and a
 * cross-check, never an authority. `validate` derives the real output
 * contract from the step itself and refuses a declaration that does not
 * match. A plan arriving from a client could otherwise write
 * `produces: record` on a select over ten thousand contacts and have
 * every downstream check wave it through.
 */
export type Produces =
  | { kind: 'rows'; entity: string }
  | { kind: 'record'; entity: string }
  | { kind: 'scalar' }
  /** A grouped or compared aggregate: several keyed values, not one. */
  | { kind: 'series'; entity?: string }
  | { kind: 'artefact' };

export type ProducesKind = Produces['kind'];

/**
 * A reference to something an earlier step produced.
 *
 * Deliberately generic. `record` is any single row a step created or
 * resolved, `rows` is any set, `series` is a grouped aggregate, `field`
 * reaches inside a produced record, `artefact` is a file or document.
 * Nothing here knows what kind of record it is, which is what stops the
 * dataflow model growing a case per feature.
 *
 * Every member of `Produces` has a member here. When it did not, a
 * `series` could be produced and never consumed, and the gap was hidden
 * by a cast in the validator rather than showing up as a type error.
 */
export type ResultRef =
  | { ref: 'rows'; step: StepId }
  | { ref: 'record'; step: StepId }
  | { ref: 'field'; step: StepId; field: string }
  | { ref: 'scalar'; step: StepId; as?: string }
  | { ref: 'series'; step: StepId }
  | { ref: 'artefact'; step: StepId };

export type ResultRefKind = ResultRef['ref'];

/* =============================================================
   References into the data model
   ============================================================= */

/**
 * What happens when something names more than one row.
 *
 * There is deliberately no `first` and no `closest`. Silently picking
 * one of several matching customers produces a confident wrong answer,
 * which is the failure this architecture exists to stop. If the caller
 * wants every match they say so with `all`; otherwise it stops and
 * asks, or refuses.
 *
 * Declared here rather than in the registry because expressions carry
 * one too: a value that names a row without saying which row has to say
 * what happens when the name fits two.
 */
export type AmbiguityPolicy = 'ask' | 'fail' | 'all';

export type EntityRef = { entity: string };
export type FieldRef = { entity: string; field: string };

/**
 * A field reached by traversing declared relationships.
 *
 * `via` is a list of relationship ids, not table names, because the
 * relationship carries the join mechanism. Four of the seven real
 * relationships in this application are value matches rather than
 * foreign keys, so the path cannot be expressed as columns alone.
 */
export type PathRef = { entity: string; via: string[]; field: string };

/** Anywhere a set of rows is accepted. */
export type Source = EntityRef | ResultRef | Select;

/* =============================================================
   Expressions
   ============================================================= */

export type AggFn = 'count' | 'sum' | 'avg' | 'min' | 'max' | 'median' | 'distinct';
export type TimeUnit = 'day' | 'week' | 'month' | 'quarter' | 'year';
export type WindowFn = 'delta' | 'growth' | 'trend' | 'rank' | 'share' | 'lag';
export type BinaryOp = '+' | '-' | '*' | '/' | '%';

/**
 * A span of time, typed.
 *
 * "A month" is a number and a unit, not a string somebody parses again
 * later. Both a period and a date shift are built from these, so
 * "in the last month" and "push the MOT back a month" are the same
 * quantity used two ways.
 */
export type Interval = { n: number; unit: TimeUnit };

export type Expr =
  | { kind: 'field'; of: FieldRef | PathRef }
  | { kind: 'literal'; value: string | number | boolean | null }
  /** The caller, the current selection, now. Filled at resolution. */
  | { kind: 'context'; slot: string }
  /** Dataflow into an expression. */
  | { kind: 'result'; of: ResultRef }
  /**
   * A value that names a row without saying which row.
   *
   * "The profile named Dave" is a reference: the plan knows what was
   * meant and does not know which record that is, because finding out
   * requires the database. Resolving it during planning would put a row
   * id inside the semantic plan, so a plan built at ten past would
   * differ from the identical sentence planned at quarter past for no
   * reason a person could see, and the hash that is meant to detect a
   * changed MEANING would fire on changed DATA.
   *
   * So planning keeps the reference and `resolve` turns it into a
   * value. Nothing here knows about owners or reps: `entity`, `where`
   * and `select` describe any lookup at all.
   */
  | {
      kind: 'reference';
      entity: string;
      where: Cond;
      /** Which column of the matched row becomes the value. */
      select: string;
      onAmbiguity: AmbiguityPolicy;
    }
  /**
   * A date moved by an interval.
   *
   * Distinct from `duration`, which is the number of days BETWEEN two
   * dates. This is a date, and the difference matters: one answers "how
   * old is this" and the other answers "when should this be".
   */
  /**
   * Several values where an operation takes several.
   *
   * "Share Fleet Prospects with Dave and Tom" names two people, and each
   * of them is a reference the database resolves. Without this the only
   * way to carry two was a second argument key per recipient, which is a
   * lookup table of arities rather than a language.
   *
   * Deliberately generic. Nothing here knows that its members are
   * people: they are expressions, and an operation that takes several
   * dates or several platforms uses the same node.
   */
  | { kind: 'list'; of: Expr[] }
  | { kind: 'shift'; of: Expr; by: Interval; direction: 'forward' | 'back' }
  | { kind: 'agg'; fn: AggFn; of?: Expr; where?: Cond; partitionBy?: Expr[] }
  | { kind: 'binary'; op: BinaryOp; left: Expr; right: Expr }
  | { kind: 'duration'; from: Expr; to: Expr; unit: TimeUnit }
  | { kind: 'window'; fn: WindowFn; of: Expr; partitionBy?: Expr[]; orderBy?: Expr; offset?: number }
  | { kind: 'case'; when: { if: Cond; then: Expr }[]; else?: Expr };

/* =============================================================
   Conditions
   ============================================================= */

export type CmpOp = 'eq' | 'neq' | 'lt' | 'lte' | 'gt' | 'gte' | 'contains' | 'startsWith';

export type Cond =
  | { kind: 'cmp'; op: CmpOp; left: Expr; right: Expr }
  | { kind: 'between'; of: Expr; from: Expr; to: Expr }
  | { kind: 'in'; of: Expr; values: Expr[] | Select | ResultRef }
  | { kind: 'empty'; of: Expr }
  | { kind: 'within'; of: Expr; period: Period }
  | { kind: 'near'; of: Expr; origin: Expr; radius: number; unit: 'mi' | 'km' }
  /** Relationship-backed. `via` is a relationship id. */
  | { kind: 'related'; via: string; where?: Cond; count?: { op: CmpOp; n: number } }
  | { kind: 'and'; of: Cond[] }
  | { kind: 'or'; of: Cond[] }
  | { kind: 'not'; of: Cond };

/* =============================================================
   Time, scope, shape
   ============================================================= */

export type Period =
  | { kind: 'relative'; n: number; unit: TimeUnit; direction: 'past' | 'next' }
  /* `relative` predates `Interval` and says the same thing. Left as it
     is so no existing plan changes shape; new work uses Interval. */
  | { kind: 'named'; name: string }
  | { kind: 'absolute'; from: string; to: string }
  | { kind: 'bucketed'; span: Period; by: TimeUnit };

export type Scope =
  | { kind: 'all' }
  | { kind: 'actor' }
  | { kind: 'user'; ref: Expr }
  | { kind: 'team'; ref: Expr }
  | { kind: 'unowned' };

export type Shape = {
  groupBy?: Expr[];
  having?: Cond;
  /** A list, so secondary and tertiary sorts are the same mechanism. */
  orderBy?: { by: Expr; direction: 'asc' | 'desc' }[];
  limit?: number;
  offset?: number;
  compare?: { by: Expr; values?: Expr[] } | { periods: Period[] };
};

/* =============================================================
   Output
   ============================================================= */

export type Output =
  | { kind: 'rows' }
  | { kind: 'scalar' }
  | { kind: 'series' }
  | { kind: 'table' }
  | { kind: 'file'; format: 'csv' | 'xlsx' | 'pdf' | 'docx' };

/**
 * Where a result goes.
 *
 * Not presentation. `display` changes nothing, `email` leaves the
 * company and cannot be recalled, `attach` changes a record. Each
 * kind's effect, the capability that permits it, whether it is
 * confirmed and whether it may run on a partly understood request are
 * declared in `registry.DESTINATIONS` and enforced in `validate`.
 */
export type Destination =
  | { kind: 'display' }
  | { kind: 'download' }
  | { kind: 'share'; with: Expr[] }
  | { kind: 'email'; to: Expr[] }
  | { kind: 'attach'; to: Source };

/* =============================================================
   Steps
   ============================================================= */

export type Select = {
  op: 'select';
  id?: StepId;
  from: Source;
  where?: Cond;
  scope?: Scope;
  select?: { as: string; expr: Expr }[];
  shape?: Shape;
  produces?: Produces;
};

export type Assignment = {
  field: FieldRef;
  to: Expr;
  /**
   * `replace` is the default and covers arithmetic too, because "add a
   * thousand" is `binary('+', field, 1000)` and replacing a value with
   * an expression over itself is what that is. `append` survives only
   * for long text, where adding a note must not overwrite the notes.
   */
  mode?: 'replace' | 'append';
};

/**
 * How many rows the SENTENCE says this touches.
 *
 * Never derived from how many rows matched. "Set the price on Dawson"
 * says one; if it matches forty, that is an ambiguity to ask about, and
 * reading the forty as permission to write forty is exactly how a bulk
 * write happens by accident. `many` requires a word that says so.
 */
export type Cardinality = 'one' | 'many';

type MutateCommon = {
  id?: StepId;
  target: EntityRef;
  /**
   * Which rows. A Select, or rows a previous step produced.
   *
   * The same filter language that answers a question chooses the rows a
   * write touches. `select.ts` exists because those were once separate,
   * and "not contacted in 60 days" ended up implemented twice with
   * different behaviour.
   */
  match?: Source;
  set?: Assignment[];
  produces?: Produces;
};

/**
 * `expect` is required on update and delete and absent on create,
 * expressed in the type so it cannot be forgotten rather than only
 * refused by the validator. A create makes one row and has no selection
 * to be ambiguous about.
 */
export type Mutate =
  | ({ op: 'create' } & MutateCommon)
  | ({ op: 'update' | 'delete'; expect: Cardinality } & MutateCommon);

export type Invoke = {
  op: 'invoke';
  id?: StepId;
  /** A capability id from the registry. */
  capability: string;
  subject?: Source;
  /**
   * How many records the SENTENCE says this operates on.
   *
   * Same rule as a mutation's: never derived from how many matched.
   * "Elevate Dave to admin" says one, and two people called Dave is a
   * question rather than two people to promote. Absent means the
   * sentence described a set, which is what "mark all the in stock
   * curtainsiders as sold" does.
   */
  expect?: Cardinality;
  args?: Record<string, Expr | ResultRef>;
  produces?: Produces;
};

export type Emit = {
  op: 'emit';
  id?: StepId;
  from: Source;
  output: Output;
  to: Destination;
  /**
   * A capability id from the registry.
   *
   * Required when `output` is a file. Putting rows into a spreadsheet
   * and handing it over is an export whoever asked may not be allowed to
   * perform, and an emit step that named nothing had no requirement to
   * derive and so was gated by nothing.
   */
  capability?: string;
  produces?: Produces;
};

export type Step = Select | Mutate | Invoke | Emit;

/* =============================================================
   The plan
   ============================================================= */

export type Unmet = { part: string; why: string };

export type Plan = {
  steps: Step[];
  /**
   * ADVISORY ONLY. Never a security boundary.
   *
   * An assertion by whoever built the plan, used to write the preview
   * and to filter suggestions. The server derives the real set from the
   * plan and the registries before resolution, before preview and
   * before execution, and refuses on the derived set alone. A plan that
   * understates this is caught by the derivation, not admitted by its
   * own claim.
   */
  advisoryRequires?: string[];
  /** Anything requested that could not be represented. Never dropped. */
  unmet: Unmet[];
};

/* -------------------------------------------------------------
   Narrowing helpers. Used by validate and by the adapter.
   ------------------------------------------------------------- */

export function isEntityRef(s: Source): s is EntityRef {
  return typeof s === 'object' && s !== null && 'entity' in s && !('op' in s) && !('ref' in s);
}
export function isResultRef(s: Source | Expr | ResultRef): s is ResultRef {
  return typeof s === 'object' && s !== null && 'ref' in s;
}
export function isSelect(s: Source): s is Select {
  return typeof s === 'object' && s !== null && 'op' in s && (s as Select).op === 'select';
}
