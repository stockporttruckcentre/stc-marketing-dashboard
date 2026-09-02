/* =============================================================
   A chart fill is not an action colour.

   ---- The bug this exists because of ----

   The company chart on Analytics was drawn with `--primary`:

     <MonthlyBars points={allMonths} colour="var(--primary)" ... />

   `--primary` is #09163A in light theme and #FFFFFF in dark, because a
   primary button on a navy ground is a white button. That inversion is
   correct for a button and catastrophic for a chart: twenty four bars,
   two hundred pixels tall, filled with pure white on a navy card. From
   the business, "the bottom bar graph is blinding".

   Nothing caught it because nothing was looking. The kit's palette is
   an action palette, so a chart needing a colour had nowhere to go but
   an action token, and the value it borrowed only misbehaves in one of
   the two themes.

   ---- What this asserts ----

   1. Every chart token exists in BOTH themes. A data colour defined
      only at :root is a light theme colour showing on a dark ground.
   2. No chart colour is an action or text token. Those invert; a
      series has to stay the same colour to stay the same series.
   3. No chart colour goes near white or near black. That is the actual
      symptom, stated as a number rather than as an opinion.
   4. Every chart colour clears a readable contrast against the surface
      of its own theme, so a division is visible and not merely present.
   5. The chart components hold no raw hex.
   ============================================================= */

import { readFileSync } from 'node:fs';

const TOKENS = readFileSync('app/kit-tokens.css', 'utf8');
/* Every file that draws data, not a hand written list of two. The list
   went stale the moment the screen was rebuilt: `monthly.tsx` and
   `sections.tsx` did not exist when this was written, and the check
   carried on passing without looking at either. */
const DRAWERS = [
  'components/analytics/chart.tsx',
  'components/analytics/monthly.tsx',
  'components/analytics/sections.tsx',
  'components/AnalyticsHub.tsx',
].map((path) => [path, readFileSync(path, 'utf8')] as const);

const ALL = DRAWERS.map(([, src]) => src).join('\n');

/** The tokens a chart is allowed to fill with. */
const WANTED = [
  'chart-stc', 'chart-trailer', 'chart-rental', 'chart-company', 'chart-empty',
];

/* The two blocks of kit-tokens.css: `:root` is the light palette, and
   the block keyed on the dark selectors is the dark one. Split on the
   selector rather than parsed, because what is being asserted is that
   each name appears on both sides of that line. */
const darkAt = TOKENS.indexOf('[data-stc-theme="dark"],');
const LIGHT = TOKENS.slice(0, darkAt);
const DARK = TOKENS.slice(darkAt, TOKENS.indexOf('/* -----', darkAt));

const SURFACE = { light: '#FFFFFF', dark: '#09163A' };

let failed = 0;
const ok = (what: string) => console.log(`  ok    ${what}`);
const bad = (what: string, why: string) => {
  console.log(`  FAIL  ${what}\n        ${why}`);
  failed += 1;
};

const valueOf = (block: string, name: string): string | null => {
  const m = block.match(new RegExp(`--${name}\\s*:\\s*(#[0-9A-Fa-f]{6})`));
  return m ? m[1]!.toUpperCase() : null;
};

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

/** Relative luminance, the WCAG definition. */
const lum = (hex: string) => {
  const [r, g, b] = rgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const contrast = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
};

console.log('\n  Chart colours\n  -------------');

/* ---- 1. Both themes ---- */
for (const name of WANTED) {
  const l = valueOf(LIGHT, name);
  const d = valueOf(DARK, name);
  if (!l) bad(`--${name}`, 'not defined in the light palette');
  else if (!d) {
    bad(`--${name}`,
      'defined in light only, so it renders a light theme colour on a dark ground');
  }
}
if (!failed) ok(`all ${WANTED.length} chart tokens are defined in both themes`);

/* ---- 2. A SERIES is not an action colour ----

   The distinction this check got wrong on its first pass at the
   rewritten screen: it flagged `--text` on the hover marker and
   `--text-subtle` on the last year line, both of which are correct.
   Those are CHROME. An axis, a gridline, the rule under the pointer and
   the dashed comparison line are all meant to follow the text colour,
   and they are meant to invert with the theme, because they are read
   against the card like text is.

   What must never invert is the colour that IDENTIFIES a series. Navy
   in light and white in dark is a fine button and a nonsense identity,
   and drawn at two hundred pixels tall it is the blinding chart this
   file is named after.

   So the rule is narrower and exactly right: the division colours come
   from the chart ramp and nowhere else, and no shape anywhere reaches
   for an action token. */
const NEVER = ['--primary', '--accent', '--accent-hover', '--surface-inverse'];

const fills = [
  ...ALL.matchAll(/(?:colour|color)\s*[=:]\s*\{?\s*['"`]var\((--[a-z0-9-]+)/g),
  ...ALL.matchAll(/(?:fill|stroke)\s*=\s*["{]\s*["']?var\((--[a-z0-9-]+)/g),
  ...ALL.matchAll(/background:\s*['"`]?var\((--[a-z0-9-]+)/g),
].map((m) => m[1]!);

if (fills.length < 10) {
  bad('the fills could not be found',
    `only ${fills.length} matched across ${DRAWERS.length} files, so this check is not `
    + 'looking at the screen. That is the failure mode this line exists for: a rewrite '
    + 'moves the drawing somewhere the pattern does not reach and the check goes quiet.');
}

const borrowed = fills.filter((f) => NEVER.includes(f));
if (borrowed.length) {
  bad('a drawn shape is filled with an action colour',
    `${[...new Set(borrowed)].join(', ')}. Those are buttons, and they invert between themes.`);
} else {
  ok(`${fills.length} drawn fills across ${DRAWERS.length} files, none an action colour`);
}

/* THE DIVISION IDENTITIES, specifically. Every HUE map on the screen,
   wherever it was copied to, has to name a chart token. */
{
  const maps = [...ALL.matchAll(/^\s*(?:stc|trailer|rental):\s*'var\((--[a-z0-9-]+)\)/gm)]
    .map((m) => m[1]!);
  if (maps.length < 3) {
    bad('the division colours could not be found',
      `${maps.length} matched, and there are three divisions`);
  }
  const off = maps.filter((c) => !c.startsWith('--chart-'));
  if (off.length) {
    bad('a division is coloured from outside the chart ramp',
      `${[...new Set(off)].join(', ')}`);
  } else {
    ok(`${maps.length} division colours, every one from the chart ramp`);
  }
}

/* ---- 3. Nowhere near white, nowhere near black ---- */
for (const theme of ['light', 'dark'] as const) {
  const block = theme === 'light' ? LIGHT : DARK;
  for (const name of WANTED) {
    const hex = valueOf(block, name);
    if (!hex) continue;
    const l = lum(hex);
    if (l > 0.75) bad(`--${name} in ${theme}`, `${hex} is close to white. This is the blinding bug.`);
    if (l < 0.02) bad(`--${name} in ${theme}`, `${hex} is close to black and will not read as a fill.`);
  }
}
const white = contrast('#FFFFFF', SURFACE.dark);
ok(`nothing approaches white, which on the dark card would sit at ${white.toFixed(1)}:1`);

/* ---- 4. Visible on the ground it is drawn on ---- */
for (const theme of ['light', 'dark'] as const) {
  const block = theme === 'light' ? LIGHT : DARK;
  for (const name of WANTED) {
    const hex = valueOf(block, name);
    if (!hex) continue;
    const c = contrast(hex, SURFACE[theme]);
    /* 2:1 against the card, not 4.5:1. A bar is a large filled shape
       rather than text, and `--chart-empty` is deliberately faint: it
       marks a month that happened and was quiet, and shouting it would
       make an empty month look like a busy one. */
    const floor = name === 'chart-empty' ? 1.3 : 2;
    if (c < floor) {
      bad(`--${name} in ${theme}`,
        `${hex} on ${SURFACE[theme]} is ${c.toFixed(2)}:1, under the ${floor}:1 this needs to read.`);
    }
  }
}
ok('every chart colour reads against the card of its own theme');

/* ---- 5. No raw hex in anything that draws ----

   `#fff` on the split strip is the one exception and is written as
   such: it is text ON a division's own colour, and every one of those
   is dark enough to need white on it in both themes. A token would be
   wrong there, because the surface it sits on is a data colour rather
   than a themed one. */
for (const [file, src] of DRAWERS) {
  const hexes = [...src.matchAll(/#[0-9A-Fa-f]{3,8}\b/g)]
    .map((m) => m[0]).filter((h) => h.toLowerCase() !== '#fff');
  if (hexes.length) {
    bad(`${file} holds a raw hex`, `${[...new Set(hexes)].join(', ')}. The kit takes tokens only.`);
  }
}
if (!failed) ok(`no raw hex across ${DRAWERS.length} files that draw`);

console.log(
  failed === 0
    ? '\n  Charts have their own colours, and neither theme is a surprise.\n'
    : `\n  ${failed} to fix.\n`,
);
process.exit(failed === 0 ? 0 : 1);
