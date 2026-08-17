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
import { planAndPreview, applyMutation } from '../lib/command/server/mutation';
import { capabilitiesFor } from '../lib/crm/permissions';
import { EMPTY_VOCABULARY } from '../lib/command/vocab';
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

test('a dependent plan is refused by the runtime, not just by the checker', async () => {
  const db = fakeDb({ stock_trailers: trailers() });
  const planned = await plan('set the retail price on STC143580 to £24,995', 'admin', db);
  ok('it planned', !!planned?.preview?.ok);
  if (!planned?.preview?.ok) return;

  /* One sentence produces one step today, so the dependence is
     introduced here, at the plan the runtime is given. What is being
     asserted is that `previewMutation` refuses it rather than resolving
     it, which is the path a multi step sentence will take. */
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
  ok('it is refused', !preview.ok, 'it previewed');
  ok('as dependent steps', !preview.ok && preview.reason === 'dependent steps',
    preview.ok ? '' : preview.reason);
  ok('nothing was written', db.writes.length === 0);
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
   9. A question is still a question
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
