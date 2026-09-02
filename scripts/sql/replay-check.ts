/* =============================================================
   A function redefined later has to be dropped by the earlier one.

   ---- The fault, three times now ----

   The catch-up bundle is one file, and its whole promise is that
   running it twice is a no-op. On the second run the LATEST shape of
   every function is what is live, and the bundle then replays the
   EARLIEST definition first. `CREATE OR REPLACE` cannot change a return
   type, so:

     ERROR: cannot change return type of existing function

   and the whole transaction rolls back. Which means somebody catching a
   database up gets nothing at all, including the migration they were
   running it for.

   It has happened three times: ten functions when 074 was first handed
   over, one when 086 changed what `protean_jobs_without_account`
   returns, and three more when 094 changed the group functions.

   `check:bundle-twice` catches it, and catches it late and slowly: it
   builds two databases, applies five thousand lines twice, and reports
   a line number in a generated file. This is the same fault found in
   under a second, in the file that has to change, by name.

   ---- The rule ----

   Where two migrations define a function with the SAME ARGUMENT TYPES
   and a DIFFERENT RETURN, the earlier one must drop that exact
   signature before creating it.

   Same arguments matters. Where a later migration ADDS an argument, the
   earlier definition creates a second overload rather than colliding,
   and the later one's own drop clears it. That case is fine and is not
   reported.
   ============================================================= */

import { readFileSync } from 'node:fs';

type Def = {
  migration: string;
  fn: string;
  /** Argument TYPES, which is what a signature is. */
  types: string[];
  /** The whole RETURNS clause, normalised. */
  returns: string;
  /** Signatures this migration drops before that definition. */
  drops: string[][];
};

const ORDER = readFileSync('scripts/sql/order.txt', 'utf8')
  .split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));

const typesOf = (args: string): string[] =>
  args.split(/,(?![^()]*\))/)
    .map((a) => a.replace(/\s+DEFAULT[\s\S]*/i, '').trim())
    .filter(Boolean)
    .map((a) => a.split(/\s+/).pop()!.toUpperCase());

const defs: Def[] = [];

for (const migration of ORDER) {
  let sql: string;
  try {
    sql = readFileSync(`supabase/migrations/${migration}.sql`, 'utf8');
  } catch {
    console.log(`  FAIL  ${migration} is in order.txt and not on disk`);
    process.exit(1);
  }

  const creates = [...sql.matchAll(
    /CREATE (?:OR REPLACE )?FUNCTION\s+(\w+)\s*\(([\s\S]*?)\)\s*\nRETURNS\s+([\s\S]*?)\nLANGUAGE/g,
  )];

  for (const m of creates) {
    const before = sql.slice(0, m.index);
    const drops = [...before.matchAll(/DROP FUNCTION IF EXISTS\s+(\w+)\s*\(([^)]*)\)/g)]
      .filter((d) => d[1] === m[1])
      .map((d) => typesOf(d[2]!));

    defs.push({
      migration,
      fn: m[1]!,
      types: typesOf(m[2]!),
      returns: m[3]!.replace(/\s+/g, ' ').trim(),
      drops,
    });
  }
}

const same = (a: string[], b: string[]) =>
  a.length === b.length && a.every((x, i) => x === b[i]);

const problems: string[] = [];

for (let i = 0; i < defs.length; i += 1) {
  const earlier = defs[i]!;
  for (let j = i + 1; j < defs.length; j += 1) {
    const later = defs[j]!;
    if (later.fn !== earlier.fn) continue;
    if (!same(later.types, earlier.types)) continue;
    if (later.returns === earlier.returns) continue;
    /* The earlier one has to clear its OWN signature, because that is
       the one the later definition is occupying on a replay. */
    if (earlier.drops.some((d) => same(d, earlier.types))) continue;

    problems.push(
      `  ${earlier.fn}(${earlier.types.join(', ')})\n`
      + `      defined in  ${earlier.migration}  with no DROP of its own signature\n`
      + `      changed in  ${later.migration}\n`
      + `      add before the CREATE in ${earlier.migration}:\n`
      + `        DROP FUNCTION IF EXISTS ${earlier.fn}(${earlier.types.join(', ')});`,
    );
  }
}

console.log('\n  Replaying the catch-up bundle\n  -----------------------------');
console.log(`  ${defs.length} function definitions across ${ORDER.length} migrations`);

if (problems.length) {
  console.log(`\n  ${problems.length} would fail on a second run:\n`);
  for (const p of problems) console.log(`${p}\n`);
  console.log('  A bundle that fails halfway leaves the database with nothing, including\n'
    + '  the migration somebody was running it for.\n');
  process.exit(1);
}

console.log('\n  Every function that changes shape is dropped by the migration that\n'
  + '  defined it first, so the bundle survives being run again.\n');
