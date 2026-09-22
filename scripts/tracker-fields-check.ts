/* =============================================================
   The tracker asks for every field it draws, and an import keeps
   the details it was given.

   Two findings from an audit of the product:

     The initial CRM join omits source, description, category, account
     manager and vehicles. The tracker then converts those absent
     values to blanks. Saved information can appear to disappear on
     reload.

     Import finds or creates a CRM account using the company name,
     then explicitly skips the mapped account fields without saving
     them to that account. Contact names, email, phone, location and
     other supplied details are discarded while leads can still import
     successfully.

   Both are silent. Nothing throws, nothing is logged, the import
   reports success, and a salesperson watches their own typing vanish
   on refresh. Neither can be caught by reading the two files, because
   they are different files and the fault is the gap between them.

   So it is counted instead. `flatten()` in the tracker names every
   field it lifts off the joined account. The page's select names the
   columns it asks for. This asserts the first is a subset of the
   second, and that the import hands the account fields on rather than
   dropping them.

   Run with `npm run check:tracker-fields`.
   ============================================================= */
import { readFileSync } from 'node:fs';

const TRACKER = 'components/SalesTracker.tsx';
const PAGE = 'app/dashboard/leads/page.tsx';

let pass = 0;
const bad: string[] = [];
const ok = (what: string, cond: boolean, extra?: string) => {
  if (cond) { pass += 1; return; }
  bad.push(`${what}${extra ? `  (${extra})` : ''}`);
};

const tracker = readFileSync(TRACKER, 'utf8');
const page = readFileSync(PAGE, 'utf8');

/* ---- 1. Every field lifted off the account must be selected ---- */

/* `flatten` is the one function that turns a joined row into a tracker
   row, so it is the only place this can go wrong. */
const from = tracker.indexOf('function flatten(');
const to = tracker.indexOf('\n}', from);
const body = from >= 0 ? tracker.slice(from, to) : '';
ok('flatten() is still the function that shapes a tracker row', body.length > 0);

const wants = new Set<string>();
for (const m of body.matchAll(/\ba(?:ccount)?\??\.?\s*\)?\?\.\s*([a-z_][a-z0-9_]*)/gi)) {
  wants.add(m[1]);
}
for (const m of body.matchAll(/l\.account(?:\s+as\s+any\))?\s*\)?\?\.\s*([a-z_][a-z0-9_]*)/g)) {
  wants.add(m[1]);
}
wants.delete('id');

const select = page.slice(page.indexOf('account:crm_contacts'), page.indexOf(')`', page.indexOf('account:crm_contacts')));
ok('the page still joins crm_contacts on the tracker query', select.length > 0);

const selected = new Set(
  select.replace(/account:crm_contacts\s*\(/, '')
    .split(/[,\s]+/).map((w) => w.trim()).filter(Boolean),
);

for (const field of [...wants].sort()) {
  ok(
    `the query asks for "${field}", which the tracker draws`,
    selected.has(field),
    'absent from the select, so it loads as a blank and overwrites what was typed',
  );
}

/* ---- 2. The import must hand the account fields on ---- */

const commit = tracker.slice(
  tracker.indexOf('async function commitTrackerImport'),
  tracker.indexOf('\n  }', tracker.indexOf('async function commitTrackerImport')),
);
ok('commitTrackerImport is still the import', commit.length > 0);

ok(
  'the import does not silently drop the account fields',
  !/ACCOUNT_FIELDS\.has\(k\)\)\s*continue/.test(commit),
  'they are skipped on the way to the lead and written nowhere else',
);
ok(
  'the import hands the account fields to accountFor',
  /accountFor\([\s\S]*?,\s*details\s*\)/.test(commit),
  'accountFor is called without the details argument',
);
ok(
  'accountFor takes them',
  /async function accountFor\([\s\S]{0,600}?details/.test(tracker),
);
ok(
  'and fills only what is blank on an account that already exists',
  /Object\.keys\(fill\)\.length > 0/.test(tracker),
  'an import must not overwrite a number somebody has already corrected',
);

console.log('  The tracker asks for what it draws, and an import keeps what it was given');
if (bad.length) {
  for (const line of bad) console.log(`  FAIL  ${line}`);
  console.log('');
  process.exit(1);
}
console.log(`  ok    ${pass} holding`);
