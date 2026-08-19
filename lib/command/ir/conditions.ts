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
