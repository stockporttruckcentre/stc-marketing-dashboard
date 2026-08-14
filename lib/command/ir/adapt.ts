/* =============================================================
   The existing QueryPlan, expressed as canonical IR.

   This is an ADAPTER, not a rewrite. `parseQuery` is untouched and
   still produces exactly what it produced before. This reads its output
   and expresses the same meaning in the canonical types, so the two can
   be compared and proven equivalent before any reader changes.

   That order matters. Migrating readers first would mean changing the
   parser and the representation at once, with no way to tell which one
   caused a difference. Landing the adapter first means the only
   question is whether the shape survives the crossing, and any answer
   other than "entirely" is a bug in this file.

   Losslessness is the whole contract. Every field of QueryPlan has to
   come out the other side or be recorded as unmet:

     entity      -> Select.from
     measure     -> Select.select, an agg expression
     amountColumn-> the agg's argument
     filters     -> Select.where, one Cond per filter, and the tree
     groupBy     -> Shape.groupBy
     range       -> a `within` Cond on rangeColumn
     rangeColumn -> which field the within applies to
     scope       -> Select.scope
     order       -> Shape.orderBy
     limit       -> Shape.limit
     derived     -> a duration expression
     compare     -> Shape.compare
     unmet       -> Plan.unmet

   `summary` and `confidence` are deliberately NOT carried. They are
   presentation and scoring, not meaning, and the equivalence check
   knows to ignore them.
   ============================================================= */
import type { QueryPlan, PlanFilter } from '../query';
import type {
  Select, Cond, Expr, Period, Scope, Shape, Plan, Unmet,
} from './types';

/* -------------------------------------------------------------
   Filters
   ------------------------------------------------------------- */

function fieldExpr(entity: string, field: string): Expr {
  return { kind: 'field', of: { entity, field } };
}

function literal(v: string | number): Expr {
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
function condFor(entityId: string, f: PlanFilter): Cond {
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

/* -------------------------------------------------------------
   Period
   ------------------------------------------------------------- */

/**
 * The old range is an absolute pair with a label. The label carried the
 * relative meaning, and the pair carried the resolved dates. Absolute
 * is the honest translation: the relative form was already lost by the
 * time `parseQuery` returned, so inventing it back here would be
 * guessing.
 */
function periodFor(range: NonNullable<QueryPlan['range']>): Period {
  return { kind: 'absolute', from: range.from, to: range.to };
}

/* -------------------------------------------------------------
   Measure
   ------------------------------------------------------------- */

function measureExpr(p: QueryPlan): { as: string; expr: Expr } | null {
  const entityId = p.entity.id;

  /* A derived attribute is a subtraction from a date. In the old shape
     it was one of four named ids with a `how`; here it is the
     expression that name stood for. */
  if (p.derived) {
    const from = fieldExpr(entityId, p.derived.from);
    const now: Expr = { kind: 'context', slot: 'now' };
    const expr: Expr = p.derived.how === 'days until'
      ? { kind: 'duration', from: now, to: from, unit: 'day' }
      : p.derived.how === 'days since'
        ? { kind: 'duration', from, to: now, unit: 'day' }
        : { kind: 'binary', op: '/', left: from, right: fieldExpr(entityId, 'sales_price') };

    if (p.measure === 'count') return { as: 'count', expr: { kind: 'agg', fn: 'count' } };
    if (p.measure === 'list') return { as: p.derived.id, expr };
    return {
      as: p.derived.id,
      expr: { kind: 'agg', fn: p.measure === 'avg' ? 'avg' : 'sum', of: expr },
    };
  }

  if (p.measure === 'count') return { as: 'count', expr: { kind: 'agg', fn: 'count' } };
  if (p.measure === 'list') return null;
  if (!p.amountColumn) return null;
  return {
    as: p.amountColumn,
    expr: {
      kind: 'agg',
      fn: p.measure === 'avg' ? 'avg' : 'sum',
      of: fieldExpr(entityId, p.amountColumn),
    },
  };
}

/* -------------------------------------------------------------
   The adapter
   ------------------------------------------------------------- */

export type Adapted = {
  select: Select;
  plan: Plan;
  /** Anything the old shape carried that this could not express. */
  lost: Unmet[];
};

export function adaptQueryPlan(p: QueryPlan): Adapted {
  const entityId = p.entity.id;
  const lost: Unmet[] = [];
  const conds: Cond[] = [];

  for (const f of p.filters) conds.push(condFor(entityId, f));

  /* The period becomes a condition on whichever date the plan said,
     which is what `rangeColumn` already recorded. */
  if (p.range) {
    const column = p.rangeColumn ?? p.entity.dateColumn;
    if (column) {
      conds.push({
        kind: 'within',
        of: fieldExpr(entityId, column),
        period: periodFor(p.range),
      });
    } else {
      lost.push({ part: 'range', why: 'a period was read but no date column was named' });
    }
  }

  const where: Cond | undefined =
    conds.length === 0 ? undefined : conds.length === 1 ? conds[0] : { kind: 'and', of: conds };

  const scope: Scope | undefined =
    p.scope === 'mine' ? { kind: 'actor' } : p.scope === 'all' ? { kind: 'all' } : undefined;

  const shape: Shape = {};
  if (p.groupBy) shape.groupBy = [fieldExpr(entityId, p.groupBy.column)];
  if (p.order) {
    shape.orderBy = [{ by: fieldExpr(entityId, p.order.column), direction: p.order.direction }];
  }
  if (p.limit != null) shape.limit = p.limit;
  if (p.compare) {
    shape.compare = {
      by: fieldExpr(entityId, p.compare.column),
      values: p.compare.values.map((v) => literal(v)),
    };
  }

  const measure = measureExpr(p);

  const select: Select = {
    op: 'select',
    id: 's1',
    from: { entity: entityId },
    ...(where ? { where } : {}),
    ...(scope ? { scope } : {}),
    ...(measure ? { select: [measure] } : {}),
    ...(Object.keys(shape).length ? { shape } : {}),
    produces: p.measure === 'list' ? { kind: 'rows', entity: entityId } : { kind: 'scalar' },
  };

  return {
    select,
    plan: {
      steps: [select],
      unmet: [
        ...(p.unmet ?? []).map((u) => ({ part: 'reader', why: u })),
        ...lost,
      ],
    },
    lost,
  };
}
