/* =============================================================
   The committed Roles kit values still match the file.

   `lib/admin/roles-kit.generated.ts` is read out of
   `docs/source/STCUIRoles.html` by a browser and committed. Committed
   is the point: components import it, so it has to be there without a
   browser. But a committed copy can drift from the file it came from,
   and a drifted copy is worse than none, because it looks generated.

   So this re-runs the extraction into a temporary file and compares.
   The kit changing is fine. The kit changing and this file not is what
   is refused.

   Run with `npm run check:roles-kit`.
   ============================================================= */
import { readFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const COMMITTED = 'lib/admin/roles-kit.generated.ts';
const TEMP = '/tmp/roles-kit-fidelity.ts';

rmSync(TEMP, { force: true });
execFileSync('npx', ['tsx', 'scripts/roles-kit-extract.ts', '--out', TEMP], { stdio: 'pipe' });

const was = readFileSync(COMMITTED, 'utf8');
const now = readFileSync(TEMP, 'utf8');

if (was === now) {
  const nodes = (was.match(/"__w"/g) ?? []).length;
  console.log(`\n  ok    the committed kit matches the file, ${nodes} boxes\n`);
  process.exit(0);
}

/* Which entries moved, rather than a diff of ten thousand lines. */
const keysOf = (s: string) => {
  const out = new Map<string, string>();
  for (const m of s.matchAll(/^ {2}"([a-zA-Z]+)": \{([\s\S]*?)^ {2}\}/gm)) out.set(m[1]!, m[2]!);
  return out;
};
const a = keysOf(was);
const b = keysOf(now);
const moved = [...b.keys()].filter((k) => a.get(k) !== b.get(k));
const gone = [...a.keys()].filter((k) => !b.has(k));
const fresh = [...b.keys()].filter((k) => !a.has(k));

console.log('\n  FAIL  the committed kit no longer matches the file.\n');
for (const k of moved) console.log(`        changed: ${k}`);
for (const k of gone) console.log(`        gone:    ${k}`);
for (const k of fresh) console.log(`        new:     ${k}`);
console.log('\n        A new kit arrived, or somebody edited the generated file.');
console.log('        Run `npm run roles-kit:extract` and commit the result.\n');
process.exit(1);
