/* =============================================================
   A fake that behaves like the query builder, and remembers.

   Shared by the mutation harness and the acceptance harness, so the two
   are asserting against the same thing. A second copy would drift, and
   the copy that drifted would be the one holding the assertions nobody
   had looked at recently.

   It is a fake PostgREST, not a fake Postgres. What it proves is that
   the executor sends one call whose failure leaves nothing behind, and
   that the condition the plan carries narrows to the rows it should.
   Whether the SQL works is a different question, answered against a real
   server by `scripts/sql/validate-007.sql`.
   ============================================================= */
import { writableColumns } from '../generate-writable-columns';


/* =============================================================
   A fake that behaves like the query builder, and remembers
   ============================================================= */

export type Row = Record<string, unknown>;

type Op =
  | { kind: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte'; column: string; value: unknown }
  | { kind: 'ilike'; column: string; pattern: string }
  | { kind: 'or'; clauses: string[] }
  | { kind: 'in'; column: string; values: unknown[] };

function matches(row: Row, op: Op): boolean {
  const like = (v: unknown, pattern: string) => {
    const body = pattern.replace(/^%|%$/g, '').toLowerCase();
    const s = String(v ?? '').toLowerCase();
    if (pattern.startsWith('%') && pattern.endsWith('%')) return s.includes(body);
    if (pattern.endsWith('%')) return s.startsWith(body);
    return s === body;
  };
  switch (op.kind) {
    case 'eq': return String(row[op.column] ?? '') === String(op.value);
    case 'neq': return String(row[op.column] ?? '') !== String(op.value);
    case 'gt': return Number(row[op.column]) > Number(op.value);
    case 'gte': return Number(row[op.column]) >= Number(op.value);
    case 'lt': return Number(row[op.column]) < Number(op.value);
    case 'lte': return Number(row[op.column]) <= Number(op.value);
    case 'ilike': return like(row[op.column], op.pattern);
    case 'in': return op.values.map(String).includes(String(row.id));
    case 'or':
      /* `col.ilike.%x%`, `col.eq.x` and `col.is.null`, which is what the
         resolver emits and nothing more. */
      return op.clauses.some((clause) => {
        const [column, verb, ...rest] = clause.split('.');
        const value = rest.join('.');
        if (verb === 'ilike') return like(row[column], value);
        if (verb === 'eq') return String(row[column] ?? '') === value;
        if (verb === 'is' && value === 'null') return row[column] == null;
        return false;
      });
  }
}

export type Recorded = { table: string; set: Row; ids: string[] };

/** The same allowlist the database holds, from the same registry. */
const ALLOWED = new Set(writableColumns().map((c) => `${c.table}.${c.column}`));

export function fakeDb(tables: Record<string, Row[]>) {
  const writes: Recorded[] = [];
  let failOn: ((c: { table: string; id: string }) => boolean) | null = null;

  const builder = (table: string, ops: Op[], columns: string[] | null, update: Row | null): any => {
    const self: any = {
      select: (cols: string) =>
        builder(table, ops, cols.split(',').map((c) => c.trim()), update),
      eq: (column: string, value: unknown) => builder(table, [...ops, { kind: 'eq', column, value }], columns, update),
      neq: (column: string, value: unknown) => builder(table, [...ops, { kind: 'neq', column, value }], columns, update),
      gt: (column: string, value: unknown) => builder(table, [...ops, { kind: 'gt', column, value }], columns, update),
      gte: (column: string, value: unknown) => builder(table, [...ops, { kind: 'gte', column, value }], columns, update),
      lt: (column: string, value: unknown) => builder(table, [...ops, { kind: 'lt', column, value }], columns, update),
      lte: (column: string, value: unknown) => builder(table, [...ops, { kind: 'lte', column, value }], columns, update),
      ilike: (column: string, pattern: string) => builder(table, [...ops, { kind: 'ilike', column, pattern }], columns, update),
      or: (expr: string) => builder(table, [...ops, { kind: 'or', clauses: expr.split(',') }], columns, update),
      in: (column: string, values: unknown[]) => builder(table, [...ops, { kind: 'in', column, values }], columns, update),
      update: (set: Row) => builder(table, ops, columns, set),
      limit: async (n: number) => {
        const rows = (tables[table] ?? []).filter((r) => ops.every((o) => matches(r, o)));
        const projected = columns
          ? rows.map((r) => Object.fromEntries(columns.map((c) => [c, r[c]])))
          : rows;
        return { data: projected.slice(0, n), error: null };
      },
      /* An update resolves when awaited, which is what the executor
         does. Everything it touched is recorded before it changes. */
      then: (resolve: (v: { data: Row[] | null; error: unknown }) => void) => {
        if (!update) {
          const rows = (tables[table] ?? []).filter((r) => ops.every((o) => matches(r, o)));
          resolve({ data: rows, error: null });
          return;
        }
        const hit = (tables[table] ?? []).filter((r) => ops.every((o) => matches(r, o)));
        writes.push({ table, set: { ...update }, ids: hit.map((r) => String(r.id)) });
        for (const r of hit) Object.assign(r, update);
        resolve({ data: hit, error: null });
      },
      single: async () => {
        const rows = (tables[table] ?? []).filter((r) => ops.every((o) => matches(r, o)));
        return rows.length === 1
          ? { data: rows[0], error: null }
          : { data: null, error: { message: 'not exactly one row' } };
      },
    };
    return self;
  };

  /* The transaction, as the database provides it.
     Every change is validated against the same allowlist the SQL
     function checks, and one bad change raises before ANY row is
     touched. That is the property being tested: not that the fake is
     Postgres, but that the executor sends one call whose failure leaves
     nothing behind. */
  const rpc = async (name: string, args: Record<string, unknown>) => {
    if (name !== 'command_apply') return { data: null, error: { message: `no function ${name}` } };
    const changes = (args.p_changes ?? []) as { table: string; id: string; set: Row }[];

    for (const c of changes) {
      if (!c.table || !c.id || !c.set || !Object.keys(c.set).length) {
        return { data: null, error: { message: 'a change must name a table, an id and the columns to set' } };
      }
      for (const col of Object.keys(c.set)) {
        if (!ALLOWED.has(`${c.table}.${col}`)) {
          return { data: null, error: { message: `the command bar may not write ${c.table}.${col}` } };
        }
      }
      if (!(tables[c.table] ?? []).some((r) => String(r.id) === c.id)) {
        return { data: null, error: { message: `no row ${c.id} in ${c.table}` } };
      }
      if (failOn && failOn(c)) {
        /* Raised mid statement. Nothing before it may survive. */
        return { data: null, error: { message: `refused ${c.table}.${c.id}` } };
      }
    }

    let touched = 0;
    for (const c of changes) {
      const row = (tables[c.table] ?? []).find((r) => String(r.id) === c.id);
      if (!row) continue;
      writes.push({ table: c.table, set: { ...c.set }, ids: [c.id] });
      Object.assign(row, c.set);
      touched += 1;
    }
    return { data: touched, error: null };
  };

  return {
    supabase: { from: (table: string) => builder(table, [], null, null), rpc },
    writes,
    tables,
    /** Make one change fail, to prove the others do not land. */
    refuse: (predicate: (c: { table: string; id: string }) => boolean) => { failOn = predicate; },
  };
}
