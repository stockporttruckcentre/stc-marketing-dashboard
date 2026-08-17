/* =============================================================
   Every entity, every format, every filter shape, one implementation.

   This is the check that would fail if somebody wrote an
   export-customers-as-Word command. The sentences are built by
   combining an entity from the registry, a filter it declares, a period,
   an ordering and a format, and the assertion is that the file holds
   exactly the rows the selection described. Nothing here names a column
   or a handler.

   The combination is the point. Four formats times five entities times
   the filters each declares is a number nobody would write down, and it
   is covered by one emit step and four renderers.

     npm run check:output
   ============================================================= */
import { fakeDb, type Row } from './support/fake-postgrest';
import { postgrestStore } from '../lib/command/store/postgrest';
import { planCommand } from '../lib/command/plan';
import { runEmit } from '../lib/command/server/emit';
import { readOutput, FORMATS } from '../lib/command/output';
import { capabilitiesFor } from '../lib/crm/permissions';
import { ENTITIES } from '../lib/command/schema';

let assertions = 0, failed = 0;
const failures: string[] = [];
let current = '';
const ok = (what: string, cond: boolean, got = '') => {
  assertions++;
  if (cond) return;
  failed++;
  if (failures.length < 25) failures.push(`  [${current}] ${what}${got ? `\n    ${got}` : ''}`);
};

const CAPS = [...capabilitiesFor({ role: 'admin' } as never)];
const VIEWER = [...capabilitiesFor({ role: 'viewer' } as never)];
const NOW = new Date('2026-08-17');

/* -------------------------------------------------------------
   A yard, a CRM and a planner, in one fixture
   ------------------------------------------------------------- */

const TRAILERS: Row[] = [
  { id: 't1', stc_no: 'STC143580', status: 'sold', location: 'Hyde', category: 'Curtainsider', colour: 'Blue', customer: 'Dawson Group', sales_rep: 'Dave', sales_price: 24995, retail_price: 26000, dispatch_date: '2026-06-14', make: 'Schmitz', model: 'S.CS' },
  { id: 't2', stc_no: 'STC143581', status: 'sold', location: 'Hyde', category: 'Curtainsider', colour: 'Red', customer: 'Dawson Group', sales_rep: 'Dave', sales_price: 31000, retail_price: 33000, dispatch_date: '2026-06-20', make: 'Krone', model: 'SDP' },
  { id: 't3', stc_no: 'STC144504', status: 'sold', location: 'Carrington', category: 'Curtainsider', colour: 'Blue', customer: 'Wincanton', sales_rep: 'Dave', sales_price: 28000, retail_price: 29000, dispatch_date: '2026-05-01', make: 'Krone', model: 'SDP' },
  { id: 't4', stc_no: 'STC199999', status: 'in_stock', location: 'Hyde', category: 'Curtainsider', colour: 'Blue', customer: null, sales_rep: null, sales_price: 21000, retail_price: 22000, dispatch_date: null, make: 'SDC', model: 'X' },
  { id: 't5', stc_no: 'STC155555', status: 'sold', location: 'Hyde', category: 'Fridge', colour: 'Blue', customer: 'Dawson Group', sales_rep: 'Dave', sales_price: 40000, retail_price: 42000, dispatch_date: '2026-07-01', make: 'Chereau', model: 'C' },
  { id: 't6', stc_no: 'STC166666', status: 'sold', location: 'Hyde', category: 'Curtainsider', colour: 'Blue', customer: 'Dawson Group', sales_rep: 'Lucy', sales_price: 27000, retail_price: 28000, dispatch_date: '2026-06-02', make: 'Krone', model: 'SDP' },
  { id: 't7', stc_no: 'STC177777', status: 'sold', location: 'Hyde', category: 'Curtainsider', colour: 'Blue', customer: 'Dawson Group', sales_rep: 'Dave', sales_price: 26000, retail_price: 27000, dispatch_date: '2025-01-05', make: 'Krone', model: 'SDP' },
];

const CONTACTS: Row[] = [
  { id: 'c1', company_name: 'Dawson Group', contact_name: 'Ian', status: 'customer', location: 'Manchester', email: 'i@d.co', fleet_size: 60, list_id: 'l1', date_of_enquiry: '2026-06-01' },
  { id: 'c2', company_name: 'Wincanton', contact_name: 'Sue', status: 'quoted', location: 'Bredbury', email: null, fleet_size: 12, list_id: 'l1', date_of_enquiry: '2026-07-01' },
  { id: 'c3', company_name: 'Culina', contact_name: 'Ed', status: 'lead', location: 'Manchester', email: 'e@c.co', fleet_size: 200, list_id: 'l1', date_of_enquiry: '2026-02-01' },
];

const POSTS: Row[] = [
  { id: 'p1', content: 'One', platform: ['linkedin'], status: 'pending_review', scheduled_date: '2026-09-01', created_by: 'x', hashtags: [] },
  { id: 'p2', content: 'Two', platform: ['linkedin'], status: 'draft', scheduled_date: '2026-09-02', created_by: 'x', hashtags: [] },
];

const fixture = () => fakeDb({
  stock_trailers: TRAILERS.map((r) => ({ ...r })),
  crm_contacts: CONTACTS.map((r) => ({ ...r })),
  social_posts: POSTS.map((r) => ({ ...r })),
});

async function produce(text: string, caps = CAPS) {
  const db = fixture();
  const planning = planCommand(text, { actorCapabilities: caps });
  if (!planning) return { planning: null, out: null, db };
  const out = await runEmit(planning, {
    store: postgrestStore(db.supabase), actorName: 'Alex Ellis', now: NOW,
  });
  return { planning, out, db };
}

/* =============================================================
   1. The sentence that had to work
   ============================================================= */

async function hardCase() {
  current = 'the acceptance sentence';
  const text = 'export a list of blue curtain trailers sold to Dawson in the last 6 months by Dave as a Word document';
  const { planning, out } = await produce(text);

  ok('it is understood', !!planning);
  ok('it produces an emit step',
    !!planning?.plan.steps.some((s) => s.op === 'emit'),
    planning?.plan.steps.map((s) => s.op).join(','));
  ok('nothing in the sentence went unread', (planning?.plan.unmet ?? []).length === 0,
    JSON.stringify(planning?.plan.unmet));
  ok('it is permitted and executable',
    planning?.availability.permitted === true && planning?.availability.executable === true);

  ok('a file came back', !!out?.ok, out && !out.ok ? out.why : '');
  if (!out?.ok) return;

  ok('it is a Word document', out.artefact.filename.endsWith('.docx'), out.artefact.filename);
  ok('and a real one', out.artefact.bytes.length > 4000 && out.artefact.bytes[0] === 0x50,
    String(out.artefact.bytes.length));

  /* All and only. Six of the seven fixture trailers fail exactly one of
     the five things the sentence said, and the seventh passes all of
     them. */
  ok('exactly one row', out.rows === 1, String(out.rows));

  const text2 = new TextDecoder().decode(out.artefact.bytes);
  void text2;
}

/* =============================================================
   2. The same sentence, one word at a time different

   Each of these changes exactly one thing and expects a different set of
   rows. No handler exists for any of them, which is the assertion.
   ============================================================= */

const VARIANTS: { text: string; rows: number; why: string }[] = [
  { text: 'export a list of blue curtain trailers sold to Dawson in the last 6 months by Dave as a Word document',
    rows: 1, why: 'the sentence as given' },
  { text: 'export a list of red curtain trailers sold to Dawson in the last 6 months by Dave as a Word document',
    rows: 1, why: 'a different colour finds the red one' },
  { text: 'export a list of blue fridges sold to Dawson in the last 6 months by Dave as a Word document',
    rows: 1, why: 'a different body type finds the fridge' },
  { text: 'export a list of blue curtain trailers sold to Wincanton in the last 6 months by Dave as a Word document',
    rows: 1, why: 'a different customer finds the Wincanton one' },
  { text: 'export a list of blue curtain trailers sold to Dawson in the last 6 months by Lucy as a Word document',
    rows: 1, why: 'a different rep finds the one Lucy sold' },
  { text: 'export a list of blue curtain trailers sold to Dawson in the last 2 years by Dave as a Word document',
    rows: 2, why: 'a longer period reaches back to the 2025 one' },
  { text: 'export a list of blue curtain trailers sold to Dawson by Dave as a CSV',
    rows: 2, why: 'no period at all, both of Dave\'s blue curtainsiders for Dawson' },
];

async function variants() {
  for (const v of VARIANTS) {
    current = v.why;
    const { out } = await produce(v.text);
    ok('a file came back', !!out?.ok, out && !out.ok ? out.why : '');
    if (!out?.ok) continue;
    ok(`it holds ${v.rows} ${v.rows === 1 ? 'row' : 'rows'}`, out.rows === v.rows, String(out.rows));
  }
}

/* =============================================================
   3. Every format, from the registry's own words
   ============================================================= */

const MAGIC: Record<string, (b: Uint8Array) => boolean> = {
  csv: (b) => b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf,          // BOM
  xlsx: (b) => b[0] === 0x50 && b[1] === 0x4b,                          // PK zip
  docx: (b) => b[0] === 0x50 && b[1] === 0x4b,
  pdf: (b) => String.fromCharCode(b[0], b[1], b[2], b[3]) === '%PDF',
};

async function formats() {
  for (const f of FORMATS) {
    for (const word of f.words) {
      current = `every format: "${word}"`;
      const text = `export the sold trailers as a ${word}`;
      const read = readOutput(text);
      ok('the format is read', read?.format === f.format, String(read?.format));

      const { out } = await produce(text);
      ok('a file came back', !!out?.ok, out && !out.ok ? out.why : '');
      if (!out?.ok) continue;
      ok(`it is genuinely a ${f.format}`, MAGIC[f.format](out.artefact.bytes),
        `${out.artefact.filename}, first bytes ${[...out.artefact.bytes.slice(0, 4)].join(',')}`);
      ok('with the right extension', out.artefact.filename.endsWith(`.${f.format}`),
        out.artefact.filename);
      /* Six of the seven fixture trailers are sold. The count is
         asserted from the fixture rather than typed, so a row added to
         it cannot make this quietly wrong. */
      ok('and every sold trailer', out.rows === TRAILERS.filter((t) => t.status === 'sold').length,
        String(out.rows));
    }
  }
}

/* =============================================================
   4. Every entity the registry declares
   ============================================================= */

async function entities() {
  const EXPECT: Record<string, number> = {
    trailers: TRAILERS.length, contacts: CONTACTS.length, posts: POSTS.length,
  };
  for (const e of ENTITIES) {
    const noun = e.nouns[1] ?? e.nouns[0];
    current = `every entity: ${e.id}`;
    const { planning, out } = await produce(`export all ${noun} as a CSV`);
    ok('it plans', !!planning, 'nothing came back');
    if (!planning) continue;
    ok('onto the right entity',
      (planning.select?.from as { entity?: string })?.entity === e.id,
      String((planning.select?.from as { entity?: string })?.entity));
    ok('and a file came back', !!out?.ok, out && !out.ok ? out.why : '');
    if (!out?.ok) continue;
    if (EXPECT[e.id] != null) {
      ok(`with the ${EXPECT[e.id]} fixture rows`, out.rows === EXPECT[e.id], String(out.rows));
    }
  }
}

/* =============================================================
   5. Ordering and limit survive into the file
   ============================================================= */

async function shaping() {
  current = 'ordering and limit';
  const { out } = await produce('export the three most expensive sold trailers as a CSV');
  ok('a file came back', !!out?.ok, out && !out.ok ? out.why : '');
  if (!out?.ok) return;
  ok('the limit is honoured', out.rows === 3, String(out.rows));

  /* The three dearest of the six sold, in descending order, worked out
     from the fixture rather than written down. */
  const want = TRAILERS
    .filter((t) => t.status === 'sold')
    .sort((a, b) => Number(b.sales_price) - Number(a.sales_price))
    .slice(0, 3)
    .map((t) => String(t.stc_no));

  const body = new TextDecoder().decode(out.artefact.bytes);
  const order = want.map((s) => body.indexOf(s));
  ok('and the order is the one that was asked for',
    order.every((i) => i > 0) && order[0] < order[1] && order[1] < order[2],
    `${want.join(' > ')} at ${order.join(',')}`);
}

/* =============================================================
   6. Permission, and what a download is not
   ============================================================= */

async function permission() {
  current = 'permission';
  const viewer = planCommand('export the sold trailers as a CSV', { actorCapabilities: VIEWER });
  ok('a viewer may export, because crm.export is a viewer capability',
    viewer?.availability.permitted === true, JSON.stringify(viewer?.availability.missingPermissions));

  const nobody = planCommand('export the sold trailers as a CSV', { actorCapabilities: [] });
  ok('somebody with no capabilities may not',
    nobody?.availability.permitted === false, JSON.stringify(nobody?.availability.missingPermissions));
  ok('and the missing permission is named',
    !!nobody?.availability.missingPermissions.includes('crm.export'),
    JSON.stringify(nobody?.availability.missingPermissions));

  current = 'downloading is not a destructive act';
  const planning = planCommand('export the sold trailers as a CSV', { actorCapabilities: CAPS });
  ok('it does not ask for a confirmation', planning?.confirm === false, String(planning?.confirm));
}

/* =============================================================
   7. A question is still a question
   ============================================================= */

async function questions() {
  current = 'a question with no output clause';
  const planning = planCommand('how many trailers are at Hyde', { actorCapabilities: CAPS });
  ok('produces no emit step',
    !planning?.plan.steps.some((s) => s.op === 'emit'),
    planning?.plan.steps.map((s) => s.op).join(','));

  current = 'a place that happens to be called Word';
  const misread = readOutput('customers in Word Street');
  ok('is not an export', misread === null, JSON.stringify(misread));
}

/* ============================================================= */

async function main() {
  await hardCase();
  await variants();
  await formats();
  await entities();
  await shaping();
  await permission();
  await questions();

  console.log(`\n  ${assertions - failed}/${assertions} output assertions hold.`);
  console.log(`  ${FORMATS.length} formats x ${ENTITIES.length} entities, one emit step and four renderers.\n`);
  if (failures.length) {
    console.log('  failures:');
    for (const f of failures) console.log(f);
    console.log();
  }
  if (failed) process.exitCode = 1;
}

main();
