/* =============================================================
   Steps that need each other, in a thing that runs them at once.

   A programme's changes go to the store in one call, and the store's
   promise is that all of them land or none of them do. That promise says
   nothing whatever about ORDER. Every change is computed from the rows
   as they were before any of them, and they are applied together.

   For most plans that is exactly right. "Move the two Hyde curtainsiders
   to Bredbury and put the price up on the Carrington fridges" is two
   changes that have nothing to do with each other, and doing them
   together is better than doing them one after another.

   It is wrong, silently, the moment one step needs another to have
   happened first:

     put the retail price up 10%, then set the margin from the new price

   The margin step reads a retail price that is still the old one, so the
   command reports success and writes a number that was never true. That
   is worse than refusing, because nothing about the result says it went
   wrong. There is no answer here that is safe to guess: running them in
   sequence gives up atomicity, and running them together gives the wrong
   number.

   So a plan whose steps depend on each other is refused, whole, and the
   refusal says which two steps and why. Sequencing dependent effects
   needs a transaction that can run them in order, which is a thing this
   can be given later. Quietly reinterpreting them as parallel writes is
   not.

   THREE WAYS A STEP CAN DEPEND ON ANOTHER.

     1  it consumes the other's result   `ResultRef` at an effect step
     2  it reads a field the other writes
     3  it touches rows the other touches

   The first two are facts about the plan and are found before anything
   is read. The third is a fact about the rows and can only be found once
   both steps have resolved, which is why it is checked separately and
   after.

   ONE TRAVERSAL, TWO COLLECTORS, NO PLACE TO HIDE.

   The first version of this file had four walkers: references in an
   expression, references in a condition, fields in an expression, fields
   in a condition. Each was a switch listing the members it happened to
   know about, and each quietly returned for the ones it did not. A
   dependence inside `agg.where`, inside `window.partitionBy`, inside a
   `case` arm's condition or inside a `related` subcondition was invisible
   to all four, which meant a plan could be declared independent because
   nobody had looked.

   There is now one traversal over the IR, exhaustive on every member of
   `Expr`, `Cond` and `Source`, ending in a `never` assignment. Adding a
   member to the IR without teaching this file about it is a compile
   error rather than a silently missed dependence. The two things this
   file wants, result references and field reads, are visitors over that
   one traversal.
   ============================================================= */
import type { Cond, Expr, Mutate, Select, Source, Step } from './types';
import { isResultRef } from './types';

export type Dependence = {
  /** The step that cannot go first. */
  stepId: string;
  /** The step it needs. */
  needs: string;
  why: string;
};

/* =============================================================
   The traversal
   ============================================================= */

/**
 * Called for every node, on the way in.
 *
 * A visitor never controls recursion. Letting it stop early is how the
 * first version came to miss whole branches, so the walk is total and
 * the visitor only decides what to write down.
 */
export type Visitor = {
  expr?(e: Expr): void;
  cond?(c: Cond): void;
  source?(s: Source): void;
};

export function walkExpr(e: Expr, v: Visitor): void {
  v.expr?.(e);
  switch (e.kind) {
    case 'field':
    case 'literal':
    case 'context':
    case 'result':
      return;
    case 'reference':
      walkCond(e.where, v);
      return;
    case 'list':
      e.of.forEach((x) => walkExpr(x, v));
      return;
    case 'shift':
      walkExpr(e.of, v);
      return;
    case 'agg':
      if (e.of) walkExpr(e.of, v);
      /* An aggregate carries its own condition and its own partition,
         and both can name a field. `sum(retail_price) where status is
         sold, per depot` reads three fields, and a walker that only
         looked at `of` saw one. */
      if (e.where) walkCond(e.where, v);
      (e.partitionBy ?? []).forEach((x) => walkExpr(x, v));
      return;
    case 'binary':
      walkExpr(e.left, v);
      walkExpr(e.right, v);
      return;
    case 'duration':
      walkExpr(e.from, v);
      walkExpr(e.to, v);
      return;
    case 'window':
      walkExpr(e.of, v);
      (e.partitionBy ?? []).forEach((x) => walkExpr(x, v));
      if (e.orderBy) walkExpr(e.orderBy, v);
      return;
    case 'case':
      for (const w of e.when) {
        walkCond(w.if, v);
        walkExpr(w.then, v);
      }
      if (e.else) walkExpr(e.else, v);
      return;
    default: {
      /* A new expression member reaches here and does not compile. That
         is the point: the alternative is a dependence nobody looks for. */
      const unreached: never = e;
      return unreached;
    }
  }
}

export function walkCond(c: Cond, v: Visitor): void {
  v.cond?.(c);
  switch (c.kind) {
    case 'cmp':
      walkExpr(c.left, v);
      walkExpr(c.right, v);
      return;
    case 'between':
      walkExpr(c.of, v);
      walkExpr(c.from, v);
      walkExpr(c.to, v);
      return;
    case 'in':
      walkExpr(c.of, v);
      if (Array.isArray(c.values)) c.values.forEach((x) => walkExpr(x, v));
      else walkSource(c.values, v);
      return;
    case 'empty':
      walkExpr(c.of, v);
      return;
    case 'within':
      /* A period holds no expression today. If one ever does, `Period`
         gains a member and this comment stops being true, which is why
         the period is not walked silently. */
      walkExpr(c.of, v);
      return;
    case 'near':
      walkExpr(c.of, v);
      walkExpr(c.origin, v);
      return;
    case 'related':
      /* The nested condition is about the far side of a relationship and
         can name any field over there. */
      if (c.where) walkCond(c.where, v);
      return;
    case 'onList':
      // A list id and no expression. Nothing to walk.
      return;
    case 'and':
    case 'or':
      c.of.forEach((x) => walkCond(x, v));
      return;
    case 'not':
      walkCond(c.of, v);
      return;
    default: {
      const unreached: never = c;
      return unreached;
    }
  }
}

export function walkSource(s: Source, v: Visitor): void {
  v.source?.(s);
  if (isResultRef(s)) return;
  if (!('op' in s)) return;                       // an EntityRef names no expression

  const sel = s as Select;
  walkSource(sel.from, v);
  if (sel.where) walkCond(sel.where, v);
  (sel.select ?? []).forEach((c) => walkExpr(c.expr, v));

  if (sel.scope && (sel.scope.kind === 'user' || sel.scope.kind === 'team')) {
    walkExpr(sel.scope.ref, v);
  }

  const shape = sel.shape;
  if (shape) {
    (shape.groupBy ?? []).forEach((x) => walkExpr(x, v));
    if (shape.having) walkCond(shape.having, v);
    (shape.orderBy ?? []).forEach((o) => walkExpr(o.by, v));
    if (shape.compare && 'by' in shape.compare) {
      walkExpr(shape.compare.by, v);
      (shape.compare.values ?? []).forEach((x) => walkExpr(x, v));
    }
  }
}

/** Every expression, condition and source a step contains. */
export function walkStep(s: Step, v: Visitor): void {
  switch (s.op) {
    case 'select':
      walkSource(s, v);
      return;
    case 'create':
    case 'update':
    case 'delete': {
      const m = s as Mutate;
      if (m.match) walkSource(m.match, v);
      (m.set ?? []).forEach((a) => walkExpr(a.to, v));
      return;
    }
    case 'invoke':
      if (s.subject) walkSource(s.subject, v);
      for (const a of Object.values(s.args ?? {})) {
        if (isResultRef(a)) v.source?.(a);
        else walkExpr(a, v);
      }
      return;
    case 'emit':
      walkSource(s.from, v);
      if (s.to.kind === 'share') s.to.with.forEach((x) => walkExpr(x, v));
      if (s.to.kind === 'email') s.to.to.forEach((x) => walkExpr(x, v));
      if (s.to.kind === 'attach') walkSource(s.to.to, v);
      return;
    default: {
      const unreached: never = s;
      return unreached;
    }
  }
}

/* =============================================================
   What the traversal is asked for
   ============================================================= */

/** Every step whose result this one consumes, anywhere inside it. */
export function consumes(s: Step): string[] {
  const out = new Set<string>();
  walkStep(s, {
    expr: (e) => { if (e.kind === 'result') out.add(e.of.step); },
    source: (x) => { if (isResultRef(x)) out.add(x.step); },
  });
  return [...out];
}

/** Every `entity.field` this step writes. */
export function writesFields(s: Step): string[] {
  if (s.op !== 'update' && s.op !== 'create') return [];
  const m = s as Mutate;
  return (m.set ?? []).map((a) => `${a.field.entity}.${a.field.field}`);
}

/**
 * Every field this step reads, to choose rows or to compute a value.
 *
 * Both, because both go wrong the same way. A step selecting on a status
 * another step is writing picks rows by a status that is about to
 * change, and a step computing from a price another step is writing
 * computes from a price that is about to change. Neither is what the
 * person typing meant.
 *
 * A field reached through a relationship is recorded as `*.name`,
 * because which entity it lands on depends on resolving the path and
 * this runs before anything is resolved. `reads` treats that as matching
 * any write of a field with that name, which can refuse a plan that
 * would have been safe. That is the direction to be wrong in: the cost
 * of a false refusal is being asked to type two sentences, and the cost
 * of a missed dependence is a number that was never true.
 */
export function readsFields(s: Step): string[] {
  const out = new Set<string>();
  walkStep(s, {
    expr: (e) => {
      if (e.kind !== 'field') return;
      out.add('via' in e.of ? `*.${e.of.field}` : `${e.of.entity}.${e.of.field}`);
    },
  });
  /* Appending reads what is there before it adds a line. Nothing in the
     expression says so: `to` is the new line on its own. */
  if (s.op === 'update' || s.op === 'create') {
    for (const a of (s as Mutate).set ?? []) {
      if (a.mode === 'append') out.add(`${a.field.entity}.${a.field.field}`);
    }
  }
  return [...out];
}

/** Does a read of `read` see what a write of `written` changes? */
function readSees(read: string, written: string): boolean {
  if (read === written) return true;
  /* A path read landed on some entity this cannot name yet. */
  return read.startsWith('*.') && read.slice(2) === written.split('.').slice(1).join('.');
}

/* =============================================================
   The check
   ============================================================= */

/**
 * Every dependence between the effect steps of one plan.
 *
 * Empty means they can be applied together. Anything else refuses the
 * whole plan, and the first entry is what the refusal reports.
 *
 * Direction is recorded but not acted on. Two steps where one writes
 * what the other reads are dependent whichever order they appear in,
 * because applying them together computes both from the same starting
 * point and the sentence meant something else.
 */
export function dependencesAmong(effects: Step[]): Dependence[] {
  const found: Dependence[] = [];
  const ids = new Set(effects.map((s) => s.id).filter(Boolean) as string[]);

  for (const s of effects) {
    const id = s.id ?? '?';

    /* 1. Consuming another effect's result. Consuming a SELECT's result
          is ordinary dataflow and not a dependence between effects: a
          select changes nothing, so it can be read before any of this. */
    for (const other of consumes(s)) {
      if (ids.has(other) && other !== id) {
        found.push({
          stepId: id, needs: other,
          why: `it uses what "${other}" produces, and both would be carried out at once`,
        });
      }
    }
  }

  /* 2. One step reading a field another writes. */
  for (const a of effects) {
    const written = writesFields(a);
    if (!written.length) continue;
    for (const b of effects) {
      if (a === b) continue;
      for (const read of readsFields(b)) {
        const hit = written.find((w) => readSees(read, w));
        if (!hit) continue;
        found.push({
          stepId: b.id ?? '?', needs: a.id ?? '?',
          why: `it reads ${read}, which "${a.id ?? '?'}" changes, and both would be carried out at once`,
        });
      }
    }
  }

  /* Writing the same FIELD twice is deliberately not a dependence.
     "Move STC143580 to Bredbury and STC143581 to Carrington" writes the
     depot twice and is two independent changes, which is exactly the
     kind of plan this is meant to carry out in one go. Writing the same
     ROW twice is the problem, and that cannot be known from the plan:
     `overlappingRows` answers it once both steps have resolved. */

  return found;
}

/**
 * Two steps changing the same row.
 *
 * Found from the resolved rows rather than from the plan, because two
 * updates over the same entity with different conditions usually touch
 * different rows and are perfectly independent. It is only when the
 * conditions actually overlap that one row would receive two changes in
 * one call, and nothing says which of them wins.
 */
export function overlappingRows(
  units: { stepId: string; changes: { table: string; id?: string }[] }[],
): Dependence | null {
  const seen = new Map<string, string>();
  for (const u of units) {
    for (const c of u.changes) {
      /* A row being created has no id yet and cannot collide with
         anything: nothing else in the plan can be touching a row that
         does not exist. */
      if (!c.id) continue;
      const key = `${c.table}:${c.id}`;
      const first = seen.get(key);
      if (first && first !== u.stepId) {
        return {
          stepId: u.stepId, needs: first,
          why: 'both change the same record, and which change would win is not decided by the sentence',
        };
      }
      seen.set(key, u.stepId);
    }
  }
  return null;
}
