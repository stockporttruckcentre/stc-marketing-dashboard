/* =============================================================
   The Personal portfolio, driven end to end in a browser.

   From the business:

     then end to end check the page, and again, and again. I keep
     having to prompt you to fix stuff you're missing as you're not
     checking.

   Every fault on this page today was found by a person looking at it:
   a tile reading "Not known" about a figure the app had worked out, a
   table with no column headings, two cards £204,000 apart about one
   person's year. None of those needed a database to find. They needed
   somebody to look at the rendered page and read it.

   So this does. It mounts the real component, answers its Supabase
   calls in the browser with a fixture built to be AWKWARD, and then
   reads the screen back the way a person would.

   ---- The five rules it holds the page to ----

   1. NO FIGURE THE APP WORKED OUT SAYS "NOT KNOWN". That sentence is
      for a number nobody has, and it was drawn over four accepted
      contracts the app had priced itself.

   2. TWO CARDS ABOUT ONE THING AGREE. Towards target and the invoiced
      change are one number. They were £204,000 apart and the smaller
      one was what a commission got paid against.

   3. EVERY PERCENTAGE SAYS WHAT IT IS A PERCENTAGE OF. There were two
      on this page, 8.7 and 16.0, meaning different things, neither
      labelled, a few centimetres apart.

   4. EVERY TABLE OF FIGURES HAS COLUMN HEADINGS. Asked for twice.

   5. NO LABEL DESCRIBES ARITHMETIC THE PAGE NO LONGER DOES. "Won
      tracker work plus FleetSmart+ invoiced" outlived the sum it
      described by an hour.

   Needs `npm run dev`. Run with `npm run check:personal-page`.
   ============================================================= */
import { chromium, type Page } from 'playwright';

const AT = 'http://localhost:3000/personal-preview';

/* ---- The fixture, made awkward on purpose ----

   A portfolio that grew, a person whose tracker says far less than
   their book, four FleetSmart+ contracts that are all also tracker
   deals (which is what made both money columns vanish), a customer
   that fell, and one that was billed the same both years. A fixture
   where everything is going well proves the page renders. */
const THIS_YEAR = 1856816.86;
const LAST_YEAR = 1601134.30;
const CHANGE = 255682.56;
const CHANGE_PCT = 16.0;
const TARGET = 600000;
const ACHIEVED = 42.6;
const TO_GO = 344317.44;
const FS_WON = 38254.52;
const FS_INVOICED = 195.04;

/* The tracker's own figures, and the reason they are written as sums
   rather than as three unrelated constants. The tile read £52k over a
   table whose two rows came to £89k, because the tile had the
   FleetSmart+ contracts taken out of it and the table did not. A
   fixture where the parts do not add to the whole cannot catch that,
   so here the whole IS the parts. */
const WON_MAINTENANCE = FS_WON;
const WON_RENTAL = 51778.66;
const WON_TRAILER = 171245;
const TRACKER = WON_MAINTENANCE + WON_RENTAL;

const OPEN_MAINTENANCE = 404647.31;
const OPEN_RENTAL = 397800;
const OPEN_TRAILER = 267000;
const OPEN = OPEN_MAINTENANCE + OPEN_RENTAL + OPEN_TRAILER;

/* What Dean's ten undated wins are worth, as live holds them. None of
   the ten carries a sale price, which read as "worth nothing" until
   the database was asked: `lead_worth` falls back to the estimate for
   a won deal, so they are worth this and it is missing from Closed on
   the tracker. A notice that showed only the count could never have
   said so. */
const UNDATED_MAINTENANCE = 35000;
const UNDATED_TRAILER = 10950;
const UNDATED = UNDATED_MAINTENANCE + UNDATED_TRAILER;

/* And which figure each gap belongs to, as live holds them. The old
   notice said "70 deals carry no figure" about the open pipeline, when
   20 of the 70 were lost deals and 8 were wins. Only 42 are open. */
const UNPRICED_OPEN_M = 34;
const UNPRICED_OPEN_T = 8;
const UNPRICED_OPEN = UNPRICED_OPEN_M + UNPRICED_OPEN_T;
const UNPRICED_WON = 8;
const UNDATED_PRICED = 2;
const OPEN_DEALS = 51 + 2 + 6;   // the three rows' open_count, as the page sums them

/* The app's own `compactMoney`, restated here on purpose. The check
   has to know what the screen SHOULD say without importing the code
   that decides it, or a formatting bug would agree with itself. */
const compact = (n: number) => {
  const v = Math.round(n);
  const a = Math.abs(v);
  const sign = v < 0 ? '\u2212' : '';
  if (a >= 1_000_000) return `${sign}£${(a / 1_000_000).toFixed(1).replace(/\.0$/, '')}m`;
  if (a >= 1_000) return `${sign}£${Math.round(a / 1_000)}k`;
  return `${sign}£${a}`;
};

const OVERVIEW = [{
  person_id: 'e8529c1f-3351-46e3-b74d-8902bad4a923',
  full_name: 'Dean Mann',
  financial_year: '2026-04-01',
  fy_target: TARGET,
  target_revenue: CHANGE,
  trailer_revenue: WON_TRAILER,
  open_pipeline: OPEN,
  open_deals: 59, won_deals: 18, lost_deals: 51,
  customers: 257, unpriced: 70, won_undated: 10,
  achieved: ACHIEVED, to_go: TO_GO,
  won_to_date: THIS_YEAR, last_year_won: LAST_YEAR,
  won_change: CHANGE, won_change_pct: CHANGE_PCT,
  tracker_revenue: TRACKER,
  fs_value_won: FS_WON, fs_value_invoiced: FS_INVOICED,
  fs_contracts: 4, fs_contract_only: true,
  fs_waiting: 0, fs_waiting_worth: 0,
  off_a_sheet: 131,
  invoiced_this_year: THIS_YEAR, invoiced_last_year: LAST_YEAR,
}];

/* Dean's three rows as live holds them today. `won_total_own` is NULL
   on maintenance, not nought: every maintenance deal he has won this
   year is a FleetSmart+ contract, so the filtered sum has nothing left
   to add, and that NULL is what made the tile disagree. */
const PIPELINE = [
  { lead_type: 'maintenance', open_count: 51, open_total: OPEN_MAINTENANCE, won_count: 4,
    won_total: WON_MAINTENANCE, lost_count: 5, lost_total: 0, unpriced: 47, won_undated: 9,
    off_a_sheet: 131, won_total_own: null, won_undated_worth: UNDATED_MAINTENANCE,
    unpriced_open: UNPRICED_OPEN_M, unpriced_won: UNPRICED_WON, undated_priced: 1 },
  { lead_type: 'rental', open_count: 2, open_total: OPEN_RENTAL, won_count: 2,
    won_total: WON_RENTAL, lost_count: 1, lost_total: 0, unpriced: 1, won_undated: 1,
    off_a_sheet: 0, won_total_own: WON_RENTAL, won_undated_worth: null,
    unpriced_open: 0, unpriced_won: 0, undated_priced: 0 },
  { lead_type: 'trailer_sales', open_count: 6, open_total: OPEN_TRAILER, won_count: 11,
    won_total: WON_TRAILER, lost_count: 45, lost_total: 0, unpriced: 23, won_undated: 0,
    off_a_sheet: 0, won_total_own: WON_TRAILER, won_undated_worth: UNDATED_TRAILER,
    unpriced_open: UNPRICED_OPEN_T, unpriced_won: 0, undated_priced: 1 },
];

const REV_YEAR = [{
  year_from: '2026-04-01', year_to: '2026-09-24',
  last_from: '2025-04-01', last_to: '2025-09-24',
  this_year: THIS_YEAR, last_year: LAST_YEAR,
  change: CHANGE, change_pct: CHANGE_PCT,
  customers: 257, with_revenue: 147,
  never_billed: 95, split_twin: 0, payer_on_book: 5,
}];

const CUSTOMERS = [
  { contact_id: 'c1', company_name: 'Redbridge Produce & Flowers Ltd T/A Dole Foodservice',
    this_year: 87000, last_year: 72000, change: 15000, change_pct: 20.8,
    invoices: 112, last_billed: '2026-09-18', divisions: 'STC',
    open_deals: 1, open_value: 105000, total_rows: 4 },
  { contact_id: 'c2', company_name: 'Davies Turner',
    this_year: 40000, last_year: 43000, change: -3000, change_pct: -7.0,
    invoices: 57, last_billed: '2026-09-18', divisions: 'Rentals, STC',
    open_deals: 1, open_value: 76000, total_rows: 4 },
  { contact_id: 'c3', company_name: 'Novuna',
    this_year: 60000, last_year: 56000, change: 4000, change_pct: 7.1,
    invoices: 86, last_billed: '2026-09-18', divisions: 'STC',
    open_deals: 1, open_value: 29000, total_rows: 4 },
  /* Billed the same in both years: contributes nothing and must not
     be listed as if it did. */
  { contact_id: 'c4', company_name: 'Steady State Haulage Ltd',
    this_year: 12000, last_year: 12000, change: 0, change_pct: 0,
    invoices: 9, last_billed: '2026-08-01', divisions: 'STC',
    open_deals: 0, open_value: 0, total_rows: 4 },
];

const MOVERS = CUSTOMERS.filter((c) => c.change !== 0).map((c) => ({
  contact_id: c.contact_id, company_name: c.company_name,
  this_year: c.this_year, last_year: c.last_year,
  change: c.change, change_pct: c.change_pct, divisions: c.divisions,
}));

const ANSWERS: Record<string, unknown> = {
  personal_overview: OVERVIEW,
  personal_pipeline: PIPELINE,
  personal_revenue_year: REV_YEAR,
  personal_movers: MOVERS,
  personal_customers: CUSTOMERS,
  personal_customer_breakdown: [],
  personal_deals: [],
  fleetsmart_candidates: [],
  crm_latest_notes: [],
};

let failed = 0;
const ok = (what: string, cond: boolean, got = '') => {
  if (cond) { console.log(`  ok    ${what}`); return; }
  failed++;
  console.log(`  FAIL  ${what}${got ? `\n          ${got}` : ''}`);
};

async function readPage(page: Page) {
  return await page.evaluate(`(() => {
    const text = document.body.innerText;
    const cards = [...document.querySelectorAll('div')]
      .filter((d) => d.children.length >= 2 && d.innerText && d.innerText.split('\\n').length <= 5
                     && d.offsetWidth > 120 && d.offsetWidth < 700)
      .map((d) => d.innerText.trim());
    return {
      text,
      notKnown: (text.match(/Not known/g) || []).length,
      buttons: [...document.querySelectorAll('button')].map((b) => (b.innerText || '').trim()),
      titles: [...document.querySelectorAll('[title]')].map((b) => b.getAttribute('title') || ''),
      drawer: (() => {
        /* The drawer only, so a row on the page BEHIND it cannot be
           read as a row inside it. That mistake made this check report
           a bug that was not there. */
        const d = document.querySelector('[role="dialog"], aside');
        return d ? d.innerText : '';
      })(),
      /* A SENTENCE THAT SHOUTS AT THE READER.

         From the business, about "This change IS the Towards target
         figure above: one number, drawn twice":

           Comments like this should not make it through. That's a
           note for me, not a production note for a live app being
           used by multiple teams.

         The shouted word is the tell every time. It is what somebody
         writes when they are arguing a point with one reader rather
         than telling a team a fact, and three of them had reached the
         screen. Labels are drawn in capitals by the kit, so those are
         skipped; this looks only at prose, meaning four words or more,
         set in ordinary case. Initialisms the business actually uses
         are allowed and nothing else is. */
      shouting: (() => {
        const fine = ['STC', 'FS', 'VAT', 'MOT', 'HGV', 'CRM', 'PDF', 'UK', 'FY'];
        const out = [];
        for (const d of document.querySelectorAll('p, div, span, li')) {
          if (d.querySelector('p, div, span, li')) continue;
          if (getComputedStyle(d).textTransform === 'uppercase') continue;
          const t = (d.innerText || '').trim();
          if (t.split(/\\s+/).length < 4) continue;
          for (const w of t.match(/\\b[A-Z]{2,}\\b/g) || []) {
            if (!fine.includes(w)) out.push(w + ' in "' + t.slice(0, 50) + '"');
          }
        }
        return out;
      })(),

      /* EVERY SENTENCE ON THE PAGE THAT DOES NOT FIT ITS OWN BOX.

         Headings and hints are drawn on one line and cut off with an
         ellipsis. That is right for a company name in a table and
         wrong for a sentence, and the sentence saying that two cards
         are one number was ending in "..." in the only place it was
         going to be read. A company name is allowed to be cut; a
         sentence, which is anything with a full stop in it, is not. */
      cutSentences: [...document.querySelectorAll('h2, h3, div, span')]
        .filter((d) => d.scrollWidth > d.clientWidth + 1
                    && getComputedStyle(d).overflow === 'hidden'
                    && /\\.\\s|\\.$/.test(d.innerText || ''))
        .map((d) => (d.innerText || '').trim().slice(0, 60)),

      /* WHERE THE HEADLINE CARDS ACTUALLY LAND.

         This used to count the columns the container declared, and it
         passed while every card was drawn full width: the container
         said three columns and each Tile carried its own "span 3", so
         each one took all three. What the container intends is not
         what the screen does, so this measures the screen. */
      headline: (() => {
        const g = [...document.querySelectorAll('div')].find((d) =>
          getComputedStyle(d).display === 'grid' && d.children.length > 0
          && (d.children[0].innerText || '').trim().startsWith('TARGET, THIS YEAR'));
        if (!g) return null;
        return {
          width: Math.round(g.getBoundingClientRect().width),
          kids: [...g.children].map((k) => {
            const r = k.getBoundingClientRect();
            return {
              top: Math.round(r.top), width: Math.round(r.width),
              label: ((k.innerText || '').split('\\n')[0] || '').trim(),
            };
          }),
          /* Anything inside a headline card whose text is wider than
             the box drawn round it, so the screen is showing an
             ellipsis where a sentence should be. Six of the ten notes
             were doing this the moment the cards went three across. */
          clipped: [...g.querySelectorAll('div')]
            .filter((d) => d.scrollWidth > d.clientWidth + 1
                        && getComputedStyle(d).overflow === 'hidden')
            .map((d) => (d.innerText || '').trim().slice(0, 40)),
        };
      })(),
    };
  })()`) as { text: string; notKnown: number; buttons: string[]; titles: string[];
              drawer: string;
              shouting: string[];
              cutSentences: string[];
              headline: { width: number;
                          kids: { top: number; width: number; label: string }[];
                          clipped: string[] } | null };
}

async function main() {
  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM ?? '/opt/pw-browsers/chromium',
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });

  /* Every Supabase call answered here, so the page under test is the
     page that ships and nothing about it is branched for a test.

     THE GENERAL ONE IS REGISTERED FIRST ON PURPOSE. Playwright tries
     the LAST route registered first, so a catch-all added afterwards
     swallows everything and every figure arrives empty, which looks
     exactly like the page being broken. */
  await page.route('**/auth/v1/**', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: '{}',
  }));
  await page.route('**/rest/v1/**', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: '[]',
  }));
  await page.route('**/rest/v1/rpc/**', async (route) => {
    const name = new URL(route.request().url()).pathname.split('/').pop() ?? '';
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(ANSWERS[name] ?? []),
    });
  });

  await page.goto(AT, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);

  const read = await readPage(page);
  /* `DUMP=1 npm run check:personal-page` prints what the page actually
     renders, which is how an assertion gets written against the real
     words rather than against the words in the source. */
  if (process.env.DUMP) { console.log(read.text); console.log(JSON.stringify(read.buttons)); }
  /* `SHOT=/path/to.png npm run check:personal-page` writes the whole
     page out as a picture. Text tells you a heading is missing. Only a
     picture tells you a column of figures is under the wrong one. */
  if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT, fullPage: true });

  console.log('\n  1. No figure the app worked out says "Not known"');
  ok('nothing on the page reads "Not known"', read.notKnown === 0,
    `${read.notKnown} tile(s) do`);
  ok('FleetSmart+ value won is drawn', /FS\+ VALUE WON\n£38k/i.test(read.text),
    'the £38,254.52 across four accepted contracts is missing');
  ok('FleetSmart+ value invoiced is drawn', /FS\+ VALUE INVOICED\n£195/i.test(read.text),
    'the £195.04 billed is missing');

  console.log('\n  2. Two cards about one thing agree');
  /* The kit draws a tile label in capitals, so the page is read the
     way it renders rather than the way the source spells it. */
  const towards = read.text.match(/TOWARDS TARGET\n([^\n]+)/i)?.[1] ?? '';
  ok('Towards target shows the change', towards.trim() === '£256k', `it shows "${towards}"`);
  ok('and the invoiced panel shows the same change',
    read.text.includes('+£256k'),
    'the panel and the tile are not the same number');
  /* It used to say so in words, in a sentence written at one reader.
     The guarantee lives in `portfolio_audit` instead, so what the
     screen owes the reader is the two figures agreeing, which the two
     assertions above already read straight off it. */
  ok('and it does not argue the point in a note',
    !/one number, drawn twice/.test(read.text));

  console.log('\n  3. Every percentage says what it is a percentage of');
  ok('the growth badge says "on last year"', read.text.includes('% on last year'),
    'a bare percentage sits beside a share of target');
  ok('Achieved says it is of the target', /of the £600k target/.test(read.text),
    'the achieved percentage does not say what it is of');

  console.log('\n  4. Every table of figures has column headings');
  for (const head of ['Customer', 'Last year', 'Open', 'This year', 'Change']) {
    ok(`the customer table has a "${head}" heading`, read.text.includes(head));
  }

  console.log('\n  5. No label describes arithmetic the page no longer does');
  for (const stale of ['Won tracker work', 'Trailer sales are not in this',
                       'Anybody they hold a deal against',
                       /* Outlived the change by an hour: this panel IS
                          now the figure the target is measured on. */
                       'This is not the figure the target is measured on']) {
    ok(`"${stale}" is gone`, !read.text.includes(stale));
  }

  console.log('\n  6. The layout and the controls the business asked for');
  const head = read.headline;
  const rows = [...new Set((head?.kids ?? []).map((k) => k.top))].sort((a, b) => a - b);
  const onFirstRow = (head?.kids ?? []).filter((k) => k.top === rows[0]).length;
  ok('the headline cards are three across', onFirstRow === 3,
    head ? `${onFirstRow} card(s) sit on the first row, across ${rows.length} row(s)`
         : 'the headline grid was not found at all');
  /* From the business: "Left to find should be card 3 always so
     you're showing target, current progress, progress left all on 1
     line." Read back off the screen in the order the screen draws
     them, because "always" is a promise and not an intention. */
  const rowOf = (n: number) =>
    (head?.kids ?? []).filter((k) => k.top === rows[n]).map((k) => k.label);
  const firstRow = rowOf(0);
  ok('the first row is the target, the progress and what is left',
    firstRow[0] === 'TARGET, THIS YEAR'
      && firstRow[1] === 'TOWARDS TARGET'
      && /LEFT TO FIND|AHEAD OF TARGET/.test(firstRow[2] ?? ''),
    `the first row reads ${firstRow.join(' | ')}`);
  /* Nine cards, three rows, no card sitting on its own at the end. Ten
     cards cannot be grouped three at a time, which is why the tenth
     went: "merge left to find and achieved together so 9 cards
     total." */
  ok('there are nine cards in three full rows',
    (head?.kids ?? []).length === 9 && rows.length === 3
      && [0, 1, 2].every((n) => rowOf(n).length === 3),
    `${(head?.kids ?? []).length} cards across ${rows.length} row(s)`);
  /* "All FS ones stay together", and together means on one row, not
     merely next to each other across a row break. */
  const fsRow = [0, 1, 2].filter((n) => rowOf(n).some((l) => l.startsWith('FS+')));
  ok('both FleetSmart+ cards are on the same row',
    fsRow.length === 1 && rowOf(fsRow[0]).filter((l) => l.startsWith('FS+')).length === 2,
    `FS+ cards are on row(s) ${fsRow.map((n) => n + 1).join(' and ')}`);
  /* The percentage is on the card it is a percentage of, rather than
     on a card of its own two places away. */
  ok('what is left carries how far through the target that is',
    /(LEFT TO FIND|AHEAD OF TARGET)\n[^\n]+\n[0-9.]+% of the [^\n]+ target reached\./
      .test(read.text),
    'the achieved percentage is not on the card it belongs to');
  ok('and there is no Achieved card of its own any more',
    !/\nACHIEVED\n/.test(read.text));
  ok('and no headline card is drawn full width',
    !!head && head.kids.every((k) => k.width < head.width * 0.5),
    head ? `the widest card is ${Math.round(
      (Math.max(...head.kids.map((k) => k.width)) / head.width) * 100)}% of the row`
         : 'the headline grid was not found at all');
  ok('no headline card is hiding the end of its own note',
    (head?.clipped ?? []).length === 0,
    `clipped: ${(head?.clipped ?? []).join(' | ')}`);
  ok('nothing on the page is arguing a point at the reader',
    read.shouting.length === 0, read.shouting.join(' | '));
  ok('and no sentence anywhere on the page ends in an ellipsis',
    read.cutSentences.length === 0,
    `cut off: ${read.cutSentences.join(' | ')}`);
  ok('the Customers card is gone', !/\nCustomers\n257\n/.test(read.text));
  ok('the invoiced row is a button',
    read.titles.some((b) => /which customers this change is made of/i.test(b)),
    'the row cannot be opened');

  /* ---- 7 ----

     Found by reading the rendered page rather than the code. The
     tracker tile said £52k over a table whose two rows said £38k and
     £51k, because the tile had the FleetSmart+ contracts taken out of
     it and the table did not. Nobody reported it: it was found by
     adding up what was on the screen, which is what a rep does. */
  console.log('\n  7. Every tile that has a table under it is the sum of that table');
  const tile = (label: string) =>
    (read.text.match(new RegExp(`${label}\\n([^\\n]+)`, 'i'))?.[1] ?? '').trim();
  ok('Closed on the tracker is maintenance plus rentals',
    tile('CLOSED ON THE TRACKER') === compact(WON_MAINTENANCE + WON_RENTAL),
    `the tile reads "${tile('CLOSED ON THE TRACKER')}", the rows come to `
      + compact(WON_MAINTENANCE + WON_RENTAL));
  ok('and the two rows under it are drawn',
    read.text.includes(`Won this year ${compact(WON_MAINTENANCE)}`)
      && read.text.includes(`Won this year ${compact(WON_RENTAL)}`),
    'the table does not show what the tile is made of');
  ok('Trailer Sales is the trailer row',
    tile('TRAILER SALES') === compact(WON_TRAILER),
    `the tile reads "${tile('TRAILER SALES')}"`);
  ok('Open pipeline is the three open figures',
    tile('OPEN PIPELINE') === compact(OPEN),
    `the tile reads "${tile('OPEN PIPELINE')}", the rows come to ${compact(OPEN)}`);

  /* ---- 9 ----

     "£-3k" was drawn in Biggest fallers for a customer who spent
     £3,000 less than last year. The sign belongs before the currency
     symbol, and it was there in one component and not the other. */
  /* ---- 8 ----

     From the business:

       He thinks these are lost earnings because it's saying things are
       or are not included or are being worked out differently.

     A count of what is excluded, with no figure beside it, is read by
     somebody paid on a number as money taken off them. Every notice
     now names what it moves, and says the target is not one of them. */
  console.log('\n  8. Every warning says what it is worth');
  ok('the warning opens by saying the target is untouched',
    /None of this changes your target/.test(read.text));
  ok('and the undated wins are priced rather than just counted',
    read.text.includes(compact(UNDATED)),
    `the page does not say the undated wins are worth ${compact(UNDATED)}`);
  ok('and it says what dating them would do',
    /Put a date on them and that lands\./.test(read.text));
  /* "whats the open pipeline vs the real pipeline, why 2". There is
     one pipeline. The gap is that some of its deals have no figure on
     them, which is a different sentence from a second total the app is
     keeping back. */
  ok('the page never mentions a second pipeline it does not have',
    !/real pipeline/.test(read.text));
  ok('the unpriced deals are counted against the open deals they are part of',
    new RegExp(`${UNPRICED_OPEN} of your ${OPEN_DEALS} open deals carry no figure`)
      .test(read.text),
    `the page does not say ${UNPRICED_OPEN} of ${OPEN_DEALS}`);
  ok('and the old count that mixed in lost and won deals is gone',
    !/70 deals? carry no figure/.test(read.text));
  ok('only the undated wins worth dating are the ones it asks for',
    new RegExp(`${UNDATED_PRICED} won deals are worth ${compact(UNDATED)}`).test(read.text),
    'the page asks for all ten to be dated when eight are worth nothing');
  ok('and the wins worth nothing say so separately',
    new RegExp(`${UNPRICED_WON} won deals carry no figure at all`).test(read.text));
  ok('the payers say they change nothing rather than that they do not belong',
    /add nothing to the figures above and taking them off would change none of them/
      .test(read.text));
  ok('and the old wording that read as money taken away is gone',
    !/should not be on a portfolio at all/.test(read.text));

  console.log('\n  9. Money is written the way money is written');
  ok('no figure puts the minus sign after the £', !read.text.includes('£-'),
    'somewhere on this page money is written "£-3k"');
  ok('a faller is drawn as a negative amount', /\u2212£3k/.test(read.text),
    'the £3,000 fall is not drawn as a fall');

  console.log('\n  10. It opens, and what is inside adds up');
  await page.getByTitle('See which customers this change is made of').click();
  await page.waitForTimeout(500);
  const drawer = await readPage(page);
  const inside = drawer.drawer || drawer.text;
  ok('the breakdown opens', inside.includes('against the same point last year'));
  ok('it lists the customers that moved', inside.includes('Redbridge')
    && inside.includes('Davies Turner'));
  ok('a customer billed the same both years is not listed as a mover',
    !inside.includes('Steady State Haulage'),
    'a row worth nothing is padding the list');
  ok('it says whether the rows add up',
    /add up to the headline|rows come to/.test(inside));
  ok('and it says how many moved and how many did not',
    /billed the same in both years/.test(inside));
  ok('and the breakdown has column headings too',
    ['Customer', 'Last year', 'This year', 'Change'].every((h) => inside.includes(h)));
  /* The same rule inside the drawer, which the read above cannot see
     because the drawer was not open when the page was first read. */
  ok('and nothing inside it argues a point at the reader',
    drawer.shouting.length === 0, drawer.shouting.join(' | '));

  /* ---- 11 ----

     A laptop is not a 1440 monitor, and three cards across a narrower
     page is where a sentence starts not fitting its box. The same two
     questions, asked again at the width most of the team works at. */
  console.log('\n  11. And the same, on a laptop');
  await page.setViewportSize({ width: 1180, height: 1200 });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  const narrow = await readPage(page);
  const nHead = narrow.headline;
  const nRows = [...new Set((nHead?.kids ?? []).map((k) => k.top))].sort((a, b) => a - b);
  ok('the headline cards are still three across',
    (nHead?.kids ?? []).filter((k) => k.top === nRows[0]).length === 3,
    `${(nHead?.kids ?? []).filter((k) => k.top === nRows[0]).length} on the first row`);
  ok('and no sentence is cut off at this width', narrow.cutSentences.length === 0,
    `cut off: ${narrow.cutSentences.join(' | ')}`);
  ok('and no headline card hides its note', (nHead?.clipped ?? []).length === 0,
    `clipped: ${(nHead?.clipped ?? []).join(' | ')}`);

  await browser.close();
  console.log(failed === 0
    ? '\n  the personal portfolio holds: nothing unknown that is known, the two cards are one '
      + 'number, every percentage says what it is of, every column is named, every tile is '
      + 'the sum of the table under it, and money is written the way money is written\n'
    : `\n  ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
