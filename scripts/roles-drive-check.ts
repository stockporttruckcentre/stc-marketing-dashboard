/* =============================================================
   Every control on the Roles screen, pressed, with what it did
   asserted.

   From the business:

     You aren't working for my review, you're my builder and auditor.
     [...] this is an issue with your hallucination in thinking you have
     just shipped me a production ready page, but it wasn't wired. This
     is because you didn't run a full-scale agentic audit testing
     everything possible on the page.

   Correct. Rendering a screen proves it draws. Reading the source
   proves a handler exists. Neither proves that pressing the thing does
   what its label says, and that is the gap this closes: a browser
   opens the screen and drives it, control by control, asserting the
   consequence each time.

   It also proves the things that only show up in a real browser: that a
   preference survives a reload, that a disabled control says why, and
   that no two views are on screen at once.

   Needs `npm run dev` on port 3000. Run with `npm run check:roles-drive`.
   ============================================================= */
import { chromium, type Page } from 'playwright';

const URL = 'http://localhost:3000/roles-preview';

let bad = 0;
const ok = (what: string, held: boolean, why?: string) => {
  console.log(`  ${held ? 'ok  ' : 'FAIL'}  ${what}`);
  if (!held) { bad += 1; if (why) console.log(`        ${why}`); }
};
const head = (s: string) => console.log(`\n  ${s}\n  ${'-'.repeat(s.length)}`);

/* Any VISIBLE match, not the first match. The inspector renders a panel
   per role and hides all but one, so `first()` would answer about a
   hidden one and quietly pass. */
const vis = async (p: Page, sel: string) => (await p.locator(`${sel}:visible`).count()) > 0;

async function main() {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const ctx = await browser.newContext({ viewport: { width: 1700, height: 1100 } });
  await ctx.addCookies([{ name: 'stc_theme', value: 'light', url: 'http://localhost:3000' }]);
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  try {
    await page.goto(URL, { waitUntil: 'networkidle', timeout: 90_000 });
  } catch {
    console.log(`\n  The preview is not running at ${URL}.\n  Start it:  npm run dev\n`);
    process.exit(1);
  }

  head('It opens');
  ok('with no page error', errors.length === 0, errors.slice(0, 2).join(' | '));
  ok('on the chart view', await vis(page, '.vw-chart'));
  ok('with the grid and matrix hidden', !(await vis(page, '.vw-grid')) && !(await vis(page, '.vw-matrix')));

  /* ---- The view switcher ---- */
  head('The three views switch, and only one is ever up');
  for (const view of ['grid', 'matrix', 'chart'] as const) {
    await page.click(`[data-vt="${view}"]`);
    await page.waitForTimeout(150);
    const up = await Promise.all(['chart', 'grid', 'matrix'].map((v) => vis(page, `.vw-${v}`)));
    ok(`${view} shows, and it is the only one`, up.filter(Boolean).length === 1 && up[['chart', 'grid', 'matrix'].indexOf(view)]);
    const lit = await page.evaluate(`getComputedStyle(document.querySelector('[data-vt="${view}"]')).backgroundColor`);
    const other = await page.evaluate(`getComputedStyle(document.querySelector('[data-vt="${view === 'chart' ? 'grid' : 'chart'}"]')).backgroundColor`);
    ok(`the ${view} tab is the lit one`, lit !== other, `${String(lit)} vs ${String(other)}`);
  }

  /* ---- The preference survives ---- */
  head('The chosen view is remembered');
  await page.click('[data-vt="matrix"]');
  await page.waitForTimeout(150);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  ok('matrix is still up after a reload', await vis(page, '.vw-matrix'));
  await page.click('[data-vt="chart"]');
  await page.waitForTimeout(150);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  ok('and chart is, once chosen again', await vis(page, '.vw-chart'));

  /* ---- Selection ---- */
  head('Selecting a role moves all three regions together');
  await page.click('[data-vt="chart"]');
  await page.waitForTimeout(150);
  await page.click('[data-list="sales_rep"]');
  await page.waitForTimeout(200);
  ok('the rail row selects it', await page.evaluate(`(document.querySelector('input.sn-in:checked')||{}).id === 'sn-sales_rep'`));
  ok('the inspector shows that role and no other',
    (await page.locator('.sp:visible').count()) === 1 && await vis(page, '.sp-sales_rep'));
  const ring = await page.evaluate(`getComputedStyle(document.querySelector('label[for="sn-sales_rep"]')).outlineStyle`);
  ok('the chart node is ringed', ring === 'solid', String(ring));

  /* ---- The inspector tabs ---- */
  head('The inspector tabs switch');
  for (const [label, probe] of [['People', '.r-8c'], ['History', '.r-8i'], ['Permissions', '.r-1p']] as const) {
    await page.click(`.sp-sales_rep .r-1m span:text-is("${label}")`);
    await page.waitForTimeout(150);
    ok(`${label} shows its own body`, await vis(page, `.sp-sales_rep ${probe}`));
  }

  /* ---- The editor ---- */
  head('Edit permissions opens, changes and counts');
  await page.click('.sp-sales_rep .r-1w');
  await page.waitForTimeout(250);
  ok('the modal opens', await vis(page, '.r-3z'));
  ok('with no unsaved-change chip yet', (await page.locator('.r-87').count()) === 0);
  await page.click('.r-3z .r-5o > div:nth-child(2) .r-39 span:last-child');
  await page.waitForTimeout(150);
  ok('changing a verdict marks the row changed', await vis(page, '.r-8a'));
  ok('and counts it in the header', (await page.locator('.r-87').textContent())?.includes('1 unsaved change') === true);
  ok('and on the save button', (await page.locator('.r-31').last().textContent())?.includes('Save 1 change') === true);
  await page.click('.r-3z .r-43 .r-3g');
  await page.waitForTimeout(150);
  ok('Discard puts it back', (await page.locator('.r-87').count()) === 0);
  const filtered = await (async () => {
    await page.fill('.r-3z .r-36', 'export');
    await page.waitForTimeout(150);
    return page.locator('.r-3z .r-5o > div').count();
  })();
  ok(`the filter narrows the list (${filtered} rows)`, filtered > 0 && filtered < 12);
  await page.click('.r-3z .r-40 .r-w');
  await page.waitForTimeout(200);
  ok('the close button closes it', !(await vis(page, '.r-3z')));

  /* ---- The role menu ---- */
  head('The role menu opens and gates what it offers');
  await page.click('.sp-sales_rep .r-w');
  await page.waitForTimeout(200);
  ok('it opens', await vis(page, '.r-9m'));
  ok('Delete is disabled and says why',
    (await page.locator('.r-9m .r-9p:has-text("Delete role")').getAttribute('title'))?.length ? true : false);
  await page.click('.r-9m span:text-is("Edit permissions")');
  await page.waitForTimeout(250);
  ok('Edit permissions from the menu opens the editor', await vis(page, '.r-3z'));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  ok('Escape closes the editor', !(await vis(page, '.r-3z')));

  /* ---- Compare ---- */
  head('Compare');
  await page.click('.sp-sales_rep .r-x');
  await page.waitForTimeout(150);
  await page.click('label[for="sn-office_admin"] [data-for]', { modifiers: ['Shift'] });
  await page.waitForTimeout(250);
  ok('shift-clicking a second role opens the comparison', await vis(page, '.r-92'));
  const diffs = await page.locator('.r-92:visible .r-48').count();
  ok(`it lists the rows that differ (${diffs})`, diffs > 0);
  ok('the selection did not move', await page.evaluate(`(document.querySelector('input.sn-in:checked')||{}).id === 'sn-sales_rep'`));
  ok('exactly one comparison exists in the document', (await page.locator('.r-92').count()) === 1);
  await page.click('.r-92 .r-98');
  await page.waitForTimeout(200);
  ok('closing it puts the tabs back', !(await vis(page, '.r-92')) && await vis(page, '.sp-sales_rep .r-1m'));

  /* ---- The grid ---- */
  head('The grid filters, sorts and opens');
  await page.click('[data-vt="grid"]');
  await page.waitForTimeout(200);
  const allRows = await page.locator('.vw-grid .r-22').count();
  await page.fill('.vw-grid .r-36', 'sales');
  await page.waitForTimeout(200);
  const someRows = await page.locator('.vw-grid .r-22').count();
  ok(`the filter narrows it (${allRows} to ${someRows})`, someRows > 0 && someRows < allRows);
  ok('and the count says so', (await page.locator('.vw-grid .r-4x').textContent())?.includes(`Showing ${someRows}`) === true);
  await page.fill('.vw-grid .r-36', '');
  await page.waitForTimeout(200);
  const before = await page.locator('.vw-grid .r-22 .r-24').first().textContent();
  await page.click('.vw-grid .r-3b:nth-of-type(2)');
  await page.waitForTimeout(200);
  const after = await page.locator('.vw-grid .r-22 .r-24').first().textContent();
  ok('the holders chip reorders the rows', before !== after, `${before} then ${after}`);
  await page.click('.vw-grid .r-22 .r-28');
  await page.waitForTimeout(250);
  ok('Open selects that role and returns to the chart',
    await vis(page, '.vw-chart') && (await page.locator('.sp:visible').count()) === 1);

  /* ---- The matrix ---- */
  head('The matrix draws a cell per area and narrows to one');
  await page.click('[data-vt="matrix"]');
  await page.waitForTimeout(200);
  const cols = await page.locator('.vw-matrix .r-8z .r-2o').count();
  const cells = await page.locator('.vw-matrix .r-20').first().locator('.r-7').count();
  ok(`its header and its rows agree on the column count (${cols} and ${cells})`, cols === cells && cols > 0);
  await page.click('.vw-matrix .r-8w');
  await page.waitForTimeout(200);
  const oneCol = await page.locator('.vw-matrix .r-8z .r-2o').count();
  ok(`the group chip narrows it to one (${oneCol})`, oneCol === 1);

  /* ---- Zoom ---- */
  head('Zoom');
  await page.click('[data-vt="chart"]');
  await page.waitForTimeout(200);
  const zoomText = () => page.locator('.r-6s').first().textContent();
  const z0 = await zoomText();
  await page.click('.r-6r button:last-child');
  await page.waitForTimeout(150);
  const z1 = await zoomText();
  ok(`the plus button zooms in (${z0} to ${z1})`, z1 !== z0);
  await page.click('.r-6r button:first-child');
  await page.waitForTimeout(150);
  ok('and the minus button comes back', (await zoomText()) === z0);
  await page.click('.roles-canvas .r-6l > .r-x');
  await page.waitForTimeout(250);
  const zf = await zoomText();
  ok(`Fit chooses a zoom (${zf})`, typeof zf === 'string' && /%$/.test(zf));
  /* Ctrl and scroll, between 50 and 150 per cent, which is what the
     behaviour document specifies and what a trackpad actually sends. */
  await page.mouse.move(700, 500);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -240);
  await page.keyboard.up('Control');
  await page.waitForTimeout(200);
  ok(`ctrl and scroll zooms too (${zf} to ${await zoomText()})`, (await zoomText()) !== zf);
  const pct = Number((await zoomText())!.replace('%', ''));
  ok(`and stays inside the 50 to 150 the spec names (${pct}%)`, pct >= 50 && pct <= 150);
  await page.waitForTimeout(600);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  ok(`the zoom is remembered too (${await zoomText()})`, (await zoomText()) === `${pct}%`);

  /* ---- Everything disabled explains itself ---- */
  head('Nothing is disabled without saying why');
  const mute = await page.evaluate(`(() => {
    const out = [];
    for (const el of document.querySelectorAll('.r-62 button')) {
      if (!el.disabled) continue;
      if (!el.getAttribute('title')) out.push(el.textContent.trim().slice(0, 40) || '(icon only)');
    }
    return out;
  })()`) as string[];
  ok('every disabled control carries a reason', mute.length === 0, mute.join(', '));

  head('And nothing broke while we did all that');
  ok('no page error through the whole run', errors.length === 0, errors.slice(0, 3).join(' | '));

  await page.screenshot({ path: '/tmp/roles-drive.png', fullPage: true });
  await browser.close();
  if (bad > 0) { console.log(`\n  ${bad} failed. Screenshot: /tmp/roles-drive.png\n`); process.exit(1); }
  console.log('\n  Every control on the Roles screen was pressed and did what it says.\n');
}

main().catch((e) => { console.error(e); process.exit(1); });
