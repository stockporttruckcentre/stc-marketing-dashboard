/* =============================================================
   What a customer is worth, asserted.

   Two screens read `lib/crm/lead-value.ts` and a figure that is wrong in
   one place is wrong in both, so it is worth holding to the same standard
   as the pricing engine: the split between open, won and lost, what a won
   lead counts at, and the one judgement, which is that lost money is not
   in the headline.

   Run with `npm run check:value`.
   ============================================================= */
import { valueLeads, valueOf, whatIsMissing, type ValuableLead } from '../lib/crm/lead-value';

let pass = 0; const fails: string[] = [];
function ok(what: string, holds: boolean, detail = '') {
  if (holds) { pass++; return; }
  fails.push(`${what}${detail ? `  (${detail})` : ''}`);
}

const lead = (status: string, over: Partial<ValuableLead> = {}): ValuableLead =>
  ({ status, type: 'trailer_sales', estimated_value: null, sale_price: null, ...over });

/* ---- the three buckets ---- */
{
  const v = valueLeads([
    lead('lead', { estimated_value: 1000 }),
    lead('contacted', { estimated_value: 2000 }),
    lead('quoted', { estimated_value: 3000 }),
    lead('customer', { sale_price: 10000 }),
    lead('won', { estimated_value: 5000 }),
    lead('lost', { estimated_value: 40000 }),
  ]);
  ok('open is lead, contacted and quoted', v.open.count === 3 && v.open.total === 6000,
    `${v.open.count} / ${v.open.total}`);
  ok('won is won and customer', v.won.count === 2 && v.won.total === 15000,
    `${v.won.count} / ${v.won.total}`);
  ok('lost is its own', v.lost.count === 1 && v.lost.total === 40000);
  ok('the headline is open plus won', v.openAndWon === 21000, `${v.openAndWon}`);
  ok('and the headline never includes lost', v.openAndWon < v.lost.total + v.openAndWon);
  ok('every lead is counted', v.leads === 6);
}

/* ---- a won lead prefers what it sold for ---- */
{
  ok('a won lead counts what it sold for',
    valueOf(lead('customer', { sale_price: 9000, estimated_value: 4000 })) === 9000);
  ok('and falls back to the estimate where there is no price',
    valueOf(lead('won', { estimated_value: 4000 })) === 4000);
  ok('an open lead never reads sale_price',
    valueOf(lead('quoted', { sale_price: 9000, estimated_value: 4000 })) === 4000);
}

/* ---- leads with no figure at all ---- */
{
  const v = valueLeads([
    lead('quoted', { estimated_value: 5000 }),
    lead('quoted'),
    lead('lead'),
  ]);
  ok('an unpriced lead is counted', v.open.count === 3, `${v.open.count}`);
  ok('but not totalled', v.open.total === 5000, `${v.open.total}`);
  ok('and how many is said', v.unpriced === 2, `${v.unpriced}`);
  ok('out loud', (whatIsMissing(v) ?? '').includes('2 of the 3'), whatIsMissing(v) ?? 'nothing');
  ok('a zero is a value, not a missing one',
    valueLeads([lead('quoted', { estimated_value: 0 })]).unpriced === 0);
}

/* ---- Postgres numerics arrive as strings ---- */
{
  const v = valueLeads([
    lead('quoted', { estimated_value: '1500.50' as never }),
    lead('customer', { sale_price: '2499.50' as never }),
  ]);
  ok('a numeric sent as a string still totals', v.openAndWon === 4000, `${v.openAndWon}`);
}

/* ---- nothing at all ---- */
{
  const v = valueLeads([]);
  ok('no leads is no money rather than a crash',
    v.leads === 0 && v.openAndWon === 0 && whatIsMissing(v) === null);
}

/* ---- money that is not a number ---- */
{
  const v = valueLeads([lead('quoted', { estimated_value: 'see email' as never })]);
  ok('a value that is words counts as no value', v.unpriced === 1 && v.open.total === 0);
}

/* ---- a status nothing writes ---- */
{
  const v = valueLeads([lead('archived'), lead('quoted', { estimated_value: 100 })]);
  ok('an unknown status is not quietly folded into open', v.open.count === 1, `${v.open.count}`);
  ok('and still shows in the lead count', v.leads === 2);
}

/* ---- rounding ---- */
{
  const v = valueLeads([
    lead('quoted', { estimated_value: 0.1 }),
    lead('quoted', { estimated_value: 0.2 }),
  ]);
  ok('adding money does not leave a floating point tail', v.open.total === 0.3, `${v.open.total}`);
}

console.log(`\n${pass}/${pass + fails.length} holding`);
if (fails.length) { console.log('\nfailures:'); for (const f of fails) console.log('  ' + f); process.exit(1); }
