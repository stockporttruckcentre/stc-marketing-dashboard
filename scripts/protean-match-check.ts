/* =============================================================
   Matching Protean accounts to CRM customers.

   The cases at the top are the ones the business looked at and ruled
   on, and they are the reason this file exists. Character similarity
   offered three suggestions and two of them were different companies:

     AFB Logistics Ltd       ->  H&B Logistics          wrong
     Enterprise Flex-E-Rent  ->  Enterprise Flex-e-Rent right
     Jama Logistics Limited  ->  Jasin Logistics        wrong

   "Only the middle one was correct so don't trust that."

   A wrong bind merges two companies' revenue into one record, silently
   and permanently, and the first symptom is a figure in a board meeting
   nobody can explain. So the two wrong ones must not be OFFERED, not
   merely not accepted.

   npm run check:protean
   ============================================================= */
import { decide, review, brand, words, proteanDate, proteanMoney } from '../lib/protean/customers';

let pass = 0, fail = 0;
const failures: string[] = [];
function ok(what: string, cond: boolean, got = '') {
  if (cond) { pass += 1; return; }
  fail += 1;
  failures.push(`  ${what}${got ? `\n      ${got}` : ''}`);
}

/* The CRM, as far as these cases are concerned. Real names from Dean's
   tracker, which is what is in the CRM today. */
const CRM = [
  'H&B Logistics', 'Enterprise Flex-e-Rent', 'Jasin Logistics', 'Jama Logistics',
  'Booker', 'Dawson Vans', 'Dawson Group', 'TIP Trailers', 'Alltruck PLC - Shepley Windows',
  'Amphorea', 'Holman', 'Montgomery Tank Services Limited', 'John Sutch', 'Novuna',
  'Hippo Waste', 'A.M Transport', 'TJ Hood Transport Limited', 'Royal Mail',
].map((company_name, i) => ({ id: `c${i}`, company_name }));

const named = (v: ReturnType<typeof decide>) =>
  v.kind === 'exact' ? [v.contact.name]
    : v.kind === 'confirm' ? v.candidates.map((c) => c.name) : [];

/* -------------------------------------------------------------
   1. The three the business ruled on.
   ------------------------------------------------------------- */
{
  const afb = decide('AFBLOGIS', 'AFB Logistics Ltd', CRM);
  ok('AFB Logistics is never offered H&B Logistics',
    !named(afb).includes('H&B Logistics'), `${afb.kind}: ${named(afb).join(', ')}`);
  ok('AFB Logistics is offered as a new customer',
    afb.kind === 'create', afb.kind);

  const jama = decide('JAMALOGI', 'Jama Logistics Limited', CRM);
  ok('Jama Logistics is never offered Jasin Logistics',
    !named(jama).includes('Jasin Logistics'), `${jama.kind}: ${named(jama).join(', ')}`);
  ok('but Jama Logistics IS matched to Jama Logistics',
    jama.kind === 'exact' && jama.contact.name === 'Jama Logistics',
    `${jama.kind}: ${named(jama).join(', ')}`);

  const ent = decide('ENTFLEX', 'Enterprise Flex -E-Rent House', CRM);
  ok('Enterprise Flex-E-Rent still finds Enterprise Flex-e-Rent',
    named(ent).includes('Enterprise Flex-e-Rent'), `${ent.kind}: ${named(ent).join(', ')}`);
}

/* -------------------------------------------------------------
   1b. THE EIGHTEEN THE BUSINESS RULED ON.

   Every account the brand rule offered on the real export, and what
   Dean and Tom said about each. Seven were the same company, eleven
   were not, and the eleven are "separate companies, subsidiaries of
   larger groups, need their own accounts".

   These are not examples. They are the specification, and any change
   to the matcher has to keep agreeing with all eighteen.
   ------------------------------------------------------------- */
{
  const CRM2 = [
    'Novuna', 'Enterprise Flex-e-Rent', 'Holman', 'Amphorea', 'Hippo Waste',
    'John Sutch', 'Dawson Vans', 'Montgomery Tank Services Limited',
    'Alltruck PLC - Shepley Windows', 'Marshall Logisitcs', 'Fleet Operations Limited',
    'Fleet Support at AA', 'Motor Move Uk Limited', 'TJ Hood Transport Limited',
    'A.M Transport',
  ].map((company_name, i) => ({ id: `r${i}`, company_name }));

  /* The same company. A shortening from the front. */
  const same: [string, string][] = [
    ['Novuna Vehicle Solutions', 'Novuna'],
    ['Enterprise Flex -E-Rent House', 'Enterprise Flex-e-Rent'],
    ['Holman Fleet Limited', 'Holman'],
    ['Holman Fleet Limited (VMS)', 'Holman'],
    ['Amphorea Packaging Ltd', 'Amphorea'],
    ['Hippo Waste Management', 'Hippo Waste'],
    ['John Sutch Cranes', 'John Sutch'],
  ];
  for (const [protean, crmName] of same) {
    const v = decide('X', protean, CRM2);
    ok(`"${protean}" still reaches ${crmName}`,
      named(v).includes(crmName), `${v.kind}: ${named(v).join(', ') || 'nothing'}`);
  }

  /* Different companies. Same group, same brand, own account. */
  const different: [string, string][] = [
    ['Dawson Group Truck & Trailer Ltd', 'Dawson Vans'],
    /* The one that proves the rule has to be about ORDER. Every word of
       "Dawson Vans" is in "Dawson Rentals Vans", so overlap scores it
       1.00, and it is still a different company. */
    ['Dawson Rentals Vans Ltd', 'Dawson Vans'],
    ['Montgomery Transport Limited', 'Montgomery Tank Services Limited'],
    ['Montgomery Distribution Limited', 'Montgomery Tank Services Limited'],
    ['Alltruck Leicester', 'Alltruck PLC - Shepley Windows'],
    ['Marshall - Tufflex Ltd', 'Marshall Logisitcs'],
    ['Fleet Assist Limited', 'Fleet Operations Limited'],
    ['Fleet Assess Limited', 'Fleet Support at AA'],
    ['Motor Repair Network Ltd', 'Motor Move Uk Limited'],
    ['TJ Morris Limited T/A Home Bargains', 'TJ Hood Transport Limited'],
    ['A&A Scaffolding Group Limited (PRE FUNDED)', 'A.M Transport'],
  ];
  for (const [protean, wrong] of different) {
    const v = decide('X', protean, CRM2);
    ok(`"${protean}" is never offered ${wrong}`,
      !named(v).includes(wrong), `${v.kind}: ${named(v).join(', ')}`);
    ok(`"${protean}" is offered as its own account`,
      v.kind === 'create', v.kind);
  }
}

/* -------------------------------------------------------------
   2. The ordinary cases, which must keep working.
   ------------------------------------------------------------- */
{
  const cases: [string, string, 'exact' | 'confirm' | 'create'][] = [
    ['Booker Limited', 'Booker', 'exact'],
    ['Royal Mail', 'Royal Mail', 'exact'],
    ['Amphorea Packaging Ltd', 'Amphorea', 'confirm'],
    ['Holman Fleet Limited', 'Holman', 'confirm'],
  ];
  for (const [protean, expected, kind] of cases) {
    const v = decide('X', protean, CRM);
    ok(`"${protean}" is a ${kind}`, v.kind === kind, v.kind);
    ok(`"${protean}" reaches "${expected}"`,
      named(v).includes(expected), named(v).join(', ') || 'nothing');
  }
}

/* -------------------------------------------------------------
   3. Two Protean accounts, one customer.
   ------------------------------------------------------------- */
{
  const a = decide('ARIFLEET', 'Holman Fleet Limited', CRM);
  const b = decide('ARIVMS', 'Holman Fleet Limited (VMS)', CRM);
  ok('both Holman accounts reach the same CRM record',
    named(a).includes('Holman') && named(b).includes('Holman'),
    `${named(a).join(',')} | ${named(b).join(',')}`);
}

/* -------------------------------------------------------------
   4. Nothing binds itself except an exact match.
   ------------------------------------------------------------- */
{
  const r = review(
    [
      { account: 'A', name: 'Booker Limited' },
      { account: 'B', name: 'Holman Fleet Limited' },
      { account: 'C', name: 'Totally Unknown Haulage' },
    ],
    CRM,
  );
  ok('an exact match binds', r.exact.length === 1, String(r.exact.length));
  ok('a brand match waits for a person', r.confirm.length === 1, String(r.confirm.length));
  ok('an unknown company is offered as new', r.create.length === 1, String(r.create.length));
  ok('every confirm carries at least one candidate',
    r.confirm.every((c) => c.candidates.length > 0));
}

/* -------------------------------------------------------------
   5. The words that identify a company, and the ones that do not.
   ------------------------------------------------------------- */
{
  ok('Ltd, Limited and Group are dropped',
    words('Dawson Group Truck & Trailer Ltd').join(' ') === 'dawson truck trailer',
    words('Dawson Group Truck & Trailer Ltd').join(' '));
  /* Deliberately kept: two firms differ only by these words. */
  ok('Transport and Distribution are NOT dropped',
    brand('Montgomery Transport Limited') === 'montgomery'
    && words('Montgomery Transport Limited').includes('transport')
    && words('Montgomery Distribution Limited').includes('distribution'));
  ok('and so those two do not collapse into one',
    words('Montgomery Transport Limited').join(' ')
      !== words('Montgomery Distribution Limited').join(' '));
}

/* -------------------------------------------------------------
   6. Protean's own formats.
   ------------------------------------------------------------- */
{
  ok('27-Aug-26 reads as 2026-08-27', proteanDate('27-Aug-26') === '2026-08-27', String(proteanDate('27-Aug-26')));
  ok('02-Sep-26 reads as 2026-09-02', proteanDate('02-Sep-26') === '2026-09-02', String(proteanDate('02-Sep-26')));
  ok('a blank date is nothing, not today', proteanDate('') === null);
  ok('rubbish is nothing', proteanDate('next tuesday') === null);

  ok('£250.30 is 250.3', proteanMoney('£250.30') === 250.3, String(proteanMoney('£250.30')));
  ok('a mangled pound sign still parses', proteanMoney('�4.40') === 4.4, String(proteanMoney('�4.40')));
  ok('thousands separators parse', proteanMoney('£1,234,567.89') === 1234567.89, String(proteanMoney('£1,234,567.89')));
  /* A credit note. None in the first export, and reading one as
     positive would overstate revenue by twice the credit. */
  ok('(£50.00) is minus fifty', proteanMoney('(£50.00)') === -50, String(proteanMoney('(£50.00)')));
  ok('-£50.00 is minus fifty', proteanMoney('-£50.00') === -50, String(proteanMoney('-£50.00')));
  ok('an empty cell is nothing, not zero', proteanMoney('') === null);
  ok('a word is nothing, not zero', proteanMoney('n/a') === null, String(proteanMoney('n/a')));
}

console.log(`\n  ${pass}/${pass + fail} hold.\n`);
if (fail) {
  console.log('  failures:');
  for (const f of failures) console.log(f);
  process.exit(1);
}
console.log('  A wrong bind is never offered, an exact one binds itself, '
  + 'and everything between waits for a person.\n');
