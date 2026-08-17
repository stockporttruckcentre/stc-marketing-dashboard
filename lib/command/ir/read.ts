/* =============================================================
   Running a canonical Select.

   The read executor in `app/api/command/query/route.ts` answers a
   question on screen: it counts, groups, works out a derived attribute
   and hands back something to render. This does one narrower thing and
   does it for anything: given a `Select`, produce the ROWS it describes,
   through the same `Store` a mutation resolves through.

   That is what a file needs. An export is not a second kind of question
   and must never be a second reading of one: the file has to hold
   exactly the rows the selection described, so it is built from the
   selection rather than from a copy of the sentence.

   WHAT IT PROJECTS, AND WHY THAT IS NOT A LIST SOMEBODY MAINTAINS.

   Every column comes from the registry and from the plan:

     the entity's title            what the row is called
     the entity's subtitle columns what it is, at a glance
     every column the SELECTION mentions   so the thing you asked about
                                           is visible in the answer
     every column the ORDER mentions       same reason
     the entity's own amounts and dates    the figures people export for

   Nothing is written down per entity, so an entity added to the
   registry exports without anybody touching this file, and a column
   that stops existing stops being exported.
   ============================================================= */
import type { Cond, Expr, Select } from './types';
import { entity as entityDef, type FieldDef } from './registry';
import type { Store } from './store';

export type ReadRows = {
  entity: string;
  /** Column keys, in the order they should be shown. */
  columns: string[];
  /** Human labels for those columns, from the registry. */
  labels: string[];
  rows: Record<string, unknown>[];
  /** True when the ceiling stopped this short of everything. */
  capped: boolean;
};

export type ReadFailure = { ok: false; why: string };
export type ReadResult = ({ ok: true } & ReadRows) | ReadFailure;

/* -------------------------------------------------------------
   Which columns
   ------------------------------------------------------------- */

/** Every plain field a condition names. */
function fieldsInCond(c: Cond, out: Set<string>): void {
  const expr = (e: Expr): void => {
    switch (e.kind) {
      case 'field': if (!('via' in e.of)) out.add(e.of.field); return;
      case 'binary': expr(e.left); expr(e.right); return;
      case 'shift': expr(e.of); return;
      case 'duration': expr(e.from); expr(e.to); return;
      case 'agg': if (e.of) expr(e.of); if (e.where) fieldsInCond(e.where, out); return;
      case 'window': expr(e.of); return;
      case 'case': e.when.forEach((w) => { fieldsInCond(w.if, out); expr(w.then); }); return;
      case 'reference': fieldsInCond(e.where, out); return;
      default: return;
    }
  };
  switch (c.kind) {
    case 'and': case 'or': c.of.forEach((x) => fieldsInCond(x, out)); return;
    case 'not': fieldsInCond(c.of, out); return;
    case 'cmp': expr(c.left); expr(c.right); return;
    case 'between': expr(c.of); expr(c.from); expr(c.to); return;
    case 'in': expr(c.of); if (Array.isArray(c.values)) c.values.forEach(expr); return;
    case 'empty': case 'within': expr(c.of); return;
    case 'near': expr(c.of); expr(c.origin); return;
    case 'related': if (c.where) fieldsInCond(c.where, out); return;
    default: return;
  }
}

/**
 * The columns a file should carry for this selection.
 *
 * Derived, never listed. See the header for the five sources and why
 * each one is there.
 */
export function projectionFor(select: Select): { columns: string[]; labels: string[] } | null {
  const id = 'entity' in select.from ? (select.from as { entity: string }).entity : null;
  const def = id ? entityDef(id) : null;
  if (!def) return null;

  const known = new Map<string, FieldDef>(def.fields.map((f) => [f.field, f]));
  const wanted = new Set<string>();

  if (def.titleField) wanted.add(def.titleField);
  for (const f of def.subtitleFields) wanted.add(f);

  if (select.where) fieldsInCond(select.where, wanted);
  for (const o of select.shape?.orderBy ?? []) {
    if (o.by.kind === 'field' && !('via' in o.by.of)) wanted.add(o.by.of.field);
  }
  for (const c of select.select ?? []) {
    if (c.expr.kind === 'field' && !('via' in c.expr.of)) wanted.add(c.expr.of.field);
  }

  for (const f of def.fields) {
    if (f.role === 'system') continue;
    if (f.aggregatable || f.kind === 'date') wanted.add(f.field);
  }

  /* Registry order, so two exports of the same entity look the same. */
  const columns = def.fields
    .map((f) => f.field)
    .filter((f) => wanted.has(f) && known.get(f)?.role !== 'system');

  return {
    columns,
    labels: columns.map((c) => known.get(c)?.label ?? c),
  };
}

/* -------------------------------------------------------------
   Running it
   ------------------------------------------------------------- */

export type RunSelectOptions = {
  store: Store;
  /**
   * The most rows to read.
   *
   * No default. A ceiling invented here would become the size of every
   * export by accident, which is exactly how "the first thousand" comes
   * to be reported as "all of them".
   */
  cap: number;
};

export async function runSelect(select: Select, opts: RunSelectOptions): Promise<ReadResult> {
  const id = 'entity' in select.from ? (select.from as { entity: string }).entity : null;
  const def = id ? entityDef(id) : null;
  if (!def) return { ok: false, why: `nothing here holds ${String(id)}` };

  const projection = projectionFor(select);
  if (!projection) return { ok: false, why: `nothing here holds ${def.id}` };

  const orderBy = (select.shape?.orderBy ?? [])
    .map((o) => (o.by.kind === 'field' && !('via' in o.by.of)
      ? { column: o.by.of.field, direction: o.direction }
      : null))
    .filter((x): x is { column: string; direction: 'asc' | 'desc' } => x !== null);

  /* A limit the sentence asked for is part of the answer: "the five
     cheapest" is five. The cap is a different thing, and the smaller of
     the two wins so neither can be quietly ignored. */
  const asked = select.shape?.limit;
  const want = asked != null ? Math.min(asked, opts.cap) : opts.cap;

  const read = await opts.store.read({
    table: def.table,
    columns: [...new Set(['id', ...projection.columns])],
    where: select.where ?? { kind: 'and', of: [] },
    orderBy,
    /* One more than wanted, so reaching the ceiling can be reported
       rather than looking like the end of the data. */
    limit: want + 1,
  });

  if (!read.ok) {
    return {
      ok: false,
      why: read.reason === 'unsupported'
        ? `this selection needs ${read.why}` : read.why,
    };
  }

  const capped = read.rows.length > want;
  return {
    ok: true,
    entity: def.id,
    columns: projection.columns,
    labels: projection.labels,
    rows: read.rows.slice(0, want),
    capped,
  };
}
