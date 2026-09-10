/* =============================================================
   The Roles tab, rendered, and looked at by a machine.

   From the business, with two screenshots of the live tab:

     It's built the roles page and the whole UI is broken. Look at it.
     This is because it didn't bother to look at what it created.

   Correct. The screen read five tables behind a login, nothing mounted
   it before it merged, and it went live with every text block forced
   to the kit demo's own height and overflowing onto its neighbours.

   This mounts the real screen at `/roles-preview` with fabricated
   roles and asserts three things no source check can: that it draws
   without a page error, that no two text blocks overlap, and that the
   card carries the kit's own structure rather than a guess at it.

   Needs `npm run dev` on port 3000. Run with `npm run check:roles-render`.
   ============================================================= */
import { chromium } from 'playwright';

const URL = 'http://localhost:3000/roles-preview';

let bad = 0;
const ok = (what: string, held: boolean, why?: string) => {
  console.log(`  ${held ? 'ok  ' : 'FAIL'}  ${what}`);
  if (!held) { bad += 1; if (why) console.log(`        ${why}`); }
};

async function main() {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  /* ---- Light, because that is what the kit is ----

     The application defaults to its dark theme when no cookie is set,
     and the kit's colours are its light palette, read off the file.
     Rendered dark, every navy heading disappears into a navy ground and
     the coverage card shows bars with no labels. That is a real gap, and
     it is named below rather than hidden: the kit carries a dark
     variant behind its own toggle, and porting it is a second
     extraction pass, not a colour picked here.

     So this renders the way a signed in person on the light theme sees
     it, which is what the screenshots that reported the breakage were
     of. */
  await page.context().addCookies([{ name: 'stc_theme', value: 'light', url: 'http://localhost:3000' }]);

  let status = 0;
  try {
    const r = await page.goto(URL, { waitUntil: 'networkidle', timeout: 90_000 });
    status = r?.status() ?? 0;
  } catch {
    console.log(`\n  The preview is not running at ${URL}.\n  Start it:  npm run dev\n`);
    process.exit(1);
  }
  await page.waitForTimeout(1200);
  await page.screenshot({ path: '/tmp/roles-render.png', fullPage: true });

  console.log('\n  It draws\n  --------');
  ok('the preview answers', status === 200);
  ok('with no page error and no hydration mismatch',
    errors.length === 0, errors.slice(0, 3).join(' | '));

  const read = await page.evaluate(`(() => {
    var leaves = Array.prototype.slice.call(document.querySelectorAll('.rk *'))
      .filter(function (e) { return e.children.length === 0 && (e.textContent || '').trim().length > 0; });
    var boxes = leaves.map(function (e) { var r = e.getBoundingClientRect();
      return { t: e.textContent.trim().slice(0, 30), x: r.left, y: r.top, w: r.width, h: r.height }; })
      .filter(function (b) { return b.w > 0 && b.h > 0; });
    var hits = [];
    for (var i = 0; i < boxes.length; i++) for (var j = i + 1; j < boxes.length; j++) {
      var a = boxes[i], c = boxes[j];
      var ix = Math.min(a.x + a.w, c.x + c.w) - Math.max(a.x, c.x);
      var iy = Math.min(a.y + a.h, c.y + c.h) - Math.max(a.y, c.y);
      if (ix > 2 && iy > 2) hits.push(a.t + ' <-> ' + c.t);
    }
    var cards = Array.prototype.slice.call(document.querySelectorAll('.rk-node'));
    var first = cards[0];
    var tint = first ? first.querySelector('.rk-node__tint') : null;
    var tr = tint ? tint.getBoundingClientRect() : null, cr = first ? first.getBoundingClientRect() : null;
    return {
      texts: boxes.length, hits: hits.slice(0, 8), cards: cards.length,
      widths: cards.map(function (c) { return Math.round(c.getBoundingClientRect().width); }),
      tintInside: !!(tr && cr && tr.left >= cr.left - 1 && tr.height <= cr.height + 1),
      rows: first ? first.children.length : 0
    };
  })()`) as { texts: number; hits: string[]; cards: number; widths: number[]; tintInside: boolean; rows: number };

  console.log('\n  Nothing overlaps\n  ----------------');
  ok(`${read.texts} text blocks and none of them overlap`, read.hits.length === 0, read.hits.join('\n        '));

  console.log('\n  The card is the kit\'s\n  --------------------');
  ok('eleven roles are drawn', read.cards === 11, `${read.cards} cards`);
  ok('every card is the same width, as the kit lays them out',
    new Set(read.widths).size === 1, `widths ${[...new Set(read.widths)].join(', ')}`);
  ok('the tint bar sits inside its own card, not down the branch',
    read.tintInside, 'the card must be the positioning context for its bar');
  ok('a card is a tint, a top row and a bottom row, as the kit builds it',
    read.rows === 3, `${read.rows} children`);

  console.log('\n  Known gap\n  ---------');
  console.log('  skip  the dark theme: the kit has a dark variant behind its toggle, not yet extracted,');
  console.log('        so this tab is only verified on the light theme it was designed on');

  await browser.close();
  if (bad > 0) { console.log(`\n  ${bad} failed. Screenshot: /tmp/roles-render.png\n`); process.exit(1); }
  console.log('\n  The Roles tab renders as the kit draws it. Screenshot: /tmp/roles-render.png\n');
}

main().catch((e) => { console.error(e); process.exit(1); });
