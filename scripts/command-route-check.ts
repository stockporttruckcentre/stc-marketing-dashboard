/* =============================================================
   The boundary the browser actually talks to.

   Every other check calls `applyMutation` directly. That proves the
   command layer works and proves nothing about whether the HTTP route
   hands back what it produced, which is exactly where the file a
   sentence asked for went missing: `applyMutation` returned an artefact
   and the route returned `{changed, message}`, so a confirmed
   "create a list from them and export it to Excel" made the list and
   dropped the spreadsheet on the floor.

   So this calls the route's own POST handler with a Request and reads
   the Response the way the command bar reads it.

     text + two hashes
       -> POST /api/command/apply
       -> a binary body when there is a file, JSON when there is not
       -> bytes that open

   THE FILE IS THE BODY, NOT A STRING INSIDE ONE.

   A workbook of a complete selection can be tens of megabytes, and
   base64 in JSON makes it a third larger again and then holds three
   copies of it in the browser. The large case below exists so this is
   not proving only that a two kilobyte workbook survives.

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
 * What the bar does with the response: a body that is not JSON is the
 * file, and what the command did is in the headers.
 */
async function readArtefact(res: Response) {
  const json = res.headers.get('Content-Type')?.includes('application/json') ?? false;
  if (json) return null;
  return {
    filename: /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ?? '',
    mime: res.headers.get('Content-Type') ?? '',
    rows: Number(res.headers.get('X-Command-Rows') ?? 0),
    changed: Number(res.headers.get('X-Command-Changed') ?? 0),
    message: decodeURIComponent(res.headers.get('X-Command-Message') ?? ''),
    bytes: new Uint8Array(await res.arrayBuffer()),
  };
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

  /* THE POINT OF THIS FILE. */
  const file = await readArtefact(res);
  ok('the response is the file, not JSON', !!file, 'it was JSON');
  if (!file) return;

  ok('the list was really made', (db.tables.crm_lists ?? []).length === 1,
    JSON.stringify(db.tables.crm_lists));
  ok('named as a spreadsheet', file.filename.endsWith('.xlsx'), file.filename);
  ok('with the spreadsheet mime type', /spreadsheetml/.test(file.mime), file.mime);
  ok('holding the two customers the sentence found', file.rows === 2, String(file.rows));
  ok('and it says what the command did',
    /Make a list out of these records/.test(file.message), file.message);
  /* A .xlsx is a zip, so it starts PK. */
  ok('the bytes are a real workbook',
    file.bytes[0] === 0x50 && file.bytes[1] === 0x4b,
    `${file.bytes[0]},${file.bytes[1]}`);
});

test('a large export comes back whole, through the same route', async () => {
  /* Eight thousand customers. Not a size anybody would call large, and
     large enough that a base64 JSON round trip would be doing three
     copies of a multi megabyte string. The export system was
     deliberately made capable of complete selections; the boundary must
     not put the limit back. */
  const many: Row[] = [];
  for (let i = 0; i < 8000; i++) {
    many.push({
      id: `b${i}`,
      company_name: `Bulk Customer ${i} with a name long enough to make the file worth measuring`,
      status: 'lead', location: 'Hyde', trailers: 30,
      created_at: '2026-02-01', notes: 'a note of some length, repeated across every single row',
    });
  }
  const db = fakeDb({ crm_contacts: many });
  serve(db);

  const text = 'find the customers in Hyde, create a list called Everybody from them '
    + 'and export it to Excel';

  const plan = await import('../app/api/command/plan/route');
  const planned = await (await plan.POST(post('http://x/api/command/plan', {
    text, preview: true,
  }) as never)).json() as { hash: string; preview: { ok: true; programmeHash: string } };
  ok('it previews', !!planned.preview?.programmeHash, JSON.stringify(planned).slice(0, 200));
  if (!planned.preview?.programmeHash) return;

  const apply = await import('../app/api/command/apply/route');
  const res = await apply.POST(post('http://x/api/command/apply', {
    text, planHash: planned.hash, programmeHash: planned.preview.programmeHash, confirm: true,
  }) as never);

  const file = await readArtefact(res);
  ok('the response is the file', !!file, 'it was JSON');
  if (!file) return;

  ok('every customer is in it', file.rows === 8000, String(file.rows));
  ok('and it is a real workbook of real size',
    file.bytes[0] === 0x50 && file.bytes[1] === 0x4b && file.bytes.length > 200_000,
    `${file.bytes.length} bytes`);
  ok('the list was made over all of them',
    db.tables.crm_contacts.every((r) => r.list_id === 'list1'),
    String(db.tables.crm_contacts.filter((r) => r.list_id !== 'list1').length));
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

/* =============================================================
   8. A sentence that was understood and left something out
   ============================================================= */

/**
 * The clarification loop, over HTTP, exactly as the bar drives it.
 *
 * `completedWith` is the bar's own function, not a copy: the answer is
 * put back into the RAW TEXT and the whole sentence is planned again.
 * If this ever diverges from what the browser does, it diverges in one
 * place rather than two.
 */
test('a post with nothing to say is a question, and the answer completes the sentence', async () => {
  const db = fakeDb({ social_posts: [] });
  serve(db);

  const plan = await import('../app/api/command/plan/route');
  const { completedWith } = await import('../lib/command/ir/validate');

  const text = 'create a new LinkedIn post';
  const asked = await (await plan.POST(post('http://x/api/command/plan', {
    text, preview: true,
  }) as never)).json() as {
    ok: boolean; understood: boolean; runnable: boolean; completion: string;
    missing: { key: string; ask: string; fills: string }[];
    preview: unknown;
  };

  ok('it is understood', asked.understood === true, JSON.stringify(asked).slice(0, 200));
  ok('and reported incomplete rather than refused', asked.completion === 'incomplete', asked.completion);
  ok('it will not run', asked.runnable === false, String(asked.runnable));
  ok('it asks what the post should say',
    asked.missing?.[0]?.ask === 'What should it say?', JSON.stringify(asked.missing));
  ok('and nothing at all was written', db.writes.length === 0, JSON.stringify(db.writes).slice(0, 160));

  /* What the bar does with the answer. */
  const said = completedWith(text, asked.missing[0] as never, 'Depot open Saturday');
  ok('the answer went into the sentence',
    said === 'create a new LinkedIn post saying "Depot open Saturday"', said);

  const whole = await (await plan.POST(post('http://x/api/command/plan', {
    text: said, preview: true,
  }) as never)).json() as {
    hash: string; runnable: boolean; completion: string;
    preview: { ok: boolean; programmeHash: string };
  };

  ok('the completed sentence is whole', whole.completion === 'complete', whole.completion);
  ok('and runnable', whole.runnable === true, String(whole.runnable));
  ok('with a preview', whole.preview?.ok === true, JSON.stringify(whole.preview).slice(0, 200));
  ok('and still nothing written', db.writes.length === 0, JSON.stringify(db.writes).slice(0, 160));

  const apply = await import('../app/api/command/apply/route');
  const done = await (await apply.POST(post('http://x/api/command/apply', {
    text: said,
    planHash: whole.hash,
    programmeHash: whole.preview.programmeHash,
    confirm: true,
  }) as never)).json() as { ok: boolean; message?: string };

  ok('confirming writes the post', done.ok === true, JSON.stringify(done).slice(0, 200));
  ok('and the post is there with what they said',
    (db.tables.social_posts ?? []).some((r) => String(r.content) === 'Depot open Saturday'),
    JSON.stringify(db.tables.social_posts).slice(0, 200));
});

test('a search with no place asks where, and reaches no provider', async () => {
  const db = fakeDb({ crm_contacts: fleets() });
  serve(db);

  const { FINDER } = await import('../lib/crm/finder');
  const { LUSHA_GATE } = await import('../lib/crm/permissions');
  const real = FINDER.search;
  const wasLocked = LUSHA_GATE.locked;
  let calls = 0;
  /* Unlocked deliberately: a refusal because the whole surface is
     switched off would prove nothing about the sentence. */
  LUSHA_GATE.locked = false;
  FINDER.search = async () => { calls += 1; return []; };

  try {
    /* The gate holds the actor's capabilities, and they are computed
       once at `serve`. With the lock lifted, this is the role that
       would hold `crm.enrich`. */
    gate = {
      supabase: db.supabase,
      user: { id: 'u1' },
      caps: new Set([...(gate?.caps ?? []), 'crm.enrich']) as unknown as Set<string>,
      fullName: 'Alex Ellis',
    };

    const plan = await import('../app/api/command/plan/route');
    const asked = await (await plan.POST(post('http://x/api/command/plan', {
      text: 'find waste companies', preview: true,
    }) as never)).json() as {
      understood: boolean; runnable: boolean; completion: string;
      missing: { key: string; ask: string }[];
    };

    ok('it is understood', asked.understood === true, JSON.stringify(asked).slice(0, 200));
    ok('and incomplete', asked.completion === 'incomplete', asked.completion);
    ok('it asks where to search',
      asked.missing?.[0]?.ask === 'Where should I search?', JSON.stringify(asked.missing));
    ok('it will not run', asked.runnable === false, String(asked.runnable));
    ok('and no search was made', calls === 0, String(calls));
    ok('and nothing was written', db.writes.length === 0, JSON.stringify(db.writes).slice(0, 160));
  } finally {
    FINDER.search = real;
    LUSHA_GATE.locked = wasLocked;
  }
});

test('a meeting with no time asks for one over HTTP, then books it', async () => {
  const db = fakeDb({
    crm_contacts: [{ id: 'c1', company_name: 'Dawson Group', status: 'lead' }],
    calendar_events: [],
  });
  serve(db);

  const plan = await import('../app/api/command/plan/route');
  const { completedWith } = await import('../lib/command/ir/validate');

  const text = 'schedule a call with Dawson next Friday';
  const asked = await (await plan.POST(post('http://x/api/command/plan', {
    text, preview: true,
  }) as never)).json() as {
    understood: boolean; runnable: boolean; completion: string;
    missing: { key: string; ask: string; fills: string }[];
  };

  ok('it is understood', asked.understood === true, JSON.stringify(asked).slice(0, 200));
  ok('and incomplete rather than refused', asked.completion === 'incomplete', asked.completion);
  ok('it asks what time', asked.missing?.[0]?.ask === 'What time?', JSON.stringify(asked.missing));
  ok('it will not run', asked.runnable === false, String(asked.runnable));
  ok('and nothing was written', db.writes.length === 0, JSON.stringify(db.writes));

  const said = completedWith(text, asked.missing[0] as never, '10am');
  const whole = await (await plan.POST(post('http://x/api/command/plan', {
    text: said, preview: true,
  }) as never)).json() as {
    hash: string; completion: string; preview: { ok: boolean; programmeHash: string };
  };
  ok('the completed sentence is whole', whole.completion === 'complete', whole.completion);
  ok('and previews', whole.preview?.ok === true, JSON.stringify(whole.preview).slice(0, 200));

  const apply = await import('../app/api/command/apply/route');
  const done = await (await apply.POST(post('http://x/api/command/apply', {
    text: said,
    planHash: whole.hash,
    programmeHash: whole.preview.programmeHash,
    confirm: true,
  }) as never)).json() as { ok: boolean };

  ok('confirming books the meeting', done.ok === true, JSON.stringify(done).slice(0, 200));
  ok('and it is in the diary at ten',
    (db.tables.calendar_events ?? []).length === 1
    && new Date(String(db.tables.calendar_events[0].start_at)).getHours() === 10,
    JSON.stringify(db.tables.calendar_events));
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
