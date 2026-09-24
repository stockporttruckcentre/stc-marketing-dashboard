/* =============================================================
   The portfolio's customer table, driven in a browser.

   From the business, about what it looked like before:

     extremely buggy UI here on Customers on this portfolio which again
     proves you've completed ditched the analytics UI kit I built you
     and just vibing it doing whatever. 75% blank room on the rows
     which is a banned primitive, and none of it was used for the extra
     column and instead you just made the other columns smaller.

   Three faults, and a rendered page is the only thing that can show
   any of them. "It compiles" and "it renders" are not evidence, so
   this measures:

     1. NO BLANK. Every pixel between the name and the figures is
        inside an element that is drawing something.
     2. NOTHING OUTSIDE THE CARD. Every cell of every row ends before
        the card's right edge. The rise and fall figures were half off
        it, because the kit's 12px arrow came through at the browser's
        default 300px and shoved them out.
     3. NOTHING WRAPS. No row is taller than the row above it, which is
        what a wrapped figure does.

   It also checks the page at three widths, because a layout that only
   works at 1440 is a layout that works on one monitor.

   Needs `npm run dev`. Run with `npm run check:portfolio-table`.
   ============================================================= */
import { chromium } from 'playwright';

type Box = { l: number; r: number; w: number; h: number };
type Read = {
  card: Box;
  page: { w: number; cw: number };
  rows: { h: number; name: string; cells: Box[]; gaps: number[] }[];
  head: Box;
  headings: Box & { text: string };
  total: Box;
};

const AT = 'http://localhost:3000/portfolio-table-preview';
const WIDTHS = [1180, 1440, 1760];

let failed = 0;
const ok = (what: string, cond: boolean, got = '') => {
  if (cond) { console.log(`  ok    ${what}`); return; }
  failed++;
  console.log(`  FAIL  ${what}${got ? `\n          ${got}` : ''}`);
};

async function main() {
  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM ?? '/opt/pw-browsers/chromium',
  });

  for (const width of WIDTHS) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await page.goto(AT, { waitUntil: 'networkidle' });

    /* A STRING, not a function.

       `tsx` compiles a named function with a `__name` helper that
       exists in Node and not in the page, so an arrow passed straight
       to `evaluate` dies with "__name is not defined" inside the
       browser. Every other driven check in this repository does the
       same thing for the same reason. */
    const read = await page.evaluate(`(() => {
      const card = document.querySelector('.kit > div');
      const rows = [...card.children];
      const box = (e) => {
        const r = e.getBoundingClientRect();
        return { l: r.left, r: r.right, w: r.width, h: r.height };
      };
      return {
        card: box(card),
        page: { w: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth },
        /* Two rows before the data now, not one: the kit's own header
           with the title and the sort, then the column heading row the
           business asked for by name ("needs column headers again,
           dean doesn't know what any of those \u00a3 numbers mean").
           Slicing only one off counted the heading row as data and
           reported it as a row that had wrapped. */
        rows: rows.slice(2, -1).map((row) => ({
          h: box(row).h,
          name: row.children[2] ? row.children[2].innerText : '',
          cells: [...row.children].map((c) => box(c)),
          /* The gap between the end of one cell and the start of the
             next. The kit's own is 10px and anything larger is the
             blank the business reported. */
          gaps: [...row.children].slice(1).map(
            (c, i) => Math.round(box(c).l - box(row.children[i]).r),
          ),
        })),
        head: box(rows[0]),
        headings: Object.assign(box(rows[1]), { text: rows[1].innerText }),
        total: box(rows[rows.length - 1]),
      };
    })()`) as Read;

    console.log(`\n  at ${width}px`);

    ok(`${width}: the page does not scroll sideways`,
      read.page.w <= read.page.cw + 1, `${read.page.w} wide in ${read.page.cw}`);

    const worst = Math.max(...read.rows.flatMap((r) => r.gaps));
    ok(`${width}: no gap in a row is wider than the kit's own`,
      worst <= 11, `the widest gap is ${worst}px and the kit's is 10px`);

    const over = read.rows.flatMap((r, i) =>
      r.cells.filter((c) => c.r > read.card.r + 1).map(() => `row ${i + 1}: ${r.name.split('\n')[0]}`));
    ok(`${width}: nothing is drawn outside the card`,
      over.length === 0, over.slice(0, 3).join(', '));

    const heights = read.rows.map((r) => Math.round(r.h));
    const tallest = Math.max(...heights);
    const shortest = Math.min(...heights);
    ok(`${width}: no row is taller than another, so nothing has wrapped`,
      tallest - shortest <= 1, `rows run from ${shortest}px to ${tallest}px`);

    ok(`${width}: the header is one row high`,
      read.head.h <= tallest + 1, `the header is ${Math.round(read.head.h)}px and a row is ${tallest}px`);

    ok(`${width}: the columns are named`,
      ['Customer', 'Last year', 'Open', 'This year', 'Change']
        .every((h) => read.headings.text.includes(h)),
      `the heading row reads "${read.headings.text.replace(/\n/g, ' ')}"`);

    ok(`${width}: the heading row is one row high`,
      read.headings.h <= tallest + 1,
      `the headings are ${Math.round(read.headings.h)}px and a row is ${tallest}px`);

    ok(`${width}: the list has its footing row`, read.total.h > 0);

    /* The long name is the reason the kit's 104px could not stand. */
    const long = read.rows.find((r) => r.name.includes('Redbridge'));
    ok(`${width}: the longest customer name is not cut off`,
      !!long && !long.name.includes('…'), long?.name.split('\n')[0]);

    await page.close();
  }

  await browser.close();
  console.log(failed === 0
    ? '\n  the portfolio table wears the kit\'s row: no blank, nothing outside the card, nothing wrapped\n'
    : `\n  ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
