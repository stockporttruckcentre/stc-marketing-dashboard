/* =============================================================
   The Roles screen, rendered by the application, beside the kit's own
   preview.html, in one browser.

   `docs/source/roles_hub/HANDOFF.md`:

     Open preview.html in a browser. That is the target. ... Your
     implementation must look and behave identically.

   So both are opened: the application's /roles-preview (the real
   screen with fabricated roles) and the kit's preview.html straight
   off disk. Then, for the same class on each side, the computed style
   is read and compared: family, size, weight, colour, background,
   border, padding, gap. A value the port got wrong, a token that did
   not resolve, a stylesheet that did not load, all show up here as
   the two sides disagreeing. The region widths the handoff fixes are
   asserted by number, and the selection sync by clicking.

   Then the same again in dark, with the application's `data-theme`
   on one side and the kit's `data-stc-theme` on the other.

   Needs `npm run dev` on port 3000. Run with `npm run check:roles-render`.
   ============================================================= */
import { resolve } from 'node:path';
import { writeFileSync } from 'node:fs';
import { chromium, type Page } from 'playwright';

const APP = 'http://localhost:3000/roles-preview';
const KIT = `file://${resolve('docs/source/roles_hub/preview.html')}`;

let bad = 0;
const ok = (what: string, held: boolean, why?: string) => {
  console.log(`  ${held ? 'ok  ' : 'FAIL'}  ${what}`);
  if (!held) { bad += 1; if (why) console.log(`        ${why}`); }
};

/* The classes compared, one visible instance of each. */
const CLASSES = [
  'roles-shell', 'roles-nav', 'r-63', 'r-64', 'r-65', 'r-2g', 'r-68', 'r-67', 'r-69', 'r-6a', 'r-2q', 'r-6c',
  'r-6e', 'r-6g', 'r-6h', 'r-4h', 'r-6j', 'r-8', 'r-3g', 'r-31',
  'roles-canvas', 'r-6l', 'r-4i', 'r-6m', 'r-4j', 'r-6n', 'r-6o', 'r-2r', 'r-6r', 'r-6s', 'r-w', 'r-x',
  'roles-canvas-body', 'r-6t', 'r-6u', 'r-4s', 'r-29', 'r-33', 'r-11', 'r-12', 'r-14', 'r-15', 'r-16',
  'r-1y', 'r-4p', 'r-6v', 'r-4q', 'r-4r', 'r-2d', 'r-2a', 'r-3j', 'r-3k', 'r-4v', 'r-4w',
  'r-6x', 'r-6z', 'r-70', 'r-32', 'r-71', 'r-73', 'r-4x', 'r-74',
  'roles-rail', 'r-7i', 'r-4y', 'r-36', 'r-7j', 'r-7k', 'r-3l', 'r-7l', 'r-u', 'r-2s', 'r-1z', 'r-t', 'r-18', 'r-19',
  'r-7m', 'r-7n', 'r-7o', 'r-7p', 'r-7q',
  'roles-inspector', 'r-1b', 'r-1c', 'r-y', 'r-1d', 'r-1e', 'r-1f', 'r-d', 'r-1g', 'r-1h', 'r-1i', 'r-1j', 'r-2', 'r-3', 'r-4',
  'r-17', 'r-1k', 'r-1l', 'r-v', 'r-l', 'r-57', 'r-s', 'r-1m', 'r-1n', 'r-n', 'r-1o', 'r-m', 'r-f', 'r-1p', 'r-1q', 'r-j',
  'r-a', 'r-9', 'r-c', 'r-e', 'r-b', 'r-1r', 'r-5', 'r-6', 'r-g', 'r-h', 'r-o', 'r-p', 'r-q', 'r-r', 'r-i', 'r-1s', 'r-1t', 'r-1u',
  'r-5l', 'r-5m', 'r-2l', 'r-2v', 'r-1v', 'r-1w', 'r-1x',
];
const PROPS = [
  'font-family', 'font-size', 'font-weight', 'letter-spacing', 'line-height', 'color', 'background-color',
  'border-top-width', 'border-top-style', 'border-top-color', 'border-left-width', 'border-left-color', 'border-radius',
  'padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'gap', 'display', 'overflow-x', 'overflow-y',
  'outline-style', 'outline-width', 'box-shadow', 'opacity',
];

const READ = `(function (classes, props) {
  var visible = function (el) { var r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  var out = {};
  classes.forEach(function (c) {
    /* A visible instance first. Failing that, one in a panel not on
       show: the text and colour rules of a verdict chip compute the
       same whether its panel is the one selected or not. */
    var all = document.querySelectorAll('.' + c);
    var els = Array.prototype.filter.call(all, visible);
    var el = els[0] || all[0]; if (!el) { out[c] = null; return; }
    var cs = getComputedStyle(el), o = {};
    props.forEach(function (p) { o[p] = cs.getPropertyValue(p); });
    out[c] = o;
  });
  var w = function (s) { var el = document.querySelector(s); return el ? Math.round(el.getBoundingClientRect().width) : -1; };
  var h = function (s) { var el = document.querySelector(s); return el ? Math.round(el.getBoundingClientRect().height) : -1; };
  /* The holder avatars overlap on purpose: the kit stacks them 7px
     into each other. Everything else must keep to its own box. */
  var leaves = Array.prototype.filter.call(document.querySelectorAll('.roles-shell *'), function (e) {
    return e.children.length === 0 && (e.textContent || '').trim() && visible(e) && !e.closest('.r-1k'); });
  /* A scrolling region clips what runs past it, so a block below the
     fold of the inspector body is not on top of the footer under it.
     Each box is cut down to what its scrolling ancestors let show. */
  var clipped = function (e) {
    var r = e.getBoundingClientRect(), x1 = r.left, y1 = r.top, x2 = r.right, y2 = r.bottom;
    for (var p = e.parentElement; p; p = p.parentElement) {
      var o = getComputedStyle(p);
      if (/(auto|hidden|scroll)/.test(o.overflowX + o.overflowY)) {
        var q = p.getBoundingClientRect();
        x1 = Math.max(x1, q.left); y1 = Math.max(y1, q.top); x2 = Math.min(x2, q.right); y2 = Math.min(y2, q.bottom);
      }
    }
    return { t: e.textContent.trim().slice(0, 24), x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
  };
  var boxes = leaves.map(clipped).filter(function (b) { return b.w > 0 && b.h > 0; });
  var hits = [];
  for (var i = 0; i < boxes.length; i++) for (var j = i + 1; j < boxes.length; j++) {
    var a = boxes[i], c = boxes[j];
    var ix = Math.min(a.x + a.w, c.x + c.w) - Math.max(a.x, c.x), iy = Math.min(a.y + a.h, c.y + c.h) - Math.max(a.y, c.y);
    if (ix > 2 && iy > 2) hits.push(a.t + ' <-> ' + c.t);
  }
  var body = Array.prototype.filter.call(document.querySelectorAll('.r-1o'), visible)[0];
  var panel = body ? body.parentElement : null;
  var bodyBox = body ? { h: Math.round(body.getBoundingClientRect().height), sh: body.scrollHeight, ph: Math.round(panel.getBoundingClientRect().height),
    ih: Math.round(document.querySelector('.roles-inspector').getBoundingClientRect().height) } : null;
  return { styles: out, bodyBox: bodyBox, shell: [w('.roles-shell'), h('.roles-shell')], nav: w('.roles-nav'), rail: w('.roles-rail'),
    inspector: w('.roles-inspector'), canvas: w('.roles-canvas'), overlaps: hits.slice(0, 6), texts: boxes.length,
    panelsVisible: Array.prototype.filter.call(document.querySelectorAll('.sp'), visible).length };
})`;

type Read = {
  styles: Record<string, Record<string, string> | null>;
  bodyBox: { h: number; sh: number; ph: number; ih: number } | null; shell: number[]; nav: number; rail: number;
  inspector: number; canvas: number; overlaps: string[]; texts: number; panelsVisible: number;
};

async function read(page: Page): Promise<Read> {
  return await page.evaluate(`${READ}(${JSON.stringify(CLASSES)}, ${JSON.stringify(PROPS)})`) as Read;
}

function compare(label: string, app: Read, kit: Read) {
  const diffs: string[] = [];
  let compared = 0;
  for (const c of CLASSES) {
    const a = app.styles[c], k = kit.styles[c];
    if (!k) continue;                       /* the kit's data does not draw it */
    if (!a) { diffs.push(`.${c}: not drawn by the application`); continue; }
    for (const p of PROPS) {
      compared += 1;
      if (a[p] !== k[p]) diffs.push(`.${c} ${p}: app ${a[p]} / kit ${k[p]}`);
    }
  }
  writeFileSync(`/tmp/roles-diff-${label}.txt`, diffs.join('\n'));
  ok(`${label}: ${compared} computed values agree with preview.html`, diffs.length === 0,
    `${diffs.length} differ, listed in /tmp/roles-diff-${label}.txt\n        ` + diffs.slice(0, 14).join('\n        '));
}

async function main() {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const ctx = await browser.newContext({ viewport: { width: 1700, height: 1000 } });
  await ctx.addCookies([{ name: 'stc_theme', value: 'light', url: 'http://localhost:3000' }]);
  const app = await ctx.newPage();
  const kit = await ctx.newPage();
  const errors: string[] = [];
  app.on('pageerror', (e) => errors.push(e.message));
  app.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  let status = 0;
  try {
    const r = await app.goto(APP, { waitUntil: 'networkidle', timeout: 90_000 });
    status = r?.status() ?? 0;
  } catch {
    console.log(`\n  The preview is not running at ${APP}.\n  Start it:  npm run dev\n`);
    process.exit(1);
  }
  await kit.goto(KIT, { waitUntil: 'load', timeout: 30_000 });
  /* preview.html is the approved build's markup and stylesheets on a
     bare page. The approved build itself (STC-UI-09b-Roles-Page.html,
     alongside it) sits under a reset that preview.html does not carry:
     `* { margin: 0; padding: 0; box-sizing: border-box; }`. Without it
     a 218px region with 12px of padding measures 242, which is not
     what was signed off. The reset is added here, verbatim, so the
     reference is measured as the design was. */
  await kit.addStyleTag({ content: '* { margin: 0; padding: 0; box-sizing: border-box; }' });
  await app.waitForTimeout(800);
  await app.screenshot({ path: '/tmp/roles-app.png', fullPage: true });
  await kit.screenshot({ path: '/tmp/roles-kit.png', fullPage: true });

  console.log('\n  It draws\n  --------');
  ok('the application preview answers', status === 200);
  ok('with no page error and no hydration mismatch', errors.length === 0, errors.slice(0, 3).join(' | '));

  /* The same kind of role on both sides before anything is read: one
     with several holders and a mix of verdicts, so the avatars, the
     "+N" and every verdict chip are on screen to be compared. */
  await app.evaluate(`document.querySelector('[data-list="sales_rep"]').click()`);
  await kit.evaluate(`document.querySelector('[data-list="depot"]').click()`);
  const a = await read(app), k = await read(kit);

  console.log('\n  The regions the handoff fixes\n  ----------------------------');
  ok(`the shell is 1560 by 860 (${a.shell.join(' by ')})`, a.shell[0] === 1560 && a.shell[1] === 860);
  ok(`the navigation is 218 wide (${a.nav})`, a.nav === 218);
  ok(`the rail is 250 wide (${a.rail})`, a.rail === 250);
  ok(`the inspector is 352 wide (${a.inspector})`, a.inspector === 352);
  ok(`the canvas takes the remainder, as it does in the kit (${a.canvas} / ${k.canvas})`, a.canvas === k.canvas,
    `kit: nav ${k.nav}, rail ${k.rail}, inspector ${k.inspector}, shell ${k.shell.join(' by ')}`);
  ok('the canvas body scrolls rather than clips', a.styles['roles-canvas-body']?.['overflow-y'] === 'auto');
  ok(`exactly one inspector panel shows (${a.panelsVisible})`, a.panelsVisible === 1);
  ok(`${a.texts} text blocks and none of them overlap`, a.overlaps.length === 0, a.overlaps.join('\n        '));
  ok('the inspector body scrolls its overflow, as the kit\'s does',
    !!a.bodyBox && !!k.bodyBox && a.bodyBox.h === k.bodyBox.h && a.bodyBox.sh > a.bodyBox.h,
    `app ${JSON.stringify(a.bodyBox)} / kit ${JSON.stringify(k.bodyBox)}`);

  console.log('\n  It looks the same\n  -----------------');
  compare('light', a, k);

  console.log('\n  It behaves the same\n  -------------------');
  const SYNC = `(function (id) {
    var row = document.querySelector('[data-list="' + id + '"]'); row.click();
    var visible = function (el) { var r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    var panel = document.querySelector('.sp-' + id);
    var node = document.querySelector('.r-6t label[for="sn-' + id + '"], .r-71 label[for="sn-' + id + '"]');
    var cs = getComputedStyle(node), rs = getComputedStyle(row);
    return { panel: visible(panel), only: Array.prototype.filter.call(document.querySelectorAll('.sp'), visible).length,
      ring: cs.outlineStyle + ' ' + cs.outlineWidth + ' ' + cs.outlineColor, row: rs.borderLeftColor + ' ' + rs.fontWeight };
  })`;
  const sa = await app.evaluate(`${SYNC}('sales_rep')`) as { panel: boolean; only: number; ring: string; row: string };
  const sk = await kit.evaluate(`${SYNC}('tech')`) as { panel: boolean; only: number; ring: string; row: string };
  ok('clicking a rail row shows that role\'s panel and no other', sa.panel && sa.only === 1);
  ok(`the chosen node is ringed as the kit rings it (${sa.ring})`, sa.ring === sk.ring, `kit ${sk.ring}`);
  ok(`the chosen row is marked as the kit marks it (${sa.row})`, sa.row === sk.row, `kit ${sk.row}`);
  await app.screenshot({ path: '/tmp/roles-app-selected.png', fullPage: true });

  console.log('\n  And in dark\n  -----------');
  await app.evaluate(`document.documentElement.setAttribute('data-theme', 'dark')`);
  await kit.evaluate(`document.documentElement.setAttribute('data-stc-theme', 'dark')`);
  await app.waitForTimeout(300);
  const ad = await read(app), kd = await read(kit);
  ok('the shell changes ground in dark', ad.styles['roles-shell']?.['background-color'] !== a.styles['roles-shell']?.['background-color']);
  compare('dark', ad, kd);
  await app.screenshot({ path: '/tmp/roles-app-dark.png', fullPage: true });
  await kit.screenshot({ path: '/tmp/roles-kit-dark.png', fullPage: true });

  await browser.close();
  if (bad > 0) { console.log(`\n  ${bad} failed. Screenshots: /tmp/roles-app.png and /tmp/roles-kit.png\n`); process.exit(1); }
  console.log('\n  The Roles screen renders as preview.html renders. Screenshots: /tmp/roles-app.png, /tmp/roles-kit.png\n');
}

main().catch((e) => { console.error(e); process.exit(1); });
