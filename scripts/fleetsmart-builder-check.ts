/* =============================================================
   The tachograph, on the screen, with the number beside it.

   From the sales team, and confirmed by the business:

     check tacho graph in fleetsmart+, adding one to an asset doesnt
     update the cost?

   and then, having put van rates into the rate editor:

     actually i cant add it to this gold contract as an extra, it
     doesnt add any cost at all

   `check:fleetsmart-ratecard` holds the arithmetic and the rule that no
   screen prices on the shipped card by accident. Neither of those is
   what was reported. What was reported is a control that moves and a
   figure that does not, and the only way to see that is to move the
   control and read the figure.

   So this opens the builder, reads the monthly total, changes the
   tachograph on a van, and reads it again.

   Needs `npm run dev` on port 3000. Run with `npm run check:fleetsmart-builder`.
   ============================================================= */
import { chromium, type Page } from 'playwright';

const AT = 'http://localhost:3000/fleetsmart-builder-preview';

let bad = 0;
const ok = (what: string, held: boolean, why?: string) => {
  console.log(`  ${held ? 'ok  ' : 'FAIL'}  ${what}`);
  if (!held) { bad += 1; if (why) console.log(`        ${why}`); }
};
const head = (s: string) => console.log(`\n  ${s}\n  ${'-'.repeat(s.length)}`);

/**
 * Every money figure on the Fleet step, added up.
 *
 * The step shows a figure per asset and a total, and which of them is
 * "the" number depends on the row that is open. Adding them is the one
 * reading that cannot be fooled by the layout moving, and it answers
 * the only question being asked: did the price change.
 */
async function money(page: Page): Promise<number> {
  const text = await page.locator('body').innerText();
  const all = text.match(/£\s?[\d,]+\.\d{2}/g) ?? [];
  return all.reduce((n, m) => n + Number(m.replace(/[£,\s]/g, '')), 0);
}

/** The Fleet step, with this asset's Options panel open. */
async function openRow(page: Page, reg: string) {
  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('button'))
      .find((x) => (x.textContent ?? '').trim() === 'Fleet');
    b?.click();
  });
  await page.waitForTimeout(500);

  /* The tachograph lives behind Options, and there is one Options per
     row. The rows carry their registration in a text input, so the
     right button is the one in the same row as that input. */
  const found = await page.evaluate((want) => {
    const input = Array.from(document.querySelectorAll('input'))
      .find((i) => (i as HTMLInputElement).value === want);
    if (!input) return false;
    let node: HTMLElement | null = input as HTMLElement;
    for (let up = 0; up < 8 && node; up += 1) {
      const options = Array.from(node.querySelectorAll('button'))
        .find((b) => (b.textContent ?? '').trim() === 'Options');
      if (options) { (options as HTMLButtonElement).click(); return true; }
      node = node.parentElement;
    }
    return false;
  }, reg);
  await page.waitForTimeout(500);
  return found;
}

/** The tachograph select on whatever row is open. */
function tacho(page: Page) {
  return page.locator('select').filter({ has: page.locator('option[value="Smart"]') }).first();
}

async function main() {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const ctx = await browser.newContext({ viewport: { width: 1700, height: 1080 } });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  try {
    /* =============================================================
       On a card that prices a van tachograph, the number moves.
       ============================================================= */
    head('A van, on a rate card with van tachograph rates on it');

    await page.goto(AT, { waitUntil: 'networkidle' });
    await page.waitForTimeout(700);
    ok('the van row opens', await openRow(page, 'VAN 1'),
      'no Options button beside VAN 1, so nothing below is testing anything');

    const control = tacho(page);
    ok('the tachograph control is on the van row', (await control.count()) > 0);
    ok('and it is not disabled, because the card prices one',
      !(await control.isDisabled()),
      'the card has van rates on it and the control is still shut');

    const before = await money(page);
    ok('there is a figure on screen to move', before > 0, `the figures added up to ${before}`);

    await control.selectOption('2yr');
    await page.waitForTimeout(700);
    const after = await money(page);

    ok('adding a tachograph to the van changes the cost', after > before,
      `it was £${before} and it is £${after}. This is the fault as it was reported.`);

    /* =============================================================
       And on a card that prices none, the control says so rather than
       moving and doing nothing.
       ============================================================= */
    head('The same van, on a card with no van tachograph rate');

    await page.goto(`${AT}?card=shipped`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(700);
    ok('the van row opens on the shipped card too', await openRow(page, 'VAN 1'));

    const shut = tacho(page);
    ok('the control is disabled', await shut.isDisabled(),
      'it can still be changed, and changing it would move nothing');

    const why = await shut.getAttribute('title');
    ok('and it says what would have to change', (why ?? '').length > 20,
      `its title is ${JSON.stringify(why)}`);
    ok('and names the rate card as the place to change it',
      (why ?? '').toLowerCase().includes('rate card'));

    /* =============================================================
       The truck, which always worked, still works.
       ============================================================= */
    head('And the truck, which was never the problem');

    await page.goto(AT, { waitUntil: 'networkidle' });
    await page.waitForTimeout(700);
    ok('the truck row opens', await openRow(page, 'HGV 1'));

    const hgv = tacho(page);
    ok('the control is open on a truck', !(await hgv.isDisabled()));
    const was = await money(page);
    await hgv.selectOption('Smart');
    await page.waitForTimeout(700);
    const now = await money(page);
    ok('and moving it to Smart DTCO costs more', now > was,
      `the figures added up to ${was} and then to ${now}`);

    head('Nothing threw while any of that happened');
    ok('no page errors', errors.length === 0, errors.slice(0, 3).join('\n        '));
  } finally {
    await browser.close();
  }

  console.log(bad === 0
    ? '\n  A tachograph put on an asset changes the price, or says why it cannot.\n'
    : `\n  ${bad} failed.\n`);
  process.exit(bad === 0 ? 0 : 1);
}

void main();
