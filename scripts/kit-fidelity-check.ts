/* =============================================================
   Am I still building from the kit, or have I drifted?

   ---- Why this exists ----

   The Analytics hub was commissioned with a UI kit attached and the
   instruction that it was "your bible". What shipped had FleetSmart+
   tiers drawn in the three DIVISION colours, an accordion nobody asked
   for, and a cohort grid that looked nothing like the one in the file.

   The root cause was not taste. It was that the kit was never saved
   into the repository. It was read once from an attachment, built from
   memory, and by the time the work was checked there was nothing left
   to check it against. Every drift after that was invisible, because
   there was no source of truth in the repo to be wrong about.

   So this file asserts two things, in order:

     1. THE SOURCE IS HERE. `docs/source/` holds the kit file for every
        surface built from one. Without it nothing below can mean
        anything, and the check says so rather than passing quietly.
     2. THE VALUES MATCH. Colours, sizes and structural facts read out
        of that file, compared against what the components do.

   ---- What it cannot do ----

   It cannot tell you the page looks right. It reads text, not pixels.
   It catches the class of failure that actually happened: a value in
   the kit and a different value in the code, and nothing in between
   noticing. Looking at the rendered page is still the job.

   Run with `npm run check:kit`.
   ============================================================= */
import { readFileSync, existsSync } from 'node:fs';

let passed = 0;
const failures: string[] = [];

function must(what: string, ok: boolean, detail?: string) {
  if (ok) { passed += 1; console.log(`  ok    ${what}`); }
  else { failures.push(detail ? `${what}\n        ${detail}` : what); console.log(`  FAIL  ${what}`); }
}

/* -------------------------------------------------------------
   1. The source is in the repo
   ------------------------------------------------------------- */
console.log('\n  The kit files themselves\n  ---------');

const SURFACES: { file: string; what: string; builds: string[] }[] = [
  {
    file: 'docs/source/STCUIAnalytics.html',
    what: 'the Analytics hub',
    builds: ['components/AnalyticsHub.tsx', 'components/analytics/kit/charts.tsx',
             'components/analytics/kit/frame.tsx'],
  },
  {
    file: 'docs/source/STCUIReports.html',
    what: 'the Reports hub',
    builds: ['components/ReportsHub.tsx'],
  },
];

for (const s of SURFACES) {
  must(`${s.what} has its kit file in docs/source`, existsSync(s.file),
    `${s.file} is missing. It was sent in chat and has to live here, or nothing `
    + 'below can check anything and the next rebuild is from memory again.');
}

if (failures.length) {
  console.log('\n  The kit is not in the repository, so there is nothing to check against.\n');
  process.exit(1);
}

/* The file arrives as a wrapper with the page escaped inside it, so the
   markup on disk reads `background:\"#C4BFBC\"` and `<\u002Fspan>`.
   Unescaped here rather than by rewriting the file, because
   `docs/source/` holds what was sent, exactly as it was sent. */
const KIT = readFileSync('docs/source/STCUIAnalytics.html', 'utf8')
  .replace(/\\u002F/gi, '/')
  .replace(/\\"/g, '"')
  .replace(/\\n/g, '\n');

/* -------------------------------------------------------------
   2. Colours, read out of the kit rather than typed here

   The legend swatches in the kit are `background:#RRGGBB"></span>Name`,
   so the file itself says which colour belongs to which series. Parsed
   rather than transcribed: a value copied by hand is a value that can
   be copied wrong, which is the whole problem this file exists for.
   ------------------------------------------------------------- */
console.log('\n  Colours the kit names\n  ---------');

const swatches = new Map<string, string>();
for (const m of KIT.matchAll(/background:(#[0-9A-Fa-f]{6})"><\/span>([A-Za-z+ ]+)</g)) {
  swatches.set(m[2]!.trim().toLowerCase(), m[1]!.toUpperCase());
}
must(`read ${swatches.size} named colours out of the kit`, swatches.size >= 3,
  'the legend markup has changed shape; the parser above needs updating');

const tokens = readFileSync('app/kit-tokens.css', 'utf8');
const lightBlock = tokens.slice(0, tokens.indexOf('[data-stc-theme="dark"],'));

/* Only the series this app actually draws from the kit. A name in the
   kit's legend that we have no token for is not a failure: the kit
   covers devices this page does not have yet. */
const MAPPED: Record<string, string> = {
  silver: 'chart-silver', gold: 'chart-gold', platinum: 'chart-platinum',
};

for (const [name, token] of Object.entries(MAPPED)) {
  const want = swatches.get(name);
  if (!want) { must(`the kit names a colour for ${name}`, false, 'not found in any legend'); continue; }
  const got = (lightBlock.match(new RegExp(`--${token}\\s*:\\s*(#[0-9A-Fa-f]{6})`, 'i')) ?? [])[1];
  must(`--${token} is the kit's ${want}`, got?.toUpperCase() === want,
    `the kit says ${want}, app/kit-tokens.css says ${got ?? 'nothing'}`);
}

/* -------------------------------------------------------------
   3. Structural facts the kit shows and the code has to honour
   ------------------------------------------------------------- */
console.log('\n  Structure the kit shows\n  ---------');

const charts = readFileSync('components/analytics/kit/charts.tsx', 'utf8');
const frame = readFileSync('components/analytics/kit/frame.tsx', 'utf8');
const hub = readFileSync('components/AnalyticsHub.tsx', 'utf8');

/* The kit's stacked columns leave a gap between bands: y=0 h=38.6,
   next band at 41.6. Read the first such column back out rather than
   asserting the number from memory. */
const cols = [...KIT.matchAll(/<rect x="(\d+)" y="([\d.]+)" width="\d+" height="([\d.]+)"/g)]
  .map((m) => ({ x: m[1]!, y: Number(m[2]), h: Number(m[3]) }));
const byX = new Map<string, { y: number; h: number }[]>();
for (const c of cols) byX.set(c.x, [...(byX.get(c.x) ?? []), { y: c.y, h: c.h }]);
const stack = [...byX.values()].find((v) => v.length >= 3)?.sort((a, b) => a.y - b.y);
const gap = stack && stack.length > 1
  ? Math.round((stack[1]!.y - (stack[0]!.y + stack[0]!.h)) * 10) / 10
  : null;

must('the kit separates stacked bands with a gap', gap != null && gap > 0,
  'no stacked column found in the kit; the rect parser above needs updating');
if (gap != null) {
  const declared = (charts.match(/export const BAND_GAP = (\d+);/) ?? [])[1];
  must(`the stack draws the kit's ${gap}px gap`, Number(declared) === Math.round(gap),
    `the kit leaves ${gap}px between bands, charts.tsx declares ${declared ?? 'none'}`);
}

/* The kit's sections are headings with their content under them. It has
   no accordion: the hub grew one, five of six sections defaulted shut,
   and the bottom of the page read as an FAQ. */
must('no accordion on the hub', !/aria-expanded/.test(frame) && !/<Fold\b/.test(hub),
  'a collapsible section is back. The kit has none, and a closed one hides the analysis.');

/* Tiers must never be drawn in a division hue. The two sets are on the
   same page, so gold in the trailer green says the book grew in a
   division rather than in a tier. */
const borrowed = [['components/AnalyticsHub.tsx', hub], ['components/analytics/kit/charts.tsx', charts]]
  .flatMap(([file, src]) => src!.split('\n')
    .map((line, i) => [file, i + 1, line] as const)
    .filter(([, , l]) => /\b(Silver|Gold|Platinum)\b/i.test(l) && /HUE\.(stc|trailer|rental)/.test(l))
    .map(([f, n, l]) => `${f}:${n}  ${l.trim()}`));
must('no tier borrows a division colour', borrowed.length === 0, borrowed.join('\n        '));

console.log('\n  ---------\n');
if (failures.length) {
  console.log(`  ${failures.length} failing:\n`);
  for (const f of failures) console.log(`  FAIL  ${f}`);
  console.log('\n  The kit is in docs/source. Read it before changing these files.\n');
  process.exit(1);
}
console.log(`  ${passed}/${passed} passing`);
console.log('  Still building from the kit, and the kit is still in the repo.\n');
