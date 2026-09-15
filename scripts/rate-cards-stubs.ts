/* =============================================================
   The database, answered in the browser.

   Shared by `check:rate-cards-drive` and `check:rate-cards-sweep`, so
   the two see the same application. Two copies of this would be two
   applications, and the one that had not been kept up would pass while
   the real screen was broken.

   It behaves the way migration 110 behaves: hours times labour, an
   override that sits beside the hours rather than replacing them, and a
   labour change that moves every derived rate following that pool.
   Stubbing at the network rather than swapping the data layer is the
   point: the components are never told they are being tested, so what
   is driven is what ships.
   ============================================================= */
import type { Page, Route } from 'playwright';
import { KIT_RATES, LABOUR_POOLS } from '../lib/ratecards/kit.generated';

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
    case 'rate_card_sources':
      /* The defaults are the empty option in the select itself; this is
         the cards that could be copied. */
      return [
        { card_id: 'card-2', card_ref: 'RC-2', customer_name: 'Dole Foodservice',
          card_status: 'approved', effective_from: '2026-09-01', overrides: 2,
          same_customer: false },
        { card_id: 'card-3', card_ref: 'RC-3', customer_name: 'Bolt Haulage',
          card_status: 'draft', effective_from: '2026-08-11', overrides: 0,
          same_customer: false },
      ];
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


/** Answer every Supabase call this screen makes. */
export async function installStubs(page: Page): Promise<void> {
  /* Reset, so each check starts from the same card. */
  state = buildState();
  await page.route('**/rest/v1/**', answer);
  await page.route('**/auth/v1/**', answer);
}
