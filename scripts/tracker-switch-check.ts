/* =============================================================
   Switching to a colleague's tracker actually switches it.

   ---- The bug ----

   From the business:

     If I set the tracker to STC Admin which has 0 records as I just
     created it, i see all of dean's leads as i'm in dean's account.

   The server read the right leads. The screen dropped them:
   `SalesTracker` seeds its rows in a `useState` initialiser, and moving
   from /dashboard/leads to /dashboard/leads?owner=X is a navigation
   within one route, so React keeps the component mounted and a state
   initialiser never runs twice. The heading said one name and the grid
   showed another person's work.

   ---- Why a browser and not a unit test ----

   Because both halves were individually correct. The query was right,
   the props were right, and the only thing that was wrong was what
   ended up on screen. A test of either half passes while the screen
   lies. So this drives the real component in a real browser, switches
   owner, and reads the rows out of the grid.

   The empty tracker is the case that was chosen deliberately: a
   colleague created five minutes ago with nothing on their tracker is
   exactly where "it is still showing Dean's" is invisible unless
   somebody counts, and it is the case the business hit.

   Needs `npm run dev` on port 3000. Run with `npm run check:tracker-switch`.
   ============================================================= */
import { existsSync } from 'node:fs';
import { chromium, type Page } from 'playwright';

const BASE = process.env.PREVIEW_URL ?? 'http://localhost:3000';
const CHROME = ['/opt/pw-browsers/chromium'].find((p) => existsSync(p));

let failed = 0;
const ok = (what: string, cond: boolean, why = '') => {
  if (cond) { console.log(`  ok    ${what}`); return; }
  console.log(`  FAIL  ${what}${why ? `\n        ${why}` : ''}`);
  failed += 1;
};

/** What is actually on screen: the heading, and the companies in the grid. */
async function readScreen(page: Page) {
  return page.evaluate(() => {
    const heading = document.querySelector('h1, h2')?.textContent?.trim() ?? '';
    /* AG Grid renders its cells into `.ag-cell`. Read the company
       column by its own field rather than by position, so a column
       added in front of it does not quietly change what is asserted. */
    const cells = [...document.querySelectorAll('[col-id="company_name"]')]
      .map((n) => (n.textContent || '').trim())
      .filter((t) => t && t !== 'Company');
    const strip = [...document.querySelectorAll('*')]
      .filter((n) => n.children.length === 0 && /^\d+$/.test((n.textContent || '').trim()))
      .map((n) => (n.textContent || '').trim());
    return { heading, companies: cells, numbers: strip };
  });
}

async function main() {
  const browser = await chromium.launch(CHROME ? { executablePath: CHROME } : {});
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  const res = await page.goto(`${BASE}/tracker-preview`, { waitUntil: 'networkidle' });
  if (!res || res.status() !== 200) {
    console.log(`  FAIL  the harness did not load (${res?.status() ?? 'no response'}).`);
    console.log('        start the dev server:  npm run dev');
    await browser.close();
    process.exit(1);
  }
  /* The grid renders after the first paint. */
  await page.waitForSelector('[col-id="company_name"]', { timeout: 10_000 });

  console.log('\n  Dean’s own tracker\n  ------------------');
  const mine = await readScreen(page);
  ok('the heading is Dean’s', /Dean/.test(mine.heading), mine.heading);
  /* Three, not four. The tracker opens on Working, and the fourth
     fixture is a won customer. The first version of this file expected
     four and was wrong about the product rather than finding a fault in
     it, which is worth leaving written down: an assertion that does not
     know what the screen is for fails for its own reasons. */
  ok('his three working leads are on the grid',
    mine.companies.length === 3, mine.companies.join(', '));
  ok('and the won one is not, because Working is where it opens',
    !mine.companies.includes('Gregory Distribution'), mine.companies.join(', '));

  console.log('\n  Switching to an empty tracker\n  -----------------------------');
  await page.click('#to-admin');
  await page.waitForFunction(() => document.querySelector('#whose')?.textContent === 'admin');
  /* Give the grid a frame to redraw. Asserting immediately would pass
     against a stale grid, which is the bug this file exists for. */
  await page.waitForTimeout(400);

  const theirs = await readScreen(page);
  /* "STC" rather than "STC Admin": the heading uses a first name, the
     way it says "Dean's leads" rather than "Dean Mann's leads". */
  ok('the heading is now theirs', /STC/.test(theirs.heading) && !/Dean/.test(theirs.heading),
    theirs.heading);

  ok('AND THE GRID IS EMPTY, which is the whole of the complaint',
    theirs.companies.length === 0,
    `still showing ${theirs.companies.length} rows: ${theirs.companies.join(', ')}`);

  ok('not one of Dean’s rows survives the switch',
    !theirs.companies.some((c) => mine.companies.includes(c)),
    theirs.companies.join(', '));

  console.log('\n  And back again\n  --------------');
  await page.click('#to-dean');
  await page.waitForFunction(() => document.querySelector('#whose')?.textContent === 'dean');
  await page.waitForSelector('[col-id="company_name"]', { timeout: 10_000 });
  await page.waitForTimeout(400);

  const back = await readScreen(page);
  ok('his leads come back',
    back.companies.length === 3, back.companies.join(', '));
  ok('and they are the same four, not a stale copy of somebody else’s',
    back.companies.every((c) => mine.companies.includes(c)), back.companies.join(', '));

  /* And the customer he won is reachable, on the tab that is for them.
     Proves the switch did not simply empty the component: the rows are
     all there and the filter is doing its job. */
  const customerChip = page.locator('button', { hasText: /^Customer/ }).first();
  await customerChip.click();
  await page.waitForTimeout(300);
  const won = await readScreen(page);
  ok('and the won customer is on the Customer tab',
    won.companies.includes('Gregory Distribution'), won.companies.join(', '));

  await browser.close();
  console.log(failed === 0
    ? '\n  The switch switches. An empty tracker shows nothing rather than the\n'
      + '  last person’s work, which is the state it was reported in.\n'
    : `\n  ${failed} to fix.\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
