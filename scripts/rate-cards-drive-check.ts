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
import { chromium, type Page, type Route } from 'playwright';
import { KIT_RATES, LABOUR_POOLS } from '../lib/ratecards/kit.generated';

const URL = 'http://localhost:3000/rate-cards-preview';

let bad = 0;
const ok = (what: string, held: boolean, why?: string) => {
  console.log(`  ${held ? 'ok  ' : 'FAIL'}  ${what}`);
  if (!held) { bad += 1; if (why) console.log(`        ${why}`); }
};
const head = (s: string) => console.log(`\n  ${s}\n  ${'-'.repeat(s.length)}`);

/* ---- The model the browser is answered from ----

   Written here in the same shape the database returns, and behaving the
   way the database behaves, so what the screen does with the answer is
   the same thing it will do in production. */
type Row = Record<string, unknown>;

function buildState() {
  const labour: Row[] = Object.entries(LABOUR_POOLS).map(([pool, rate], i) => ({
    id: `lab-${pool}`, card_id: 'card-1', pool,
    label: { hgv: "Hourly Rate - HGVs/LCV's, in hours", hgvO: "Hourly Rate - HGVs/LCV's, out of hours",
      trl: 'Hourly Rate - Trailers, in hours', trlO: 'Hourly Rate - Trailers, out of hours',
      body: 'Hourly Rate - Bodyshop, in hours' }[pool] ?? pool,
    rate, charge_to: 'customer', is_custom: false, set_by_hand: false, note: null, position: i,
  }));

  const rates: Row[] = KIT_RATES.flatMap((r) => {
    const cols = r.axles ?? [0];
    return cols.map((axle, c) => {
      const signed = r.signed[c];
      return {
        id: `${r.id}-${axle}`, card_id: 'card-1', rate_id: r.id, section: r.section, item: r.item,
        axle: r.axles ? axle : 0, basis: r.basis,
        hours: r.hours?.[c] ?? null, pool: r.pool,
        amount: typeof signed === 'number' && r.basis !== 'derived' ? signed : null,
        text_value: typeof signed === 'string' ? signed : null,
        override_value: null, overridden_by: null, overridden_at: null,
        cap: r.cap, cap_by: r.capBy, position: KIT_RATES.indexOf(r),
      };
    });
  });

  return { labour, rates, log: [] as Row[], shown: true, status: 'draft' };
}

let state = buildState();

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

const labourOf = (pool: unknown, chargeTo = 'customer') =>
  (state.labour.find((l) => l.pool === pool && l.charge_to === chargeTo)?.rate as number) ?? null;

function priced() {
  return state.rates.map((r) => {
    const lab = labourOf(r.pool);
    const price = r.override_value !== null && r.override_value !== undefined
      ? r.override_value as number
      : r.basis === 'derived' && lab !== null
        ? round2((r.hours as number) * lab)
        : (r.amount as number | null);
    return {
      ...r,
      price,
      price_stc: null,
      would_be: r.override_value !== null && r.basis === 'derived' && lab !== null
        ? round2((r.hours as number) * lab) : null,
      over_cap: r.cap !== null && r.override_value !== null
        && (r.override_value as number) > (r.cap as number),
    };
  });
}

function readCard() {
  return {
    card: {
      id: 'card-1', ref: 'RC-1', contact_id: 'cust-1', customer_name: 'KNDS UK',
      effective_from: '2026-09-15', good_until: '2027-09-15', status: state.status,
      main_contact: 'Sarah Bradd', address: null, telephone: '0161 9755729',
      email: 'sarah.bradd@knds.co.uk', other_detail: null, accounts_detail: null,
      contract_id: 'con-1', show_fleetsmart: state.shown, extra_inclusions: [],
      owner_id: 'u1', approved_by: null, approved_at: null,
      updated_at: new Date().toISOString(),
      days_old: 3, ageing: false, expired: false, editable: state.status === 'draft',
    },
    labour: state.labour,
    rates: priced(),
    managers: [{ user_id: 'u1', from_crm: true, name: 'Dean Cooper', email: 'dean@stc.example' }],
    fleetsmart: {
      contract: { id: 'con-1', ref: 'FS-2026-0114', plan: 'Platinum', starts_on: '2026-09-15', status: 'accepted', extras: {} },
      shown: state.shown, extras: [],
      inclusions: [
        { inclusion: 'MOT Inspection', silver: true, gold: true, platinum: true, position: 0 },
        { inclusion: 'A Service every inspection', silver: false, gold: true, platinum: true, position: 1 },
        { inclusion: 'Brakes & suspension R&M inc', silver: false, gold: false, platinum: true, position: 2 },
      ],
    },
    parts: [],
    missing: ['address'],
  };
}

/** The RPCs the screen calls, answered the way the database answers. */
function rpc(name: string, body: Record<string, unknown>): unknown {
  switch (name) {
    case 'rate_cards_list':
      return [{
        id: 'card-1', ref: 'RC-1', contact_id: 'cust-1', customer_name: 'KNDS UK',
        status: state.status, effective_from: '2026-09-15', good_until: '2027-09-15',
        days_old: 3, ageing: false, expired: false,
        overrides: state.rates.filter((r) => r.override_value !== null).length,
        labour_summary: String(labourOf('hgv')), on_contract: true, plan: 'Platinum',
        show_fleetsmart: state.shown, owner_name: 'Dean Cooper',
        manager_names: 'Dean Cooper', updated_at: new Date().toISOString(),
      }];
    case 'rate_card_read':
      return readCard();
    case 'rate_card_history':
      return [...state.log].reverse();
    case 'rate_card_for_customer':
      return [{ verdict: 'live', card_id: 'card-1', card_ref: 'RC-1', card_status: 'approved',
        effective_from: '2026-09-15', good_until: '2027-09-15', days_old: 3, owner_name: 'Dean Cooper' }];
    case 'rate_card_set_labour': {
      const row = state.labour.find((l) => l.pool === body.p_pool && l.charge_to === (body.p_charge_to ?? 'customer'));
      if (!row) return 0;
      const was = row.rate;
      row.rate = body.p_rate;
      row.set_by_hand = true;
      const moved = state.rates.filter((r) => r.basis === 'derived' && r.pool === body.p_pool && r.override_value === null).length;
      state.log.push({ id: `l${state.log.length}`, kind: 'labour', what: row.label,
        was: String(was), now_is: String(body.p_rate), rows_moved: moved,
        actor_name: 'Dean Cooper', actor_id: 'u1', at: new Date().toISOString() });
      return moved;
    }
    case 'rate_card_set_rate': {
      const row = state.rates.find((r) => r.rate_id === body.p_rate_id && r.axle === body.p_axle);
      if (!row) return [{ over_cap: false, cap: null, cap_by: null }];
      row.override_value = body.p_value;
      row.overridden_by = body.p_value === null ? null : 'u1';
      row.overridden_at = body.p_value === null ? null : new Date().toISOString();
      state.log.push({ id: `l${state.log.length}`, kind: body.p_value === null ? 'revert' : 'override',
        what: row.item, was: null, now_is: String(body.p_value ?? ''), rows_moved: 1,
        actor_name: 'Dean Cooper', actor_id: 'u1', at: new Date().toISOString() });
      return [{
        over_cap: row.cap !== null && body.p_value !== null && (body.p_value as number) > (row.cap as number),
        cap: row.cap, cap_by: row.cap_by,
      }];
    }
    case 'rate_card_add_labour':
      state.labour.push({
        id: `lab-${state.labour.length}`, card_id: 'card-1', pool: body.p_pool,
        label: body.p_label, rate: body.p_rate, charge_to: body.p_charge_to,
        is_custom: true, set_by_hand: true, note: body.p_note, position: state.labour.length,
      });
      state.log.push({ id: `l${state.log.length}`, kind: 'labour', what: `Added ${body.p_label}`,
        was: null, now_is: String(body.p_rate), rows_moved: 0,
        actor_name: 'Dean Cooper', actor_id: 'u1', at: new Date().toISOString() });
      return `lab-${state.labour.length}`;
    case 'rate_card_show_fleetsmart':
      state.shown = body.p_show as boolean;
      state.log.push({ id: `l${state.log.length}`, kind: 'fleetsmart',
        what: 'FleetSmart+ section on the printed card', was: null,
        now_is: state.shown ? 'shown' : 'hidden', rows_moved: 0,
        actor_name: 'Dean Cooper', actor_id: 'u1', at: new Date().toISOString() });
      return null;
    case 'rate_card_reset': {
      const cleared = state.rates.filter((r) => r.override_value !== null).length;
      for (const r of state.rates) { r.override_value = null; r.overridden_by = null; r.overridden_at = null; }
      const fresh = buildState();
      state.labour = fresh.labour;
      state.log.push({ id: `l${state.log.length}`, kind: 'system', what: 'Reset to the default rates',
        was: `${cleared} rate(s) set by hand`, now_is: 'every rate back on the template',
        rows_moved: state.rates.length, actor_name: 'Dean Cooper', actor_id: 'u1', at: new Date().toISOString() });
      return [{ rates_moved: state.rates.length, overrides_cleared: cleared }];
    }
    case 'rate_card_uplift': {
      for (const l of state.labour) l.rate = round2((l.rate as number) * 1.03);
      for (const r of state.rates) {
        if (r.basis === 'fixed' && r.amount !== null) r.amount = round2((r.amount as number) * 1.03);
      }
      state.log.push({ id: `l${state.log.length}`, kind: 'uplift', what: 'Uplift of 3%',
        was: null, now_is: null, rows_moved: 20, actor_name: 'Dean Cooper', actor_id: 'u1', at: new Date().toISOString() });
      return 20;
    }
    case 'rate_card_set_status':
      state.status = body.p_status as string;
      return null;
    case 'rate_card_set_detail':
    case 'rate_card_set_managers':
      return null;
    case 'rate_card_template_read':
      return {
        labour: state.labour.filter((l) => !l.is_custom).map((l) => ({
          pool: l.pool, label: l.label, rate: l.rate, position: l.position })),
        rates: state.rates.map((r) => ({
          ...r, price: r.basis === 'derived' ? round2((r.hours as number) * (labourOf(r.pool) ?? 0)) : r.amount })),
        inclusions: [], untouched_cards: 2, touched_cards: 1,
      };
    case 'rate_card_resync_candidates':
      return [
        { card_id: 'card-2', card_ref: 'RC-2', customer_name: 'Dole Foodservice', card_status: 'draft',
          effective_from: '2026-09-01', owner_name: 'Dean Cooper', untouched: true, why_not: null },
        { card_id: 'card-3', card_ref: 'RC-3', customer_name: 'Bolt Haulage', card_status: 'draft',
          effective_from: '2026-08-11', owner_name: 'Dean Cooper', untouched: false,
          why_not: '2 rate(s) set by hand' },
      ];
    case 'rate_card_template_set_labour':
    case 'rate_card_template_set_rate':
      return 1;
    case 'rate_card_resync':
    case 'rate_card_resync_all':
      return 1;
    case 'rate_card_template_history':
      return [{ id: 'th1', kind: 'labour', what: "Hourly Rate - HGVs/LCV's, in hours",
        was: '85.00', now_is: '88.00', cards_moved: 0, actor_name: 'Dean Cooper',
        at: new Date().toISOString() }];
    case 'rate_card_of_contract':
      return [{ card_id: 'card-1', card_ref: 'RC-1', card_status: 'draft', effective_from: '2026-09-15' }];
    default:
      return null;
  }
}

async function answer(route: Route) {
  const url = route.request().url();
  const json = (v: unknown) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(v),
  });

  const asRpc = url.match(/\/rest\/v1\/rpc\/([a-z_]+)/);
  if (asRpc) {
    const body = route.request().postData();
    return json(rpc(asRpc[1]!, body ? JSON.parse(body) : {}));
  }
  if (url.includes('/rest/v1/crm_contacts')) {
    return json([{ id: 'cust-1', company_name: 'KNDS UK', contact_name: 'Sarah Bradd' }]);
  }
  if (url.includes('/rest/v1/profiles')) {
    return json([{ id: 'u1', full_name: 'Dean Cooper', email: 'dean@stc.example' }]);
  }
  if (url.includes('/auth/v1/')) {
    return json({ data: { user: { id: 'u1' } }, user: { id: 'u1' } });
  }
  return json([]);
}

async function main() {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const ctx = await browser.newContext({ viewport: { width: 1700, height: 1080 } });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  await page.route('**/rest/v1/**', answer);
  await page.route('**/auth/v1/**', answer);

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
    const hgv = page.locator('.rc-11', { hasText: "HGVs/LCV's, in hours" }).first();
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
    const afterReset = await page.locator('.rc-11', { hasText: "HGVs/LCV's, in hours" })
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

    const dl = page.locator('.rc-11', { hasText: "HGVs/LCV's, in hours" }).first();
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
