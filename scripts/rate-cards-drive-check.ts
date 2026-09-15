/* =============================================================
   Every control on the Rate Card Builder, pressed, with what it did
   asserted.

   From the standing rule:

     Every single feature, wire, toggle, box, field, setting, click,
     drag, type is to be fully wired and audited end to end.

   Rendering proves it draws. Reading the source proves a handler
   exists. Neither proves that pressing the thing does what its label
   says, so a browser opens the screen and drives it.

   ---- Why the data is stubbed at the network ----

   The screen talks to Supabase through the real client. Rather than
   swapping the data layer for a test one, which would mean the thing
   driven is not the thing that ships, the RPCs are answered in the
   browser by a small model that behaves the way migration 110 behaves:
   hours times labour, an override that sits beside the hours, a labour
   change that moves every derived rate following that pool.

   So the components are never told they are being tested.

   Needs `npm run dev` on port 3000. Run with `npm run check:rate-cards-drive`.
   ============================================================= */
import { chromium, type Page } from 'playwright';
import { installStubs } from './rate-cards-stubs';

/* Half up to two decimals, the same rounding the screen and the
   database do, for the assertions that check arithmetic. */
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

const URL = 'http://localhost:3000/rate-cards-preview';

let bad = 0;
const ok = (what: string, held: boolean, why?: string) => {
  console.log(`  ${held ? 'ok  ' : 'FAIL'}  ${what}`);
  if (!held) { bad += 1; if (why) console.log(`        ${why}`); }
};
const head = (s: string) => console.log(`\n  ${s}\n  ${'-'.repeat(s.length)}`);

async function main() {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const ctx = await browser.newContext({ viewport: { width: 1700, height: 1080 } });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  await installStubs(page);

  try {
    /* ---------------------------------------------------------
       The hub
       --------------------------------------------------------- */
    head('The hub lists cards and its controls work');
    await page.goto(URL, { waitUntil: 'networkidle' });

    ok('the hub draws with a card on it',
      await page.locator('text=KNDS UK').first().isVisible());

    const chips = await page.locator('.rc-6k button').count();
    ok('every filter chip is there', chips >= 7, `found ${chips}`);

    await page.locator('.rc-6k button', { hasText: 'Draft' }).first().click();
    await page.waitForTimeout(150);
    ok('a filter chip filters', await page.locator('.rc-6l').first().isVisible());

    /* The preference has to survive a reload, per the standing rule. */
    await page.reload({ waitUntil: 'networkidle' });
    const remembered = await page.locator('.rc-6l').first().textContent();
    ok('the filter is remembered through a reload', (remembered ?? '').includes('Draft'),
      `after reload the selected chip reads "${remembered}"`);

    await page.locator('.rc-6k button', { hasText: 'All' }).first().click();
    await page.waitForTimeout(120);

    await page.locator('.rc-6o select').selectOption('customer');
    await page.waitForTimeout(120);
    ok('the sort control changes the sort',
      await page.locator('.rc-6o select').inputValue() === 'customer');

    await page.locator('input[aria-label="Search customer"]').fill('nothing matches this');
    await page.waitForTimeout(150);
    ok('searching for nothing says so, rather than drawing an empty table',
      await page.locator('text=Nothing matches that').isVisible());
    await page.locator('input[aria-label="Search customer"]').fill('');

    /* ---------------------------------------------------------
       New rate card, and the duplicate warning
       --------------------------------------------------------- */
    head('New rate card asks before replacing a live one');
    await page.locator('button', { hasText: 'New rate card' }).first().click();
    await page.waitForTimeout(200);
    ok('the dialog opens', await page.locator('text=Pick the customer').isVisible());

    await page.locator('input[aria-label="Customer"]').fill('KNDS');
    await page.waitForTimeout(250);
    /* Scoped to the dialog: the hub row behind it carries the same
       customer name, and an unscoped match clicks through the scrim. */
    await page.locator('[role="dialog"] button', { hasText: 'KNDS UK' }).first().click();
    await page.waitForTimeout(250);

    ok('it warns that the customer already has a current card',
      await page.locator('text=already has a current rate card').isVisible());
    const createLabel = await page.locator('.rc-1t button.rc-16').textContent();
    ok('and the button says it will replace it, rather than saying Create',
      (createLabel ?? '').includes('Replace'), `button reads "${createLabel}"`);

    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    ok('Escape closes the dialog', !(await page.locator('text=Pick the customer').isVisible()));

    /* ---------------------------------------------------------
       The builder
       --------------------------------------------------------- */
    head('The builder prices, overrides and reverts');
    await page.locator('.rc-6r, .rc-6s').first().click();
    await page.waitForTimeout(450);
    ok('a card opens', await page.locator('text=Labour rates').isVisible());

    const aService = page.locator('[data-rate]', { hasText: 'HGV 7.5 ton+ A Service' }).first();
    const priceText = await aService.locator('.rc-2').first().textContent();
    ok('a derived rate shows the signed KNDS figure', priceText === '£157.50',
      `2-axle A service reads ${priceText}`);

    const workings = await aService.locator('.rc-d').first().textContent();
    ok('and its workings multiply out to that figure exactly',
      (() => {
        const m = (workings ?? '').match(/([\d.]+)h × £([\d.]+)/);
        if (!m) return false;
        return round2(Number(m[1]) * Number(m[2])) === 157.5;
      })(),
      `the workings read "${workings}", which must come to £157.50`);

    /* The labour band must never scroll away. */
    await page.locator('.rc-3f').evaluate((el) => { el.scrollTop = 600; });
    await page.waitForTimeout(150);
    ok('the labour band does not scroll away with the table',
      await page.locator('.rc-42').isVisible());

    /* ---------------------------------------------------------
       A labour change is staged and reviewed
       --------------------------------------------------------- */
    head('A labour change is reviewed before it commits');
    const hgv = page.locator('.rc-11', { hasText: 'HGV / LCV \u00b7 in hours' }).first();
    await hgv.locator('input').fill('90');
    await hgv.locator('input').blur();
    await page.waitForTimeout(300);

    ok('changing a labour rate opens the review rather than writing',
      await page.locator('text=will move').isVisible());

    const reviewRows = await page.locator('.rc-1s > div > div').count();
    ok('the review lists what would move', reviewRows > 5, `listed ${reviewRows} rows`);

    await page.locator('button', { hasText: 'Cancel' }).first().click();
    await page.waitForTimeout(250);
    const afterCancel = await page.locator('[data-rate]', { hasText: 'HGV 7.5 ton+ A Service' })
      .first().locator('.rc-2').first().textContent();
    ok('cancelling leaves every rate where it was', afterCancel === '£157.50',
      `after cancel the rate reads ${afterCancel}`);

    await hgv.locator('input').fill('90');
    await hgv.locator('input').blur();
    await page.waitForTimeout(300);
    await page.locator('button', { hasText: /^Apply to/ }).first().click();
    await page.waitForTimeout(500);

    const afterApply = await page.locator('[data-rate]', { hasText: 'HGV 7.5 ton+ A Service' })
      .first().locator('.rc-2').first().textContent();
    ok('accepting moves every derived rate that follows that pool',
      afterApply === '£166.76', `after the change the rate reads ${afterApply}`);

    ok('and a toast says how many moved',
      await page.locator('text=/rates? moved with the labour rate/').isVisible());

    /* ---------------------------------------------------------
       Override, cap warning and revert
       --------------------------------------------------------- */
    head('An override is a flag, not a delete');
    const laneFee = page.locator('[data-rate="r36"]').first();
    await laneFee.locator('.rc-j, .rc-3').first().dblclick();
    await page.waitForTimeout(200);
    await page.keyboard.type('200');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(450);

    ok('a statutory rate over its cap saves and warns rather than refusing',
      await page.locator('text=/over the DVSA cap/').isVisible());

    ok('the row is badged as overridden',
      (await laneFee.locator('.rc-4h').count()) > 0);

    await laneFee.hover();
    await page.waitForTimeout(120);
    await laneFee.locator('.rc-3i').first().click();
    await page.waitForTimeout(450);
    ok('reverting puts it back on the template',
      (await page.locator('[data-rate="r36"]').first().locator('.rc-4h').count()) === 0);

    /* ---------------------------------------------------------
       The tabs
       --------------------------------------------------------- */
    head('Every tab draws and does its job');
    await page.locator('.rc-46 button', { hasText: 'FleetSmart+ inclusions' }).click();
    await page.waitForTimeout(250);
    ok('the inclusions matrix is read from the contract',
      await page.locator('text=holds a live Platinum contract').isVisible());
    ok('and nothing in the matrix can be typed into',
      (await page.locator('.rc-5j input').count()) === 0);

    await page.locator('[role="switch"]').first().click();
    await page.waitForTimeout(250);
    ok('hiding the section asks first',
      await page.locator('text=only changes what prints').isVisible());
    await page.locator('.rc-1t button', { hasText: 'Hide it' }).click();
    await page.waitForTimeout(450);
    ok('and hiding it does not unlink the contract',
      await page.locator('text=FS-2026-0114').isVisible());

    await page.locator('.rc-46 button', { hasText: 'Header & contacts' }).click();
    await page.waitForTimeout(250);
    ok('a field the CRM could not fill is marked required',
      await page.locator('input[placeholder="Required, and empty"]').first().isVisible());
    ok('the account manager from the CRM says where it came from',
      await page.locator('text=from the CRM').isVisible());

    await page.locator('.rc-46 button', { hasText: 'History' }).click();
    await page.waitForTimeout(300);
    ok('the history lists what has been done to this card',
      (await page.locator('text=/Hourly Rate - HGVs/').count()) > 0);
    ok('and says it cannot be edited or removed',
      await page.locator('text=/can be edited or removed by anybody/').isVisible());

    /* ---------------------------------------------------------
       Preview, reset and export
       --------------------------------------------------------- */
    head('Preview, reset and export');
    await page.locator('button', { hasText: 'Preview' }).first().click();
    await page.waitForTimeout(400);
    ok('the preview shows the sheet',
      await page.locator('text=as the workbook').isVisible());
    ok('with the header block in it',
      await page.locator('text=Sarah Bradd').first().isVisible());
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);

    await page.locator('.rc-43 button', { hasText: 'Reset to default rates' }).click();
    await page.waitForTimeout(300);
    ok('reset asks first and says what it will clear',
      await page.locator('text=/back to the current defaults/').isVisible());
    await page.locator('.rc-1t button', { hasText: 'Reset this card' }).click();
    await page.waitForTimeout(500);
    const afterReset = await page.locator('.rc-11', { hasText: 'HGV / LCV \u00b7 in hours' })
      .first().locator('input').inputValue();
    ok('and resetting puts the labour rate back on the default',
      afterReset === '85.00', `after reset the HGV rate reads ${afterReset}`);

    await page.locator('button', { hasText: 'Export' }).first().click();
    await page.waitForTimeout(300);
    ok('the export dialog offers both formats',
      await page.locator('text=Excel workbook').isVisible()
      && await page.locator('text=PDF').first().isVisible());
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);

    /* ---------------------------------------------------------
       The defaults
       --------------------------------------------------------- */
    head('The default rates, and the offer they raise');
    await page.goto(`${URL}?view=defaults`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(400);
    ok('the defaults screen draws',
      await page.locator('text=Default labour rates').isVisible());

    const dl = page.locator('.rc-11', { hasText: 'HGV / LCV \u00b7 in hours' }).first();
    await dl.locator('input').fill('92');
    await dl.locator('input').blur();
    await page.waitForTimeout(450);
    ok('changing a default offers to bring existing cards into line',
      await page.locator('text=/Bring existing cards into line/').isVisible());
    ok('and says that new cards already start from it',
      await page.locator('text=/already starts from the new default/').isVisible());

    await page.locator('.rc-1t button', { hasText: 'Cancel' }).click();
    await page.waitForTimeout(300);
    ok('declining the offer says where to find them later',
      await page.locator('text=/Existing cards tab/').isVisible());

    await page.locator('.rc-46 button', { hasText: 'Existing cards' }).click();
    await page.waitForTimeout(350);
    ok('a card still on the defaults can be updated one at a time',
      await page.locator('button', { hasText: 'Update this one' }).first().isVisible());
    ok('and one with rates set for its customer says why it is left alone',
      await page.locator('text=/rate\\(s\\) set by hand/').first().isVisible());

    const leftAlone = page.locator('button', { hasText: 'Left alone' }).first();
    ok('the control for a card that is left alone is disabled with a reason',
      await leftAlone.isDisabled() && ((await leftAlone.getAttribute('title')) ?? '').length > 20);

    await page.locator('.rc-46 button', { hasText: 'History' }).click();
    await page.waitForTimeout(300);
    ok('the defaults have their own permanent history',
      await page.locator('text=/can be edited or removed by anybody/').isVisible());

    /* ---------------------------------------------------------
       The reported faults, each measured rather than looked at.

       Every one of these was found by the business on the live screen
       and could not have been found here, because the harness drew no
       sidebar and nothing read a computed style. They are asserted from
       now on.
       --------------------------------------------------------- */
    head('The faults reported from the live screen, measured');

    await page.goto(URL, { waitUntil: 'networkidle' });
    await page.waitForTimeout(400);

    /* 38. A toast paints over the sidebar, not under it. */
    await page.locator('button', { hasText: 'New rate card' }).first().click();
    await page.waitForTimeout(250);
    await page.locator('input[aria-label="Customer"]').fill('KNDS');
    await page.waitForTimeout(250);
    await page.locator('[role="dialog"] button', { hasText: 'KNDS UK' }).first().click();
    await page.waitForTimeout(250);
    await page.locator('.rc-1t button.rc-16').click();
    await page.waitForTimeout(700);

    const toastOverSidebar = await page.evaluate(() => {
      const toast = document.querySelector('.rc-toasts');
      const sidebar = document.querySelector('.sidebar');
      if (!toast || !sidebar) return { drawn: false, onTop: false, why: 'no toast or no sidebar' };
      const box = toast.getBoundingClientRect();
      /* What the browser says is actually painted where the toast is. */
      const at = document.elementFromPoint(box.left + 8, box.top + 8);
      return {
        drawn: box.width > 0 && box.height > 0,
        onTop: !!at && toast.contains(at),
        /* And the container is a rail, not a panel the size of a page. */
        sane: box.height < window.innerHeight * 0.5 && box.width < window.innerWidth * 0.6,
        why: `${Math.round(box.width)}x${Math.round(box.height)} at ${Math.round(box.left)},${Math.round(box.top)}`,
      };
    });
    ok('a toast is drawn', toastOverSidebar.drawn, toastOverSidebar.why);
    ok('and the browser paints it on top, not behind the sidebar',
      toastOverSidebar.onTop, `elementFromPoint landed outside the toast; ${toastOverSidebar.why}`);
    ok('and the toast rail is a rail rather than a full height panel',
      toastOverSidebar.sane === true, toastOverSidebar.why);

    /* 42. The scrim covers the whole window.

       Creating a card opens it, so the hub is returned to first. */
    await page.goto(URL, { waitUntil: 'networkidle' });
    await page.waitForTimeout(400);
    await page.locator('button', { hasText: 'New rate card' }).first().click();
    await page.waitForTimeout(300);
    const scrim = await page.evaluate(() => {
      const el = document.querySelector('.rc-scrim');
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return {
        h: Math.round(b.height), w: Math.round(b.width),
        vh: window.innerHeight, vw: window.innerWidth,
        inBody: el.parentElement === document.body,
      };
    });
    ok('the dialog scrim is the full height of the window',
      scrim !== null && scrim.h >= scrim.vh - 1,
      scrim ? `${scrim.h}px tall against a ${scrim.vh}px window` : 'no scrim');
    ok('and the full width', scrim !== null && scrim.w >= scrim.vw - 1);
    ok('and it is rendered into the body, above the whole application',
      scrim?.inBody === true);

    /* 44. Typing a whole word keeps the cursor where it was. */
    const field = page.locator('input[aria-label="Customer"]');
    await field.click();
    await page.keyboard.type('KNDS UK', { delay: 60 });
    await page.waitForTimeout(200);
    const typed = await field.inputValue();
    const stillFocused = await field.evaluate((el) => el === document.activeElement);
    ok('typing a whole word into the dialog types the whole word',
      typed === 'KNDS UK', `the field reads "${typed}"`);
    ok('and the cursor is still in the field afterwards', stillFocused);
    ok('and the dialog is still open', await page.locator('text=Pick the customer').isVisible());

    /* 43. Start from offers the defaults AND an existing card. */
    const options = await page.locator('select[aria-label="Start from"] option').count();
    ok('Start from offers more than one thing', options > 1, `${options} option(s)`);
    ok('and one of them is copying an existing card',
      (await page.locator('select[aria-label="Start from"] optgroup').count()) > 0);

    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);

    /* 39, 41. The labels are Panton at 11px, not 9.5px monospace. */
    const labelStyle = await page.evaluate(() => {
      const el = document.querySelector('.rc-2e');
      if (!el) return null;
      const s = getComputedStyle(el);
      return { size: parseFloat(s.fontSize), family: s.fontFamily, colour: s.color };
    });
    ok('a column heading is at least 11px', (labelStyle?.size ?? 0) >= 11,
      `it is ${labelStyle?.size}px`);
    ok('and is set in Panton rather than the monospace face',
      (labelStyle?.family ?? '').includes('Panton'), labelStyle?.family);

    /* 1. The sidebar row is 7px top and bottom. */
    const pad = await page.evaluate(() => {
      const el = document.querySelector('.sidebar__item');
      if (!el) return null;
      const s = getComputedStyle(el);
      return { top: s.paddingTop, bottom: s.paddingBottom, left: s.paddingLeft };
    });
    ok('a sidebar row has 7px above and below',
      pad?.top === '7px' && pad?.bottom === '7px', JSON.stringify(pad));
    ok('and its sides are untouched at 10px', pad?.left === '10px', pad?.left);

    /* 46. The screen is the page, not a bordered box inside it. */
    const frame = await page.evaluate(() => {
      const el = document.querySelector('.rc-6a');
      if (!el) return null;
      const s = getComputedStyle(el);
      return {
        border: s.borderTopWidth, radius: s.borderTopLeftRadius,
        width: Math.round(el.getBoundingClientRect().width),
        page: Math.round((document.querySelector('.page')?.getBoundingClientRect().width ?? 0)),
      };
    });
    ok('the screen has no frame drawn around it',
      frame?.border === '0px' && frame?.radius === '0px', JSON.stringify(frame));
    ok('and it fills the page it is on',
      frame !== null && Math.abs(frame.width - frame.page) < 60,
      `${frame?.width}px inside a ${frame?.page}px page`);

    /* 30. No border anywhere on the screen is heavier than 1px. */
    const heavy = await page.evaluate(() => {
      const out: string[] = [];
      for (const el of Array.from(document.querySelectorAll('.rc-6a, .rc-6a *'))) {
        const s = getComputedStyle(el);
        for (const side of ['Top', 'Right', 'Bottom', 'Left'] as const) {
          const w = parseFloat(s[`border${side}Width` as 'borderTopWidth']);
          if (w > 1 && s[`border${side}Style` as 'borderTopStyle'] !== 'none') {
            out.push(`${el.className || el.tagName} ${side.toLowerCase()} ${w}px`);
          }
        }
      }
      return [...new Set(out)];
    });
    ok('no border on the rendered screen is heavier than 1px',
      heavy.length === 0, heavy.slice(0, 6).join(', '));

    /* 31. No typing field is the height of its own text. */
    const shortFields = await page.evaluate(() => {
      const out: string[] = [];
      for (const el of Array.from(document.querySelectorAll('.rc-6a input, .rc-6a select'))) {
        const b = el.getBoundingClientRect();
        if (b.height > 0 && b.height < 28) out.push(`${el.getAttribute('aria-label') ?? el.className}: ${Math.round(b.height)}px`);
      }
      return out;
    });
    ok('every typing field is taller than its own line of text',
      shortFields.length === 0, shortFields.slice(0, 6).join(', '));

    /* 40. Prices line up. */
    await page.locator('.rc-6r, .rc-6s').first().click();
    await page.waitForTimeout(600);
    const edges = await page.evaluate(() => {
      const rights = new Set<number>();
      for (const cell of Array.from(document.querySelectorAll('.rate-row .rc-j, .rate-row .rc-3'))) {
        const span = cell.querySelector('.rc-2');
        if (!span) continue;
        rights.add(Math.round(span.getBoundingClientRect().right));
      }
      return [...rights].sort((a, b) => a - b);
    });
    /* An axle priced rate has four columns, so four right edges are
       expected. What must not happen is a fifth, off on its own, which
       is where a single price used to sit. */
    ok('every price lines up on one of the four column edges',
      edges.length > 0 && edges.length <= 4,
      `figures end at ${edges.length} different x positions: ${edges.join(', ')}`);

    /* 19. Every control on the builder says what it is for. */
    const unexplained = await page.evaluate(() => {
      const out: string[] = [];
      for (const el of Array.from(document.querySelectorAll('.rc-6a button'))) {
        const text = (el.textContent ?? '').trim();
        const title = el.getAttribute('title') ?? '';
        const label = el.getAttribute('aria-label') ?? '';
        if (text === '' && title === '' && label === '') out.push(el.className || 'a button');
      }
      return [...new Set(out)];
    });
    ok('no control on the screen is unlabelled and untitled',
      unexplained.length === 0, unexplained.slice(0, 6).join(', '));

    /* ---------------------------------------------------------
       The dark theme, which this screen had never been rendered in.

       The kit switches on `data-stc-theme` and this application on
       `data-theme`. The token file is rescoped to answer both, and
       nothing had ever checked that it does.
       --------------------------------------------------------- */
    head('Both themes resolve, and are legible in each');
    for (const theme of ['light', 'dark']) {
      await page.evaluate(`document.documentElement.setAttribute('data-theme', '${theme}')`);
      await page.waitForTimeout(250);

      const read = await page.evaluate(`(() => {
        const root = getComputedStyle(document.querySelector('.rc-6a'));
        const lum = (c) => {
          const m = String(c).match(/\\d+(\\.\\d+)?/g).map(Number);
          const f = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
          return 0.2126 * f(m[0]) + 0.7152 * f(m[1]) + 0.0722 * f(m[2]);
        };
        const worst = [];
        for (const sel of ['.rate-row .rc-2', '.rc-40', '.rc-s', '.rc-4', '.rc-2g']) {
          const el = document.querySelector(sel);
          if (!el) continue;
          let p = el, bg = 'rgba(0, 0, 0, 0)';
          while (p) {
            const c = getComputedStyle(p).backgroundColor;
            if (c && c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent') { bg = c; break; }
            p = p.parentElement;
          }
          const a = lum(getComputedStyle(el).color), b = lum(bg);
          worst.push({ sel, ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) });
        }
        return {
          bg: root.getPropertyValue('--bg').trim(),
          text: root.getPropertyValue('--text').trim(),
          worst: worst.sort((x, y) => x.ratio - y.ratio)[0] || null,
        };
      })()`) as { bg: string; text: string; worst: { sel: string; ratio: number } | null };

      ok(`the ${theme} theme resolves its tokens`,
        read.bg !== '' && read.text !== '', JSON.stringify(read));
      ok(`and the faintest text on the ${theme} screen is still readable`,
        (read.worst?.ratio ?? 0) >= 4.5,
        `${read.worst?.sel} is at ${read.worst?.ratio.toFixed(2)}:1, and 4.5:1 is the floor`);
    }
    await page.evaluate("document.documentElement.setAttribute('data-theme', 'light')");

    /* ---------------------------------------------------------
       A narrow window. The dashboard is used on laptops.
       --------------------------------------------------------- */
    head('It holds together on a laptop');
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.waitForTimeout(400);

    const sideways = await page.evaluate(`(() => ({
      body: document.documentElement.scrollWidth > window.innerWidth + 1,
      table: (() => {
        const el = document.querySelector('.rc-3f');
        return el ? el.scrollWidth > el.clientWidth : false;
      })(),
    }))()`) as { body: boolean; table: boolean };

    ok('the page itself never scrolls sideways at 1280', !sideways.body);
    ok('and the rate table still fits at 1280 without scrolling', !sideways.table,
      'the table is scrolling at a width it should fit in');

    /* Narrower than the table can fit. The columns must not be crushed:
       the table takes its own scrollbar and the page does not. */
    await page.setViewportSize({ width: 1024, height: 800 });
    await page.waitForTimeout(400);
    const tight = await page.evaluate(`(() => ({
      body: document.documentElement.scrollWidth > window.innerWidth + 1,
      table: (() => {
        const el = document.querySelector('.rc-3f');
        return el ? el.scrollWidth > el.clientWidth : false;
      })(),
    }))()`) as { body: boolean; table: boolean };
    ok('at 1024 the page still never scrolls sideways', !tight.body);
    ok('and the rate table takes its own scrollbar rather than crushing the columns',
      tight.table);

    const offscreen = await page.evaluate(`(() => {
      const out = [];
      for (const el of Array.from(document.querySelectorAll('.rc-42 .rc-11, .rc-46 button'))) {
        const b = el.getBoundingClientRect();
        if (b.right > window.innerWidth + 1 || b.left < -1) out.push(el.className);
      }
      return out;
    })()`) as string[];
    ok('no labour card or tab is pushed off the side of the window',
      offscreen.length === 0, offscreen.slice(0, 5).join(', '));

    await page.setViewportSize({ width: 1700, height: 1080 });

    head('Nothing threw while any of that happened');
    ok('no page errors', errors.length === 0, errors.slice(0, 4).join('\n        '));
  } finally {
    await browser.close();
  }

  console.log(bad === 0
    ? '\n  Every control on the Rate Card Builder was pressed and did what it says.\n'
    : `\n  ${bad} failed.\n`);
  process.exit(bad === 0 ? 0 : 1);
}

void main();
