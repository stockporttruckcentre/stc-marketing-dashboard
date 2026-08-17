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
  | { kind: 'in'; column: string; values: unknown[] }
  | { kind: 'order'; column: string; ascending: boolean };

/** Numbers as numbers, dates as dates, anything else as text. */
function compare(left: unknown, right: unknown): number {
  if (left == null) return -1;
  const ln = Number(left), rn = Number(right);
  if (Number.isFinite(ln) && Number.isFinite(rn)) return ln - rn;
  const ld = Date.parse(String(left)), rd = Date.parse(String(right));
  if (Number.isFinite(ld) && Number.isFinite(rd)) return ld - rd;
  return String(left).localeCompare(String(right));
}

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
    /* Dates compare as dates. Comparing them as numbers gives NaN on
       both sides, and `NaN >= NaN` is false, so every period filter
       matched nothing and an export of "sold in the last six months"
       came back empty while looking like it had worked. */
    case 'gt': return compare(row[op.column], op.value) > 0;
    case 'gte': return compare(row[op.column], op.value) >= 0;
    case 'lt': return compare(row[op.column], op.value) < 0;
    case 'lte': return compare(row[op.column], op.value) <= 0;
    case 'ilike': return like(row[op.column], op.pattern);
    /* On whichever column was named. This read `row.id` whatever column
       the query asked for, which is right for a write by primary key
       and wrong for everything else: an operation looking up deals by
       `stock_trailer_id` matched nothing. */
    case 'in': return op.values.map(String).includes(String(row[op.column]));
    /* Ordering narrows nothing. It is applied when the rows come back. */
    case 'order': return true;
    case 'or':
      /* The same nested filter grammar PostgREST accepts: a flat
         comparison, or `and(...)` and `or(...)` around more of them.
         The flat version was all this understood, so a period over a
         sale date, which is an `or` containing an `and`, matched
         nothing here while working against the real thing. */
      return op.clauses.some((clause) => filterMatches(row, clause));
  }
}

export type Recorded = { table: string; set: Row; ids: string[] };

/** The same allowlist the database holds, from the same registry. */
const ALLOWED = new Set(writableColumns().map((c) => `${c.table}.${c.column}`));

/** Split on commas that are not inside brackets. */
function topLevelParts(body: string): string[] {
  const out: string[] = [];
  let depth = 0, current = '';
  for (const ch of body) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) { out.push(current); current = ''; continue; }
    current += ch;
  }
  if (current) out.push(current);
  return out;
}

/** One PostgREST filter expression, against one row. */
function filterMatches(row: Row, clause: string): boolean {
  const trimmed = clause.trim();

  const group = /^(and|or|not)\((.*)\)$/s.exec(trimmed);
  if (group) {
    const parts = topLevelParts(group[2]);
    if (group[1] === 'and') return parts.every((p) => filterMatches(row, p));
    if (group[1] === 'or') return parts.some((p) => filterMatches(row, p));
    return !parts.every((p) => filterMatches(row, p));
  }

  /* A negated tree: `not.and(...)`, `not.or(...)`. */
  if (/^not\./.test(trimmed)) return !filterMatches(row, trimmed.slice(4));

  const [column, verb, ...rest] = trimmed.split('.');

  /* A negated column condition: `status.not.eq.proposal`. PostgREST puts
     the `not` after the column here and before the tree above, and a
     fake that only understood one of the two would pass a read the real
     thing refuses. */
  if (verb === 'not') return !filterMatches(row, `${column}.${rest.join('.')}`);

  const value = rest.join('.');
  const left = row[column];

  switch (verb) {
    case 'eq': return String(left ?? '') === value;
    case 'neq': return String(left ?? '') !== value;
    case 'is': return value === 'null' ? left == null : String(left) === value;
    case 'ilike': {
      const body = value.replace(/^\*|\*$/g, '').toLowerCase();
      const s = String(left ?? '').toLowerCase();
      if (value.startsWith('*') && value.endsWith('*')) return s.includes(body);
      if (value.endsWith('*')) return s.startsWith(body);
      return s === body;
    }
    case 'gt': return compare(left, value) > 0;
    case 'gte': return compare(left, value) >= 0;
    case 'lt': return compare(left, value) < 0;
    case 'lte': return compare(left, value) <= 0;
    default: return false;
  }
}

/** Matching rows, in whatever order the query asked for. */
function sortedRows(table: string, ops: Op[], tables: Record<string, Row[]>): Row[] {
  const rows = (tables[table] ?? []).filter((r) => ops.every((o) => matches(r, o)));
  for (const o of ops) {
    if (o.kind !== 'order') continue;
    rows.sort((a, b) => {
      const x = a[o.column], y = b[o.column];
      const c = x == null ? 1 : y == null ? -1
        : typeof x === 'number' && typeof y === 'number' ? x - y
          : String(x).localeCompare(String(y));
      return o.ascending ? c : -c;
    });
  }
  return rows;
}

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
      /* Split on the commas BETWEEN branches, not on the ones inside
         them. A plain split turned `and(a,b),and(c,d)` into four broken
         fragments, and a row matched whichever fragment happened to
         parse. */
      or: (expr: string) => builder(table, [...ops, { kind: 'or', clauses: topLevelParts(expr) }], columns, update),
      in: (column: string, values: unknown[]) => builder(table, [...ops, { kind: 'in', column, values }], columns, update),
      order: (column: string, o?: { ascending?: boolean }) =>
        builder(table, [...ops, { kind: 'order', column, ascending: o?.ascending !== false }], columns, update),
      update: (set: Row) => builder(table, ops, columns, set),
      range: async (from: number, to: number) => {
        const all = sortedRows(table, ops, tables);
        const projected = columns
          ? all.map((r) => Object.fromEntries(columns.map((c) => [c, r[c]])))
          : all;
        return { data: projected.slice(from, to + 1), error: null };
      },
      limit: async (n: number) => {
        const rows = sortedRows(table, ops, tables);
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
    /* The sale, as the database performs it.
       Three writes that have to happen together: the tracker row, the
       stock unit, and every other rep chasing the same unit. Modelled
       here rather than skipped, because a fake that cannot perform an
       operation cannot show that the operation reached it. */
    if (name === 'command_mark_sold_many') {
      const ids = (args.p_tracker_ids ?? []) as string[];
      const price = args.p_sale_price as number | null;
      const rep = String(args.p_rep_initials ?? 'Unknown');
      const results: Row[] = [];

      for (const id of ids) {
        const deal = (tables.crm_contacts ?? []).find((r) => String(r.id) === id);
        if (!deal) return { data: null, error: { message: `that deal is not there` } };

        const salePrice = price ?? (deal.sale_price as number | null);
        const rate = (deal.commission_rate as number | null) ?? 0.1;
        const profit = deal.profit as number | null;
        const commission = profit == null ? null : Math.round(profit * rate * 100) / 100;

        writes.push({ table: 'crm_contacts', set: { status: 'customer' }, ids: [id] });
        Object.assign(deal, {
          status: 'customer', sale_price: salePrice, commission,
        });

        let stockUpdated = false;
        let cascaded = 0;
        const unitId = deal.stock_trailer_id as string | null;
        if (unitId) {
          const unit = (tables.stock_trailers ?? []).find((r) => String(r.id) === unitId);
          if (!unit) return { data: null, error: { message: 'the stock unit could not be updated' } };
          writes.push({ table: 'stock_trailers', set: { status: 'sold' }, ids: [unitId] });
          Object.assign(unit, {
            status: 'sold', customer: deal.company_name, sales_rep: rep, sales_price: salePrice,
          });
          stockUpdated = true;

          for (const other of tables.crm_contacts ?? []) {
            if (String(other.id) === id) continue;
            if (String(other.stock_trailer_id) !== unitId) continue;
            if (other.status === 'customer') continue;
            other.status = 'customer';
            cascaded += 1;
          }
        }
        results.push({ trackerId: id, commission, stockUpdated, cascadedOthers: cascaded });
      }
      return { data: results, error: null };
    }

    /* Two writes where the second needs the first, in order, in one
       transaction: the list, then the memberships. */
    if (name === 'command_create_list') {
      const listName = String(args.p_name ?? '').trim();
      const ids = (args.p_ids ?? []) as string[];
      if (!listName) return { data: null, error: { message: 'a list needs a name' } };
      if (!ids.length) return { data: null, error: { message: 'a list needs something in it' } };

      const listId = `list${((tables.crm_lists ?? []).length) + 1}`;
      const targets = (tables.crm_contacts ?? []).filter((r) => ids.includes(String(r.id)));
      if (targets.length !== ids.length) {
        return {
          data: null,
          error: { message: `expected to put ${ids.length} records in the list but moved ${targets.length}` },
        };
      }

      (tables.crm_lists ??= []).push({ id: listId, name: listName, is_global: false });
      for (const row of targets) row.list_id = listId;
      writes.push({ table: 'crm_lists', set: { name: listName }, ids: [listId] });
      writes.push({ table: 'crm_contacts', set: { list_id: listId }, ids: ids.map(String) });

      return { data: { listId, name: listName, moved: targets.length }, error: null };
    }

    /* Granting colleagues access, which in this CRM is list membership.
       Modelled here for the same reason the sale is: a fake that cannot
       perform an operation cannot show that the operation reached it. */
    if (name === 'command_share_list') {
      const listId = args.p_list == null ? '' : String(args.p_list);
      const users = (args.p_users ?? []) as string[];
      if (!listId) return { data: null, error: { message: 'nothing said which list to share' } };
      if (!users.length) return { data: null, error: { message: 'nothing said who to share it with' } };

      const list = (tables.crm_lists ?? []).find((r) => String(r.id) === listId);
      if (!list) return { data: null, error: { message: 'that list is not there' } };
      if (list.is_global === true) {
        return {
          data: null,
          error: { message: 'that is the global list, which the whole team can already see' },
        };
      }

      const present = (tables.profiles ?? []).filter((r) => users.includes(String(r.id)));
      if (present.length !== users.length) {
        return {
          data: null,
          error: {
            message: `expected to share with ${users.length} people but only ${present.length} of them are here`,
          },
        };
      }

      const members = (tables.crm_list_members ??= []);
      let granted = 0;
      for (const u of users) {
        if (members.some((m) => String(m.list_id) === listId && String(m.user_id) === u)) continue;
        members.push({ list_id: listId, user_id: u, can_edit: args.p_can_edit !== false });
        granted += 1;
      }
      writes.push({ table: 'crm_list_members', set: { list_id: listId }, ids: users });

      return {
        data: { listId, asked: users.length, granted, alreadyHad: users.length - granted },
        error: null,
      };
    }

    if (name !== 'command_apply') return { data: null, error: { message: `no function ${name}` } };
    const changes = (args.p_changes ?? []) as
      { op?: 'update' | 'insert' | 'delete'; table: string; id?: string; set?: Row }[];

    for (const c of changes) {
      const op = c.op ?? 'update';
      if (!c.table) return { data: null, error: { message: 'a change must name a table' } };
      if (op !== 'delete' && (!c.set || !Object.keys(c.set).length)) {
        return { data: null, error: { message: `a ${op} of ${c.table} must say what to set` } };
      }
      if (op !== 'insert' && !c.id) {
        return { data: null, error: { message: `a ${op} of ${c.table} must name a row` } };
      }
      for (const col of Object.keys(c.set ?? {})) {
        if (!ALLOWED.has(`${c.table}.${col}`)) {
          return { data: null, error: { message: `the command bar may not write ${c.table}.${col}` } };
        }
      }
      if (op !== 'insert' && !(tables[c.table] ?? []).some((r) => String(r.id) === c.id)) {
        return { data: null, error: { message: `no row ${c.id} in ${c.table}` } };
      }
      if (failOn && failOn({ table: c.table, id: String(c.id ?? '') })) {
        /* Raised mid statement. Nothing before it may survive. */
        return { data: null, error: { message: `refused ${c.table}.${c.id}` } };
      }
    }

    let touched = 0;
    for (const c of changes) {
      if (c.op === 'insert') {
        const id = `new${(tables[c.table] ?? []).length + 1}`;
        const row = { id, ...(c.set ?? {}) };
        (tables[c.table] ??= []).push(row);
        writes.push({ table: c.table, set: { ...(c.set ?? {}) }, ids: [id] });
        touched += 1;
        continue;
      }
      if (c.op === 'delete') {
        const rows = tables[c.table] ?? [];
        const at = rows.findIndex((r) => String(r.id) === c.id);
        if (at < 0) continue;
        rows.splice(at, 1);
        writes.push({ table: c.table, set: {}, ids: [String(c.id)] });
        touched += 1;
        continue;
      }
      const row = (tables[c.table] ?? []).find((r) => String(r.id) === c.id);
      if (!row) continue;
      writes.push({ table: c.table, set: { ...c.set }, ids: [String(c.id)] });
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
