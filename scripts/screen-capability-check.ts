/* =============================================================
   No screen decides what somebody may do from the role column.

   `profiles.role` has four values. The roles this company actually has
   are eleven, and they live in role TEMPLATES, which that column knows
   nothing about. `capabilitiesFor(profile)` reads the column, so a
   screen that calls it draws the wrong buttons for everybody on a
   template: STC Admin sits on `viewer` there and holds `revenue.import`
   through Admin, so the sidebar hid Revenue from the one person whose
   job it is.

   `screenCapabilities` asks the database, which resolves an override,
   then the template, then the column, in that order. `lib/api/guard.ts`
   calls the same function, so what a screen draws and what the route
   behind it allows cannot disagree.

   ---- Why a grep and not a type ----

   Because the wrong call compiles. Both return a set of the same
   strings, and the only difference is where the answer came from, which
   no type can carry. The mistake is invisible in review and invisible
   at runtime until somebody cannot find a screen.

   ---- The two places it is still right ----

   `Sidebar` and `CommandBar` take a resolved list as a prop and fall
   back to the role derivation when they do not get one, which is the
   preview pages that have no server to ask. `screenCapabilities` uses
   it as the base of its own merge, which is the fallback for a database
   older than this build.

   Run with `npm run check:screens`.
   ============================================================= */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

/* Comments are stripped before looking, because this file and
   `lib/api/guard.ts` both explain the rule at length and a check that
   fails on its own explanation is a check nobody keeps. The same trap
   caught `chart-colour-check` on a comment quoting a CSS variable. */
function code(file: string): string {
  return readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** Allowed to derive from the role column, and why. */
const ALLOWED = new Map<string, string>([
  ['lib/crm/permissions.ts', 'where the derivation lives'],
  ['lib/platform/permissions/resolve.ts', 'the base of the merge, for a database older than this build'],
  ['components/Sidebar.tsx', 'falls back when no resolved list is passed, for the preview pages'],
  ['components/dashboard/CommandBar.tsx', 'the same fallback'],
  ['components/CrmWorkspace.tsx', 'a client component with no server to ask, handed a profile'],
  ['app/api/admin/diag-lookup/route.ts', 'a diagnostic that reports what the column alone would say'],
]);

function main() {
  let hits: string[];
  try {
    /* The filesystem, not `git grep`. A page added and not yet
       committed is exactly the one somebody is about to get wrong. */
    hits = execFileSync('grep',
      ['-rl', '--include=*.ts', '--include=*.tsx', 'capabilitiesFor(', 'app', 'components', 'lib'],
      { encoding: 'utf8' })
      .split('\n').map((s) => s.trim()).filter(Boolean)
      .filter((f) => code(f).includes('capabilitiesFor('));
  } catch {
    /* grep exits 1 when it matches nothing, which is a pass. */
    hits = [];
  }

  const wrong = hits.filter((f) => !ALLOWED.has(f));
  const stale = [...ALLOWED.keys()].filter((f) => !hits.includes(f));

  if (wrong.length > 0) {
    console.log('\n  FAIL  these decide what somebody may do from the four value role column:\n');
    for (const f of wrong) {
      console.log(`        ${f}`);
    }
    console.log('\n        Use screenCapabilities(supabase, profile, userId) from');
    console.log('        lib/platform/permissions/resolve.ts, or requirePage for a whole screen.\n');
    process.exit(1);
  }

  if (stale.length > 0) {
    console.log('\n  FAIL  the allowed list names files that no longer call it:\n');
    for (const f of stale) console.log(`        ${f}`);
    console.log('\n        Take them out of scripts/screen-capability-check.ts.\n');
    process.exit(1);
  }

  console.log(`\n  ok    ${hits.length} files derive from the role column, and every one of them is meant to\n`);
}

main();
