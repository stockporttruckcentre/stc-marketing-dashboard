/* =============================================================
   Per component scoring, under a strict contract.

   WHAT THIS COUNTS
     Sentences. One row per sentence. Not assertions.

   WHAT CONSTITUTES PASS
     A sentence PASSES only if every component it requests is PASS.
     Any single FAIL or UNVERIFIED component makes the sentence FAIL.
     There is no partial credit and no "understood but not executed".

   THE EIGHT COMPONENTS
     1 operation   the verb requested: export, list, count, create, approve
     2 entity      which thing the sentence is about
     3 filters     the constraints: which rows
     4 shaping     grouping, sorting, limit, time period
     5 resolution  the named record was located, or ambiguity was raised
     6 permission  the capability gate exists and admits the caller
     7 path        a wired route exists that performs the operation
     8 effect      the side effect or output was observed

   COMPONENT STATES
     PASS        verified correct here
     FAIL        verified incorrect or absent
     UNVERIFIED  this harness cannot observe it
     N/A         the sentence does not request this component

   WHAT THIS TESTS AGAINST A DATABASE, AND WHAT IT STILL DOES NOT
     Instructions are now carried out. A mutation sentence is planned
     through the production entry point, previewed against a fixture
     yard, confirmed, and the rows are read back afterwards. That is
     what moves components 5 and 8 for those sentences, and either can
     still FAIL: an instruction that resolves nothing, or one whose
     confirmation changes no row, is reported as failing rather than as
     unobservable.

     The fixture is a small yard, not a set of answers. It holds
     trailers across three depots in two body types and two states, two
     social posts and two customers, and no row in it was chosen to make
     a particular sentence pass.

     Questions, exports, files and screen navigation are still
     UNVERIFIED on component 8. Nothing here runs the query executor or
     produces a file. Under the contract above that counts against the
     score rather than being excused, because a command that cannot be
     observed to have happened has not been shown to happen.

     npm run check:score
   ============================================================= */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseQuery as readQuery } from '../lib/command/query';
import { parseEdit } from '../lib/command/mutate';
import { suggestActions, ACTIONS } from '../lib/command/actions';
import { parse } from '../lib/command/intents';
import { readsOnlyText, INSTRUCTION } from '../lib/command/arbitrate';
import { capabilitiesFor } from '../lib/crm/permissions';
import { loadSampleVocabulary, sampleSize } from './sample-vocabulary';
import { planCommand } from '../lib/command/plan';
import { runEmit } from '../lib/command/server/emit';
import { fakeDb, type Row as DbRow } from './support/fake-postgrest';
import { postgrestStore } from '../lib/command/store/postgrest';
import { planAndPreview, applyMutation } from '../lib/command/server/mutation';

const caps = capabilitiesFor({ role: 'admin' });
/* The fixture, as a value. `parseQuery` takes the index it should read
   with, so this binds it once rather than installing it anywhere. */
const VOCABULARY = loadSampleVocabulary();
const parseQuery = (text: string) => readQuery(text, VOCABULARY);

const read = (p: string) => {
  try { return readFileSync(join(process.cwd(), p), 'utf8'); } catch { return ''; }
};
const EXECUTE = read('app/api/command/execute/route.ts');
const QUERY_ROUTE = read('app/api/command/query/route.ts');
/* The canonical mutation runtime: what plans and previews, and what
   writes. Both, because a preview with nothing behind it is not a path. */
const MUTATION_PATH = !!read('app/api/command/plan/route.ts')
  && !!read('app/api/command/apply/route.ts')
  && !!read('lib/command/server/mutation.ts');
/* The canonical output runtime: what plans an emit and what renders it. */
const EMIT_PATH = !!read('app/api/command/emit/route.ts')
  && !!read('lib/command/server/emit.ts');

/** Intent ids the execute route branches on. */
const HANDLED = new Set<string>();
for (const m of EXECUTE.matchAll(/intent(?:Id)?\s*===\s*['"]([a-z0-9_.]+)['"]/gi)) HANDLED.add(m[1]);
for (const m of EXECUTE.matchAll(/case\s+['"]([a-z0-9_.]+)['"]/gi)) HANDLED.add(m[1]);

type State = 'PASS' | 'FAIL' | 'UNVERIFIED' | 'N/A';

type Expect = {
  /** The verb. `query` covers list/count/total. */
  operation: 'query' | 'export' | 'create' | 'update' | 'approve' | 'cancel'
           | 'assign' | 'navigate' | 'bulk';
  entity?: string;
  /** column -> value fragment the filter must carry. */
  filters?: Record<string, string>;
  measure?: 'count' | 'sum' | 'avg' | 'list';
  groupBy?: string;
  order?: string;
  limit?: number;
  period?: boolean;
  /** The sentence names a specific record that has to be found. */
  namesRecord?: boolean;
};

type Case = { sentence: string; expect: Expect };

/* -------------------------------------------------------------
   The corpus. Every noun is something this application holds.
   ------------------------------------------------------------- */
const CASES: Case[] = [
  // --- pure questions -------------------------------------------------
  { sentence: 'how many curtainsiders are in stock at Carrington',
    expect: { operation: 'query', entity: 'trailers', measure: 'count',
              filters: { category: 'Curtainsider', status: 'in_stock', location: 'Carrington' } } },
  { sentence: 'average profit on sold trailers this year',
    expect: { operation: 'query', entity: 'trailers', measure: 'avg',
              filters: { status: 'sold' }, period: true } },
  { sentence: 'show the five cheapest curtainsiders currently in stock',
    expect: { operation: 'query', entity: 'trailers', measure: 'list',
              filters: { category: 'Curtainsider', status: 'in_stock' },
              order: 'sales_price', limit: 5 } },
  { sentence: 'how many flatbeds at Bredbury by sales rep',
    expect: { operation: 'query', entity: 'trailers', measure: 'count',
              filters: { category: 'Flatbed', location: 'Bredbury' }, groupBy: 'sales_rep' } },
  { sentence: 'customers with no email address',
    expect: { operation: 'query', entity: 'contacts', measure: 'list',
              filters: { email: '' } } },
  { sentence: 'social posts awaiting approval',
    expect: { operation: 'query', entity: 'posts', measure: 'list',
              filters: { status: 'pending_review' } } },

  // --- questions that also request an operation ------------------------
  { sentence: 'export curtainsiders at Carrington under £5k',
    expect: { operation: 'export', entity: 'trailers',
              filters: { category: 'Curtainsider', location: 'Carrington', sales_price: '5000' } } },
  { sentence: 'download the in stock trailers as a CSV',
    expect: { operation: 'export', entity: 'trailers', filters: { status: 'in_stock' } } },
  { sentence: 'export my quoted proposals',
    expect: { operation: 'export', entity: 'deals', filters: { status: 'quoted' } } },

  // --- single record writes -------------------------------------------
  { sentence: 'move STC143580 to Bredbury',
    expect: { operation: 'update', entity: 'trailers', namesRecord: true } },
  { sentence: 'add £1,250 refurb cost to STC143580',
    expect: { operation: 'update', entity: 'trailers', namesRecord: true } },
  { sentence: 'set the MOT on STC143580 to 30 September 2026',
    expect: { operation: 'update', entity: 'trailers', namesRecord: true } },

  // --- bulk operations -------------------------------------------------
  { sentence: 'move all the trailers at Carrington to Hyde',
    expect: { operation: 'bulk', entity: 'trailers', filters: { location: 'Carrington' } } },
  { sentence: 'mark all the in stock curtainsiders as sold',
    expect: { operation: 'bulk', entity: 'trailers',
              filters: { status: 'in_stock', category: 'Curtainsider' } } },

  // --- actions on records ----------------------------------------------
  { sentence: 'approve all outstanding social posts',
    expect: { operation: 'approve', entity: 'posts', filters: { status: 'pending_review' } } },
  { sentence: "cancel Friday's site visit",
    expect: { operation: 'cancel', entity: 'meetings', namesRecord: true } },
  { sentence: 'assign Ward Bros to Lucy',
    expect: { operation: 'assign', entity: 'contacts', namesRecord: true } },
  { sentence: 'create a new lead for Smith Logistics',
    expect: { operation: 'create', entity: 'contacts' } },

  // --- navigation -------------------------------------------------------
  { sentence: 'open the sales tracker', expect: { operation: 'navigate' } },
  { sentence: 'take me to the social planner', expect: { operation: 'navigate' } },
];

/* -------------------------------------------------------------
   Scoring one sentence.
   ------------------------------------------------------------- */
type Row = {
  sentence: string;
  operation: State; entity: State; filters: State; shaping: State;
  resolution: State; permission: State; path: State; effect: State;
  note: string;
};

/** Which action ids count as performing each operation. */
const OPERATION_ACTIONS: Record<string, RegExp> = {
  export: /^(data\.export|export\.)/,
  approve: /^social\.approve$/,
  cancel: /^cal\.cancel$/,
  assign: /^rec\.assign$/,
  create: /^(make\.|crm\.newList|stock\.create)/,
  bulk: /^(stock\.bulk|crm\.moveToList)/,
};

/* -------------------------------------------------------------
   A yard to act on.

   Small, ordinary, and not built around the corpus: three depots, two
   body types, two states, a pair of posts and a pair of customers. Every
   instruction below runs against a fresh copy of it, so one sentence
   cannot leave the next one looking at rows it changed.
   ------------------------------------------------------------- */
const YARD = (): Record<string, DbRow[]> => ({
  stock_trailers: [
    { id: 'y1', stc_no: 'STC143580', status: 'in_stock', location: 'Hyde', category: 'Curtainsider', retail_price: 20000, sales_price: 22000, nbv: 15000, refurb_costs: 500, mot_date: '2027-03-14', notes: null, customer: null, sales_rep: null },
    { id: 'y2', stc_no: 'STC143581', status: 'in_stock', location: 'Carrington', category: 'Curtainsider', retail_price: 24000, sales_price: 26000, nbv: 18000, refurb_costs: 250, mot_date: '2027-06-01', notes: null, customer: null, sales_rep: null },
    { id: 'y3', stc_no: 'STC144504', status: 'sold', location: 'Carrington', category: 'Flatbed', retail_price: 30000, sales_price: 31000, nbv: 22000, refurb_costs: 0, mot_date: '2026-12-01', notes: null, customer: 'Wincanton', sales_rep: 'AE' },
    { id: 'y4', stc_no: 'STC199999', status: 'in_stock', location: 'Bredbury', category: 'Flatbed', retail_price: 21000, sales_price: 23000, nbv: 16000, refurb_costs: 100, mot_date: '2028-01-01', notes: null, customer: null, sales_rep: null },
  ],
  social_posts: [
    { id: 'z1', content: 'One', platform: ['linkedin'], scheduled_date: '2026-09-01', status: 'pending_review', created_by: 'tester', hashtags: [] },
    { id: 'z2', content: 'Two', platform: ['linkedin'], scheduled_date: '2026-09-02', status: 'draft', created_by: 'tester', hashtags: [] },
  ],
  /* Two of the four units are being sold to somebody, which is what a
     sales tracker looks like. Without a deal on a unit there is nothing
     to sell, and a fixture with none of them cannot observe a sale at
     all. */
  crm_contacts: [
    { id: 'c1', company_name: 'Ward Bros', assigned_to: 'Alex', status: 'lead', email: null, next_action: null, stock_trailer_id: null, sale_price: null, profit: null },
    { id: 'c2', company_name: 'Smith Logistics', assigned_to: 'Alex', status: 'quoted', email: 'a@b.co', next_action: null, stock_trailer_id: null, sale_price: null, profit: null },
    { id: 'c3', company_name: 'Dawson Group', assigned_to: 'Alex', status: 'quoted', email: 'd@d.co', next_action: null, stock_trailer_id: 'y1', sale_price: 22000, profit: 3000, commission_rate: 0.1 },
    { id: 'c4', company_name: 'Culina', assigned_to: 'Lucy', status: 'quoted', email: 'c@c.co', next_action: null, stock_trailer_id: 'y2', sale_price: 26000, profit: 4000, commission_rate: 0.1 },
  ],
});

type Executed = {
  /** The instruction was planned, and resolved to at least one row. */
  resolved: boolean;
  /** Confirming it changed rows in the database. */
  changed: number;
  why: string;
};

/**
 * Type the sentence, look at the preview, confirm it, read the rows.
 *
 * The same two calls the routes make, in the same order, with nothing
 * constructed by hand in between.
 */
async function carryOut(sentence: string): Promise<Executed> {
  const db = fakeDb(YARD());
  const store = postgrestStore(db.supabase);
  const actor = { capabilities: [...caps], vocabulary: async () => VOCABULARY };

  const planned = await planAndPreview({ text: sentence, ...actor, store, preview: true });
  if (!planned) return { resolved: false, changed: 0, why: 'not understood' };
  if (planned.planned.planning.kind !== 'mutate') {
    return { resolved: false, changed: 0, why: `read as a ${planned.planned.planning.kind}` };
  }
  const preview = planned.preview;
  if (!preview || !preview.ok) {
    return { resolved: false, changed: 0, why: preview ? preview.why : 'no preview' };
  }
  /* NOTHING MAY HAVE BEEN WRITTEN YET. */
  if (db.writes.length) return { resolved: true, changed: 0, why: 'the preview wrote' };

  const done = await applyMutation({
    text: sentence, ...actor, store,
    previewPlanHash: planned.planned.meaning.hash,
    previewProgrammeHash: preview.programmeHash,
  });
  if (!done.ok) return { resolved: true, changed: 0, why: done.why };
  return { resolved: true, changed: done.changed, why: '' };
}

/** Operations the canonical mutation runtime performs. */
const MUTATING = new Set(['update', 'bulk', 'approve', 'assign', 'cancel']);

/**
 * Type the sentence, and get the file it asked for.
 *
 * The same call the emit route makes. Nothing here names a format.
 */
async function produceFile(sentence: string): Promise<{ rows: number; bytes: number; why: string }> {
  const db = fakeDb(YARD());
  const planning = planCommand(sentence, { actorCapabilities: [...caps], vocabulary: VOCABULARY });
  if (!planning) return { rows: 0, bytes: 0, why: 'not understood' };
  const out = await runEmit(planning, {
    store: postgrestStore(db.supabase),
    actorName: 'Alex Ellis',
    now: new Date('2026-08-17'),
  });
  if (!out.ok) return { rows: 0, bytes: 0, why: out.why };
  if (db.writes.length) return { rows: 0, bytes: 0, why: 'producing a file wrote to the database' };
  return { rows: out.rows, bytes: out.artefact.bytes.length, why: '' };
}

function score(c: Case): Row {
  const e = c.expect;
  const plan = parseQuery(c.sentence);
  const edit = parseEdit(c.sentence, caps);
  /* The production entry point, which is what every axis below should
     be asking. */
  const canonical = planCommand(c.sentence, { actorCapabilities: [...caps], vocabulary: VOCABULARY });
  const hits = suggestActions(c.sentence, caps, 5);
  const intent = parse(c.sentence);

  const row: Row = {
    sentence: c.sentence,
    operation: 'FAIL', entity: 'N/A', filters: 'N/A', shaping: 'N/A',
    resolution: 'N/A', permission: 'N/A', path: 'FAIL', effect: 'UNVERIFIED',
    note: '',
  };

  /* --- 1 operation ---
     Did the engine resolve the verb the sentence asked for?

     Asked of the canonical plan rather than of the action registry,
     because the question is whether the runtime can perform the thing,
     not whether somebody wrote a label for it. Export, approve, assign
     and bulk are all the same two answers now: a plan that emits, or a
     plan that mutates. */
  if (e.operation === 'query') {
    row.operation = plan ? 'PASS' : 'FAIL';
  } else if (e.operation === 'export') {
    row.operation = canonical?.plan.steps.some((s) => s.op === 'emit') ? 'PASS' : 'FAIL';
  } else if (MUTATING.has(e.operation)) {
    row.operation = canonical?.kind === 'mutate' ? 'PASS' : 'FAIL';
    if (canonical?.kind !== 'mutate' && edit?.missing.length) {
      row.note = `write incomplete: needs ${edit.missing.join(', ')}`;
    }
  } else if (e.operation === 'navigate') {
    row.operation = hits.some((h) => h.action.path) ? 'PASS' : 'FAIL';
  } else {
    const want = OPERATION_ACTIONS[e.operation];
    const got = want ? hits.find((h) => want.test(h.action.id)) : undefined;
    row.operation = got ? 'PASS' : 'FAIL';
    if (!got) {
      row.note = hits.length
        ? `top action was ${hits[0].action.id}, not a ${e.operation}`
        : `no action matched`;
    }
  }

  /* --- 2 entity ---
     For an instruction, the entity is the one the mutation targets. It
     used to be read off the QUERY parser even for sentences that are
     not questions, so "set the MOT on STC143580 to 30 September 2026"
     was scored against whatever the question reader made of it. */
  if (e.entity) {
    const fromInstruction = MUTATING.has(e.operation) && canonical?.kind === 'mutate'
      ? (canonical.plan.steps[0] as { target?: { entity?: string }; subject?: { from?: { entity?: string } } })
        .target?.entity
        ?? (canonical.plan.steps[0] as { subject?: { from?: { entity?: string } } }).subject?.from?.entity
        ?? null
      : null;
    row.entity = (fromInstruction ?? plan?.entity.id) === e.entity ? 'PASS' : 'FAIL';
  }

  /* --- 3 filters --- */
  if (e.filters) {
    const missing: string[] = [];
    for (const [col, val] of Object.entries(e.filters)) {
      const hit = plan?.filters.find((f) =>
        (f.column === col || f.columns?.includes(col))
        && (val === ''
          ? f.op === 'empty'
          : f.value.toLowerCase().includes(val.toLowerCase())
            || !!f.values?.some((v) => v.toLowerCase().includes(val.toLowerCase()))));
      if (!hit) missing.push(col);
    }
    row.filters = missing.length === 0 ? 'PASS' : 'FAIL';
    if (missing.length) row.note += `${row.note ? '; ' : ''}filters missing: ${missing.join(', ')}`;
  }

  /* --- 4 shaping --- */
  const wantsShape = e.measure || e.groupBy || e.order || e.limit || e.period;
  if (wantsShape) {
    const bad: string[] = [];
    if (e.measure && plan?.measure !== e.measure) bad.push(`measure=${plan?.measure}`);
    if (e.groupBy && plan?.groupBy?.column !== e.groupBy) bad.push(`groupBy=${plan?.groupBy?.column}`);
    if (e.order && plan?.order?.column !== e.order) bad.push(`order=${plan?.order?.column}`);
    if (e.limit && plan?.limit !== e.limit) bad.push(`limit=${plan?.limit}`);
    if (e.period && !plan?.range) bad.push('no period');
    row.shaping = bad.length === 0 ? 'PASS' : 'FAIL';
    if (bad.length) row.note += `${row.note ? '; ' : ''}shaping: ${bad.join(', ')}`;
  }

  /* --- 5 resolution ---
     Filled in by the execution pass below for instructions, which do
     read a database. A named record inside a sentence this harness
     cannot carry out is still unobservable. */
  if (e.namesRecord) row.resolution = 'UNVERIFIED';

  /* --- 6 permission ---
     Verified only where a capability gate is actually declared. */
  if (e.operation === 'update') {
    row.permission = edit?.field?.capability ? 'PASS' : 'FAIL';
  } else if (e.operation !== 'query') {
    const a = hits[0]?.action;
    row.permission = a ? (a.capability ? 'PASS' : 'N/A') : 'FAIL';
  }

  /* --- 7 path ---
     A wired route that performs the operation. */
  if (e.operation === 'query') {
    row.path = QUERY_ROUTE ? 'PASS' : 'FAIL';
  } else if (e.operation === 'export') {
    /* One emit step and four renderers, for every entity and every
       format. This used to look for an `export.` action to perform it. */
    row.path = EMIT_PATH && canonical?.plan.steps.some((s) => s.op === 'emit') ? 'PASS' : 'FAIL';
  } else if (MUTATING.has(e.operation)) {
    /* One canonical path for every instruction, named or described.
       Bulk, approve and assign used to be scored against the action
       registry, looking for a `stock.bulk` or `social.approve` entry to
       perform them. */
    row.path = MUTATION_PATH && canonical?.kind === 'mutate'
      && canonical.availability.executable ? 'PASS' : 'FAIL';
  } else if (e.operation === 'navigate') {
    row.path = hits.some((h) => h.action.path) ? 'PASS' : 'FAIL';
  } else {
    const want = OPERATION_ACTIONS[e.operation];
    const a = want ? hits.find((h) => want.test(h.action.id))?.action : undefined;
    if (!a) row.path = 'FAIL';
    else if (a.path) row.path = 'FAIL';   // opens a screen; a person does it
    else if (a.seed) row.path = 'FAIL';   // types a phrase back; still not done
    else row.path = 'FAIL';               // no handler field exists at all
  }

  /* --- 8 effect ---
     Always UNVERIFIED. No database, no file, no row. */
  row.effect = 'UNVERIFIED';

  return row;
}

/* -------------------------------------------------------------
   Components 5 and 8, observed rather than assumed
   ------------------------------------------------------------- */

async function scoreWithEffect(c: Case): Promise<Row> {
  const row = score(c);
  const e = c.expect;

  /* An export produces a file and the file is read back. A question is
     still not run: nothing here executes the query route. */
  if (e.operation === 'export') {
    /* The output is observed when a file comes back and nothing was
       written producing it. A selection that matches nothing is a true
       answer and still a file: how many rows it holds is reported
       rather than being the pass mark, because otherwise the fixture
       decides whether the export works. */
    const made = await produceFile(c.sentence);
    row.effect = made.bytes > 0 ? 'PASS' : 'FAIL';
    row.note += `${row.note ? '; ' : ''}${made.why || `${made.rows} rows, ${made.bytes} bytes`}`;
    return row;
  }

  if (!MUTATING.has(e.operation)) return row;

  const done = await carryOut(c.sentence);

  if (e.namesRecord) row.resolution = done.resolved ? 'PASS' : 'FAIL';
  row.effect = done.changed > 0 ? 'PASS' : 'FAIL';
  if (done.why) row.note += `${row.note ? '; ' : ''}${done.why}`;
  return row;
}

/* ------------------------------------------------------------- */

async function main() {
  const rows = await Promise.all(CASES.map(scoreWithEffect));
  const AXES = ['operation', 'entity', 'filters', 'shaping',
                'resolution', 'permission', 'path', 'effect'] as const;

  const passed = (r: Row) => AXES.every((a) => r[a] === 'PASS' || r[a] === 'N/A');

  console.log(`\n  ${CASES.length} sentences. Values read from ${sampleSize()} real stock rows.`);
  console.log('  PASS requires every requested component to PASS.\n');

  const w = 46;
  console.log(`  ${'sentence'.padEnd(w)} op  ent flt shp res prm pth eff`);
  console.log(`  ${'-'.repeat(w)} --- --- --- --- --- --- --- ---`);
  const abbr = (s: State) => s === 'PASS' ? ' ok' : s === 'FAIL' ? 'ERR' : s === 'N/A' ? '  .' : ' ??';
  for (const r of rows) {
    const label = r.sentence.length > w ? `${r.sentence.slice(0, w - 1)}…` : r.sentence;
    console.log(`  ${label.padEnd(w)} ${AXES.map((a) => abbr(r[a])).join(' ')}`);
    if (r.note) console.log(`    ${' '.repeat(w)}${r.note}`);
  }

  console.log(`\n  KEY   ok = PASS   ERR = FAIL   ?? = UNVERIFIED   . = not requested\n`);

  /* Per axis, so the shape of the gap is visible rather than one number. */
  console.log('  BY COMPONENT');
  for (const a of AXES) {
    const p = rows.filter((r) => r[a] === 'PASS').length;
    const f = rows.filter((r) => r[a] === 'FAIL').length;
    const u = rows.filter((r) => r[a] === 'UNVERIFIED').length;
    const n = rows.filter((r) => r[a] === 'N/A').length;
    console.log(`    ${a.padEnd(11)} PASS ${String(p).padStart(2)}   FAIL ${String(f).padStart(2)}`
      + `   UNVERIFIED ${String(u).padStart(2)}   not requested ${String(n).padStart(2)}`);
  }

  const total = rows.filter(passed).length;
  console.log(`\n  SENTENCES PASSING ALL REQUESTED COMPONENTS: ${total}/${CASES.length}\n`);
  console.log('  Component 8 (effect) is observed for instructions: they are carried');
  console.log('  out against a fixture yard and the rows are read back. It stays');
  console.log('  UNVERIFIED for questions, exports and navigation, because nothing');
  console.log('  here runs the query executor or produces a file. Under the contract');
  console.log('  that counts against the score rather than being excused.\n');

}

main();
