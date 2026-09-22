/* =============================================================
   Nothing decides what somebody may do from their old role name.

   An audit of the product found the same fault four times over:

     Revoking stock.edit does not stop legacy sales/marketing users
     editing stock. Both the screen and database policy check their
     old role.

     The brand.manage toggle does not control this page's editing.

     Refresh visibility checks the old role, while the endpoint checks
     marketing.edit.

   Every one of them is the same shape. A screen or a policy asks
   `role === 'admin' || role === 'marketer'` instead of asking the
   capability, so the Roles tab draws a control over a thing that is
   not listening. Granting does nothing. Revoking does nothing. The tab
   lies in both directions at once.

   That cannot be caught by reading, because the person writing the
   role check is the person deciding it is fine. So it is counted.

   `scripts/legacy-roles-baseline.json` holds how many of these each
   file still has. THE NUMBER MAY FALL AND MAY NEVER RISE. Existing
   ones can be migrated at whatever pace suits; a newly typed one is
   refused on the spot.

   A role name is still legitimate for things that are not permission
   decisions: a label, a default, a seed, a filter on whose work to
   show. So this counts only the shapes that DECIDE, and the baseline
   carries the rest until somebody looks at them.

   Run with `npm run check:legacy-roles`.
   ============================================================= */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';

const BASELINE = 'scripts/legacy-roles-baseline.json';

/* A permission decision, not a mention. `canEdit = role === 'admin'`,
   `const mayX = role !== 'viewer'`, and the policy form. */
const DECIDES: RegExp[] = [
  /\b(?:const|let|var)\s+(?:can|may|is|has|allow)[A-Za-z0-9_]*\s*(?:: *[A-Za-z<>[\]| ]+)?=\s*[^;\n]*\brole\s*[!=]==/,
  /\b(?:can|may|allow)[A-Za-z0-9_]*\s*=\s*[^;\n]*\brole\s*[!=]==/,
];

const POLICY = /CREATE\s+POLICY[\s\S]{0,400}?current_role_safe\s*\(/gi;

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
    .replace(/^\s*--[^\n]*$/gm, '');
}

function files(): string[] {
  /* Directory pathspecs, not globs. A double star glob for tsx files
     under components matches nothing at the TOP level of that folder,
     so the first cut of this check scanned no components at all and
     cheerfully reported everything was fine. Naming the directories
     and filtering by extension here cannot do that. */
  const out = execSync(
    'git ls-files app components lib supabase',
    { encoding: 'utf8' },
  );
  return out.split('\n')
    .filter(Boolean)
    .filter((f) => /\.(tsx?|sql)$/.test(f));
}

function countIn(path: string): number {
  if (!existsSync(path)) return 0;
  const src = stripComments(readFileSync(path, 'utf8'));

  if (path.endsWith('.sql')) {
    return (src.match(POLICY) ?? []).length;
  }

  let n = 0;
  for (const line of src.split('\n')) {
    if (DECIDES.some((re) => re.test(line))) n += 1;
  }
  return n;
}

const found: Record<string, number> = {};
for (const f of files()) {
  const n = countIn(f);
  if (n > 0) found[f] = n;
}

const writing = process.argv.includes('--write');
const base: Record<string, number> = existsSync(BASELINE)
  ? JSON.parse(readFileSync(BASELINE, 'utf8'))
  : {};

if (writing) {
  writeFileSync(BASELINE, `${JSON.stringify(found, null, 2)}\n`);
  const total = Object.values(found).reduce((a, b) => a + b, 0);
  console.log(`  baseline written: ${total} legacy role decision(s) across ${Object.keys(found).length} file(s)`);
  process.exit(0);
}

let bad = 0;
const rose: string[] = [];
const fell: string[] = [];

for (const [file, n] of Object.entries(found)) {
  const was = base[file] ?? 0;
  if (n > was) { rose.push(`  ${file}: ${was} -> ${n}`); bad += 1; }
  else if (n < was) fell.push(`  ${file}: ${was} -> ${n}`);
}
for (const [file, was] of Object.entries(base)) {
  if (!(file in found) && was > 0) fell.push(`  ${file}: ${was} -> 0`);
}

console.log('  Nothing decides what somebody may do from their old role name');
if (fell.length) {
  console.log('  ok    these went down:');
  for (const line of fell) console.log(`  ${line}`);
}
if (rose.length) {
  console.log('  FAIL  a legacy role decision was added:');
  for (const line of rose) console.log(`  ${line}`);
  console.log('');
  console.log('  Ask the capability instead. The Roles tab governs capabilities,');
  console.log('  so a role name here is a control that does nothing when granted');
  console.log('  and nothing when revoked.');
  console.log('');
  console.log('  Genuinely not a permission decision? Run:');
  console.log('    npx tsx scripts/legacy-roles-check.ts --write');
  console.log('  and say in the commit why the count went up.');
  process.exit(1);
}

const total = Object.values(found).reduce((a, b) => a + b, 0);
console.log(`  ok    ${total} left, and the count may only fall`);
if (bad === 0) process.exit(0);
