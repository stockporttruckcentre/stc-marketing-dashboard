/* =============================================================
   How far back an export goes.

   Date arithmetic that ends up in a spreadsheet a finance team acts on.
   The two ways it goes wrong quietly are a month roll on a 31st, and a
   period that silently changes what "this year" means.

   npm run check:export-window
   ============================================================= */
import { exportWindow, inWindow, iso } from '../lib/protean/export-window';

let pass = 0, fail = 0;
const failures: string[] = [];
function ok(what: string, cond: boolean, got = '') {
  if (cond) { pass += 1; return; }
  fail += 1;
  failures.push(`  ${what}${got ? `\n      ${got}` : ''}`);
}

const on = (s: string) => new Date(`${s}T12:00:00`);

/* -------------------------------------------------------------
   1. Calendar months, not ninety day blocks.
   ------------------------------------------------------------- */
{
  ok('three months back from 2 September is 2 June',
    exportWindow('3', null, on('2026-09-02')).from === '2026-06-02',
    String(exportWindow('3', null, on('2026-09-02')).from));
  ok('six months back from 2 September is 2 March',
    exportWindow('6', null, on('2026-09-02')).from === '2026-03-02',
    String(exportWindow('6', null, on('2026-09-02')).from));
  ok('twelve months back from 2 September is 2 September a year before',
    exportWindow('12', null, on('2026-09-02')).from === '2025-09-02',
    String(exportWindow('12', null, on('2026-09-02')).from));
}

/* -------------------------------------------------------------
   2. THE 31ST. Setting a month on a long date rolls into the next one.

   Naively, 31 May minus three months is 31 February, which JavaScript
   turns into 3 March. The export would then say "the last 3 months"
   and start LATER than three months ago, quietly dropping February.
   ------------------------------------------------------------- */
{
  const w = exportWindow('3', null, on('2026-05-31'));
  ok('three months back from 31 May is 28 February, not 3 March',
    w.from === '2026-02-28', String(w.from));

  const leap = exportWindow('12', null, on('2028-02-29'));
  ok('a year back from 29 February lands in February',
    leap.from!.startsWith('2027-02'), String(leap.from));

  const m = exportWindow('1' as never, null, on('2026-03-31'));
  ok('an unknown period falls back to the financial year rather than to nothing',
    m.from === null || m.label.includes('this year') || m.label.includes('to today'),
    JSON.stringify(m));
}

/* -------------------------------------------------------------
   3. Everything is not the same as a window starting early.
   ------------------------------------------------------------- */
{
  const all = exportWindow('all', '2026-04-01', on('2026-09-02'));
  ok('everything has no start at all', all.from === null, String(all.from));
  ok('and says so', all.label === 'everything we hold', all.label);

  ok('an invoice from 2019 is inside "everything"',
    inWindow('2019-01-01', all));
  ok('and outside the last three months',
    !inWindow('2019-01-01', exportWindow('3', null, on('2026-09-02'))));
}

/* -------------------------------------------------------------
   4. The financial year comes from the setting, never from a month
      typed here.
   ------------------------------------------------------------- */
{
  const april = exportWindow('fy', '2026-04-01', on('2026-09-02'));
  ok('the financial year window starts where the year started',
    april.from === '2026-04-01', String(april.from));
  ok('and names the date rather than saying "financial"',
    april.label.includes('Apr 2026'), april.label);

  const january = exportWindow('fy', '2026-01-01', on('2026-09-02'));
  ok('a January year starts in January, from the same setting',
    january.from === '2026-01-01', String(january.from));

  const unset = exportWindow('fy', null, on('2026-09-02'));
  ok('with nothing set it filters nothing rather than guessing a month',
    unset.from === null, String(unset.from));
}

/* -------------------------------------------------------------
   5. A row with no date is never filtered out.

   An invoice always has a tax point. A job may have no logged date, and
   dropping it from an export because of that would lose real work with
   nothing saying so.
   ------------------------------------------------------------- */
{
  const w = exportWindow('3', null, on('2026-09-02'));
  ok('a row with no date stays in', inWindow(null, w));
  ok('a row on the first day stays in', inWindow('2026-06-02', w));
  ok('a row the day before does not', !inWindow('2026-06-01', w));
  ok('a row today stays in', inWindow(iso(on('2026-09-02')), w));
}

console.log(`\n  ${pass}/${pass + fail} hold.\n`);
if (fail) {
  console.log('  failures:');
  for (const f of failures) console.log(f);
  process.exit(1);
}
console.log('  A period filters the rows and never quietly changes what "this year" means.\n');
