/* =============================================================
   What comes out of the printer, and where a proposal stops.

   ---- The bug this exists because of ----

   From the business:

     when you save a PDF either from the builder wizard or the popup
     allowing you to enter email addresses to send it to, there's a
     large white space on the left of the PDF, the actual fleetsmart+
     contract covers 50% of the width of the PDF

   Measured in a headless browser at A4 width, against the rules that
   shipped: the contract laid out at x=248, 440 points wide on a 688
   point page. Sixty four per cent of the width, and a 248 point band of
   white down the left of every sheet.

   The cause was two rules nowhere near the contract:

     .app  { display: grid; grid-template-columns: 248px 1fr }
     .main { position: relative }

   The contract was `position: absolute; left: 0; width: 100%`, and
   absolute resolves against the nearest POSITIONED ancestor, which is
   `.main`, which is the second column of that grid. On a 1440px window
   the column is 1192px and the screen looks perfect. It only goes wrong
   on paper, which is the one surface nobody looks at.

   ---- Why a check rather than a careful fix ----

   Because the fault was invisible. Every screenshot of this screen ever
   taken was correct. The only way to see it was to produce a PDF, and
   the only way to keep seeing it is to assert the rule that makes it
   impossible.

   THE RULE: the contract's printed width must be decided by the PAGE,
   never by an element of the application around it. Which means the
   print stylesheet may not leave the contract positioned against an
   ancestor, may not merely hide the furniture (a hidden grid column
   still reserves its width), and may not name the shell (naming it is
   what went stale: the old rules named the drawer, correctly, and had
   never heard of `.app`).

   ---- And where a proposal ends ----

     the proposal would end at "Prices exclude tyres and VAT." below the
     assets on the contract

   Asserted by rendering both documents and reading them, rather than by
   trusting a JSX branch to be in the right place.

   Run with `npm run check:fleetsmart-print`.
   ============================================================= */

import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  ContractDocument, ContractPrintRules, printContract,
} from '../components/fleetsmart/document';
import { TERMS_HEADING, blankContract, blankExtras } from '../lib/fleetsmart/contract';
import { blankAsset, priceContract } from '../lib/fleetsmart/price';
import type { AssetType, ContractInput } from '../lib/fleetsmart/types';

let failed = 0;
const ok = (what: string, cond: boolean, why = '') => {
  if (cond) { console.log(`  ok    ${what}`); return; }
  console.log(`  FAIL  ${what}${why ? `\n        ${why}` : ''}`);
  failed += 1;
};

/* ---- a contract with one of everything on it ---- */
const FLEET: [string, AssetType][] = [
  ['MX21 KJV', '6x2 Truck'],
  ['YE19 HDO', '2 Axle Rigid'],
  ['C374619', '3 Axle Trailer'],
  ['MJ70 ZTH', 'LCV'],
];

const input: ContractInput = {
  ...blankContract(),
  startDate: '2026-04-01',
  customerName: 'Dawson Group Haulage Limited',
  customerContact: 'Julie Barnes',
  assets: FLEET.map(([reg, type], i) => ({
    ...blankAsset(`a${i}`, 'Platinum'), reg, type, age: 3, mileagePerYear: 82_000,
  })),
};
const priced = priceContract(input);
const extras = { ...blankExtras(), accountManagerName: 'Dave Sherratt' };

const draw = (variant: 'contract' | 'proposal') => renderToStaticMarkup(
  <ContractDocument
    input={input} priced={priced} extras={extras} reference="FS-2026-0148" variant={variant}
  />,
);

const contract = draw('contract');
const proposal = draw('proposal');

/* =============================================================
   1. Where the proposal stops
   ============================================================= */
console.log('\n  Where a proposal stops\n  ----------------------');

const CUT = 'Prices exclude tyres and VAT.';

ok('the proposal reaches the line the business named',
  proposal.includes(CUT));

/* Everything below that line on the contract, named individually,
   because "it is shorter" is not the assertion. A proposal that lost
   the signing page and kept the standard terms would be shorter and
   would still be wrong. */
const BELOW_THE_CUT: [string, string][] = [
  ['the standard terms', TERMS_HEADING],
  ['the signing page', 'Authorised signatory'],
  ['the Services block', 'The Services provided shall include'],
  ['the Exclusions block', 'Exclusions'],
  ['the Charges block', 'Charges'],
  ['the Payment block', 'Payment'],
  ['the Collection and delivery block', 'Collection and delivery'],
];

for (const [what, needle] of BELOW_THE_CUT) {
  ok(`the contract carries ${what}`, contract.includes(needle));
  ok(`and the proposal does not`, !proposal.includes(needle),
    `"${needle}" is below the line the proposal ends at`);
}

/* The cut is the LAST thing on a proposal, not merely present on it. */
ok('and nothing follows it but the closing tags',
  proposal.slice(proposal.lastIndexOf(CUT) + CUT.length).replace(/<[^>]*>/g, '').trim() === '',
  'a proposal has visible content after the line it is supposed to end at');

ok('a proposal says on its face that it is one',
  proposal.includes('Proposal') && !contract.includes('>Proposal<'),
  'the two documents are identical for a page and a half, so the word has to be on the paper');

/* =============================================================
   2. The price is the same figure on both

   The reason a proposal is a variant of the contract rather than a
   second document. A customer who accepts a proposal is accepting the
   number on it, and the contract that follows has to carry that number.
   ============================================================= */
console.log('\n  One price, two documents\n  ------------------------');

const figures = (html: string) => (html.match(/£[\d,]+\.\d\d/g) ?? []);
const onProposal = figures(proposal);
const onContract = figures(contract);

ok('the proposal quotes a price at all', onProposal.length > 0);
ok('every figure on the proposal appears on the contract, unchanged',
  onProposal.every((f, i) => onContract[i] === f),
  `proposal ${onProposal.join(' ')}\n        contract ${onContract.slice(0, onProposal.length).join(' ')}`);

/* =============================================================
   3. The printed width is decided by the page
   ============================================================= */
console.log('\n  What decides the printed width\n  ------------------------------');

const rules = renderToStaticMarkup(<ContractPrintRules />);

ok('the contract is not positioned against anything in the application',
  !/#fs-contract\s*\{[^}]*position:\s*absolute/.test(rules),
  'absolute resolves against the nearest positioned ancestor, and `.main` is one. '
  + 'That is the 248 point white band: the contract inherits the width of a grid column '
  + 'sized for a sidebar that is not being printed.');

ok('the furniture is taken out of the layout, not hidden',
  rules.includes('display: none') && !/body\s*\*\s*\{\s*visibility:\s*hidden/.test(rules),
  'a hidden element keeps its box. A hidden sidebar in a 248px grid column still '
  + 'reserves 248px, which is the same white band by another route.');

ok('every ancestor of the contract is flattened, whatever it happens to be',
  rules.includes(':has(#fs-contract)'),
  'the rules that shipped named the drawer and had never heard of the shell outside it. '
  + 'Naming elements goes stale; naming the chain does not.');

ok('and the rules are inert on a page with no contract on it',
  !/(^|[^y])\bbody\s+\*:not/.test(rules) && rules.includes('body:has(#fs-contract)'),
  'unscoped, the "not on the chain" rule matches every element of any other screen '
  + 'and prints a blank sheet');

/* =============================================================
   3b. What the customer's copy is called

   A browser takes the PDF's title, and the filename it offers, from
   `document.title`. Every screen here is called "STC Marketing
   Dashboard", so a contract arrived at a haulier under the internal
   name of an internal tool.
   ============================================================= */
console.log('\n  What the file is called\n  -----------------------');
{
  const titles: string[] = [];
  const fake = { title: 'STC Marketing Dashboard' };
  const g = globalThis as unknown as { document?: unknown; window?: unknown; requestAnimationFrame?: unknown };
  const had = { d: 'document' in g, w: 'window' in g, r: 'requestAnimationFrame' in g };
  const before = { d: g.document, w: g.window, r: g.requestAnimationFrame };
  g.document = fake;
  /* A browser fires `afterprint` when the dialog closes, which is what
     puts the title back. A stub that never fires it tests nothing about
     the restore, and this check reported exactly that on its first run:
     the fault was in the stub, not in the code under it. */
  const listeners: Record<string, (() => void)[]> = {};
  g.window = {
    addEventListener(name: string, fn: () => void) { (listeners[name] ??= []).push(fn); },
    removeEventListener(name: string, fn: () => void) {
      listeners[name] = (listeners[name] ?? []).filter((f) => f !== fn);
    },
    print() {
      titles.push(fake.title);
      for (const fn of [...(listeners.afterprint ?? [])]) fn();
    },
  };
  /* Straight through, so `print` is reached inside this block. */
  g.requestAnimationFrame = (fn: () => void) => { fn(); return 0; };

  printContract({ variant: 'contract', customerName: 'Dawson Group Haulage Limited', reference: 'FS-2026-0148' });
  printContract({ variant: 'proposal', customerName: 'Dawson Group Haulage Limited', reference: 'FS-2026-0148' });
  printContract({ variant: 'contract', customerName: '', reference: null });

  if (had.d) g.document = before.d; else delete g.document;
  if (had.w) g.window = before.w; else delete g.window;
  if (had.r) g.requestAnimationFrame = before.r; else delete g.requestAnimationFrame;

  ok('a contract is not called the name of the application',
    titles.every((t) => !t.includes('Marketing Dashboard')), titles.join(' | '));
  ok('it names the document, the customer and the reference',
    titles[0] === 'FleetSmart+ Contract, Dawson Group Haulage Limited, FS-2026-0148',
    titles[0]);
  ok('and a proposal says proposal',
    (titles[1] ?? '').startsWith('FleetSmart+ Proposal,'), titles[1]);
  ok('an unnamed customer does not leave a stray comma in the filename',
    titles[2] === 'FleetSmart+ Contract', titles[2]);
  ok('the title is put back once the print dialog closes',
    fake.title === 'STC Marketing Dashboard', fake.title);
  ok('and the listener is taken off, so a hundred prints leave a hundred nothing',
    (listeners.afterprint ?? []).length === 0,
    `${(listeners.afterprint ?? []).length} left behind`);
}

/* =============================================================
   4. The assumption this was diagnosed against

   If the shell stops being a grid, or `.main` stops being positioned,
   the explanation in `document.tsx` is describing an application that no
   longer exists. That is worth knowing about; it is not worth failing
   over, because the fix above holds either way.
   ============================================================= */
const css = readFileSync('app/globals.css', 'utf8');
const app = /\.app\s*\{[^}]*\}/.exec(css)?.[0] ?? '';
const main = /^\.main\s*\{[^}]*\}/m.exec(css)?.[0] ?? '';
const stillTrue = app.includes('grid-template-columns') && /position:\s*relative/.test(main);
console.log(stillTrue
  ? '  ok    the shell is still a grid with a positioned content column, as diagnosed'
  : '  note  the shell has changed since this was diagnosed. The fix still holds;\n'
    + '        the explanation in document.tsx is now describing something else.');

console.log(
  failed === 0
    ? '\n  A proposal stops where it was told to, quotes the contract\'s own price,\n'
      + '  and neither document takes its width from the screen it was opened on.\n'
    : `\n  ${failed} to fix.\n`,
);
process.exit(failed === 0 ? 0 : 1);
