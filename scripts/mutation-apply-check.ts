/* =============================================================
   Resolve, preview, drift, write.

   Driven against a fake that implements the slice of PostgREST the
   resolver and the executor actually use, seeded from fixture rows.
   Every write is recorded, so this proves which statement was issued,
   against which ids, with which values, and what the rows hold
   afterwards.

   WHAT THIS DOES NOT PROVE, said plainly. There is no Postgres here, so
   it does not prove RLS accepts the write, that a NOT NULL constraint
   holds, or that a trigger leaves the value alone. The fake is written
   so the same case bodies can be pointed at a real database when one is
   available; until then those three remain unproven, and the
   `clearable` metadata plus `check:fields` is what stands in for the
   constraint half.

     npm run check:mutation
   ============================================================= */
import { resolveMutation, resolutionHash, fieldsTouched } from '../lib/command/ir/resolve';
import { applyMutation, evaluate } from '../lib/command/ir/apply';
import { validate } from '../lib/command/ir/validate';
import type { Expr, Mutate, Plan, Select } from '../lib/command/ir/types';

let pass = 0, fail = 0;
const failures: string[] = [];
const ok = (what: string, cond: boolean, got = '') => {
  if (cond) { pass++; return; }
  fail++;
  failures.push(`  ${what}${got ? `\n    ${got}` : ''}`);
};

/* =============================================================
   A fake that behaves like the query builder, and remembers
   ============================================================= */

type Row = Record<string, unknown>;

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

function fakeDb(tables: Record<string, Row[]>) {
  const writes: Recorded[] = [];

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

  return {
    supabase: { from: (table: string) => builder(table, [], null, null) },
    writes,
    tables,
  };
}

/* =============================================================
   Fixtures
   ============================================================= */

const trailerRows = (): Row[] => [
  { id: 't1', stc_no: 'STC143580', status: 'in_stock', location: 'Hyde', category: 'curtainsider', retail_price: 20000, nbv: 15000, refurb_costs: 500, mot_date: '2027-03-14', notes: 'first note' },
  { id: 't2', stc_no: 'STC143581', status: 'in_stock', location: 'Hyde', category: 'curtainsider', retail_price: 24000, nbv: 18000, refurb_costs: 250, mot_date: '2027-06-01', notes: null },
  { id: 't3', stc_no: 'STC144504', status: 'sold', location: 'Hyde', category: 'fridge', retail_price: 30000, nbv: 22000, refurb_costs: 0, mot_date: '2026-12-01', notes: null },
  { id: 't4', stc_no: 'STC199999', status: 'in_stock', location: 'Carrington', category: 'curtainsider', retail_price: 21000, nbv: 16000, refurb_costs: 100, mot_date: '2028-01-01', notes: null },
];

const profileRows = (): Row[] => [
  { id: 'p1', full_name: 'Dave Ashworth' },
  { id: 'p2', full_name: 'Dave Bennett' },
  { id: 'p3', full_name: 'Tom Clarke' },
];

const trailer = (field: string) => ({ entity: 'trailers', field });
const lit = (value: string | number | null): Expr => ({ kind: 'literal', value });
const f = (name: string): Expr => ({ kind: 'field', of: trailer(name) });

function selectTrailers(where: Select['where']): Select {
  return { op: 'select', from: { entity: 'trailers' }, where, produces: { kind: 'rows', entity: 'trailers' } };
}

function update(
  expect: 'one' | 'many',
  where: Select['where'],
  set: NonNullable<Mutate['set']>,
): Plan {
  return {
    steps: [{
      op: 'update', id: 's1', expect, target: { entity: 'trailers' },
      match: selectTrailers(where), set, produces: { kind: 'rows', entity: 'trailers' },
    }],
    unmet: [],
  };
}

const byStc = (text: string): Select['where'] =>
  ({ kind: 'cmp', op: 'contains', left: f('stc_no'), right: lit(text) });

const atHydeInStock: Select['where'] = {
  kind: 'and',
  of: [
    { kind: 'cmp', op: 'eq', left: f('status'), right: lit('in_stock') },
    { kind: 'cmp', op: 'eq', left: f('location'), right: lit('Hyde') },
    { kind: 'cmp', op: 'eq', left: f('category'), right: lit('curtainsider') },
  ],
};

async function main() {

/* =============================================================
   1. One record, named
   ============================================================= */

{
  const db = fakeDb({ stock_trailers: trailerRows() });
  const plan = update('one', byStc('STC143580'), [{ field: trailer('retail_price'), to: lit(24995) }]);

  ok('a single record plan validates', validate(plan).every((p) => p.severity !== 'fatal'),
    validate(plan).map((p) => p.what).join('; '));

  const preview = await resolveMutation(plan, { supabase: db.supabase });
  ok('one named record resolves to one row', preview.ok && preview.rows.length === 1,
    preview.ok ? '' : preview.why);
  if (!preview.ok) return;

  ok('the preview shows the record by its name', preview.rows[0].label === 'STC143580');
  ok('and what it currently holds', preview.rows[0].before.retail_price === 20000,
    JSON.stringify(preview.rows[0].before));

  const done = await applyMutation(plan, { supabase: db.supabase, agreedHash: preview.hash });
  ok('the write goes through', done.ok, done.ok ? '' : done.why);
  ok('exactly one statement was issued', db.writes.length === 1, JSON.stringify(db.writes));
  ok('by primary key, against exactly the previewed row',
    db.writes[0]?.ids.join(',') === 't1', JSON.stringify(db.writes[0]));
  ok('with the value the preview promised',
    db.writes[0]?.set.retail_price === 24995, JSON.stringify(db.writes[0]?.set));
  ok('and the row afterwards holds it',
    db.tables.stock_trailers.find((r) => r.id === 't1')?.retail_price === 24995);
  ok('nothing else moved',
    db.tables.stock_trailers.filter((r) => r.retail_price !== 24995).length === 3);
}

/* =============================================================
   2. A described set, in bulk
   ============================================================= */

{
  const db = fakeDb({ stock_trailers: trailerRows() });
  const plan = update('many', atHydeInStock, [{ field: trailer('location'), to: lit('Bredbury') }]);

  const preview = await resolveMutation(plan, { supabase: db.supabase });
  ok('a described set resolves to every row it describes',
    preview.ok && preview.rows.length === 2, preview.ok ? String(preview.rows.length) : preview.why);
  if (!preview.ok) return;

  const done = await applyMutation(plan, { supabase: db.supabase, agreedHash: preview.hash });
  ok('the bulk write goes through', done.ok, done.ok ? '' : done.why);
  ok('one statement for rows sharing a value', db.writes.length === 1, JSON.stringify(db.writes));
  ok('against exactly the two previewed rows',
    db.writes[0]?.ids.sort().join(',') === 't1,t2', JSON.stringify(db.writes[0]));
  ok('the sold one at Hyde was not touched',
    db.tables.stock_trailers.find((r) => r.id === 't3')?.location === 'Hyde');
  ok('and neither was Carrington',
    db.tables.stock_trailers.find((r) => r.id === 't4')?.location === 'Carrington');
}

/* =============================================================
   3. Cardinality: a sentence about one that finds several
   ============================================================= */

{
  const db = fakeDb({ stock_trailers: trailerRows() });
  /* "STC1435" fits two units. The sentence named one. */
  const plan = update('one', byStc('STC1435'), [{ field: trailer('location'), to: lit('Bredbury') }]);
  const preview = await resolveMutation(plan, { supabase: db.supabase });

  ok('a sentence about one record that finds several is ambiguous',
    !preview.ok && preview.reason === 'ambiguous', preview.ok ? 'it resolved' : preview.reason);
  ok('and it offers every one of them rather than choosing',
    !preview.ok && (preview.candidates?.length ?? 0) === 2,
    preview.ok ? '' : JSON.stringify(preview.candidates?.map((c) => c.label)));
  ok('nothing was written while it was ambiguous', db.writes.length === 0);
}

{
  const db = fakeDb({ stock_trailers: trailerRows() });
  const plan = update('many', byStc('STC1435'), [{ field: trailer('location'), to: lit('Bredbury') }]);
  const preview = await resolveMutation(plan, { supabase: db.supabase });
  ok('the same selection is fine when the sentence said many',
    preview.ok && preview.rows.length === 2, preview.ok ? '' : preview.why);
}

/* =============================================================
   4. Zero matches
   ============================================================= */

{
  const db = fakeDb({ stock_trailers: trailerRows() });
  const plan = update('one', byStc('STC000000'), [{ field: trailer('location'), to: lit('Bredbury') }]);
  const preview = await resolveMutation(plan, { supabase: db.supabase });
  ok('nothing matching is refused rather than written',
    !preview.ok && preview.reason === 'nothing matched');
  ok('and nothing was written', db.writes.length === 0);
}

/* =============================================================
   5. Arithmetic is per row
   ============================================================= */

{
  const db = fakeDb({ stock_trailers: trailerRows() });
  const plan = update('many', atHydeInStock, [{
    field: trailer('refurb_costs'),
    to: { kind: 'binary', op: '+', left: f('refurb_costs'), right: lit(250) },
  }]);

  const preview = await resolveMutation(plan, { supabase: db.supabase });
  if (!preview.ok) { ok('the arithmetic plan resolves', false, preview.why); return; }

  const done = await applyMutation(plan, { supabase: db.supabase, agreedHash: preview.hash });
  ok('an increase is worked out from what each row holds', done.ok, done.ok ? '' : done.why);
  ok('so 500 becomes 750', db.tables.stock_trailers.find((r) => r.id === 't1')?.refurb_costs === 750);
  ok('and 250 becomes 500', db.tables.stock_trailers.find((r) => r.id === 't2')?.refurb_costs === 500);
  ok('two different values means two statements', db.writes.length === 2, JSON.stringify(db.writes));
}

/* A proportion of another column, which is the case the drift
   fingerprint exists for. */
{
  const db = fakeDb({ stock_trailers: trailerRows() });
  const plan = update('one', byStc('STC143580'), [{
    field: trailer('retail_price'),
    to: { kind: 'binary', op: '*', left: f('nbv'), right: lit(1.2) },
  }]);

  const preview = await resolveMutation(plan, { supabase: db.supabase });
  if (!preview.ok) { ok('the proportional plan resolves', false, preview.why); return; }

  ok('the fingerprint covers the column being READ, not just the one written',
    preview.fields.includes('nbv') && preview.fields.includes('retail_price'),
    preview.fields.join(','));

  /* Somebody revalues the unit between preview and confirmation. The
     ids are unchanged, the retail price is unchanged, and the number
     that would be written is completely different. */
  db.tables.stock_trailers.find((r) => r.id === 't1')!.nbv = 30000;

  const done = await applyMutation(plan, { supabase: db.supabase, agreedHash: preview.hash });
  ok('a change to a column the expression reads is drift',
    !done.ok && done.reason === 'drift', done.ok ? 'it wrote anyway' : done.why);
  ok('and nothing was written', db.writes.length === 0);

  /* Re-previewed, it goes through with the new number. */
  const again = await resolveMutation(plan, { supabase: db.supabase });
  if (!again.ok) { ok('it re-previews', false, again.why); return; }
  const second = await applyMutation(plan, { supabase: db.supabase, agreedHash: again.hash });
  ok('after a fresh preview it writes the new figure', second.ok, second.ok ? '' : second.why);
  ok('which is the new value and not the old one',
    db.tables.stock_trailers.find((r) => r.id === 't1')?.retail_price === 36000,
    String(db.tables.stock_trailers.find((r) => r.id === 't1')?.retail_price));
}

/* =============================================================
   6. Drift on the selection, and on a written value
   ============================================================= */

{
  const db = fakeDb({ stock_trailers: trailerRows() });
  const plan = update('many', atHydeInStock, [{ field: trailer('location'), to: lit('Bredbury') }]);
  const preview = await resolveMutation(plan, { supabase: db.supabase });
  if (!preview.ok) { ok('the bulk plan resolves', false, preview.why); return; }

  /* A trailer arrives into the set after the preview. */
  db.tables.stock_trailers.push({
    id: 't5', stc_no: 'STC200000', status: 'in_stock', location: 'Hyde',
    category: 'curtainsider', retail_price: 1, nbv: 1, refurb_costs: 0, mot_date: '2029-01-01', notes: null,
  });

  const done = await applyMutation(plan, { supabase: db.supabase, agreedHash: preview.hash });
  ok('a row arriving into the set after the preview is drift',
    !done.ok && done.reason === 'drift', done.ok ? 'it wrote anyway' : done.why);
  ok('and the newcomer was not swept up', db.writes.length === 0);
}

{
  const db = fakeDb({ stock_trailers: trailerRows() });
  const plan = update('one', byStc('STC143580'), [{ field: trailer('retail_price'), to: lit(24995) }]);
  const preview = await resolveMutation(plan, { supabase: db.supabase });
  if (!preview.ok) { ok('the plan resolves', false, preview.why); return; }

  /* Somebody else edits the very column being written. */
  db.tables.stock_trailers.find((r) => r.id === 't1')!.retail_price = 21000;

  const done = await applyMutation(plan, { supabase: db.supabase, agreedHash: preview.hash });
  ok('somebody else changing the same column is drift',
    !done.ok && done.reason === 'drift', done.ok ? 'it wrote anyway' : done.why);
}

/* The guard must not fire when nothing moved, or it refuses everything
   and proves nothing. */
{
  const db = fakeDb({ stock_trailers: trailerRows() });
  const plan = update('one', byStc('STC143580'), [{ field: trailer('retail_price'), to: lit(24995) }]);
  const preview = await resolveMutation(plan, { supabase: db.supabase });
  if (!preview.ok) { ok('the plan resolves', false, preview.why); return; }
  const done = await applyMutation(plan, { supabase: db.supabase, agreedHash: preview.hash });
  ok('an unchanged world is not drift', done.ok, done.ok ? '' : done.why);
}

/* =============================================================
   7. Clearing, appending, dates
   ============================================================= */

{
  const db = fakeDb({ stock_trailers: trailerRows() });
  const plan = update('one', byStc('STC143580'), [{ field: trailer('notes'), to: lit(null) }]);
  const preview = await resolveMutation(plan, { supabase: db.supabase });
  if (!preview.ok) { ok('the clear resolves', false, preview.why); return; }
  const done = await applyMutation(plan, { supabase: db.supabase, agreedHash: preview.hash });
  ok('a clearable column is emptied', done.ok && db.writes[0]?.set.notes === null,
    JSON.stringify(db.writes[0]));
}

{
  const db = fakeDb({ stock_trailers: trailerRows() });
  const plan = update('one', byStc('STC143580'), [{
    field: trailer('notes'), to: lit('chasing tyres'), mode: 'append',
  }]);
  const preview = await resolveMutation(plan, { supabase: db.supabase });
  if (!preview.ok) { ok('the append resolves', false, preview.why); return; }
  await applyMutation(plan, { supabase: db.supabase, agreedHash: preview.hash });
  ok('appending keeps what was already there',
    String(db.tables.stock_trailers.find((r) => r.id === 't1')?.notes) === 'first note\nchasing tyres',
    String(db.tables.stock_trailers.find((r) => r.id === 't1')?.notes));
}

{
  const db = fakeDb({ stock_trailers: trailerRows() });
  const plan = update('one', byStc('STC143580'), [{
    field: trailer('mot_date'),
    to: { kind: 'shift', of: f('mot_date'), by: { n: 1, unit: 'month' }, direction: 'back' },
  }]);
  const preview = await resolveMutation(plan, { supabase: db.supabase });
  if (!preview.ok) { ok('the date shift resolves', false, preview.why); return; }
  await applyMutation(plan, { supabase: db.supabase, agreedHash: preview.hash });
  ok('a date moved back a month is a month earlier',
    db.tables.stock_trailers.find((r) => r.id === 't1')?.mot_date === '2027-02-14',
    String(db.tables.stock_trailers.find((r) => r.id === 't1')?.mot_date));
}

/* =============================================================
   8. References resolve here, not at planning time
   ============================================================= */

const nameContains = (text: string): Expr => ({
  kind: 'reference', entity: 'profiles', select: 'full_name', onAmbiguity: 'ask',
  where: {
    kind: 'cmp', op: 'contains',
    left: { kind: 'field', of: { entity: 'profiles', field: 'full_name' } },
    right: lit(text),
  },
});

{
  const db = fakeDb({ stock_trailers: trailerRows(), profiles: profileRows() });
  const plan = update('one', byStc('STC143580'), [{
    field: trailer('sales_rep'), to: nameContains('Tom'),
  }]);

  ok('a plan carrying a reference holds no row id',
    !JSON.stringify(plan).includes('p3'), 'the plan named a row');

  const preview = await resolveMutation(plan, { supabase: db.supabase });
  ok('the reference resolves at resolution time', preview.ok, preview.ok ? '' : preview.why);
  if (!preview.ok) return;
  ok('and the resolution records which row it landed on',
    preview.references[0]?.id === 'p3' && preview.references[0]?.value === 'Tom Clarke',
    JSON.stringify(preview.references));

  const done = await applyMutation(plan, { supabase: db.supabase, agreedHash: preview.hash });
  ok('the resolved value is what gets written',
    done.ok && db.writes[0]?.set.sales_rep === 'Tom Clarke', JSON.stringify(db.writes[0]?.set));
}

{
  const db = fakeDb({ stock_trailers: trailerRows(), profiles: profileRows() });
  const plan = update('one', byStc('STC143580'), [{
    field: trailer('sales_rep'), to: nameContains('Dave'),
  }]);
  const preview = await resolveMutation(plan, { supabase: db.supabase });
  ok('two people called Dave is an ambiguity, not a choice',
    !preview.ok && preview.reason === 'ambiguous', preview.ok ? 'it picked one' : preview.why);
  ok('and nothing was written', db.writes.length === 0);
}

{
  const db = fakeDb({ stock_trailers: trailerRows(), profiles: profileRows() });
  const plan = update('one', byStc('STC143580'), [{
    field: trailer('sales_rep'), to: nameContains('Tom'),
  }]);
  const preview = await resolveMutation(plan, { supabase: db.supabase });
  if (!preview.ok) { ok('it resolves', false, preview.why); return; }

  /* The person the reference named is renamed. The rows are untouched
     and the value that would be written is different. */
  db.tables.profiles.find((r) => r.id === 'p3')!.full_name = 'Thomas Clarke';

  const done = await applyMutation(plan, { supabase: db.supabase, agreedHash: preview.hash });
  ok('a renamed reference is drift', !done.ok && done.reason === 'drift',
    done.ok ? 'it wrote anyway' : done.why);
}

/* =============================================================
   9. Expressions that cannot be worked out do not become null
   ============================================================= */

{
  const db = fakeDb({ stock_trailers: trailerRows() });
  const plan = update('one', byStc('STC143580'), [{
    field: trailer('retail_price'),
    to: { kind: 'binary', op: '/', left: f('nbv'), right: lit(0) },
  }]);
  const preview = await resolveMutation(plan, { supabase: db.supabase });
  if (!preview.ok) { ok('it resolves', false, preview.why); return; }
  const done = await applyMutation(plan, { supabase: db.supabase, agreedHash: preview.hash });
  ok('a value that cannot be computed refuses rather than writing empty',
    !done.ok && done.reason === 'refused', done.ok ? 'it wrote' : done.why);
  ok('and nothing was written', db.writes.length === 0);
}

ok('an unreadable expression evaluates to undefined, never to null',
  evaluate({ kind: 'agg', fn: 'count' } as Expr,
    { row: {}, references: new Map(), now: '2026-08-14' }) === undefined);

/* =============================================================
   10. The fingerprint is over meaning-bearing state, in order
   ============================================================= */

{
  const rows = [
    { id: 'b', label: 'B', before: { x: 1 } },
    { id: 'a', label: 'A', before: { x: 2 } },
  ];
  const reversed = [rows[1], rows[0]];
  ok('row order does not change the fingerprint',
    resolutionHash(rows, [], ['x']) === resolutionHash(reversed, [], ['x']));
  ok('but a value does',
    resolutionHash(rows, [], ['x'])
    !== resolutionHash([{ id: 'a', label: 'A', before: { x: 3 } }, rows[0]], [], ['x']));
  ok('and so does the set of rows',
    resolutionHash(rows, [], ['x']) !== resolutionHash([rows[0]], [], ['x']));
}

ok('the fields a mutation touches include what it reads',
  fieldsTouched({
    op: 'update', expect: 'one', target: { entity: 'trailers' },
    set: [{
      field: trailer('retail_price'),
      to: { kind: 'binary', op: '*', left: f('nbv'), right: lit(1.2) },
    }],
  }).join(',') === 'nbv,retail_price');

/* ============================================================= */

}

main().then(() => {
  console.log(`\n  ${pass}/${pass + fail} mutation assertions hold.\n`);
  if (failures.length) {
    console.log('  failures:');
    for (const f of failures) console.log(f);
    console.log();
  }
  if (fail) process.exitCode = 1;
});
