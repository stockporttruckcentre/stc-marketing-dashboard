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
const CHART = readFileSync('components/analytics/chart.tsx', 'utf8');
const HUB = readFileSync('components/AnalyticsHub.tsx', 'utf8');

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

/* ---- 2. Charts do not borrow action or text colours ---- */
const FORBIDDEN = ['--primary', '--accent', '--text', '--text-muted', '--surface-inverse'];
/* Both shapes a fill is written in: the prop on a chart, and the entry
   in the HUE map that says which colour a division is. The narrower
   pattern only saw the prop, which is half the fills on the screen and
   the wrong half: the three division colours are the ones somebody is
   most likely to reach for an action token for. */
const fills = [
  ...HUB.matchAll(/colour[=:]\s*['"]var\((--[a-z0-9-]+)/g),
  ...HUB.matchAll(/^\s*(?:stc|trailer|rental):\s*'var\((--[a-z0-9-]+)/gm),
].map((m) => m[1]!);
if (fills.length < 4) {
  bad('the fills could not be found', `only ${fills.length} matched, so this check is not looking at the screen`);
}
const borrowed = fills.filter((f) => FORBIDDEN.includes(f));
if (borrowed.length) {
  bad('a chart is filled with an action colour',
    `${[...new Set(borrowed)].join(', ')}. Those invert between themes; a series must not.`);
} else {
  ok(`${fills.length} chart fills, none of them an action or text colour`);
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

/* ---- 5. No raw hex in the chart components ---- */
for (const [file, src] of [['chart.tsx', CHART], ['AnalyticsHub.tsx', HUB]] as const) {
  const hexes = [...src.matchAll(/#[0-9A-Fa-f]{6}\b/g)].map((m) => m[0]);
  if (hexes.length) {
    bad(`${file} holds a raw hex`, `${[...new Set(hexes)].join(', ')}. The kit takes tokens only.`);
  }
}
if (!failed) ok('no raw hex in either chart component');

console.log(
  failed === 0
    ? '\n  Charts have their own colours, and neither theme is a surprise.\n'
    : `\n  ${failed} to fix.\n`,
);
process.exit(failed === 0 ? 0 : 1);
