/* =============================================================
   The same sentences, against a real PostgreSQL.

   `check:acceptance` runs the whole path against a fake that behaves the
   way PostgREST is expected to behave. That proves the sentence reaches
   the executor and that the executor sends the right call. It proves
   nothing about the database, because there is not one.

   This closes the half that matters most: the rows afterwards. It runs
   against the disposable server `scripts/sql/build-test-db.sh` builds,
   with this repository's own schema, its own policies, its own
   constraints and its own `command_apply`.

   WHAT IS REAL HERE AND WHAT IS NOT.

     real    the fixture rows, in real tables with real column types
     real    the payload, produced by the canonical path from raw text
     real    the write, through `command_apply` in one transaction
     real    the rows read back afterwards, by SQL

     fake    the READ that narrows the selection, which still goes
             through the PostgREST-shaped store

   The narrowing is simulated because the store speaks PostgREST and this
   server speaks SQL, and writing a second condition compiler to talk to
   it would put back the duplication this whole phase removed. So the
   store is seeded FROM the real rows before each sentence and the write
   goes to the real server: what a sentence selected is proven against
   the fake, and what the database ends up holding is proven here.

   Skipped, loudly, when the disposable server is not running. A check
   that silently passes because it did nothing is worse than no check.

     ./scripts/sql/build-test-db.sh && npm run check:postgres
   ============================================================= */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fakeDb, type Row } from './support/fake-postgrest';
import { postgrestStore } from '../lib/command/store/postgrest';
import { planAndPreview, applyMutation } from '../lib/command/server/mutation';
import { capabilitiesFor } from '../lib/crm/permissions';
import { EMPTY_VOCABULARY } from '../lib/command/vocab';
import type { Change } from '../lib/command/ir/store';

/* -------------------------------------------------------------
   Talking to it
   ------------------------------------------------------------- */

const PSQL = '/usr/lib/postgresql/16/bin/psql';
const SOCKET = '/var/tmp/pgtest';
const ARGS = ['-p', '55432', '-U', 'postgres', '-d', 'stctest', '-tAq'];

function available(): boolean {
  return existsSync(PSQL) && existsSync(`${SOCKET}/.s.PGSQL.55432`);
}

function sql(statement: string): string {
  return execFileSync(PSQL, [...ARGS, '-v', 'ON_ERROR_STOP=1', '-c', statement], {
    env: { ...process.env, PGHOST: SOCKET },
    encoding: 'utf8',
  }).trim();
}

/** Rows out of the real database, as the store's fake would hold them. */
function rowsFrom(table: string, columns: string[], where: string): Row[] {
  const out = sql(
    `SELECT json_agg(t) FROM (SELECT ${columns.join(', ')} FROM ${table} WHERE ${where}) t`,
  );
  return out && out !== '' ? (JSON.parse(out) as Row[]) : [];
}

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

const actor = {
  capabilities: [...capabilitiesFor({ role: 'admin' } as never)],
  vocabulary: async () => EMPTY_VOCABULARY,
};

const COLUMNS = [
  'id::text AS id', 'stc_no', 'status', 'location', 'category',
  'retail_price::float8 AS retail_price', 'nbv::float8 AS nbv',
  'refurb_costs::float8 AS refurb_costs', 'mot_date::text AS mot_date', 'notes',
];

/**
 * Type a sentence, and change a real database with it.
 *
 * The selection is resolved against a store seeded from the real rows,
 * and the changes that come out of the canonical path are handed to the
 * real `command_apply`. Nothing here writes a column name or an id.
 */
async function carryOut(text: string): Promise<{
  previewed: number; applied: number; changes: Change[]; why: string;
}> {
  const seeded = rowsFrom('stock_trailers', COLUMNS, "stc_no LIKE 'STC9%'");
  const db = fakeDb({ stock_trailers: seeded });
  const store = postgrestStore(db.supabase);

  const planned = await planAndPreview({ text, ...actor, store, preview: true });
  if (!planned) return { previewed: 0, applied: 0, changes: [], why: 'not understood' };
  if (planned.planned.planning.kind !== 'mutate') {
    return { previewed: 0, applied: 0, changes: [], why: 'read as a question' };
  }
  const preview = planned.preview;
  if (!preview?.ok) {
    return { previewed: 0, applied: 0, changes: [], why: preview ? preview.why : 'no preview' };
  }

  /* The changes the canonical path produced, sent to the real function.
     `applyMutation` would send them through the same store, which is the
     fake; this takes the payload it produces and gives it to Postgres,
     which is the half the fake cannot answer for. */
  let changes: Change[] = [];
  const recording = postgrestStore({
    from: db.supabase.from,
    rpc: async (name: string, args: Record<string, unknown>) => {
      if (name !== 'command_apply') return { data: null, error: { message: 'no such function' } };
      changes = args.p_changes as Change[];
      return { data: changes.length, error: null };
    },
  });

  const done = await applyMutation({
    text, ...actor, store: recording,
    previewPlanHash: planned.planned.meaning.hash,
    previewProgrammeHash: preview.programmeHash,
  });
  if (!done.ok) return { previewed: preview.count, applied: 0, changes: [], why: done.why };

  const applied = Number(sql(`SELECT command_apply('${JSON.stringify(changes).replace(/'/g, "''")}'::JSONB)`));
  return { previewed: preview.count, applied, changes, why: '' };
}

function fixtures(): void {
  sql("DELETE FROM stock_trailers WHERE stc_no LIKE 'STC9%'");
  sql(`INSERT INTO stock_trailers (stc_no, status, location, category, retail_price, nbv, refurb_costs, mot_date)
       VALUES
         ('STC943580', 'in_stock', 'Hyde', 'Curtainsider', 20000, 15000, 500, '2027-03-14'),
         ('STC943581', 'in_stock', 'Hyde', 'Curtainsider', 24000, 18000, 250, '2027-06-01'),
         ('STC944504', 'sold', 'Hyde', 'Curtainsider', 30000, 22000, 0, '2026-12-01'),
         ('STC999999', 'in_stock', 'Carrington', 'Curtainsider', 21000, 16000, 100, '2028-01-01'),
         ('STC955555', 'in_stock', 'Hyde', 'Fridge', 40000, 30000, 0, '2028-06-01')`);
}

const value = (stc: string, column: string) =>
  sql(`SELECT ${column} FROM stock_trailers WHERE stc_no = '${stc}'`);

/* ============================================================= */

async function main() {
  if (!available()) {
    console.log('\n  SKIPPED. The disposable PostgreSQL is not running.');
    console.log('  Build it with ./scripts/sql/build-test-db.sh, then run this again.\n');
    return;
  }

  /* The fixture stock numbers are real stock numbers. A reference
     shaped like anything else is not one, and the reader is right to
     say so: `PGT143580` was read as a question the first time this ran,
     because nothing in this application calls a trailer that. */
  /* ---- one named record ---- */
  current = 'set the retail price on STC943580 to £24,995';
  fixtures();
  {
    const r = await carryOut(current);
    ok('the sentence produced exactly one change', r.changes.length === 1, r.why || String(r.changes.length));
    ok('naming the real table', r.changes[0]?.table === 'stock_trailers', r.changes[0]?.table);
    ok('and the real column', Object.keys(r.changes[0]?.set ?? {}).join(',') === 'retail_price',
      Object.keys(r.changes[0]?.set ?? {}).join(','));
    ok('command_apply changed one row', r.applied === 1, String(r.applied));
    ok('and the row in PostgreSQL holds 24995', value('STC943580', 'retail_price::int') === '24995',
      value('STC943580', 'retail_price::int'));
    ok('nothing else moved',
      sql("SELECT count(*) FROM stock_trailers WHERE stc_no LIKE 'STC9%' AND retail_price = 24995") === '1');
  }

  /* ---- a described set ---- */
  current = 'move every available curtainsider at Hyde to Bredbury';
  fixtures();
  {
    const r = await carryOut(current);
    ok('two rows were previewed', r.previewed === 2, r.why || String(r.previewed));
    ok('and two changes were produced', r.changes.length === 2, String(r.changes.length));
    ok('command_apply changed both', r.applied === 2, String(r.applied));
    ok('both curtainsiders are at Bredbury in PostgreSQL',
      sql("SELECT count(*) FROM stock_trailers WHERE stc_no LIKE 'STC9%' AND location = 'Bredbury'") === '2');
    ok('the sold one is still at Hyde', value('STC944504', 'location') === 'Hyde');
    ok('the fridge is still at Hyde', value('STC955555', 'location') === 'Hyde');
    ok('and Carrington was not touched', value('STC999999', 'location') === 'Carrington');
  }

  /* ---- arithmetic, per row ---- */
  current = 'add 250 refurb costs to every available curtainsider at Hyde';
  fixtures();
  {
    const r = await carryOut(current);
    ok('two changes were produced', r.changes.length === 2, r.why || String(r.changes.length));
    ok('command_apply changed both', r.applied === 2, String(r.applied));
    ok('one row went from 500 to 750', value('STC943580', 'refurb_costs::int') === '750',
      value('STC943580', 'refurb_costs::int'));
    ok('and the other from 250 to 500', value('STC943581', 'refurb_costs::int') === '500',
      value('STC943581', 'refurb_costs::int'));
  }

  /* ---- a column the allowlist does not hold ---- */
  current = 'the database refuses a column the registry never declared';
  fixtures();
  {
    let raised = '';
    try {
      sql(`SELECT command_apply('[{"table":"stock_trailers","id":"${
        sql("SELECT id FROM stock_trailers WHERE stc_no = 'STC943580'")
      }","set":{"created_at":"2020-01-01"}}]'::JSONB)`);
    } catch (e) {
      raised = String((e as Error).message);
    }
    ok('it raises rather than writing', /may not write/.test(raised), raised.slice(0, 200));
  }

  sql("DELETE FROM stock_trailers WHERE stc_no LIKE 'STC9%'");

  console.log(`\n  ${assertions - failed}/${assertions} assertions hold against real PostgreSQL 16.\n`);
  if (failures.length) {
    console.log('  failures:');
    for (const f of failures) console.log(f);
    console.log();
  }
  if (failed) process.exitCode = 1;
}

main();
