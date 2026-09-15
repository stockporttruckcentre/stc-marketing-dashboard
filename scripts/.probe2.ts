import { chromium } from 'playwright';
import { KIT_RATES, LABOUR_POOLS } from '../lib/ratecards/kit.generated';

async function main() {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  const errs: string[] = [];
  page.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message));
  page.on('console', (m) => { if (m.type()==='error') errs.push('CONSOLE ' + m.text().slice(0,200)); });

  await page.route('**/rest/v1/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.route('**/auth/v1/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));

  await page.route('**/rest/v1/rpc/rate_card_read', (r) => {
    const rates = KIT_RATES.flatMap((k) => (k.axles ?? [0]).map((axle, c) => ({
      id: `${k.id}-${axle}`, card_id: 'card-1', rate_id: k.id, section: k.section, item: k.item,
      axle: k.axles ? axle : 0, basis: k.basis, hours: k.hours?.[c] ?? null, pool: k.pool,
      amount: typeof k.signed[c] === 'number' && k.basis !== 'derived' ? k.signed[c] : null,
      text_value: typeof k.signed[c] === 'string' ? k.signed[c] : null,
      override_value: null, overridden_by: null, overridden_at: null,
      cap: k.cap, cap_by: k.capBy, position: 0,
      price: k.basis === 'derived' ? Math.round(k.hours![c]! * (LABOUR_POOLS[k.pool!] ?? 0) * 100)/100
        : (typeof k.signed[c] === 'number' ? k.signed[c] : null),
      price_stc: null, would_be: null, over_cap: false,
    })));
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      card: { id: 'card-1', ref: 'RC-1', contact_id: 'c', customer_name: 'KNDS UK',
        effective_from: '2026-09-15', good_until: '2027-09-15', status: 'draft',
        main_contact: 'Sarah Bradd', address: null, telephone: null, email: null,
        other_detail: null, accounts_detail: null, contract_id: null, show_fleetsmart: true,
        extra_inclusions: [], owner_id: null, approved_by: null, approved_at: null,
        updated_at: new Date().toISOString(), days_old: 1, ageing: false, expired: false, editable: true },
      labour: Object.entries(LABOUR_POOLS).map(([pool, rate], i) => ({
        id: 'l'+pool, card_id: 'card-1', pool, label: pool, rate, charge_to: 'customer',
        is_custom: false, note: null, position: i })),
      rates, managers: [], fleetsmart: { contract: null, shown: true, extras: [], inclusions: [] },
      parts: [], missing: [],
    })});
  });
  await page.goto('http://localhost:3000/rate-cards-preview?card=card-1', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  console.log('--- body (700) ---');
  console.log((await page.locator('body').innerText()).slice(0, 700));
  console.log('--- data-rate count:', await page.locator('[data-rate]').count());
  console.log('--- errors ---'); console.log(errs.slice(0,5).join('\n') || 'none');
  await browser.close();
}
void main();
