/* =============================================================
   What an amendment says it did, against what it did.

   `check:price` proves the engine. This proves the sentences: that the
   four things the business named all come out named, that the money is
   attributed to a line only where it honestly can be, and that a
   contract nobody changed produces no amendment at all.

   The scenarios are theirs, in their words:

     a customer wants to add more assets on, take assets off, add w&t
     charge to their silver plan, upgrade from silver to gold etc

   Run with `npm run check:amend`.
   ============================================================= */
import { blankContract } from '../lib/fleetsmart/contract';
import { blankAsset, priceContract } from '../lib/fleetsmart/price';
import { describeAmendment, nothingChanged } from '../lib/fleetsmart/amend';
import type { ContractInput, FleetAsset } from '../lib/fleetsmart/types';
import type { AssetType, Plan } from '../lib/fleetsmart/ratecard';

let pass = 0; const fails: string[] = [];
function ok(what: string, holds: boolean, detail = '') {
  if (holds) { pass++; return; }
  fails.push(`${what}${detail ? `  (${detail})` : ''}`);
}
const money = (n: number) => '£' + n.toFixed(2);

function asset(reg: string, type: AssetType, plan: Plan, over: Partial<FleetAsset> = {}): FleetAsset {
  return { ...blankAsset(reg.replace(/\s/g, ''), plan), reg, type, ...over };
}
function contract(plan: Plan, assets: FleetAsset[]): ContractInput {
  return { ...blankContract(), plan, assets };
}
function diff(a: ContractInput, b: ContractInput) {
  return describeAmendment(a, b, priceContract(a), priceContract(b));
}

/* ---- 1. adding an asset ---- */
{
  const before = contract('Gold', [asset('AB12 CDE', '6x2 Truck', 'Gold')]);
  const after = contract('Gold', [
    asset('AB12 CDE', '6x2 Truck', 'Gold'),
    asset('C123456', '3 Axle Trailer', 'Gold'),
  ]);
  const d = diff(before, after);
  ok('adding a trailer is one change', d.changes.length === 1, `${d.changes.length}`);
  ok('and it says so', d.changes[0]?.what.includes('C123456 added'), d.changes[0]?.what);
  ok('with its own price attributed',
    d.changes[0]?.delta != null && Math.abs((d.changes[0].delta ?? 0) - d.difference) < 0.02,
    `line ${d.changes[0]?.delta}, total ${d.difference}`);
  ok('and the total goes up', d.difference > 0, money(d.difference));
}

/* ---- 2. taking one off ---- */
{
  const before = contract('Gold', [
    asset('AB12 CDE', '6x2 Truck', 'Gold'),
    asset('C123456', '3 Axle Trailer', 'Gold'),
  ]);
  const after = contract('Gold', [asset('AB12 CDE', '6x2 Truck', 'Gold')]);
  const d = diff(before, after);
  ok('taking a trailer off is one change', d.changes.length === 1, `${d.changes.length}`);
  ok('and it says taken off', d.changes[0]?.what.includes('taken off'), d.changes[0]?.what);
  ok('with a negative figure', (d.changes[0]?.delta ?? 0) < 0, `${d.changes[0]?.delta}`);
  ok('and the total goes down', d.difference < 0, money(d.difference));
}

/* ---- 3. wear and tear onto a Silver plan ---- */
{
  const before = contract('Silver', [asset('AB12 CDE', '6x2 Truck', 'Silver')]);
  const after = contract('Silver', [asset('AB12 CDE', '6x2 Truck', 'Silver', { wearAndTear: 1500 })]);
  const d = diff(before, after);
  ok('wear and tear on Silver is one change', d.changes.length === 1, `${d.changes.length}`);
  ok('and it says what it is',
    d.changes[0]?.what.includes('wear and tear of £1,500.00 a year added'), d.changes[0]?.what);
  ok('and it costs exactly that', Math.abs(d.difference - 1500) < 0.02, money(d.difference));
}

/* ---- 4. Silver to Gold ---- */
{
  const before = contract('Silver', [
    asset('AB12 CDE', '6x2 Truck', 'Silver'),
    asset('C123456', '3 Axle Trailer', 'Silver'),
  ]);
  const after = contract('Gold', [
    asset('AB12 CDE', '6x2 Truck', 'Gold'),
    asset('C123456', '3 Axle Trailer', 'Gold'),
  ]);
  const d = diff(before, after);
  ok('an upgrade is one change', d.changes.length === 1, d.changes.map(c => c.what).join(' | '));
  ok('and it says upgraded', d.changes[0]?.what === 'Upgraded from FleetSmart+ Silver to Gold',
    d.changes[0]?.what);
  ok('with no figure attributed to it', d.changes[0]?.delta === null, `${d.changes[0]?.delta}`);
  ok('and Gold costs more than Silver', d.difference > 0, money(d.difference));
  console.log(`  Silver to Gold on two assets: ${money(d.was)} to ${money(d.now)}, ${money(d.difference)} more`);
}

/* ---- 5. an upgrade plus an asset, together ---- */
{
  const before = contract('Silver', [asset('AB12 CDE', '6x2 Truck', 'Silver')]);
  const after = contract('Gold', [
    asset('AB12 CDE', '6x2 Truck', 'Gold'),
    asset('C123456', '3 Axle Trailer', 'Gold'),
  ]);
  const d = diff(before, after);
  ok('both changes are named', d.changes.length === 2, d.changes.map(c => c.what).join(' | '));
  ok('the plan move comes first', d.changes[0]?.kind === 'plan', d.changes[0]?.kind);
  ok('the added asset carries its own figure', d.changes[1]?.delta != null);
  ok('and the plan move does not', d.changes[0]?.delta === null);
}

/* ---- 6. nothing changed ---- */
{
  const same = contract('Gold', [asset('AB12 CDE', '6x2 Truck', 'Gold')]);
  const d = diff(same, structuredClone(same));
  ok('an identical contract has no changes', nothingChanged(d), `${d.changes.length} / ${d.difference}`);
}

/* ---- 7. a change that is not the price ---- */
{
  const before = contract('Gold', [asset('AB12 CDE', '6x2 Truck', 'Gold')]);
  const after = contract('Gold', [asset('AB12 CDE', '6x2 Truck', 'Gold', { collectionAndDelivery: true })]);
  const d = diff(before, after);
  ok('collection and delivery is named', d.changes[0]?.what.includes('collection and delivery added'),
    d.changes[0]?.what);
  ok('and attributed, since the plan did not move',
    d.changes[0]?.delta != null && Math.abs((d.changes[0].delta ?? 0) - d.difference) < 0.02);
}

/* ---- 8. the same reg re-typed differently is the same asset ---- */
{
  const before = contract('Gold', [asset('AB12 CDE', '6x2 Truck', 'Gold')]);
  const after = contract('Gold', [asset('  ab12 cde  ', '6x2 Truck', 'Gold')]);
  const d = diff(before, after);
  ok('spacing and case do not make it a different asset', nothingChanged(d),
    d.changes.map(c => c.what).join(' | '));
}

console.log(`\n${pass}/${pass + fails.length} holding`);
if (fails.length) { console.log('\nfailures:'); for (const f of fails) console.log('  ' + f); process.exit(1); }
