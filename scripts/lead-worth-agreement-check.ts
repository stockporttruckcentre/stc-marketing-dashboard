/* =============================================================
   The two definitions of what a deal is worth, held together.

   `valueOf` in `lib/crm/lead-value.ts` decides it for every screen.
   `lead_worth` in migration 119 decides it for the personal portfolio
   figures, because those are worked out in SQL.

   Two copies of one rule is how a figure on one screen stops matching
   the same figure on another, and the scope is explicit about it:

     There must not be one calculation on the dashboard and another in
     Analytics.

   So neither is trusted. Both are run over the same rows and the
   answers are compared, including the awkward ones: a won deal with no
   sale price, a won deal with both, an open deal with a sale price on
   it that must be ignored, and nothing at all.

   Needs the disposable PostgreSQL. Run with `npm run check:lead-worth`.
   ============================================================= */
import { execFileSync } from 'node:child_process';
import { valueOf } from '../lib/crm/lead-value';

type Row = { status: string; sale_price: number | null; estimated_value: number | null };

/* Every shape a tracker row comes in, including the ones nobody writes
   on purpose. `customer` is still swept although migration 146 took it
   out of the column, because an old export being re-imported is exactly
   where a retired word turns up, and `parked` was never a status at
   all: the TypeScript says what it does with one and the SQL has to
   agree. */
const ROWS: Row[] = [];
for (const status of ['lead', 'contacted', 'quoted', 'won', 'customer', 'lost', 'parked']) {
  for (const sale of [null, 0, 33000]) {
    for (const estimate of [null, 0, 30000]) {
      ROWS.push({ status, sale_price: sale, estimated_value: estimate });
    }
  }
}

const sql = (q: string) => execFileSync('psql', [
  '-p', '55432', '-U', 'postgres', '-d', 'stctest', '-tAc', q,
], {
  encoding: 'utf8',
  env: { ...process.env, PGHOST: '/var/tmp/pgtest', PATH: `/usr/lib/postgresql/16/bin:${process.env.PATH}` },
});

const lit = (n: number | null) => (n === null ? 'NULL' : `${n}::NUMERIC`);

function main() {
  console.log('\n  One rule for what a deal is worth\n  --------------------------------');

  let answers: string[];
  try {
    const q = ROWS.map((r) =>
      `SELECT COALESCE(lead_worth('${r.status}', ${lit(r.sale_price)}, ${lit(r.estimated_value)})::TEXT, 'null')`)
      .join(' UNION ALL ');
    /* UNION ALL does not promise an order, so each row carries its own. */
    const ordered = ROWS.map((r, i) =>
      `SELECT ${i} AS n, COALESCE(lead_worth('${r.status}', ${lit(r.sale_price)}, ${lit(r.estimated_value)})::TEXT, 'null') AS v`)
      .join(' UNION ALL ');
    void q;
    answers = sql(`SELECT v FROM (${ordered}) t ORDER BY n`)
      .split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
  } catch {
    console.log('  skip  needs the disposable PostgreSQL on port 55432.\n');
    process.exit(0);
  }

  if (answers.length !== ROWS.length) {
    console.log(`  FAIL  asked about ${ROWS.length} rows and got ${answers.length} answers`);
    process.exit(1);
  }

  let bad = 0;
  ROWS.forEach((row, i) => {
    const ts = valueOf({ ...row, status: row.status } as Parameters<typeof valueOf>[0]);
    const mine = ts === null || ts === undefined ? 'null' : String(Number(ts));
    const theirs = answers[i] === 'null' ? 'null' : String(Number(answers[i]));
    if (mine !== theirs) {
      bad += 1;
      console.log(`  FAIL  ${row.status}, sale ${row.sale_price}, estimate ${row.estimated_value}`);
      console.log(`        lib/crm/lead-value.ts says ${mine}, lead_worth() says ${theirs}`);
    }
  });

  if (bad === 0) {
    console.log(`  ok    ${ROWS.length} combinations, and the two definitions agree on every one`);
    console.log('\n  A deal is worth the same on every screen it appears on.\n');
    process.exit(0);
  }
  console.log(`\n  ${bad} of ${ROWS.length} disagree.\n`);
  process.exit(1);
}

main();
