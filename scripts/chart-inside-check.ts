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

head('Nothing drawn against the data can paint outside the plot');

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
