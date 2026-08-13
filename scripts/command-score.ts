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

   WHAT THIS DOES NOT TEST
     No database is contacted. No row is read or written. No file is
     produced. Component 8 is therefore UNVERIFIED for every sentence,
     and component 5 is UNVERIFIED wherever a real record lookup would
     be needed. Under the contract above those count against the score
     rather than being excused, because a command that cannot be
     observed to have happened has not been shown to happen.

     That is the point. A number that excluded them is the number that
     produced "10/10" and "103,144 sentences" earlier in this work.

     npm run check:score
   ============================================================= */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseQuery } from '../lib/command/query';
import { parseEdit } from '../lib/command/mutate';
import { suggestActions, ACTIONS } from '../lib/command/actions';
import { parse } from '../lib/command/intents';
import { readsOnlyText, INSTRUCTION } from '../lib/command/arbitrate';
import { capabilitiesFor } from '../lib/crm/permissions';
import { loadSampleVocabulary, sampleSize } from './sample-vocabulary';

const caps = capabilitiesFor({ role: 'admin' });
loadSampleVocabulary();

const read = (p: string) => {
  try { return readFileSync(join(process.cwd(), p), 'utf8'); } catch { return ''; }
};
const EXECUTE = read('app/api/command/execute/route.ts');
const EDIT_ROUTE = read('app/api/command/edit/route.ts');
const QUERY_ROUTE = read('app/api/command/query/route.ts');

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

function score(c: Case): Row {
  const e = c.expect;
  const plan = parseQuery(c.sentence);
  const edit = parseEdit(c.sentence, caps);
  const hits = suggestActions(c.sentence, caps, 5);
  const intent = parse(c.sentence);

  const row: Row = {
    sentence: c.sentence,
    operation: 'FAIL', entity: 'N/A', filters: 'N/A', shaping: 'N/A',
    resolution: 'N/A', permission: 'N/A', path: 'FAIL', effect: 'UNVERIFIED',
    note: '',
  };

  /* --- 1 operation ---
     Did the engine resolve the verb the sentence asked for? */
  if (e.operation === 'query') {
    row.operation = plan ? 'PASS' : 'FAIL';
  } else if (e.operation === 'update') {
    row.operation = edit && edit.missing.length === 0 ? 'PASS' : 'FAIL';
    if (edit && edit.missing.length) row.note = `write incomplete: needs ${edit.missing.join(', ')}`;
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

  /* --- 2 entity --- */
  if (e.entity) {
    row.entity = plan?.entity.id === e.entity ? 'PASS' : 'FAIL';
    if (!plan) row.entity = 'FAIL';
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
     A named record has to be found in the database. Nothing here reads
     a database, so this cannot be observed. */
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
  } else if (e.operation === 'update') {
    row.path = EDIT_ROUTE && edit && edit.missing.length === 0 ? 'PASS' : 'FAIL';
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

/* ------------------------------------------------------------- */

const rows = CASES.map(score);
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
console.log('  Component 8 (effect) is UNVERIFIED for every sentence because');
console.log('  this harness contacts no database and produces no file. Under');
console.log('  the contract that counts against the score rather than being');
console.log('  excluded. Fixture-based execution tests are what would move it.\n');
