/* =============================================================
   Does the action row on a CRM record fit on one line.

   ---- The claim being checked ----

   From the business:

     on a customer's profile in the CRM, at the top, add a set reminder
     button in between generate proposal and schedule. call it
     "Reminder". It should fit without pushing the other buttons to a new
     row by default as we have room left.

   That last sentence is the whole of this file. The row is
   `flexWrap: 'wrap'` inside a 660px drawer, so a row that has become too
   long does not error and does not look wrong in the source. It starts a
   second line, the header grows, and everything below it moves down.

   ---- The two ways this check was wrong before, both instructive ----

   FIRST, it measured a REBUILT row: the same `Button` components, in the
   same flex container, at what the source said the drawer's width was.
   That is a guess about the real one dressed as a measurement. It mounts
   `ContactDrawer` itself now and measures the buttons the application
   actually draws.

   SECOND, and this is the one that did damage: it measured in ONE font
   and reported the answer as if fonts were not involved. This container
   has no Inter installed and, as the note beside the @import lines in
   `globals.css` explains, the application does not load one either, so
   every label here falls back to DejaVu Sans. DejaVu is about 12% wider
   than the faces a Mac or a Windows machine falls back to. Six buttons
   came to 656px of a 615px row here and 602px there: it wrapped on the
   machine doing the checking and fit on every machine that matters, and
   DocuSign was moved off the row to fix a problem nobody had. The
   business spotted it from a screenshot.

   So the row is measured twice: once as it renders here, and once with
   Arial metrics substituted, which is what a real reader sees. The
   second one is the assertion. The first is printed as a note, because a
   check that fails on a fact about the test machine teaches people to
   ignore it.

   The right fix for the ambiguity is for the application to load the
   font it claims to use, at which point one measurement would answer
   this for everybody. That is a rebrand step and belongs to the
   business's ordering, so it is named here rather than done.

   THIRD, and this is why the margin is no longer thin: even with the
   substituted metrics right, a customer record on a real machine still
   wrapped, because 13px is inside the error bars of a scrollbar, a
   zoom level and a different system sans. The business shortened
   "Generate proposal" to "Proposal", which buys 56px and takes the
   margin from 13 to 69. A margin that survives being wrong is worth
   more than a measurement that has to be right.

   Needs `npm run dev` on port 3000. Run with `npm run check:crm-record`.
   ============================================================= */
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.env.PREVIEW_URL ?? 'http://localhost:3000';

/* The browser this environment ships, which is not the build Playwright
   would download for itself. */
const CHROME = ['/opt/pw-browsers/chromium'].find((p) => existsSync(p));

/* Metric compatible with Arial, and close enough to Helvetica and Segoe
   UI for this purpose: what the row is really laid out in on a machine
   somebody works at. */
const REAL_WORLD = '"Liberation Sans", Arial, Helvetica, sans-serif';

let failed = 0;
const ok = (what: string, cond: boolean, why = '') => {
  if (cond) { console.log(`  ok    ${what}`); return; }
  console.log(`  FAIL  ${what}${why ? `\n        ${why}` : ''}`);
  failed += 1;
};

type Row = {
  rowWidth: number;
  used: number;
  lines: number;
  labels: string[];
  widths: string;
};

async function main() {
  const browser = await chromium.launch(CHROME ? { executablePath: CHROME } : {});
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  const res = await page.goto(`${BASE}/crm-record-preview`, { waitUntil: 'networkidle' });
  if (!res || res.status() !== 200) {
    console.log(`  FAIL  the harness did not load (${res?.status() ?? 'no response'}).`);
    console.log('        start the dev server:  npm run dev');
    await browser.close();
    process.exit(1);
  }
  await page.evaluate(() => (document as any).fonts?.ready);

  const measure = async (face: string): Promise<Row> => page.evaluate((f) => {
    const row = [...document.querySelectorAll('div')].find((d) => {
      const s = getComputedStyle(d);
      return s.display === 'flex' && s.flexWrap === 'wrap'
        && d.querySelectorAll(':scope > button').length >= 4;
    }) as HTMLElement | undefined;
    if (!row) return { rowWidth: 0, used: 0, lines: 0, labels: [], widths: 'row not found' };

    for (const n of row.querySelectorAll('button')) (n as HTMLElement).style.fontFamily = f;
    row.style.fontFamily = f;

    const rr = row.getBoundingClientRect();
    const all = [...row.querySelectorAll(':scope > button')].map((n) => {
      const r = n.getBoundingClientRect();
      return {
        label: (n.textContent || '').trim() || 'More',
        w: Math.round(r.width), top: Math.round(r.top), right: Math.round(r.right),
      };
    });
    return {
      rowWidth: Math.round(rr.width),
      used: all.length ? Math.round(all[all.length - 1].right - rr.left) : 0,
      lines: new Set(all.map((x) => x.top)).size,
      labels: all.map((x) => x.label),
      widths: all.map((x) => `${x.label} ${x.w}`).join(', '),
    };
  }, face);

  /* As it renders here, before anything is substituted. Printed rather
     than asserted: it is a fact about this container's fonts. */
  const local = await measure('');
  console.log('\n  On this machine, where the fallback is DejaVu Sans\n'
    + '  ------------------------------------------------');
  console.log(`  note  ${local.used}px used of ${local.rowWidth}px, ${local.lines} line(s)`);
  console.log(`  note  ${local.widths}`);
  if (local.lines > 1) {
    console.log('  note  it wraps here, and that is a fact about this container rather');
    console.log('        than about the product. See the header of this file.');
  }

  const real = await measure(REAL_WORLD);
  console.log('\n  On the metrics a reader actually has\n  ------------------------------------');

  ok('the drawer is the width the source says it is',
    real.rowWidth >= 600 && real.rowWidth <= 640, `${real.rowWidth}px`);

  ok('the row carries every action, DocuSign included',
    real.labels.length === 6, real.labels.join(', '));

  ok('Reminder sits between the proposal button and Schedule',
    real.labels[0] === 'Proposal'
    && real.labels[1] === 'Reminder'
    && real.labels[2] === 'Schedule',
    real.labels.join(' | '));

  ok('and every button is on one line',
    real.lines === 1, `${real.lines} lines: ${real.widths}`);

  const spare = real.rowWidth - real.used;
  console.log(`  note  ${real.used}px used of ${real.rowWidth}px, ${spare}px spare`);
  console.log(`  note  ${real.widths}`);

  /* The margin is thin and it is thin for a reason worth naming: with
     no font of its own, this row is as wide as the reader's machine
     decides. Ten points is roughly one character. */
  ok('with a margin rather than to the pixel',
    spare >= 8, `${spare}px left, which is about one character`);

  await browser.close();
  console.log(failed === 0
    ? `\n  Six actions on one line, ${spare}px to spare, which is enough to survive\n`
      + '  a scrollbar, a zoom level and a machine whose sans is wider than this one.\n'
    : `\n  ${failed} to fix.\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
