/* =============================================================
   A copied contract keeps its customer, and a lead is named by what it
   knows.

   ---- The report ----

     when pressing Copy on a fleetsmart contract to duplicate the
     details to a new contract - that works great but when it creats a
     tracker lead for the Copy contract, it doesn't populate any details
     in the tracker and says unknown customer.

   Two faults, one on each side of the same journey.

   1. Copy passed `row: null` to the wizard, and the wizard reads the
      account off `row`. So the copy showed the customer's NAME on step
      one, out of `input`, and linked nothing. The contract saved with a
      null `account_id`, migration 067's trigger raised a lead with a
      null `contact_id`, and the tracker had nothing to look up.

   2. The tracker named every row `l.account?.company_name ?? 'Unknown
      company'` and never read the name the lead itself carries. That
      one is older and wider than FleetSmart+: it applies to any lead
      with no account, which migration 040 explicitly supports.

   Neither could be caught by the compiler, because `Lead.contact_id`
   was typed `string` when the column is nullable, and `company_name`
   was not on the type at all. Both corrected, and correcting them found
   a third: the tracker's Schedule button passed a null contact id
   straight into the booking modal.

   ---- What this asserts ----

   The database side is already covered by `npm run check:fleetsmart`
   and the trigger there is not the problem: given an account it does
   the right thing. Everything below is the browser's half, which is
   where both faults actually were.
   ============================================================= */

import { seedFromContract, type Copyable } from '../lib/fleetsmart/copy';
import { hasAnAccount, nameOfLead, NO_NAME } from '../lib/crm/lead-identity';
import { blankContract, blankExtras } from '../lib/fleetsmart/contract';
import { blankAsset } from '../lib/fleetsmart/price';

let failed = 0;
const ok = (what: string, cond: boolean, why = '') => {
  if (cond) { console.log(`  ok    ${what}`); return; }
  console.log(`  FAIL  ${what}${why ? `\n        ${why}` : ''}`);
  failed += 1;
};

const contract = (over: Partial<Copyable> = {}): Copyable => ({
  account_id: 'c1000000-0000-0000-0000-000000000001',
  lead_id: 'l1000000-0000-0000-0000-000000000001',
  input: {
    ...blankContract(),
    customerName: 'Hartley Haulage Ltd',
    plan: 'Gold',
    termMonths: 36,
    assets: [
      { ...blankAsset('x', 'Gold'), reg: 'AB12 CDE', type: '6x2 Truck' },
      { ...blankAsset('y', 'Gold'), reg: 'C123456', type: '3 Axle Trailer' },
    ],
  },
  extras: { ...blankExtras(), accountManagerName: 'Dave Sellers' },
  ...over,
});

console.log('\n  Copying a contract\n  ------------------');

/* ---- THE REGRESSION ---- */
{
  const seed = seedFromContract(contract());
  ok('the copy carries the customer',
    seed.accountId === 'c1000000-0000-0000-0000-000000000001',
    `accountId came back ${String(seed.accountId)}. A null here is the whole bug: `
    + 'the contract saves with no account, the trigger raises a lead with no contact, '
    + 'and the tracker says unknown customer.');
}

/* ---- And the half that must NOT come with it ---- */
{
  const seed = seedFromContract(contract());
  ok('the copy does not carry the lead',
    seed.leadId === null,
    'Reusing the lead makes the trigger update the first contract\'s pitch instead of '
    + 'opening a new one: two prices on one lead, and the first contract\'s status '
    + 'overwritten by the second.');
}

/* ---- Everything else does come with it ---- */
{
  const seed = seedFromContract(contract());
  ok('the plan, term and customer name come across',
    seed.input.plan === 'Gold' && seed.input.termMonths === 36
    && seed.input.customerName === 'Hartley Haulage Ltd');
  ok('the fleet comes across', seed.input.assets.length === 2);
  ok('the wording comes across', seed.extras.accountManagerName === 'Dave Sellers');
  ok('asset keys are renumbered rather than reused',
    seed.input.assets.map((a) => a.key).join(',') === 'a0,a1',
    'Two rows carrying one React key is a row that will not edit.');
}

/* ---- A contract that never had an account copies to one that has none ---- */
{
  const seed = seedFromContract(contract({ account_id: null }));
  ok('a contract with no account copies to a seed with no account',
    seed.accountId === null,
    'It must not invent one. A half filled company in the CRM as a side effect of '
    + 'pressing Copy is worse than an unlinked draft.');
}

/* ---- Nothing shared with the original ---- */
{
  const original = contract();
  const seed = seedFromContract(original);
  seed.input.assets[0]!.reg = 'CHANGED';
  ok('editing the copy does not edit the contract it came from',
    original.input.assets[0]!.reg === 'AB12 CDE',
    'The assets were copied by reference, so editing the draft edits the sent contract.');
}

/* ---- Missing extras, which a contract built before they existed has ---- */
{
  const seed = seedFromContract(contract({ extras: null }));
  ok('a contract with no extras still copies', typeof seed.extras === 'object' && seed.extras !== null);
}

console.log('\n  Naming a lead\n  -------------');

for (const [what, lead, want] of [
  ['an account and a name',
    { contact_id: 'c1', company_name: 'Dawson Trucks Ltd', account: { company_name: 'Dawson Trucks Ltd' } },
    'Dawson Trucks Ltd'],
  /* THE ONE THE TRACKER GOT WRONG. */
  ['no account, but the lead carries the name',
    { contact_id: null, company_name: 'Hartley Haulage Ltd', account: null },
    'Hartley Haulage Ltd'],
  ['no account and no name at all',
    { contact_id: null, company_name: null, account: null },
    NO_NAME],
  /* A blank string is not a name. Whitespace out of a form field is the
     commonest way a "name" arrives that is not one. */
  ['a name that is only spaces',
    { contact_id: null, company_name: '   ', account: null },
    NO_NAME],
  /* The account's name WINS. `crm_contacts_rename_leads` keeps it true
     in the same statement as the rename; preferring the lead's copy
     would print yesterday's name. */
  ['the account has been renamed since',
    { contact_id: 'c1', company_name: 'Dawson Trucks', account: { company_name: 'Dawson Group Ltd' } },
    'Dawson Group Ltd'],
  /* An account row with no name on it falls back rather than printing
     nothing. Rare, and it happens: a CRM record made by an import that
     had a postcode and no company. */
  ['an account with no name on it',
    { contact_id: 'c1', company_name: 'Hartley Haulage Ltd', account: { company_name: null } },
    'Hartley Haulage Ltd'],
] as [string, Parameters<typeof nameOfLead>[0], string][]) {
  ok(`${what} reads as "${want}"`, nameOfLead(lead) === want, `got "${nameOfLead(lead)}"`);
}

console.log('\n  What needs an account\n  ---------------------');

ok('a lead with an account can be booked against', hasAnAccount({ contact_id: 'c1' }));
ok('a lead with no account cannot', !hasAnAccount({ contact_id: null }));
/* An empty string is a null that got through a form. It is not an id,
   and passing it to a query matches nothing while looking like it
   should match something. */
ok('an empty string is not an account', !hasAnAccount({ contact_id: '' }));

console.log(
  failed === 0
    ? '\n  A copy keeps its customer, and a lead is named by what it knows.\n'
    : `\n  ${failed} to fix.\n`,
);
process.exit(failed === 0 ? 0 : 1);
