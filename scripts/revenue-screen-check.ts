/* =============================================================
   The revenue screen's render gate.

   Written because the screen shipped with the import unreachable. The
   tab bar was hidden while the database was empty, so the Import tab
   did not exist, so the buttons that switched to it did nothing. An
   empty database is not an edge case: it is how every installation
   starts, so that was the only state the screen was ever in.

   The first assertion below is that bug, and it is written as the
   sentence somebody would have said out loud.

   npm run check:revenue-screen
   ============================================================= */
import {
  whatToShow, canReachTheImport, nothingYet, REVENUE_TABS,
  type ScreenState, type RevenueTab,
} from '../lib/protean/screen';

let pass = 0, fail = 0;
const failures: string[] = [];
function ok(what: string, cond: boolean, got = '') {
  if (cond) { pass += 1; return; }
  fail += 1;
  failures.push(`  ${what}${got ? `\n      ${got}` : ''}`);
}

const state = (over: Partial<ScreenState> = {}): ScreenState => ({
  loading: false,
  tab: 'customers',
  customers: 0,
  groups: 0,
  openJobs: 0,
  waiting: 0,
  mayImport: true,
  ...over,
});

/* -------------------------------------------------------------
   1. THE BUG. A fresh database, and somebody who may import.
   ------------------------------------------------------------- */
{
  const fresh = state();
  ok('an empty database still draws the tab bar, so the import is reachable',
    whatToShow(fresh).tabs, JSON.stringify(whatToShow(fresh)));

  ok('and it invites somebody to import',
    whatToShow(fresh).invitation);

  /* The press itself. This is what did nothing: the tab changed and
     the body did not follow it. */
  const pressed = state({ tab: 'import' });
  ok('pressing Import shows the import panel on an empty database',
    whatToShow(pressed).body === 'import',
    JSON.stringify(whatToShow(pressed)));

  ok('and the invitation gets out of its way',
    !whatToShow(pressed).invitation);
}

/* -------------------------------------------------------------
   2. The invariant, over every combination that can occur.
   ------------------------------------------------------------- */
{
  let swept = 0;
  let unreachable: ScreenState | null = null;
  for (const tab of REVENUE_TABS) {
    for (const loading of [true, false]) {
      for (const mayImport of [true, false]) {
        for (const customers of [0, 12]) {
          for (const groups of [0, 3]) {
            for (const openJobs of [0, 40]) {
              for (const waiting of [0, 7]) {
                swept += 1;
                const s = state({ tab, loading, mayImport, customers, groups, openJobs, waiting });
                if (!canReachTheImport(s) && !unreachable) unreachable = s;
              }
            }
          }
        }
      }
    }
  }
  ok(`the import is reachable in all ${swept} states somebody can be in`,
    !unreachable, unreachable ? JSON.stringify(unreachable) : '');
}

/* -------------------------------------------------------------
   3. Somebody who may not import.
   ------------------------------------------------------------- */
{
  const viewer = state({ mayImport: false });
  ok('a viewer on an empty screen gets no tab bar to click at',
    !whatToShow(viewer).tabs);
  ok('but is still told why the screen is empty',
    whatToShow(viewer).invitation);

  /* A link, a bookmark or a stale address bar. The tab must not open
     for somebody the database would refuse. */
  const sneaking = state({ mayImport: false, tab: 'import', customers: 12 });
  ok('a stale ?tab=import cannot put a viewer on the import panel',
    whatToShow(sneaking).body === 'customers',
    String(whatToShow(sneaking).body));

  const readingData = state({ mayImport: false, customers: 12 });
  ok('a viewer with data to read still gets the tab bar',
    whatToShow(readingData).tabs);
}

/* -------------------------------------------------------------
   4. Loading is not empty.

   A screen that says "nothing has been imported yet" and then fills in
   has told somebody something false, and on this screen the false
   thing is "we have no revenue".
   ------------------------------------------------------------- */
{
  const reading = state({ loading: true });
  ok('nothing is called empty while it is still being read',
    !nothingYet(reading));
  ok('so no invitation is shown mid load',
    !whatToShow(reading).invitation);
  ok('and no totals are shown either, rather than a strip of zeroes',
    !whatToShow(reading).stats);
  ok('the body still draws, so the panel can say it is loading',
    whatToShow(reading).body === 'customers');
}

/* -------------------------------------------------------------
   5. An import whose accounts are all still waiting.

   The case that made `nothingYet` check five things instead of one.
   Every account unplaced means no customers and no groups, and the
   screen is very much not empty: there is a queue to work through.
   ------------------------------------------------------------- */
{
  const allUnplaced = state({ waiting: 199, customers: 0, groups: 0, openJobs: 0 });
  ok('an import with every account unplaced is not an empty screen',
    !nothingYet(allUnplaced));
  ok('so it shows the totals rather than inviting another import',
    whatToShow(allUnplaced).stats && !whatToShow(allUnplaced).invitation);

  const onlyOpenWork = state({ openJobs: 1008 });
  ok('open jobs on their own are not an empty screen either',
    !nothingYet(onlyOpenWork));
}

/* -------------------------------------------------------------
   6. Every tab reachable once there is something to look at.
   ------------------------------------------------------------- */
{
  const full = { customers: 180, groups: 13, openJobs: 1008, waiting: 4 };
  for (const tab of REVENUE_TABS) {
    const s = state({ ...full, tab });
    ok(`"${tab}" draws its own panel once there is data`,
      whatToShow(s).body === tab, String(whatToShow(s).body));
  }
}

console.log(`\n  ${pass}/${pass + fail} hold.\n`);
if (fail) {
  console.log('  failures:');
  for (const f of failures) console.log(f);
  process.exit(1);
}
console.log('  The import is reachable from every state, including the empty one '
  + 'every installation starts in.\n');
