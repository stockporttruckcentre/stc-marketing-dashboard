/* =============================================================
   One condition language, for questions and for instructions.

   "Every available curtainsider at Hyde" describes a set of rows, and
   it describes the same set whether somebody is counting them or moving
   them. There is no reason for a question and an instruction to read
   that phrase with different machinery, and every reason not to: while
   they were separate, `readBulkTarget` in `mutate.ts` could only narrow
   on one enum on the field being written, so a bulk instruction could
   say "all the outstanding ones" and could not say "at Hyde".

   So this is the one place a filter becomes a `Cond`. `adapt.ts` uses
   it for reads and `adapt-edit.ts` uses it for writes, and the reader
   underneath both is `parseQuery`.
   ============================================================= */
import type { PlanFilter } from '../query';
import type { Cond, Expr } from './types';

export function fieldExpr(entity: string, field: string): Expr {
  return { kind: 'field', of: { entity, field } };
}

export function literal(v: string | number): Expr {
  return { kind: 'literal', value: v };
}

/**
 * One PlanFilter as a condition.
 *
 * `anyOf` is the interesting one. It spreads a single idea across the
 * columns that actually carry it, which in the old shape was two
 * parallel arrays and here is an `or` of comparisons: the same meaning,
 * with the structure visible rather than implied by a convention the
 * executor had to know about.
 */
/* =============================================================
   A record named by its reference, matched however it is stored.

   Stock numbers are not written down consistently and never will be.
   One real yard holds

     STC148909        typed with the prefix
     145602           the same kind of number, without it
     DEMO-STC90121    seeded, and prefixed twice over

   Somebody types STC145602, the column holds 145602, and an exact or
   even a "contains STC145602" match finds nothing. The answer that came
   back was "nothing here matches that", so a unit that is sitting in
   the yard looked to everybody like a broken command bar.

   Matching on the digits fixes every one of those spellings at once,
   including prefixes nobody has thought of yet, because the digits are
   the part a person actually reads out. If two units share a digit run
   the runtime asks which, which is the right answer to a real
   ambiguity and is not the same as refusing.

   Only for values that ARE a reference. A company called "24 Seven
   Logistics" is a name, not a code, and is matched as written.
   ============================================================= */

/** A stock number, chassis number or supplier reference, however written. */
const LOOKS_LIKE_A_REFERENCE = /^[A-Za-z]{0,4}[-\s_]?\d{3,10}$/;

export function referenceMatch(entityId: string, column: string, value: string): Cond {
  const trimmed = String(value).trim();
  const digits = LOOKS_LIKE_A_REFERENCE.test(trimmed)
    ? (trimmed.match(/\d{3,10}/)?.[0] ?? null)
    : null;

  return {
    kind: 'cmp', op: 'contains',
    left: { kind: 'field', of: { entity: entityId, field: column } },
    right: { kind: 'literal', value: digits ?? trimmed },
  };
}

/** The same, over several named records, as one condition. */
export function referenceMatchAny(entityId: string, column: string, values: string[]): Cond | null {
  const each = values.map((v) => referenceMatch(entityId, column, v));
  if (!each.length) return null;
  return each.length === 1 ? each[0] : { kind: 'or', of: each };
}

export function condFor(entityId: string, f: PlanFilter): Cond {
  const target = fieldExpr(entityId, f.column);
  let base: Cond;

  switch (f.op) {
    case 'eq':
      base = { kind: 'cmp', op: 'eq', left: target, right: literal(f.value) };
      break;
    case 'ilike':
      base = { kind: 'cmp', op: 'contains', left: target, right: literal(f.value) };
      break;
    case 'gte':
      base = { kind: 'cmp', op: 'gte', left: target, right: literal(Number(f.value)) };
      break;
    case 'lte':
      base = { kind: 'cmp', op: 'lte', left: target, right: literal(Number(f.value)) };
      break;
    case 'empty':
      base = { kind: 'empty', of: target };
      break;
    case 'present':
      base = { kind: 'not', of: { kind: 'empty', of: target } };
      break;
    case 'anyOf': {
      const columns = f.columns?.length ? f.columns : [f.column];
      const values = f.values?.length ? f.values : [f.value];
      const branches: Cond[] = [];
      for (const c of columns) {
        for (const v of values) {
          branches.push({
            kind: 'cmp', op: 'contains',
            left: fieldExpr(entityId, c), right: literal(v),
          });
        }
      }
      base = branches.length === 1 ? branches[0] : { kind: 'or', of: branches };
      break;
    }
    default:
      base = { kind: 'cmp', op: 'eq', left: target, right: literal(f.value) };
  }

  /* Negation was a boolean on the filter. Here it is a node, which is
     what allows it to wrap a group rather than only a leaf. */
  return f.negate ? { kind: 'not', of: base } : base;
}

/**
 * A whole filter list as one condition.
 *
 * Conjunction, because every filter narrows the last. An empty list is
 * no condition at all rather than a condition matching everything,
 * which is the difference between "the ones at Hyde" and "all of them".
 */
export function condForFilters(entityId: string, filters: PlanFilter[]): Cond | null {
  const conds = filters.map((f) => condFor(entityId, f));
  if (!conds.length) return null;
  return conds.length === 1 ? conds[0] : { kind: 'and', of: conds };
}
