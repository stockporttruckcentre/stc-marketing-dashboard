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
import { capabilityRoles, entityPermissions, writableColumns } from '../generate-writable-columns';
import type { UserRole } from '../../lib/types';

/** The same grants the database is seeded with, from the same source. */
const CAPABILITY_ROLES = capabilityRoles();

/** What it takes to make one of a table's rows, or get rid of one. */
const LIFECYCLE = entityPermissions();


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
  /* Who the database thinks is calling. The real functions ask
     `command_may`, which reads the seeded capability table; here the
     same question is answered from the same source. */
  let role: UserRole = 'admin';
  const may = (capability: string) =>
    CAPABILITY_ROLES.some((r) => r.capability === capability && r.role === role);

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

    /* The caller's own tracker list, made on first use. */
    if (name === 'command_tracker_list') {
      const owner = String(args.p_owner ?? 'u1');
      /* A tracker belongs to whoever is asking. Making one under
         somebody else's name needs the delegated capability. */
      if (owner !== 'u1' && !may('crm.proposalForOthers')) {
        return { data: null, error: { message: 'you do not have crm.proposalForOthers' } };
      }
      const lists = (tables.crm_lists ??= []);
      let found = lists.find(
        (l) => String(l.owner_id) === owner && l.is_global !== true
          && /sales tracker/i.test(String(l.name ?? '')),
      );
      if (!found) {
        found = { id: `list${lists.length + 1}`, name: 'Sales tracker', owner_id: owner, is_global: false };
        lists.push(found);
      }
      return { data: found.id, error: null };
    }

    /* A stock unit onto a tracker, as a lead. */
    if (name === 'command_send_from_stock') {
      if (!may('crm.create')) {
        return { data: null, error: { message: 'you do not have crm.create' } };
      }
      const owner = String(args.p_owner ?? 'u1');
      if (owner !== 'u1') {
        return {
          data: null,
          error: { message: 'stock goes on your own tracker; there is no operation for sending it to somebody else\'s' },
        };
      }
      const ids = (args.p_trailers ?? []) as string[];
      if (!ids.length) return { data: null, error: { message: 'nothing said which units to send' } };

      const list = (await rpc('command_tracker_list', { p_owner: args.p_owner })).data as string;
      const units = (tables.stock_trailers ?? []).filter((r) => ids.includes(String(r.id)));
      if (units.length !== ids.length) {
        return {
          data: null,
          error: {
            message: `expected to send ${ids.length} units to the tracker but sent ${units.length}`,
          },
        };
      }

      const rows = (tables.crm_contacts ??= []);
      let first: string | null = null;
      for (const unit of units) {
        const id = `lead${rows.length + 1}`;
        rows.push({
          id, list_id: list, side: 'trailer_sales', status: 'lead',
          company_name: `Lead ${unit.stc_no ?? unit.chassis_number ?? 'Trailer'}`,
          source: 'From Stock', location: unit.location, stock_trailer_id: unit.id,
        });
        writes.push({ table: 'crm_contacts', set: { stock_trailer_id: String(unit.id) }, ids: [id] });
        first = first ?? id;
      }
      return { data: { listId: list, made: units.length, trackerRowId: first }, error: null };
    }

    /* A CRM customer, copied onto the caller's own tracker. Whose
       tracker is decided from who is asking, never from the payload. */
    if (name === 'command_tracker_from_crm') {
      if (!may('crm.create')) {
        return { data: null, error: { message: 'you do not have crm.create' } };
      }
      const owner = String(args.p_owner ?? 'u1');
      if (owner !== 'u1') {
        return {
          data: null,
          error: {
            message: 'a customer goes onto your own tracker; there is no operation '
              + "for putting one on somebody else's",
          },
        };
      }
      const ids = (args.p_contacts ?? []) as string[];
      if (!ids.length) {
        return { data: null, error: { message: 'nothing said which customers to put on the tracker' } };
      }
      const side = String(args.p_side ?? 'trailer_sales');
      if (!['trailer_sales', 'maintenance'].includes(side)) {
        return { data: null, error: { message: `${side} is not a side of this business` } };
      }

      const list = (await rpc('command_tracker_list', { p_owner: args.p_owner })).data as string;
      const rows = (tables.crm_contacts ??= []);
      const sources = rows.filter((r) => ids.includes(String(r.id)));
      if (sources.length !== ids.length) {
        return {
          data: null,
          error: {
            message: `expected to put ${ids.length} customers on the tracker `
              + `but put ${sources.length}`,
          },
        };
      }

      let first: string | null = null;
      for (const from of sources) {
        const id = `deal${rows.length + 1}`;
        rows.push({
          id, list_id: list, side,
          company_name: from.company_name,
          contact_name: from.contact_name ?? null,
          email: from.email ?? null,
          phone: from.phone ?? null,
          location: from.location ?? null,
          source: from.source ?? 'Imported from CRM',
          status: from.status === 'lost' ? 'lost' : from.status === 'customer' ? 'customer' : 'lead',
          what: side === 'maintenance' ? (args.p_what ?? null) : null,
        });
        writes.push({ table: 'crm_contacts', set: { list_id: list }, ids: [id] });
        first = first ?? id;
      }
      return { data: { listId: list, made: sources.length, rowId: first }, error: null };
    }

    /* A proposal, raised against a customer. */
    if (name === 'command_raise_proposal') {
      if (!may('crm.proposal')) {
        return { data: null, error: { message: 'you do not have crm.proposal' } };
      }
      const owner = String(args.p_owner ?? 'u1');
      if (owner !== 'u1' && !may('crm.proposalForOthers')) {
        return { data: null, error: { message: 'you do not have crm.proposalForOthers' } };
      }
      const ids = (args.p_contacts ?? []) as string[];
      const kind = String(args.p_kind ?? 'trailer_sales');
      const side = ['trailer_sales', 'rental'].includes(kind) ? 'trailer_sales'
        : ['maintenance', 'refurb'].includes(kind) ? 'maintenance' : null;
      if (!side) return { data: null, error: { message: `there is no proposal type called ${kind}` } };
      if (!ids.length) {
        return { data: null, error: { message: 'nothing said who the proposal is for' } };
      }

      const list = (await rpc('command_tracker_list', { p_owner: args.p_owner })).data as string;
      const rows = (tables.crm_contacts ??= []);
      const people = rows.filter((r) => ids.includes(String(r.id)));
      if (people.length !== ids.length) {
        return {
          data: null,
          error: { message: `expected to raise ${ids.length} proposals but raised ${people.length}` },
        };
      }

      let first: string | null = null;
      for (const person of people) {
        const id = `prop${rows.length + 1}`;
        rows.push({
          id, list_id: list, side, status: 'quoted', source: 'CRM proposal',
          company_name: person.company_name, contact_name: person.contact_name,
          email: person.email, phone: person.phone, location: person.location,
          relationship: person.relationship ?? 'prospect',
          requirement: kind.replace('_', ' '),
        });
        writes.push({ table: 'crm_contacts', set: { status: 'quoted' }, ids: [id] });
        first = first ?? id;
      }
      return { data: { listId: list, made: people.length, kind, rowId: first }, error: null };
    }

    /* A spreadsheet of customers, already checked. The file never gets
       here; rows that have a company name and nothing but columns the
       dictionary produces do. */
    if (name === 'command_import_contacts') {
      if (!may('crm.import')) {
        return { data: null, error: { message: 'you do not have crm.import' } };
      }
      const incoming = (args.p_rows ?? []) as Record<string, unknown>[];
      if (!Array.isArray(incoming) || !incoming.length) {
        return { data: null, error: { message: 'nothing said what to import' } };
      }

      const lists = (tables.crm_lists ??= []);
      const named = args.p_list == null ? '' : String(args.p_list).trim();
      let list: Row | undefined;
      if (args.p_list_id != null) {
        list = lists.find((l) => String(l.id) === String(args.p_list_id));
        if (!list) return { data: null, error: { message: 'that list is not there' } };
      } else {
        /* Exactly, or not at all. No symbolic reference here means
           whichever row came back first. */
        const hits = named
          ? lists.filter((l) => String(l.name ?? '').toLowerCase() === named.toLowerCase())
          : lists.filter((l) => l.is_global === true);
        if (!hits.length) {
          return {
            data: null,
            error: { message: named ? `there is no list called ${named}` : 'there is no global list' },
          };
        }
        if (hits.length > 1) {
          return {
            data: null,
            error: { message: `${hits.length} lists match ${named || 'that'}, so it is not clear which one` },
          };
        }
        [list] = hits;
      }

      const rows = (tables.crm_contacts ??= []);
      const ids: string[] = [];
      for (const row of incoming) {
        if (!String(row.company_name ?? '').trim()) {
          return {
            data: null,
            error: { message: 'a row with no company name reached the database' },
          };
        }
        const id = `imported${rows.length + 1}`;
        rows.push({ id, list_id: list?.id ?? null, ...row });
        ids.push(id);
      }
      writes.push({ table: 'crm_contacts', set: { source: 'Spreadsheet import' }, ids });
      return { data: { inserted: ids.length, listId: list?.id ?? null }, error: null };
    }

    /* A supplier's stock file, already checked. Every unit or none, and
       a row with no stock number never reaches this. */
    if (name === 'command_import_stock') {
      if (!may('stock.edit')) {
        return { data: null, error: { message: 'you do not have stock.edit' } };
      }
      const incoming = (args.p_rows ?? []) as Record<string, unknown>[];
      if (!Array.isArray(incoming) || !incoming.length) {
        return { data: null, error: { message: 'nothing said what stock to import' } };
      }

      const rows = (tables.stock_trailers ??= []);
      const ids: string[] = [];
      for (const row of incoming) {
        if (!String(row.stc_no ?? '').trim()) {
          return {
            data: null,
            error: { message: 'a row with no stock number reached the database' },
          };
        }
        const id = `loaded${rows.length + 1}`;
        rows.push({ id, status: 'in_stock', ...row });
        ids.push(id);
      }
      writes.push({ table: 'stock_trailers', set: { status: 'in_stock' }, ids });
      return { data: { inserted: ids.length }, error: null };
    }

    /* Writing a social post. The author and the status come from the
       profile of whoever is asking, exactly as the composer's own
       insert does, because they are properties of who is writing. */
    if (name === 'command_create_post') {
      if (!may('marketing.edit')) {
        return { data: null, error: { message: 'you do not have marketing.edit' } };
      }
      const content = String(args.p_content ?? '').trim();
      if (!content) {
        return { data: null, error: { message: 'a post with nothing in it is not a post' } };
      }
      const me = (tables.profiles ?? []).find((r) => String(r.id) === 'u1');
      const author = String(me?.full_name ?? me?.email ?? 'tester');
      const status = String(me?.role ?? role) === 'admin' ? 'approved' : 'pending_review';
      const places = Array.isArray(args.p_platforms) && (args.p_platforms as string[]).length
        ? (args.p_platforms as string[])
        : ['Facebook', 'LinkedIn'];

      const rows = (tables.social_posts ??= []);
      const id = `post${rows.length + 1}`;
      rows.push({
        id, content, platform: places,
        scheduled_date: args.p_scheduled ?? new Date().toISOString().slice(0, 10),
        status, created_by: author, caption: args.p_caption ?? null,
        hashtags: args.p_hashtags ?? [], image_url: args.p_image ?? null,
      });
      writes.push({ table: 'social_posts', set: { content }, ids: [id] });
      return { data: { id, status, author }, error: null };
    }

    /* The news, written down in one call. The fetch is not here: what
       arrives is stories that have already been read. */
    if (name === 'command_refresh_news') {
      if (!may('marketing.edit')) {
        return { data: null, error: { message: 'you do not have marketing.edit' } };
      }
      const items = (args.p_items ?? []) as Record<string, unknown>[];
      const maxAge = Math.max(Number(args.p_max_age ?? 14) || 14, 1);
      const cutoff = new Date(Date.now() - maxAge * 86_400_000).toISOString().slice(0, 10);

      const rows = (tables.news_items ??= []);
      const before = rows.length;
      const kept = rows.filter((r) => String(r.published_date ?? '') >= cutoff);
      const purged = before - kept.length;
      rows.length = 0;
      rows.push(...kept);

      let added = 0;
      for (const item of items) {
        const url = String(item.url ?? '').trim();
        if (!url || !String(item.title ?? '').trim()) continue;
        if (String(item.published_date ?? '') < cutoff) continue;
        if (rows.some((r) => String(r.url) === url)) continue;
        rows.push({ id: `news${rows.length + 1}`, ...item });
        added += 1;
      }
      if (added) writes.push({ table: 'news_items', set: { source: 'feed' }, ids: [] });
      return { data: { added, purged }, error: null };
    }

    /* A site on a customer, and which one is the main one. */
    if (name === 'command_add_address') {
      if (!may('crm.edit')) {
        return { data: null, error: { message: 'you do not have crm.edit' } };
      }
      const address = String(args.p_address ?? '').trim();
      if (!address) {
        return { data: null, error: { message: 'an address with nothing in it is not an address' } };
      }
      const who = (tables.crm_contacts ?? []).find((r) => String(r.id) === String(args.p_contact));
      if (!who) return { data: null, error: { message: 'that customer is not there' } };

      const rows = (tables.contact_addresses ??= []);
      const id = `addr${rows.length + 1}`;
      rows.push({
        id, contact_id: args.p_contact, address,
        label: args.p_label ?? 'Site', is_primary: args.p_primary === true,
      });
      writes.push({ table: 'contact_addresses', set: { address }, ids: [id] });
      return { data: { id, customer: who.company_name, address }, error: null };
    }

    if (name === 'command_primary_address') {
      if (!may('crm.edit')) {
        return { data: null, error: { message: 'you do not have crm.edit' } };
      }
      const wanted = String(args.p_address ?? '').trim().toLowerCase();
      const rows = (tables.contact_addresses ?? []).filter(
        (r) => String(r.contact_id) === String(args.p_contact)
          && (!wanted || String(r.address ?? '').toLowerCase().includes(wanted)
            || String(r.label ?? '').toLowerCase().includes(wanted)),
      );
      if (!rows.length) {
        return { data: null, error: { message: 'that customer has no address matching that' } };
      }
      if (rows.length > 1) {
        return {
          data: null,
          error: { message: `${rows.length} addresses match that, so it is not clear which one` },
        };
      }
      for (const r of (tables.contact_addresses ?? [])) {
        if (String(r.contact_id) === String(args.p_contact)) r.is_primary = false;
      }
      rows[0].is_primary = true;
      writes.push({ table: 'contact_addresses', set: { is_primary: true }, ids: [String(rows[0].id)] });
      return { data: { id: rows[0].id }, error: null };
    }

    /* A link on the account. `links` is one JSON column holding a list,
       which is why it is not a field somebody types at. */
    if (name === 'command_add_link' || name === 'command_remove_link') {
      if (!may('crm.edit')) {
        return { data: null, error: { message: 'you do not have crm.edit' } };
      }
      const who = (tables.crm_contacts ?? []).find((r) => String(r.id) === String(args.p_contact));
      if (!who) return { data: null, error: { message: 'that customer is not there' } };
      const held = (who.links ?? []) as Record<string, unknown>[];

      if (name === 'command_add_link') {
        let url = String(args.p_url ?? '').trim();
        if (!url) return { data: null, error: { message: 'a link with no address is not a link' } };
        if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
        if (held.some((l) => String(l.url) === url)) {
          return { data: null, error: { message: 'that link is already on the account' } };
        }
        const kind = /linkedin\./i.test(url) ? 'linkedin'
          : /facebook\./i.test(url) ? 'facebook'
            : /instagram\./i.test(url) ? 'instagram'
              : /twitter\.|\/\/x\.com/i.test(url) ? 'x' : 'website';
        who.links = [...held, {
          id: `link${held.length + 1}`,
          label: args.p_label ?? kind, url, kind,
        }];
        writes.push({ table: 'crm_contacts', set: { links: who.links }, ids: [String(who.id)] });
        return { data: { url, kind }, error: null };
      }

      const which = String(args.p_which ?? '').trim().toLowerCase();
      const hits = held.filter((l) => String(l.url ?? '').toLowerCase().includes(which)
        || String(l.kind ?? '').toLowerCase() === which
        || String(l.label ?? '').toLowerCase().includes(which));
      if (!hits.length) {
        return { data: null, error: { message: 'there is no link matching that on that account' } };
      }
      if (hits.length > 1) {
        return {
          data: null,
          error: { message: `${hits.length} links match that, so it is not clear which one` },
        };
      }
      who.links = held.filter((l) => l !== hits[0]);
      writes.push({ table: 'crm_contacts', set: { links: who.links }, ids: [String(who.id)] });
      return { data: { removed: hits[0].url }, error: null };
    }

    /* The same business, held twice. Links are flat. */
    if (name === 'command_link_accounts') {
      if (!may('crm.edit')) {
        return { data: null, error: { message: 'you do not have crm.edit' } };
      }
      const rows = tables.crm_contacts ?? [];
      const mine = rows.find((r) => String(r.id) === String(args.p_contact));
      const theirs = rows.find((r) => String(r.id) === String(args.p_parent));
      if (!mine || !theirs) {
        return { data: null, error: { message: 'one of those accounts is not there' } };
      }
      if (theirs.parent_customer_id) {
        return {
          data: null,
          error: { message: `${theirs.company_name} is already linked to another account` },
        };
      }
      mine.parent_customer_id = theirs.id;
      writes.push({ table: 'crm_contacts', set: { parent_customer_id: theirs.id }, ids: [String(mine.id)] });
      return { data: { linked: mine.company_name, to: theirs.company_name }, error: null };
    }

    /* The purchase ledger for work that happens outside the database.
       Claimed before somebody else's service is called, settled when it
       answers, and consulted first so a retry never buys twice. */
    if (name === 'command_external_begin') {
      const key = String(args.p_key ?? '');
      if (!key) return { data: null, error: { message: 'an external attempt needs a key' } };
      const ledger = (tables.command_external_attempts ??= []);
      const found = ledger.find((a) => String(a.key) === key);
      if (found) {
        return {
          data: { state: found.state, result: found.result ?? null, why: found.why ?? null },
          error: null,
        };
      }
      ledger.push({
        key, capability: args.p_capability, subject_id: args.p_subject,
        strategy: args.p_strategy, state: 'pending', result: null, why: null, spent_by: 'u1',
      });
      return { data: { state: 'pending', result: null, why: null }, error: null };
    }

    if (name === 'command_external_finish') {
      const key = String(args.p_key ?? '');
      const ledger = (tables.command_external_attempts ??= []);
      const found = ledger.find((a) => String(a.key) === key);
      if (!found) {
        return { data: null, error: { message: 'there is no attempt of yours with that key' } };
      }
      if (found.state === 'pending') {
        found.state = args.p_ok ? 'done' : 'failed';
        found.result = args.p_result ?? null;
        found.why = args.p_why ?? null;
      }
      return { data: null, error: null };
    }

    /* Booking one. Who is booking it and that they are on it come from
       the caller, never from the sentence. */
    if (name === 'command_create_meeting') {
      if (!may('crm.delegate')) {
        return { data: null, error: { message: 'you do not have crm.delegate' } };
      }
      const title = String(args.p_title ?? '').trim();
      if (!title) return { data: null, error: { message: 'a meeting with no title is not a meeting' } };
      if (args.p_start == null) {
        return { data: null, error: { message: 'nothing said when the meeting is' } };
      }
      const minutes = Math.max(Number(args.p_minutes ?? 30) || 30, 1);
      const start = new Date(String(args.p_start));
      const rows = (tables.calendar_events ??= []);
      const id = `event${rows.length + 1}`;
      rows.push({
        id, title, start_at: start.toISOString(),
        end_at: new Date(start.getTime() + minutes * 60000).toISOString(),
        all_day: false, created_by: 'u1', contact_id: args.p_contact ?? null,
        visibility: args.p_visibility ?? 'private', description: null,
      });
      writes.push({ table: 'calendar_events', set: { title }, ids: [id] });
      return { data: { id, title, start: start.toISOString(), minutes }, error: null };
    }

    /* Answering the invitation on a meeting: the caller's own. */
    if (name === 'command_meeting_answer_for') {
      const events = (args.p_events ?? []) as string[];
      if (events.length !== 1) {
        return { data: null, error: { message: 'an invitation is answered on one meeting at a time' } };
      }
      const invites = (tables.calendar_invites ??= []);
      const mine = invites.filter((i) => String(i.event_id) === String(events[0])
        && (String(i.user_id) === 'u1' || String(i.invited_by) === 'u1'));
      if (!mine.length) {
        return { data: null, error: { message: 'you have no invitation to that meeting' } };
      }
      const invite = mine.find((i) => String(i.user_id) === 'u1') ?? mine[0];
      const action = String(args.p_action ?? '');
      if (action === 'withdraw') {
        invites.splice(invites.indexOf(invite), 1);
      } else if (action === 'accept') {
        invite.status = 'accepted'; invite.awaiting = null;
      } else if (action === 'decline') {
        invite.status = 'declined'; invite.awaiting = null;
      } else if (action === 'propose') {
        if (args.p_start == null) {
          return { data: null, error: { message: 'nothing said what time you are suggesting' } };
        }
        invite.status = 'proposed';
        invite.proposed_start_at = String(args.p_start);
        invite.awaiting = invite.invited_by;
      } else {
        return { data: null, error: { message: `there is nothing called ${action}` } };
      }
      writes.push({ table: 'calendar_invites', set: { status: invite.status ?? 'gone' }, ids: [String(invite.id)] });
      return { data: { ok: true, said: 'Done.' }, error: null };
    }

    /* Moving a meeting. Both ends move, so the length is kept: writing
       the start alone leaves a meeting that finishes before it begins. */
    if (name === 'command_reschedule_meeting') {
      if (!may('crm.delegate')) {
        return { data: null, error: { message: 'you do not have crm.delegate' } };
      }
      const ids = (args.p_events ?? []) as string[];
      const clock = args.p_time == null ? '' : String(args.p_time);
      if (!ids.length) return { data: null, error: { message: 'nothing said which meeting to move' } };
      if (args.p_start == null && !clock) {
        return { data: null, error: { message: 'nothing said what time to move it to' } };
      }

      const events = (tables.calendar_events ?? []).filter((r) => ids.includes(String(r.id)));
      if (events.length !== ids.length) {
        return {
          data: null,
          error: { message: `expected to move ${ids.length} meetings but moved ${events.length}` },
        };
      }

      const moved: Row[] = [];
      for (const ev of events) {
        /* A clock time with no day moves the meeting within its own
           day, which is what somebody dragging the block up the column
           means. */
        const start = args.p_start != null ? String(args.p_start) : (() => {
          const at = new Date(String(ev.start_at));
          const [h, m] = clock.split(':').map(Number);
          at.setHours(h, m ?? 0, 0, 0);
          return at.toISOString();
        })();
        if (String(ev.start_at) === start) {
          return { data: null, error: { message: `${ev.title} is already at that time` } };
        }
        const length = ev.end_at == null
          ? null
          : Date.parse(String(ev.end_at)) - Date.parse(String(ev.start_at));
        const was = String(ev.start_at);
        ev.start_at = start;
        if (length != null) ev.end_at = new Date(Date.parse(start) + length).toISOString();
        writes.push({ table: 'calendar_events', set: { start_at: start }, ids: [String(ev.id)] });
        moved.push({ name: ev.title, was, now: start });
      }
      return { data: moved, error: null };
    }

    /* Asking somebody to a meeting. Every person or none. */
    if (name === 'command_meeting_invite') {
      if (!may('crm.delegate')) {
        return { data: null, error: { message: 'you do not have crm.delegate' } };
      }
      const events = (args.p_events ?? []) as string[];
      const users = (args.p_users ?? []) as string[];
      if (!events.length || !users.length) {
        return { data: null, error: { message: 'nothing said which meeting, or who to invite' } };
      }

      const found = (tables.calendar_events ?? []).filter((r) => events.includes(String(r.id)));
      if (found.length !== events.length) {
        return { data: null, error: { message: 'that meeting is not there' } };
      }

      const invites = (tables.calendar_invites ??= []);
      let first: string | null = null;
      let sent = 0;
      for (const ev of found) {
        for (const person of users) {
          const already = invites.find(
            (i) => String(i.event_id) === String(ev.id) && String(i.user_id) === String(person),
          );
          const id = already ? String(already.id) : `inv${invites.length + 1}`;
          if (already) {
            already.status = 'pending';
            already.awaiting = person;
          } else {
            invites.push({
              id, event_id: ev.id, user_id: person, invited_by: 'u1',
              status: 'pending', awaiting: person, rounds: 0,
            });
          }
          writes.push({ table: 'calendar_invites', set: { status: 'pending' }, ids: [id] });
          first = first ?? id;
          sent += 1;
        }
      }
      return { data: { sent, inviteId: first }, error: null };
    }

    /* Changing what somebody is allowed to do. The highest risk write
       here, so the capability is asked for and the last administrator
       cannot stop being one. */
    if (name === 'command_set_role') {
      if (!may('admin.users')) {
        return { data: null, error: { message: 'you do not have admin.users' } };
      }
      const id = args.p_user == null ? '' : String(args.p_user);
      const wanted = String(args.p_role ?? '');
      if (!id) return { data: null, error: { message: 'nothing said whose role to change' } };
      if (!['admin', 'sales', 'marketer', 'viewer'].includes(wanted)) {
        return { data: null, error: { message: `there is no role called ${wanted || 'nothing'}` } };
      }
      const person = (tables.profiles ?? []).find((r) => String(r.id) === id);
      if (!person) return { data: null, error: { message: 'nobody here has that id' } };
      const was = String(person.role);
      const who = String(person.full_name ?? person.email ?? person.id);
      if (was === wanted) {
        return { data: null, error: { message: `${who} is already ${wanted}` } };
      }
      if (was === 'admin' && wanted !== 'admin') {
        const admins = (tables.profiles ?? []).filter((r) => r.role === 'admin').length;
        if (admins <= 1) {
          return {
            data: null,
            error: {
              message: `${who} is the only administrator, and nothing in this application could put that back`,
            },
          };
        }
      }
      person.role = wanted;
      writes.push({ table: 'profiles', set: { role: wanted }, ids: [id] });
      return { data: { userId: id, name: who, was, now: wanted }, error: null };
    }

    /* Moving records onto a list somebody already has. The list is
       resolved by name inside the same call that does the move. */
    if (name === 'command_add_to_list') {
      const wanted = String(args.p_list_name ?? '').trim();
      const ids = (args.p_ids ?? []) as string[];
      if (!wanted) return { data: null, error: { message: 'nothing said which list' } };
      if (!ids.length) return { data: null, error: { message: 'nothing said which records to move' } };

      const lists = tables.crm_lists ?? [];
      let target = lists.find((l) => String(l.name).trim().toLowerCase() === wanted.toLowerCase());
      if (!target) {
        const near = lists.filter((l) => String(l.name).toLowerCase().includes(wanted.toLowerCase()));
        if (!near.length) return { data: null, error: { message: `no list here is called ${wanted}` } };
        if (near.length > 1) {
          return {
            data: null,
            error: {
              message: `more than one list matches "${wanted}": ${near.map((l) => l.name).join(', ')}`,
            },
          };
        }
        [target] = near;
      }

      const targets = (tables.crm_contacts ?? []).filter((r) => ids.includes(String(r.id)));
      if (targets.length !== ids.length) {
        return {
          data: null,
          error: {
            message: `expected to move ${ids.length} records onto the list but moved ${targets.length}`,
          },
        };
      }
      for (const row of targets) row.list_id = target.id;
      writes.push({ table: 'crm_contacts', set: { list_id: target.id }, ids: ids.map(String) });

      return {
        data: { listId: target.id, name: wanted, moved: targets.length },
        error: null,
      };
    }

    /* Granting colleagues access, which in this CRM is list membership.
       Modelled here for the same reason the sale is: a fake that cannot
       perform an operation cannot show that the operation reached it. */
    if (name === 'command_share_list') {
      if (!may('crm.manageLists')) {
        return { data: null, error: { message: 'you do not have crm.manageLists' } };
      }
      const listId = args.p_list == null ? '' : String(args.p_list);
      const users = (args.p_users ?? []) as string[];
      const ids = (args.p_ids ?? []) as string[];
      if (!listId) return { data: null, error: { message: 'nothing said which list to share' } };
      if (!users.length) return { data: null, error: { message: 'nothing said who to share it with' } };
      if (!ids.length) {
        return { data: null, error: { message: 'nothing said which records were being shared' } };
      }

      /* The selected set has to BE the list. Sharing grants the whole
         list, so a narrower selection would hand over everything else
         on it. */
      const onList = (tables.crm_contacts ?? []).filter((r) => String(r.list_id) === listId);
      const covered = onList.filter((r) => ids.includes(String(r.id)));
      if (onList.length !== ids.length || covered.length !== ids.length) {
        return {
          data: null,
          error: {
            message: `that is ${covered.length} of the ${onList.length} records on the list, `
              + 'and sharing here grants the whole list; nothing has been changed',
          },
        };
      }

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

    /* A list somebody named, rather than one they selected. Sharing is
       list membership, so this needs no records at all: what it needs is
       the list, exactly. */
    if (name === 'command_share_named_list') {
      if (!may('crm.manageLists')) {
        return { data: null, error: { message: 'you do not have crm.manageLists' } };
      }
      const named = String(args.p_list ?? '').trim();
      const users = (args.p_users ?? []) as string[];
      if (!named) return { data: null, error: { message: 'nothing said which list to share' } };
      if (!users.length) {
        return { data: null, error: { message: 'nothing said who to share it with' } };
      }

      const hits = (tables.crm_lists ?? [])
        .filter((l) => String(l.name ?? '').toLowerCase() === named.toLowerCase());
      if (!hits.length) {
        return { data: null, error: { message: `there is no list called ${named}` } };
      }
      if (hits.length > 1) {
        return {
          data: null,
          error: {
            message: `${hits.length} lists match ${named}, so it is not clear which one: `
              + hits.map((l) => String(l.name)).join(', '),
          },
        };
      }
      const [list] = hits;
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
        if (members.some((m) => String(m.list_id) === String(list.id) && String(m.user_id) === u)) continue;
        members.push({ list_id: list.id, user_id: u, can_edit: args.p_can_edit !== false });
        granted += 1;
      }
      writes.push({ table: 'crm_list_members', set: { list_id: list.id }, ids: users });

      return {
        data: {
          listId: list.id, list: named, asked: users.length,
          granted, alreadyHad: users.length - granted,
        },
        error: null,
      };
    }

    /* Leaving a file on a record, as bytes on a row covered by the
       row's own policy. */
    if (name === 'command_attach_file') {
      const table = String(args.p_entity ?? '');
      /* Seeing a record is not permission to write to it. The capability
         is derived from the target, exactly as the function does. */
      const needed = table === 'crm_contacts' ? 'crm.edit'
        : table === 'stock_trailers' ? 'stock.edit' : null;
      if (needed && !may(needed)) {
        return { data: null, error: { message: `you do not have ${needed}` } };
      }
      const record = args.p_record == null ? '' : String(args.p_record);
      const base64 = String(args.p_base64 ?? '');
      if (!['stock_trailers', 'crm_contacts'].includes(table)) {
        return { data: null, error: { message: `nothing here attaches things to ${table}` } };
      }
      if (!record) return { data: null, error: { message: 'nothing said which record to attach it to' } };
      if (!base64) return { data: null, error: { message: 'there is nothing to attach' } };

      const size = Buffer.from(base64, 'base64').length;
      const ceiling = 8 * 1024 * 1024;
      if (size > ceiling) {
        return {
          data: null,
          error: { message: `that file is ${size} bytes, and the most that can be attached to a record is ${ceiling}` },
        };
      }
      if (!(tables[table] ?? []).some((r) => String(r.id) === record)) {
        return { data: null, error: { message: 'that record is not there' } };
      }

      const id = `att${((tables.record_attachments ?? []).length) + 1}`;
      (tables.record_attachments ??= []).push({
        id, entity: table, record_id: record,
        filename: String(args.p_filename ?? 'attachment'),
        mime: String(args.p_mime ?? 'application/octet-stream'),
        size_bytes: size,
        described_as: args.p_described == null ? null : String(args.p_described),
      });
      writes.push({ table: 'record_attachments', set: { record_id: record }, ids: [id] });

      return {
        data: { attachmentId: id, recordId: record, filename: args.p_filename, size },
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
      /* A payload is not a permission. The allowlist above says which
         columns may be written, which is no question at all for a
         delete: a delete writes nothing. */
      if (op === 'insert' || op === 'delete') {
        const wanted = LIFECYCLE.find(
          (l) => l.table === c.table && l.operation === (op === 'insert' ? 'create' : 'delete'),
        );
        if (!wanted || !may(wanted.capability)) {
          return {
            data: null,
            error: {
              message: `you may not ${op === 'insert' ? 'create' : 'delete'} rows of ${c.table}; `
                + 'nothing has been changed',
            },
          };
        }
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

  /* =============================================================
     The transaction, as the database provides it.

     `command_perform` is one plpgsql function and therefore one
     transaction: every step or none. Modelled here by taking a copy of
     every table before the first step and putting it back if any step
     raises, because the property under test is that a programme whose
     third step fails leaves nothing behind from the first two, and a
     fake that committed each step as it went could not show that.
     ============================================================= */
  const perform = async (steps: unknown) => {
    if (!Array.isArray(steps) || !steps.length) {
      return { data: null, error: { message: 'command_perform was given nothing to do' } };
    }

    const before = JSON.parse(JSON.stringify(tables)) as Record<string, Row[]>;
    const writesBefore = writes.length;
    const results: unknown[] = [];
    let changed = 0;

    const roll = () => {
      for (const key of Object.keys(tables)) delete (tables as Record<string, Row[]>)[key];
      for (const [key, rows] of Object.entries(before)) (tables as Record<string, Row[]>)[key] = rows;
      writes.length = writesBefore;
    };

    /* A value one step takes from an earlier step's result. */
    const resolve = (v: unknown): unknown => {
      if (Array.isArray(v)) return v.map(resolve);
      if (v && typeof v === 'object') {
        const ref = (v as Record<string, unknown>).$from as { step: number; key: string } | undefined;
        if (ref) {
          const from = results[ref.step] as Record<string, unknown> | undefined;
          if (!from || from[ref.key] == null) {
            throw new Error(`step ${ref.step} produced nothing called ${ref.key}`);
          }
          return from[ref.key];
        }
        return Object.fromEntries(
          Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, resolve(x)]),
        );
      }
      return v;
    };

    for (const raw of steps) {
      const step = raw as Record<string, unknown>;
      let out: { data: unknown; error: { message: string } | null };

      try {
        if (step.op === 'changes') {
          out = await rpc('command_apply', { p_changes: step.changes });
          if (!out.error) {
            changed += typeof out.data === 'number' ? out.data : 0;
            out = { data: { changed: out.data }, error: null };
          }
        } else if (step.op === 'invoke') {
          const cap = String(step.capability);
          const fn = PERFORMED[cap];
          if (!fn) {
            roll();
            return { data: null, error: { message: `nothing in this database performs ${cap}` } };
          }
          const subjects = (resolve(step.subjects ?? []) as string[]).map(String);
          out = await rpc(fn.name, fn.args({
            subjects,
            args: (resolve(step.args ?? {}) ?? {}) as Record<string, unknown>,
          }));
          if (!out.error) {
            /* The same accounting `command_perform` does: what an
               operation reports having done, or the subjects it ran
               over when it reports nothing countable. */
            const body = (out.data ?? {}) as Record<string, unknown>;
            const n = ['moved', 'granted', 'sent', 'inserted']
              .map((k) => body[k]).find((v) => typeof v === 'number');
            changed += typeof n === 'number' ? n
              : cap === 'record.attach' || cap === 'post.create' ? 1
                : subjects.length;
          }
        } else {
          roll();
          return { data: null, error: { message: `a step must be a change set or an operation` } };
        }
      } catch (e) {
        roll();
        return { data: null, error: { message: (e as Error).message } };
      }

      if (out.error) {
        roll();
        return { data: null, error: out.error };
      }
      results.push(out.data ?? {});
    }

    return { data: { changed, results }, error: null };
  };

  const rpcWithPerform = async (name: string, args: Record<string, unknown>) =>
    (name === 'command_perform' ? perform(args.p_steps) : rpc(name, args));

  return {
    supabase: { from: (table: string) => builder(table, [], null, null), rpc: rpcWithPerform },
    writes,
    tables,
    /** Make one change fail, to prove the others do not land. */
    refuse: (predicate: (c: { table: string; id: string }) => boolean) => { failOn = predicate; },
    /** Who the database thinks is calling, for the capability checks. */
    as: (r: UserRole) => { role = r; },
  };
}

/**
 * Which database function performs which capability, as the real
 * `command_perform` dispatches them.
 *
 * The same mapping `lib/command/store/postgrest.ts` holds, restated here
 * because this fake stands in for the database rather than for the
 * store: if the two disagree the difference is a real one and shows up
 * as a failing check.
 */
const PERFORMED: Record<string, {
  name: string;
  args: (c: { subjects: string[]; args: Record<string, unknown> }) => Record<string, unknown>;
}> = {
  'list.create': {
    name: 'command_create_list',
    args: (c) => ({ p_name: c.args.name ?? null, p_ids: c.subjects, p_owner: null }),
  },
  'list.add': {
    name: 'command_add_to_list',
    args: (c) => ({ p_list_name: c.args.list ?? null, p_ids: c.subjects }),
  },
  'stock.sendToTracker': {
    name: 'command_send_from_stock',
    args: (c) => ({ p_trailers: c.subjects, p_owner: c.args.actorId ?? null }),
  },
  'crm.raiseProposal': {
    name: 'command_raise_proposal',
    args: (c) => ({
      p_contacts: c.subjects,
      p_kind: c.args.kind ?? 'trailer_sales',
      p_owner: c.args.actorId ?? null,
    }),
  },
  'user.setRole': {
    name: 'command_set_role',
    args: (c) => ({ p_user: c.subjects[0] ?? null, p_role: c.args.role ?? null }),
  },
  'rows.import': {
    name: 'command_import_contacts',
    args: (c) => ({
      p_rows: c.args.rows ?? [],
      p_list: c.args.list ?? null,
      p_list_id: c.args.listId ?? null,
    }),
  },
  'stock.import': {
    name: 'command_import_stock',
    args: (c) => ({ p_rows: c.args.rows ?? [] }),
  },
  'list.share': {
    name: 'command_share_named_list',
    args: (c) => ({
      p_list: c.args.list ?? null,
      p_users: Array.isArray(c.args.users) ? c.args.users : [c.args.users].filter(Boolean),
      p_can_edit: c.args.canEdit ?? true,
    }),
  },
  'post.create': {
    name: 'command_create_post',
    args: (c) => ({
      p_content: c.args.content ?? null,
      p_platforms: typeof c.args.platform === 'string' && c.args.platform
        ? String(c.args.platform).split(',')
        : null,
      p_scheduled: c.args.scheduledDate ?? null,
      p_caption: c.args.caption ?? null,
    }),
  },
  'external.begin': {
    name: 'command_external_begin',
    /* Not a business operation: a purchase ledger entry, claimed before
       somebody else's service is called and settled when it answers. */
    args: (c) => ({
      p_key: c.args.key ?? null,
      p_capability: c.args.capability ?? null,
      p_subject: c.args.subject ?? null,
      p_strategy: c.args.strategy ?? null,
    }),
  },
  'external.finish': {
    name: 'command_external_finish',
    args: (c) => ({
      p_key: c.args.key ?? null,
      p_ok: c.args.ok ?? false,
      p_result: c.args.result ?? null,
      p_why: c.args.why ?? null,
    }),
  },
  'contact.addAddress': {
    name: 'command_add_address',
    args: (c) => ({
      p_contact: c.subjects[0] ?? null,
      p_address: c.args.address ?? null,
      p_label: c.args.label ?? null,
      p_primary: c.args.primary ?? false,
    }),
  },
  'contact.primaryAddress': {
    name: 'command_primary_address',
    args: (c) => ({ p_contact: c.subjects[0] ?? null, p_address: c.args.address ?? null }),
  },
  'contact.addLink': {
    name: 'command_add_link',
    args: (c) => ({
      p_contact: c.subjects[0] ?? null,
      p_url: c.args.url ?? null,
      p_label: c.args.label ?? null,
      p_kind: null,
    }),
  },
  'contact.removeLink': {
    name: 'command_remove_link',
    args: (c) => ({ p_contact: c.subjects[0] ?? null, p_which: c.args.which ?? null }),
  },
  'contact.link': {
    name: 'command_link_accounts',
    args: (c) => ({ p_contact: c.subjects[0] ?? null, p_parent: c.args.parent ?? null }),
  },
  'crm.toTracker': {
    name: 'command_tracker_from_crm',
    args: (c) => ({
      p_contacts: c.subjects,
      p_side: c.args.side ?? 'trailer_sales',
      p_what: c.args.what ?? null,
      p_owner: null,
    }),
  },
  'news.refresh': {
    name: 'command_refresh_news',
    args: (c) => ({ p_items: c.args.items ?? [], p_max_age: c.args.maxAge ?? 14 }),
  },
  'meeting.create': {
    name: 'command_create_meeting',
    args: (c) => ({
      p_title: c.args.title ?? null,
      p_start: c.args.start ?? null,
      p_minutes: c.args.minutes ?? null,
      p_contact: c.args.contact ?? null,
      p_visibility: c.args.visibility ?? 'private',
    }),
  },
  'meeting.answer': {
    name: 'command_meeting_answer_for',
    args: (c) => ({
      p_events: c.subjects,
      p_action: c.args.action ?? null,
      p_start: c.args.start ?? null,
      p_end: c.args.end ?? null,
      p_note: c.args.note ?? null,
    }),
  },
  'meeting.reschedule': {
    name: 'command_reschedule_meeting',
    args: (c) => ({
      p_events: c.subjects,
      p_start: c.args.start ?? null,
      p_time: c.args.time ?? null,
    }),
  },
  'meeting.invite': {
    name: 'command_meeting_invite',
    args: (c) => ({
      p_events: c.subjects,
      p_users: Array.isArray(c.args.who) ? c.args.who : [c.args.who].filter(Boolean),
      p_note: c.args.note ?? null,
    }),
  },
  'rows.share': {
    name: 'command_share_list',
    args: (c) => ({
      p_list: c.args.list ?? null,
      p_ids: c.subjects,
      p_users: c.args.users ?? [],
      p_can_edit: c.args.canEdit ?? true,
    }),
  },
  'record.attach': {
    name: 'command_attach_file',
    args: (c) => ({
      p_entity: c.args.table ?? null,
      p_record: c.subjects[0] ?? null,
      p_filename: c.args.filename ?? 'attachment',
      p_mime: c.args.mime ?? 'application/octet-stream',
      p_base64: c.args.base64 ?? '',
      p_described: c.args.describedAs ?? null,
    }),
  },
  'deal.markSold': {
    name: 'command_mark_sold_many',
    args: (c) => ({
      p_tracker_ids: c.subjects,
      p_rep_initials: c.args.repInitials ?? 'Unknown',
      p_sale_price: c.args.salePrice ?? null,
      p_dispatch_date: c.args.dispatchDate ?? null,
      p_today: c.args.today ?? null,
    }),
  },
};
