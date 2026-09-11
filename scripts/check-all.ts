/* =============================================================
   Every check in this repository, in one command.

   ---- Why this exists ----

   From the business:

     I have a feeling you'll find a multitude of these same issues where
     things seem wired but are not. Things that are meant to automate,
     permissions, approvals, work alerts, tracker alerts, custom
     reminders etc. Worried none of it actually does work at a
     production automated wired level.

   That was right. Eighty three checks existed and nothing ran them all,
   so each one was only ever run by whoever was working on the thing it
   covers. Seven were failing, and one of those, `check:notify`, had
   been throwing on its second assertion since migration 067 added a
   guard to `fleetsmart_decide`. Thirty one assertions covering the
   whole notification system had not executed since.

   Two others were failing because a rename in the roles work moved
   `capabilitiesFor` to `screenCapabilities` and the checks still
   searched for the old name. Nothing said so, because nothing ran them.

   A check nobody runs is worse than no check: it is a green tick
   somebody remembers seeing.

   ---- The three groups ----

   Most checks need nothing. Some need the disposable Postgres on port
   55432. Three drive a real browser against `next dev` on port 3000.
   The last group is skipped rather than failed when the server is not
   up, and SAID to be skipped, because a check that quietly does not run
   is the thing this file exists to stop.

     npm run check:all           everything that can run here
     npm run check:all -- --sql  only the ones that need Postgres
     npm run check:all -- --list what is in each group, and run nothing
   ============================================================= */
import { execSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

type Group = 'plain' | 'sql' | 'browser';

/** The three that drive a browser against `next dev`. */
const BROWSER = new Set(['check:kit-diff', 'check:tracker-switch', 'check:crm-record', 'check:roles-render', 'check:roles-drive']);

/** Skipped for a reason that is not a defect, with that reason stated. */
const KNOWN_SKIP: Record<string, string> = {};

function scripts(): string[] {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { scripts: Record<string, string> };
  return Object.keys(pkg.scripts).filter((k) => k.startsWith('check:') && k !== 'check:all').sort();
}

function groupOf(name: string, body: string): Group {
  if (BROWSER.has(name)) return 'browser';
  return /scripts\/sql\//.test(body) ? 'sql' : 'plain';
}

function postgresUp(): boolean {
  const r = spawnSync('pg_isready', ['-h', '/var/tmp/pgtest', '-p', '55432', '-q'], { stdio: 'ignore' });
  return r.status === 0;
}

function serverUp(): boolean {
  const r = spawnSync('curl', ['-sf', '-o', '/dev/null', '--max-time', '2',
    'http://localhost:3000/'], { stdio: 'ignore' });
  return r.status === 0;
}

function main() {
  const args = process.argv.slice(2);
  const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { scripts: Record<string, string> };
  const all = scripts().map((name) => ({ name, group: groupOf(name, pkg.scripts[name]) }));

  const only = args.includes('--sql') ? 'sql' : args.includes('--plain') ? 'plain' : null;
  const wanted = only ? all.filter((c) => c.group === only) : all;

  if (args.includes('--list')) {
    for (const g of ['plain', 'sql', 'browser'] as Group[]) {
      const inGroup = all.filter((c) => c.group === g);
      console.log(`\n  ${g} (${inGroup.length})`);
      for (const c of inGroup) console.log(`    ${c.name}`);
    }
    console.log();
    return;
  }

  const pg = postgresUp();
  const web = serverUp();

  console.log(`\n  ${wanted.length} checks`);
  console.log(`  postgres on 55432: ${pg ? 'up' : 'DOWN, so the SQL checks are skipped'}`);
  console.log(`  next dev on 3000:  ${web ? 'up' : 'down, so the browser checks are skipped'}\n`);

  const failed: string[] = [];
  const skipped: string[] = [];
  let passed = 0;

  for (const c of wanted) {
    if (c.group === 'sql' && !pg) { skipped.push(c.name); continue; }
    if (c.group === 'browser' && !web) { skipped.push(c.name); continue; }
    if (KNOWN_SKIP[c.name]) { skipped.push(c.name); continue; }

    process.stdout.write(`  ${c.name.padEnd(26)}`);
    try {
      execSync(`npm run ${c.name}`, { stdio: 'pipe', timeout: 300_000 });
      console.log('ok');
      passed += 1;
    } catch {
      console.log('FAIL');
      failed.push(c.name);
    }
  }

  console.log(`\n  ${passed} passed, ${failed.length} failed, ${skipped.length} skipped`);

  if (skipped.length > 0) {
    console.log(`\n  skipped, and not because they are fine:`);
    for (const s of skipped) console.log(`    ${s}`);
    console.log(`\n  start postgres:  see scripts/sql/README.md`);
    console.log(`  start the app:   npm run dev`);
  }

  if (failed.length > 0) {
    console.log(`\n  FAILING:`);
    for (const f of failed) console.log(`    ${f}`);
    console.log(`\n  Run one on its own to see why:  npm run ${failed[0]}\n`);
    process.exit(1);
  }

  console.log();
}

main();
