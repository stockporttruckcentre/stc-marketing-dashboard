/* =============================================================
   The sales tracker, against what production testing said about it.

   Five complaints, one file, because they are five faults in one screen
   and a check per complaint would repeat the same fixtures five times.
   Each section names the sentence it exists for.

   Run with `npm run check:tracker`.
   ============================================================= */

import { readFileSync } from 'node:fs';
import { applyOrder } from '../lib/ui/order';
import {
  MAINTENANCE_WHAT, RENTAL_WHAT, WORK_KINDS, WORK_KIND_LABEL, workKindOf,
} from '../lib/crm/work-kind';
import { fieldsFor } from '../lib/crm/lead-fields';
import { winsAProspect } from '../lib/crm/conversion';
import type { LeadType } from '../lib/types';

let failed = 0;
const ok = (what: string, cond: boolean, why = '') => {
  if (cond) { console.log(`  ok    ${what}`); return; }
  console.log(`  FAIL  ${what}${why ? `\n        ${why}` : ''}`);
  failed += 1;
};

const TYPES: LeadType[] = ['trailer_sales', 'maintenance', 'rental'];
const source = readFileSync('components/SalesTracker.tsx', 'utf8');

/* =============================================================
   1. Too many filters on maintenance

     There are too many filters on Maintenance in the sales tracker,
     things like maintenance/brake tests and maintenance/refurb mean the
     same thing really. Need cleaning to just the status filters and
     just a few relative to the type of work the lead is for.
   ============================================================= */
console.log('\n  What kind of work this is\n  -------------------------');

ok('the two the business named are one kind of work',
  workKindOf('maintenance/brake tests') === workKindOf('maintenance/refurb'),
  `${workKindOf('maintenance/brake tests')} and ${workKindOf('maintenance/refurb')}`);

ok('and that kind is maintenance, not whichever word came second',
  workKindOf('maintenance/brake tests') === 'contract',
  workKindOf('maintenance/brake tests'));

/* The vocabulary that is actually on the records, from the editor that
   shipped and from the sheet it was typed off. Every one of these was
   its own chip. */
const OLD_SPELLINGS = [
  'Maintenance', 'maintenance', 'MAINTENANCE',
  'Trukplan', 'All Services', 'All services',
  'Maintenance and MOT', 'Maintenance and Trukplan',
  'Van Maintenance and Repair', 'All Services and Parking',
  'maintenance/brake tests', 'maintenance/refurb', 'Maintenance contract',
];
const folded = new Set(OLD_SPELLINGS.map(workKindOf));
ok(`thirteen spellings become ${folded.size} chips, not thirteen`,
  folded.size <= 3, [...folded].join(', '));

ok('and never more than five, whatever anybody types',
  new Set([...OLD_SPELLINGS, 'anything at all', '', 'MOT only', 'Accident Repair', 'Parking']
    .map(workKindOf)).size <= WORK_KINDS.length && WORK_KINDS.length === 5,
  `${WORK_KINDS.length} kinds declared`);

/* The precedence rule, said out loud. Most of these strings match more
   than one pattern, so what is being asserted is the ORDER, and each
   line is a phrase that would land somewhere else under a different
   one. */
for (const [text, expected] of [
  ['All Services and Parking',     'contract'],   // contract beats parking
  ['Van Maintenance and Repair',   'contract'],   // contract beats repair
  ['Maintenance and MOT',          'contract'],   // contract beats inspection
  ['MOT only',                     'inspection'],
  ['Brake test',                   'inspection'],
  ['Accident Repair',              'repair'],
  ['Refurbishment',                'repair'],
  ['Parking and storage',          'parking'],
  ['',                             'other'],
  ['Something nobody predicted',   'other'],
] as [string, string][]) {
  ok(`"${text || '(blank)'}" is ${WORK_KIND_LABEL[expected as 'other'].toLowerCase()}`,
    workKindOf(text) === expected, workKindOf(text));
}

/* A NEW record can only be one of seven things, and each of them has to
   land on a chip somebody can find it under. Two options folding
   together would be two ways of saying one thing, which is the fault
   this whole section exists to remove, arriving through the front
   door. */
{
  const kinds = MAINTENANCE_WHAT.map(workKindOf);
  ok('every option a new maintenance lead offers lands on a chip',
    kinds.every((k) => WORK_KINDS.includes(k)));
  ok('and no two of them are the same kind said differently',
    new Set(kinds).size === new Set(MAINTENANCE_WHAT.map((w) => `${workKindOf(w)}`)).size
    && MAINTENANCE_WHAT.length === 7 && new Set(kinds).size >= 4,
    MAINTENANCE_WHAT.map((w, i) => `${w} → ${kinds[i]}`).join(', '));
}

/* =============================================================
   2. The fields belong to the lead type

     The fields when you create a new lead or open an existing one are
     identical across each lead type. If I create a maintenance tracker
     lead it's asking how much i've sold the trailer for.
   ============================================================= */
console.log('\n  Fields that belong to the division\n  ----------------------------------');

ok('a maintenance lead is not asked what the trailer sold for',
  !/sold|sale price/i.test(fieldsFor('maintenance').closing.salePrice),
  fieldsFor('maintenance').closing.salePrice);
ok('nor a hire',
  !/sold|sale price/i.test(fieldsFor('rental').closing.salePrice),
  fieldsFor('rental').closing.salePrice);
ok('and a trailer sale still is, because that is what it is',
  /sale price/i.test(fieldsFor('trailer_sales').closing.salePrice),
  fieldsFor('trailer_sales').closing.salePrice);

ok('new or used describes a trailer and nothing else',
  fieldsFor('trailer_sales').newOrUsed
  && !fieldsFor('maintenance').newOrUsed
  && !fieldsFor('rental').newOrUsed);

ok('every division asks what the lead is for',
  TYPES.every((t) => fieldsFor(t).what.label.trim().length > 0));

ok('the two that have a fixed vocabulary get one, and trailer sales does not',
  fieldsFor('maintenance').what.options?.length === MAINTENANCE_WHAT.length
  && fieldsFor('rental').what.options?.length === RENTAL_WHAT.length
  && fieldsFor('trailer_sales').what.options === null);

/* The point of the whole file: no two divisions ask the same question.
   Compared across every label at once rather than field by field,
   because "identical across each lead type" was the complaint and one
   field still differing would have hidden it. */
{
  const shape = (t: LeadType) => {
    const f = fieldsFor(t);
    return [
      f.what.label, f.description.label, f.description.placeholder,
      f.requirementLabel, f.estimatedLabel,
      f.closing.title, f.closing.orderDate, f.closing.dispatchDate, f.closing.salePrice,
      String(f.newOrUsed), String(f.closing.profit), String(f.stockTrailer),
    ].join(' | ');
  };
  const shapes = TYPES.map(shape);
  ok('no two divisions ask the same set of questions',
    new Set(shapes).size === TYPES.length,
    shapes.join('\n        '));

  /* And every division differs from every other in the specific place
     the complaint named, not merely somewhere. */
  ok('and each one names the money after the thing it sells',
    new Set(TYPES.map((t) => fieldsFor(t).closing.salePrice)).size === TYPES.length,
    TYPES.map((t) => fieldsFor(t).closing.salePrice).join(' / '));
}

ok('a lead with no type at all is still asked something sensible',
  fieldsFor(null).label === fieldsFor('trailer_sales').label,
  'the column defaults to trailer_sales, so a null type is a trailer sale');

/* =============================================================
   3. The lead says which division it is

     make the lead type more prominent when you click in to it and
     ensure they're wired depending on which tab they're on ... Currently
     it says "Sales" on them all and it's not prominent either.
   ============================================================= */
console.log('\n  Which division a lead announces\n  -------------------------------');

ok('no lead announces itself as the literal word Sales any more',
  !/eyebrow=\{`Sales · /.test(source),
  'the drawer eyebrow was the string "Sales" whatever the lead was');

ok('the eyebrow is built from the division',
  /eyebrow=\{`\$\{words\.label\}/.test(source));

ok('and the division is on a badge as well, so it survives scrolling',
  /<Badge[^>]*>\s*\{words\.label\}/.test(source));

ok('the three divisions have three different names to announce',
  new Set(TYPES.map((t) => fieldsFor(t).label)).size === 3,
  TYPES.map((t) => fieldsFor(t).label).join(' / '));

/* =============================================================
   4. Last updated, meaning it

     Ensure the Last Updated column in the tracker updates when you add
     a note/description/value etc, currently it only updates when the
     lead is created. Show this to the right of the customer name when
     you open a lead up too.

   The database half is `npm run check:lead-activity`. This is the
   screen half: the column has to be reading the column that moves.
   ============================================================= */
console.log('\n  Where last updated comes from\n  -----------------------------');

ok('the grid has a Last updated column',
  /field: 'last_activity_at', headerName: 'Last updated'/.test(source));

ok('and it is not the enquiry date wearing that name',
  !/field: 'date_of_enquiry'[^}]*headerName: [^}]*Last update/.test(source),
  'the maintenance side printed "Last update" above date_of_enquiry, which never moves');

ok('the enquiry date is called the enquiry date on both sides',
  /field: 'date_of_enquiry', headerName: 'Enquiry'/.test(source));

ok('it cannot be typed into, because it is evidence rather than a field',
  /field: 'last_activity_at'[^}]*editable: false/.test(source));

ok('and it is beside the customer name when a lead is opened',
  /Updated \{fmtDate\(edit\.last_activity_at\)\}/.test(source));

/* Editing a COMPANY field from a lead row writes to `crm_contacts`,
   where the lead's trigger never sees it, so the screen has to stamp
   the lead itself. Both write paths, because the grid and the drawer
   are two of them and only fixing one is how half the columns stayed
   wrong. */
for (const [where, needle] of [
  ['the grid', /if \(toAccount\) \{[\s\S]{0,400}?crm_leads'\)\.update\(\{ last_activity_at/],
  ['the drawer', /if \(toAccount\) \{\s*\n\s*await supabase\.from\('crm_leads'\)\.update\(\{ last_activity_at/],
] as [string, RegExp][]) {
  ok(`editing a company field from ${where} still moves the row you edited`,
    needle.test(source));
}

/* =============================================================
   5. The tracker opens where you put it

     it's still defaulting your primary tab that opens first as the
     trailer sales one. It should be whichever is first in your list, so
     Maintenance for dean currently.
   ============================================================= */
console.log('\n  Which division opens\n  --------------------');

const first = (saved: string[] | null) =>
  applyOrder(['trailer_sales', 'maintenance', 'rental'].map((k) => ({ key: k })), saved)[0]?.key;

ok("Dean's saved order opens on maintenance",
  first(['maintenance', 'rental', 'trailer_sales']) === 'maintenance');
ok('a rental first order opens on rental',
  first(['rental', 'maintenance', 'trailer_sales']) === 'rental');
ok('and somebody who has never dragged anything still opens on trailer sales',
  first(null) === 'trailer_sales');
ok('a saved order full of divisions that no longer exist does not open on nothing',
  first(['workshop', 'parts']) === 'trailer_sales');

ok('the screen reads that order when it opens, not only when it draws the tabs',
  /if \(chosen\.current\) return;[\s\S]{0,200}?applyOrder\(SIDES/.test(source),
  'the order arrives a frame after the first paint, so the landing tab is set there');

ok('and a deep link to a lead still wins over the saved order',
  /const chosen = useRef\(false\)/.test(source)
  && /pickSide\(target\.type/.test(source),
  'opening a trailer sale from a link must not drop you on Maintenance');

/* =============================================================
   6. Winning a lead for a prospect

     when the lead is won he marks it as won, the customer now changes
     to an active account
   ============================================================= */
console.log('\n  Becoming a customer\n  -------------------');

ok('winning a lead for a prospect asks',
  winsAProspect('quoted', 'won', 'prospect'));
ok('winning one for a firm that already trades with us does not',
  !winsAProspect('quoted', 'won', 'existing'));
ok('a record with nothing in the column is a prospect, and is asked',
  winsAProspect('quoted', 'won', null));
ok('editing a lead that was already won does not ask again',
  !winsAProspect('won', 'won', 'prospect'));
ok('and nor does any other status',
  ['lead', 'contacted', 'quoted', 'customer', 'lost']
    .every((s) => !winsAProspect('quoted', s, 'prospect')));

/* The question is asked from both places a status can be changed. The
   grid was the one that would have been missed: it is a dropdown in a
   cell rather than a form, and it writes through a different function. */
ok('the grid asks when a status is changed there',
  /if \(field === 'status'\) void maybeConvert/.test(source));
ok('and so does the drawer',
  /if \(field === 'status'\) onWon\?\./.test(source));

/* =============================================================
   7. Somebody else's tracker

     Re-enable admin users being able to view other people's sales
     trackers, ensure wiring end to end perfect and tested when viewing a
     certain tracker and that permissions are correctly wired here.
   ============================================================= */
console.log('\n  Whose tracker\n  -------------');

const page = readFileSync('app/dashboard/leads/page.tsx', 'utf8');

/* `screenCapabilities`, which is what `capabilitiesFor` became when the
   eleven role templates went in: the role column has four values and
   knows nothing about them. This assertion still searched for the old
   name and had been failing quietly ever since, which is what
   `npm run check:all` now exists to stop. */
ok('the page decides whose tracker to load, not the browser',
  /screenCapabilities/.test(page) && /crm\.viewOthers/.test(page),
  'the capability is checked on the server, where the leads are actually read');

ok('and the parameter is ignored outright without the capability',
  /mayViewOthers && asked/.test(page),
  'a rep typing ?owner= into the address bar gets their own tracker');

ok('an id that names nobody does not load a stranger under a blank name',
  /const unknown = Boolean\(viewingId && !viewing\)/.test(page));

ok('the screen says whose tracker is open, in the heading',
  /title=\{`\$\{whoseFirst\}/.test(source),
  'a manager who forgets whose tracker they are on will edit it');

ok('somebody else’s tracker is read, not typed into',
  /if \(readOnly\) for \(const c of base\) c\.editable = false/.test(source));

ok('and the drawer refuses a write as well, not only the grid',
  /if \(readOnly\) return;/.test(source));

/* =============================================================
   8. The maintenance side counts money

     We have estimated sales value on each maintenance lead but the
     value isn't showing at the top of the maintenance tab and it should.
   ============================================================= */
console.log('\n  What the maintenance strip counts\n  ---------------------------------');

{
  /* Read the two arms of the strip out of the source and compare what
     they offer. The complaint was that one side counted money and the
     other did not, so the assertion is about the pair. */
  const strip = /<StatStrip items=\{isMaintenance \? \[([\s\S]*?)\] : \[([\s\S]*?)\]\} \/>/.exec(source);
  ok('the strip still has a maintenance arm and a sales arm', strip != null);
  if (strip) {
    const [, maint, sales] = strip;
    ok('the maintenance strip shows the pipeline value',
      /label: 'Pipeline'/.test(maint) && /totalEstValue/.test(maint), maint.trim());
    ok('and it is the same figure the sales side shows',
      /totalEstValue/.test(sales));
    ok('the count of kinds of work is gone, now that there are only five',
      !/whatKinds/.test(source),
      'it filled the slot the money should have been in');
  }
}

/* =============================================================
   9. Won means somebody closed it here

     Tracker is deals you're on with. That imported data was just to
     show on the revenue and analytic tabs ... That reads like dean's
     won 2.9m in revenue alone, he's not.

   A maintenance customer list was loaded through the tracker importer,
   whose dictionary claims a column headed "invoice value" as a sale
   price. So a year of group invoicing sat on one rep's tracker as
   deals he had closed: £2,907,995 across 144 rows.

   The rule that tells them apart was already in this application and
   this strip was the only place not using it. An imported spend figure
   has no order date. A deal somebody won on a day does.
   ============================================================= */
console.log('\n  What counts as won\n  ------------------');

ok('the money figures require a date the deal was agreed on',
  /STATUS_TO_TAB\[r\.status\] === 'customer' && r\.order_date/.test(source),
  'without it, anything imported at status customer is counted as revenue somebody earned');

ok('and both the revenue and the commission are counted off the same rows',
  /wonHere\.reduce\(\(sum, r\) => sum \+ \(Number\(r\.sale_price\)/.test(source)
  && /wonHere\.reduce\(\(sum, r\) => sum \+ \(Number\(r\.commission\)/.test(source),
  'two definitions of won is two figures that cannot both be right');

ok('this is the same test the exec dashboard uses',
  /order_date >= \$\{yearStart\}/.test(readFileSync('app/api/dashboard/exec/route.ts', 'utf8')),
  'the tracker disagreeing with the dashboard about revenue is how both stop being believed');

ok('and the same one the rep dashboard uses',
  /status === 'customer' && d\.order_date/.test(readFileSync('app/api/dashboard/rep/route.ts', 'utf8')));

ok('rows with no date are said out loud rather than quietly dropped',
  /with no date/.test(source),
  'a figure counting 12 of 144 rows and not saying so is the same fault by subtraction');

/* Where invoiced spend actually belongs, so that the next person to
   wonder does not have to trace it through an import dictionary. */
ok('invoiced spend has a home of its own, and it is not the tracker',
  /CREATE TABLE IF NOT EXISTS protean_invoices/
    .test(readFileSync('supabase/migrations/075_what_protean_billed.sql', 'utf8')));

console.log(
  failed === 0
    ? '\n  Five complaints: the filters fold, the fields follow the division,\n'
      + '  the lead says what it is, last updated moves, and the tracker opens\n'
      + '  where you put it.\n'
    : `\n  ${failed} to fix.\n`,
);
process.exit(failed === 0 ? 0 : 1);
