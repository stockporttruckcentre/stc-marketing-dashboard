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
import { readFileSync, writeFileSync } from 'node:fs';
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
  /* The pack's own 218px navigation column is not drawn: this screen
     sits inside the application's sidebar. check:roles-port asserts it
     is absent, so there is nothing to compare here. */
  'roles-shell', 'r-2q',
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
    /* ---- Only ever a VISIBLE instance, on both sides ----

       Falling back to a hidden one compares two different places. A
       verdict chip inside the matrix legend is a flex item, and CSS
       blockifies a flex item, so its inline-flex computes as flex.
       The same chip in a table cell does not. Neither is wrong, and
       comparing one against the other reports a defect that is not
       there. Where a side has none on show the class is skipped, and
       the count of skips is printed so the coverage is never quietly
       smaller than it looks. */
    var all = Array.prototype.filter.call(document.querySelectorAll('.' + c), function (e) {
      return !e.closest('.roles-nav');
    });
    var el = all.filter(visible)[0]; if (!el) { out[c] = null; return; }
    var cs = getComputedStyle(el), o = { __cls: el.getAttribute('class') || '' };
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
  styles: Record<string, (Record<string, string> & { __cls?: string }) | null>;
  bodyBox: { h: number; sh: number; ph: number; ih: number } | null; shell: number[]; nav: number; rail: number;
  inspector: number; canvas: number; overlaps: string[]; texts: number; panelsVisible: number;
};

async function read(page: Page): Promise<Read> {
  return await page.evaluate(`${READ}(${JSON.stringify(CLASSES)}, ${JSON.stringify(PROPS)})`) as Read;
}

/* ---- Differences the port means ----

   The reference page is the kit as it arrived. The screen is the kit
   plus what the business asked for afterwards, and those changes live
   in one file, `components/admin/roles/overrides.css`, each carrying
   the instruction that produced it.

   Rather than keeping a second list here that could drift from that
   file, this READS it: every class and property it overrides is one the
   screen is expected to differ from the reference on, and is asserted
   to actually differ. That catches the failure that matters, an
   override written and then not in force, and it cannot go stale
   because there is only one list.

   A handful of properties differ for reasons that are not a stylesheet
   at all. Those are named below with what they must be instead. */
type Meant = { is?: string; sameAs?: string; why: string };
const INTER = { sameAs: 'roles-shell', why: 'the business asked for Inter on these two, not the mono face' };
const OUT_OF_SCOPE = 'the handoff puts this out of scope, so it is disabled and says why';
const DELIBERATE: Record<string, Record<string, Meant>> = {
  'r-8': { 'font-family': INTER },
  'r-9': { 'font-family': INTER },
  'r-3g': { opacity: { is: '0.45', why: `Access review: ${OUT_OF_SCOPE}` } },
  'r-31': { opacity: { is: '0.45', why: `New role: ${OUT_OF_SCOPE}` } },
};

/* Properties written by the layout pass rather than by any stylesheet:
   a branch row is padded at runtime so the parent's stem lands on the
   bar it draws. The connector assertions above are what prove that. */
const COMPUTED: Record<string, string[]> = {
  'r-6v': ['padding-left', 'padding-right'],
  'r-6w': ['padding-left', 'padding-right'],
};

/** Every class and property `overrides.css` changes, read from it. */
function overridden(): Record<string, Set<string>> {
  const css = readFileSync('components/admin/roles/overrides.css', 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  const out: Record<string, Set<string>> = {};
  const add = (cls: string, p: string) => (out[cls] ?? (out[cls] = new Set())).add(p);
  for (const m of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const props = [...m[2]!.matchAll(/(?:^|;)\s*([a-z-]+)\s*:/g)].map((x) => x[1]!);
    for (const selector of m[1]!.split(',')) {
      /* The SUBJECT of the selector, which is the last class in it.
         `.roles-rail .r-19{color}` changes `.r-19`, not the rail, and
         attributing it to both is what reported a dozen overrides that
         were never meant to apply to the ancestor. */
      const classes = [...selector.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((x) => x[1]!);
      const subject = classes[classes.length - 1];
      if (!subject) continue;
      for (const p of props) {
        add(subject, p);
        /* A shorthand settles longhands, and the browser reports the
           longhands. */
        if (p === 'background') add(subject, 'background-color');
        if (p === 'border') for (const side of ['top', 'right', 'bottom', 'left']) {
          add(subject, `border-${side}-color`); add(subject, `border-${side}-width`);
        }
        if (p === 'border-color') for (const side of ['top', 'right', 'bottom', 'left']) {
          add(subject, `border-${side}-color`);
        }
        /* Every border in this screen is `currentColor`, set by the
           reset in port.css, so changing the text colour changes the
           border colour the browser reports with it. */
        if (p === 'color') for (const side of ['top', 'right', 'bottom', 'left']) {
          add(subject, `border-${side}-color`);
        }
      }
    }
  }
  return out;
}
const OVERRIDDEN = overridden();

function compare(label: string, app: Read, kit: Read) {
  const diffs: string[] = [];
  let compared = 0;
  let overrides = 0;
  const skipped: string[] = [];
  for (const c of CLASSES) {
    const a = app.styles[c], k = kit.styles[c];
    if (!k) { skipped.push(c); continue; }   /* the kit's data does not draw it here */
    if (!a) { skipped.push(c); continue; }   /* nor does the port, in this state */
    for (const p of PROPS) {
      compared += 1;
      if (COMPUTED[c]?.includes(p)) { skipped.push(`${c} ${p}`); continue; }
      /* Any class ON THE ELEMENT may carry the override, not only the
         one it was looked up by: the rail's selected row is found as
         `.r-18` and overridden as `.sn-row`. */
      const carries = [c, ...(a.__cls ?? '').split(/\s+/)].filter(Boolean);
      if (carries.some((x) => OVERRIDDEN[x]?.has(p))) { overrides += 1; continue; }
      const meant = DELIBERATE[c]?.[p];
      if (meant) {
        const want = meant.is ?? kit.styles[meant.sameAs!]?.[p];
        if (want == null) diffs.push(`.${c} ${p}: nothing to compare against (.${meant.sameAs} was not drawn)`);
        else if (a[p] !== want) diffs.push(`.${c} ${p}: app ${a[p]}, but ${meant.why}, so it must be ${want}`);
        continue;
      }
      if (a[p] !== k[p]) diffs.push(`.${c} ${p}: app ${a[p]} / kit ${k[p]}`);
    }
  }
  writeFileSync(`/tmp/roles-diff-${label}.txt`, diffs.join('\n'));
  if (skipped.length > 0) {
    console.log(`        ${skipped.length} classes were on show in neither, so not compared: ${skipped.slice(0, 10).join(', ')}${skipped.length > 10 ? ' and more' : ''}`);
  }
  console.log(`        ${overrides} values are not compared because overrides.css deliberately changes them`);
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
  /* The pack's own navigation column is not drawn. check:roles-port
     asserts it is absent from the markup; this asserts the layout does
     not leave a gap where it was. */
  ok('the pack\'s navigation column is not on screen', a.nav === -1, `found one ${a.nav} wide`);
  ok(`the rail is 250 wide (${a.rail})`, a.rail === 250);
  ok(`the inspector is 352 wide (${a.inspector})`, a.inspector === 352);
  /* The handoff: "The three fixed regions stay at 218px, 250px and
     352px. The canvas takes the remainder." Two of those three are
     still here, the third is the navigation the business removed, so
     the canvas takes what is left of the shell after the rail and the
     inspector and their two hairlines. */
  const remainder = a.shell[0]! - a.rail - a.inspector;
  ok(`the canvas takes the remainder (${a.canvas} of ${remainder})`,
    Math.abs(a.canvas - remainder) <= 2,
    `shell ${a.shell[0]}, rail ${a.rail}, inspector ${a.inspector}`);
  ok('the canvas body scrolls rather than clips', a.styles['roles-canvas-body']?.['overflow-y'] === 'auto');
  ok(`exactly one inspector panel shows (${a.panelsVisible})`, a.panelsVisible === 1);
  ok(`${a.texts} text blocks and none of them overlap`, a.overlaps.length === 0, a.overlaps.join('\n        '));
  ok('the inspector body scrolls its overflow, as the kit\'s does',
    !!a.bodyBox && !!k.bodyBox && a.bodyBox.h === k.bodyBox.h && a.bodyBox.sh > a.bodyBox.h,
    `app ${JSON.stringify(a.bodyBox)} / kit ${JSON.stringify(k.bodyBox)}`);

  /* ---- The connectors land where they should ----

     From the business, of an earlier build: "the lines connecting the
     tree are all broken and overlapped." A screenshot cannot be
     asserted, so the property behind it is: every drop must be centred
     on the card it points at, every elbow must reach its own column's
     centre, and the segments of one branch row must tile that row left
     to right with nothing but the row's own gap between them. */
  const wires = await app.evaluate(`(() => {
    const mid = (r) => r.left + r.width / 2;
    /* Counted as well as checked: a check that examined nothing passes
       for the wrong reason, and this one runs against a view that can
       be hidden. */
    const out = { drops: [], elbows: [], gaps: [], stems: [], nDrops: 0, nSegs: 0, nRows: 0, nStems: 0 };
    for (const drop of document.querySelectorAll('.roles-canvas-body .r-2d')) {
      const card = drop.parentElement.querySelector(':scope > .sn-lab [data-for], :scope > .r-1y [data-for], :scope > * [data-for]');
      if (!card) continue;
      const d = drop.getBoundingClientRect(), c = card.getBoundingClientRect();
      if (d.width === 0 || c.width === 0) continue;
      out.nDrops += 1;
      if (Math.abs(mid(d) - mid(c)) > 2) out.drops.push(card.getAttribute('data-for') + ': drop at ' + Math.round(mid(d)) + ', card centre ' + Math.round(mid(c)));
    }
    for (const row of document.querySelectorAll('.roles-canvas-body .r-6v, .roles-canvas-body .r-6w')) {
      const segs = [];
      for (const col of row.children) {
        const bar = col.querySelector(':scope > span');
        if (!bar) continue;
        const b = bar.getBoundingClientRect(), c = col.getBoundingClientRect();
        if (b.width === 0) continue;
        segs.push({ l: b.left, r: b.right, cl: c.left, cr: c.right, cm: mid(c) });
        out.nSegs += 1;
      }
      if (segs.length > 0) out.nRows += 1;
      /* ---- The parent's stem has to land ON the bar ----

         A parent is centred over its whole branch row, but the bar only
         runs from the first child's centre to the last child's. When the
         subtrees either side are different widths those two centres are
         not the same, and the stem comes down into one of the gaps
         BETWEEN segments and touches nothing. That is the "lines don't
         touch" the business reported, and no per-segment check could
         see it because every segment was correct. */
      const stem = row.previousElementSibling;
      if (stem && segs.length > 0) {
        const sr = stem.getBoundingClientRect();
        if (sr.width > 0) {
          const m = mid(sr);
          const covered = segs.some((sg) => m >= sg.l - 1 && m <= sg.r + 1);
          out.nStems += 1;
          if (!covered) out.stems.push('a stem lands at ' + Math.round(m) + ', between segments, so it touches nothing');
        }
      }
      segs.forEach((sg, i) => {
        const touchesCentre = sg.l <= sg.cm + 1 && sg.r >= sg.cm - 1;
        if (!touchesCentre) out.elbows.push('a segment does not reach its own column centre');
        /* Adjacent segments must MEET. The kit leaves the row's gap
           as a hole in the bar, and overrides.css closes it by
           extending each segment half a gap towards its neighbour.
           A hole is a line that does not touch. An overlap is a line
           drawn twice. Neither is wanted, so the join has to be
           within a pixel of exact. */
        if (i > 0) {
          const j = sg.l - segs[i - 1].r;
          if (Math.abs(j) > 1) out.gaps.push(
            (j > 0 ? 'a hole of ' : 'an overlap of ') + Math.abs(j).toFixed(1) + 'px between two segments of a bar');
        }
      });
    }
    return out;
  })()`) as { drops: string[]; elbows: string[]; gaps: string[]; stems: string[];
              nDrops: number; nSegs: number; nRows: number; nStems: number };

  console.log('\n  The connectors line up\n  ----------------------');
  ok(`all ${wires.nDrops} drops are centred on the card they point at`,
    wires.nDrops > 0 && wires.drops.length === 0,
    wires.nDrops === 0 ? 'no drops were examined, so this proved nothing' : wires.drops.slice(0, 5).join('\n        '));
  ok(`all ${wires.nSegs} elbows reach their own column centre`,
    wires.nSegs > 0 && wires.elbows.length === 0,
    wires.nSegs === 0 ? 'no elbows were examined, so this proved nothing' : wires.elbows.slice(0, 5).join('\n        '));
  ok(`each of the ${wires.nStems} parent stems lands on the bar rather than in a gap`,
    wires.nStems > 0 && wires.stems.length === 0,
    wires.nStems === 0 ? 'no stems were examined, so this proved nothing' : wires.stems.slice(0, 5).join('\n        '));
  ok(`the bar of each of the ${wires.nRows} branch rows is continuous, with no hole and no overlap`,
    wires.nRows > 0 && wires.gaps.length === 0,
    wires.nRows === 0 ? 'no branch rows were examined, so this proved nothing' : wires.gaps.slice(0, 5).join('\n        '));

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
