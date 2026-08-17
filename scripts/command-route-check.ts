/* =============================================================
   The boundary the browser actually talks to.

   Every other check calls `applyMutation` directly. That proves the
   command layer works and proves nothing about whether the HTTP route
   hands back what it produced, which is exactly where the file a
   sentence asked for went missing: `applyMutation` returned an artefact
   and the route returned `{changed, message}`, so a confirmed
   "create a list from them and export it to Excel" made the list and
   dropped the spreadsheet on the floor.

   So this calls the route's own POST handler with a Request, reads the
   Response, and then runs the CLIENT half of the boundary against that
   body: the same decode the command bar does before it saves the file.

     text + two hashes
       -> POST /api/command/apply
       -> Response JSON
       -> the bar's own base64 decode
       -> bytes that open

   WHAT IS STUBBED, AND WHY THAT IS STILL THE ROUTE.

   Authentication and the Supabase client. Everything else is the real
   module: the real route body, the real planner, the real store
   contract over the same fake PostgreSQL the acceptance check uses. A
   harness that reimplemented the route would assert about itself.

     npm run check:route
   ============================================================= */
import { fakeDb, type Row } from './support/fake-postgrest';
import { capabilitiesFor } from '../lib/crm/permissions';
import type { UserRole } from '../lib/types';

/* -------------------------------------------------------------
   Harness
   ------------------------------------------------------------- */

let assertions = 0, failed = 0;
const failures: string[] = [];
let current = '';

const ok = (what: string, cond: boolean, got = '') => {
  assertions++;
  if (cond) return;
  failed++;
  failures.push(`  [${current}] ${what}${got ? `\n    ${got}` : ''}`);
};

const cases: { name: string; run: () => Promise<void> }[] = [];
const test = (name: string, run: () => Promise<void>) => cases.push({ name, run });

/* -------------------------------------------------------------
   The one thing that is not real: who is calling
   ------------------------------------------------------------- */

type Gate = { supabase: unknown; user: { id: string }; caps: Set<string>; fullName: string };
let gate: Gate | null = null;

/* The guard is the authentication boundary and is deliberately outside
   what this asserts: it reaches for cookies and a live Supabase client,
   neither of which exists here. Everything past it is the route's own
   code, unmodified.

   Substituted in the module cache BEFORE any route is imported, so the
   routes resolve this one rather than the real module. Patching the
   real module's exports does not work: an ES module namespace is
   read only. */
const guardPath = require.resolve('../lib/api/guard');
require.cache[guardPath] = {
  id: guardPath,
  filename: guardPath,
  loaded: true,
  exports: {
    requireCapability: async () =>
      (gate ? { ok: true, ...gate } : { ok: false, response: new Response('no', { status: 401 }) }),
    requireUser: async () =>
      (gate ? { ok: true, ...gate } : { ok: false, response: new Response('no', { status: 401 }) }),
  },
} as never;

/* -------------------------------------------------------------
   Fixtures
   ------------------------------------------------------------- */

const fleets = (): Row[] => [
  { id: 'c1', company_name: 'Dawson Group', trailers: 40, status: 'lead', created_at: '2026-02-01' },
  { id: 'c2', company_name: 'Pollock Haulage', trailers: 25, status: 'contacted', created_at: '2026-03-01' },
  { id: 'c3', company_name: 'Eddie Stobart', trailers: 300, status: 'quoted', created_at: '2026-01-15' },
  { id: 'c4', company_name: 'Corner Shop', trailers: 3, status: 'lead', created_at: '2026-04-01' },
];

const FOUND = "find customers with more than 20 trailers who haven't had a proposal this year";
const PROGRAMME = `${FOUND}, create a list called Fleet Prospects from them and export it to Excel`;

function serve(db: ReturnType<typeof fakeDb>, role: UserRole = 'admin') {
  gate = {
    supabase: db.supabase,
    user: { id: 'u1' },
    caps: capabilitiesFor({ role } as never) as unknown as Set<string>,
    fullName: 'Alex Ellis',
  };
}

const post = (url: string, body: unknown) =>
  new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

/**
 * The client half of the boundary.
 *
 * Byte for byte what `CommandBar.bytesOf` does with the body, so a
 * change to the wire shape that the bar could not decode fails here.
 */
function bytesOf(base64: string): Uint8Array {
  const binary = Buffer.from(base64, 'base64').toString('binary');
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/* =============================================================
   1. The route plans, previews and confirms
   ============================================================= */

test('the plan route reads the sentence and asks for a confirmation', async () => {
  const db = fakeDb({ crm_contacts: fleets() });
  serve(db);

  const { POST } = await import('../app/api/command/plan/route');
  const res = await POST(post('http://x/api/command/plan', {
    text: PROGRAMME, preview: true,
  }) as never);
  const body = await res.json() as {
    hash?: string; runnable?: boolean; confirm?: boolean;
    preview?: { ok: boolean; programmeHash?: string; deliveries?: unknown[] };
  };

  ok('it comes back with a reading', typeof body.hash === 'string' && !!body.hash, JSON.stringify(body).slice(0, 200));
  ok('it says it has to be confirmed', body.confirm === true, String(body.confirm));
  ok('with a preview', body.preview?.ok === true, JSON.stringify(body.preview).slice(0, 200));
  ok('that says a file is coming', (body.preview?.deliveries ?? []).length === 1,
    JSON.stringify(body.preview?.deliveries));
  ok('and nothing was written to build it', db.writes.length === 0);
});

/* =============================================================
   2. The file reaches the browser through the apply route
   ============================================================= */

test('a confirmed programme returns the change AND the spreadsheet', async () => {
  const db = fakeDb({ crm_contacts: fleets() });
  serve(db);

  const plan = await import('../app/api/command/plan/route');
  const planned = await (await plan.POST(post('http://x/api/command/plan', {
    text: PROGRAMME, preview: true,
  }) as never)).json() as { hash: string; preview: { ok: true; programmeHash: string } };

  const apply = await import('../app/api/command/apply/route');
  const res = await apply.POST(post('http://x/api/command/apply', {
    text: PROGRAMME,
    planHash: planned.hash,
    programmeHash: planned.preview.programmeHash,
    confirm: true,
  }) as never);

  ok('the request succeeds', res.status === 200, String(res.status));
  const body = await res.json() as {
    ok: boolean; message?: string;
    artefact?: { filename: string; mime: string; rows: number; base64: string } | null;
  };

  ok('the command ran', body.ok === true, JSON.stringify(body).slice(0, 200));
  ok('the list was really made', (db.tables.crm_lists ?? []).length === 1,
    JSON.stringify(db.tables.crm_lists));

  /* THE POINT OF THIS FILE. */
  ok('and the file came back with it', !!body.artefact, body.message ?? 'no artefact');
  if (!body.artefact) return;
  ok('named as a spreadsheet', body.artefact.filename.endsWith('.xlsx'), body.artefact.filename);
  ok('with the spreadsheet mime type',
    /spreadsheetml/.test(body.artefact.mime), body.artefact.mime);
  ok('holding the two customers the sentence found', body.artefact.rows === 2,
    String(body.artefact.rows));

  /* The client half: the bar decodes this and hands it to the browser. */
  const bytes = bytesOf(body.artefact.base64);
  ok('the bytes decode', bytes.length > 0, String(bytes.length));
  /* A .xlsx is a zip, so it starts PK. A body the bar could not turn
     back into a real file is the failure this check exists for. */
  ok('and they are a real workbook',
    bytes[0] === 0x50 && bytes[1] === 0x4b, `${bytes[0]},${bytes[1]}`);
});

/* =============================================================
   3. The route will not write without a confirmation
   ============================================================= */

test('the apply route refuses a request that never confirmed', async () => {
  const db = fakeDb({ crm_contacts: fleets() });
  serve(db);

  const apply = await import('../app/api/command/apply/route');
  const res = await apply.POST(post('http://x/api/command/apply', {
    text: PROGRAMME, planHash: 'x', programmeHash: 'y',
  }) as never);

  ok('it is refused', res.status === 400, String(res.status));
  const body = await res.json() as { ok: boolean; error?: string };
  ok('saying so', body.ok === false && body.error === 'not confirmed', JSON.stringify(body));
  ok('and nothing was written', db.writes.length === 0);
});

test('a hash from a different sentence writes nothing', async () => {
  const db = fakeDb({ crm_contacts: fleets() });
  serve(db);

  const apply = await import('../app/api/command/apply/route');
  const res = await apply.POST(post('http://x/api/command/apply', {
    text: PROGRAMME,
    planHash: 'not the hash of this sentence',
    programmeHash: 'nor this one',
    confirm: true,
  }) as never);

  const body = await res.json() as { ok: boolean; reason?: string };
  ok('it does not run', body.ok === false, JSON.stringify(body).slice(0, 200));
  ok('because the meaning was never agreed', body.reason === 'meaning changed', String(body.reason));
  ok('and no list was made', (db.tables.crm_lists ?? []).length === 0,
    JSON.stringify(db.tables.crm_lists));
});

/* =============================================================
   4. A read that only produces a file still uses the emit route
   ============================================================= */

test('a plain export comes back as a file body, not as JSON', async () => {
  const db = fakeDb({ crm_contacts: fleets() });
  serve(db);

  const plan = await import('../app/api/command/plan/route');
  const planned = await (await plan.POST(post('http://x/api/command/plan', {
    text: 'export the customers to CSV', preview: false,
  }) as never)).json() as { hash: string };

  const emit = await import('../app/api/command/emit/route');
  const res = await emit.POST(post('http://x/api/command/emit', {
    text: 'export the customers to CSV', hash: planned.hash,
  }) as never);

  ok('it comes back', res.status === 200, String(res.status));
  ok('as a CSV', /text\/csv/.test(res.headers.get('Content-Type') ?? ''),
    res.headers.get('Content-Type') ?? '');
  ok('as an attachment', /attachment; filename=/.test(res.headers.get('Content-Disposition') ?? ''),
    res.headers.get('Content-Disposition') ?? '');
  const text = await res.text();
  ok('holding every customer', text.includes('Dawson Group') && text.includes('Corner Shop'),
    text.slice(0, 120));
  ok('and nothing was written to produce it', db.writes.length === 0);
});

/* =============================================================
   5. A deletion is agreed to by number, at the boundary too
   ============================================================= */

test('the apply route will not delete a set without the count', async () => {
  /* Real uuids, because the route validates the shape of every id the
     browser sends before it will point a command at one. */
  const one = '11111111-1111-1111-1111-111111111111';
  const two = '22222222-2222-2222-2222-222222222222';
  const db = fakeDb({
    crm_contacts: [
      { id: one, company_name: 'TEST lead one', status: 'lead' },
      { id: two, company_name: 'TEST lead two', status: 'lead' },
    ],
  });
  serve(db);

  const context = { selection: { entity: 'contacts', ids: [one, two] } };
  const text = 'delete all 2 selected test leads';

  const plan = await import('../app/api/command/plan/route');
  const planned = await (await plan.POST(post('http://x/api/command/plan', {
    text, preview: true, context,
  }) as never)).json() as {
    hash: string; preview: { ok: true; programmeHash: string; severity: string };
  };
  ok('the preview says it is destructive', planned.preview.severity === 'destructive',
    planned.preview.severity);

  const apply = await import('../app/api/command/apply/route');
  const bare = await (await apply.POST(post('http://x/api/command/apply', {
    text, planHash: planned.hash, programmeHash: planned.preview.programmeHash,
    confirm: true, context,
  }) as never)).json() as { ok: boolean; reason?: string };

  ok('confirming without the number is refused', bare.ok === false, JSON.stringify(bare).slice(0, 160));
  ok('by name', bare.reason === 'not acknowledged', String(bare.reason));
  ok('and both records are still there', db.tables.crm_contacts.length === 2,
    String(db.tables.crm_contacts.length));

  const done = await (await apply.POST(post('http://x/api/command/apply', {
    text, planHash: planned.hash, programmeHash: planned.preview.programmeHash,
    confirm: true, acknowledge: 2, context,
  }) as never)).json() as { ok: boolean; message?: string };

  ok('and with the number it goes through', done.ok === true, JSON.stringify(done).slice(0, 160));
  ok('with both records gone', db.tables.crm_contacts.length === 0,
    String(db.tables.crm_contacts.length));
});

/* ============================================================= */

async function main() {
  for (const c of cases) {
    current = c.name;
    const before = failed;
    try {
      await c.run();
    } catch (e) {
      failed += 1;
      failures.push(`  [${current}] threw\n    ${(e as Error).stack ?? (e as Error).message}`);
    }
    if (failed > before) { /* counted per assertion */ }
  }

  console.log(`\n  ${assertions - failed}/${assertions} route-boundary assertions hold.`);
  console.log('  The apply route, the plan route and the emit route, called as HTTP.\n');
  if (failures.length) {
    console.log('  failures:');
    for (const f of failures) console.log(f);
    console.log();
  }
  if (failed) process.exitCode = 1;
}

main();
