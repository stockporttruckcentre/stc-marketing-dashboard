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
   ============================================================= */
import type { Cond, Expr, Mutate, Source, Step } from './types';
import { isResultRef } from './types';

export type Dependence = {
  /** The step that cannot go first. */
  stepId: string;
  /** The step it needs. */
  needs: string;
  why: string;
};

/* -------------------------------------------------------------
   Reading a step
   ------------------------------------------------------------- */

/** Every `ResultRef` anywhere in an expression. */
function refsInExpr(e: Expr, out: Set<string>): void {
  switch (e.kind) {
    case 'result': out.add(e.of.step); return;
    case 'binary': refsInExpr(e.left, out); refsInExpr(e.right, out); return;
    case 'shift': refsInExpr(e.of, out); return;
    case 'duration': refsInExpr(e.from, out); refsInExpr(e.to, out); return;
    case 'agg': if (e.of) refsInExpr(e.of, out); return;
    case 'window': refsInExpr(e.of, out); return;
    case 'case':
      e.when.forEach((w) => { condRefs(w.if, out); refsInExpr(w.then, out); });
      if (e.else) refsInExpr(e.else, out);
      return;
    case 'reference': condRefs(e.where, out); return;
    default: return;
  }
}

function condRefs(c: Cond, out: Set<string>): void {
  switch (c.kind) {
    case 'and':
    case 'or': c.of.forEach((x) => condRefs(x, out)); return;
    case 'not': condRefs(c.of, out); return;
    case 'cmp': refsInExpr(c.left, out); refsInExpr(c.right, out); return;
    case 'empty': refsInExpr(c.of, out); return;
    case 'within': refsInExpr(c.of, out); return;
    case 'in':
      refsInExpr(c.of, out);
      if (Array.isArray(c.values)) c.values.forEach((v) => refsInExpr(v, out));
      else if (isResultRef(c.values)) out.add(c.values.step);
      else sourceRefs(c.values, out);
      return;
    default: return;
  }
}

function sourceRefs(s: Source | undefined, out: Set<string>): void {
  if (!s) return;
  if (isResultRef(s)) { out.add(s.step); return; }
  if ('op' in s) {
    if (s.where) condRefs(s.where, out);
    if (s.from) sourceRefs(s.from, out);
    (s.select ?? []).forEach((c) => refsInExpr(c.expr, out));
  }
}

/** Every step whose result this one consumes. */
export function consumes(s: Step): string[] {
  const out = new Set<string>();
  switch (s.op) {
    case 'select':
      sourceRefs(s.from, out);
      if (s.where) condRefs(s.where, out);
      (s.select ?? []).forEach((c) => refsInExpr(c.expr, out));
      break;
    case 'create':
    case 'update':
    case 'delete':
      sourceRefs(s.match, out);
      (s.set ?? []).forEach((a) => refsInExpr(a.to, out));
      break;
    case 'invoke':
      sourceRefs(s.subject, out);
      for (const a of Object.values(s.args ?? {})) {
        if (isResultRef(a)) out.add(a.step);
        else refsInExpr(a, out);
      }
      break;
    case 'emit':
      sourceRefs(s.from, out);
      break;
  }
  return [...out];
}

/** Every `entity.field` this step writes. */
export function writesFields(s: Step): string[] {
  if (s.op !== 'update' && s.op !== 'create') return [];
  const m = s as Mutate;
  return (m.set ?? []).map((a) => `${a.field.entity}.${a.field.field}`);
}

function fieldsInExpr(e: Expr, out: Set<string>): void {
  switch (e.kind) {
    case 'field': if (!('via' in e.of)) out.add(`${e.of.entity}.${e.of.field}`); return;
    case 'binary': fieldsInExpr(e.left, out); fieldsInExpr(e.right, out); return;
    case 'shift': fieldsInExpr(e.of, out); return;
    case 'duration': fieldsInExpr(e.from, out); fieldsInExpr(e.to, out); return;
    case 'agg': if (e.of) fieldsInExpr(e.of, out); return;
    case 'window': fieldsInExpr(e.of, out); return;
    case 'case':
      e.when.forEach((w) => { condFields(w.if, out); fieldsInExpr(w.then, out); });
      if (e.else) fieldsInExpr(e.else, out);
      return;
    case 'reference': condFields(e.where, out); return;
    default: return;
  }
}

function condFields(c: Cond, out: Set<string>): void {
  switch (c.kind) {
    case 'and':
    case 'or': c.of.forEach((x) => condFields(x, out)); return;
    case 'not': condFields(c.of, out); return;
    case 'cmp': fieldsInExpr(c.left, out); fieldsInExpr(c.right, out); return;
    case 'empty': fieldsInExpr(c.of, out); return;
    case 'within': fieldsInExpr(c.of, out); return;
    case 'in':
      fieldsInExpr(c.of, out);
      if (Array.isArray(c.values)) c.values.forEach((v) => fieldsInExpr(v, out));
      return;
    default: return;
  }
}

/**
 * Every `entity.field` this step reads, to choose rows or to compute a
 * value.
 *
 * Both, because both go wrong in the same way. A step selecting on a
 * status another step is writing picks rows by a status that is about to
 * change, and a step computing from a price another step is writing
 * computes from a price that is about to change. Neither is a thing the
 * person typing meant.
 */
export function readsFields(s: Step): string[] {
  const out = new Set<string>();
  if (s.op === 'update' || s.op === 'delete' || s.op === 'create') {
    const m = s as Mutate;
    const match = m.match;
    if (match && !isResultRef(match) && 'op' in match && match.where) condFields(match.where, out);
    for (const a of m.set ?? []) {
      fieldsInExpr(a.to, out);
      /* Appending reads what is there before it adds a line. */
      if (a.mode === 'append') out.add(`${a.field.entity}.${a.field.field}`);
    }
  }
  if (s.op === 'select') {
    if (s.where) condFields(s.where, out);
    (s.select ?? []).forEach((c) => fieldsInExpr(c.expr, out));
  }
  return [...out];
}

/* -------------------------------------------------------------
   The check
   ------------------------------------------------------------- */

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
    const written = new Set(writesFields(a));
    if (!written.size) continue;
    for (const b of effects) {
      if (a === b) continue;
      for (const read of readsFields(b)) {
        if (!written.has(read)) continue;
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
  units: { stepId: string; changes: { table: string; id: string }[] }[],
): Dependence | null {
  const seen = new Map<string, string>();
  for (const u of units) {
    for (const c of u.changes) {
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
