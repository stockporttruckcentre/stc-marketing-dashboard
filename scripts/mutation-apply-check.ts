/* =============================================================
   Resolve, preview, drift, write.

   Driven against a fake that implements the slice of PostgREST the
   resolver and the executor actually use, seeded from fixture rows.
   Every write is recorded, so this proves which statement was issued,
   against which ids, with which values, and what the rows hold
   afterwards.

   WHAT THIS DOES NOT PROVE. The fake behaves the way PostgREST is
   expected to behave, so this proves the executor sends the right call
   and nothing about whether the SQL works. That half is
   `scripts/sql/validate-007.sql`, which runs against a real PostgreSQL
   16 and covers the types, the constraints, row level security and the
   transaction boundaries. See `scripts/sql/README.md`.

     npm run check:mutation
   ============================================================= */
import { resolveMutation, resolutionHash, fieldsTouched } from '../lib/command/ir/resolve';
import { resolveProgramme, executeProgramme } from '../lib/command/ir/orchestrate';
import { postgrestStore } from '../lib/command/store/postgrest';
import { evaluate } from '../lib/command/ir/evaluate';
import { validate } from '../lib/command/ir/validate';
import type { Expr, Mutate, Plan, Select } from '../lib/command/ir/types';
import { writableColumns } from './generate-writable-columns';

/* =============================================================
   Cases are independent.

   The first version of this file ran everything inside one function and
   bailed out with `return` when a precondition failed, so one broken
   case silently cancelled every case after it and the total was only
   trustworthy while everything passed. A count you can only believe
   when it is green is not a count.

   Each case now runs in its own try, its assertions are tallied against
   it, and a case that throws is reported as a failed case rather than
   ending the run.
   ============================================================= */

let assertions = 0, failedAssertions = 0;
let casesRun = 0, casesFailed = 0;
const failures: string[] = [];
let current = '';

const ok = (what: string, cond: boolean, got = '') => {
  assertions++;
  if (cond) return;
  failedAssertions++;
  failures.push(`  [${current}] ${what}${got ? `\n    ${got}` : ''}`);
};

const cases: { name: string; run: () => Promise<void> }[] = [];
const test = (name: string, run: () => Promise<void>) => cases.push({ name, run });
/* The fake lives in `scripts/support/fake-postgrest.ts` so the
   acceptance harness asserts against the same one. */
import { fakeDb, type Row } from './support/fake-postgrest';

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

/* Two steps over the same table, so a multi step plan is a real plan
   rather than a shape nobody builds. */
function twoUpdates(): Plan {
  return {
    steps: [
      {
        op: 'update', id: 's1', expect: 'one', target: { entity: 'trailers' },
        match: selectTrailers(byStc('STC143580')),
        set: [{ field: trailer('location'), to: lit('Bredbury') }],
        produces: { kind: 'rows', entity: 'trailers' },
      },
      {
        op: 'update', id: 's2', expect: 'one', target: { entity: 'trailers' },
        match: selectTrailers(byStc('STC143581')),
        set: [{ field: trailer('location'), to: lit('Carrington') }],
        produces: { kind: 'rows', entity: 'trailers' },
      },
    ],
    unmet: [],
  };
}

/* =============================================================
   Cases
   ============================================================= */

test('one record, named', async () => {
  const db = fakeDb({ stock_trailers: trailerRows() });
  const plan = update('one', byStc('STC143580'), [{ field: trailer('retail_price'), to: lit(24995) }]);

  ok('the plan validates', validate(plan).every((p) => p.severity !== 'fatal'),
    validate(plan).map((p) => p.what).join('; '));

  const preview = await resolveProgramme(plan, { store: postgrestStore(db.supabase) });
  ok('one named record resolves to one row', preview.ok && preview.changes.length === 1,
    preview.ok ? '' : preview.why);
  if (!preview.ok) return;

  ok('the preview names the record', preview.units[0].preview[0].label === 'STC143580');
  ok('and shows what it holds now', preview.units[0].preview[0].before.retail_price === 20000);
  ok('and what it will hold', preview.units[0].preview[0].after.retail_price === 24995);

  const done = await executeProgramme(plan, { store: postgrestStore(db.supabase), agreedHash: preview.hash });
  ok('the write goes through', done.ok, done.ok ? '' : done.why);
  ok('by primary key, against exactly the previewed row',
    db.writes.length === 1 && db.writes[0].ids.join(',') === 't1', JSON.stringify(db.writes));
  ok('with the value the preview promised', db.writes[0]?.set.retail_price === 24995);
  ok('and the row afterwards holds it',
    db.tables.stock_trailers.find((r) => r.id === 't1')?.retail_price === 24995);
  ok('nothing else moved',
    db.tables.stock_trailers.filter((r) => r.retail_price !== 24995).length === 3);
});

test('a described set, in bulk', async () => {
  const db = fakeDb({ stock_trailers: trailerRows() });
  const plan = update('many', atHydeInStock, [{ field: trailer('location'), to: lit('Bredbury') }]);

  const preview = await resolveProgramme(plan, { store: postgrestStore(db.supabase) });
  ok('it resolves to every row it describes', preview.ok && preview.changes.length === 2,
    preview.ok ? String(preview.changes.length) : preview.why);
  if (!preview.ok) return;

  const done = await executeProgramme(plan, { store: postgrestStore(db.supabase), agreedHash: preview.hash });
  ok('the bulk write goes through', done.ok, done.ok ? '' : done.why);
  ok('against exactly the two previewed rows',
    db.writes.map((w) => w.ids).flat().sort().join(',') === 't1,t2', JSON.stringify(db.writes));
  ok('the sold one at Hyde was not touched',
    db.tables.stock_trailers.find((r) => r.id === 't3')?.location === 'Hyde');
  ok('and neither was Carrington',
    db.tables.stock_trailers.find((r) => r.id === 't4')?.location === 'Carrington');
});

test('a sentence about one that finds several', async () => {
  const db = fakeDb({ stock_trailers: trailerRows() });
  const plan = update('one', byStc('STC1435'), [{ field: trailer('location'), to: lit('Bredbury') }]);
  const preview = await resolveProgramme(plan, { store: postgrestStore(db.supabase) });

  ok('it is unresolved rather than written', !preview.ok && preview.reason === 'unresolved');
  ok('and the resolution says which kind of unresolved',
    !preview.ok && preview.resolution?.ok === false && preview.resolution.reason === 'ambiguous',
    !preview.ok ? String(preview.resolution?.ok === false && preview.resolution.reason) : '');
  ok('offering every candidate rather than choosing',
    !preview.ok && preview.resolution?.ok === false && (preview.resolution.candidates?.length ?? 0) === 2);
  ok('nothing was written', db.writes.length === 0);
});

test('the same selection when the sentence said many', async () => {
  const db = fakeDb({ stock_trailers: trailerRows() });
  const plan = update('many', byStc('STC1435'), [{ field: trailer('location'), to: lit('Bredbury') }]);
  const preview = await resolveProgramme(plan, { store: postgrestStore(db.supabase) });
  ok('it resolves', preview.ok && preview.changes.length === 2, preview.ok ? '' : preview.why);
});

test('nothing matching', async () => {
  const db = fakeDb({ stock_trailers: trailerRows() });
  const plan = update('one', byStc('STC000000'), [{ field: trailer('location'), to: lit('Bredbury') }]);
  const preview = await resolveProgramme(plan, { store: postgrestStore(db.supabase) });
  ok('is refused rather than written',
    !preview.ok && preview.resolution?.ok === false && preview.resolution.reason === 'nothing matched');
  ok('and nothing was written', db.writes.length === 0);
});

test('arithmetic is worked out per row', async () => {
  const db = fakeDb({ stock_trailers: trailerRows() });
  const plan = update('many', atHydeInStock, [{
    field: trailer('refurb_costs'),
    to: { kind: 'binary', op: '+', left: f('refurb_costs'), right: lit(250) },
  }]);

  const preview = await resolveProgramme(plan, { store: postgrestStore(db.supabase) });
  if (!preview.ok) { ok('it resolves', false, preview.why); return; }
  const done = await executeProgramme(plan, { store: postgrestStore(db.supabase), agreedHash: preview.hash });
  ok('the increase goes through', done.ok, done.ok ? '' : done.why);
  ok('so 500 becomes 750', db.tables.stock_trailers.find((r) => r.id === 't1')?.refurb_costs === 750);
  ok('and 250 becomes 500', db.tables.stock_trailers.find((r) => r.id === 't2')?.refurb_costs === 500);
});

/* =============================================================
   Arithmetic refuses rather than assuming
   ============================================================= */

test('an empty column is not zero', async () => {
  const db = fakeDb({ stock_trailers: trailerRows() });
  db.tables.stock_trailers.find((r) => r.id === 't1')!.refurb_costs = null;
  const plan = update('one', byStc('STC143580'), [{
    field: trailer('refurb_costs'),
    to: { kind: 'binary', op: '+', left: f('refurb_costs'), right: lit(250) },
  }]);
  const preview = await resolveProgramme(plan, { store: postgrestStore(db.supabase) });
  ok('adding to nothing refuses rather than writing 250',
    !preview.ok && /empty/.test(preview.why), preview.ok ? 'it resolved' : preview.why);
  ok('and nothing was written', db.writes.length === 0);
});

test('a word is not a number', async () => {
  const db = fakeDb({ stock_trailers: trailerRows() });
  db.tables.stock_trailers.find((r) => r.id === 't1')!.refurb_costs = 'not a number';
  const plan = update('one', byStc('STC143580'), [{
    field: trailer('refurb_costs'),
    to: { kind: 'binary', op: '+', left: f('refurb_costs'), right: lit(250) },
  }]);
  const preview = await resolveProgramme(plan, { store: postgrestStore(db.supabase) });
  ok('it refuses', !preview.ok && /not a number/.test(preview.why),
    preview.ok ? 'it resolved' : preview.why);
  ok('and nothing was written', db.writes.length === 0);
});

test('a sum that overflows', async () => {
  const db = fakeDb({ stock_trailers: trailerRows() });
  db.tables.stock_trailers.find((r) => r.id === 't1')!.retail_price = Number.MAX_VALUE;
  const plan = update('one', byStc('STC143580'), [{
    field: trailer('retail_price'),
    to: { kind: 'binary', op: '*', left: f('retail_price'), right: lit(10) },
  }]);
  const preview = await resolveProgramme(plan, { store: postgrestStore(db.supabase) });
  ok('does not come to a number, so it refuses',
    !preview.ok && /does not come to a number/.test(preview.why),
    preview.ok ? 'it resolved' : preview.why);
  ok('and nothing was written', db.writes.length === 0);
});

test('division by zero', async () => {
  const db = fakeDb({ stock_trailers: trailerRows() });
  const plan = update('one', byStc('STC143580'), [{
    field: trailer('retail_price'),
    to: { kind: 'binary', op: '/', left: f('nbv'), right: lit(0) },
  }]);
  const preview = await resolveProgramme(plan, { store: postgrestStore(db.supabase) });
  ok('refuses rather than writing empty',
    !preview.ok && /divide by zero/.test(preview.why), preview.ok ? 'it resolved' : preview.why);
  ok('and nothing was written', db.writes.length === 0);
});

test('the evaluator never turns a failure into a value', async () => {
  const ctx = { row: {}, references: new Map(), now: '2026-08-14' };
  ok('an aggregate over one row has no answer',
    evaluate({ kind: 'agg', fn: 'count' } as Expr, ctx).ok === false);
  ok('a null operand has no answer',
    evaluate({ kind: 'binary', op: '+', left: lit(null), right: lit(1) } as Expr, ctx).ok === false);
  ok('but an ordinary sum does',
    evaluate({ kind: 'binary', op: '+', left: lit(2), right: lit(3) } as Expr, ctx).ok === true);
});

/* =============================================================
   Drift
   ============================================================= */

test('a column the expression reads changing is drift', async () => {
  const db = fakeDb({ stock_trailers: trailerRows() });
  const plan = update('one', byStc('STC143580'), [{
    field: trailer('retail_price'),
    to: { kind: 'binary', op: '*', left: f('nbv'), right: lit(1.2) },
  }]);

  const preview = await resolveProgramme(plan, { store: postgrestStore(db.supabase) });
  if (!preview.ok) { ok('it resolves', false, preview.why); return; }
  ok('the fingerprint covers the column being READ',
    preview.units[0].resolution.fields.includes('nbv'));

  db.tables.stock_trailers.find((r) => r.id === 't1')!.nbv = 30000;

  const done = await executeProgramme(plan, { store: postgrestStore(db.supabase), agreedHash: preview.hash });
  ok('it is drift', !done.ok && done.reason === 'drift', done.ok ? 'it wrote anyway' : done.why);
  ok('and nothing was written', db.writes.length === 0);

  const again = await resolveProgramme(plan, { store: postgrestStore(db.supabase) });
  if (!again.ok) { ok('it re-previews', false, again.why); return; }
  const second = await executeProgramme(plan, { store: postgrestStore(db.supabase), agreedHash: again.hash });
  ok('after a fresh preview it writes the new figure', second.ok, second.ok ? '' : second.why);
  ok('which is 36000, not 18000',
    db.tables.stock_trailers.find((r) => r.id === 't1')?.retail_price === 36000);
});

test('a row arriving into the set is drift', async () => {
  const db = fakeDb({ stock_trailers: trailerRows() });
  const plan = update('many', atHydeInStock, [{ field: trailer('location'), to: lit('Bredbury') }]);
  const preview = await resolveProgramme(plan, { store: postgrestStore(db.supabase) });
  if (!preview.ok) { ok('it resolves', false, preview.why); return; }

  db.tables.stock_trailers.push({
    id: 't5', stc_no: 'STC200000', status: 'in_stock', location: 'Hyde',
    category: 'curtainsider', retail_price: 1, nbv: 1, refurb_costs: 0, mot_date: '2029-01-01', notes: null,
  });

  const done = await executeProgramme(plan, { store: postgrestStore(db.supabase), agreedHash: preview.hash });
  ok('it is drift', !done.ok && done.reason === 'drift', done.ok ? 'it wrote anyway' : done.why);
  ok('and the newcomer was not swept up', db.writes.length === 0);
});

test('somebody else editing the same column is drift', async () => {
  const db = fakeDb({ stock_trailers: trailerRows() });
  const plan = update('one', byStc('STC143580'), [{ field: trailer('retail_price'), to: lit(24995) }]);
  const preview = await resolveProgramme(plan, { store: postgrestStore(db.supabase) });
  if (!preview.ok) { ok('it resolves', false, preview.why); return; }
  db.tables.stock_trailers.find((r) => r.id === 't1')!.retail_price = 21000;
  const done = await executeProgramme(plan, { store: postgrestStore(db.supabase), agreedHash: preview.hash });
  ok('it is drift', !done.ok && done.reason === 'drift', done.ok ? 'it wrote anyway' : done.why);
});

test('an unchanged world is not drift', async () => {
  const db = fakeDb({ stock_trailers: trailerRows() });
  const plan = update('one', byStc('STC143580'), [{ field: trailer('retail_price'), to: lit(24995) }]);
  const preview = await resolveProgramme(plan, { store: postgrestStore(db.supabase) });
  if (!preview.ok) { ok('it resolves', false, preview.why); return; }
  const done = await executeProgramme(plan, { store: postgrestStore(db.supabase), agreedHash: preview.hash });
  ok('it writes', done.ok, done.ok ? '' : done.why);
});

/* =============================================================
   Clearing, appending, dates
   ============================================================= */

test('clearing a clearable column', async () => {
  const db = fakeDb({ stock_trailers: trailerRows() });
  const plan = update('one', byStc('STC143580'), [{ field: trailer('notes'), to: lit(null) }]);
  const preview = await resolveProgramme(plan, { store: postgrestStore(db.supabase) });
  if (!preview.ok) { ok('it resolves', false, preview.why); return; }
  const done = await executeProgramme(plan, { store: postgrestStore(db.supabase), agreedHash: preview.hash });
  ok('it empties the column', done.ok && db.writes[0]?.set.notes === null, JSON.stringify(db.writes[0]));
});

test('appending keeps what was there', async () => {
  const db = fakeDb({ stock_trailers: trailerRows() });
  const plan = update('one', byStc('STC143580'), [{
    field: trailer('notes'), to: lit('chasing tyres'), mode: 'append',
  }]);
  const preview = await resolveProgramme(plan, { store: postgrestStore(db.supabase) });
  if (!preview.ok) { ok('it resolves', false, preview.why); return; }
  await executeProgramme(plan, { store: postgrestStore(db.supabase), agreedHash: preview.hash });
  ok('both notes are there',
    String(db.tables.stock_trailers.find((r) => r.id === 't1')?.notes) === 'first note\nchasing tyres');
});

test('a date moved back a month', async () => {
  const db = fakeDb({ stock_trailers: trailerRows() });
  const plan = update('one', byStc('STC143580'), [{
    field: trailer('mot_date'),
    to: { kind: 'shift', of: f('mot_date'), by: { n: 1, unit: 'month' }, direction: 'back' },
  }]);
  const preview = await resolveProgramme(plan, { store: postgrestStore(db.supabase) });
  if (!preview.ok) { ok('it resolves', false, preview.why); return; }
  await executeProgramme(plan, { store: postgrestStore(db.supabase), agreedHash: preview.hash });
  ok('is a month earlier',
    db.tables.stock_trailers.find((r) => r.id === 't1')?.mot_date === '2027-02-14',
    String(db.tables.stock_trailers.find((r) => r.id === 't1')?.mot_date));
});

/* =============================================================
   References: four outcomes, not two
   ============================================================= */

const nameContains = (text: string): Expr => ({
  kind: 'reference', entity: 'profiles', select: 'full_name', onAmbiguity: 'ask',
  where: {
    kind: 'cmp', op: 'contains',
    left: { kind: 'field', of: { entity: 'profiles', field: 'full_name' } },
    right: lit(text),
  },
});

test('a reference that names one row', async () => {
  const db = fakeDb({ stock_trailers: trailerRows(), profiles: profileRows() });
  const plan = update('one', byStc('STC143580'), [{ field: trailer('sales_rep'), to: nameContains('Tom') }]);

  ok('the plan itself holds no row id', !JSON.stringify(plan).includes('p3'));

  const preview = await resolveProgramme(plan, { store: postgrestStore(db.supabase) });
  ok('it resolves at resolution time', preview.ok, preview.ok ? '' : preview.why);
  if (!preview.ok) return;
  ok('and records which row it landed on',
    preview.units[0].resolution.references[0]?.id === 'p3');

  const done = await executeProgramme(plan, { store: postgrestStore(db.supabase), agreedHash: preview.hash });
  ok('the resolved value is written',
    done.ok && db.writes[0]?.set.sales_rep === 'Tom Clarke', JSON.stringify(db.writes[0]?.set));
});

test('a reference matching nobody is not ambiguity', async () => {
  const db = fakeDb({ stock_trailers: trailerRows(), profiles: profileRows() });
  const plan = update('one', byStc('STC143580'), [{ field: trailer('sales_rep'), to: nameContains('Nigel') }]);
  const preview = await resolveProgramme(plan, { store: postgrestStore(db.supabase) });
  ok('it is unresolved', !preview.ok);
  const r = !preview.ok ? preview.resolution : undefined;
  ok('reported as nothing matching, not as a choice',
    r?.ok === false && r.reason === 'nothing matched'
    && r.reference?.state === 'no match',
    JSON.stringify(r?.ok === false ? r.reference : null));
  ok('with no candidates, because there are none',
    r?.ok === false && r.reference?.state === 'no match');
});

test('a reference matching two carries both', async () => {
  const db = fakeDb({ stock_trailers: trailerRows(), profiles: profileRows() });
  const plan = update('one', byStc('STC143580'), [{ field: trailer('sales_rep'), to: nameContains('Dave') }]);
  const preview = await resolveProgramme(plan, { store: postgrestStore(db.supabase) });
  ok('it is unresolved', !preview.ok);
  const r = !preview.ok ? preview.resolution : undefined;
  ok('reported as ambiguous', r?.ok === false && r.reason === 'ambiguous');
  ok('and carries both people so the question can be asked',
    r?.ok === false && r.reference?.state === 'ambiguous'
    && r.reference.candidates.length === 2
    && r.reference.candidates.every((c) => typeof c.label === 'string'),
    JSON.stringify(r?.ok === false && r.reference?.state === 'ambiguous' ? r.reference.candidates : null));
  ok('and nothing was written', db.writes.length === 0);
});

test('a reference into an entity nothing holds', async () => {
  const db = fakeDb({ stock_trailers: trailerRows() });
  const plan = update('one', byStc('STC143580'), [{
    field: trailer('sales_rep'),
    to: { ...(nameContains('Tom') as Extract<Expr, { kind: 'reference' }>), entity: 'wizards' },
  }]);
  const preview = await resolveProgramme(plan, { store: postgrestStore(db.supabase) });
  const r = !preview.ok ? preview.resolution : undefined;
  ok('is unresolvable rather than ambiguous',
    r?.ok === false && r.reference?.state === 'unresolvable');
});

test('a renamed reference is drift', async () => {
  const db = fakeDb({ stock_trailers: trailerRows(), profiles: profileRows() });
  const plan = update('one', byStc('STC143580'), [{ field: trailer('sales_rep'), to: nameContains('Tom') }]);
  const preview = await resolveProgramme(plan, { store: postgrestStore(db.supabase) });
  if (!preview.ok) { ok('it resolves', false, preview.why); return; }
  db.tables.profiles.find((r) => r.id === 'p3')!.full_name = 'Thomas Clarke';
  const done = await executeProgramme(plan, { store: postgrestStore(db.supabase), agreedHash: preview.hash });
  ok('it is drift', !done.ok && done.reason === 'drift', done.ok ? 'it wrote anyway' : done.why);
});

/* =============================================================
   A plan is a program
   ============================================================= */

test('a two step plan resolves both steps', async () => {
  const db = fakeDb({ stock_trailers: trailerRows() });
  const plan = twoUpdates();
  const preview = await resolveProgramme(plan, { store: postgrestStore(db.supabase) });
  ok('both steps are in the programme', preview.ok && preview.units.length === 2,
    preview.ok ? String(preview.units.length) : preview.why);
  if (!preview.ok) return;
  ok('and both changes are previewed', preview.changes.length === 2);

  const done = await executeProgramme(plan, { store: postgrestStore(db.supabase), agreedHash: preview.hash });
  ok('both are carried out', done.ok && done.changed === 2, done.ok ? '' : done.why);
  ok('the first step landed',
    db.tables.stock_trailers.find((r) => r.id === 't1')?.location === 'Bredbury');
  ok('and so did the second',
    db.tables.stock_trailers.find((r) => r.id === 't2')?.location === 'Carrington');
});

test('drift in the SECOND step refuses the whole plan', async () => {
  const db = fakeDb({ stock_trailers: trailerRows() });
  const plan = twoUpdates();
  const preview = await resolveProgramme(plan, { store: postgrestStore(db.supabase) });
  if (!preview.ok) { ok('it resolves', false, preview.why); return; }

  db.tables.stock_trailers.find((r) => r.id === 't2')!.location = 'Atherton';

  const done = await executeProgramme(plan, { store: postgrestStore(db.supabase), agreedHash: preview.hash });
  ok('it is drift', !done.ok && done.reason === 'drift', done.ok ? 'it wrote anyway' : done.why);
  ok('and the FIRST step was not written either', db.writes.length === 0);
  ok('so the first row is untouched',
    db.tables.stock_trailers.find((r) => r.id === 't1')?.location === 'Hyde');
});

test('a step this cannot execute refuses the whole plan', async () => {
  const db = fakeDb({ stock_trailers: trailerRows() });
  const plan = twoUpdates();
  plan.steps.push({ op: 'create', id: 's3', target: { entity: 'contacts' } });
  const preview = await resolveProgramme(plan, { store: postgrestStore(db.supabase) });
  ok('it refuses rather than doing the two it can',
    !preview.ok && preview.reason === 'cannot execute', preview.ok ? 'it resolved' : preview.why);
  ok('naming the step that stopped it', !preview.ok && preview.stepId === 's3');
  ok('and nothing was written', db.writes.length === 0);
});

test('an invoke nothing can run inside a transaction refuses the plan', async () => {
  const db = fakeDb({ stock_trailers: trailerRows() });
  const plan = twoUpdates();
  plan.steps.push({
    op: 'invoke', id: 's3', capability: 'deal.markSold',
    subject: { entity: 'deals' }, produces: { kind: 'record', entity: 'deals' },
  });
  const preview = await resolveProgramme(plan, { store: postgrestStore(db.supabase) });
  ok('the plan is refused whole',
    !preview.ok && preview.reason === 'cannot execute', preview.ok ? 'it resolved' : preview.why);
  ok('and says why rather than skipping it',
    !preview.ok && /same transaction/.test(preview.why), preview.ok ? '' : preview.why);
});

/* =============================================================
   Steps that need each other

   The four shapes the orchestrator has to tell apart. Every change in a
   programme is computed from the rows as they stand before any of them
   and applied in one call, which is right for steps that have nothing to
   do with each other and silently wrong for a step that was meant to run
   after another. Refusing is the only honest third option: reading these
   as parallel writes produces a number that was never true and reports
   success.
   ============================================================= */

test('independent steps run together', async () => {
  const db = fakeDb({ stock_trailers: trailerRows() });
  /* Two different records, two different values, neither reading what
     the other writes. This is the case the whole mechanism exists to
     allow, so it is asserted first. */
  const preview = await resolveProgramme(twoUpdates(), { store: postgrestStore(db.supabase) });
  ok('two independent updates are allowed', preview.ok, preview.ok ? '' : preview.why);
  ok('and both are in the one programme', preview.ok && preview.changes.length === 2);
});

test('a step computing from what another step writes is refused', async () => {
  const db = fakeDb({ stock_trailers: trailerRows() });
  const plan: Plan = {
    steps: [
      {
        op: 'update', id: 's1', expect: 'one', target: { entity: 'trailers' },
        match: selectTrailers(byStc('STC143580')),
        set: [{
          field: trailer('retail_price'),
          to: { kind: 'binary', op: '*', left: f('retail_price'), right: lit(1.1) },
        }],
        produces: { kind: 'rows', entity: 'trailers' },
      },
      {
        /* The new price, except it would be the old one. */
        op: 'update', id: 's2', expect: 'one', target: { entity: 'trailers' },
        match: selectTrailers(byStc('STC143581')),
        set: [{
          field: trailer('nbv'),
          to: { kind: 'binary', op: '-', left: f('retail_price'), right: lit(1000) },
        }],
        produces: { kind: 'rows', entity: 'trailers' },
      },
    ],
    unmet: [],
  };

  const preview = await resolveProgramme(plan, { store: postgrestStore(db.supabase) });
  ok('it is refused', !preview.ok && preview.reason === 'dependent steps',
    preview.ok ? 'it resolved' : preview.reason);
  ok('naming the field that makes them dependent',
    !preview.ok && /retail_price/.test(preview.why), preview.ok ? '' : preview.why);
  ok('and nothing was written', db.writes.length === 0);
});

test('a step selecting on what another step writes is refused', async () => {
  const db = fakeDb({ stock_trailers: trailerRows() });
  const plan: Plan = {
    steps: [
      {
        op: 'update', id: 's1', expect: 'many', target: { entity: 'trailers' },
        match: selectTrailers(atHydeInStock),
        set: [{ field: trailer('location'), to: lit('Bredbury') }],
        produces: { kind: 'rows', entity: 'trailers' },
      },
      {
        /* Which trailers are at Bredbury depends on whether the step
           above has happened, and in one call it has not. */
        op: 'update', id: 's2', expect: 'many', target: { entity: 'trailers' },
        match: selectTrailers({ kind: 'cmp', op: 'eq', left: f('location'), right: lit('Bredbury') }),
        set: [{ field: trailer('notes'), to: lit('moved') }],
        produces: { kind: 'rows', entity: 'trailers' },
      },
    ],
    unmet: [],
  };

  const preview = await resolveProgramme(plan, { store: postgrestStore(db.supabase) });
  ok('the second selection depending on the first change is refused',
    !preview.ok && preview.reason === 'dependent steps',
    preview.ok ? 'it resolved' : preview.reason);
  ok('and nothing was written', db.writes.length === 0);
});

test('a step consuming another step\'s result is refused', async () => {
  const db = fakeDb({ stock_trailers: trailerRows() });
  const plan: Plan = {
    steps: [
      {
        op: 'update', id: 's1', expect: 'one', target: { entity: 'trailers' },
        match: selectTrailers(byStc('STC143580')),
        set: [{ field: trailer('location'), to: lit('Bredbury') }],
        produces: { kind: 'rows', entity: 'trailers' },
      },
      {
        /* The rows the first step changed, which do not exist as a
           result until it has run. */
        op: 'update', id: 's2', expect: 'many', target: { entity: 'trailers' },
        match: { ref: 'rows', step: 's1' },
        set: [{ field: trailer('notes'), to: lit('moved') }],
        produces: { kind: 'rows', entity: 'trailers' },
      },
    ],
    unmet: [],
  };

  const preview = await resolveProgramme(plan, { store: postgrestStore(db.supabase) });
  ok('it is refused as dependent rather than resolved',
    !preview.ok && preview.reason === 'dependent steps',
    preview.ok ? 'it resolved' : preview.reason);
  ok('naming the step it depends on',
    !preview.ok && /"s1"/.test(preview.why), preview.ok ? '' : preview.why);
  ok('and nothing was written', db.writes.length === 0);
});

test('two steps changing the same record are refused', async () => {
  const db = fakeDb({ stock_trailers: trailerRows() });
  const plan: Plan = {
    steps: [
      {
        op: 'update', id: 's1', expect: 'one', target: { entity: 'trailers' },
        match: selectTrailers(byStc('STC143580')),
        set: [{ field: trailer('location'), to: lit('Bredbury') }],
        produces: { kind: 'rows', entity: 'trailers' },
      },
      {
        /* A different field, the same unit. Nothing in the sentence says
           which of the two changes to that row wins. */
        op: 'update', id: 's2', expect: 'one', target: { entity: 'trailers' },
        match: selectTrailers(byStc('143580')),
        set: [{ field: trailer('notes'), to: lit('moved') }],
        produces: { kind: 'rows', entity: 'trailers' },
      },
    ],
    unmet: [],
  };

  const preview = await resolveProgramme(plan, { store: postgrestStore(db.supabase) });
  ok('the overlap is found from the rows, not from the plan',
    !preview.ok && preview.reason === 'dependent steps',
    preview.ok ? 'it resolved' : preview.reason);
  ok('and nothing was written', db.writes.length === 0);
});

test('the same field on different records is not a dependence', async () => {
  const db = fakeDb({ stock_trailers: trailerRows() });
  /* The rule is about rows, not about columns. Two units moving to two
     different depots write the same column and are independent, and a
     check on the field alone would have refused the commonest multi step
     instruction there is. */
  const preview = await resolveProgramme(twoUpdates(), { store: postgrestStore(db.supabase) });
  ok('writing one column from two steps is allowed', preview.ok, preview.ok ? '' : preview.why);
});

/* -------------------------------------------------------------
   Dependencies do not become safe by being buried

   Every one of these hides the same fact, that a step reads
   `retail_price` while another step writes it, inside a different part
   of the IR. The first version of the walker looked at `binary`,
   `shift`, `duration`, `agg.of`, `window.of` and the `case` branches,
   and returned quietly for everything else, so all but the first of
   these were declared independent.
   ------------------------------------------------------------- */

/** Step one always puts the retail price up. Step two is the variable. */
function hiding(second: NonNullable<Mutate['set']>[number], where?: Select['where']): Plan {
  return {
    steps: [
      {
        op: 'update', id: 's1', expect: 'one', target: { entity: 'trailers' },
        match: selectTrailers(byStc('STC143580')),
        set: [{
          field: trailer('retail_price'),
          to: { kind: 'binary', op: '*', left: f('retail_price'), right: lit(1.1) },
        }],
        produces: { kind: 'rows', entity: 'trailers' },
      },
      {
        op: 'update', id: 's2', expect: 'many', target: { entity: 'trailers' },
        match: selectTrailers(where ?? byStc('STC143581')),
        set: [second],
        produces: { kind: 'rows', entity: 'trailers' },
      },
    ],
    unmet: [],
  };
}

const HIDDEN: { where: string; plan: Plan }[] = [
  {
    where: 'an aggregate\'s own condition',
    plan: hiding({
      field: trailer('nbv'),
      to: { kind: 'agg', fn: 'avg', of: f('nbv'), where: { kind: 'cmp', op: 'gt', left: f('retail_price'), right: lit(1) } },
    }),
  },
  {
    where: 'an aggregate\'s partition',
    plan: hiding({
      field: trailer('nbv'),
      to: { kind: 'agg', fn: 'sum', of: f('nbv'), partitionBy: [f('retail_price')] },
    }),
  },
  {
    where: 'a window\'s partition',
    plan: hiding({
      field: trailer('nbv'),
      to: { kind: 'window', fn: 'rank', of: f('nbv'), partitionBy: [f('retail_price')] },
    }),
  },
  {
    where: 'a window\'s ordering',
    plan: hiding({
      field: trailer('nbv'),
      to: { kind: 'window', fn: 'lag', of: f('nbv'), orderBy: f('retail_price') },
    }),
  },
  {
    where: 'the condition of a case arm',
    plan: hiding({
      field: trailer('nbv'),
      to: {
        kind: 'case',
        when: [{ if: { kind: 'cmp', op: 'gt', left: f('retail_price'), right: lit(1) }, then: lit(1) }],
        else: lit(0),
      },
    }),
  },
  {
    where: 'a reference\'s lookup condition',
    plan: hiding({
      field: trailer('notes'),
      to: {
        kind: 'reference', entity: 'trailers', select: 'notes', onAmbiguity: 'fail',
        where: { kind: 'cmp', op: 'eq', left: f('retail_price'), right: lit(1) },
      },
    }),
  },
  {
    where: 'a between',
    plan: hiding(
      { field: trailer('notes'), to: lit('x') },
      { kind: 'between', of: f('retail_price'), from: lit(1), to: lit(2) },
    ),
  },
  {
    where: 'an in',
    plan: hiding(
      { field: trailer('notes'), to: lit('x') },
      { kind: 'in', of: f('retail_price'), values: [lit(1), lit(2)] },
    ),
  },
  {
    where: 'a near',
    plan: hiding(
      { field: trailer('notes'), to: lit('x') },
      { kind: 'near', of: f('location'), origin: f('retail_price'), radius: 10, unit: 'mi' },
    ),
  },
  {
    where: 'a not',
    plan: hiding(
      { field: trailer('notes'), to: lit('x') },
      { kind: 'not', of: { kind: 'empty', of: f('retail_price') } },
    ),
  },
  {
    where: 'a nested and inside an or',
    plan: hiding(
      { field: trailer('notes'), to: lit('x') },
      {
        kind: 'or',
        of: [
          { kind: 'cmp', op: 'eq', left: f('location'), right: lit('Hyde') },
          { kind: 'and', of: [{ kind: 'empty', of: f('retail_price') }] },
        ],
      },
    ),
  },
  {
    where: 'a related subcondition',
    plan: hiding(
      { field: trailer('notes'), to: lit('x') },
      { kind: 'related', via: 'trailer_deals', where: { kind: 'empty', of: f('retail_price') } },
    ),
  },
];

for (const c of HIDDEN) {
  test(`a dependence inside ${c.where} is found`, async () => {
    const db = fakeDb({ stock_trailers: trailerRows() });
    const preview = await resolveProgramme(c.plan, { store: postgrestStore(db.supabase) });
    ok('it is refused as dependent',
      !preview.ok && preview.reason === 'dependent steps',
      preview.ok ? 'it resolved' : preview.reason);
    ok('and nothing was written', db.writes.length === 0);
  });
}

test('a result reference buried in a case arm is found', async () => {
  const db = fakeDb({ stock_trailers: trailerRows() });
  const plan = hiding({
    field: trailer('nbv'),
    to: {
      kind: 'case',
      when: [{
        if: { kind: 'cmp', op: 'gt', left: f('nbv'), right: lit(1) },
        then: { kind: 'result', of: { ref: 'scalar', step: 's1' } },
      }],
    },
  });
  const preview = await resolveProgramme(plan, { store: postgrestStore(db.supabase) });
  ok('it is refused as dependent',
    !preview.ok && preview.reason === 'dependent steps',
    preview.ok ? 'it resolved' : preview.reason);
  ok('naming the step it consumes', !preview.ok && /"s1"/.test(preview.why),
    preview.ok ? '' : preview.why);
});

test('and a plan that hides nothing still runs', async () => {
  const db = fakeDb({ stock_trailers: trailerRows() });
  /* The same nesting depth, reading a field nobody writes. Without this
     the cases above would pass just as well if the check refused
     everything with an aggregate in it. */
  const plan = hiding({
    field: trailer('nbv'),
    to: { kind: 'agg', fn: 'avg', of: f('nbv'), where: { kind: 'cmp', op: 'gt', left: f('refurb_costs'), right: lit(1) } },
  });
  const preview = await resolveProgramme(plan, { store: postgrestStore(db.supabase) });
  ok('a deeply nested read of an untouched field is not a dependence',
    preview.ok || preview.reason !== 'dependent steps',
    preview.ok ? '' : preview.why);
});

/* =============================================================
   Atomicity
   ============================================================= */

test('one failing change leaves none of them written', async () => {
  const db = fakeDb({ stock_trailers: trailerRows() });
  const plan = twoUpdates();
  const preview = await resolveProgramme(plan, { store: postgrestStore(db.supabase) });
  if (!preview.ok) { ok('it resolves', false, preview.why); return; }

  db.refuse((c) => c.id === 't2');

  const done = await executeProgramme(plan, { store: postgrestStore(db.supabase), agreedHash: preview.hash });
  ok('it fails', !done.ok && done.reason === 'failed', done.ok ? 'it succeeded' : done.why);
  ok('and NOTHING was written, including the change before the failure',
    db.writes.length === 0, JSON.stringify(db.writes));
  ok('so the first row still holds what it held',
    db.tables.stock_trailers.find((r) => r.id === 't1')?.location === 'Hyde');
});

test('the executor sends one call, not one per row', async () => {
  const db = fakeDb({ stock_trailers: trailerRows() });
  let calls = 0;
  const counted = {
    ...db.supabase,
    rpc: (name: string, args: Record<string, unknown>) => { calls += 1; return db.supabase.rpc(name, args); },
  };
  const plan = update('many', atHydeInStock, [{ field: trailer('location'), to: lit('Bredbury') }]);
  const preview = await resolveProgramme(plan, { store: postgrestStore(counted) });
  if (!preview.ok) { ok('it resolves', false, preview.why); return; }
  const done = await executeProgramme(plan, { store: postgrestStore(counted), agreedHash: preview.hash });
  ok('two rows changed', done.ok && done.changed === 2, done.ok ? '' : done.why);
  ok('in exactly one transaction', calls === 1, String(calls));
});

test('the database refuses a column the registry does not allow', async () => {
  const db = fakeDb({ stock_trailers: trailerRows() });
  const { error } = await db.supabase.rpc('command_apply', {
    p_changes: [{ table: 'stock_trailers', id: 't1', set: { profit: 999 } }],
  });
  ok('it is refused', !!error, 'it was accepted');
  ok('naming the column', /may not write/.test(String((error as any)?.message)));
  ok('and nothing was written', db.writes.length === 0);
});

/* =============================================================
   Size is policy, not a limit on the language
   ============================================================= */

test('a large change is representable and resolvable', async () => {
  const many = trailerRows();
  for (let i = 0; i < 600; i++) {
    many.push({
      id: `x${i}`, stc_no: `STC9${i}`, status: 'in_stock', location: 'Hyde',
      category: 'curtainsider', retail_price: 1, nbv: 1, refurb_costs: 0,
      mot_date: '2029-01-01', notes: null,
    });
  }
  const db = fakeDb({ stock_trailers: many });
  const plan = update('many', atHydeInStock, [{ field: trailer('location'), to: lit('Bredbury') }]);

  const preview = await resolveProgramme(plan, { store: postgrestStore(db.supabase) });
  ok('602 records resolve without the language refusing',
    preview.ok && preview.changes.length === 602,
    preview.ok ? String(preview.changes.length) : preview.why);

  const policed = await resolveProgramme(plan, { store: postgrestStore(db.supabase), policy: { maxRows: 500 } });
  ok('and a configured ceiling blocks it as policy, not as incomprehension',
    !policed.ok && policed.reason === 'blocked by policy',
    policed.ok ? 'it was allowed' : policed.reason);
  ok('saying how many and what the ceiling is',
    !policed.ok && /602/.test(policed.why) && /500/.test(policed.why),
    policed.ok ? '' : policed.why);
});

/* =============================================================
   The fingerprint
   ============================================================= */

test('the fingerprint is over meaning, not order', async () => {
  const rows = [
    { id: 'b', label: 'B', before: { x: 1 } },
    { id: 'a', label: 'A', before: { x: 2 } },
  ];
  ok('row order does not change it',
    resolutionHash(rows, [], ['x']) === resolutionHash([rows[1], rows[0]], [], ['x']));
  ok('but a value does',
    resolutionHash(rows, [], ['x'])
    !== resolutionHash([{ id: 'a', label: 'A', before: { x: 3 } }, rows[0]], [], ['x']));
  ok('and so does the set of rows',
    resolutionHash(rows, [], ['x']) !== resolutionHash([rows[0]], [], ['x']));
});

test('the fields a mutation touches include what it reads', async () => {
  ok('nbv is in there',
    fieldsTouched({
      op: 'update', expect: 'one', target: { entity: 'trailers' },
      set: [{
        field: trailer('retail_price'),
        to: { kind: 'binary', op: '*', left: f('nbv'), right: lit(1.2) },
      }],
    }).join(',') === 'nbv,retail_price');
});

/* ============================================================= */

async function main() {
  for (const c of cases) {
    current = c.name;
    casesRun += 1;
    const before = failedAssertions;
    try {
      await c.run();
    } catch (e) {
      failedAssertions += 1;
      failures.push(`  [${c.name}] threw\n    ${e instanceof Error ? e.message : String(e)}`);
    }
    if (failedAssertions > before) casesFailed += 1;
  }
}

main().then(() => {
  console.log(`\n  ${casesRun - casesFailed}/${casesRun} cases passed.`);
  console.log(`  ${assertions - failedAssertions}/${assertions} assertions hold.\n`);
  if (failures.length) {
    console.log('  failures:');
    for (const f of failures.slice(0, 25)) console.log(f);
    if (failures.length > 25) console.log(`  and ${failures.length - 25} more`);
    console.log();
  }
  if (failedAssertions) process.exitCode = 1;
});
