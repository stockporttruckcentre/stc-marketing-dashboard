/* =============================================================
   Do the screens actually reach each other.

   ---- Why this file exists ----

   From the business, on the day this goes to five departments:

     Are you actually checking these proposal generations are FULLY
     wired up ... this has to be a working enterprise product all wired
     end to end and communicating across accounts and roles and
     departments and permissions and delegation and stock and leads etc
     all linked together. It feels so disconnected right now.

   It felt disconnected because in places it was. Three examples, all
   found by following a click rather than by reading a file:

     a customer picked in the CRM, then asked for again by the builder
     a stock picker written, and rendered by nothing
     a stock record asking "whose tracker is this on" of a column that
       only ever held the first unit of a quote

   None of those is a broken function. Each is a seam where one screen
   hands off to another and drops something on the way, and no test of
   either screen alone would notice.

   So this asserts the SEAMS. Every one is a claim of the form "screen A
   passes X to screen B, and screen B reads it", written as a pair, so
   that changing one half fails rather than silently ending the journey
   somewhere useless.

   Run with `npm run check:wiring`.
   ============================================================= */
import { readFileSync } from 'node:fs';

let failed = 0;
const ok = (what: string, cond: boolean, why = '') => {
  if (cond) { console.log(`  ok    ${what}`); return; }
  console.log(`  FAIL  ${what}${why ? `\n        ${why}` : ''}`);
  failed += 1;
};

const read = (p: string) => readFileSync(p, 'utf8');

const picker   = read('components/crm/GenerateProposalPicker.tsx');
const fleet    = read('components/FleetSmart.tsx');
const drawer   = read('components/crm/ContactDrawer.tsx');
const tracker  = read('components/SalesTracker.tsx');
const stock    = read('components/StockList.tsx');
const leadPage = read('app/dashboard/leads/page.tsx');
const checkLink = read('app/api/tracker/check-link/route.ts');
const leadTrailers = read('components/crm/LeadTrailers.tsx');

/* =============================================================
   1. A customer chosen in the CRM stays chosen
   ============================================================= */
console.log('\n  CRM record to the FleetSmart+ builder\n  ------------------------------------');

ok('the record offers FleetSmart+ at all',
  /id: 'fleetsmart'/.test(picker),
  'the proposal picker had four kinds and none of them was the contract builder');

ok('and it carries the customer in the link',
  /\/dashboard\/fleetsmart\?new=1&contact=\$\{contactId\}/.test(picker));

ok('the builder reads that customer',
  /startNew\(params\.get\('contact'\)\)/.test(fleet),
  'without this the parameter is carried and ignored, which is the same as not carrying it');

ok('and fills the contract from the CRM rather than from an empty form',
  /fillFrom\(account, \{/.test(fleet));

ok('through the same function the picker inside the wizard uses',
  /from '@\/lib\/fleetsmart\/account'/.test(fleet)
  && /fillFrom/.test(read('lib/fleetsmart/account.ts')),
  'two filling rules is how arriving with a customer and choosing one give different contracts');

ok('FleetSmart+ does not also raise a proposal on the way',
  /if \('direct' in kind && kind\.direct\)/.test(picker),
  'the builder raises its own lead when the contract saves, so both would be two records for one pitch');

/* =============================================================
   2. A quote and the units it is for
   ============================================================= */
console.log('\n  Trailer sales leads and the stock list\n  -------------------------------------');

ok('a trailer sales lead has somewhere to put a unit',
  /<LeadTrailers leadId=\{row\.id\}/.test(tracker));

ok('and only trailer sales does, because the other two do not sell stock',
  /words\.stockTrailer && \(\s*\n\s*<LeadTrailers/.test(tracker),
  'a maintenance contract is about a fleet the customer owns; a hire comes back');

ok('the picker searches more than the stock number',
  /const SEARCHABLE = \['stc_no', 'chassis_number', 'make', 'model', 'description'\]/
    .test(read('components/crm/StockSearch.tsx')));

ok('and narrows by what it is, where it is, and whether it can be sold',
  /Field label="What it is"/.test(read('components/crm/StockSearch.tsx'))
  && /Field label="Where it is"/.test(read('components/crm/StockSearch.tsx'))
  && /Field label="Availability"/.test(read('components/crm/StockSearch.tsx')));

ok('attaching goes through the database operation, not three statements in a browser',
  /rpc\('crm_attach_trailer'/.test(leadTrailers));

ok('the stock record can put a unit on a deal that already exists',
  /<LeadPicker/.test(stock) && /rpc\('crm_attach_trailer'/.test(stock));

ok('and that is a different button from Send to my tracker, which raises a new one',
  /Send to my tracker/.test(stock) && /Add to a deal/.test(stock),
  'both are needed: one for a walk-in, one for a conversation already open');

ok('"whose tracker is this unit on" asks the join table',
  /FROM crm_lead_trailers lt/.test(checkLink),
  'asked of stock_trailer_id, a unit second on a three unit quote reads as free');

/* =============================================================
   3. Whose tracker, end to end
   ============================================================= */
console.log('\n  Whose tracker\n  -------------');

ok('the capability is checked on the server, where the leads are read',
  /capabilitiesFor/.test(leadPage) && /crm\.viewOthers/.test(leadPage));

ok('and the component is keyed on the owner, so its rows cannot outlive the switch',
  /key=\{ownerId\}/.test(leadPage),
  'this is the bug: a useState initialiser runs on mount and never again');

ok('the picker navigates rather than holding its own idea of who is being viewed',
  /router\.push\(e\.target\.value/.test(tracker),
  'so a link to a colleague’s tracker works when it is pasted into a message');

ok('and the buttons beside it do not move when it is used',
  /disabled=\{readOnly\}[\s\S]{0,200}?Import/.test(tracker));

/* =============================================================
   4. What the CRM record can start
   ============================================================= */
console.log('\n  The CRM record’s own actions\n  ----------------------------');

for (const [what, needle] of [
  ['a proposal', /setShowProposal\(true\)/],
  ['a reminder, which lands in Work', /setShowReminder\(true\)/],
  ['a meeting', /setShowSchedule\(true\)/],
  ['an export', /\/export\/crm\/\$\{contact\.id\}/],
] as [string, RegExp][]) {
  ok(`the record can start ${what}`, needle.test(drawer));
}

ok('the reminder is a task rather than a fourth kind of record',
  /'\/api\/work\/tasks'/.test(read('components/crm/ReminderModal.tsx')),
  'a second list of things people owe is how two of them disagree');

ok('and the dashboard reads those tasks, so a reminder for today is on the page they open',
  /kind: 'task' as const/.test(read('app/api/dashboard/rep/route.ts')));

/* =============================================================
   The red, amber, green dot, and what an empty cell means

   Two halves of one rule, in two files, which is exactly the shape that
   drifts. The grid draws the dot and the drawer draws the buttons, and
   if one of them decides a green prospect is "Fine" while the other
   decides it is "not set", the record contradicts the list it came
   from.

   From the business, in two messages:

     green blip should be default for all customers and show regardless

     ensure it doesn't show for leads, we have no clue what the status
     is until we've made contact. One can manually be set but don't show
     one by default until they're actually at Customer status.
   ============================================================= */
console.log('\n  Red, amber, green\n  -----------------');

const crmGrid = read('components/CrmWorkspace.tsx');
const healthPanel = read('components/crm/HealthPanel.tsx');

ok('a customer with nothing wrong still carries a dot',
  /const level = \(\(p\.value as Health\) \?\? 'green'\)/.test(crmGrid)
  && !/if \(level === 'green'\) return null;/.test(crmGrid),
  'an empty cell reads as "not set", which is the one thing this column exists to answer');

ok('and a prospect does not, because nobody has established anything yet',
  /if \(level === 'green' && p\.data\?\.status !== 'customer'\) return null;/.test(crmGrid),
  'a green dot on a lead is a claim nobody has grounds to make');

ok('amber and red are drawn whatever the status, because somebody set them',
  /if \(level === 'green' && /.test(crmGrid),
  'the guard has to be on green alone: a complaint from a prospect mid quote is what this is for');

ok('the drawer applies the same rule to its own buttons',
  /const settled = level !== 'green' && false/.test(healthPanel) === false
  && /const settled = level !== 'green' \|\| contact\.status === 'customer';/.test(healthPanel),
  'a highlighted Fine button on a lead contradicts the blank cell the list showed');

ok('and says so rather than claiming nothing is outstanding',
  /'Not set\. Nothing has been raised\.'/.test(healthPanel));

ok('the dot still sorts worst first',
  /comparator: \(a, b\) => healthRank\(a as Health\) - healthRank\(b as Health\)/.test(crmGrid));

console.log(
  failed === 0
    ? '\n  Every seam checked here hands its argument on, and the screen at the\n'
      + '  far end reads it. Where one half changes, this file fails.\n'
    : `\n  ${failed} to fix.\n`,
);
process.exit(failed === 0 ? 0 : 1);
