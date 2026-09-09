/* =============================================================
   No analytics component may contain a design value.

   ---- The rule, and why it is shaped like this ----

   From the business, after the Analytics hub was rebuilt three times
   and was wrong the same way each time:

     Your permission has been removed now to vibecode and do your own
     thing. If you think "this chart would look better with a 3px gap
     instead" you must think "the user didn't say I could do that and
     it's not on the file, i'm banned" ... I DESIGN FIRST THEN HAND IT
     TO YOU AND YOU PORT IT IN

   A rule of the form "does this match the kit" cannot enforce that,
   because the person judging the match is the same person who wrote the
   mismatch. Every previous check had that shape and every one of them
   passed while the cohort grid differed from the kit in nineteen ways.

   So the rule is mechanical instead: a component may not contain a
   number, a hex, or an rgba. Values come out of `kit.generated.ts`,
   which is read from `docs/source/STCUIAnalytics.html` by a browser. A
   file with no literals in it cannot hold an invented one.

   ---- What counts as a design value ----

   A length in px, a bare font size or weight, a hex colour, an rgba, a
   percentage used as a colour stop. Not: array indices, date
   arithmetic, or anything outside a style.

   Run with `npm run check:invention`.
   ============================================================= */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const GOVERNED = [
  'components/AnalyticsHub.tsx',
  'components/analytics/kit/charts.tsx',
  'components/analytics/kit/frame.tsx',
  /* Added when the hub was split into a landing and six drill-downs.
     Without them the count would have "fallen" from 284 to 236 purely
     because the values moved into files nothing was watching, which is
     a ratchet measuring the wrong thing. */
  'components/analytics/sections.tsx',
  'components/analytics/landing.tsx',
  'components/analytics/DrillDown.tsx',
];

/* The one file allowed to hold values, because it IS the kit. */
const GENERATED = 'lib/analytics/kit.generated.ts';

let failed = 0;
const say = (s: string) => console.log(s);

say('\n  Values may only come from the kit\n  ---------');

if (!existsSync(GENERATED)) {
  say(`  FAIL  ${GENERATED} is missing. Run \`npm run kit:extract\`.`);
  process.exit(1);
}

/* Comments are stripped first. A comment quoting the kit's own
   measurement is documentation, and forbidding it would push the
   reasoning out of the file where nobody can check it. */
function code(src: string): string[] {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((l) => l.replace(/\/\/.*$/, ''));
}

type Hit = { file: string; line: number; text: string; why: string };
const hits: Hit[] = [];

const RULES: { why: string; re: RegExp }[] = [
  { why: 'a hex colour', re: /#[0-9A-Fa-f]{3,8}\b/ },
  { why: 'an rgba colour', re: /\brgba?\s*\(/ },
  /* A length written into a style. Matched on the property name so that
     `slice(0, 2)` and `getFullYear()` are not swept up. */
  { why: 'a length in a style', re: /\b(width|height|padding|margin|gap|top|left|right|bottom|borderRadius|borderWidth|fontSize|lineHeight|letterSpacing|strokeWidth)\s*:\s*['"]?-?\d/ },
  { why: 'a font weight', re: /\bfontWeight\s*:\s*['"]?\d/ },
  { why: 'a colour mix', re: /color-mix\s*\(/ },
];

for (const file of GOVERNED) {
  if (!existsSync(file)) { say(`  FAIL  ${file} is missing`); failed += 1; continue; }
  const lines = code(readFileSync(file, 'utf8'));
  lines.forEach((text, i) => {
    for (const r of RULES) {
      if (r.re.test(text)) hits.push({ file, line: i + 1, text: text.trim().slice(0, 96), why: r.why });
    }
  });
}

const byFile = new Map<string, Hit[]>();
for (const h of hits) byFile.set(h.file, [...(byFile.get(h.file) ?? []), h]);

/* -------------------------------------------------------------
   A ratchet, not a wall.

   There are 295 of these today. Failing outright would be the honest
   verdict and would also make the work of removing them impossible,
   because every edit to a governed file would be refused.

   So the count may fall and may never rise. A component ported to the
   kit's own values lowers its number; a value typed by hand raises it
   and is refused on the spot. The baseline is committed, so the ratchet
   cannot be loosened without it showing in a diff.
   ------------------------------------------------------------- */
const BASELINE = 'scripts/invention-baseline.json';

/* Setting the baseline is a deliberate act and happens before any
   verdict, so the first run on a file full of values can record where
   it starts instead of refusing and leaving nothing written. */
if (process.argv.includes('--accept')) {
  const next: Record<string, number> = {};
  for (const file of GOVERNED) next[file] = (byFile.get(file) ?? []).length;
  writeFileSync(BASELINE, `${JSON.stringify(next, null, 2)}\n`);
  say(`  baseline set: ${Object.entries(next).map(([f, n]) => `${f.split('/').pop()} ${n}`).join(', ')}`);
  say(`  written to ${BASELINE}\n`);
  process.exit(0);
}

const base: Record<string, number> = existsSync(BASELINE)
  ? JSON.parse(readFileSync(BASELINE, 'utf8')) : {};

let fell = false;
for (const file of GOVERNED) {
  const found = byFile.get(file) ?? [];
  const allowed = base[file] ?? 0;

  if (found.length === 0 && allowed === 0) {
    say(`  ok    ${file} holds no design values`);
  } else if (found.length > allowed) {
    failed += 1;
    say(`  FAIL  ${file} holds ${found.length}, up from ${allowed}`);
    for (const h of found.slice(0, 6)) say(`          ${h.line}: ${h.why}  ${h.text}`);
    if (found.length > 6) say(`          ... and ${found.length - 6} more`);
  } else if (found.length < allowed) {
    fell = true;
    say(`  ok    ${file} holds ${found.length}, down from ${allowed}`);
  } else {
    say(`  held  ${file} holds ${found.length}, unchanged`);
  }
}

say('\n  ---------\n');
if (failed) {
  say('  A design value was written by hand. It belongs in');
  say(`  ${GENERATED}, which \`npm run kit:extract\` reads out of`);
  say('  docs/source/STCUIAnalytics.html.\n');
  process.exit(1);
}
const total = hits.length;
if (fell) {
  say(`  ${total} left. The count fell, so update the baseline:`);
  say(`    npm run check:invention -- --accept\n`);
} else if (total > 0) {
  say(`  ${total} values still written by hand, none added.\n`);
} else {
  say('  Every value on the analytics hub comes from the kit.\n');
}

