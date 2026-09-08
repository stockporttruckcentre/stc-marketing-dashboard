/* =============================================================
   Does the Reminder button fit.

   ---- The claim being checked ----

   From the business:

     on a customer's profile in the CRM, at the top, add a set reminder
     button in between generate proposal and schedule. call it
     "Reminder". It should fit without pushing the other buttons to a new
     row by default as we have room left.

   That last sentence is the whole of this file. The action row is
   `flexWrap: 'wrap'` inside a 660px drawer, so a row that has become too
   long does not error and does not look broken in the source: it starts
   a second line, the header grows by 40px, and everything below it
   moves down. Nobody notices until they see it.

   Whether it wraps depends on the rendered width of five buttons in
   Inter at 12.5px with 7px gaps, which no amount of reading the source
   will tell you. So this lays the row out in a real browser at the real
   width and reads the top edge of every button back. One line means one
   distinct top edge.

   Both states are measured, because the row USED to change length as a
   deal progressed: DocuSign appeared at "quoted" and pushed the overflow
   button onto a second line the moment Reminder joined the row. That is
   why DocuSign is now in the overflow menu, and why this file checks the
   two states are the same width rather than trusting that they are.

   Needs `npm run dev` on port 3000. Run with `npm run check:crm-record`.
   ============================================================= */
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.env.PREVIEW_URL ?? 'http://localhost:3000';

/* The browser this environment ships, which is not always the build
   Playwright would download for itself. Passing the path outright when
   the pinned one is missing is the difference between a check that runs
   and a check nobody can run. */
const CHROME = ['/opt/pw-browsers/chromium'].find((p) => existsSync(p));

let failed = 0;
const ok = (what: string, cond: boolean, why = '') => {
  if (cond) { console.log(`  ok    ${what}`); return; }
  console.log(`  FAIL  ${what}${why ? `\n        ${why}` : ''}`);
  failed += 1;
};

type Box = { label: string; top: number; left: number; right: number; width: number };

const widths: number[] = [];

async function main() {
  const browser = await chromium.launch(CHROME ? { executablePath: CHROME } : {});
  /* A laptop, because the drawer is a fixed 660px and the question is
     about what happens inside it. A wider window changes nothing here,
     which is itself worth knowing. */
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  const res = await page.goto(`${BASE}/crm-record-preview`, { waitUntil: 'networkidle' });
  if (!res || res.status() !== 200) {
    console.log(`  FAIL  the harness did not load (${res?.status() ?? 'no response'}).`);
    console.log('        start the dev server:  npm run dev');
    await browser.close();
    process.exit(1);
  }
  /* The fonts decide the widths, so measuring before they land measures
     a fallback face and answers a question nobody asked. */
  await page.evaluate(() => (document as any).fonts?.ready);

  for (const [id, what] of [
    ['row-plain', 'a fresh prospect'],
    ['row-signable', 'a quoted deal, which is the same five actions'],
  ] as [string, string][]) {
    const boxes: Box[] = await page.$$eval(`#${id} > button`, (nodes) =>
      nodes.map((n) => {
        const r = n.getBoundingClientRect();
        return {
          label: (n.textContent || '').trim() || 'More',
          top: Math.round(r.top), left: Math.round(r.left),
          right: Math.round(r.right), width: Math.round(r.width),
        };
      }));

    console.log(`\n  ${what}\n  ${'-'.repeat(what.length)}`);
    ok('the row has every button on it',
      boxes.length === 5,
      boxes.map((b) => b.label).join(', '));

    ok('Reminder sits between Generate proposal and Schedule',
      boxes[1]?.label === 'Reminder'
      && boxes[0]?.label === 'Generate proposal'
      && boxes[2]?.label === 'Schedule',
      boxes.map((b) => b.label).join(' | '));

    const lines = new Set(boxes.map((b) => b.top));
    ok('and every button is on one line',
      lines.size === 1,
      boxes.map((b) => `${b.label} @ y=${b.top} w=${b.width}`).join('\n        '));

    /* How much room is left, printed whether it passes or not. A row
       that fits by three points fits today and wraps the moment
       somebody renames a button, and that is worth knowing before it
       happens rather than after. */
    const used = boxes.length ? boxes[boxes.length - 1].right - boxes[0].left : 0;
    const room = 660 - 44 - used;
    console.log(`  note  ${used}px of row used, ${room}px spare`);
    ok('with room to spare rather than by a hair',
      room >= 8, `${room}px left`);
    widths.push(used);
  }

  /* The row is the same five actions on every record now. A row whose
     length depends on the deal's status is a row that fits until
     somebody quotes. */
  ok('and the row is the same length whatever state the deal is in',
    new Set(widths).size === 1, widths.join(' vs '));

  await browser.close();
  console.log(failed === 0
    ? '\n  The Reminder button is where it was asked for, and nothing wrapped.\n'
    : `\n  ${failed} to fix.\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
