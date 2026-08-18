/* =============================================================
   Typing a sentence, and the record changing.

   Every other check in this repository asserts about a part. This one
   asserts about the whole thing, from the words somebody types to the
   row afterwards, and it is deliberately black box: nothing here builds
   a Plan, names a column, or picks a record. It calls the same
   functions the route calls, with a sentence and an actor, and looks at
   what came out.

   That constraint is the point. A harness that constructs the plan it
   then executes is asserting that the executor works, which is already
   asserted elsewhere. What has never been asserted is that the sentence
   reaches the executor at all.

     raw text
       -> planAndPreview          the planning route's own call
       -> preview                 nothing written
       -> applyMutation           the apply route's own call
       -> Store.apply             one transaction

   THE SENTENCES ARE INPUTS, NOT FIXTURES.

   Nothing in the parser dictionaries was added to make these pass. If a
   sentence here stops working, the answer is a reader that reads less
   than it did, not an entry in a lexicon: a phrase listed to satisfy a
   test is a phrase that works in the test and nowhere near it.

     npm run check:acceptance
   ============================================================= */
import { fakeDb, type Row } from './support/fake-postgrest';
import { postgrestStore } from '../lib/command/store/postgrest';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { planAndPreview, applyMutation } from '../lib/command/server/mutation';
import { runEmit } from '../lib/command/server/emit';
import { capabilitiesFor } from '../lib/crm/permissions';
import { PROVIDER } from '../lib/crm/enrich';
import { LUSHA_GATE, LUSHA_LOCKED } from '../lib/crm/permissions';
import { FINDER } from '../lib/crm/finder';
import { fakeLedger } from './support/fake-ledger';
import type { FileStore } from '../lib/command/files';
import { planCommand } from '../lib/command/plan';
import { completedWith } from '../lib/command/ir/validate';
import { EMPTY_VOCABULARY, buildIndex } from '../lib/command/vocab';
import type { UserRole } from '../lib/types';

/* -------------------------------------------------------------
   Harness
   ------------------------------------------------------------- */

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

/** The actor, as the route derives one: a role and nothing else. */
const actor = (role: UserRole) => ({
  capabilities: [...capabilitiesFor({ role } as never)],
  /* The empty index, said out loud. A live vocabulary would make these
     assertions depend on what a database happened to hold. */
  vocabulary: async () => EMPTY_VOCABULARY,
});

const trailers = (): Row[] => [
  { id: 't1', stc_no: 'STC143580', status: 'in_stock', location: 'Hyde', category: 'curtainsider', retail_price: 20000, nbv: 15000, refurb_costs: 500, mot_date: '2027-03-14', notes: 'first note' },
  { id: 't2', stc_no: 'STC143581', status: 'in_stock', location: 'Hyde', category: 'curtainsider', retail_price: 24000, nbv: 18000, refurb_costs: 250, mot_date: '2027-06-01', notes: null },
  { id: 't3', stc_no: 'STC144504', status: 'sold', location: 'Hyde', category: 'curtainsider', retail_price: 30000, nbv: 22000, refurb_costs: 0, mot_date: '2026-12-01', notes: null },
  { id: 't4', stc_no: 'STC199999', status: 'in_stock', location: 'Carrington', category: 'curtainsider', retail_price: 21000, nbv: 16000, refurb_costs: 100, mot_date: '2028-01-01', notes: null },
  { id: 't5', stc_no: 'STC155555', status: 'in_stock', location: 'Hyde', category: 'fridge', retail_price: 40000, nbv: 30000, refurb_costs: 0, mot_date: '2028-06-01', notes: null },
];

const posts = (): Row[] => [
  { id: 'p1', content: 'TEST post one', platform: ['linkedin'], scheduled_date: '2026-09-01', status: 'pending_review', created_by: 'tester', hashtags: ['#a'] },
  { id: 'p2', content: 'TEST post two', platform: ['linkedin'], scheduled_date: '2026-09-02', status: 'draft', created_by: 'tester', hashtags: ['#a'] },
];

/** One round trip through the planning route's own call. */
async function plan(text: string, role: UserRole, db: ReturnType<typeof fakeDb>, preview = true) {
  return planAndPreview({
    text, ...actor(role), store: postgrestStore(db.supabase), preview,
  });
}

/* =============================================================
   1. One record, named
   ============================================================= */

test('set the retail price on STC143580 to £24,995', async () => {
  const db = fakeDb({ stock_trailers: trailers() });
  const text = 'set the retail price on STC143580 to £24,995';

  const planned = await plan(text, 'admin', db);
  ok('the sentence is understood', !!planned, 'nothing came back');
  if (!planned) return;

  ok('as an instruction rather than a question', planned.planned.planning.kind === 'mutate',
    planned.planned.planning.kind);
  ok('and the reading is offered as runnable', planned.planned.meaning.runnable,
    planned.planned.meaning.blocked.join('; '));

  const preview = planned.preview;
  ok('a preview came back', !!preview && preview.ok, preview && !preview.ok ? preview.why : '');
  if (!preview?.ok) return;

  ok('it names one field', preview.fields.length === 1, String(preview.fields.length));
  ok('and that field is the retail price',
    preview.fields[0]?.field === 'retail_price', preview.fields[0]?.field);
  ok('it names one record', preview.count === 1, String(preview.count));
  ok('and the record is the one that was typed',
    preview.rows[0]?.label === 'STC143580', preview.rows[0]?.label);
  ok('it shows what the record holds now', preview.rows[0]?.before === '£20,000', preview.rows[0]?.before);
  ok('and what it would hold', preview.rows[0]?.after === '£24,995', preview.rows[0]?.after);

  /* THE FIRST REQUEST WROTE NOTHING. */
  ok('nothing was written by the preview', db.writes.length === 0, JSON.stringify(db.writes));
  ok('and the row is untouched',
    db.tables.stock_trailers.find((r) => r.id === 't1')?.retail_price === 20000);

  const done = await applyMutation({
    text, ...actor('admin'), store: postgrestStore(db.supabase),
    previewPlanHash: planned.planned.meaning.hash,
    previewProgrammeHash: preview.programmeHash,
  });

  ok('confirming writes', done.ok, done.ok ? '' : done.why);
  ok('one record changed', done.ok && done.changed === 1, done.ok ? String(done.changed) : '');
  ok('the database ends at 24995',
    db.tables.stock_trailers.find((r) => r.id === 't1')?.retail_price === 24995,
    String(db.tables.stock_trailers.find((r) => r.id === 't1')?.retail_price));
  ok('and nothing else moved',
    db.tables.stock_trailers.filter((r) => r.retail_price !== 24995).length === 4);
});

/* =============================================================
   2. A described set
   ============================================================= */

test('move every available curtainsider at Hyde to Bredbury', async () => {
  const db = fakeDb({ stock_trailers: trailers() });
  const text = 'move every available curtainsider at Hyde to Bredbury';

  const planned = await plan(text, 'admin', db);
  ok('the sentence is understood', !!planned);
  if (!planned) return;
  ok('as an instruction', planned.planned.planning.kind === 'mutate', planned.planned.planning.kind);

  const preview = planned.preview;
  ok('a preview came back', !!preview && preview.ok, preview && !preview.ok ? preview.why : '');
  if (!preview?.ok) return;

  /* The selection composes three things the sentence said, and none of
     them is the depot it is moving them to. */
  ok('it changes the location', preview.fields[0]?.field === 'location', preview.fields[0]?.field);
  ok('two trailers match', preview.count === 2, String(preview.count));
  ok('and they are the two in stock curtainsiders at Hyde',
    preview.rows.map((r) => r.label).sort().join(',') === 'STC143580,STC143581',
    preview.rows.map((r) => r.label).join(','));
  ok('each shows Hyde becoming Bredbury',
    preview.rows.every((r) => r.before === 'Hyde' && r.after === 'Bredbury'),
    JSON.stringify(preview.rows));

  ok('nothing was written by the preview', db.writes.length === 0, JSON.stringify(db.writes));

  const done = await applyMutation({
    text, ...actor('admin'), store: postgrestStore(db.supabase),
    previewPlanHash: planned.planned.meaning.hash,
    previewProgrammeHash: preview.programmeHash,
  });

  ok('confirming writes', done.ok, done.ok ? '' : done.why);
  ok('both rows changed', done.ok && done.changed === 2, done.ok ? String(done.changed) : '');
  ok('the two curtainsiders are at Bredbury',
    ['t1', 't2'].every((id) => db.tables.stock_trailers.find((r) => r.id === id)?.location === 'Bredbury'));
  ok('the sold one at Hyde was not moved',
    db.tables.stock_trailers.find((r) => r.id === 't3')?.location === 'Hyde');
  ok('the fridge at Hyde was not moved',
    db.tables.stock_trailers.find((r) => r.id === 't5')?.location === 'Hyde');
  ok('and Carrington was not touched',
    db.tables.stock_trailers.find((r) => r.id === 't4')?.location === 'Carrington');
});

/* =============================================================
   3. Ambiguity
   ============================================================= */

test('a sentence about one record that matches several asks', async () => {
  const db = fakeDb({ stock_trailers: trailers() });
  /* STC1435 is the front of two stock numbers. The sentence says one
     record, so several is a question rather than permission. */
  const planned = await plan('set the retail price on STC1435 to 24995', 'admin', db);
  ok('it is still read as an instruction', planned?.planned.planning.kind === 'mutate');
  const preview = planned?.preview;
  ok('the preview refuses', !!preview && !preview.ok, 'it previewed a change');
  if (!preview || preview.ok) return;

  ok('as an ambiguity rather than a failure', preview.reason === 'unresolved', preview.reason);
  ok('and it hands back the candidates rather than choosing',
    (preview.candidates?.length ?? 0) === 2, String(preview.candidates?.length));
  ok('nothing was written', db.writes.length === 0);
});

test('a sentence that matches nothing says so', async () => {
  const db = fakeDb({ stock_trailers: trailers() });
  const planned = await plan('set the retail price on STC000000 to 24995', 'admin', db);
  const preview = planned?.preview;
  ok('the preview refuses', !!preview && !preview.ok);
  if (!preview || preview.ok) return;
  ok('and says nothing matched', /matches/.test(preview.why), preview.why);
  ok('nothing was written', db.writes.length === 0);
});

/* =============================================================
   4. Permission
   ============================================================= */

test('a marketer cannot reassign an account', async () => {
  const db = fakeDb({
    crm_contacts: [{ id: 'c1', company_name: 'Dawson Group', assigned_to: 'Alex', status: 'lead' }],
  });
  const text = 'assign Dawson Group to Dave';

  const planned = await plan(text, 'marketer', db);
  /* The field is not one this actor may write, so the instruction
     reader does not read it as an instruction at all. Either way, what
     must not happen is a write. */
  const asMutation = planned?.planned.planning.kind === 'mutate';
  ok('it is not offered as a runnable instruction',
    !asMutation || planned?.planned.meaning.runnable === false,
    `kind ${planned?.planned.planning.kind}, runnable ${planned?.planned.meaning.runnable}`);

  const done = await applyMutation({
    text, ...actor('marketer'), store: postgrestStore(db.supabase),
    previewPlanHash: planned?.planned.meaning.hash ?? 'x',
    previewProgrammeHash: 'x',
  });
  ok('and confirming it writes nothing', !done.ok, done.ok ? 'it wrote' : '');
  ok('nothing reached the database', db.writes.length === 0, JSON.stringify(db.writes));
  ok('the owner is unchanged', db.tables.crm_contacts[0].assigned_to === 'Alex');
});

test('an admin can reassign the same account', async () => {
  const db = fakeDb({
    crm_contacts: [{ id: 'c1', company_name: 'Dawson Group', assigned_to: 'Alex', status: 'lead' }],
  });
  const text = 'assign Dawson Group to Dave';
  const planned = await plan(text, 'admin', db);
  ok('an admin gets an instruction', planned?.planned.planning.kind === 'mutate',
    String(planned?.planned.planning.kind));
  const preview = planned?.preview;
  ok('and a preview', !!preview?.ok, preview && !preview.ok ? preview.why : '');
  if (!preview?.ok) return;
  ok('naming crm.assign as what it needs',
    preview.fields.some((f) => f.requires === 'crm.assign'),
    preview.fields.map((f) => f.requires).join(','));

  const done = await applyMutation({
    text, ...actor('admin'), store: postgrestStore(db.supabase),
    previewPlanHash: planned!.planned.meaning.hash,
    previewProgrammeHash: preview.programmeHash,
  });
  ok('and it goes through', done.ok, done.ok ? '' : done.why);
  ok('the owner is Dave', db.tables.crm_contacts[0].assigned_to === 'Dave',
    String(db.tables.crm_contacts[0].assigned_to));
});

test('a marketer cannot approve a social post', async () => {
  const db = fakeDb({ social_posts: posts() });
  const text = 'mark all outstanding social posts as approved';

  const planned = await plan(text, 'marketer', db);
  const asMutation = planned?.planned.planning.kind === 'mutate';
  ok('it is not offered as a runnable instruction',
    !asMutation || planned?.planned.meaning.runnable === false,
    `kind ${planned?.planned.planning.kind}, runnable ${planned?.planned.meaning.runnable}`);

  const done = await applyMutation({
    text, ...actor('marketer'), store: postgrestStore(db.supabase),
    previewPlanHash: planned?.planned.meaning.hash ?? 'x',
    previewProgrammeHash: 'x',
  });
  ok('confirming writes nothing', !done.ok);
  ok('the post is still awaiting review',
    db.tables.social_posts.find((r) => r.id === 'p1')?.status === 'pending_review');
});

test('an admin approving the same posts is previewed and executes', async () => {
  const db = fakeDb({ social_posts: posts() });
  const text = 'mark all outstanding social posts as approved';

  const planned = await plan(text, 'admin', db);
  ok('an admin gets an instruction', planned?.planned.planning.kind === 'mutate',
    String(planned?.planned.planning.kind));
  const preview = planned?.preview;
  ok('and a preview', !!preview?.ok, preview && !preview.ok ? preview.why : '');
  if (!preview?.ok) return;

  ok('it selects the one awaiting review, not the draft', preview.count === 1, String(preview.count));
  ok('showing the state it is in', preview.rows[0]?.before === 'pending review', preview.rows[0]?.before);
  ok('and the state it goes to', preview.rows[0]?.after === 'approved', preview.rows[0]?.after);

  const done = await applyMutation({
    text, ...actor('admin'), store: postgrestStore(db.supabase),
    previewPlanHash: planned!.planned.meaning.hash,
    previewProgrammeHash: preview.programmeHash,
  });
  ok('it goes through', done.ok, done.ok ? '' : done.why);
  ok('the post is approved',
    db.tables.social_posts.find((r) => r.id === 'p1')?.status === 'approved');
  ok('and the draft was left alone',
    db.tables.social_posts.find((r) => r.id === 'p2')?.status === 'draft');
});

/* =============================================================
   5. Drift
   ============================================================= */

test('a record that moved between preview and confirm is not written', async () => {
  const db = fakeDb({ stock_trailers: trailers() });
  const text = 'set the retail price on STC143580 to £24,995';

  const planned = await plan(text, 'admin', db);
  const preview = planned?.preview;
  ok('it previewed', !!preview?.ok);
  if (!preview?.ok) return;

  /* Somebody else, in the seconds between. */
  db.tables.stock_trailers.find((r) => r.id === 't1')!.retail_price = 21500;

  const done = await applyMutation({
    text, ...actor('admin'), store: postgrestStore(db.supabase),
    previewPlanHash: planned!.planned.meaning.hash,
    previewProgrammeHash: preview.programmeHash,
  });

  ok('it refuses', !done.ok, done.ok ? 'it wrote anyway' : '');
  ok('as drift', !done.ok && done.reason === 'drift', done.ok ? '' : done.reason);
  ok('and hands back a fresh preview rather than an error',
    !done.ok && done.preview?.ok === true, done.ok ? '' : String(done.preview?.ok));
  ok('showing what the record holds now',
    !done.ok && done.preview?.ok === true && done.preview.rows[0]?.before === '£21,500',
    !done.ok && done.preview?.ok ? done.preview.rows[0]?.before : '');
  ok('nothing was written', db.writes.length === 0, JSON.stringify(db.writes));
  ok('the other person\'s value survives',
    db.tables.stock_trailers.find((r) => r.id === 't1')?.retail_price === 21500);
});

test('a confirmation with no hashes writes nothing', async () => {
  const db = fakeDb({ stock_trailers: trailers() });
  const done = await applyMutation({
    text: 'set the retail price on STC143580 to £24,995',
    ...actor('admin'), store: postgrestStore(db.supabase),
    previewPlanHash: '', previewProgrammeHash: '',
  });
  ok('it refuses', !done.ok);
  ok('because the meaning was never agreed to',
    !done.ok && done.reason === 'meaning changed', done.ok ? '' : done.reason);
  ok('nothing was written', db.writes.length === 0);
});

/* =============================================================
   6. Arithmetic, in bulk
   ============================================================= */

test('add 250 to the refurb cost on STC143580', async () => {
  const db = fakeDb({ stock_trailers: trailers() });
  const text = 'add 250 refurb costs to STC143580';

  const planned = await plan(text, 'admin', db);
  ok('it is an instruction', planned?.planned.planning.kind === 'mutate',
    String(planned?.planned.planning.kind));
  const preview = planned?.preview;
  ok('it previewed', !!preview?.ok, preview && !preview.ok ? preview.why : '');
  if (!preview?.ok) return;

  /* The arithmetic is done from the row's own value, so the preview
     shows the sum rather than the amount. */
  ok('the preview shows what it holds now', preview.rows[0]?.before === '£500', preview.rows[0]?.before);
  ok('and the total it would hold', preview.rows[0]?.after === '£750', preview.rows[0]?.after);

  const done = await applyMutation({
    text, ...actor('admin'), store: postgrestStore(db.supabase),
    previewPlanHash: planned!.planned.meaning.hash,
    previewProgrammeHash: preview.programmeHash,
  });
  ok('it goes through', done.ok, done.ok ? '' : done.why);
  ok('and the row holds 750',
    db.tables.stock_trailers.find((r) => r.id === 't1')?.refurb_costs === 750,
    String(db.tables.stock_trailers.find((r) => r.id === 't1')?.refurb_costs));
});

test('a bulk arithmetic change starts from each row\'s own value', async () => {
  const db = fakeDb({ stock_trailers: trailers() });
  const text = 'add 250 refurb costs to every available curtainsider at Hyde';

  const planned = await plan(text, 'admin', db);
  ok('it is an instruction', planned?.planned.planning.kind === 'mutate',
    String(planned?.planned.planning.kind));
  const preview = planned?.preview;
  ok('it previewed', !!preview?.ok, preview && !preview.ok ? preview.why : '');
  if (!preview?.ok) return;

  ok('two rows match', preview.count === 2, String(preview.count));
  /* THE REASON A PREVIEW CANNOT SHOW ONE SHARED "BEFORE".
     One row holds £500 and the other £250, so a single line saying
     "£500 becomes £750" is true of one of them and false of the other. */
  ok('the rows do not share a before and after', !preview.uniform, 'they were reported as uniform');
  const byLabel = Object.fromEntries(preview.rows.map((r) => [r.label, r]));
  ok('the first goes from 500 to 750',
    byLabel.STC143580?.before === '£500' && byLabel.STC143580?.after === '£750',
    JSON.stringify(byLabel.STC143580));
  ok('and the second from 250 to 500',
    byLabel.STC143581?.before === '£250' && byLabel.STC143581?.after === '£500',
    JSON.stringify(byLabel.STC143581));

  const done = await applyMutation({
    text, ...actor('admin'), store: postgrestStore(db.supabase),
    previewPlanHash: planned!.planned.meaning.hash,
    previewProgrammeHash: preview.programmeHash,
  });
  ok('it goes through', done.ok, done.ok ? '' : done.why);
  ok('each row got its own sum',
    db.tables.stock_trailers.find((r) => r.id === 't1')?.refurb_costs === 750
    && db.tables.stock_trailers.find((r) => r.id === 't2')?.refurb_costs === 500,
    JSON.stringify(db.tables.stock_trailers.map((r) => [r.id, r.refurb_costs])));
});

/* =============================================================
   7. Steps that need each other, through the runtime
   ============================================================= */

test('a plan whose second step needs the first is ordered by the runtime', async () => {
  const db = fakeDb({ stock_trailers: trailers() });
  const planned = await plan('set the retail price on STC143580 to £24,995', 'admin', db);
  ok('it planned', !!planned?.preview?.ok);
  if (!planned?.preview?.ok) return;

  /* One sentence produces one step today, so the dependence is
     introduced here, at the plan the runtime is given. What is being
     asserted is that `previewMutation` RESOLVES it in order rather than
     refusing it, which is the path a multi step sentence takes. */
  const plan2 = structuredClone(planned.planned.planning.plan);
  plan2.steps.push({
    op: 'update', id: 's2', expect: 'one', target: { entity: 'trailers' },
    match: {
      op: 'select', from: { entity: 'trailers' },
      where: { kind: 'cmp', op: 'contains', left: { kind: 'field', of: { entity: 'trailers', field: 'stc_no' } }, right: { kind: 'literal', value: 'STC143581' } },
      produces: { kind: 'rows', entity: 'trailers' },
    },
    set: [{
      field: { entity: 'trailers', field: 'nbv' },
      to: {
        kind: 'binary', op: '-',
        left: { kind: 'field', of: { entity: 'trailers', field: 'retail_price' } },
        right: { kind: 'literal', value: 1000 },
      },
    }],
    produces: { kind: 'rows', entity: 'trailers' },
  });

  const { previewMutation } = await import('../lib/command/server/mutation');
  const preview = await previewMutation(
    { ...planned.planned.planning, plan: plan2 },
    postgrestStore(db.supabase),
  );
  ok('it previews', preview.ok, preview.ok ? '' : preview.why);
  ok('with both steps in it', preview.ok && preview.rows.length === 2,
    preview.ok ? String(preview.rows.length) : '');
  ok('and nothing was written', db.writes.length === 0, JSON.stringify(db.writes));
});

/* =============================================================
   8. A business operation, not a status column

   Selling is three writes that have to happen together, and the
   sentence names units while the operation runs on the deal each unit
   is being sold on. Nothing in these cases names a column.
   ============================================================= */

const YARD_WITH_DEALS = () => fakeDb({
  stock_trailers: [
    { id: 'u1', stc_no: 'STC143580', status: 'in_stock', category: 'Curtainsider', location: 'Hyde', sales_price: null, customer: null, sales_rep: null },
    { id: 'u2', stc_no: 'STC143581', status: 'in_stock', category: 'Curtainsider', location: 'Hyde', sales_price: null, customer: null, sales_rep: null },
    { id: 'u3', stc_no: 'STC155555', status: 'in_stock', category: 'Fridge', location: 'Hyde', sales_price: null, customer: null, sales_rep: null },
    { id: 'u4', stc_no: 'STC166666', status: 'in_stock', category: 'Curtainsider', location: 'Hyde', sales_price: null, customer: null, sales_rep: null },
  ],
  crm_contacts: [
    { id: 'd1', company_name: 'Dawson Group', stock_trailer_id: 'u1', sale_price: 24995, profit: 3000, commission_rate: 0.1, status: 'quoted' },
    { id: 'd2', company_name: 'Wincanton', stock_trailer_id: 'u2', sale_price: 31000, profit: 4000, commission_rate: 0.1, status: 'quoted' },
    { id: 'd3', company_name: 'Culina', stock_trailer_id: 'u3', sale_price: null, profit: null, commission_rate: 0.1, status: 'quoted' },
  ],
});

test('mark all the in stock curtainsiders as sold', async () => {
  const db = YARD_WITH_DEALS();
  const text = 'mark all the in stock curtainsiders as sold';

  const planned = await plan(text, 'admin', db);
  ok('it is an instruction', planned?.planned.planning.kind === 'mutate',
    String(planned?.planned.planning.kind));
  ok('and it is an operation rather than a field write',
    planned?.planned.planning.plan.steps[0]?.op === 'invoke',
    planned?.planned.planning.plan.steps.map((s) => s.op).join(','));

  const preview = planned?.preview;
  ok('a preview came back', !!preview?.ok, preview && !preview.ok ? preview.why : '');
  if (!preview?.ok) return;

  /* Three curtainsiders are in stock. Two are being sold to somebody
     and one is not, so the operation runs on two deals and says why the
     third is not in the list. */
  ok('it names the deals rather than the units',
    preview.operations[0]?.subjects.map((s) => s.label).sort().join(',') === 'Dawson Group,Wincanton',
    JSON.stringify(preview.operations[0]?.subjects));
  ok('showing which unit each one is for',
    preview.operations[0]?.subjects.every((s) => !!s.via),
    JSON.stringify(preview.operations[0]?.subjects));
  ok('and the unit with no deal is reported rather than dropped',
    preview.operations[0]?.skipped.some((m) => m.label === 'STC166666'),
    JSON.stringify(preview.operations[0]?.skipped));
  ok('nothing was written by the preview', db.writes.length === 0, JSON.stringify(db.writes));

  const done = await applyMutation({
    text, ...actor('admin'), store: postgrestStore(db.supabase),
    previewPlanHash: planned!.planned.meaning.hash,
    previewProgrammeHash: preview.programmeHash,
  });

  ok('confirming performs the sale', done.ok, done.ok ? '' : done.why);
  ok('on both deals', done.ok && done.changed === 2, done.ok ? String(done.changed) : '');

  /* All three parts of the operation, which is why it is an operation. */
  ok('the deals are won',
    db.tables.crm_contacts.filter((r) => r.status === 'customer').length === 2,
    JSON.stringify(db.tables.crm_contacts.map((r) => [r.company_name, r.status])));
  ok('the units are sold',
    ['u1', 'u2'].every((id) => db.tables.stock_trailers.find((r) => r.id === id)?.status === 'sold'));
  ok('with the buyer on them',
    db.tables.stock_trailers.find((r) => r.id === 'u1')?.customer === 'Dawson Group');
  ok('and a commission line was raised',
    db.tables.crm_contacts.find((r) => r.id === 'd1')?.commission === 300,
    String(db.tables.crm_contacts.find((r) => r.id === 'd1')?.commission));
  ok('the fridge was not sold',
    db.tables.stock_trailers.find((r) => r.id === 'u3')?.status === 'in_stock');
  ok('nor the curtainsider nobody is buying',
    db.tables.stock_trailers.find((r) => r.id === 'u4')?.status === 'in_stock');
});

test('a sale with no price anywhere says which deals and stops', async () => {
  const db = YARD_WITH_DEALS();
  /* The Culina deal has no price on it. The sentence gives none either,
     and a sale recorded at nothing is worse than a sale not recorded. */
  db.tables.crm_contacts.find((r) => r.id === 'd1')!.sale_price = null;

  const planned = await plan('mark all the in stock curtainsiders as sold', 'admin', db);
  const preview = planned?.preview;
  ok('the preview refuses', !!preview && !preview.ok, 'it previewed a sale');
  if (!preview || preview.ok) return;

  ok('naming what is missing', /sale price/.test(preview.why), preview.why);
  ok('and which deal it is missing on', /Dawson Group/.test(preview.why), preview.why);
  ok('nothing was written', db.writes.length === 0);
});

test('the same sale with a price in the sentence goes through', async () => {
  const db = YARD_WITH_DEALS();
  db.tables.crm_contacts.find((r) => r.id === 'd1')!.sale_price = null;
  const text = 'mark all the in stock curtainsiders as sold for £30,000';

  const planned = await plan(text, 'admin', db);
  const preview = planned?.preview;
  ok('it previews', !!preview?.ok, preview && !preview.ok ? preview.why : '');
  if (!preview?.ok) return;

  const done = await applyMutation({
    text, ...actor('admin'), store: postgrestStore(db.supabase),
    previewPlanHash: planned!.planned.meaning.hash,
    previewProgrammeHash: preview.programmeHash,
  });
  ok('the sale goes through', done.ok, done.ok ? '' : done.why);
  ok('at the price the sentence gave',
    db.tables.stock_trailers.find((r) => r.id === 'u1')?.sales_price === 30000,
    String(db.tables.stock_trailers.find((r) => r.id === 'u1')?.sales_price));
});

test('a stock number is not a price', async () => {
  const db = YARD_WITH_DEALS();
  /* Six digits after STC is a reference, not an amount. Reading it as
     one sold a trailer for one hundred and forty three thousand pounds. */
  const planned = await plan('mark STC143580 as sold', 'admin', db);
  const preview = planned?.preview;
  ok('it previews', !!preview?.ok, preview && !preview.ok ? preview.why : '');
  if (!preview?.ok) return;

  const done = await applyMutation({
    text: 'mark STC143580 as sold', ...actor('admin'), store: postgrestStore(db.supabase),
    previewPlanHash: planned!.planned.meaning.hash,
    previewProgrammeHash: preview.programmeHash,
  });
  ok('it sells', done.ok, done.ok ? '' : done.why);
  ok('at the price on the deal, not the stock number',
    db.tables.stock_trailers.find((r) => r.id === 'u1')?.sales_price === 24995,
    String(db.tables.stock_trailers.find((r) => r.id === 'u1')?.sales_price));
});

test('somebody without stock.edit cannot sell', async () => {
  const db = YARD_WITH_DEALS();
  const text = 'mark STC143580 as sold';
  const planned = await plan(text, 'viewer', db);
  const runnable = planned?.planned.planning.kind === 'mutate' && planned.planned.meaning.runnable;
  ok('it is not offered', !runnable, 'it was offered');

  const done = await applyMutation({
    text, ...actor('viewer'), store: postgrestStore(db.supabase),
    previewPlanHash: planned?.planned.meaning.hash ?? 'x',
    previewProgrammeHash: 'x',
  });
  ok('and confirming it does nothing', !done.ok, done.ok ? 'it sold' : '');
  ok('nothing was written', db.writes.length === 0);
});

/* =============================================================
   9. Making a record, and getting rid of one

   The other two ways a row's life changes, through the same allowlist
   and the same transaction as changing one. Neither has an entity
   specific handler.
   ============================================================= */

test('create a new lead for Smith Logistics', async () => {
  const db = fakeDb({ crm_contacts: [] });
  const text = 'create a new lead for Smith Logistics';

  const planned = await plan(text, 'admin', db);
  ok('it is an instruction', planned?.planned.planning.kind === 'mutate',
    String(planned?.planned.planning.kind));
  ok('and the step creates a record',
    planned?.planned.planning.plan.steps[0]?.op === 'create',
    planned?.planned.planning.plan.steps.map((s) => s.op).join(','));

  const preview = planned?.preview;
  ok('a preview came back', !!preview?.ok, preview && !preview.ok ? preview.why : '');
  if (!preview?.ok) return;
  ok('nothing was written by the preview', db.writes.length === 0);

  const done = await applyMutation({
    text, ...actor('admin'), store: postgrestStore(db.supabase),
    previewPlanHash: planned!.planned.meaning.hash,
    previewProgrammeHash: preview.programmeHash,
  });
  ok('confirming creates it', done.ok, done.ok ? '' : done.why);
  ok('there is now one contact', db.tables.crm_contacts.length === 1,
    String(db.tables.crm_contacts.length));
  ok('with the name that was typed',
    db.tables.crm_contacts[0]?.company_name === 'Smith Logistics',
    String(db.tables.crm_contacts[0]?.company_name));
  /* The noun said what kind of record it is, from the same vocabulary a
     question about leads narrows on. */
  ok('and the status the noun implied',
    db.tables.crm_contacts[0]?.status === 'lead',
    String(db.tables.crm_contacts[0]?.status));
});

test('new trailer STC142345', async () => {
  const db = fakeDb({ stock_trailers: [] });
  const text = 'new trailer STC142345';
  const planned = await plan(text, 'admin', db);
  const preview = planned?.preview;
  ok('it previews', !!preview?.ok, preview && !preview.ok ? preview.why : '');
  if (!preview?.ok) return;

  const done = await applyMutation({
    text, ...actor('admin'), store: postgrestStore(db.supabase),
    previewPlanHash: planned!.planned.meaning.hash,
    previewProgrammeHash: preview.programmeHash,
  });
  ok('it is created', done.ok, done.ok ? '' : done.why);
  ok('with its stock number', db.tables.stock_trailers[0]?.stc_no === 'STC142345',
    String(db.tables.stock_trailers[0]?.stc_no));
});

test('delete STC143580', async () => {
  const db = fakeDb({ stock_trailers: trailers() });
  const text = 'delete STC143580';

  const planned = await plan(text, 'admin', db);
  ok('it is an instruction', planned?.planned.planning.kind === 'mutate');
  ok('and the step deletes',
    planned?.planned.planning.plan.steps[0]?.op === 'delete',
    planned?.planned.planning.plan.steps.map((s) => s.op).join(','));

  const preview = planned?.preview;
  ok('a preview came back', !!preview?.ok, preview && !preview.ok ? preview.why : '');
  if (!preview?.ok) return;
  ok('naming the record', preview.rows[0]?.label === 'STC143580', preview.rows[0]?.label);
  ok('nothing was deleted by the preview', db.tables.stock_trailers.length === 5,
    String(db.tables.stock_trailers.length));

  const done = await applyMutation({
    text, ...actor('admin'), store: postgrestStore(db.supabase),
    previewPlanHash: planned!.planned.meaning.hash,
    previewProgrammeHash: preview.programmeHash,
  });
  ok('confirming deletes it', done.ok, done.ok ? '' : done.why);
  ok('and it is gone',
    !db.tables.stock_trailers.some((r) => r.stc_no === 'STC143580'),
    db.tables.stock_trailers.map((r) => r.stc_no).join(','));
  ok('and nothing else went with it', db.tables.stock_trailers.length === 4,
    String(db.tables.stock_trailers.length));
});

test('a deletion needs crm.delete', async () => {
  const db = fakeDb({ stock_trailers: trailers() });
  const text = 'delete STC143580';
  /* A marketer may edit a trailer and may not delete one, which is what
     `crm_delete` says in the schema too. */
  const planned = await plan(text, 'marketer', db);
  const runnable = planned?.planned.planning.kind === 'mutate' && planned.planned.meaning.runnable;
  ok('it is not offered', !runnable, 'it was offered');

  const done = await applyMutation({
    text, ...actor('marketer'), store: postgrestStore(db.supabase),
    previewPlanHash: planned?.planned.meaning.hash ?? 'x',
    previewProgrammeHash: 'x',
  });
  ok('and confirming does nothing', !done.ok);
  ok('the trailer is still there', db.tables.stock_trailers.length === 5);
});

test('deleting a field is not deleting a record', async () => {
  const db = fakeDb({ stock_trailers: trailers() });
  /* "Delete the customer on STC143580" empties a column. The record
     stays, which is the whole difference between the two sentences. */
  const text = 'delete the customer on STC143580';
  const planned = await plan(text, 'admin', db);
  ok('it is an update, not a delete',
    planned?.planned.planning.plan.steps[0]?.op === 'update',
    planned?.planned.planning.plan.steps.map((s) => s.op).join(','));
  const preview = planned?.preview;
  if (!preview?.ok) { ok('it previews', false, preview ? preview.why : 'none'); return; }

  const done = await applyMutation({
    text, ...actor('admin'), store: postgrestStore(db.supabase),
    previewPlanHash: planned!.planned.meaning.hash,
    previewProgrammeHash: preview.programmeHash,
  });
  ok('it goes through', done.ok, done.ok ? '' : done.why);
  ok('and every trailer is still there', db.tables.stock_trailers.length === 5);
});

test('a described set is never deleted', async () => {
  const db = fakeDb({ stock_trailers: trailers() });
  /* There is no undo. A deletion names its record. */
  const planned = await plan('delete all the sold trailers', 'admin', db);
  const deletes = planned?.planned.planning.plan.steps.some((s) => s.op === 'delete');
  ok('it does not become a bulk delete', !deletes,
    planned?.planned.planning.plan.steps.map((s) => s.op).join(','));
  ok('and nothing was deleted', db.tables.stock_trailers.length === 5);
});

/* =============================================================
   10. Pointing at the screen

   Half of what people type at a bar sitting above a screen is about
   what is on it. The screen sends what it has, the server plans with
   it, and every id is read back through the caller's own session before
   anything is done with it.
   ============================================================= */

const ID = (n: number) => `0000000${n}-0000-4000-8000-00000000000${n}`;

const SCREEN = () => fakeDb({
  crm_contacts: [
    { id: ID(1), company_name: 'Dawson Group', assigned_to: 'Alex', status: 'lead', notes: null },
    { id: ID(2), company_name: 'Wincanton', assigned_to: 'Alex', status: 'lead', notes: null },
    { id: ID(3), company_name: 'Culina', assigned_to: 'Alex', status: 'lead', notes: null },
  ],
  stock_trailers: [
    { id: ID(4), stc_no: 'STC143580', status: 'in_stock', location: 'Hyde', category: 'Curtainsider' },
    { id: ID(5), stc_no: 'STC143581', status: 'in_stock', location: 'Hyde', category: 'Curtainsider' },
    { id: ID(6), stc_no: 'STC144504', status: 'in_stock', location: 'Hyde', category: 'Curtainsider' },
  ],
});

async function withContext(text: string, db: ReturnType<typeof fakeDb>, context: object) {
  return planAndPreview({
    text, ...actor('admin'), store: postgrestStore(db.supabase), preview: true,
    context: context as never,
  });
}

test('add a note to this customer', async () => {
  const db = SCREEN();
  const text = 'add a note to this customer: chasing tyre quote';
  const context = { record: { entity: 'contacts', id: ID(1), label: 'Dawson Group' } };

  const planned = await withContext(text, db, context);
  ok('it is an instruction', planned?.planned.planning.kind === 'mutate',
    String(planned?.planned.planning.kind));
  const preview = planned?.preview;
  ok('it previews', !!preview?.ok, preview && !preview.ok ? preview.why : '');
  if (!preview?.ok) return;

  ok('against exactly the open record', preview.count === 1, String(preview.count));
  ok('and it is the one that was open', preview.rows[0]?.label === 'Dawson Group',
    preview.rows[0]?.label);

  const done = await applyMutation({
    text, ...actor('admin'), store: postgrestStore(db.supabase), context: context as never,
    previewPlanHash: planned!.planned.meaning.hash,
    previewProgrammeHash: preview.programmeHash,
  });
  ok('it goes through', done.ok, done.ok ? '' : done.why);
  ok('the note is on the open record',
    db.tables.crm_contacts.find((r) => r.id === ID(1))?.notes === 'chasing tyre quote',
    String(db.tables.crm_contacts.find((r) => r.id === ID(1))?.notes));
  ok('and on nothing else',
    db.tables.crm_contacts.filter((r) => r.notes != null).length === 1);
});

test('move these trailers to Bredbury', async () => {
  const db = SCREEN();
  const text = 'move these trailers to Bredbury';
  const context = { selection: { entity: 'trailers', ids: [ID(4), ID(5)] } };

  const planned = await withContext(text, db, context);
  const preview = planned?.preview;
  ok('it previews', !!preview?.ok, preview && !preview.ok ? preview.why : '');
  if (!preview?.ok) return;
  ok('exactly the two that were ticked', preview.count === 2, String(preview.count));

  const done = await applyMutation({
    text, ...actor('admin'), store: postgrestStore(db.supabase), context: context as never,
    previewPlanHash: planned!.planned.meaning.hash,
    previewProgrammeHash: preview.programmeHash,
  });
  ok('both move', done.ok && done.changed === 2, done.ok ? String(done.changed) : done.why);
  ok('and the third is where it was',
    db.tables.stock_trailers.find((r) => r.id === ID(6))?.location === 'Hyde');
});

test('export these to Excel', async () => {
  const db = SCREEN();
  /* The sentence names no entity at all. The screen named it when
     somebody ticked the rows. */
  const planned = await withContext('export these to Excel', db, {
    selection: { entity: 'contacts', ids: [ID(1), ID(3)] },
  });
  ok('it is understood', !!planned);
  ok('as a read that produces a file',
    planned?.planned.planning.plan.steps.map((s) => s.op).join(',') === 'select,emit',
    planned?.planned.planning.plan.steps.map((s) => s.op).join(','));

  const out = await runEmit(planned!.planned.planning, {
    store: postgrestStore(db.supabase), actorName: 'Alex Ellis', now: new Date('2026-08-17'),
  });
  ok('a file came back', out.ok, out.ok ? '' : out.why);
  if (!out.ok || out.kind !== 'artefact') return;
  ok('holding the two that were ticked', out.rows === 2, String(out.rows));
  const body = new TextDecoder().decode(out.artefact.bytes);
  void body;
});

test('a context the server never received means nothing', async () => {
  const db = SCREEN();
  /* The same sentence, with nothing sent. It must not fall back to
     every trailer, and it must not act on whatever was open last. */
  const planned = await withContext('move these trailers to Bredbury', db, {});
  const isMutation = planned?.planned.planning.kind === 'mutate';
  ok('it is not an instruction about anything', !isMutation,
    String(planned?.planned.planning.kind));

  const done = await applyMutation({
    text: 'move these trailers to Bredbury', ...actor('admin'),
    store: postgrestStore(db.supabase),
    previewPlanHash: planned?.planned.meaning.hash ?? 'x',
    previewProgrammeHash: 'x',
  });
  ok('and nothing is written', !done.ok && db.writes.length === 0, done.ok ? 'it wrote' : '');
});

test('a selection of one kind does not answer a sentence about another', async () => {
  const db = SCREEN();
  /* Customers ticked, a sentence about trailers. Somebody has changed
     screen since they ticked, and acting on either set would be wrong. */
  const planned = await withContext('move these trailers to Bredbury', db, {
    selection: { entity: 'contacts', ids: [ID(1)] },
  });
  ok('it is not an instruction', planned?.planned.planning.kind !== 'mutate',
    String(planned?.planned.planning.kind));
  ok('and nothing was written', db.writes.length === 0);
});

test('the ids the screen sends are read through the actor\'s own session', async () => {
  const db = SCREEN();
  const text = 'move these trailers to Bredbury';
  /* One real id and one the browser made up. The made up one is not a
     row this session can see, so it narrows to nothing rather than
     widening to anything. */
  const context = { selection: { entity: 'trailers', ids: [ID(4), ID(9)] } };

  const planned = await withContext(text, db, context);
  const preview = planned?.preview;
  ok('it previews', !!preview?.ok, preview && !preview.ok ? preview.why : '');
  if (!preview?.ok) return;
  ok('against the one row that is really there', preview.count === 1, String(preview.count));

  const done = await applyMutation({
    text, ...actor('admin'), store: postgrestStore(db.supabase), context: context as never,
    previewPlanHash: planned!.planned.meaning.hash,
    previewProgrammeHash: preview.programmeHash,
  });
  ok('and one row moves', done.ok && done.changed === 1, done.ok ? String(done.changed) : done.why);
});

test('the context is part of the meaning, so changing it changes the hash', async () => {
  const db = SCREEN();
  const text = 'move these trailers to Bredbury';
  const two = await withContext(text, db, { selection: { entity: 'trailers', ids: [ID(4), ID(5)] } });
  const three = await withContext(text, db, { selection: { entity: 'trailers', ids: [ID(4), ID(5), ID(6)] } });

  ok('two selected and three selected are different commands',
    two?.planned.meaning.hash !== three?.planned.meaning.hash,
    `${two?.planned.meaning.hash} vs ${three?.planned.meaning.hash}`);

  /* And a hash agreed against two cannot be used to write three. */
  const done = await applyMutation({
    text, ...actor('admin'), store: postgrestStore(db.supabase),
    context: { selection: { entity: 'trailers', ids: [ID(4), ID(5), ID(6)] } } as never,
    previewPlanHash: two!.planned.meaning.hash,
    previewProgrammeHash: (two!.preview as { programmeHash: string }).programmeHash,
  });
  ok('so a reading agreed for two does not carry three', !done.ok,
    done.ok ? `it moved ${done.changed}` : '');
  ok('and nothing was written', db.writes.length === 0);
});

/* =============================================================
   11. Two writes where the second needs the first

   The orchestrator refuses a plan whose steps depend on each other,
   because it computes every change from the rows as they stand and
   applies them together. Making a list out of records is exactly that
   shape: the list has to exist before anything can go in it. The answer
   is not to relax the rule but to put the ordered pair somewhere that
   can order it, which is one database function.
   ============================================================= */

test('make a list of these called Tipper prospects', async () => {
  const db = SCREEN();
  const text = 'make a list of these called Tipper prospects';
  const context = { selection: { entity: 'contacts', ids: [ID(1), ID(2)] } };

  const planned = await withContext(text, db, context);
  ok('it is an instruction', planned?.planned.planning.kind === 'mutate',
    String(planned?.planned.planning.kind));
  ok('and it is an operation, not two writes',
    planned?.planned.planning.plan.steps[0]?.op === 'invoke',
    planned?.planned.planning.plan.steps.map((s) => s.op).join(','));

  const preview = planned?.preview;
  ok('it previews', !!preview?.ok, preview && !preview.ok ? preview.why : '');
  if (!preview?.ok) return;
  ok('naming the records that would go in it', preview.count === 2, String(preview.count));
  ok('nothing was written by the preview', db.writes.length === 0);

  const done = await applyMutation({
    text, ...actor('admin'), store: postgrestStore(db.supabase), context: context as never,
    previewPlanHash: planned!.planned.meaning.hash,
    previewProgrammeHash: preview.programmeHash,
  });
  ok('it goes through', done.ok, done.ok ? '' : done.why);
  ok('the list exists', db.tables.crm_lists?.length === 1,
    JSON.stringify(db.tables.crm_lists));
  ok('with the name that was typed',
    db.tables.crm_lists?.[0]?.name === 'Tipper prospects',
    String(db.tables.crm_lists?.[0]?.name));
  ok('and both records are in it',
    db.tables.crm_contacts.filter((r) => r.list_id === db.tables.crm_lists?.[0]?.id).length === 2);
  ok('the third one is not', db.tables.crm_contacts.find((r) => r.id === ID(3))?.list_id == null);
});

test('a list with no name is refused rather than named for you', async () => {
  const db = SCREEN();
  const planned = await withContext('create a list from these', db, {
    selection: { entity: 'contacts', ids: [ID(1)] },
  });
  const preview = planned?.preview;
  ok('the preview refuses', !!preview && !preview.ok, 'it previewed');
  if (!preview || preview.ok) return;
  ok('saying what is missing', /list name/.test(preview.why), preview.why);
  ok('and nothing was written', db.writes.length === 0);
});

test('somebody without crm.manageLists cannot make one', async () => {
  const db = SCREEN();
  const text = 'make a list of these called Tipper prospects';
  const planned = await planAndPreview({
    text, ...actor('marketer'), store: postgrestStore(db.supabase), preview: true,
    context: { selection: { entity: 'contacts', ids: [ID(1)] } } as never,
  });
  const runnable = planned?.planned.planning.kind === 'mutate' && planned.planned.meaning.runnable;
  ok('it is not offered', !runnable, 'it was offered');
  ok('and no list was made', !db.tables.crm_lists?.length);
});

/* =============================================================
   12. The set the sentence meant, or nothing

   Three ways a truncation could creep in, and none of them may.
   ============================================================= */

test('an operation over more records than a ceiling allows refuses', async () => {
  /* 501 deals against a ceiling of 500. Performing it on 500 of them
     would be atomic, would report success, and would be wrong. */
  const units: Record<string, unknown>[] = [];
  const deals: Record<string, unknown>[] = [];
  for (let i = 0; i < 501; i++) {
    units.push({
      id: `u${i}`, stc_no: `STC90${String(i).padStart(4, '0')}`,
      status: 'in_stock', category: 'Curtainsider', location: 'Hyde',
    });
    deals.push({
      id: `d${i}`, company_name: `Buyer ${i}`, stock_trailer_id: `u${i}`,
      sale_price: 1000, profit: 100, commission_rate: 0.1, status: 'quoted',
    });
  }
  const db = fakeDb({ stock_trailers: units, crm_contacts: deals });

  const planned = await plan('mark all the in stock curtainsiders as sold', 'admin', db, false);
  ok('it plans', !!planned);
  if (!planned) return;

  const { previewMutation } = await import('../lib/command/server/mutation');
  const preview = await previewMutation(
    planned.planned.planning, postgrestStore(db.supabase),
    { maxRows: 500 },
  );

  ok('the whole operation is refused', !preview.ok, 'it previewed');
  if (preview.ok) return;
  ok('saying it is more than it is allowed to act on',
    /more than 500|500/.test(preview.why), preview.why);
  ok('and nothing was written', db.writes.length === 0);
});

test('the same operation with no ceiling acts on every one of them', async () => {
  const units: Record<string, unknown>[] = [];
  const deals: Record<string, unknown>[] = [];
  for (let i = 0; i < 501; i++) {
    units.push({
      id: `u${i}`, stc_no: `STC90${String(i).padStart(4, '0')}`,
      status: 'in_stock', category: 'Curtainsider', location: 'Hyde',
    });
    deals.push({
      id: `d${i}`, company_name: `Buyer ${i}`, stock_trailer_id: `u${i}`,
      sale_price: 1000, profit: 100, commission_rate: 0.1, status: 'quoted',
    });
  }
  const db = fakeDb({ stock_trailers: units, crm_contacts: deals });

  const planned = await plan('mark all the in stock curtainsiders as sold', 'admin', db);
  const preview = planned?.preview;
  ok('it previews', !!preview?.ok, preview && !preview.ok ? preview.why : '');
  if (!preview?.ok) return;

  /* THE WHOLE SET, NOT A PAGE OF IT. The read pages under the surface;
     501 is deliberately more than one page. */
  ok('all 501 deals are in the preview', preview.count === 501, String(preview.count));

  const done = await applyMutation({
    text: 'mark all the in stock curtainsiders as sold', ...actor('admin'),
    store: postgrestStore(db.supabase),
    previewPlanHash: planned!.planned.meaning.hash,
    previewProgrammeHash: preview.programmeHash,
  });
  ok('and all 501 are sold', done.ok && done.changed === 501,
    done.ok ? String(done.changed) : done.why);
});

test('an export holds every row the selection describes', async () => {
  /* 6,001 rows, which is more than the flat five thousand that used to
     be applied to every format, and more than one page. */
  const many: Record<string, unknown>[] = [];
  for (let i = 0; i < 6001; i++) {
    many.push({
      id: `x${i}`, stc_no: `STC80${String(i).padStart(4, '0')}`,
      status: 'in_stock', location: 'Hyde', category: 'Curtainsider',
      sales_price: 1000 + i,
    });
  }
  const db = fakeDb({ stock_trailers: many });

  const planning = planCommand('export the in stock trailers as a CSV', {
    actorCapabilities: [...capabilitiesFor({ role: 'admin' } as never)],
  });
  const out = await runEmit(planning!, {
    store: postgrestStore(db.supabase), actorName: 'Alex Ellis', now: new Date('2026-08-17'),
  });
  ok('a file came back', out.ok, out.ok ? '' : out.why);
  if (!out.ok || out.kind !== 'artefact') return;
  ok('holding all 6,001 rows', out.rows === 6001, String(out.rows));

  const body = new TextDecoder().decode(out.artefact.bytes);
  ok('the first row is in it', body.includes('STC800000'));
  ok('and so is the last', body.includes('STC806000'));
});

test('a user asked limit is still honoured', async () => {
  const many: Record<string, unknown>[] = [];
  for (let i = 0; i < 300; i++) {
    many.push({
      id: `x${i}`, stc_no: `STC80${String(i).padStart(4, '0')}`,
      status: 'in_stock', location: 'Hyde', category: 'Curtainsider',
      sales_price: 1000 + i,
    });
  }
  const db = fakeDb({ stock_trailers: many });
  const planning = planCommand('export the 100 most expensive trailers in stock as a CSV', {
    actorCapabilities: [...capabilitiesFor({ role: 'admin' } as never)],
  });
  const out = await runEmit(planning!, {
    store: postgrestStore(db.supabase), actorName: 'Alex Ellis', now: new Date('2026-08-17'),
  });
  ok('a file came back', out.ok, out.ok ? '' : out.why);
  if (!out.ok || out.kind !== 'artefact') return;
  /* A limit the SENTENCE asked for is part of the answer. A limit the
     implementation imposes is not. */
  ok('holding exactly the hundred that were asked for', out.rows === 100, String(out.rows));
});

/* =============================================================
   13. When a sale happened is two columns and a rule
   ============================================================= */

test('sold in the last six months finds the dispatched and the ordered', async () => {
  const db = fakeDb({
    stock_trailers: [
      /* Gone out inside the period. */
      { id: 's1', stc_no: 'STC100001', status: 'sold', customer: 'Dawson Group', dispatch_date: '2026-06-14', order_date: '2026-05-01' },
      /* Sold and still in the yard, ordered inside the period. This is
         the one a period on dispatch_date alone misses, and at any
         moment it is most of the recent sales. */
      { id: 's2', stc_no: 'STC100002', status: 'sold', customer: 'Dawson Group', dispatch_date: null, order_date: '2026-07-02' },
      /* Ordered inside the period but dispatched long before it, which
         is not a sale in this period. */
      { id: 's3', stc_no: 'STC100003', status: 'sold', customer: 'Dawson Group', dispatch_date: '2024-01-01', order_date: '2026-07-02' },
      /* Neither. */
      { id: 's4', stc_no: 'STC100004', status: 'sold', customer: 'Dawson Group', dispatch_date: null, order_date: '2024-02-02' },
    ],
  });

  const planning = planCommand('export the trailers sold to Dawson in the last 6 months as a CSV', {
    actorCapabilities: [...capabilitiesFor({ role: 'admin' } as never)],
  });
  ok('it plans', !!planning);
  const out = await runEmit(planning!, {
    store: postgrestStore(db.supabase), actorName: 'Alex Ellis', now: new Date('2026-08-17'),
  });
  ok('a file came back', out.ok, out.ok ? '' : out.why);
  if (!out.ok || out.kind !== 'artefact') return;

  const body = new TextDecoder().decode(out.artefact.bytes);
  ok('the dispatched one is in it', body.includes('STC100001'));
  ok('and the one ordered but not dispatched yet', body.includes('STC100002'));
  ok('the one dispatched years ago is not', !body.includes('STC100003'));
  ok('nor the old one', !body.includes('STC100004'));
  ok('two rows', out.rows === 2, String(out.rows));
});

test('naming a date explicitly still means that date', async () => {
  const db = fakeDb({
    stock_trailers: [
      { id: 's1', stc_no: 'STC100001', status: 'sold', dispatch_date: '2026-06-14', order_date: '2026-05-01' },
      { id: 's2', stc_no: 'STC100002', status: 'sold', dispatch_date: null, order_date: '2026-07-02' },
    ],
  });
  /* "Dispatched" is about dispatch and nothing else, so the one still
     in the yard is not in it. */
  const planning = planCommand('export the trailers dispatched in the last 6 months as a CSV', {
    actorCapabilities: [...capabilitiesFor({ role: 'admin' } as never)],
  });
  const out = await runEmit(planning!, {
    store: postgrestStore(db.supabase), actorName: 'Alex Ellis', now: new Date('2026-08-17'),
  });
  ok('a file came back', out.ok, out.ok ? '' : out.why);
  if (!out.ok || out.kind !== 'artefact') return;
  ok('only the dispatched one', out.rows === 1, String(out.rows));
});

/* =============================================================
   14. A question is still a question
   ============================================================= */

test('a question does not become an instruction', async () => {
  const db = fakeDb({ stock_trailers: trailers() });
  const planned = await plan('how many trailers are at Hyde', 'admin', db);
  ok('it is understood', !!planned);
  ok('as a read', planned?.planned.planning.kind === 'read', String(planned?.planned.planning.kind));
  ok('and no preview was built for it', planned?.preview === null);

  const done = await applyMutation({
    text: 'how many trailers are at Hyde', ...actor('admin'),
    store: postgrestStore(db.supabase),
    previewPlanHash: planned!.planned.meaning.hash,
    previewProgrammeHash: 'x',
  });
  ok('and the write path refuses it', !done.ok && done.reason === 'not a mutation',
    done.ok ? 'it wrote' : done.reason);
  ok('nothing was written', db.writes.length === 0);
});

/* =============================================================
   15. Three clauses, one programme

   The sentence below is three things joined by commas and an "and",
   and reading it as three commands loses the only part that matters:
   "them" and "it" are what the clause before produced. Read that way,
   "export it to Excel" is a question about the word "it" and the file
   holds every customer in the database.
   ============================================================= */

const fleets = (): Row[] => [
  /* Two big fleets with no proposal against them, which is what the
     sentence describes. A proposal is `quoted` in this CRM. */
  { id: 'c1', company_name: 'Dawson Group', trailers: 40, status: 'lead',
    created_at: '2026-02-01', last_contact: '2026-02-01' },
  { id: 'c2', company_name: 'Pollock Haulage', trailers: 25, status: 'contacted',
    created_at: '2026-03-01', last_contact: '2026-03-01' },
  /* A big fleet that HAS had a proposal. */
  { id: 'c3', company_name: 'Eddie Stobart', trailers: 300, status: 'quoted',
    created_at: '2026-01-15', last_contact: '2026-01-15' },
  /* A small fleet with no proposal. */
  { id: 'c4', company_name: 'Corner Shop Logistics', trailers: 3, status: 'lead',
    created_at: '2026-04-01', last_contact: '2026-04-01' },
];

const FOUND = "find customers with more than 20 trailers who haven't had a proposal this year";
const PROGRAMME = `${FOUND}, create a list from them and export it to Excel`;
const NAMED = `${FOUND}, create a list called Fleet Prospects from them, export it to Excel`;

test('a three clause sentence becomes one wired programme', async () => {
  const planning = planCommand(PROGRAMME, {
    actorCapabilities: [...capabilitiesFor({ role: 'admin' } as never)],
  });
  ok('it plans', !!planning);
  if (!planning) return;

  const steps = planning.plan.steps;
  ok('as three steps and not three commands', steps.length === 3, String(steps.length));
  ok('a selection first', steps[0]?.op === 'select', String(steps[0]?.op));
  ok('then the list operation', steps[1]?.op === 'invoke', String(steps[1]?.op));
  ok('then the file', steps[2]?.op === 'emit', String(steps[2]?.op));

  /* The wiring is the whole point: each step names what the one before
     produced rather than describing rows of its own. */
  const invoke = steps[1] as { subject?: { ref?: string; step?: string } };
  ok('the list is made from the selection', invoke.subject?.ref === 'rows'
    && invoke.subject?.step === steps[0]?.id, JSON.stringify(invoke.subject));
  const emit = steps[2] as { from?: { ref?: string; step?: string } };
  ok('and the file comes from the list', !!emit.from?.ref && emit.from?.step === steps[1]?.id,
    JSON.stringify(emit.from));

  ok('nothing in it is unrepresentable', planning.availability.representable,
    JSON.stringify(planning.problems));
  ok('every part of it can run', planning.availability.executable,
    JSON.stringify(planning.availability.unavailable));
  ok('an admin may do all of it', planning.availability.permitted === true,
    JSON.stringify(planning.availability.missingPermissions));
});

test('a list nobody named is not created under a name this invented', async () => {
  /* `list.create` declares its name as a required input. The sentence
     above never gives one, so the whole programme stops and says which
     input is missing rather than filing the customers under something
     nobody will recognise later. */
  const db = fakeDb({ crm_contacts: fleets() });
  const planning = planCommand(PROGRAMME, {
    actorCapabilities: [...capabilitiesFor({ role: 'admin' } as never)],
  });
  const { previewMutation } = await import('../lib/command/server/mutation');
  const preview = await previewMutation(planning!, postgrestStore(db.supabase));
  ok('it does not preview', !preview.ok, 'it previewed');
  if (preview.ok) return;
  ok('and says the name is what it needs', /list name/i.test(preview.why), preview.why);
  ok('nothing was written', db.writes.length === 0);
});

test('the named form previews, runs and produces the file in one go', async () => {
  const db = fakeDb({ crm_contacts: fleets() });
  const planned = await plan(NAMED, 'admin', db);
  ok('it plans', !!planned);
  if (!planned) return;
  ok('as one programme', planned.planned.planning.plan.steps.length === 3,
    JSON.stringify(planned.planned.planning.plan.steps.map((s) => s.op)));

  const preview = planned.preview;
  ok('it previews', preview?.ok === true, preview && !preview.ok ? preview.why : 'no preview');
  if (!preview?.ok) return;
  ok('over the two big fleets with no proposal against them',
    preview.count === 2, String(preview.count));
  ok('and it says a file is coming too', preview.deliveries.length === 1,
    JSON.stringify(preview.deliveries));
  ok('nothing was written to build the preview', db.writes.length === 0);

  const done = await applyMutation({
    text: NAMED, ...actor('admin'),
    store: postgrestStore(db.supabase),
    previewPlanHash: planned.planned.meaning.hash,
    previewProgrammeHash: preview.programmeHash,
    actorName: 'Alex Ellis',
  });
  ok('it runs', done.ok, done.ok ? '' : done.why);
  if (!done.ok) return;
  ok('the list was made over both of them', done.changed === 2, String(done.changed));
  ok('and the file came back with it', !!done.artefact, 'no artefact');
  ok('holding the two the sentence described', done.artefactRows === 2, String(done.artefactRows));
  ok('as a spreadsheet', done.artefact?.filename.endsWith('.xlsx') === true,
    done.artefact?.filename ?? '');
});

test('the file holds the customers, not the list record', async () => {
  const db = fakeDb({ crm_contacts: fleets() });
  const planning = planCommand(NAMED, {
    actorCapabilities: [...capabilitiesFor({ role: 'admin' } as never)],
  });
  /* "It" is the list, and the list is a record. A file of that record
     would be one row holding a name. The rows are the ones the list was
     made from, which the emit resolves by following the dataflow. */
  const out = await runEmit(planning!, {
    store: postgrestStore(db.supabase), actorName: 'Alex Ellis', now: new Date('2026-08-17'),
  });
  ok('a file came back', out.ok, out.ok ? '' : out.why);
  if (!out.ok || out.kind !== 'artefact') return;
  ok('holding the two the sentence described', out.rows === 2, String(out.rows));
  ok('and it is a real workbook', out.artefact.bytes.length > 0);
});

test('a sentence with a period means the same thing a moment later', async () => {
  /* The plan hash exists to notice that a sentence has come to MEAN
     something else. A period resolved to the current instant made every
     such sentence mean something new every millisecond, so previewing
     one and then confirming it always came back as "what that means has
     changed since you looked at it". */
  const db = fakeDb({ crm_contacts: fleets() });
  const first = await plan(NAMED, 'admin', db, false);
  const second = await plan(NAMED, 'admin', db, false);
  ok('both plan', !!first && !!second);
  ok('and they are the same meaning',
    first?.planned.meaning.hash === second?.planned.meaning.hash,
    `${first?.planned.meaning.hash} vs ${second?.planned.meaning.hash}`);
});

/* =============================================================
   16. Sharing is access, and access is granted to a person

   Sharing in this CRM is list membership, which is what every read
   policy on contacts, notes and addresses already consults. So the bar
   grants the same thing the CRM screen grants, through the same table.
   ============================================================= */

const people = (): Row[] => [
  { id: 'p1', full_name: 'Dave Smith', email: 'dave@stc.co.uk', role: 'sales' },
  { id: 'p2', full_name: 'Tom Jones', email: 'tom@stc.co.uk', role: 'sales' },
];

const onAList = (): Row[] => [
  { id: 'c1', company_name: 'Dawson Group', trailers: 40, status: 'lead', location: 'Hyde', list_id: 'L1' },
  { id: 'c2', company_name: 'Pollock Haulage', trailers: 25, status: 'lead', location: 'Hyde', list_id: 'L1' },
];

test('sharing a selection with a colleague grants them access to it', async () => {
  const db = fakeDb({
    crm_contacts: onAList(),
    crm_lists: [{ id: 'L1', name: 'Fleet Prospects', is_global: false }],
    profiles: people(),
  });
  const planning = planCommand('share the customers in Hyde with Dave and Tom', {
    actorCapabilities: [...capabilitiesFor({ role: 'admin' } as never)],
  });
  ok('it plans', !!planning);
  if (!planning) return;

  ok('as a share and not a download',
    planning.plan.steps.some((s) => s.op === 'emit' && s.to.kind === 'share'),
    JSON.stringify(planning.plan.steps.map((s) => s.op)));
  /* Sharing is not exporting. Requiring the export capability for it
     would let anybody who can share pull the same rows out as a file. */
  ok('permitted by managing lists, not by exporting',
    planning.permissions.includes('crm.manageLists') && !planning.permissions.includes('crm.export'),
    JSON.stringify(planning.permissions));
  ok('and something performs it', planning.availability.executable,
    JSON.stringify(planning.availability.unavailable));

  const text = 'share the customers in Hyde with Dave and Tom';
  const planned = await plan(text, 'admin', db);
  const preview = planned?.preview;
  ok('it previews', preview?.ok === true, preview && !preview.ok ? preview.why : 'no preview');
  if (!planned || !preview?.ok) return;

  const done = await applyMutation({
    text, ...actor('admin'), store: postgrestStore(db.supabase),
    previewPlanHash: planned.planned.meaning.hash,
    previewProgrammeHash: preview.programmeHash,
  });
  ok('it goes through', done.ok, done.ok ? '' : done.why);
  if (!done.ok) return;
  ok('naming both of them', /Dave Smith and Tom Jones/.test(done.message), done.message);
  ok('and both memberships were written',
    (db.tables.crm_list_members ?? []).length === 2,
    JSON.stringify(db.tables.crm_list_members));
});

test('a name that fits two people is a question, not a guess', async () => {
  const db = fakeDb({
    crm_contacts: onAList(),
    crm_lists: [{ id: 'L1', name: 'Fleet Prospects', is_global: false }],
    profiles: [
      { id: 'p1', full_name: 'Dave Smith', email: 'dave@stc.co.uk', role: 'sales' },
      { id: 'p3', full_name: 'Dave Ashworth', email: 'davea@stc.co.uk', role: 'sales' },
    ],
  });
  const text = 'share the customers in Hyde with Dave';
  const planned = await plan(text, 'admin', db);
  const preview = planned?.preview;
  if (!planned || !preview?.ok) { ok('it previews', false, 'no preview'); return; }

  const done = await applyMutation({
    text, ...actor('admin'), store: postgrestStore(db.supabase),
    previewPlanHash: planned.planned.meaning.hash,
    previewProgrammeHash: preview.programmeHash,
  });
  ok('nobody is given access', !done.ok, 'it shared');
  if (done.ok) return;
  ok('and it says the name fits two people', /2 people match/.test(done.why), done.why);
  ok('nothing was written', db.writes.length === 0);
});

test('records on no list cannot be shared, and it says why', async () => {
  const db = fakeDb({
    crm_contacts: [
      { id: 'c1', company_name: 'Dawson Group', status: 'lead', location: 'Hyde', list_id: null },
    ],
    profiles: people(),
  });
  const text = 'share the customers in Hyde with Dave';
  const planned = await plan(text, 'admin', db);
  const preview = planned?.preview;
  if (!planned || !preview?.ok) { ok('it previews', false, 'no preview'); return; }

  const done = await applyMutation({
    text, ...actor('admin'), store: postgrestStore(db.supabase),
    previewPlanHash: planned.planned.meaning.hash,
    previewProgrammeHash: preview.programmeHash,
  });
  ok('it refuses', !done.ok, 'it shared');
  if (done.ok) return;
  ok('saying a list is what gets shared', /list/i.test(done.why), done.why);
  ok('nothing was written', db.writes.length === 0);
});

test('the four clause sentence makes the list, the file and the grant', async () => {
  const db = fakeDb({ crm_contacts: fleets(), profiles: people() });
  const text = `${FOUND}, create a list called Fleet Prospects from them, `
    + 'export it to Excel and share it with Dave';

  const planned = await plan(text, 'admin', db);
  ok('it plans as one programme', planned?.planned.planning.plan.steps.length === 4,
    JSON.stringify(planned?.planned.planning.plan.steps.map((s) => s.op)));
  const preview = planned?.preview;
  ok('it previews', preview?.ok === true, preview && !preview.ok ? preview.why : 'no preview');
  if (!preview?.ok || !planned) return;

  /* Both halves of what happens after the write are shown before it. */
  ok('the file and the grant are both declared', preview.deliveries.length === 2,
    JSON.stringify(preview.deliveries));
  ok('one of them leaves the records with somebody else',
    preview.deliveries.some((d) => d.capability === 'rows.share'),
    JSON.stringify(preview.deliveries));

  const done = await applyMutation({
    text, ...actor('admin'),
    store: postgrestStore(db.supabase),
    previewPlanHash: planned.planned.meaning.hash,
    previewProgrammeHash: preview.programmeHash,
    actorName: 'Alex Ellis',
  });
  ok('it runs', done.ok, done.ok ? '' : done.why);
  if (!done.ok) return;
  ok('the list was made over both customers',
    db.tables.crm_contacts.filter((r) => r.list_id === 'list1').length === 2,
    JSON.stringify(db.tables.crm_contacts.map((r) => r.list_id)));
  ok('the file came back', done.artefactRows === 2, String(done.artefactRows));
  ok('and the message says who can see them now', /Dave Smith/.test(done.message), done.message);
  ok('and the grant really landed',
    (db.tables.crm_list_members ?? []).length === 1,
    JSON.stringify(db.tables.crm_list_members));
});

/* =============================================================
   17. The other two destinations

   Attaching leaves the file on the record. Emailing cannot happen here
   and says exactly what is missing rather than "not yet".
   ============================================================= */

test('a file can be left on the record it is about', async () => {
  const db = fakeDb({ stock_trailers: trailers() });
  const text = 'export the sold curtainsiders as a PDF and attach it to STC143580';

  const planned = await plan(text, 'admin', db);
  ok('it plans', !!planned);
  if (!planned) return;
  ok('as one programme with two deliveries',
    planned.planned.planning.plan.steps.filter((s) => s.op === 'emit').length === 2,
    JSON.stringify(planned.planned.planning.plan.steps.map((s) => s.op)));
  ok('and something performs the attaching',
    planned.planned.planning.availability.executable,
    JSON.stringify(planned.planned.planning.availability.unavailable));

  const preview = planned.preview;
  ok('it previews', preview?.ok === true, preview && !preview.ok ? preview.why : 'no preview');
  if (!preview?.ok) return;
  /* One file, produced once. The attaching clause names no format, and
     defaulting it to a spreadsheet would download a PDF and attach a
     workbook. */
  ok('both deliveries are the PDF that was asked for',
    preview.deliveries.every((d) => d.label === 'a PDF'), JSON.stringify(preview.deliveries));

  const done = await applyMutation({
    text, ...actor('admin'),
    store: postgrestStore(db.supabase),
    previewPlanHash: planned.planned.meaning.hash,
    previewProgrammeHash: preview.programmeHash,
    actorName: 'Alex Ellis',
  });
  ok('it runs', done.ok, done.ok ? '' : done.why);
  if (!done.ok) return;
  ok('and says which record it went on', /STC143580/.test(done.message), done.message);
  ok('the attachment was written', db.writes.some((w) => w.table === 'record_attachments'),
    JSON.stringify(db.writes.map((w) => w.table)));
  ok('and nothing else was', db.writes.every((w) => w.table === 'record_attachments'),
    JSON.stringify(db.writes.map((w) => w.table)));
});

test('emailing says exactly what is missing, not "not yet"', async () => {
  const planning = planCommand('email the sold trailers to Dave as a PDF', {
    actorCapabilities: [...capabilitiesFor({ role: 'admin' } as never)],
  });
  ok('it is understood', !!planning);
  if (!planning) return;
  ok('and it reads as an email rather than a field write',
    planning.plan.steps.some((s) => s.op === 'emit' && s.to.kind === 'email'),
    JSON.stringify(planning.plan.steps.map((s) => s.op)));
  ok('it is well formed', planning.availability.representable, JSON.stringify(planning.problems));
  ok('but nothing can carry it out', !planning.availability.executable);

  const why = planning.availability.unavailable.map((u) => u.why).join(' ');
  /* A capability nobody has got to and one that cannot be built here at
     all are different answers for whoever is reading. */
  ok('and the reason names the dependency by name',
    /mail client in package\.json/.test(why) && /credentials/.test(why), why);
});

/* =============================================================
   18. Onto a list that already exists

   Making a new list and moving records onto one somebody already has
   are two halves of the same job. The second was reachable by ticking
   rows and using a menu, and by no sentence at all.
   ============================================================= */

const selected = (ids: string[]) => ({
  selection: { entity: 'contacts', ids, label: `the ${ids.length} you have selected` },
});

test('records go onto a list that already exists, by its name', async () => {
  const db = fakeDb({
    crm_contacts: [
      { id: 'c1', company_name: 'Dawson Group', status: 'lead', list_id: 'G1' },
      { id: 'c2', company_name: 'Pollock Haulage', status: 'lead', list_id: 'G1' },
    ],
    crm_lists: [
      { id: 'G1', name: 'Global CRM', is_global: true },
      { id: 'L1', name: 'Fleet Prospects', is_global: false },
    ],
  });
  const text = 'add these to the Fleet Prospects list';

  const planned = await planAndPreview({
    text, ...actor('admin'), store: postgrestStore(db.supabase), preview: true,
    context: selected(['c1', 'c2']) as never,
  });
  ok('it plans', !!planned);
  if (!planned) return;
  /* Moving onto a list is not making one, and both sentences contain
     the word "add". */
  ok('as the move and not as a create',
    planned.planned.planning.plan.steps.some((s) => s.op === 'invoke' && s.capability === 'list.add'),
    JSON.stringify(planned.planned.planning.plan.steps.map((s) => (s.op === 'invoke' ? s.capability : s.op))));
  ok('and something performs it', planned.planned.planning.availability.executable,
    JSON.stringify(planned.planned.planning.availability.unavailable));

  const preview = planned.preview;
  ok('it previews over both', preview?.ok === true && preview.count === 2,
    preview?.ok ? String(preview.count) : preview?.why ?? 'no preview');
  if (!preview?.ok) return;

  const done = await applyMutation({
    text, ...actor('admin'), store: postgrestStore(db.supabase),
    context: selected(['c1', 'c2']) as never,
    previewPlanHash: planned.planned.meaning.hash,
    previewProgrammeHash: preview.programmeHash,
  });
  ok('it runs', done.ok, done.ok ? '' : done.why);
  if (!done.ok) return;
  ok('and both records really moved',
    db.tables.crm_contacts.every((r) => r.list_id === 'L1'),
    JSON.stringify(db.tables.crm_contacts.map((r) => r.list_id)));
});

test('a list name that fits two lists moves nothing', async () => {
  const db = fakeDb({
    crm_contacts: [{ id: 'c1', company_name: 'Dawson Group', status: 'lead', list_id: 'G1' }],
    crm_lists: [
      { id: 'G1', name: 'Global CRM', is_global: true },
      { id: 'L1', name: 'Fleet Prospects', is_global: false },
      { id: 'L2', name: 'Fleet Prospects 2026', is_global: false },
    ],
  });
  const text = 'add these to the Fleet list';

  const planned = await planAndPreview({
    text, ...actor('admin'), store: postgrestStore(db.supabase), preview: true,
    context: selected(['c1']) as never,
  });
  const preview = planned?.preview;
  if (!planned || !preview?.ok) {
    ok('it previews', false, preview && !preview.ok ? preview.why : 'no preview');
    return;
  }

  const done = await applyMutation({
    text, ...actor('admin'), store: postgrestStore(db.supabase),
    context: selected(['c1']) as never,
    previewPlanHash: planned.planned.meaning.hash,
    previewProgrammeHash: preview.programmeHash,
  });
  ok('it refuses', !done.ok, 'it moved them');
  if (done.ok) return;
  ok('naming both lists it found', /Fleet Prospects.*Fleet Prospects 2026/.test(done.why), done.why);
  ok('and the record stayed where it was',
    db.tables.crm_contacts[0].list_id === 'G1', String(db.tables.crm_contacts[0].list_id));
});

test('a clause nobody understood refuses the whole programme', async () => {
  /* Half a programme is not a programme. If the last clause is not
     understood, creating the list and not exporting it, then reporting
     success, is worse than doing nothing. */
  const planning = planCommand(
    'find customers with more than 20 trailers, create a list called Fleet Prospects from them '
    + 'and export it to the blockchain',
    { actorCapabilities: [...capabilitiesFor({ role: 'admin' } as never)] },
  );
  ok('it does not come back as a runnable programme',
    planning?.availability.representable !== true,
    JSON.stringify(planning?.plan.steps.map((s) => s.op)));
  ok('and it says which word it could not place',
    (planning?.plan.unmet ?? []).some((u) => /blockchain/.test(u.why)),
    JSON.stringify(planning?.plan.unmet));
});


/* =============================================================
   19. One confirmed programme is one transaction

   A share and an attachment are database writes. They used to run after
   the transaction had already committed, so a share that failed left a
   list nobody asked for and reported success with a sentence saying the
   rest did not happen. Somebody who confirmed one thing got half of it
   and a note.
   ============================================================= */

/** Plan, preview and confirm, the way the apply route does. */
async function confirm(text: string, role: UserRole, db: ReturnType<typeof fakeDb>) {
  const planned = await plan(text, role, db);
  const preview = planned?.preview;
  if (!planned || !preview?.ok) {
    return { planned, preview, done: null as Awaited<ReturnType<typeof applyMutation>> | null };
  }
  const done = await applyMutation({
    text, ...actor(role), store: postgrestStore(db.supabase),
    previewPlanHash: planned.planned.meaning.hash,
    previewProgrammeHash: preview.programmeHash,
    actorName: 'Alex Ellis',
  });
  return { planned, preview, done };
}

test('a share that fails takes the list it was made from with it', async () => {
  const db = fakeDb({ crm_contacts: fleets(), profiles: people() });
  const text = `${FOUND}, create a list called Fleet Prospects from them and share it with Dave`;

  const planned = await plan(text, 'admin', db);
  const preview = planned?.preview;
  ok('it previews', preview?.ok === true, preview && !preview.ok ? preview.why : 'no preview');
  if (!planned || !preview?.ok) return;

  /* The grant fails at the last step, after the list has been made
     inside the same transaction. */
  db.as('viewer');

  const done = await applyMutation({
    text, ...actor('admin'), store: postgrestStore(db.supabase),
    previewPlanHash: planned.planned.meaning.hash,
    previewProgrammeHash: preview.programmeHash,
  });

  ok('the whole thing fails', !done.ok, 'it succeeded');
  ok('no list was left behind', (db.tables.crm_lists ?? []).length === 0,
    JSON.stringify(db.tables.crm_lists));
  ok('and no customer was moved onto one',
    db.tables.crm_contacts.every((r) => r.list_id == null),
    JSON.stringify(db.tables.crm_contacts.map((r) => r.list_id)));
  ok('nothing was granted', (db.tables.crm_list_members ?? []).length === 0,
    JSON.stringify(db.tables.crm_list_members));
});

test('an attachment that fails takes the field write with it', async () => {
  const db = fakeDb({ stock_trailers: trailers() });
  const text = 'move all the trailers at Carrington to Hyde';

  /* A programme that writes and then attaches. Built by hand only
     because no single sentence says both today; everything else about
     it is the production path. */
  const planned = await plan(text, 'admin', db);
  ok('the write plans', !!planned);
  if (!planned?.preview?.ok) { ok('it previews', false, 'no preview'); return; }

  const withAttach = {
    ...planned.planned.planning,
    plan: {
      ...planned.planned.planning.plan,
      steps: [
        ...planned.planned.planning.plan.steps,
        {
          op: 'emit' as const,
          id: 'a1',
          from: { entity: 'trailers' },
          output: { kind: 'file' as const, format: 'csv' as const },
          to: {
            kind: 'attach' as const,
            to: {
              op: 'select' as const,
              from: { entity: 'trailers' },
              where: {
                kind: 'cmp' as const, op: 'eq' as const,
                left: { kind: 'field' as const, of: { entity: 'trailers', field: 'stc_no' } },
                right: { kind: 'literal' as const, value: 'STC000000' },
              },
            },
          },
          capability: 'record.attach',
        },
      ],
    },
  };

  const { previewMutation } = await import('../lib/command/server/mutation');
  const fresh = await previewMutation(withAttach, postgrestStore(db.supabase));
  if (!fresh.ok) { ok('it previews', false, fresh.why); return; }

  const { executeProgramme } = await import('../lib/command/ir/orchestrate');
  const { prepareDelivery } = await import('../lib/command/server/emit');
  const ready = await prepareDelivery(withAttach, withAttach.plan.steps[1] as never, {
    store: postgrestStore(db.supabase), actorName: 'Alex Ellis', now: new Date('2026-08-17'),
  });

  /* The record it names is not there, so nothing can be prepared and
     nothing may be written. */
  ok('the delivery cannot be prepared', !ready.ok, 'it prepared');
  ok('and no trailer moved', db.writes.length === 0, JSON.stringify(db.writes));

  /* And when the delivery IS prepared but the database refuses it, the
     write goes back too. */
  const done = await executeProgramme(withAttach.plan, {
    store: postgrestStore(db.supabase),
    agreedHash: fresh.programmeHash,
    deliveries: () => [{
      op: 'invoke',
      capability: 'record.attach',
      subjects: ['00000000-0000-0000-0000-000000000000'],
      args: { table: 'stock_trailers', filename: 'x.csv', mime: 'text/csv', base64: 'eA==' },
    }],
  });
  ok('the programme fails', !done.ok, 'it succeeded');
  ok('and the trailers are still at Carrington',
    db.tables.stock_trailers.filter((r) => r.location === 'Carrington').length === 1,
    JSON.stringify(db.tables.stock_trailers.map((r) => r.location)));
  ok('with nothing attached', (db.tables.record_attachments ?? []).length === 0,
    JSON.stringify(db.tables.record_attachments));
});

test('a file that cannot be produced leaves the database alone', async () => {
  const db = fakeDb({ crm_contacts: fleets(), profiles: people() });
  const text = `${FOUND}, create a list called Fleet Prospects from them and export it to Excel`;

  const planned = await plan(text, 'admin', db);
  const preview = planned?.preview;
  if (!planned || !preview?.ok) { ok('it previews', false, 'no preview'); return; }

  /* The renderer throws. The file is built before the transaction opens
     precisely so this is a refusal rather than a note attached to a
     change that has already committed. */
  const { RENDERERS } = await import('../lib/command/server/emit');
  const real = RENDERERS.xlsx;
  RENDERERS.xlsx = () => { throw new Error('TEST renderer down'); };

  try {
    const done = await applyMutation({
      text, ...actor('admin'), store: postgrestStore(db.supabase),
      previewPlanHash: planned.planned.meaning.hash,
      previewProgrammeHash: preview.programmeHash,
    });
    ok('the whole thing is refused', !done.ok, 'it succeeded');
    if (!done.ok) ok('saying the file could not be produced', /could not be produced/.test(done.why), done.why);
  } finally {
    RENDERERS.xlsx = real;
  }

  ok('no list was made', (db.tables.crm_lists ?? []).length === 0,
    JSON.stringify(db.tables.crm_lists));
  ok('and nothing was written at all', db.writes.length === 0, JSON.stringify(db.writes));
});

/* =============================================================
   20. Sharing two of a hundred shares two, or nothing
   ============================================================= */

test('a selection smaller than the list it is on shares nothing', async () => {
  /* A hundred customers on one list, two of them at Hyde. Granting the
     list would give Dave the other ninety eight. */
  const many: Row[] = [];
  for (let i = 0; i < 100; i++) {
    many.push({
      id: `c${i}`, company_name: `Customer ${i}`, status: 'lead', list_id: 'L1',
      location: i < 2 ? 'Hyde' : 'Carrington',
    });
  }
  const db = fakeDb({
    crm_contacts: many,
    crm_lists: [{ id: 'L1', name: 'Everything', is_global: false }],
    profiles: people(),
  });

  const { done, preview } = await confirm('share the customers in Hyde with Dave', 'admin', db);
  ok('it previews', !!preview?.ok, preview && !preview.ok ? preview.why : 'no preview');
  ok('and then refuses', done !== null && !done.ok, 'it shared');
  if (!done || done.ok) return;
  ok('saying two of a hundred', /2 of the 100/.test(done.why), done.why);
  ok('nobody was granted anything', (db.tables.crm_list_members ?? []).length === 0,
    JSON.stringify(db.tables.crm_list_members));
});

test('the database refuses the same overgrant on its own', async () => {
  /* The check is in the function as well as in the caller, because a
     caller that validates its own payload validates nothing. */
  const many: Row[] = [];
  for (let i = 0; i < 100; i++) {
    many.push({ id: `c${i}`, company_name: `Customer ${i}`, status: 'lead', list_id: 'L1' });
  }
  const db = fakeDb({
    crm_contacts: many,
    crm_lists: [{ id: 'L1', name: 'Everything', is_global: false }],
    profiles: people(),
  });

  const out = await postgrestStore(db.supabase).invoke({
    capability: 'rows.share',
    subjects: ['c0', 'c1'],
    args: { list: 'L1', users: ['p1'] },
  });
  ok('the call fails', !out.ok, 'it shared');
  if (out.ok) return;
  ok('with the numbers in it', /2 of the 100/.test(out.why), out.why);
  ok('and nothing was granted', (db.tables.crm_list_members ?? []).length === 0,
    JSON.stringify(db.tables.crm_list_members));
});

/* =============================================================
   21. A viewer cannot go round the runtime
   ============================================================= */

test('a viewer calling the attach function directly attaches nothing', async () => {
  const db = fakeDb({ stock_trailers: trailers() });
  db.as('viewer');

  const out = await postgrestStore(db.supabase).invoke({
    capability: 'record.attach',
    subjects: ['t1'],
    args: {
      table: 'stock_trailers', filename: 'x.csv', mime: 'text/csv', base64: 'eA==',
    },
  });

  ok('the call fails', !out.ok, 'it attached');
  if (out.ok) return;
  /* The capability is derived from the TARGET. Attaching to a stock
     unit is editing that unit. */
  ok('naming the capability it wanted', /stock\.edit/.test(out.why), out.why);
  ok('and nothing was stored', (db.tables.record_attachments ?? []).length === 0,
    JSON.stringify(db.tables.record_attachments));
});

test('a viewer calling the share function directly grants nothing', async () => {
  const db = fakeDb({
    crm_contacts: [{ id: 'c1', company_name: 'Dawson Group', status: 'lead', list_id: 'L1' }],
    crm_lists: [{ id: 'L1', name: 'Fleet Prospects', is_global: false }],
    profiles: people(),
  });
  db.as('viewer');

  const out = await postgrestStore(db.supabase).invoke({
    capability: 'rows.share',
    subjects: ['c1'],
    args: { list: 'L1', users: ['p1'] },
  });
  ok('the call fails', !out.ok, 'it shared');
  if (out.ok) return;
  ok('naming the capability it wanted', /crm\.manageLists/.test(out.why), out.why);
  ok('and nothing was granted', (db.tables.crm_list_members ?? []).length === 0,
    JSON.stringify(db.tables.crm_list_members));
});


/* =============================================================
   22. Changing what somebody is allowed to do

   The highest risk write here, and it was left out on the grounds that
   the admin screen's confirmation is the point. The bar's confirmation
   IS a confirmation: the person is resolved exactly, the preview names
   them with the role they hold and the role they are being given, and
   the database asks for the capability whatever route the call takes.
   ============================================================= */

const team = (): Row[] => [
  { id: 'p1', full_name: 'Dave Smith', email: 'dave@stc.co.uk', role: 'sales' },
  { id: 'p2', full_name: 'Alex Ellis', email: 'alex@stc.co.uk', role: 'admin' },
  { id: 'p3', full_name: 'Rama Patel', email: 'rama@stc.co.uk', role: 'marketer' },
];

test('an admin can elevate a colleague, and sees what they are now', async () => {
  const db = fakeDb({ profiles: team() });
  const text = 'elevate Dave to admin';

  const planned = await plan(text, 'admin', db);
  ok('it plans', !!planned);
  if (!planned) return;
  ok('as the role operation', planned.planned.planning.plan.steps
    .some((s) => s.op === 'invoke' && s.capability === 'user.setRole'),
    JSON.stringify(planned.planned.planning.plan.steps.map((s) => s.op)));
  ok('and it has to be confirmed', planned.planned.meaning.confirm === true);

  const preview = planned.preview;
  ok('it previews', preview?.ok === true, preview && !preview.ok ? preview.why : 'no preview');
  if (!preview?.ok) return;
  ok('over exactly one person', preview.count === 1, String(preview.count));
  ok('naming them', preview.operations[0]?.subjects[0]?.label === 'Dave Smith',
    JSON.stringify(preview.operations));
  /* The half the sentence does not say and whoever confirms needs most. */
  ok('and the role they hold now',
    preview.operations[0]?.subjects[0]?.values?.role === 'sales',
    JSON.stringify(preview.operations[0]?.subjects[0]?.values));
  ok('nothing was written to preview it', db.writes.length === 0);

  const done = await applyMutation({
    text, ...actor('admin'), store: postgrestStore(db.supabase),
    previewPlanHash: planned.planned.meaning.hash,
    previewProgrammeHash: preview.programmeHash,
  });
  ok('it runs', done.ok, done.ok ? '' : done.why);
  if (!done.ok) return;
  ok('the role really changed',
    db.tables.profiles.find((r) => r.id === 'p1')?.role === 'admin',
    String(db.tables.profiles.find((r) => r.id === 'p1')?.role));
  ok('and it says what it was', /was sales and is admin now/.test(done.message), done.message);
});

test('a sales rep cannot see the role change at all', async () => {
  /* Nothing you cannot do is ever offered. An action that appears and
     then refuses teaches people the tool is unreliable. */
  const planning = planCommand('elevate Dave to admin', {
    actorCapabilities: [...capabilitiesFor({ role: 'sales' } as never)],
  });
  const reachesIt = planning?.plan.steps
    .some((s) => s.op === 'invoke' && s.capability === 'user.setRole') ?? false;
  ok('it is not read as a role change', !reachesIt,
    JSON.stringify(planning?.plan.steps.map((s) => s.op)));
});

test('a name that fits two colleagues changes nobody', async () => {
  const db = fakeDb({
    profiles: [
      { id: 'p1', full_name: 'Dave Smith', email: 'dave@stc.co.uk', role: 'sales' },
      { id: 'p4', full_name: 'Dave Ashworth', email: 'davea@stc.co.uk', role: 'viewer' },
      { id: 'p2', full_name: 'Alex Ellis', email: 'alex@stc.co.uk', role: 'admin' },
    ],
  });
  const planned = await plan('elevate Dave to admin', 'admin', db);
  const preview = planned?.preview;
  ok('it does not preview a change', preview?.ok !== true, 'it previewed');
  ok('nothing was written', db.writes.length === 0);
  ok('and both are still what they were',
    db.tables.profiles.filter((r) => r.role === 'admin').length === 1,
    JSON.stringify(db.tables.profiles.map((r) => r.role)));
});

test('the last administrator cannot stop being one', async () => {
  const db = fakeDb({
    profiles: [
      { id: 'p2', full_name: 'Alex Ellis', email: 'alex@stc.co.uk', role: 'admin' },
      { id: 'p1', full_name: 'Dave Smith', email: 'dave@stc.co.uk', role: 'sales' },
    ],
  });
  const text = 'demote Alex to viewer';
  const planned = await plan(text, 'admin', db);
  const preview = planned?.preview;
  if (!planned || !preview?.ok) { ok('it previews', false, 'no preview'); return; }

  const done = await applyMutation({
    text, ...actor('admin'), store: postgrestStore(db.supabase),
    previewPlanHash: planned.planned.meaning.hash,
    previewProgrammeHash: preview.programmeHash,
  });
  ok('it refuses', !done.ok, 'it demoted them');
  if (done.ok) return;
  ok('saying why', /only administrator/.test(done.why), done.why);
  ok('and they are still an admin',
    db.tables.profiles.find((r) => r.id === 'p2')?.role === 'admin',
    String(db.tables.profiles.find((r) => r.id === 'p2')?.role));
});

test('a viewer calling the role function directly changes nothing', async () => {
  const db = fakeDb({ profiles: team() });
  db.as('viewer');

  const out = await postgrestStore(db.supabase).invoke({
    capability: 'user.setRole', subjects: ['p1'], args: { role: 'admin' },
  });
  ok('the call fails', !out.ok, 'it changed the role');
  if (out.ok) return;
  ok('naming the capability it wanted', /admin\.users/.test(out.why), out.why);
  ok('and nobody was elevated',
    db.tables.profiles.find((r) => r.id === 'p1')?.role === 'sales',
    String(db.tables.profiles.find((r) => r.id === 'p1')?.role));
});


/* =============================================================
   23. Bulk delete, agreed to by number

   A described set is still refused: "delete the sold trailers" is one
   wrong word away from the worst thing this application could do.
   Records on the screen are different. Somebody ticked them, they can
   see them, and the sentence can state how many there are.
   ============================================================= */

test('deleting the selected records asks for the number first', async () => {
  const db = fakeDb({
    crm_contacts: [
      { id: 'c1', company_name: 'TEST lead one', status: 'lead' },
      { id: 'c2', company_name: 'TEST lead two', status: 'lead' },
      { id: 'c3', company_name: 'Real Customer', status: 'customer' },
    ],
  });
  const text = 'delete all 2 selected test leads';
  const context = selected(['c1', 'c2']) as never;

  const planned = await planAndPreview({
    text, ...actor('admin'), store: postgrestStore(db.supabase), preview: true, context,
  });
  ok('it plans', !!planned);
  if (!planned) return;
  ok('as a deletion of a set', planned.planned.planning.plan.steps
    .some((s) => s.op === 'delete' && s.expect === 'many'),
    JSON.stringify(planned.planned.planning.plan.steps.map((s) => s.op)));

  const preview = planned.preview;
  ok('it previews', preview?.ok === true, preview && !preview.ok ? preview.why : 'no preview');
  if (!preview?.ok) return;
  ok('over both selected records', preview.count === 2, String(preview.count));
  /* The same keystroke that confirms a price change must not confirm
     this. */
  ok('and it is marked destructive', preview.severity === 'destructive', preview.severity);

  const without = await applyMutation({
    text, ...actor('admin'), store: postgrestStore(db.supabase), context,
    previewPlanHash: planned.planned.meaning.hash,
    previewProgrammeHash: preview.programmeHash,
  });
  ok('a confirmation with no number is refused',
    !without.ok && without.reason === 'not acknowledged',
    without.ok ? 'it deleted' : without.reason);
  ok('and nothing was deleted', db.tables.crm_contacts.length === 3,
    String(db.tables.crm_contacts.length));

  const wrong = await applyMutation({
    text, ...actor('admin'), store: postgrestStore(db.supabase), context,
    previewPlanHash: planned.planned.meaning.hash,
    previewProgrammeHash: preview.programmeHash,
    acknowledge: 3,
  });
  ok('and so is the wrong number',
    !wrong.ok && wrong.reason === 'not acknowledged', wrong.ok ? 'it deleted' : wrong.reason);
  ok('still nothing deleted', db.tables.crm_contacts.length === 3,
    String(db.tables.crm_contacts.length));

  const done = await applyMutation({
    text, ...actor('admin'), store: postgrestStore(db.supabase), context,
    previewPlanHash: planned.planned.meaning.hash,
    previewProgrammeHash: preview.programmeHash,
    acknowledge: 2,
  });
  ok('the right number goes through', done.ok, done.ok ? '' : done.why);
  ok('both selected records are gone', db.tables.crm_contacts.length === 1,
    JSON.stringify(db.tables.crm_contacts.map((r) => r.company_name)));
  ok('and the one nobody selected is still there',
    db.tables.crm_contacts[0]?.company_name === 'Real Customer',
    String(db.tables.crm_contacts[0]?.company_name));
});

test('a count that does not match the screen is not read as a deletion', async () => {
  /* Somebody working from a screen that has moved under them. */
  const db = fakeDb({
    crm_contacts: [
      { id: 'c1', company_name: 'TEST lead one', status: 'lead' },
      { id: 'c2', company_name: 'TEST lead two', status: 'lead' },
    ],
  });
  const planned = await planAndPreview({
    text: 'delete all 12 selected test leads', ...actor('admin'),
    store: postgrestStore(db.supabase), preview: true,
    context: selected(['c1', 'c2']) as never,
  });
  const deletes = planned?.planned.planning.plan.steps.some((s) => s.op === 'delete') ?? false;
  ok('it is not a deletion', !deletes,
    JSON.stringify(planned?.planned.planning.plan.steps.map((s) => s.op)));
  ok('and nothing was written', db.writes.length === 0);
});

test('a described set is still refused', async () => {
  /* The words describe rows nobody has looked at, and there is no undo. */
  const db = fakeDb({ stock_trailers: trailers() });
  const planned = await plan('delete all the sold trailers', 'admin', db);
  const deletes = planned?.planned.planning.plan.steps.some((s) => s.op === 'delete') ?? false;
  ok('it does not plan as a deletion', !deletes,
    JSON.stringify(planned?.planned.planning.plan.steps.map((s) => s.op)));
  ok('and nothing was written', db.writes.length === 0);
});


/* =============================================================
   24. What it takes to delete is not what it takes to edit

   Both delete readers used to take their capability from the writable
   dictionary entry for whichever column identifies the record, which
   for a customer is `company_name` and therefore `crm.edit`. The
   permission model distinguishes `crm.edit` from `crm.delete` on
   purpose: a marketer may edit every field on a customer and delete
   nothing.
   ============================================================= */

const leads = (): Row[] => [
  { id: 'd1', company_name: 'Dawson Group', status: 'lead' },
  { id: 'd2', company_name: 'TEST lead two', status: 'lead' },
  { id: 'd3', company_name: 'TEST lead three', status: 'lead' },
];

/** Does this role's reading of the sentence reach a deletion at all? */
function deletes(text: string, role: UserRole, context?: unknown): boolean {
  const planning = planCommand(text, {
    actorCapabilities: [...capabilitiesFor({ role } as never)],
    context: context as never,
  });
  return planning?.plan.steps.some((s) => s.op === 'delete') ?? false;
}

test('deleting a customer needs crm.delete, not crm.edit', async () => {
  /* A noun and a name, which is what the named delete reader asks for. */
  const named = 'delete the customer Dawson Group';

  ok('an admin can', deletes(named, 'admin'));
  /* Sales holds crm.delete in permissions.ts. */
  ok('a sales rep can', deletes(named, 'sales'));
  /* A marketer holds crm.edit and not crm.delete, which is the whole
     distinction the old derivation lost. */
  ok('a marketer cannot', !deletes(named, 'marketer'));
  ok('a viewer cannot', !deletes(named, 'viewer'));

  const bulk = 'delete all 3 selected test leads';
  const context = selected(['d1', 'd2', 'd3']);
  ok('the same holds for a set: admin can', deletes(bulk, 'admin', context));
  ok('sales can', deletes(bulk, 'sales', context));
  ok('a marketer cannot', !deletes(bulk, 'marketer', context));
  ok('a viewer cannot', !deletes(bulk, 'viewer', context));
});

test('a marketer confirming a deletion is refused by the permission gate', async () => {
  const db = fakeDb({ crm_contacts: leads() });
  /* Planned as an admin so a well formed plan exists, then confirmed by
     somebody who may not do it. The gate is derived from the plan, not
     from whoever happened to build it. */
  const planned = await plan('delete the customer Dawson Group', 'admin', db);
  const preview = planned?.preview;
  if (!planned || !preview?.ok) { ok('it previews for an admin', false, 'no preview'); return; }

  const done = await applyMutation({
    text: 'delete the customer Dawson Group', ...actor('marketer'),
    store: postgrestStore(db.supabase),
    previewPlanHash: planned.planned.meaning.hash,
    previewProgrammeHash: preview.programmeHash,
  });
  ok('it refuses', !done.ok, 'it deleted');
  /* A marketer's reading of that sentence is not a deletion at all, so
     the plan the server arrives at is not the plan that was previewed
     and the hash says so. Either way nothing is removed: the point is
     that the capability filter runs on THEIR capabilities, not on
     whoever built the preview. */
  if (!done.ok) {
    ok('without ever reaching the write',
      done.reason === 'not permitted' || done.reason === 'meaning changed', done.reason);
  }
  ok('and the customer is still there', db.tables.crm_contacts.length === 3,
    String(db.tables.crm_contacts.length));
});

test('a marketer going straight to the database deletes nothing', async () => {
  /* A payload is not a permission. The column allowlist is the right
     question for an update and no question at all for a delete. */
  const db = fakeDb({ crm_contacts: leads() });
  db.as('marketer');

  const out = await postgrestStore(db.supabase).perform([
    { op: 'changes', changes: [{ op: 'delete', table: 'crm_contacts', id: 'd1' }] },
  ]);
  ok('the call fails', !out.ok, 'it deleted');
  if (!out.ok) ok('saying so', /may not delete rows of crm_contacts/.test(out.why), out.why);
  ok('and all three are still there', db.tables.crm_contacts.length === 3,
    String(db.tables.crm_contacts.length));

  db.as('sales');
  const allowed = await postgrestStore(db.supabase).perform([
    { op: 'changes', changes: [{ op: 'delete', table: 'crm_contacts', id: 'd1' }] },
  ]);
  ok('and a sales rep can', allowed.ok, allowed.ok ? '' : allowed.why);
  ok('leaving two', db.tables.crm_contacts.length === 2,
    String(db.tables.crm_contacts.length));
});


/* =============================================================
   25. An Emit sees what the step before it did

   The file is rendered before the transaction opens, so a renderer that
   throws leaves nothing written. That ordering is right and it used to
   mean the file held the rows as they were: "move these to Hyde and
   export them" produced a workbook saying Carrington.
   ============================================================= */

const asText = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

test('moving trailers and exporting them exports where they now are', async () => {
  const db = fakeDb({
    stock_trailers: [
      { id: 't1', stc_no: 'STC900001', status: 'in_stock', location: 'Carrington', category: 'Curtainsider' },
      { id: 't2', stc_no: 'STC900002', status: 'in_stock', location: 'Carrington', category: 'Curtainsider' },
    ],
  });
  const text = 'move all the trailers at Carrington to Hyde and export them to CSV';

  const planned = await plan(text, 'admin', db);
  const preview = planned?.preview;
  ok('it previews', preview?.ok === true, preview && !preview.ok ? preview.why : 'no preview');
  if (!planned || !preview?.ok) return;

  const done = await applyMutation({
    text, ...actor('admin'), store: postgrestStore(db.supabase),
    previewPlanHash: planned.planned.meaning.hash,
    previewProgrammeHash: preview.programmeHash,
  });
  ok('it runs', done.ok, done.ok ? '' : done.why);
  if (!done.ok || !done.artefact) { ok('a file came back', false, 'no artefact'); return; }

  ok('the database says Hyde',
    db.tables.stock_trailers.every((r) => r.location === 'Hyde'),
    JSON.stringify(db.tables.stock_trailers.map((r) => r.location)));

  const csv = asText(done.artefact.bytes);
  ok('and so does the file', csv.includes('Hyde'), csv.slice(0, 300));
  ok('with no trace of where they were', !/Carrington/.test(csv.split('\n').slice(2).join('\n')),
    csv.slice(0, 300));
});

test('changing a role and exporting the person exports the new role', async () => {
  const db = fakeDb({
    profiles: [
      { id: 'p1', full_name: 'Dave Smith', email: 'dave@stc.co.uk', role: 'viewer' },
      { id: 'p2', full_name: 'Alex Ellis', email: 'alex@stc.co.uk', role: 'admin' },
    ],
  });
  const text = 'change Dave to sales and export him to CSV';

  const planned = await plan(text, 'admin', db);
  const preview = planned?.preview;
  ok('it previews', preview?.ok === true, preview && !preview.ok ? preview.why : 'no preview');
  if (!planned || !preview?.ok) return;

  const done = await applyMutation({
    text, ...actor('admin'), store: postgrestStore(db.supabase),
    previewPlanHash: planned.planned.meaning.hash,
    previewProgrammeHash: preview.programmeHash,
  });
  ok('it runs', done.ok, done.ok ? '' : done.why);
  if (!done.ok || !done.artefact) { ok('a file came back', false, 'no artefact'); return; }

  ok('the database says sales',
    db.tables.profiles.find((r) => r.id === 'p1')?.role === 'sales',
    String(db.tables.profiles.find((r) => r.id === 'p1')?.role));

  const csv = asText(done.artefact.bytes);
  const daves = csv.split('\n').filter((l) => l.includes('Dave Smith'));
  ok('and the row in the file says sales', daves.some((l) => l.includes('sales')), daves.join(' | '));
  ok('not the role they held', !daves.some((l) => /viewer/.test(l)), daves.join(' | '));
});

test('marking deals sold and exporting them exports them sold', async () => {
  const db = fakeDb({
    stock_trailers: [
      { id: 'u1', stc_no: 'STC910001', status: 'in_stock', category: 'Curtainsider', location: 'Hyde' },
    ],
    crm_contacts: [
      { id: 'k1', company_name: 'Dawson Group', stock_trailer_id: 'u1', status: 'quoted',
        sale_price: 20000, profit: 4000, commission_rate: 0.1 },
    ],
  });
  const text = 'mark all the in stock curtainsiders as sold and export the result to CSV';

  const planned = await plan(text, 'admin', db);
  const preview = planned?.preview;
  ok('it previews', preview?.ok === true, preview && !preview.ok ? preview.why : 'no preview');
  if (!planned || !preview?.ok) return;

  const done = await applyMutation({
    text, ...actor('admin'), store: postgrestStore(db.supabase),
    previewPlanHash: planned.planned.meaning.hash,
    previewProgrammeHash: preview.programmeHash,
  });

  /* A SALE IS NOT PREDICTABLE ENOUGH TO EXPORT IN THE SAME BREATH.

     The status, the price and the customer are. The commission is
     computed from a rate this cannot see, and the dates come from the
     deal rather than from the sentence. A trailer export shows those
     columns, so the file would carry a stale figure next to a fresh
     price, which is worse than no file. The whole thing is refused
     BEFORE anything is written, and it names the column. */
  ok('the whole thing is refused', !done.ok, 'it exported a stale sale');
  if (!done.ok) {
    ok('naming what it cannot work out in advance',
      /order_date|commission|profit/.test(done.why), done.why);
  }
  ok('and the sale did not happen either',
    db.tables.crm_contacts[0]?.status === 'quoted',
    String(db.tables.crm_contacts[0]?.status));
  ok('nor the stock unit', db.tables.stock_trailers[0]?.status === 'in_stock',
    String(db.tables.stock_trailers[0]?.status));
});

test('marking deals sold on its own still sells them', async () => {
  const db = fakeDb({
    stock_trailers: [
      { id: 'u1', stc_no: 'STC910001', status: 'in_stock', category: 'Curtainsider', location: 'Hyde' },
    ],
    crm_contacts: [
      { id: 'k1', company_name: 'Dawson Group', stock_trailer_id: 'u1', status: 'quoted',
        sale_price: 20000, profit: 4000, commission_rate: 0.1 },
    ],
  });
  const text = 'mark all the in stock curtainsiders as sold';

  const planned = await plan(text, 'admin', db);
  const preview = planned?.preview;
  ok('it previews', preview?.ok === true, preview && !preview.ok ? preview.why : 'no preview');
  if (!planned || !preview?.ok) return;

  const done = await applyMutation({
    text, ...actor('admin'), store: postgrestStore(db.supabase),
    previewPlanHash: planned.planned.meaning.hash,
    previewProgrammeHash: preview.programmeHash,
  });
  ok('it runs', done.ok, done.ok ? '' : done.why);
  ok('the deal sold', db.tables.crm_contacts[0]?.status === 'customer',
    String(db.tables.crm_contacts[0]?.status));
  ok('and the unit with it', db.tables.stock_trailers[0]?.status === 'sold',
    String(db.tables.stock_trailers[0]?.status));
});

test('moving trailers then exporting where they went finds them', async () => {
  const db = fakeDb({
    stock_trailers: [
      { id: 't1', stc_no: 'STC930001', status: 'in_stock', location: 'Carrington', category: 'Curtainsider' },
      { id: 't2', stc_no: 'STC930002', status: 'in_stock', location: 'Hyde', category: 'Curtainsider' },
    ],
  });
  /* The moved unit is not in the pre-state answer to "at Hyde". A
     reader that patched rows the ordinary query returned could never
     have found it. */
  const text = 'move all the trailers at Carrington to Hyde and export the trailers at Hyde to CSV';

  const planned = await plan(text, 'admin', db);
  const preview = planned?.preview;
  ok('it previews', preview?.ok === true, preview && !preview.ok ? preview.why : 'no preview');
  if (!planned || !preview?.ok) return;

  const done = await applyMutation({
    text, ...actor('admin'), store: postgrestStore(db.supabase),
    previewPlanHash: planned.planned.meaning.hash,
    previewProgrammeHash: preview.programmeHash,
  });
  ok('it runs', done.ok, done.ok ? '' : done.why);
  if (!done.ok || !done.artefact) { ok('a file came back', false, 'no artefact'); return; }

  const csv = asText(done.artefact.bytes);
  ok('the moved unit is in the file', csv.includes('STC930001'), csv.slice(0, 300));
  ok('and so is the one that was already there', csv.includes('STC930002'), csv.slice(0, 300));
});

test('a record made by the same sentence turns up in what follows it', async () => {
  const db = fakeDb({
    crm_contacts: [],
    crm_lists: [{ id: 'l1', name: 'Everything', is_global: true }],
  });
  const text = 'create a customer called Ravenscroft Haulage and export the customers to CSV';

  const planned = await plan(text, 'admin', db);
  const preview = planned?.preview;
  ok('it previews', preview?.ok === true, preview && !preview.ok ? preview.why : 'no preview');
  if (!planned || !preview?.ok) return;

  const done = await applyMutation({
    text, ...actor('admin'), store: postgrestStore(db.supabase),
    previewPlanHash: planned.planned.meaning.hash,
    previewProgrammeHash: preview.programmeHash,
  });
  ok('it runs', done.ok, done.ok ? '' : done.why);
  if (!done.ok || !done.artefact) { ok('a file came back', false, 'no artefact'); return; }

  /* An insert has no id until the database issues one, which is why
     this used to be impossible: the row could not be staged at all. */
  const csv = asText(done.artefact.bytes);
  ok('the new customer is in the file', csv.includes('Ravenscroft Haulage'), csv.slice(0, 300));
  ok('and it really exists', (db.tables.crm_contacts ?? []).length === 1,
    String((db.tables.crm_contacts ?? []).length));
});

test('a meeting moved and then exported shows both ends moved', async () => {
  const db = fakeDb(DIARY());
  const text = 'move my site visit on Friday to 2pm and export it to CSV';

  const planned = await plan(text, 'admin', db);
  const preview = planned?.preview;
  ok('it previews', preview?.ok === true, preview && !preview.ok ? preview.why : 'no preview');
  if (!planned || !preview?.ok) return;

  const done = await applyMutation({
    text, ...actor('admin'), store: postgrestStore(db.supabase),
    previewPlanHash: planned.planned.meaning.hash,
    previewProgrammeHash: preview.programmeHash,
  });
  ok('it runs', done.ok, done.ok ? '' : done.why);
  if (!done.ok || !done.artefact) { ok('a file came back', false, 'no artefact'); return; }

  const csv = asText(done.artefact.bytes);
  /* The meeting starts at two and finishes an hour later. A file that
     showed the new start against the old end would describe a meeting
     that finishes before it begins. */
  ok('the file shows the new start', /14:00|T14:00/.test(csv), csv.slice(0, 400));
  ok('and the end moved with it', !/T09:00|T10:00/.test(csv), csv.slice(0, 400));
});

test('a renderer that fails leaves the chained change unwritten', async () => {
  const db = fakeDb({
    stock_trailers: [
      { id: 't1', stc_no: 'STC920001', status: 'in_stock', location: 'Carrington', category: 'Curtainsider' },
    ],
  });
  const text = 'move all the trailers at Carrington to Hyde and export them to Excel';

  const planned = await plan(text, 'admin', db);
  const preview = planned?.preview;
  if (!planned || !preview?.ok) { ok('it previews', false, 'no preview'); return; }

  const { RENDERERS } = await import('../lib/command/server/emit');
  const real = RENDERERS.xlsx;
  RENDERERS.xlsx = () => { throw new Error('TEST renderer down'); };
  try {
    const done = await applyMutation({
      text, ...actor('admin'), store: postgrestStore(db.supabase),
      previewPlanHash: planned.planned.meaning.hash,
      previewProgrammeHash: preview.programmeHash,
    });
    ok('the whole thing is refused', !done.ok, 'it succeeded');
  } finally {
    RENDERERS.xlsx = real;
  }

  ok('and the trailer never moved',
    db.tables.stock_trailers[0]?.location === 'Carrington',
    String(db.tables.stock_trailers[0]?.location));
  ok('with nothing written at all', db.writes.length === 0, JSON.stringify(db.writes));
});


/* =============================================================
   26. Two operations that were route bodies

   Sending a unit to somebody's tracker and raising a proposal were
   reachable by clicking and by no sentence at all. The business logic
   is now one function each, which the route and the command bar both
   call, so neither can carry the relationship across and the other
   forget to.
   ============================================================= */

test('a stock unit goes onto the tracker from a sentence', async () => {
  const db = fakeDb({
    stock_trailers: trailers(),
    crm_lists: [{ id: 'L1', name: 'Sales tracker', owner_id: 'u1', is_global: false }],
  });
  const text = 'send STC143580 to my tracker';

  const planned = await plan(text, 'admin', db);
  ok('it plans', !!planned);
  if (!planned) return;
  ok('as the operation the button performs',
    planned.planned.planning.plan.steps
      .some((s) => s.op === 'invoke' && s.capability === 'stock.sendToTracker'),
    JSON.stringify(planned.planned.planning.plan.steps.map((s) => s.op)));

  const preview = planned.preview;
  ok('it previews over the one unit', preview?.ok === true && preview.count === 1,
    preview?.ok ? String(preview.count) : preview?.why ?? 'no preview');
  if (!preview?.ok) return;

  const done = await applyMutation({
    text, ...actor('admin'), store: postgrestStore(db.supabase),
    previewPlanHash: planned.planned.meaning.hash,
    previewProgrammeHash: preview.programmeHash,
  });
  ok('it runs', done.ok, done.ok ? '' : done.why);
  if (!done.ok) return;

  const lead = (db.tables.crm_contacts ?? []).find((r) => r.source === 'From Stock');
  ok('a lead was made against the unit', !!lead, JSON.stringify(db.tables.crm_contacts));
  ok('on the trailer sales side', lead?.side === 'trailer_sales', String(lead?.side));
  ok('linked to the unit it came from', lead?.stock_trailer_id === 't1', String(lead?.stock_trailer_id));
});

test('a proposal is raised, on the side of the business the words said', async () => {
  const db = fakeDb({
    crm_contacts: [
      { id: 'c1', company_name: 'Dawson Group', status: 'lead', relationship: 'existing',
        contact_name: 'Sam Dawson', email: 's@dawson.co.uk', location: 'Hyde' },
    ],
    crm_lists: [{ id: 'L1', name: 'Sales tracker', owner_id: 'u1', is_global: false }],
  });
  const text = 'raise a maintenance proposal for Dawson Group';

  const planned = await plan(text, 'admin', db);
  ok('it plans', !!planned);
  if (!planned) return;
  ok('as the proposal operation',
    planned.planned.planning.plan.steps
      .some((s) => s.op === 'invoke' && s.capability === 'crm.raiseProposal'),
    JSON.stringify(planned.planned.planning.plan.steps.map((s) => s.op)));
  ok('and the summary says which kind',
    /maintenance/.test(planned.planned.meaning.summary), planned.planned.meaning.summary);

  const preview = planned.preview;
  if (!preview?.ok) { ok('it previews', false, preview?.why ?? 'no preview'); return; }

  const done = await applyMutation({
    text, ...actor('admin'), store: postgrestStore(db.supabase),
    previewPlanHash: planned.planned.meaning.hash,
    previewProgrammeHash: preview.programmeHash,
  });
  ok('it runs', done.ok, done.ok ? '' : done.why);
  if (!done.ok) return;

  const raised = db.tables.crm_contacts.find((r) => r.source === 'CRM proposal');
  ok('a quoted row was raised', raised?.status === 'quoted', String(raised?.status));
  ok('on the maintenance side', raised?.side === 'maintenance', String(raised?.side));
  /* Carried across so the dashboard can split proposals to prospects
     from proposals to existing customers. */
  ok('carrying the relationship across', raised?.relationship === 'existing',
    String(raised?.relationship));
});

test('a viewer cannot raise a proposal, from either direction', async () => {
  const reachable = planCommand('raise a proposal for Dawson Group', {
    actorCapabilities: [...capabilitiesFor({ role: 'viewer' } as never)],
  })?.plan.steps.some((s) => s.op === 'invoke' && s.capability === 'crm.raiseProposal') ?? false;
  ok('the sentence does not reach it', !reachable);

  const db = fakeDb({
    crm_contacts: [{ id: 'c1', company_name: 'Dawson Group', status: 'lead' }],
  });
  db.as('viewer');
  const out = await postgrestStore(db.supabase).invoke({
    capability: 'crm.raiseProposal', subjects: ['c1'], args: { kind: 'trailer_sales' },
  });
  ok('and neither does the database call', !out.ok, 'it raised one');
  if (!out.ok) ok('naming the capability', /crm\.proposal/.test(out.why), out.why);
});


/* =============================================================
   27. An operation whose work is not SQL

   Looking a company up in Lusha is an HTTP call to somebody else's
   service that spends a credit and cannot be rolled back. It cannot be
   inside the transaction and must not be after it, so it runs where a
   file is rendered and what it finds becomes changes the transaction
   writes.
   ============================================================= */

test('enrichment is not offered while Lusha is switched off', async () => {
  /* LUSHA_LOCKED strips crm.enrich from every role, so the sentence
     reaches nothing. That is the product's current state and the reason
     for it is a decision about credits, not a gap in the runtime. */
  const planning = planCommand('enrich Dawson Group', {
    actorCapabilities: [...capabilitiesFor({ role: 'admin' } as never)],
  });
  const reaches = planning?.plan.steps
    .some((s) => s.op === 'invoke' && s.capability === 'contact.enrich') ?? false;
  ok('nobody can reach it today', !reaches,
    JSON.stringify(planning?.plan.steps.map((s) => s.op)));
});

test('with the credit lock lifted, enrichment plans as a real operation', async () => {
  /* The capabilities are passed in rather than derived, which is how
     the admin panel will grant this when the lock lifts. Everything
     downstream is the production path. */
  const withEnrich = [...capabilitiesFor({ role: 'admin' } as never), 'crm.enrich'];
  const planning = planCommand('enrich Dawson Group', { actorCapabilities: withEnrich });

  ok('it plans', !!planning);
  if (!planning) return;
  ok('as the enrichment operation',
    planning.plan.steps.some((s) => s.op === 'invoke' && s.capability === 'contact.enrich'),
    JSON.stringify(planning.plan.steps.map((s) => s.op)));
  ok('it is well formed', planning.availability.representable, JSON.stringify(planning.problems));
  ok('and something performs it', planning.availability.executable,
    JSON.stringify(planning.availability.unavailable));
  ok('it has to be confirmed', planning.confirm);
});

test('the lock refuses the spend before anything is written', async () => {
  const db = fakeDb({
    crm_contacts: [
      { id: 'c1', company_name: 'Dawson Group', status: 'lead', email: 'sam@dawson.co.uk' },
    ],
  });
  const withEnrich = [...capabilitiesFor({ role: 'admin' } as never), 'crm.enrich'];
  const text = 'enrich Dawson Group';

  const planned = await planAndPreview({
    text, capabilities: withEnrich, vocabulary: async () => EMPTY_VOCABULARY,
    store: postgrestStore(db.supabase), preview: true,
  });
  const preview = planned?.preview;
  /* The preview asks the preparer what it WOULD do, and the lock is the
     answer. Refusing here rather than at the confirmation means nobody
     is shown a preview of a lookup that was never going to happen. */
  ok('the preview refuses', preview?.ok === false,
    preview?.ok ? String(preview.count) : '');
  if (preview && !preview.ok) {
    ok('because Lusha is off', /switched off/.test(preview.why), preview.why);
  }
  if (!planned) return;

  /* And confirming it anyway still refuses, before the transaction
     opens, so there is nothing to undo. */
  const done = await applyMutation({
    text, capabilities: withEnrich, vocabulary: async () => EMPTY_VOCABULARY,
    store: postgrestStore(db.supabase),
    previewPlanHash: planned.planned.meaning.hash,
    previewProgrammeHash: preview?.ok ? preview.programmeHash : 'none',
  });
  ok('it refuses', !done.ok, 'it spent a credit');
  ok('and nothing was written', db.writes.length === 0, JSON.stringify(db.writes));
});

/* =============================================================
   27b. Paid work that is bought once and never lost

   Lusha cannot join a PostgreSQL transaction. The lookup used to happen
   and then the transaction that recorded it could fail, which spent a
   credit and changed nothing, and a retry spent another for the same
   answer. The purchase is now recorded before it happens and consumed
   from the record, so a retry of the same confirmation reuses it.
   ============================================================= */

test('a failed transaction does not buy the same lookup twice', async () => {
  const db = fakeDb({
    crm_contacts: [
      { id: 'c1', company_name: 'Dawson Group', status: 'lead', email: 'sam@dawson.co.uk' },
    ],
  });
  const withEnrich = [...capabilitiesFor({ role: 'admin' } as never), 'crm.enrich'];
  const text = 'enrich Dawson Group';

  /* A provider that counts its purchased calls, and the lock lifted so
     the contract can be proved before anybody can spend a real one. */
  let calls = 0;
  const real = PROVIDER.lookUp;
  LUSHA_GATE.locked = false;
  PROVIDER.lookUp = async () => {
    calls += 1;
    return {
      ok: true,
      fields: { contact_name: 'Sam Dawson', phone: '0161 000 0001', source: 'Lusha (email)' },
      strategy: 'email', attempts: [], tried: 'email', remaining: [],
      address: null, website: null,
    };
  };

  try {
    const planned = await planAndPreview({
      text, capabilities: withEnrich, vocabulary: async () => EMPTY_VOCABULARY,
      store: postgrestStore(db.supabase), preview: true,
    });
    const preview = planned?.preview;
    ok('it previews the one credit', preview?.ok === true && preview.count === 1,
      preview?.ok ? String(preview.count) : preview?.why ?? 'no preview');
    if (!planned || !preview?.ok) return;

    ok('and says so out loud',
      /at most one credit/.test(preview.operations[0]?.says ?? ''),
      preview.operations[0]?.says ?? '');

    /* One ledger across both attempts, because that is the point: the
       retry has to find the answer the first one bought. */
    const ledger = fakeLedger().store;
    const confirmed = {
      text, capabilities: withEnrich, vocabulary: async () => EMPTY_VOCABULARY,
      ledger, actorId: 'u1',
      previewPlanHash: planned.planned.meaning.hash,
      previewProgrammeHash: preview.programmeHash,
    };

    /* The transaction fails after the credit has been spent. */
    const breaking = postgrestStore(db.supabase);
    const first = await applyMutation({
      ...confirmed,
      store: {
        ...breaking,
        perform: async () => ({ ok: false, why: 'the database fell over' }),
      },
    });
    ok('the write fails', !first.ok, 'it should have failed');
    ok('but the credit was spent', calls === 1, String(calls));
    ok('and nothing was written', db.writes.length === 0, JSON.stringify(db.writes));

    /* The same confirmation, retried. */
    const second = await applyMutation({ ...confirmed, store: postgrestStore(db.supabase) });
    ok('the retry goes through', second.ok, second.ok ? '' : second.why);
    ok('and it did NOT buy the lookup again', calls === 1, String(calls));

    const row = (db.tables.crm_contacts ?? [])[0];
    ok('the stored answer was applied', row?.contact_name === 'Sam Dawson', String(row?.contact_name));
  } finally {
    PROVIDER.lookUp = real;
    LUSHA_GATE.locked = true;
  }
});

test('a record with nothing to look up by costs nothing and is named', async () => {
  const db = fakeDb({
    crm_contacts: [{ id: 'c1', company_name: 'Dawson Group', status: 'lead' }],
  });
  const withEnrich = [...capabilitiesFor({ role: 'admin' } as never), 'crm.enrich'];

  LUSHA_GATE.locked = false;
  try {
    const planned = await planAndPreview({
      text: 'enrich Dawson Group', capabilities: withEnrich,
      vocabulary: async () => EMPTY_VOCABULARY,
      store: postgrestStore(db.supabase), preview: true,
    });
    const preview = planned?.preview;
    ok('the preview refuses', preview?.ok === false, preview?.ok ? String(preview.count) : '');
    if (preview && !preview.ok) {
      ok('and says what is missing', /email address/.test(preview.why), preview.why);
    }
  } finally {
    LUSHA_GATE.locked = true;
  }
});

/* =============================================================
   28. A meeting is named by when it is, not by what it is called

   Nobody types a meeting's title. It is referred to by the day, the
   time, and what it is about, and the reference is composed out of
   whichever of those the sentence gave. Several matches ask, none says
   none, and neither picks the first.
   ============================================================= */

/** The coming occurrence of a weekday, today included. */
function comingUp(weekday: number, hour: number, minute = 0): string {
  const d = new Date();
  d.setHours(hour, minute, 0, 0);
  d.setDate(d.getDate() + ((weekday - d.getDay() + 7) % 7));
  return d.toISOString();
}

const DIARY = () => ({
  calendar_events: [
    { id: 'e1', title: 'Site visit, Ward Bros', description: 'Yard walk round',
      start_at: comingUp(5, 9), end_at: comingUp(5, 10), visibility: 'team', created_by: 'u1' },
    { id: 'e2', title: 'Call with Dawson Group', description: null,
      start_at: comingUp(5, 14), end_at: null, visibility: 'team', created_by: 'u1' },
    { id: 'e3', title: 'Site visit, Culina', description: null,
      start_at: comingUp(1, 11), end_at: null, visibility: 'team', created_by: 'u1' },
  ],
  profiles: [
    { id: 'u1', full_name: 'Alex Ellis', email: 'alex@stc.co.uk', role: 'admin' },
    { id: 'u2', full_name: 'Dave Rowan', email: 'dave@stc.co.uk', role: 'sales' },
  ],
});

const DELEGATE = [...capabilitiesFor({ role: 'admin' } as never)];

test("cancelling Friday's site visit finds the one on Friday", async () => {
  const db = fakeDb(DIARY());
  const text = "cancel Friday's site visit";

  const planned = await planAndPreview({
    text, capabilities: DELEGATE, vocabulary: async () => EMPTY_VOCABULARY,
    store: postgrestStore(db.supabase), preview: true,
  });
  const preview = planned?.preview;
  ok('it previews one meeting', preview?.ok === true && preview.count === 1,
    preview?.ok ? String(preview.count) : preview?.why ?? 'no preview');
  if (!planned || !preview?.ok) return;

  /* Not the Monday site visit, and not the Friday call. Both are in the
     diary, and a reference built out of one part alone would have taken
     one of them. */
  ok('and it is the right one', preview.rows[0]?.label?.includes('Ward Bros'),
    JSON.stringify(preview.rows.map((r) => r.label)));

  const done = await applyMutation({
    text, capabilities: DELEGATE, vocabulary: async () => EMPTY_VOCABULARY,
    store: postgrestStore(db.supabase),
    previewPlanHash: planned.planned.meaning.hash,
    previewProgrammeHash: preview.programmeHash,
  });
  ok('it goes through', done.ok, done.ok ? '' : done.why);
  ok('and the meeting is gone',
    !(db.tables.calendar_events ?? []).some((r) => r.id === 'e1'),
    JSON.stringify((db.tables.calendar_events ?? []).map((r) => r.id)));
});

test('a description that fits two meetings asks rather than choosing', async () => {
  const db = fakeDb(DIARY());
  /* Two site visits in the diary and no day given. */
  const planned = await planAndPreview({
    text: 'cancel the site visit', capabilities: DELEGATE,
    vocabulary: async () => EMPTY_VOCABULARY,
    store: postgrestStore(db.supabase), preview: true,
  });
  const preview = planned?.preview;
  ok('it refuses to pick one', preview?.ok === false,
    preview?.ok ? String(preview.count) : '');
  if (preview && !preview.ok) {
    ok('and says so', /not clear which|more than one|2 records/i.test(preview.why), preview.why);
  }
  ok('and nothing was written', db.writes.length === 0, JSON.stringify(db.writes));
});

test('a meeting nothing matches says none rather than nothing', async () => {
  const db = fakeDb(DIARY());
  const planned = await planAndPreview({
    text: "cancel Friday's tyre inspection meeting", capabilities: DELEGATE,
    vocabulary: async () => EMPTY_VOCABULARY,
    store: postgrestStore(db.supabase), preview: true,
  });
  const preview = planned?.preview;
  ok('it finds nothing', preview?.ok === false, preview?.ok ? String(preview.count) : '');
  if (preview && !preview.ok) {
    ok('and says nothing matched', /nothing|no /i.test(preview.why), preview.why);
  }
});

test('the 10am meeting tomorrow is a day and a time together', async () => {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const at = (hour: number) => {
    const d = new Date(tomorrow.getTime());
    d.setHours(hour, 0, 0, 0);
    return d.toISOString();
  };
  const db = fakeDb({
    calendar_events: [
      { id: 'e1', title: 'Call with Dawson Group', description: null,
        start_at: at(10), end_at: at(11), visibility: 'team', created_by: 'u1' },
      { id: 'e2', title: 'Call with Dawson Group', description: null,
        start_at: at(15), end_at: null, visibility: 'team', created_by: 'u1' },
    ],
  });

  const text = 'cancel the 10am meeting with Dawson tomorrow';
  const planned = await planAndPreview({
    text, capabilities: DELEGATE,
    vocabulary: async () => EMPTY_VOCABULARY,
    store: postgrestStore(db.supabase), preview: true,
  });
  const preview = planned?.preview;
  /* Two meetings with the same title on the same day. Only the hour
     tells them apart, so a reference that read the day and threw the
     time away would be ambiguous here rather than exact. */
  ok('the hour narrows it to one', preview?.ok === true && preview.count === 1,
    preview?.ok ? String(preview.count) : preview?.why ?? 'no preview');
  if (!planned || !preview?.ok) return;

  const done = await applyMutation({
    text, capabilities: DELEGATE, vocabulary: async () => EMPTY_VOCABULARY,
    store: postgrestStore(db.supabase),
    previewPlanHash: planned.planned.meaning.hash,
    previewProgrammeHash: preview.programmeHash,
  });
  ok('it goes through', done.ok, done.ok ? '' : done.why);
  const left = (db.tables.calendar_events ?? []).map((r) => String(r.id));
  ok('and it is the ten o clock one that went',
    left.length === 1 && left[0] === 'e2', JSON.stringify(left));
});

test('moving a meeting keeps its length and tells the diary', async () => {
  const db = fakeDb(DIARY());
  const text = 'move my site visit on Friday to 2pm';

  const planned = await planAndPreview({
    text, capabilities: DELEGATE, vocabulary: async () => EMPTY_VOCABULARY,
    store: postgrestStore(db.supabase), preview: true,
  });
  const preview = planned?.preview;
  ok('it previews the move', preview?.ok === true && preview.count === 1,
    preview?.ok ? String(preview.count) : preview?.why ?? 'no preview');
  if (!planned || !preview?.ok) return;

  const done = await applyMutation({
    text, capabilities: DELEGATE, vocabulary: async () => EMPTY_VOCABULARY,
    store: postgrestStore(db.supabase),
    previewPlanHash: planned.planned.meaning.hash,
    previewProgrammeHash: preview.programmeHash,
  });
  ok('it goes through', done.ok, done.ok ? '' : done.why);

  const moved = (db.tables.calendar_events ?? []).find((r) => r.id === 'e1');
  ok('the meeting starts at two', new Date(String(moved?.start_at)).getHours() === 14,
    String(moved?.start_at));
  /* An hour long meeting is still an hour long. Writing the start alone
     would have left it finishing before it began. */
  const length = Date.parse(String(moved?.end_at)) - Date.parse(String(moved?.start_at));
  ok('and it is still an hour long', length === 60 * 60 * 1000, String(length));
});

test('a meeting on the screen is moved by clock time alone', async () => {
  const db = fakeDb(DIARY());
  const text = 'move this meeting to 4:30pm';
  /* The screen has one open. "This meeting" names it exactly, and the
     sentence says nothing about which day, because it is not moving
     day. */
  const context = { record: { entity: 'meetings', id: 'e1' } };

  const planned = await planAndPreview({
    text, capabilities: DELEGATE, vocabulary: async () => EMPTY_VOCABULARY,
    store: postgrestStore(db.supabase), context, preview: true,
  });
  const preview = planned?.preview;
  ok('it previews the move', preview?.ok === true && preview.count === 1,
    preview?.ok ? String(preview.count) : preview?.why ?? 'no preview');
  if (!planned || !preview?.ok) return;

  const before = new Date(String((db.tables.calendar_events ?? [])[0].start_at));

  const done = await applyMutation({
    text, capabilities: DELEGATE, vocabulary: async () => EMPTY_VOCABULARY,
    store: postgrestStore(db.supabase), context,
    previewPlanHash: planned.planned.meaning.hash,
    previewProgrammeHash: preview.programmeHash,
  });
  ok('it goes through', done.ok, done.ok ? '' : done.why);

  const moved = new Date(String((db.tables.calendar_events ?? []).find((r) => r.id === 'e1')?.start_at));
  ok('the clock moved', moved.getHours() === 16 && moved.getMinutes() === 30,
    moved.toISOString());
  ok('and the day did not', moved.toDateString() === before.toDateString(),
    `${before.toDateString()} to ${moved.toDateString()}`);
});

test('a marketer cannot cancel a meeting', async () => {
  const marketer = [...capabilitiesFor({ role: 'marketer' } as never)];
  const planning = planCommand("cancel Friday's site visit", {
    actorCapabilities: marketer,
  });
  const cancels = planning?.plan.steps.some((s) => s.op === 'delete') ?? false;
  /* Cancelling a meeting is crm.delegate, which a marketer does not
     have. Nothing you cannot do is ever offered. */
  ok('it is not offered', !cancels, JSON.stringify(planning?.plan.steps.map((s) => s.op)));
});

test('inviting somebody resolves the person and the meeting', async () => {
  const db = fakeDb(DIARY());
  const text = 'invite Dave to the site visit on Friday';

  const planned = await planAndPreview({
    text, capabilities: DELEGATE, vocabulary: async () => EMPTY_VOCABULARY,
    store: postgrestStore(db.supabase), preview: true,
  });
  const preview = planned?.preview;
  ok('it previews the invitation', preview?.ok === true && preview.count === 1,
    preview?.ok ? String(preview.count) : preview?.why ?? 'no preview');
  if (!planned || !preview?.ok) return;

  const done = await applyMutation({
    text, capabilities: DELEGATE, vocabulary: async () => EMPTY_VOCABULARY,
    store: postgrestStore(db.supabase),
    previewPlanHash: planned.planned.meaning.hash,
    previewProgrammeHash: preview.programmeHash,
  });
  ok('it goes through', done.ok, done.ok ? '' : done.why);
  const invites = db.tables.calendar_invites ?? [];
  ok('and Dave is on the meeting',
    invites.some((i) => String(i.user_id) === 'u2' && String(i.event_id) === 'e1'),
    JSON.stringify(invites));
});

/* =============================================================
   29. A post somebody has already written is not a form to open

   The command bar used to answer every one of these by opening the
   composer with the text pre-filled, which asks somebody who has typed
   the whole post to type it again. A sentence carrying the content
   writes the draft; one naming only a topic still opens the composer,
   because a draft whose text is the topic is worse than no draft.
   ============================================================= */

const MARKETING = [...capabilitiesFor({ role: 'marketer' } as never)];

test('a post with its words in the sentence is written', async () => {
  const db = fakeDb({
    social_posts: [],
    profiles: [{ id: 'u1', full_name: 'Alex Ellis', email: 'alex@stc.co.uk', role: 'marketer' }],
  });
  const text = 'create a LinkedIn post saying "Our Haydock depot is open Saturday"';

  const planned = await planAndPreview({
    text, capabilities: MARKETING, vocabulary: async () => EMPTY_VOCABULARY,
    store: postgrestStore(db.supabase), preview: true,
  });
  ok('it plans as an operation',
    planned?.planned.planning.plan.steps
      .some((s) => s.op === 'invoke' && s.capability === 'post.create') ?? false,
    JSON.stringify(planned?.planned.planning.plan.steps.map((s) => s.op)));

  const preview = planned?.preview;
  /* A post that makes one record is one record, even though the
     operation acts on none. */
  ok('and previews one record', preview?.ok === true && preview.count === 1,
    preview?.ok ? String(preview.count) : preview?.why ?? 'no preview');
  if (!planned || !preview?.ok) return;

  const done = await applyMutation({
    text, capabilities: MARKETING, vocabulary: async () => EMPTY_VOCABULARY,
    store: postgrestStore(db.supabase),
    previewPlanHash: planned.planned.meaning.hash,
    previewProgrammeHash: preview.programmeHash,
  });
  ok('it goes through', done.ok, done.ok ? '' : done.why);

  const post = (db.tables.social_posts ?? [])[0];
  ok('the post says what the sentence said',
    post?.content === 'Our Haydock depot is open Saturday', String(post?.content));
  ok('on the platform it named',
    JSON.stringify(post?.platform) === JSON.stringify(['LinkedIn']),
    JSON.stringify(post?.platform));
  /* The author and the status come from the profile, not the sentence,
     which is what stops a typed post arriving unattributed or approved. */
  ok('by whoever wrote it', post?.created_by === 'Alex Ellis', String(post?.created_by));
  ok('and waiting for approval', post?.status === 'pending_review', String(post?.status));
});

test('a post that names only a topic is asked about, never written from the topic', async () => {
  const planning = planCommand('create a social post about the Haydock depot', {
    actorCapabilities: MARKETING,
  });
  const step = planning?.plan.steps
    .find((x) => x.op === 'invoke' && x.capability === 'post.create');

  /* IT USED TO DECLINE, AND DECLINING WAS THE WRONG ANSWER.

     A topic is not what the post says, and a draft whose text is the
     topic is worse than no draft: that part has not moved. What has is
     that the sentence is now read for what it plainly is, an operation
     with one value missing, and asked about. */
  ok('the operation is understood', !!step, JSON.stringify(planning?.plan.steps.map((s) => s.op)));
  ok('the topic never becomes the words of the post',
    !(step && step.op === 'invoke' && step.args?.content),
    JSON.stringify(step && step.op === 'invoke' ? step.args : null));
  ok('it is incomplete rather than runnable',
    planning?.completion.kind === 'incomplete', JSON.stringify(planning?.completion));
  ok('and what it asks for is the content',
    planning?.completion.kind === 'incomplete'
      && planning.completion.missing[0].ask === 'What should it say?',
    JSON.stringify(planning?.completion));
});

test('a sales rep cannot write a post by typing one', async () => {
  const sales = [...capabilitiesFor({ role: 'sales' } as never)];
  const planning = planCommand('create a LinkedIn post saying "we are open Saturday"', {
    actorCapabilities: sales,
  });
  const writes = planning?.plan.steps
    .some((s) => s.op === 'invoke' && s.capability === 'post.create') ?? false;
  ok('it is not offered', !writes, JSON.stringify(planning?.plan.steps.map((s) => s.op)));
});

/* =============================================================
   30. A file the browser is holding

   A selection arrives from the browser and the server decides what may
   be done with it. A file is the same kind of thing. Nothing of it
   reaches the plan except a fingerprint, the rows are read on the server
   against the same dictionary the import screen uses, and the preview
   says how many customers are going to appear before anybody agrees.
   ============================================================= */

const SHEET = [
  'Company,Contact,Email,Phone',
  'Dawson Group,Sam Dawson,sam@dawson.co.uk,0161 000 0001',
  'Ward Bros,Lisa Ward,lisa@wardbros.co.uk,0161 000 0002',
  ',Nobody At All,nobody@nowhere.co.uk,0161 000 0003',
].join('\n');

const withSheet = (text = SHEET) => ({
  file: { name: 'leads.csv', mime: 'text/csv', size: text.length, text },
});

const IMPORTER = [...capabilitiesFor({ role: 'sales' } as never)];

test('a spreadsheet on the request is imported', async () => {
  const db = fakeDb({
    crm_contacts: [],
    crm_lists: [{ id: 'l1', name: 'Everything', is_global: true }],
  });
  const text = 'import this spreadsheet';
  const context = withSheet();

  const planned = await planAndPreview({
    text, capabilities: IMPORTER, vocabulary: async () => EMPTY_VOCABULARY,
    store: postgrestStore(db.supabase), context, preview: true,
  });
  ok('it plans as an import',
    planned?.planned.planning.plan.steps
      .some((s) => s.op === 'invoke' && s.capability === 'rows.import') ?? false,
    JSON.stringify(planned?.planned.planning.plan.steps.map((s) => s.op)));

  const preview = planned?.preview;
  /* Two of the three rows have a company name. The third has none, and
     the old import filled that in with "Unknown". */
  ok('and previews the two rows it can file', preview?.ok === true && preview.count === 2,
    preview?.ok ? String(preview.count) : preview?.why ?? 'no preview');
  if (!planned || !preview?.ok) return;

  const said = preview.operations[0]?.says ?? '';
  ok('saying what was left out', /1 row has no company name/.test(said), said);
  ok('and what the columns were read as', /Columns read as:.*Company/i.test(said), said);
  ok('and nothing has been written yet', db.writes.length === 0, JSON.stringify(db.writes));

  const done = await applyMutation({
    text, capabilities: IMPORTER, vocabulary: async () => EMPTY_VOCABULARY,
    store: postgrestStore(db.supabase), context,
    previewPlanHash: planned.planned.meaning.hash,
    previewProgrammeHash: preview.programmeHash,
  });
  ok('it goes through', done.ok, done.ok ? '' : done.why);

  const rows = db.tables.crm_contacts ?? [];
  ok('two customers arrived', rows.length === 2, String(rows.length));
  ok('with the names the file gave',
    rows.map((r) => String(r.company_name)).sort().join(', ') === 'Dawson Group, Ward Bros',
    JSON.stringify(rows.map((r) => r.company_name)));
  ok('on the list they were imported to',
    rows.every((r) => String(r.list_id) === 'l1'), JSON.stringify(rows.map((r) => r.list_id)));
  ok('and marked as having come from a spreadsheet',
    rows.every((r) => String(r.source) === 'Spreadsheet import'),
    JSON.stringify(rows.map((r) => r.source)));
});

test('a row already in the CRM is left alone', async () => {
  const db = fakeDb({
    crm_contacts: [
      { id: 'c1', company_name: 'Dawson Group', email: 'sam@dawson.co.uk', status: 'lead' },
    ],
    crm_lists: [{ id: 'l1', name: 'Everything', is_global: true }],
  });
  const text = 'import this spreadsheet';
  const context = withSheet();

  const planned = await planAndPreview({
    text, capabilities: IMPORTER, vocabulary: async () => EMPTY_VOCABULARY,
    store: postgrestStore(db.supabase), context, preview: true,
  });
  const preview = planned?.preview;
  /* Three rows: one already here, one new, one with no company name. */
  ok('only the new one is counted', preview?.ok === true && preview.count === 1,
    preview?.ok ? String(preview.count) : preview?.why ?? 'no preview');
  if (!planned || !preview?.ok) return;

  const said = preview.operations[0]?.says ?? '';
  ok('and the duplicate is named as one',
    /1 row is already in the CRM/.test(said), said);

  const done = await applyMutation({
    text, capabilities: IMPORTER, vocabulary: async () => EMPTY_VOCABULARY,
    store: postgrestStore(db.supabase), context,
    previewPlanHash: planned.planned.meaning.hash,
    previewProgrammeHash: preview.programmeHash,
  });
  ok('it goes through', done.ok, done.ok ? '' : done.why);
  const rows = db.tables.crm_contacts ?? [];
  ok('and Dawson Group is not in there twice',
    rows.filter((r) => String(r.company_name) === 'Dawson Group').length === 1,
    JSON.stringify(rows.map((r) => r.company_name)));
});

test('a customer arriving between the preview and the confirmation refuses', async () => {
  const db = fakeDb({
    crm_contacts: [],
    crm_lists: [{ id: 'l1', name: 'Everything', is_global: true }],
  });
  const text = 'import this spreadsheet';
  const context = withSheet();

  const planned = await planAndPreview({
    text, capabilities: IMPORTER, vocabulary: async () => EMPTY_VOCABULARY,
    store: postgrestStore(db.supabase), context, preview: true,
  });
  const preview = planned?.preview;
  ok('two records are previewed', preview?.ok === true && preview.count === 2,
    preview?.ok ? String(preview.count) : preview?.why ?? 'no preview');
  if (!planned || !preview?.ok) return;

  /* Somebody else adds one of them while the preview is on screen. */
  (db.tables.crm_contacts ?? []).push({
    id: 'c9', company_name: 'Ward Bros', email: 'lisa@wardbros.co.uk', status: 'lead',
  });

  const done = await applyMutation({
    text, capabilities: IMPORTER, vocabulary: async () => EMPTY_VOCABULARY,
    store: postgrestStore(db.supabase), context,
    previewPlanHash: planned.planned.meaning.hash,
    previewProgrammeHash: preview.programmeHash,
  });
  /* Previewing two and importing one is exactly what must not happen. */
  ok('it refuses', !done.ok, 'it imported a different set than the one agreed');
  ok('and nothing was written', db.writes.length === 0, JSON.stringify(db.writes));
  if (!done.ok) {
    ok('with a fresh preview to look at', done.reason === 'drift', done.reason);
  }
});

test('a list name that fits two lists asks rather than picking one', async () => {
  const db = fakeDb({
    crm_contacts: [],
    crm_lists: [
      { id: 'l1', name: 'Everything', is_global: true },
      { id: 'l2', name: 'Fleet prospects', is_global: false },
      { id: 'l3', name: 'Fleet Prospects', is_global: false },
    ],
  });

  const planned = await planAndPreview({
    text: 'import this spreadsheet onto the Fleet Prospects list',
    capabilities: IMPORTER, vocabulary: async () => EMPTY_VOCABULARY,
    store: postgrestStore(db.supabase), context: withSheet(), preview: true,
  });
  const preview = planned?.preview;
  ok('it refuses to choose', preview?.ok === false, preview?.ok ? String(preview.count) : '');
  if (preview && !preview.ok) {
    ok('and says which ones it could have meant', /2 lists match/.test(preview.why), preview.why);
  }
  ok('and nothing was written', db.writes.length === 0, JSON.stringify(db.writes));
});

test('confirming a different file than the one previewed is refused', async () => {
  const db = fakeDb({
    crm_contacts: [],
    crm_lists: [{ id: 'l1', name: 'Everything', is_global: true }],
  });
  const text = 'import this spreadsheet';

  const planned = await planAndPreview({
    text, capabilities: IMPORTER, vocabulary: async () => EMPTY_VOCABULARY,
    store: postgrestStore(db.supabase), context: withSheet(), preview: true,
  });
  const preview = planned?.preview;
  ok('the first file previews', preview?.ok === true, preview?.ok ? '' : preview?.why ?? '');
  if (!planned || !preview?.ok) return;

  /* Same sentence, same hashes, different spreadsheet. */
  const swapped = 'Company,Email\nSomebody Else Ltd,else@nowhere.co.uk';
  const done = await applyMutation({
    text, capabilities: IMPORTER, vocabulary: async () => EMPTY_VOCABULARY,
    store: postgrestStore(db.supabase), context: withSheet(swapped),
    previewPlanHash: planned.planned.meaning.hash,
    previewProgrammeHash: preview.programmeHash,
  });
  ok('it refuses', !done.ok, 'it imported the file nobody looked at');
  ok('and nothing was written', db.writes.length === 0, JSON.stringify(db.writes));
});

test('an import with no file attached is not an instruction', async () => {
  const planning = planCommand('import this spreadsheet', { actorCapabilities: IMPORTER });
  const imports = planning?.plan.steps
    .some((s) => s.op === 'invoke' && s.capability === 'rows.import') ?? false;
  ok('nothing is planned from words alone', !imports,
    JSON.stringify(planning?.plan.steps.map((s) => s.op)));
});

test('a marketer cannot import a spreadsheet', async () => {
  const marketer = [...capabilitiesFor({ role: 'marketer' } as never)];
  const planning = planCommand('import this spreadsheet', {
    actorCapabilities: marketer, context: withSheet(),
  });
  const imports = planning?.plan.steps
    .some((s) => s.op === 'invoke' && s.capability === 'rows.import') ?? false;
  ok('it is not offered', !imports, JSON.stringify(planning?.plan.steps.map((s) => s.op)));
});

test('a file with no company names anywhere is refused before the preview', async () => {
  const db = fakeDb({
    crm_contacts: [],
    crm_lists: [{ id: 'l1', name: 'Everything', is_global: true }],
  });
  const nameless = 'Email,Phone\nsam@dawson.co.uk,0161 000 0001';

  const planned = await planAndPreview({
    text: 'import this spreadsheet', capabilities: IMPORTER,
    vocabulary: async () => EMPTY_VOCABULARY,
    store: postgrestStore(db.supabase), context: withSheet(nameless), preview: true,
  });
  const preview = planned?.preview;
  ok('the preview refuses', preview?.ok === false, preview?.ok ? String(preview.count) : '');
  if (preview && !preview.ok) {
    ok('and says why', /company name/.test(preview.why), preview.why);
  }
  ok('and nothing was written', db.writes.length === 0, JSON.stringify(db.writes));
});

/* =============================================================
   31. One sentence, one plan, one authority

   A canonical refusal used to fall through to a second parser with its
   own route behind it, which could decide the sentence meant something
   else and carry that out. The route is gone; these are the assertions
   that say so and that nothing rescues a refusal.
   ============================================================= */

test('a sentence the canonical planner refuses reaches nothing', async () => {
  const db = fakeDb({
    crm_contacts: [{ id: 'c1', company_name: 'Dawson Group', status: 'lead' }],
    stock_trailers: [{ id: 't1', stc_no: 'STC1', status: 'in_stock' }],
  });
  /* Words the old parser scored as `create_prospect` with a missing
     slot, and which the canonical planner makes nothing of. */
  const text = 'wibble the frobnicator for Dawson';

  const planned = await planAndPreview({
    text, capabilities: [...capabilitiesFor({ role: 'admin' } as never)],
    vocabulary: async () => EMPTY_VOCABULARY,
    store: postgrestStore(db.supabase), preview: true,
  });
  ok('nothing plans it', planned === null, JSON.stringify(planned?.planned.meaning.summary));

  /* And confirming it anyway, which is what a client could always try,
     writes nothing. */
  const done = await applyMutation({
    text, capabilities: [...capabilitiesFor({ role: 'admin' } as never)],
    vocabulary: async () => EMPTY_VOCABULARY,
    store: postgrestStore(db.supabase),
    previewPlanHash: 'anything', previewProgrammeHash: 'anything',
  });
  ok('and applying it refuses', !done.ok, 'it did something');
  ok('with nothing written', db.writes.length === 0, JSON.stringify(db.writes));
});

test('the deleted executor has no callers in production code', async () => {
  const walk = (dir: string): string[] => {
    const out: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) { out.push(...walk(full)); continue; }
      if (!/\.(ts|tsx)$/.test(entry.name)) continue;
      if (/api\/command\/execute/.test(readFileSync(full, 'utf8'))) out.push(full);
    }
    return out;
  };
  const callers = [...walk('app'), ...walk('components'), ...walk('lib')];
  ok('nothing references it', callers.length === 0, callers.join(', '));

  /* And the route itself is gone, so restoring a caller cannot quietly
     start working again. */
  ok('and the route is gone', !existsSync('app/api/command/execute/route.ts'));
});

/* =============================================================
   32. What it takes to attach depends on what it is attached to

   The database has always derived this from the target table. The
   registry said crm.edit flatly, which is the same answer only while the
   role bundles happen to overlap, and the architecture supports
   per-user grants on purpose.
   ============================================================= */

test('a stock updater may attach to a trailer and not to a customer', async () => {
  /* Not a role. An explicit grant, which is what the admin panel will
     hand out and what the four bundles cannot express. */
  const stockOnly = capabilitiesFor({ role: 'viewer' } as never, {
    'stock.edit': true, 'crm.edit': false,
  });

  const onTrailer = planCommand('export the sold trailers as a PDF and attach it to STC143580', {
    actorCapabilities: [...stockOnly],
  });
  ok('attaching to a trailer is offered',
    onTrailer?.availability.permitted !== false,
    JSON.stringify(onTrailer?.availability.missingPermissions));

  const onCustomer = planCommand('export the sold trailers as a PDF and attach it to this customer', {
    actorCapabilities: [...stockOnly],
    context: { record: { entity: 'contacts', id: '11111111-1111-1111-1111-111111111111' } },
  });
  ok('attaching to a customer is not',
    onCustomer === null || onCustomer.availability.permitted === false,
    JSON.stringify(onCustomer?.availability.missingPermissions));

  /* And the other way round, so this is a real distinction rather than
     one grant being stricter than the other. */
  const crmOnly = capabilitiesFor({ role: 'viewer' } as never, {
    'crm.edit': true, 'stock.edit': false,
  });
  const crmOnTrailer = planCommand('export the sold trailers as a PDF and attach it to STC143580', {
    actorCapabilities: [...crmOnly],
  });
  ok('somebody with crm.edit alone cannot attach to a trailer',
    crmOnTrailer === null || crmOnTrailer.availability.permitted === false,
    JSON.stringify(crmOnTrailer?.availability.missingPermissions));
});

/* =============================================================
   33. The parts of a customer that are not columns on it

   A site, a link, and the same business held as two accounts. All three
   have had buttons in the drawer since it was built and no words at
   all.
   ============================================================= */

const CUSTOMER = { record: { entity: 'contacts', id: 'c1' } };

test('a site is added to a customer', async () => {
  const db = fakeDb({
    crm_contacts: [{ id: 'c1', company_name: 'Dawson Group', status: 'lead', links: [] }],
    contact_addresses: [],
  });
  const text = 'add a site to this customer at 4 Ashton Road Hyde';

  const planned = await planAndPreview({
    text, capabilities: [...capabilitiesFor({ role: 'sales' } as never)],
    vocabulary: async () => EMPTY_VOCABULARY,
    store: postgrestStore(db.supabase), context: CUSTOMER, preview: true,
  });
  const preview = planned?.preview;
  ok('it previews', preview?.ok === true, preview && !preview.ok ? preview.why : 'no preview');
  if (!planned || !preview?.ok) return;

  const done = await applyMutation({
    text, capabilities: [...capabilitiesFor({ role: 'sales' } as never)],
    vocabulary: async () => EMPTY_VOCABULARY,
    store: postgrestStore(db.supabase), context: CUSTOMER,
    previewPlanHash: planned.planned.meaning.hash,
    previewProgrammeHash: preview.programmeHash,
  });
  ok('it goes through', done.ok, done.ok ? '' : done.why);
  const site = (db.tables.contact_addresses ?? [])[0];
  ok('and the address is on the account',
    String(site?.address ?? '').includes('4 Ashton Road'), String(site?.address));
});

test('a link is added to a customer and read for what it is', async () => {
  const db = fakeDb({
    crm_contacts: [{ id: 'c1', company_name: 'Dawson Group', status: 'lead', links: [] }],
  });
  const text = 'add their linkedin profile to this account linkedin.com/company/dawson';

  const planned = await planAndPreview({
    text, capabilities: [...capabilitiesFor({ role: 'sales' } as never)],
    vocabulary: async () => EMPTY_VOCABULARY,
    store: postgrestStore(db.supabase), context: CUSTOMER, preview: true,
  });
  const preview = planned?.preview;
  ok('it previews', preview?.ok === true, preview && !preview.ok ? preview.why : 'no preview');
  if (!planned || !preview?.ok) return;

  const done = await applyMutation({
    text, capabilities: [...capabilitiesFor({ role: 'sales' } as never)],
    vocabulary: async () => EMPTY_VOCABULARY,
    store: postgrestStore(db.supabase), context: CUSTOMER,
    previewPlanHash: planned.planned.meaning.hash,
    previewProgrammeHash: preview.programmeHash,
  });
  ok('it goes through', done.ok, done.ok ? '' : done.why);
  const links = ((db.tables.crm_contacts ?? [])[0]?.links ?? []) as { url: string; kind: string }[];
  ok('the link is on the account', links.length === 1, JSON.stringify(links));
  ok('and it knows what kind it is', links[0]?.kind === 'linkedin', JSON.stringify(links));
});

test('a viewer cannot add a site or a link', async () => {
  const viewer = [...capabilitiesFor({ role: 'viewer' } as never)];
  for (const text of [
    'add a site to this customer at 4 Ashton Road Hyde',
    'add their linkedin profile to this account linkedin.com/company/dawson',
  ]) {
    const planning = planCommand(text, { actorCapabilities: viewer, context: CUSTOMER });
    const writes = planning?.plan.steps.some((s) => s.op === 'invoke') ?? false;
    ok(`it is not offered: ${text.slice(0, 24)}`, !writes,
      JSON.stringify(planning?.plan.steps.map((s) => s.op)));
  }
});

/* =============================================================
   34. A supplier's stock file is not a list of customers

   Two things in this application are loaded from a spreadsheet and they
   are not interchangeable. The sentence says which, the file is checked
   against the stock list the same way the import dialog checks it, and
   the write is the operation the stock screen's own import button uses.
   ============================================================= */

const STOCK_SHEET = [
  'STC No,Chassis,Make,Model,Year,Location',
  'STC144001,C99001,Schmitz,Curtainsider,2021,Carrington',
  'STC144002,C99002,SDC,Box,2019,Hyde',
  ',C99003,Krone,Fridge,2020,Hyde',
].join('\n');

const withStockSheet = () => ({
  file: {
    name: 'supplier-stock.csv', mime: 'text/csv',
    size: STOCK_SHEET.length, text: STOCK_SHEET,
  },
});

const STOCK_LOADER = [...capabilitiesFor({ role: 'sales' } as never)];

test('a stock file goes onto the stock list', async () => {
  const db = fakeDb({ stock_trailers: [], crm_lists: [{ id: 'l1', name: 'Everything', is_global: true }] });
  const text = 'import this stock file';
  const context = withStockSheet();

  const planned = await planAndPreview({
    text, capabilities: STOCK_LOADER, vocabulary: async () => EMPTY_VOCABULARY,
    store: postgrestStore(db.supabase), context, preview: true,
  });
  ok('it plans as a stock import rather than a customer import',
    planned?.planned.planning.plan.steps
      .some((s) => s.op === 'invoke' && s.capability === 'stock.import') ?? false,
    JSON.stringify(planned?.planned.planning.plan.steps.map(
      (s) => (s.op === 'invoke' ? s.capability : s.op))));

  const preview = planned?.preview;
  /* Two of the three rows have a stock number. The third has none, and
     a unit without one cannot be found again. */
  ok('and previews the two units it can identify', preview?.ok === true && preview.count === 2,
    preview?.ok ? String(preview.count) : preview?.why ?? 'no preview');
  if (!planned || !preview?.ok) return;

  const said = preview.operations[0]?.says ?? '';
  ok('saying what was left out', /1 row has no stock number/.test(said), said);
  ok('and what the columns were read as', /Columns read as:.*STC No/i.test(said), said);
  ok('and nothing has been written yet', db.writes.length === 0, JSON.stringify(db.writes));

  const done = await applyMutation({
    text, capabilities: STOCK_LOADER, vocabulary: async () => EMPTY_VOCABULARY,
    store: postgrestStore(db.supabase), context,
    previewPlanHash: planned.planned.meaning.hash,
    previewProgrammeHash: preview.programmeHash,
  });
  ok('it goes through', done.ok, done.ok ? '' : done.why);

  const rows = db.tables.stock_trailers ?? [];
  ok('two trailers arrived', rows.length === 2, String(rows.length));
  ok('with the stock numbers the file gave',
    rows.map((r) => String(r.stc_no)).sort().join(', ') === 'STC144001, STC144002',
    JSON.stringify(rows.map((r) => r.stc_no)));
  ok('and no customer was created',
    (db.tables.crm_contacts ?? []).length === 0,
    String((db.tables.crm_contacts ?? []).length));
});

test('a unit already on the stock list is left alone', async () => {
  const db = fakeDb({
    stock_trailers: [{ id: 's1', stc_no: 'STC144001', chassis_number: 'C99001', status: 'in_stock' }],
  });
  const text = 'sync the stock list from this file';
  const context = withStockSheet();

  const planned = await planAndPreview({
    text, capabilities: STOCK_LOADER, vocabulary: async () => EMPTY_VOCABULARY,
    store: postgrestStore(db.supabase), context, preview: true,
  });
  const preview = planned?.preview;
  ok('only the new one is counted', preview?.ok === true && preview.count === 1,
    preview?.ok ? String(preview.count) : preview?.why ?? 'no preview');
  if (!planned || !preview?.ok) return;

  ok('and the duplicate is named as one',
    /1 row is already on the stock list/.test(preview.operations[0]?.says ?? ''),
    preview.operations[0]?.says ?? '');

  const done = await applyMutation({
    text, capabilities: STOCK_LOADER, vocabulary: async () => EMPTY_VOCABULARY,
    store: postgrestStore(db.supabase), context,
    previewPlanHash: planned.planned.meaning.hash,
    previewProgrammeHash: preview.programmeHash,
  });
  ok('it goes through', done.ok, done.ok ? '' : done.why);
  ok('and STC144001 is not on the list twice',
    (db.tables.stock_trailers ?? []).filter((r) => String(r.stc_no) === 'STC144001').length === 1,
    JSON.stringify((db.tables.stock_trailers ?? []).map((r) => r.stc_no)));
});

test('a unit arriving between the preview and the confirmation refuses', async () => {
  const db = fakeDb({ stock_trailers: [] });
  const text = 'import this stock file';
  const context = withStockSheet();

  const planned = await planAndPreview({
    text, capabilities: STOCK_LOADER, vocabulary: async () => EMPTY_VOCABULARY,
    store: postgrestStore(db.supabase), context, preview: true,
  });
  const preview = planned?.preview;
  ok('two units are previewed', preview?.ok === true && preview.count === 2,
    preview?.ok ? String(preview.count) : preview?.why ?? 'no preview');
  if (!planned || !preview?.ok) return;

  /* Somebody else loads one of them while the preview is on the screen. */
  (db.tables.stock_trailers ??= []).push({
    id: 's9', stc_no: 'STC144002', chassis_number: 'C99002', status: 'in_stock',
  });

  const done = await applyMutation({
    text, capabilities: STOCK_LOADER, vocabulary: async () => EMPTY_VOCABULARY,
    store: postgrestStore(db.supabase), context,
    previewPlanHash: planned.planned.meaning.hash,
    previewProgrammeHash: preview.programmeHash,
  });
  ok('the confirmation refuses rather than loading one of the two', !done.ok,
    done.ok ? 'it went through' : done.why);
  ok('and nothing new was written',
    (db.tables.stock_trailers ?? []).length === 1,
    String((db.tables.stock_trailers ?? []).length));
});

test('a viewer cannot load a stock file', async () => {
  const viewer = [...capabilitiesFor({ role: 'viewer' } as never)];
  const planning = planCommand('import this stock file', {
    actorCapabilities: viewer, context: withStockSheet(),
  });
  ok('it is not offered',
    !(planning?.plan.steps.some((s) => s.op === 'invoke' && s.capability === 'stock.import') ?? false),
    JSON.stringify(planning?.plan.steps.map((s) => (s.op === 'invoke' ? s.capability : s.op))));
});

/* =============================================================
   35. Sharing a list somebody named

   Sharing here is list membership, so a named list needs no records at
   all. Requiring a selection made somebody tick every row on a list
   before they could share the list, and ticking ninety nine of a
   hundred is a refusal rather than a share.
   ============================================================= */

const SHARER = [...capabilitiesFor({ role: 'sales' } as never)];

function listWorld() {
  return fakeDb({
    crm_lists: [
      { id: 'l1', name: 'Fleet Prospects', is_global: false },
      { id: 'l2', name: 'Everything', is_global: true },
    ],
    crm_contacts: [
      { id: 'c1', company_name: 'Dawson Group', list_id: 'l1', status: 'lead' },
      { id: 'c2', company_name: 'Ward Bros', list_id: 'l1', status: 'lead' },
    ],
    profiles: [
      { id: 'u-dave', full_name: 'Dave Marsh', email: 'dave@stc.co.uk', role: 'sales' },
      { id: 'u-tom', full_name: 'Tom Riley', email: 'tom@stc.co.uk', role: 'sales' },
    ],
    crm_list_members: [],
  });
}

test('a list is shared by name, with nothing selected', async () => {
  const db = listWorld();
  const text = 'share Fleet Prospects with Dave';

  const planned = await planAndPreview({
    text, capabilities: SHARER, vocabulary: async () => EMPTY_VOCABULARY,
    store: postgrestStore(db.supabase), context: {}, preview: true,
  });
  ok('it plans as sharing the list itself',
    planned?.planned.planning.plan.steps
      .some((s) => s.op === 'invoke' && s.capability === 'list.share') ?? false,
    JSON.stringify(planned?.planned.planning.plan.steps.map(
      (s) => (s.op === 'invoke' ? s.capability : s.op))));

  const preview = planned?.preview;
  ok('it previews', preview?.ok === true, preview && !preview.ok ? preview.why : 'no preview');
  ok('and nothing is written yet', db.writes.length === 0, JSON.stringify(db.writes));
  if (!planned || !preview?.ok) return;

  const done = await applyMutation({
    text, capabilities: SHARER, vocabulary: async () => EMPTY_VOCABULARY,
    store: postgrestStore(db.supabase), context: {},
    previewPlanHash: planned.planned.meaning.hash,
    previewProgrammeHash: preview.programmeHash,
  });
  ok('it goes through', done.ok, done.ok ? '' : done.why);

  const members = db.tables.crm_list_members ?? [];
  ok('Dave can see the list', members.length === 1, JSON.stringify(members));
  ok('and it is the list he was named for',
    String(members[0]?.list_id) === 'l1' && String(members[0]?.user_id) === 'u-dave',
    JSON.stringify(members[0]));
});

test('two people named are two grants or none', async () => {
  const db = listWorld();
  const text = 'share the Fleet Prospects list with Dave and Tom';

  const planned = await planAndPreview({
    text, capabilities: SHARER, vocabulary: async () => EMPTY_VOCABULARY,
    store: postgrestStore(db.supabase), context: {}, preview: true,
  });
  const preview = planned?.preview;
  ok('it previews', preview?.ok === true, preview && !preview.ok ? preview.why : 'no preview');
  if (!planned || !preview?.ok) return;

  const done = await applyMutation({
    text, capabilities: SHARER, vocabulary: async () => EMPTY_VOCABULARY,
    store: postgrestStore(db.supabase), context: {},
    previewPlanHash: planned.planned.meaning.hash,
    previewProgrammeHash: preview.programmeHash,
  });
  ok('it goes through', done.ok, done.ok ? '' : done.why);
  ok('both of them can see it',
    (db.tables.crm_list_members ?? []).length === 2,
    JSON.stringify(db.tables.crm_list_members));
});

test('a person who is not here stops the whole share', async () => {
  const db = listWorld();
  const text = 'share the Fleet Prospects list with Dave and Mildred';

  const planned = await planAndPreview({
    text, capabilities: SHARER, vocabulary: async () => EMPTY_VOCABULARY,
    store: postgrestStore(db.supabase), context: {}, preview: true,
  });
  const preview = planned?.preview;
  ok('it refuses rather than sharing with the one it found', preview?.ok !== true,
    preview?.ok ? 'it previewed' : preview?.why ?? 'no preview');
  ok('and nobody was granted anything',
    (db.tables.crm_list_members ?? []).length === 0,
    JSON.stringify(db.tables.crm_list_members));
});

test('a list that is not there is refused by name', async () => {
  const db = listWorld();
  const text = 'share Coldstore Renewals with Dave';

  const planned = await planAndPreview({
    text, capabilities: SHARER, vocabulary: async () => EMPTY_VOCABULARY,
    store: postgrestStore(db.supabase), context: {}, preview: true,
  });
  if (!planned?.preview?.ok) {
    ok('it refuses at the preview', true);
  } else {
    const done = await applyMutation({
      text, capabilities: SHARER, vocabulary: async () => EMPTY_VOCABULARY,
      store: postgrestStore(db.supabase), context: {},
      previewPlanHash: planned.planned.meaning.hash,
      previewProgrammeHash: planned.preview.programmeHash,
    });
    ok('it refuses, saying which list it could not find',
      !done.ok && /no list called Coldstore Renewals/i.test(done.ok ? '' : done.why),
      done.ok ? 'it went through' : done.why);
  }
  ok('and nothing was shared',
    (db.tables.crm_list_members ?? []).length === 0,
    JSON.stringify(db.tables.crm_list_members));
});

test('the list on the screen is what "this list" means', async () => {
  const db = listWorld();
  const text = 'share this list with Dave';
  const context = { list: { id: 'l1', name: 'Fleet Prospects' } };

  const planned = await planAndPreview({
    text, capabilities: SHARER, vocabulary: async () => EMPTY_VOCABULARY,
    store: postgrestStore(db.supabase), context, preview: true,
  });
  ok('it points at the open list',
    planned?.planned.planning.plan.steps
      .some((s) => s.op === 'invoke' && s.capability === 'list.share') ?? false,
    JSON.stringify(planned?.planned.planning.plan.steps.map(
      (s) => (s.op === 'invoke' ? s.capability : s.op))));
  const preview = planned?.preview;
  if (!planned || preview?.ok !== true) {
    ok('and previews', false, preview && !preview.ok ? preview.why : 'no preview');
    return;
  }

  const done = await applyMutation({
    text, capabilities: SHARER, vocabulary: async () => EMPTY_VOCABULARY,
    store: postgrestStore(db.supabase), context,
    previewPlanHash: planned.planned.meaning.hash,
    previewProgrammeHash: preview.programmeHash,
  });
  ok('it goes through', done.ok, done.ok ? '' : done.why);
  ok('and it is the list that was open',
    String((db.tables.crm_list_members ?? [])[0]?.list_id) === 'l1',
    JSON.stringify(db.tables.crm_list_members));
});

test('with no list open, "this list" points at nothing', async () => {
  const planning = planCommand('share this list with Dave', {
    actorCapabilities: SHARER, context: {},
  });
  ok('it is not read as a list called "this"',
    !(planning?.plan.steps.some((s) => s.op === 'invoke' && s.capability === 'list.share') ?? false),
    JSON.stringify(planning?.plan.steps.map((s) => (s.op === 'invoke' ? s.capability : s.op))));
});

test('a described set is still the destination reader', async () => {
  const planning = planCommand('share the sold trailers with Dave', {
    actorCapabilities: SHARER, context: {},
  });
  ok('it is not read as a list called "the sold trailers"',
    !(planning?.plan.steps.some((s) => s.op === 'invoke' && s.capability === 'list.share') ?? false),
    JSON.stringify(planning?.plan.steps.map((s) => (s.op === 'invoke' ? s.capability : s.op))));
});

test('a viewer cannot share a list', async () => {
  const viewer = [...capabilitiesFor({ role: 'viewer' } as never)];
  const planning = planCommand('share Fleet Prospects with Dave', {
    actorCapabilities: viewer, context: {},
  });
  ok('it is not offered',
    !(planning?.plan.steps.some((s) => s.op === 'invoke' && s.capability === 'list.share') ?? false),
    JSON.stringify(planning?.plan.steps.map((s) => (s.op === 'invoke' ? s.capability : s.op))));
});

/* =============================================================
   36. A picture on a post is a file and a column

   Neither half is visual. The bytes go where the composer has always
   put them, through a port so this can run with no bucket anywhere, and
   the column write goes into the programme's own transaction.
   ============================================================= */

const MARKETER = [...capabilitiesFor({ role: 'marketer' } as never)];

const PICTURE = {
  record: { entity: 'posts', id: 'p1' },
  file: {
    name: 'yard.png', mime: 'image/png', size: 4,
    text: 'data:image/png;base64,AAAA',
  },
};

/**
 * A bucket with the same recovery contract and no storage.
 *
 * `objects` is what is actually there, keyed the way the real one keys
 * it, so "at most one stored object" is a thing a check can count
 * rather than infer. `staged` counts every attempt, including the ones
 * that reused what was already there.
 */
function fakeBucket(opts: { removeFails?: boolean } = {}) {
  const objects = new Map<string, { name: string; bytes: number }>();
  const staged: { key: string; reused: boolean }[] = [];
  const abandoned: { key: string; why: string }[] = [];

  const store: FileStore = {
    async stage(file) {
      const already = objects.has(file.key);
      if (!already) objects.set(file.key, { name: file.name, bytes: file.bytes.byteLength });
      staged.push({ key: file.key, reused: already });
      return {
        ok: true,
        url: `https://bucket.test/${file.key}`,
        key: file.key,
        reused: already,
      };
    },
    async remove(key) {
      if (opts.removeFails) return { ok: false, why: 'the bucket is unreachable' };
      objects.delete(key);
      return { ok: true };
    },
    async abandon(key, why) { abandoned.push({ key, why }); },
  };

  return { objects, staged, abandoned, store };
}

test('a picture goes on a post', async () => {
  const db = fakeDb({
    social_posts: [{
      id: 'p1', content: 'Depot open Saturday', status: 'draft',
      platform: ['linkedin'], scheduled_date: '2026-09-01',
      created_by: 'TEST Author', image_url: null,
    }],
  });
  const bucket = fakeBucket();
  const text = 'add this image to this post';

  const planned = await planAndPreview({
    text, capabilities: MARKETER, vocabulary: async () => EMPTY_VOCABULARY,
    store: postgrestStore(db.supabase), context: PICTURE, preview: true,
    files: bucket.store,
  });
  ok('it plans as putting a picture on the post',
    planned?.planned.planning.plan.steps
      .some((s) => s.op === 'invoke' && s.capability === 'post.setImage') ?? false,
    JSON.stringify(planned?.planned.planning.plan.steps.map(
      (s) => (s.op === 'invoke' ? s.capability : s.op))));

  const preview = planned?.preview;
  ok('it previews', preview?.ok === true, preview && !preview.ok ? preview.why : 'no preview');
  /* Describing never uploads. A preview that put the file on the bucket
     would leave an object behind for a command nobody confirmed. */
  ok('and nothing has been uploaded yet', bucket.staged.length === 0, JSON.stringify(bucket.staged));
  ok('and nothing has been written yet', db.writes.length === 0, JSON.stringify(db.writes));
  if (!planned || preview?.ok !== true) return;

  const done = await applyMutation({
    text, capabilities: MARKETER, vocabulary: async () => EMPTY_VOCABULARY,
    store: postgrestStore(db.supabase), context: PICTURE, files: bucket.store,
    previewPlanHash: planned.planned.meaning.hash,
    previewProgrammeHash: preview.programmeHash,
  });
  ok('it goes through', done.ok, done.ok ? '' : done.why);
  ok('the file was put on the bucket once', bucket.staged.length === 1, JSON.stringify(bucket.staged));
  ok('and exactly one object exists', bucket.objects.size === 1, String(bucket.objects.size));
  ok('and the post points at it',
    String((db.tables.social_posts ?? [])[0]?.image_url)
      === `https://bucket.test/${bucket.staged[0]?.key}`,
    String((db.tables.social_posts ?? [])[0]?.image_url));
});

test('with nowhere to put it, nothing is claimed', async () => {
  const db = fakeDb({
    social_posts: [{
      id: 'p1', content: 'Depot open Saturday', status: 'draft',
      platform: ['linkedin'], scheduled_date: '2026-09-01',
      created_by: 'TEST Author', image_url: null,
    }],
  });
  const text = 'add this image to this post';

  const planned = await planAndPreview({
    text, capabilities: MARKETER, vocabulary: async () => EMPTY_VOCABULARY,
    store: postgrestStore(db.supabase), context: PICTURE, preview: true,
  });
  const preview = planned?.preview;
  if (!planned || preview?.ok !== true) {
    ok('it previews', false, preview && !preview.ok ? preview.why : 'no preview');
    return;
  }

  const done = await applyMutation({
    text, capabilities: MARKETER, vocabulary: async () => EMPTY_VOCABULARY,
    store: postgrestStore(db.supabase), context: PICTURE,
    previewPlanHash: planned.planned.meaning.hash,
    previewProgrammeHash: preview.programmeHash,
  });
  ok('it refuses by name rather than reporting success',
    !done.ok && /nowhere to put a file/i.test(done.ok ? '' : done.why),
    done.ok ? 'it went through' : done.why);
  ok('and the post still has no picture',
    (db.tables.social_posts ?? [])[0]?.image_url == null,
    String((db.tables.social_posts ?? [])[0]?.image_url));
});

test('taking a picture off a post is an ordinary write', async () => {
  const db = fakeDb({
    social_posts: [{
      id: 'p1', content: 'Depot open Saturday', status: 'draft',
      platform: ['linkedin'], scheduled_date: '2026-09-01',
      created_by: 'TEST Author', image_url: 'https://bucket.test/old.png',
    }],
  });
  const text = 'remove the image from this post';
  const context = { record: { entity: 'posts', id: 'p1' } };

  const planned = await planAndPreview({
    text, capabilities: MARKETER, vocabulary: async () => EMPTY_VOCABULARY,
    store: postgrestStore(db.supabase), context, preview: true,
  });
  const preview = planned?.preview;
  ok('it previews as a change to the post', preview?.ok === true,
    preview && !preview.ok ? preview.why : 'no preview');
  if (!planned || preview?.ok !== true) return;

  const done = await applyMutation({
    text, capabilities: MARKETER, vocabulary: async () => EMPTY_VOCABULARY,
    store: postgrestStore(db.supabase), context,
    previewPlanHash: planned.planned.meaning.hash,
    previewProgrammeHash: preview.programmeHash,
  });
  ok('it goes through', done.ok, done.ok ? '' : done.why);
  ok('and the picture is off it',
    (db.tables.social_posts ?? [])[0]?.image_url == null,
    String((db.tables.social_posts ?? [])[0]?.image_url));
});

test('a failed transaction leaves no file behind, and a retry makes no second copy', async () => {
  const db = fakeDb({
    social_posts: [{
      id: 'p1', content: 'Depot open Saturday', status: 'draft',
      platform: ['linkedin'], scheduled_date: '2026-09-01',
      created_by: 'TEST Author', image_url: null,
    }],
  });
  const bucket = fakeBucket();
  const text = 'add this image to this post';

  const planned = await planAndPreview({
    text, capabilities: MARKETER, vocabulary: async () => EMPTY_VOCABULARY,
    store: postgrestStore(db.supabase), context: PICTURE, preview: true,
    files: bucket.store,
  });
  const preview = planned?.preview;
  if (!planned || preview?.ok !== true) {
    ok('it previews', false, preview && !preview.ok ? preview.why : 'no preview');
    return;
  }

  const confirmed = {
    text, capabilities: MARKETER, vocabulary: async () => EMPTY_VOCABULARY,
    context: PICTURE, files: bucket.store,
    previewPlanHash: planned.planned.meaning.hash,
    previewProgrammeHash: preview.programmeHash,
  };

  /* The upload succeeds and the transaction does not. */
  const breaking = postgrestStore(db.supabase);
  const first = await applyMutation({
    ...confirmed,
    store: { ...breaking, perform: async () => ({ ok: false, why: 'the database fell over' }) },
  });
  ok('the write fails', !first.ok, 'it should have failed');
  ok('the file was staged', bucket.staged.length === 1, JSON.stringify(bucket.staged));
  ok('and then taken away again, so nothing points at it',
    bucket.objects.size === 0, JSON.stringify([...bucket.objects.keys()]));
  ok('with nothing recorded as orphaned, because it was removed',
    bucket.abandoned.length === 0, JSON.stringify(bucket.abandoned));
  ok('and no row changed', db.writes.length === 0, JSON.stringify(db.writes));

  /* The same confirmation, retried. */
  const second = await applyMutation({ ...confirmed, store: postgrestStore(db.supabase) });
  ok('the retry goes through', second.ok, second.ok ? '' : second.why);
  ok('and there is exactly one stored object', bucket.objects.size === 1,
    String(bucket.objects.size));
  ok('under the same key both times',
    bucket.staged.length === 2 && bucket.staged[0].key === bucket.staged[1].key,
    JSON.stringify(bucket.staged));
  ok('and the post points at exactly that object',
    String((db.tables.social_posts ?? [])[0]?.image_url)
      === `https://bucket.test/${bucket.staged[0].key}`,
    String((db.tables.social_posts ?? [])[0]?.image_url));
});

test('a cleanup that fails is recorded rather than swallowed', async () => {
  const db = fakeDb({
    social_posts: [{
      id: 'p1', content: 'Depot open Saturday', status: 'draft',
      platform: ['linkedin'], scheduled_date: '2026-09-01',
      created_by: 'TEST Author', image_url: null,
    }],
  });
  const bucket = fakeBucket({ removeFails: true });
  const text = 'add this image to this post';

  const planned = await planAndPreview({
    text, capabilities: MARKETER, vocabulary: async () => EMPTY_VOCABULARY,
    store: postgrestStore(db.supabase), context: PICTURE, preview: true,
    files: bucket.store,
  });
  const preview = planned?.preview;
  if (!planned || preview?.ok !== true) {
    ok('it previews', false, preview && !preview.ok ? preview.why : 'no preview');
    return;
  }

  const breaking = postgrestStore(db.supabase);
  const done = await applyMutation({
    text, capabilities: MARKETER, vocabulary: async () => EMPTY_VOCABULARY,
    context: PICTURE, files: bucket.store,
    previewPlanHash: planned.planned.meaning.hash,
    previewProgrammeHash: preview.programmeHash,
    store: { ...breaking, perform: async () => ({ ok: false, why: 'the database fell over' }) },
  });
  ok('it fails', !done.ok, 'it should have failed');
  ok('and says the file was left behind',
    !done.ok && /could not be removed/i.test(done.why), done.ok ? '' : done.why);
  ok('and the orphan is recorded durably',
    bucket.abandoned.length === 1 && bucket.abandoned[0].key === bucket.staged[0].key,
    JSON.stringify(bucket.abandoned));
});

test('a viewer cannot put a picture on a post', async () => {
  const viewer = [...capabilitiesFor({ role: 'viewer' } as never)];
  const planning = planCommand('add this image to this post', {
    actorCapabilities: viewer, context: PICTURE,
  });
  ok('it is not offered',
    !(planning?.plan.steps.some((s) => s.op === 'invoke' && s.capability === 'post.setImage') ?? false),
    JSON.stringify(planning?.plan.steps.map((s) => (s.op === 'invoke' ? s.capability : s.op))));
});

/* =============================================================
   37. Looking for companies we do not have

   A paid read of somebody else's database, so the rules are the ones
   the enrichment already lives by: describing never calls out, an
   incomplete sentence never reaches a call at all, and the rows it
   finds go into the programme's own transaction.
   ============================================================= */

/* Everything except the lock, which is what the lock hides. */
const PROSPECTOR = [...capabilitiesFor({ role: 'sales' } as never), 'crm.enrich'] as never[];

test('the finder is invisible while Lusha is locked', async () => {
  ok('the lock is on', LUSHA_LOCKED, 'it is off');
  const planning = planCommand('find waste companies within 20 miles of Hyde', {
    actorCapabilities: [...capabilitiesFor({ role: 'admin' } as never)],
    context: {},
  });
  ok('nobody is offered a paid search',
    !(planning?.plan.steps.some(
      (s) => s.op === 'invoke' && s.capability === 'crm.findCompanies') ?? false),
    JSON.stringify(planning?.plan.steps.map((s) => (s.op === 'invoke' ? s.capability : s.op))));
});

test('a sentence with no place asks where, and reaches no search', async () => {
  const db = fakeDb({ crm_contacts: [] });
  let calls = 0;
  const was = FINDER.search;
  const wasLocked = LUSHA_GATE.locked;
  FINDER.search = async () => { calls += 1; return []; };
  LUSHA_GATE.locked = false;
  try {
    const planning = planCommand('find waste companies', {
      actorCapabilities: PROSPECTOR, context: {},
    });
    const step = planning?.plan.steps
      .find((x) => x.op === 'invoke' && x.capability === 'crm.findCompanies');

    /* UNDERSTOOD IS NOT THE SAME AS RUN.

       This used to refuse to plan the sentence at all, which told
       somebody who had said what they wanted that nothing here reads
       it. The operation is planned; the place is missing; the question
       is put; and the search happens after the answer and not before,
       which is the property that actually matters. */
    ok('the search is understood', !!step,
      JSON.stringify(planning?.plan.steps.map((s) => (s.op === 'invoke' ? s.capability : s.op))));
    ok('with no place invented for it',
      !(step && step.op === 'invoke' && (step.args?.place || step.args?.city)),
      JSON.stringify(step && step.op === 'invoke' ? step.args : null));
    ok('it is incomplete', planning?.completion.kind === 'incomplete',
      JSON.stringify(planning?.completion));
    ok('and asks where to search',
      planning?.completion.kind === 'incomplete'
        && planning.completion.missing[0].ask === 'Where should I search?',
      JSON.stringify(planning?.completion));

    /* And the preview, which is the pass that would have called out. */
    const planned = await planAndPreview({
      text: 'find waste companies', capabilities: PROSPECTOR,
      vocabulary: async () => EMPTY_VOCABULARY,
      store: postgrestStore(db.supabase), context: {}, preview: true,
    });
    ok('the server will not run it', planned?.planned.meaning.runnable === false,
      String(planned?.planned.meaning.runnable));
    ok('and nothing was searched for', calls === 0, String(calls));
  } finally {
    FINDER.search = was;
    LUSHA_GATE.locked = wasLocked;
  }
});

test('a search happens once and what it finds is filed', async () => {
  const db = fakeDb({
    crm_contacts: [],
    crm_lists: [{ id: 'l1', name: 'Everything', is_global: true }],
  });
  const text = 'find waste companies within 20 miles of Hyde';

  let calls = 0;
  let asked: unknown = null;
  const was = FINDER.search;
  const wasLocked = LUSHA_GATE.locked;
  FINDER.search = async (search) => {
    calls += 1; asked = search;
    return [
      { name: 'Pennine Waste', employees: 40, location: 'Hyde', distance: 2, domain: 'pennine.co.uk', industry: 'Waste' },
      { name: 'Tameside Skips', employees: 12, location: 'Dukinfield', distance: 4, domain: null, industry: 'Waste' },
    ];
  };
  LUSHA_GATE.locked = false;

  try {
    const planned = await planAndPreview({
      text, capabilities: PROSPECTOR, vocabulary: async () => EMPTY_VOCABULARY,
      store: postgrestStore(db.supabase), context: {}, preview: true,
    });
    ok('it plans as a company search',
      planned?.planned.planning.plan.steps
        .some((s) => s.op === 'invoke' && s.capability === 'crm.findCompanies') ?? false,
      JSON.stringify(planned?.planned.planning.plan.steps.map(
        (s) => (s.op === 'invoke' ? s.capability : s.op))));

    const preview = planned?.preview;
    ok('it previews', preview?.ok === true, preview && !preview.ok ? preview.why : 'no preview');
    /* Describing a paid search must not make one. */
    ok('and nothing has been searched for yet', calls === 0, String(calls));
    if (!planned || preview?.ok !== true) return;

    const said = preview.operations[0]?.says ?? '';
    ok('the preview says what it will look for and where it goes',
      /Waste Collection/i.test(said) && /20 miles of Hyde/i.test(said)
        && /Everything/.test(said),
      said);
    /* And what it costs, which is not a credit. lib/lusha.ts is explicit
       that a company search is free and quota-limited; a credit is spent
       revealing a person. Saying otherwise in a preview is the same
       class of mistake as saying nothing. */
    ok('and that a search costs no credits',
      /costs no credits/i.test(said) && !/spends? .*credit/i.test(said), said);

    const done = await applyMutation({
      text, capabilities: PROSPECTOR, vocabulary: async () => EMPTY_VOCABULARY,
      store: postgrestStore(db.supabase), context: {},
      previewPlanHash: planned.planned.meaning.hash,
      previewProgrammeHash: preview.programmeHash,
    });
    ok('it goes through', done.ok, done.ok ? '' : done.why);
    ok('the search happened exactly once', calls === 1, String(calls));
    ok('and it searched the city the depot maps to',
      (asked as { city?: string } | null)?.city === 'Manchester',
      JSON.stringify(asked));

    const rows = db.tables.crm_contacts ?? [];
    ok('both companies are in the CRM', rows.length === 2, String(rows.length));
    ok('marked as having come from the finder',
      rows.every((r) => String(r.source) === 'Lusha Company Finder'),
      JSON.stringify(rows.map((r) => r.source)));
    /* fleet_size is derived by a trigger from the three vehicle counts,
       so the employee count is kept where it can be read instead. */
    ok('and no derived column was written',
      rows.every((r) => r.fleet_size === undefined),
      JSON.stringify(rows.map((r) => r.fleet_size)));
  } finally {
    FINDER.search = was;
    LUSHA_GATE.locked = wasLocked;
  }
});

/* =============================================================
   38. The clipboard is a declared effect, not a navigation

   No server can write to somebody's clipboard. The old answer to "copy
   the navy hex" was an action that opened the brand kit and called that
   copying. It is a destination now: the plan says where the answer
   goes, the reader knows it changes nothing, and the browser carries it
   out.
   ============================================================= */

test('copying is a read that declares where the answer goes', async () => {
  const planning = planCommand('copy the sold trailers', {
    actorCapabilities: [...capabilitiesFor({ role: 'viewer' } as never)],
    context: {},
  });
  ok('it plans', !!planning, 'not understood');
  ok('and it is a question, not an instruction', planning?.kind === 'read', planning?.kind);

  const emit = planning?.plan.steps.find((s) => s.op === 'emit');
  ok('with the clipboard as its destination',
    emit?.op === 'emit' && emit.to.kind === 'clipboard',
    JSON.stringify(emit));
  /* A copy produces no file, so claiming the export capability on it
     would claim an effect the step does not have. */
  ok('and no capability claimed for a file it does not make',
    emit?.op === 'emit' && !emit.capability, JSON.stringify(emit));
  ok('it is well formed', planning?.availability.representable === true,
    JSON.stringify(planning?.problems));
  /* A viewer may read, so a viewer may copy what they read. */
  ok('and a viewer may do it', planning?.availability.permitted !== false,
    JSON.stringify(planning?.availability.missingPermissions));
});

test('a copy of something unresolved is refused rather than half copied', async () => {
  const planning = planCommand('copy the navy brand colour', {
    actorCapabilities: [...capabilitiesFor({ role: 'viewer' } as never)],
    context: {},
  });
  ok('it refuses',
    planning?.availability.representable === false,
    JSON.stringify(planning?.problems));
  ok('saying which word it could not place',
    /navy/i.test(JSON.stringify(planning?.problems ?? [])),
    JSON.stringify(planning?.problems));
});

test('the brand kit is a table, so its colours are answerable', async () => {
  const vocabulary = buildIndex({
    brand: { name: [{ value: 'Navy Primary', rows: 1 }, { value: 'STC Red', rows: 1 }] },
  });
  const planning = planCommand('copy the navy brand colour', {
    actorCapabilities: [...capabilitiesFor({ role: 'viewer' } as never)],
    context: {}, vocabulary,
  });
  ok('it resolves the colour by name',
    planning?.availability.representable === true, JSON.stringify(planning?.problems));
  ok('against the brand assets rather than the trailers',
    !!(planning?.select?.from && 'entity' in planning.select.from
      && planning.select.from.entity === 'brand'),
    JSON.stringify(planning?.select?.from));
});

test('a bare colour question is still about a trailer', async () => {
  const planning = planCommand('how many blue trailers are in stock', {
    actorCapabilities: [...capabilitiesFor({ role: 'viewer' } as never)],
    context: {},
  });
  ok('the brand kit did not take it',
    !!(planning?.select?.from && 'entity' in planning.select.from
      && planning.select.from.entity === 'trailers'),
    JSON.stringify(planning?.select?.from));
});

/* =============================================================
   39. A CRM customer, onto your own tracker

   The tracker screen sent its own list id, so the payload decided whose
   tracker gained a deal. It is decided from who is asking, and the
   sentence reaches the same operation the button does.
   ============================================================= */

test('a customer goes onto the tracker', async () => {
  const db = fakeDb({
    crm_contacts: [{
      id: 'c1', company_name: 'Dawson Group', contact_name: 'Sam Dawson',
      status: 'lead', source: 'Cold call', list_id: 'l1',
    }],
    crm_lists: [
      { id: 'l1', name: 'Everything', is_global: true },
      { id: 'l2', name: 'Sales tracker', owner_id: 'u1', is_global: false },
    ],
  });
  const text = 'pull this customer from the CRM onto my tracker';
  const context = { record: { entity: 'contacts', id: 'c1' } };

  const planned = await planAndPreview({
    text, capabilities: [...capabilitiesFor({ role: 'sales' } as never)],
    vocabulary: async () => EMPTY_VOCABULARY,
    store: postgrestStore(db.supabase), context, preview: true,
  });
  ok('it plans as putting a customer on the tracker',
    planned?.planned.planning.plan.steps
      .some((s) => s.op === 'invoke' && s.capability === 'crm.toTracker') ?? false,
    JSON.stringify(planned?.planned.planning.plan.steps.map(
      (s) => (s.op === 'invoke' ? s.capability : s.op))));

  const preview = planned?.preview;
  ok('it previews', preview?.ok === true, preview && !preview.ok ? preview.why : 'no preview');
  if (!planned || preview?.ok !== true) return;

  const done = await applyMutation({
    text, capabilities: [...capabilitiesFor({ role: 'sales' } as never)],
    vocabulary: async () => EMPTY_VOCABULARY,
    store: postgrestStore(db.supabase), context,
    previewPlanHash: planned.planned.meaning.hash,
    previewProgrammeHash: preview.programmeHash,
  });
  ok('it goes through', done.ok, done.ok ? '' : done.why);

  const rows = db.tables.crm_contacts ?? [];
  ok('a copy arrived', rows.length === 2, String(rows.length));
  ok('on the tracker rather than the list it came from',
    String(rows[1]?.list_id) === 'l2', String(rows[1]?.list_id));
  ok('carrying what belongs to the business',
    String(rows[1]?.company_name) === 'Dawson Group'
      && String(rows[1]?.contact_name) === 'Sam Dawson',
    JSON.stringify(rows[1]));
  ok('and the original is untouched',
    String(rows[0]?.list_id) === 'l1', String(rows[0]?.list_id));
});

test('a viewer cannot put a customer on a tracker', async () => {
  const planning = planCommand('put this customer on my tracker', {
    actorCapabilities: [...capabilitiesFor({ role: 'viewer' } as never)],
    context: { record: { entity: 'contacts', id: 'c1' } },
  });
  ok('it is not offered',
    !(planning?.plan.steps.some((s) => s.op === 'invoke' && s.capability === 'crm.toTracker') ?? false),
    JSON.stringify(planning?.plan.steps.map((s) => (s.op === 'invoke' ? s.capability : s.op))));
});

/* =============================================================
   40. Twenty simultaneous confirmations, one credit

   The SQL half of this is `scripts/sql/external-claim-race.sh`, which
   runs twenty real sessions against a real server and asserts exactly
   one claim is granted. This is the runtime half: twenty confirmations
   of the same command through the same ledger, with a fake provider
   whose paid calls are counted.

   The provider must be called exactly once. Nobody who was not granted
   the claim may call it, whatever they were told instead.
   ============================================================= */

const ENRICHER = [...capabilitiesFor({ role: 'admin' } as never), 'crm.enrich'] as never[];

function enrichWorld() {
  return fakeDb({
    crm_contacts: [
      { id: 'c1', company_name: 'Dawson Group', status: 'lead', email: 'sam@dawson.co.uk' },
    ],
  });
}

test('twenty simultaneous confirmations spend one credit', async () => {
  const db = enrichWorld();
  const text = 'enrich Dawson Group';
  const ledger = fakeLedger().store;

  let calls = 0;
  const real = PROVIDER.lookUp;
  const wasLocked = LUSHA_GATE.locked;
  LUSHA_GATE.locked = false;
  PROVIDER.lookUp = async () => {
    calls += 1;
    /* A provider that takes a moment, so every caller is inside the
       window at once. A synchronous one would let each finish before
       the next started and prove nothing. */
    await new Promise((r) => setTimeout(r, 5));
    return {
      ok: true,
      fields: { contact_name: 'Sam Dawson', phone: '0161 000 0001', source: 'Lusha (email)' },
      strategy: 'email', attempts: [], tried: 'email', remaining: [],
      address: null, website: null,
    };
  };

  try {
    const planned = await planAndPreview({
      text, capabilities: ENRICHER, vocabulary: async () => EMPTY_VOCABULARY,
      store: postgrestStore(db.supabase), preview: true,
    });
    const preview = planned?.preview;
    if (!planned || preview?.ok !== true) {
      ok('it previews', false, preview && !preview.ok ? preview.why : 'no preview');
      return;
    }

    const confirmed = {
      text, capabilities: ENRICHER, vocabulary: async () => EMPTY_VOCABULARY,
      ledger, actorId: 'u1',
      previewPlanHash: planned.planned.meaning.hash,
      previewProgrammeHash: preview.programmeHash,
    };

    /* All twenty released together. */
    const outcomes = await Promise.all(
      Array.from({ length: 20 }, () => applyMutation({
        ...confirmed, store: postgrestStore(db.supabase),
      })),
    );

    ok('the provider was called exactly once', calls === 1, String(calls));

    const went = outcomes.filter((o) => o.ok).length;
    ok('at least one confirmation went through', went >= 1, String(went));

    /* Every refusal is a stand-off, never a claim of failure that would
       send somebody back to spend again. */
    const refusals = outcomes.filter((o) => !o.ok).map((o) => (o.ok ? '' : o.why));
    ok('and every refusal says it is being looked up, rather than failing',
      refusals.every((w) => /looked up right now|already/i.test(w) || /Dawson/.test(w)),
      JSON.stringify([...new Set(refusals)].slice(0, 3)));

    const row = (db.tables.crm_contacts ?? [])[0];
    ok('the answer landed on the record', row?.contact_name === 'Sam Dawson',
      String(row?.contact_name));
  } finally {
    PROVIDER.lookUp = real;
    LUSHA_GATE.locked = wasLocked;
  }
});

test('a claim nobody settled is not retried', async () => {
  const db = enrichWorld();
  const text = 'enrich Dawson Group';
  /* A ledger whose clock can be moved past the staleness window. */
  let clock = 0;
  const ledger = fakeLedger({ now: () => clock, staleAfterMs: 1000 }).store;

  let calls = 0;
  const real = PROVIDER.lookUp;
  const wasLocked = LUSHA_GATE.locked;
  LUSHA_GATE.locked = false;
  /* The call throws, which is what a process dying mid-request looks
     like from here: the request may have reached Lusha and been
     charged, and it may never have left. */
  PROVIDER.lookUp = async () => { calls += 1; throw new Error('socket hung up'); };

  try {
    const planned = await planAndPreview({
      text, capabilities: ENRICHER, vocabulary: async () => EMPTY_VOCABULARY,
      store: postgrestStore(db.supabase), preview: true,
    });
    const preview = planned?.preview;
    if (!planned || preview?.ok !== true) {
      ok('it previews', false, preview && !preview.ok ? preview.why : 'no preview');
      return;
    }
    const confirmed = {
      text, capabilities: ENRICHER, vocabulary: async () => EMPTY_VOCABULARY,
      ledger, actorId: 'u1', store: postgrestStore(db.supabase),
      previewPlanHash: planned.planned.meaning.hash,
      previewProgrammeHash: preview.programmeHash,
    };

    const first = await applyMutation(confirmed);
    ok('the first attempt refuses', !first.ok, 'it should have failed');
    ok('saying the charge is unknown rather than that it failed',
      !first.ok && /whether it was charged is unknown/i.test(first.why),
      first.ok ? '' : first.why);
    ok('and the provider was called once', calls === 1, String(calls));

    /* Long enough later that nobody is coming back for it. */
    clock += 60_000;
    const second = await applyMutation(confirmed);
    ok('the retry refuses too', !second.ok, 'it should have failed');
    ok('and Lusha has no idempotency key, so it was NOT called again',
      calls === 1, String(calls));
    ok('the refusal asks for it to be reconciled',
      !second.ok && /checking against the Lusha account/i.test(second.why),
      second.ok ? '' : second.why);
    ok('and nothing was written', db.writes.length === 0, JSON.stringify(db.writes));
  } finally {
    PROVIDER.lookUp = real;
    LUSHA_GATE.locked = wasLocked;
  }
});

test('with no ledger wired up, no credit can be spent', async () => {
  const db = enrichWorld();
  const text = 'enrich Dawson Group';

  let calls = 0;
  const real = PROVIDER.lookUp;
  const wasLocked = LUSHA_GATE.locked;
  LUSHA_GATE.locked = false;
  PROVIDER.lookUp = async () => { calls += 1; throw new Error('should never be reached'); };

  try {
    const planned = await planAndPreview({
      text, capabilities: ENRICHER, vocabulary: async () => EMPTY_VOCABULARY,
      store: postgrestStore(db.supabase), preview: true,
    });
    const preview = planned?.preview;
    if (!planned || preview?.ok !== true) {
      ok('it previews', false, preview && !preview.ok ? preview.why : 'no preview');
      return;
    }
    /* No `ledger` and no `actorId`. */
    const done = await applyMutation({
      text, capabilities: ENRICHER, vocabulary: async () => EMPTY_VOCABULARY,
      store: postgrestStore(db.supabase),
      previewPlanHash: planned.planned.meaning.hash,
      previewProgrammeHash: preview.programmeHash,
    });
    ok('it refuses', !done.ok, 'it should have failed');
    ok('and the provider was never reached', calls === 0, String(calls));
  } finally {
    PROVIDER.lookUp = real;
    LUSHA_GATE.locked = wasLocked;
  }
});

/* =============================================================
   41. Understood, and short of one value

   The other half of "correct refusal". A sentence naming an operation,
   a record and everything except one value is not a sentence nobody can
   read: it is a question with an answer. What has to hold is that
   nothing runs until the answer arrives, that the answer goes back into
   the RAW TEXT rather than into a plan the browser built, and that the
   completed sentence then goes through exactly the path the first one
   would have.
   ============================================================= */

const ONSCREEN = { entity: 'contacts', id: 'c1', label: 'Dawson Group' };

/** Somebody who may edit a customer, which is all any of these need. */
const DETAILS = [...capabilitiesFor({ role: 'admin' } as never)];

const asks = (planning: ReturnType<typeof planCommand>) =>
  (planning?.completion.kind === 'incomplete' ? planning.completion.missing : []);

test('a link with no address asks for one, and adds it once given', async () => {
  const db = fakeDb({
    crm_contacts: [{ id: 'c1', company_name: 'Dawson Group', status: 'lead', links: [] }],
  });
  const text = 'add their LinkedIn profile to this account';
  const context = { record: ONSCREEN };

  const planning = planCommand(text, { actorCapabilities: DETAILS, context });
  ok('it is understood as adding a link',
    planning?.plan.steps.some((x) => x.op === 'invoke' && x.capability === 'contact.addLink') ?? false,
    JSON.stringify(planning?.plan.steps.map((x) => x.op)));
  ok('and asks for the address',
    asks(planning)[0]?.ask === 'What is the web address?', JSON.stringify(asks(planning)));

  /* The bar's own function, so this is the sentence the browser would
     send and not one this check made up. */
  const said = completedWith(text, asks(planning)[0], 'linkedin.com/company/dawson-group');
  const whole = planCommand(said, { actorCapabilities: DETAILS, context });
  ok('the completed sentence is whole', whole?.completion.kind === 'complete',
    JSON.stringify(whole?.completion));

  const planned = await planAndPreview({
    text: said, capabilities: DETAILS, vocabulary: async () => EMPTY_VOCABULARY,
    store: postgrestStore(db.supabase), context, preview: true,
  });
  ok('it previews', planned?.preview?.ok === true,
    planned?.preview && !planned.preview.ok ? planned.preview.why : 'no preview');
  ok('and nothing is written by looking', db.writes.length === 0, JSON.stringify(db.writes));

  const done = await applyMutation({
    text: said, capabilities: DETAILS, vocabulary: async () => EMPTY_VOCABULARY,
    store: postgrestStore(db.supabase), context,
    previewPlanHash: planned!.planned.meaning.hash,
    previewProgrammeHash: (planned!.preview as { programmeHash: string }).programmeHash,
  });
  ok('confirming adds it', done.ok === true, JSON.stringify(done).slice(0, 200));
  ok('to the account it was about',
    JSON.stringify(db.tables.crm_contacts[0].links).includes('dawson-group'),
    JSON.stringify(db.tables.crm_contacts[0].links));
});

test('a site with no address asks for one, and nothing is filed meanwhile', async () => {
  const db = fakeDb({
    crm_contacts: [{ id: 'c1', company_name: 'Dawson Group', status: 'lead' }],
    contact_addresses: [],
  });
  const text = 'add another site to this customer';
  const context = { record: ONSCREEN };

  const planning = planCommand(text, { actorCapabilities: DETAILS, context });
  ok('it is understood as adding a site',
    planning?.plan.steps.some((x) => x.op === 'invoke' && x.capability === 'contact.addAddress') ?? false,
    JSON.stringify(planning?.plan.steps.map((x) => x.op)));
  ok('and asks for the address',
    asks(planning)[0]?.ask === 'What is the address?', JSON.stringify(asks(planning)));

  /* THE WORDS THAT POINTED AT THE RECORD ARE NOT AN ADDRESS.

     "This customer" sat in the address for a while, which made the
     sentence look complete and would have filed a pointing phrase as a
     depot. */
  const step = planning?.plan.steps.find((x) => x.op === 'invoke');
  ok('and no address was taken from the pointing words',
    !(step && step.op === 'invoke' && step.args?.address),
    JSON.stringify(step && step.op === 'invoke' ? step.args : null));

  const said = completedWith(text, asks(planning)[0], '4 Ashton Road, Hyde');
  const planned = await planAndPreview({
    text: said, capabilities: DETAILS, vocabulary: async () => EMPTY_VOCABULARY,
    store: postgrestStore(db.supabase), context, preview: true,
  });
  ok('the completed sentence previews', planned?.preview?.ok === true,
    planned?.preview && !planned.preview.ok ? planned.preview.why : 'no preview');

  const done = await applyMutation({
    text: said, capabilities: DETAILS, vocabulary: async () => EMPTY_VOCABULARY,
    store: postgrestStore(db.supabase), context,
    previewPlanHash: planned!.planned.meaning.hash,
    previewProgrammeHash: (planned!.preview as { programmeHash: string }).programmeHash,
  });
  ok('confirming files the site', done.ok === true, JSON.stringify(done).slice(0, 200));
  ok('with the address they gave',
    (db.tables.contact_addresses ?? []).some((r) => String(r.address) === '4 Ashton Road, Hyde'),
    JSON.stringify(db.tables.contact_addresses));
});

test('making an address the main one asks which, rather than picking', async () => {
  const db = fakeDb({
    crm_contacts: [{ id: 'c1', company_name: 'Dawson Group', status: 'lead' }],
    contact_addresses: [
      { id: 'a1', contact_id: 'c1', address: '4 Ashton Road, Hyde', label: 'Yard', is_primary: true },
      { id: 'a2', contact_id: 'c1', address: '9 Dock Street, Salford', label: 'Depot', is_primary: false },
    ],
  });
  const text = 'make this address their main address';
  const context = { record: ONSCREEN };

  const planning = planCommand(text, { actorCapabilities: DETAILS, context });
  ok('it is understood',
    planning?.plan.steps.some((x) => x.op === 'invoke' && x.capability === 'contact.primaryAddress') ?? false,
    JSON.stringify(planning?.plan.steps.map((x) => x.op)));
  ok('the customer came from the screen, through the possessive',
    planning?.presentation.summary.includes('Dawson Group') ?? false,
    planning?.presentation.summary);
  ok('and it asks which address',
    asks(planning)[0]?.ask === 'Which address should be the main one?', JSON.stringify(asks(planning)));

  const said = completedWith(text, asks(planning)[0], 'Dock Street');
  const planned = await planAndPreview({
    text: said, capabilities: DETAILS, vocabulary: async () => EMPTY_VOCABULARY,
    store: postgrestStore(db.supabase), context, preview: true,
  });
  ok('naming one previews', planned?.preview?.ok === true,
    planned?.preview && !planned.preview.ok ? planned.preview.why : 'no preview');

  const done = await applyMutation({
    text: said, capabilities: DETAILS, vocabulary: async () => EMPTY_VOCABULARY,
    store: postgrestStore(db.supabase), context,
    previewPlanHash: planned!.planned.meaning.hash,
    previewProgrammeHash: (planned!.preview as { programmeHash: string }).programmeHash,
  });
  ok('and it is carried out', done.ok === true, JSON.stringify(done).slice(0, 200));
  ok('on the one they named',
    (db.tables.contact_addresses ?? []).find((r) => r.id === 'a2')?.is_primary === true,
    JSON.stringify(db.tables.contact_addresses));
  ok('and the other is no longer the main one',
    (db.tables.contact_addresses ?? []).find((r) => r.id === 'a1')?.is_primary === false,
    JSON.stringify(db.tables.contact_addresses));
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
      failures.push(`  [${current}] threw\n    ${(e as Error).message}`);
    }
    if (failedAssertions > before) casesFailed += 1;
  }

  console.log(`\n  ${casesRun - casesFailed}/${casesRun} sentences behaved end to end.`);
  console.log(`  ${assertions - failedAssertions}/${assertions} assertions hold.\n`);
  if (failures.length) {
    console.log('  failures:');
    for (const f of failures) console.log(f);
    console.log();
  }
  if (failedAssertions) process.exitCode = 1;
}

main();
