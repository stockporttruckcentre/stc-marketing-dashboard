/* =============================================================
   What the import screen says about what it just did.

   From the business, after importing the same file twice and reading
   "New 0, Updated 382, Left out 0":

     The message in the app says all 382 invoices ignored, clearly a
     broken notification. These things need fixing if they're broken,
     not just explaining to me.

   Every figure on that screen was correct. Read by a person about to
   present the numbers, it said the import had refused the file.

   So this asserts the SENTENCE, not the figures: that each of the four
   outcomes says plainly what happened, and that the one which caused
   this never again reads as a refusal.

   Run with `npm run check:import-wording`.
   ============================================================= */
import { readFileSync } from 'node:fs';
import { whatHappened } from '../lib/protean/import-wording';

let bad = 0;
const ok = (what: string, held: boolean, why?: string) => {
  console.log(`  ${held ? 'ok  ' : 'FAIL'}  ${what}`);
  if (!held) { bad += 1; if (why) console.log(`        ${why}`); }
};
const head = (s: string) => console.log(`\n  ${s}\n  ${'-'.repeat(s.length)}`);

const SRC = 'components/revenue/import-panel.tsx';

/* Imported, not lifted out of the screen's source. The wording lives in
   `lib/protean/import-wording.ts` precisely so the screen and this
   check read the same words. */
const say = whatHappened;
const row = (nw: number, up: number, sk = 0) => ({
  rows_read: nw + up + sk, rows_new: nw, rows_updated: up, rows_skipped: sk,
  accounts_new: 0, rows_unmatched: 0,
});

head('The four things that can happen, each said plainly');

{
  const s = say(row(382, 0), 'invoices', null);
  ok('all new: it says so', /all 382 invoices were new/i.test(s), s);
}

{
  const s = say(row(377, 5), 'invoices', null);
  ok('mostly new: both numbers are in the sentence',
    s.includes('377') && s.includes('5'), s);
  ok('and it says why some were already there',
    /normal when a file covers dates you have already loaded/i.test(s), s);
}

{
  const s = say(row(0, 382), 'invoices', null);
  /* THE ONE THAT CAUSED THIS. */
  ok('none new: it says nothing was added AND nothing was duplicated',
    /nothing was added/i.test(s) && /nothing was.*duplicated/i.test(s), s);
  ok('and it never says the file was ignored, refused or skipped',
    !/ignored|refused|skipped|rejected/i.test(s), s);
  ok('and it does not lead with a bare zero',
    !s.trimStart().startsWith('0'), s);
}

{
  const s = say(row(0, 382), 'invoices', '13:41');
  ok('and when the earlier import is known, it names the time',
    s.includes('13:41') && /already on the system/i.test(s), s);
}

{
  const s = say(row(0, 0, 12), 'invoices', null);
  ok('nothing usable: it says so, with the count and the reason',
    /^none of the /i.test(s) && /could be used/i.test(s) && s.includes('12')
    && !/were new|already on the system/i.test(s), s);
}

head('Jobs are called jobs, not invoices');
{
  const s = say(row(922, 0), 'open_jobs', null);
  ok('an open jobs file talks about jobs', /jobs/i.test(s) && !/invoice/i.test(s), s);
}

head('Every row is accounted for, sheet to database');
{
  const src = readFileSync(SRC, 'utf8');
  /* ---- The blind spot this closes ----

     "Left out" is `rows_skipped`, which the DATABASE reports about rows
     it refused. Rows the READER discards never reach the database, so a
     file could lose most of itself and the screen would still say
     "Left out 0". Nothing counted them and nothing showed them. */
  ok('the screen is told how many rows the sheet had',
    src.includes('inFile: d.read.read'),
    'without the file\u2019s own row count there is nothing to reconcile against');
  ok('and how many the reader could not read',
    src.includes('unreadable: d.read.unusable'));
  ok('and how many were the padding the rental export adds',
    src.includes('bare: d.read.blank'));
  ok('the unreadable count is drawn, and in the danger colour when it is not zero',
    src.includes("s.unreadable > 0 ? 'var(--danger)'")
    && src.includes('could not be read and did NOT go in'),
    'a row that vanished between the sheet and the database has to be loud');
  ok('and it says plainly when none were lost',
    src.includes('None were unreadable'),
    'silence reads as "not checked"');
}

head('The screen says which import the figures are from');
{
  const src = readFileSync(SRC, 'utf8');
  ok('the heading does not claim to cover earlier imports',
    src.includes('Earlier imports are not counted here'),
    'the panel shows one run, and saying so is the difference between a '
    + 'confusing number and a wrong one');
  ok('and the sentence is drawn above the figures',
    src.indexOf('whatHappened(s.result') < src.indexOf('label="New"'),
    'the words have to come before the numbers, or they are read second');
}

console.log(bad === 0
  ? '\n  The import screen says what it did in words a person can act on.\n'
  : `\n  ${bad} failed.\n`);
process.exit(bad === 0 ? 0 : 1);
