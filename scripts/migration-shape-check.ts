/* =============================================================
   A function that returns a TABLE is dropped before it is recreated.

   From the business, pasting migration 106 into the SQL editor:

     ERROR: 42P13: cannot change return type of existing function
     DETAIL: Row type defined by OUT parameters is different.
     HINT: Use DROP FUNCTION crm_enrichment_plan(jsonb) first.

   `CREATE OR REPLACE FUNCTION` can change a function's body, its
   volatility and its search path. It cannot change the shape of what it
   returns. So the first migration that adds a column to a `RETURNS
   TABLE` fails, on the live database, at the moment somebody presses
   Run.

   ---- Why nothing here caught it ----

   Every SQL check in this repository builds a database from nothing and
   then runs the migrations in order. A function is therefore always
   created for the first time, and its shape has never been anything
   else. `bundle-twice-check` runs the bundle twice, which sounds like
   the same thing and is not: the second pass replaces a function that
   already has the new shape.

   Nothing tests a migration as an UPGRADE over the version actually
   deployed, which is the only place this fails. Building that would
   mean keeping a copy of every previously shipped state. This is the
   cheap version: the rule is enforced on the text, so the mistake
   cannot be written rather than being caught after it is.

   ---- The grandfathered list ----

   `scripts/returns-table-baseline.json` holds the forty one that were
   already like this when the rule arrived. None of them is broken: a
   function whose shape has never changed replaces itself quite happily.
   Every one of them is a landmine for whoever adds a column to it, so
   the list may only shrink, and adding to it is refused.

   Run with `npm run check:migrations`.
   ============================================================= */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const DIR = 'supabase/migrations';
const BASELINE = 'scripts/returns-table-baseline.json';

type Finding = { file: string; fn: string; key: string };

/** Every `CREATE OR REPLACE FUNCTION x(...) RETURNS TABLE` with no DROP before it. */
function scan(file: string): Finding[] {
  const src = readFileSync(join(DIR, file), 'utf8');
  const out: Finding[] = [];

  const create = /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+([a-z_][a-z0-9_]*)\s*\(/gi;
  let m: RegExpExecArray | null;
  while ((m = create.exec(src)) !== null) {
    const fn = m[1];
    /* The FIRST `RETURNS` after the name. Searching further finds the
       next function in the file and calls a scalar one a table. */
    const returns = /\bRETURNS\s+(\w+)/i.exec(src.slice(m.index, m.index + 3000));
    if (!returns || returns[1].toUpperCase() !== 'TABLE') continue;

    const dropped = new RegExp(
      `DROP\\s+FUNCTION\\s+IF\\s+EXISTS\\s+${fn}\\s*\\(`, 'i',
    ).test(src.slice(0, m.index));
    if (!dropped) out.push({ file, fn, key: `${file}::${fn}` });
  }
  return out;
}

function main() {
  const files = readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();
  const found = files.flatMap(scan);

  const baseline = JSON.parse(readFileSync(BASELINE, 'utf8')) as { grandfathered: string[] };
  const allowed = new Set(baseline.grandfathered);

  const fresh = found.filter((f) => !allowed.has(f.key));
  /* A name in the list that no longer matches means somebody fixed one.
     Good, and the list has to be trimmed or it stops meaning anything. */
  const stale = [...allowed].filter((k) => !found.some((f) => f.key === k));

  if (fresh.length > 0) {
    console.log('\n  FAIL  these return a TABLE and are not dropped first:\n');
    for (const f of fresh) console.log(`        ${f.file}  ${f.fn}`);
    console.log('\n        Put this above each one:');
    console.log(`          DROP FUNCTION IF EXISTS ${fresh[0].fn}(<its argument types>);`);
    console.log('\n        Without it, the first migration that adds a column to the');
    console.log('        return fails on the live database with 42P13, and passes');
    console.log('        every check here, because the test server is built fresh.\n');
    process.exit(1);
  }

  if (stale.length > 0) {
    console.log('\n  FAIL  the grandfathered list names functions that are now fine:\n');
    for (const k of stale) console.log(`        ${k}`);
    console.log(`\n        Take them out of ${BASELINE}. The list may only shrink.\n`);
    process.exit(1);
  }

  console.log(`\n  ok    ${found.length} functions return a TABLE, `
    + `${allowed.size} grandfathered and none added\n`);
}

main();
