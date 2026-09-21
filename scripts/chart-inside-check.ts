/* =============================================================
   The chart paints inside its card.

   From the business, on a band label running off the side:

     it's allowed to load outside the bounds of its card instead of
     being forced to fully paint inside it and only go outside if i were
     to zoom or drag

   The band labels are drawn at the thickest point of each band and
   anchored in the MIDDLE. On the right hand months that puts half the
   name past the plot, where the box's own `overflow: hidden` cuts it
   mid word: "Trailer Sal".

   Two things fix it and both are asserted here. A clip path bounded to
   the plot, so nothing drawn against the data can paint outside the
   area the data occupies. And an anchor that leans away from whichever
   side the label is nearest, so a name on the last month reads back
   into the chart.

   Run with `npm run check:chart-inside`.
   ============================================================= */
import { readFileSync } from 'node:fs';

let bad = 0;
const ok = (what: string, held: boolean, why?: string) => {
  console.log(`  ${held ? 'ok  ' : 'FAIL'}  ${what}`);
  if (!held) { bad += 1; if (why) console.log(`        ${why}`); }
};
const head = (s: string) => console.log(`\n  ${s}\n  ${'-'.repeat(s.length)}`);

const SRC = 'components/analytics/legacy/monthly.tsx';
const src = readFileSync(SRC, 'utf8');

head('The axis ceiling is above the data, never below it');

/* ---- The bug that was actually spilling ----

   The chart takes its ceiling from the LAST GRIDLINE. `niceTicks` used
   to stop at the last round number that fitted UNDER the highest
   figure, so a company month of 1.2m against a 500k step gave ticks at
   0, 500k and 1m, a ceiling of 1m, and that month drawn a fifth of the
   plot's height ABOVE the plot.

   Every month over the top gridline painted outside the area the axis
   describes. Clipping hid it; it did not fix it. This is the fix, and
   it is a property rather than an example: for any figure, the top
   gridline is at or above it. */
function ticksOf(max: number, want = 4): number[] {
  if (max <= 0) return [0];
  const raw = max / want;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? mag * 10;
  const ceiling = Math.ceil(max / step) * step;
  const out: number[] = [];
  for (let v = 0; v <= ceiling + step * 0.001; v += step) out.push(v);
  return out;
}

{
  const spilled: string[] = [];
  /* Every order of magnitude a haulage company's month could be, and
     the awkward ones just over a round number. */
  for (const m of [
    1, 9, 345, 999, 1000, 1001, 9999, 12345, 99999, 100001,
    345678, 500001, 999999, 1000000, 1000001, 1200000, 1750000,
    2400000, 5000001, 9999999, 65704118.28,
  ]) {
    const t = ticksOf(m);
    const top = t[t.length - 1]!;
    if (top < m) spilled.push(`${m} tops out at ${top}`);
  }
  ok(`the top gridline sits at or above the figure, across 21 magnitudes`,
    spilled.length === 0, spilled.slice(0, 4).join(', '));

  ok('and it does not add gridlines without cause',
    ticksOf(1000000).length <= 6 && ticksOf(999999).length <= 6,
    'rounding the ceiling up costs one gridline at most, not a ladder');

  ok('zero and below still answer with a single line',
    ticksOf(0).length === 1 && ticksOf(-5).length === 1);
}

{
  const src2 = readFileSync('components/analytics/monthly.tsx', 'utf8');
  ok('and the ported chart rounds its ceiling up too',
    src2.includes('const ceiling = Math.ceil(max / step) * step'),
    'two copies of this function with two behaviours is the next bug');
}

head('Nothing drawn against the data can paint outside the plot');

ok('the source rounds the ceiling up',
  src.includes('const ceiling = Math.ceil(max / step) * step'));

ok('the chart declares a clip bounded to the plot',
  /<clipPath id=\{`plot-\$\{clipId\}`\}>/.test(src)
  && /x=\{PAD\.left\} y=\{PAD\.top\}/.test(src)
  && /width=\{inner\.w\} height=\{inner\.h\}/.test(src),
  'without a clip the only thing stopping ink leaving the plot is the '
  + 'box’s overflow, which cuts at the CARD rather than at the chart');

ok('and the band labels are drawn inside it',
  /<g clipPath=\{`url\(#plot-\$\{clipId\}\)`\}>[\s\S]*bandLabels\.map/.test(src),
  'the labels are what ran off the edge, so they are what has to be clipped');

ok('the clip id is unique per chart',
  src.includes('useId()'),
  'two charts on one page sharing an id means the second clips to the first');

head('A label near an edge reads back into the chart');

/* The decision, lifted from the source so the check cannot drift from
   what ships. Only arithmetic on values the chart already has: no
   measurement, no chosen number. */
function anchorAt(x: number, padLeft: number, innerW: number): 'start' | 'end' {
  const mid = padLeft + innerW / 2;
  return x > mid ? 'end' : 'start';
}

ok('the source decides the anchor against the plot’s own middle',
  src.includes('const mid = PAD.left + inner.w / 2')
  && src.includes("const anchor = l.x > mid ? 'end' : 'start'"),
  'anything else is a number somebody chose');

{
  const PAD_LEFT = 58;
  const W = 900;
  ok('a label on the last month is anchored at its end',
    anchorAt(PAD_LEFT + W - 1, PAD_LEFT, W) === 'end');
  ok('a label on the first month is anchored at its start',
    anchorAt(PAD_LEFT + 1, PAD_LEFT, W) === 'start');
  ok('and one just past the middle turns before it can overhang',
    anchorAt(PAD_LEFT + W / 2 + 1, PAD_LEFT, W) === 'end');
}

ok('and the drawn x is held inside the plot either way',
  src.includes('Math.min(l.x, PAD.left + inner.w)')
  && src.includes('Math.max(l.x, PAD.left)'),
  'an anchor alone still lets the start of the text sit outside');

head('The box itself still clips, and still does not grow');

ok('the chart box hides its overflow',
  /overflow: 'hidden'/.test(src),
  'this is what stops the measure-and-grow loop, and it must not be '
  + 'removed in the name of letting a label breathe');

console.log(bad === 0
  ? '\n  The chart paints inside its card, and a label near an edge turns rather than spills.\n'
  : `\n  ${bad} failed.\n`);
process.exit(bad === 0 ? 0 : 1);
