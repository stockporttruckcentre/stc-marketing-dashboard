/* =============================================================
   The register in the database and the register in the code say the
   same thing.

   `lib/platform/permissions/catalog.ts` is what the interface reads to
   decide which buttons to draw. `capability_catalog` is what
   `capability_report` reads to decide what somebody actually holds, and
   `lib/api/guard.ts` asks that on every write route.

   Two lists, and nothing kept them in step. The four FleetSmart+
   capabilities were in the code and not in the database from migration
   061 until 068, so the screen offered an administrator a Save button
   and the route behind it answered "you do not have access to do that".
   That is the worst shape a permission bug takes: it looks like a
   product fault rather than a missing row.

   `guard.ts` said in a comment that `check:capabilities` asserted the
   two could not disagree. It did not exist. This is it.

   Run with `npm run check:capabilities`. It needs the disposable
   Postgres, the same one every other SQL check uses.
   ============================================================= */
import { execFileSync } from 'node:child_process';
import { CAPABILITY_CATALOG } from '../lib/platform/permissions/catalog';

const PSQL_ENV = {
  ...process.env,
  PATH: `/usr/lib/postgresql/16/bin:${process.env.PATH ?? ''}`,
  PGHOST: process.env.PGHOST ?? '/var/tmp/pgtest',
};

function query(sql: string): string[] {
  const out = execFileSync(
    'psql', ['-p', '55432', '-U', 'postgres', '-d', 'stctest', '-tAq', '-c', sql],
    { env: PSQL_ENV, encoding: 'utf8' },
  );
  return out.split('\n').map((s) => s.trim()).filter(Boolean);
}

function main() {
  let inDatabase: string[];
  try {
    inDatabase = query('SELECT key FROM capability_catalog ORDER BY key');
  } catch {
    console.error('  no test database. Build one first:  bash scripts/sql/build-test-db.sh');
    process.exit(1);
  }

  const inCode = CAPABILITY_CATALOG.map((c) => c.key).sort();
  const db = new Set(inDatabase);
  const code = new Set(inCode);

  const problems: string[] = [];

  const missingFromDb = inCode.filter((k) => !db.has(k));
  if (missingFromDb.length > 0) {
    problems.push(
      `${missingFromDb.length} capabilit${missingFromDb.length === 1 ? 'y is' : 'ies are'} in the code and not in the register, `
      + 'so every route behind them refuses everybody while the screen still offers the button:\n    '
      + missingFromDb.join('\n    '),
    );
  }

  const missingFromCode = inDatabase.filter((k) => !code.has(k));
  if (missingFromCode.length > 0) {
    problems.push(
      `${missingFromCode.length} capabilit${missingFromCode.length === 1 ? 'y is' : 'ies are'} in the register and not in the code, `
      + 'so nothing can ever grant or explain them:\n    '
      + missingFromCode.join('\n    '),
    );
  }

  /* A grant naming a capability nothing has heard of is a row that does
     nothing, and it reads in an admin screen as a permission somebody
     has been given. */
  const orphanGrants = query(`
    SELECT DISTINCT capability FROM command_capability_roles
     WHERE capability NOT IN (SELECT key FROM capability_catalog)
    ORDER BY 1`);
  if (orphanGrants.length > 0) {
    problems.push(
      `${orphanGrants.length} role grant${orphanGrants.length === 1 ? '' : 's'} name a capability the register does not have:\n    `
      + orphanGrants.join('\n    '),
    );
  }

  /* Every prerequisite has to be a real capability, or the requires
     chain the admin screen draws has a dead end in it. */
  const brokenRequires = query(`
    SELECT c.key || ' requires ' || r
      FROM capability_catalog c, unnest(c.requires) r
     WHERE r NOT IN (SELECT key FROM capability_catalog)
    ORDER BY 1`);
  if (brokenRequires.length > 0) {
    problems.push('a prerequisite points at nothing:\n    ' + brokenRequires.join('\n    '));
  }

  if (problems.length > 0) {
    console.error('\n' + problems.map((p) => '  ' + p).join('\n\n') + '\n');
    process.exit(1);
  }

  console.log(`\n  ${inCode.length}/${inCode.length} capabilities: the code and the register agree, `
    + 'every role grant names a real one, and every prerequisite resolves\n');
}

main();
