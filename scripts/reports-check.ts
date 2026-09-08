/* =============================================================
   Do the reports actually produce what they promise?

   The catalogue declares each report's sections BEFORE it is run, so the
   screen can offer "include or exclude this data type" without having to
   run the report first to find out what is in it. That is a promise made
   in one file and kept in another, which is exactly the arrangement that
   silently drifts: rename a section id in the builder and the filter
   chip goes on being drawn, goes on being pressed, and stops doing
   anything at all.

   So this sweeps every report against every section, in both directions:

     included    every id the catalogue names comes back, in order
     excluded    switching one off removes exactly that one
     nothing     every section switched off is an empty report, not a
                 crash and not a full one

   It runs against a stub database rather than a real one, on purpose.
   The question here is whether the SHAPE holds, and the shape has to
   hold on an empty table as much as a full one: a section that
   disappears when it has no rows is a section that vanishes from a
   printed report on a quiet fortnight, and nobody notices until the
   meeting.

   npm run check:reports
   ============================================================= */
import { buildReport } from '../lib/reports/build';
import { REPORTS, reportBySlug, reportsByCategory } from '../lib/reports/catalogue';
import { fromParams, toParams, defaultFilters, printHref, docxHref } from '../lib/reports/link';
import {
  coverWords, periodStart,
  type Division, type Period, type ReportFilters, type Section,
} from '../lib/reports/types';

let pass = 0;
let fail = 0;
const failures: string[] = [];

function ok(what: string, cond: boolean, extra?: string) {
  if (cond) { pass += 1; return; }
  fail += 1;
  failures.push(`${what}${extra ? `  (${extra})` : ''}`);
}

/* -------------------------------------------------------------
   A database that answers everything with nothing.

   Every builder chains a different set of methods and then awaits the
   result, so the stub is a proxy that returns itself from any call and
   resolves to an empty set. Written as a proxy rather than a hand
   written mock because a hand written one has to be updated every time a
   builder learns a new method, and the failure when it is not is a
   confusing crash rather than a clear one.
   ------------------------------------------------------------- */
function emptyDb(broken: string[] = []): any {
  const make = (table: string): any => new Proxy({}, {
    get(_t, prop) {
      if (prop === 'then') {
        return (resolve: (v: unknown) => void) => resolve(
          broken.includes(table)
            ? { data: null, error: { message: `relation "${table}" does not exist` } }
            : { data: [], error: null },
        );
      }
      return () => make(table);
    },
  });
  return { from: (t: string) => make(t) };
}

const NO_FILTERS = defaultFilters();

/* -------------------------------------------------------------
   The catalogue holds together on its own.
   ------------------------------------------------------------- */
{
  const slugs = REPORTS.map((r) => r.slug);
  ok('every report slug is unique', new Set(slugs).size === slugs.length);

  for (const def of REPORTS) {
    ok(`${def.slug}: has at least one section`, def.sections.length > 0);
    const ids = def.sections.map((s) => s.id);
    ok(`${def.slug}: section ids are unique`, new Set(ids).size === ids.length);
    for (const s of def.sections) {
      ok(`${def.slug}/${s.id}: the filter chip has a label`, s.label.trim().length > 0);
    }
    ok(`${def.slug}: is findable by its own slug`, reportBySlug(def.slug)?.slug === def.slug);
    ok(`${def.slug}: has a title and a blurb`,
      def.title.trim().length > 0 && def.blurb.trim().length > 0);
  }

  ok('nothing is findable by a slug that does not exist', reportBySlug('not-a-report') === null);

  const grouped = reportsByCategory().flatMap((g) => g.reports);
  ok('every report appears in exactly one category', grouped.length === REPORTS.length);
  ok('the meeting report is in the first category',
    reportsByCategory()[0]?.reports.some((r) => r.slug === 'biweekly') === true);
}

/* -------------------------------------------------------------
   Every report runs, and produces the sections it declared.
   ------------------------------------------------------------- */
async function sweepSections() {
  for (const def of REPORTS) {
    const made = await buildReport(emptyDb(), def.slug, NO_FILTERS);
    if ('error' in made) {
      ok(`${def.slug}: runs`, false, made.error);
      continue;
    }
    ok(`${def.slug}: runs`, true);

    const got = made.sections.map((s) => s.id);
    const want = def.sections.map((s) => s.id);
    ok(`${def.slug}: produces every declared section, in order`,
      JSON.stringify(got) === JSON.stringify(want),
      `declared ${want.join(', ')} / produced ${got.join(', ')}`);

    ok(`${def.slug}: the title on the page matches the catalogue`, made.title === def.title);
    ok(`${def.slug}: says what it covers`, made.subtitle.trim().length > 0);
    ok(`${def.slug}: says when it was run`, !Number.isNaN(Date.parse(made.generatedAt)));

    /* Every section has to be drawable. A table with no columns and a
       list with no empty line are both a blank space on a printed page
       with a heading over it, which reads as a section that failed to
       load rather than one with nothing in it. */
    for (const s of made.sections) {
      ok(`${def.slug}/${s.id}: is one of the four kinds`,
        ['stats', 'table', 'list', 'note'].includes(s.kind));
      if (s.kind === 'table') {
        ok(`${def.slug}/${s.id}: the table has columns`, s.columns.length > 0);
        ok(`${def.slug}/${s.id}: says so when there is nothing in it`,
          (s.empty ?? '').trim().length > 0);
      }
      if (s.kind === 'list') {
        ok(`${def.slug}/${s.id}: says so when there is nothing in it`,
          (s.empty ?? '').trim().length > 0);
      }
      if (s.kind === 'stats') {
        ok(`${def.slug}/${s.id}: the stat strip has figures on it`, s.stats.length > 0);
        for (const st of s.stats) {
          ok(`${def.slug}/${s.id}: "${st.label}" has a value`, String(st.value).length > 0);
        }
      }
    }
  }
}

/* -------------------------------------------------------------
   Switching a section off removes exactly that section.

   The whole point of the business asking for include and exclude. A
   chip that removes the wrong section, or removes nothing, is worse
   than no chip: the report still prints and the reader has no way to
   tell it printed the wrong thing.
   ------------------------------------------------------------- */
async function sweepExclusions() {
  for (const def of REPORTS) {
    for (const s of def.sections) {
      const made = await buildReport(emptyDb(), def.slug, { ...NO_FILTERS, exclude: [s.id] });
      if ('error' in made) { ok(`${def.slug}: runs without ${s.id}`, false, made.error); continue; }
      const got = made.sections.map((x) => x.id);
      const want = def.sections.map((x) => x.id).filter((x) => x !== s.id);
      ok(`${def.slug}: switching off "${s.label}" removes exactly it`,
        JSON.stringify(got) === JSON.stringify(want),
        `expected ${want.join(', ')} / got ${got.join(', ')}`);
    }

    /* Everything off. An empty report rather than a crash, and rather
       than one that quietly ignores the filter and prints the lot. */
    const all = def.sections.map((s) => s.id);
    const bare = await buildReport(emptyDb(), def.slug, { ...NO_FILTERS, exclude: all });
    if ('error' in bare) { ok(`${def.slug}: survives every section switched off`, false); continue; }
    ok(`${def.slug}: every section switched off is an empty report`, bare.sections.length === 0);
  }
}

/* -------------------------------------------------------------
   A report on an installation missing a table says so.

   Protean, FleetSmart+ and the stock list are all things a deployment
   might not have loaded yet, and a report is read by a finance director.
   A zero on that page is a claim about the business. A sentence saying
   the table is not there is not.
   ------------------------------------------------------------- */
async function sweepMissingTables() {
  const missing = ['protean_invoices', 'protean_open_jobs', 'fleetsmart_contracts', 'stock_trailers'];
  for (const def of REPORTS) {
    const made = await buildReport(emptyDb(missing), def.slug, NO_FILTERS);
    if ('error' in made) { ok(`${def.slug}: runs on an installation missing tables`, false); continue; }
    ok(`${def.slug}: runs on an installation missing tables`, true);
    ok(`${def.slug}: still produces every declared section`,
      made.sections.length === def.sections.length);

    for (const s of made.sections) {
      if (s.kind !== 'note') continue;
      ok(`${def.slug}/${s.id}: the missing table is explained rather than shown as a zero`,
        /not on this installation|nothing to/i.test(s.text), s.text);
    }
  }
}

/* -------------------------------------------------------------
   Nothing invents a number.

   Every figure a report prints has to come from a table. Nothing here
   can prove that on its own, but it can prove the one rule that was
   actually broken once: a won deal is a deal WITH AN ORDER DATE. The
   tracker summed `sale_price` without that test and printed a year of
   imported invoicing as revenue somebody had won.
   ------------------------------------------------------------- */
{
  const source = require('fs').readFileSync('lib/reports/build.ts', 'utf8') as string;
  const wonQueries = source.split('\n')
    .map((line, i) => ({ line, at: i + 1 }))
    .filter((l) => /\.eq\('status', 'customer'\)/.test(l.line));
  ok('the builder asks for won deals somewhere', wonQueries.length > 0);
  for (const q of wonQueries) {
    /* The order date test is the next line or the one after it. Read as
       text rather than by running a query, because the thing being
       asserted is that nobody deletes the line. */
    const after = source.split('\n').slice(q.at, q.at + 3).join('\n');
    ok(`build.ts:${q.at}: a won deal must have an order date`,
      /not\('order_date', 'is', null\)/.test(after));
  }
}

/* -------------------------------------------------------------
   A report in a URL survives the round trip.

   Four readers have to agree about what a filtered report looks like as
   text. They agree because there is one encoder and one decoder, and
   this is what says so.
   ------------------------------------------------------------- */
{
  const divisions: Division[][] = [[], ['stc'], ['rental'], ['stc', 'trailer'], ['stc', 'trailer', 'rental']];
  const periods: Period[] = ['week', 'fortnight', 'month', 'quarter', 'fy', 'year'];
  const people = [null, 'a1b2c3d4-0000-0000-0000-000000000001'];

  for (const def of REPORTS) {
    const excludes = [[], [def.sections[0]!.id], def.sections.map((s) => s.id)];
    for (const d of divisions) {
      for (const p of periods) {
        for (const who of people) {
          for (const ex of excludes) {
            const before: ReportFilters = { divisions: d, period: p, person: who, exclude: ex };
            const after = fromParams(def.slug, toParams(def.slug, before));

            /* All three divisions and none of them are the same
               request, and the encoder writes the shorter one. The
               decoder gives back the empty list, which every builder
               already reads as "all of them". */
            const expectDivisions = d.length === 3 ? [] : d;
            ok(`${def.slug}: divisions survive the round trip`,
              JSON.stringify(after.divisions) === JSON.stringify(expectDivisions),
              `${JSON.stringify(d)} came back as ${JSON.stringify(after.divisions)}`);
            ok(`${def.slug}: the period survives the round trip`, after.period === p);
            ok(`${def.slug}: the person survives the round trip`, after.person === who);
            ok(`${def.slug}: the excluded sections survive the round trip`,
              JSON.stringify(after.exclude) === JSON.stringify(ex));
          }
        }
      }
    }
  }

  /* Rubbish in a link is dropped, not obeyed and not refused. A stale
     link somebody forwarded has to open the whole report rather than a
     quietly emptier one. */
  const junk = fromParams('biweekly', new URLSearchParams(
    'slug=biweekly&divisions=stc,marketing,;drop&period=decade&exclude=health,not-a-section',
  ));
  ok('an unknown division is dropped', JSON.stringify(junk.divisions) === JSON.stringify(['stc']));
  ok('an unknown period falls back to the default', junk.period === 'fortnight');
  ok('an unknown section id is dropped', JSON.stringify(junk.exclude) === JSON.stringify(['health']));

  ok('the print link and the Word link carry the same filters',
    printHref('won', { divisions: ['stc'], period: 'week', person: 'x', exclude: ['deals'] })
      .split('?')[1]
    === docxHref('won', { divisions: ['stc'], period: 'week', person: 'x', exclude: ['deals'] })
      .split('?')[1]);

  ok('a report with no filters has a short link',
    printHref('biweekly', defaultFilters()) === '/export/report?slug=biweekly');
}

/* -------------------------------------------------------------
   The period is the one every other screen uses.

   A report saying "this financial year" and the Revenue tab saying
   "this financial year" and meaning two different Aprils is worse than
   either being wrong on its own.
   ------------------------------------------------------------- */
{
  const inApril = new Date(Date.UTC(2026, 4, 12));   // 12 May 2026
  const inMarch = new Date(Date.UTC(2026, 1, 12));   // 12 February 2026
  ok('the financial year starts in the April just gone',
    periodStart('fy', inApril).toISOString().slice(0, 10) === '2026-04-01');
  ok('in February, the financial year is the previous April',
    periodStart('fy', inMarch).toISOString().slice(0, 10) === '2025-04-01');
  ok('a fortnight is fourteen days',
    Math.round((inApril.getTime() - periodStart('fortnight', inApril).getTime()) / 86400000) === 14);

  ok('the cover line names the period and the divisions',
    /two weeks/i.test(coverWords({ ...NO_FILTERS }, inApril))
    && /all divisions/i.test(coverWords({ ...NO_FILTERS }, inApril)));
  ok('one division is named rather than counted',
    /Rentals/.test(coverWords({ ...NO_FILTERS, divisions: ['rental'] }, inApril)));
}

/* -------------------------------------------------------------
   No em dashes in anything a report prints.

   The repository wide ban, asserted where it is easiest to break: a
   report is prose, written to be read out loud, and the one glyph that
   stays allowed is the standalone "no value here" placeholder in a
   table cell.
   ------------------------------------------------------------- */
async function sweepPunctuation() {
  const banned = /[–—―]/;
  for (const def of REPORTS) {
    const made = await buildReport(emptyDb(), def.slug, NO_FILTERS);
    if ('error' in made) continue;

    const said: string[] = [made.title, made.subtitle, def.blurb, ...def.sections.map((s) => s.label)];
    for (const s of made.sections as Section[]) {
      if (s.kind === 'note') { said.push(s.title ?? '', s.text); continue; }
      said.push(s.title, s.note ?? '');
      if (s.kind === 'table') said.push(s.empty ?? '', ...s.columns.map((c) => c.label));
      if (s.kind === 'list') said.push(s.empty ?? '');
      if (s.kind === 'stats') said.push(...s.stats.flatMap((x) => [x.label, x.sub ?? '']));
    }
    for (const text of said) {
      ok(`${def.slug}: "${text.slice(0, 44)}" has no em dash`, !banned.test(text), text);
    }
  }
}

(async () => {
  await sweepSections();
  await sweepExclusions();
  await sweepMissingTables();
  await sweepPunctuation();

  console.log(`\n${pass}/${pass + fail} passing`);
  if (failures.length) {
    console.log('\nfailures:');
    for (const f of failures.slice(0, 40)) console.log(`  ${f}`);
    if (failures.length > 40) console.log(`  ... and ${failures.length - 40} more`);
  }
  if (fail) process.exit(1);
})();
