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
     derived     -> its own select column, alongside any aggregate
     filters     -> Select.where, one Cond per filter, and the tree
     groupBy     -> Shape.groupBy
     range       -> a `within` Cond on rangeColumn
     rangeColumn -> which field the within applies to
     scope       -> Select.scope
     order       -> Shape.orderBy
     limit       -> Shape.limit
     compare     -> Shape.compare
     unmet       -> Plan.unmet

   `summary` and `confidence` are deliberately NOT carried. They are
   presentation and scoring, not meaning, and the equivalence check
   knows to ignore them.
   ============================================================= */
import type { QueryPlan } from '../query';
import { condFor, fieldExpr, literal } from './conditions';
import type {
  Select, Cond, Expr, Period, Scope, Shape, Plan, Unmet,
} from './types';

/* -------------------------------------------------------------
   Filters
   ------------------------------------------------------------- */

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

/**
 * The derived attribute, as the expression its name stood for.
 *
 * Four named ids with a `how` in the old shape. Here `stock age` is the
 * subtraction it always was, which is why nothing has to be added when
 * somebody asks for a fifth.
 */
function derivedExpr(p: QueryPlan): Expr | null {
  if (!p.derived) return null;
  const entityId = p.entity.id;
  const from = fieldExpr(entityId, p.derived.from);
  const now: Expr = { kind: 'context', slot: 'now' };
  if (p.derived.how === 'days until') return { kind: 'duration', from: now, to: from, unit: 'day' };
  if (p.derived.how === 'days since') return { kind: 'duration', from, to: now, unit: 'day' };
  return { kind: 'binary', op: '/', left: from, right: fieldExpr(entityId, 'sales_price') };
}

/**
 * What the select clause holds.
 *
 * A list, because counting rows and working out an attribute of them
 * are two separate things a sentence can ask for at once. "How many
 * trailers have been sat here over 60 days" carries both, and returning
 * only the count dropped the attribute entirely: the plan came out
 * saying `count(*)` with no trace that stock age had been read.
 */
function selectColumns(p: QueryPlan): { as: string; expr: Expr }[] {
  const entityId = p.entity.id;
  const derived = derivedExpr(p);
  const aggregating = p.measure === 'sum' || p.measure === 'avg';
  const fn = p.measure === 'avg' ? 'avg' : 'sum';
  const out: { as: string; expr: Expr }[] = [];
  let amountCarried = false;

  if (p.measure === 'count') out.push({ as: 'count', expr: { kind: 'agg', fn: 'count' } });

  if (derived && p.derived) {
    out.push({
      as: p.derived.id,
      expr: aggregating ? { kind: 'agg', fn, of: derived } : derived,
    });
  } else if (aggregating && p.amountColumn) {
    out.push({
      as: p.amountColumn,
      expr: { kind: 'agg', fn, of: fieldExpr(entityId, p.amountColumn) },
    });
    amountCarried = true;
  }

  /* The amount column is not only what an aggregate sums. "Trailers at
     Carrington with no retail price" is a list, and retail price is
     still the column the question is about. Dropping it because nothing
     was being added up lost which number the answer should show, and it
     took an exact comparison to notice: every earlier assertion was
     about aggregates and simply never looked. */
  if (p.amountColumn && !amountCarried) {
    out.push({ as: p.amountColumn, expr: fieldExpr(entityId, p.amountColumn) });
  }

  return out;
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

  const columns = selectColumns(p);

  if ((p.measure === 'sum' || p.measure === 'avg') && !p.derived && !p.amountColumn) {
    lost.push({ part: 'measure', why: `${p.measure} was asked for with no column to measure` });
  }

  /* One number, several keyed numbers, or the rows themselves. A
     grouped count is not a scalar: "how many by depot" has one answer
     per depot, and calling that a scalar let it be consumed anywhere a
     single figure was wanted. */
  const aggregated = columns.some((c) => c.expr.kind === 'agg');
  const grouped = !!p.groupBy || !!p.compare;
  const produces = aggregated
    ? (grouped ? { kind: 'series' as const, entity: entityId } : { kind: 'scalar' as const })
    : { kind: 'rows' as const, entity: entityId };

  const select: Select = {
    op: 'select',
    id: 's1',
    from: { entity: entityId },
    ...(where ? { where } : {}),
    ...(scope ? { scope } : {}),
    ...(columns.length ? { select: columns } : {}),
    ...(Object.keys(shape).length ? { shape } : {}),
    produces,
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
