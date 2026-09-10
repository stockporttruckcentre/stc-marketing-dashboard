/* =============================================================
   Take the Roles kit out of the file, so nobody types it again.

   From the business, sending `docs/source/STCUIRoles.html`:

     I think the org chart tab is poorly laid out, messy, not fully
     respecting our UI. Attached is a kit from claude design for just
     this tab only. It's not telling you to use/add all of this content
     in the kit, it's guidance to make the page more interactive and
     understandable for techy and non techy users.

   The first Roles chart was authored from a description, which is the
   exact mistake `CLAUDE.md` was rewritten to stop after the Analytics
   hub was rebuilt three times. So this is the same machine pointed at
   the second kit: render the file in a real browser, read the computed
   styles back, and write them out for the components to import.

   The components then contain no numbers, which is the only reliable
   way to stop one being invented. `npm run check:invention` enforces
   that on the text, and `npm run check:roles-kit` re-runs this and
   fails if the committed copy has drifted from the file.

   ---- Why a second extractor and not the first one ----

   `kit-extract.ts` names its devices by the text the ANALYTICS kit puts
   on them. Every one of those names is absent here. Sharing the file
   would mean a config object keyed by kit, and two kits is not enough
   to know what that abstraction should be. The unpacking and the
   browser reading are shared by copying eleven lines, which is cheaper
   than the wrong abstraction and is honest about being a copy.

   Run with `npm run roles-kit:extract`.
   ============================================================= */
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { chromium } from 'playwright';

const SOURCE = 'docs/source/STCUIRoles.html';
const OUT = process.argv.includes('--out')
  ? process.argv[process.argv.indexOf('--out') + 1]!
  : 'lib/admin/roles-kit.generated.ts';
const WORK = '/tmp/roles-kit-extract';

/* -------------------------------------------------------------
   1. Make the file renderable.

   This bundle unpacks ITSELF in the browser, from assets carried
   inside it. The analytics extractor pulls those out and rewrites the
   page, and doing that here corrupts the JSON: the `\n` unescaping it
   performs runs through string literals the page still has to parse,
   and the page comes up showing "Error unpacking: Bad control
   character in string literal".

   So the file is copied and opened as it is. It resolves its own
   assets, which is what makes the fonts real and therefore what makes
   the measurements real.
   ------------------------------------------------------------- */
function renderable(): string {
  rmSync(WORK, { recursive: true, force: true });
  mkdirSync(WORK, { recursive: true });
  writeFileSync(`${WORK}/index.html`, readFileSync(SOURCE));
  return `file://${WORK}/index.html`;
}

/* -------------------------------------------------------------
   2. What to read, named by the words the kit puts on it.

   Each entry is a lookup: find the element whose trimmed text is
   exactly this, then walk to the thing being specified. A component
   asks for its styles by the same name, so the two cannot drift apart
   without this failing loudly.

   `up` is how many card-like ancestors to climb. 0 is the element with
   the words on it; 1 is the box it sits in.
   ------------------------------------------------------------- */
type Target = {
  text: string; up?: number; nth?: number; from?: string;
  /** Read the card's first child, which is the division tint bar. */
  tint?: boolean;
  /** The words are a placeholder attribute rather than text in the box. */
  placeholder?: boolean;
};

/* The role node in every state and kind the kit draws. The States row
   is five Depot Manager cards in order, so they are taken positionally
   out of the panel that follows the word "States", which is what the
   kit itself does to show them. */
const NODES: Record<string, Target> = {
  node:         { text: 'States',    from: 'panel', nth: 0 },
  nodeHover:    { text: 'States',    from: 'panel', nth: 1 },
  nodeSelected: { text: 'States',    from: 'panel', nth: 2 },
  nodeFocus:    { text: 'States',    from: 'panel', nth: 3 },
  nodeDisabled: { text: 'States',    from: 'panel', nth: 4 },
  nodeExec:     { text: 'Kinds',     from: 'panel', nth: 0 },
  nodeOrdinary: { text: 'Kinds',     from: 'panel', nth: 1 },
  nodeSystem:   { text: 'Kinds',     from: 'panel', nth: 3 },
  nodeVacancy:  { text: 'Kinds',     from: 'panel', nth: 4 },
  /* The tint is a bar down the LEFT EDGE inside the card, not the
     card's own border: the kit says "One tint per division ... A node
     is never tinted by status", so the border stays neutral in every
     division and only this strip changes. `tint` reads the first child
     rather than the card. */
  divGroup:     { tint: true, text: 'Divisions', from: 'panel', nth: 0 },
  divService:   { tint: true, text: 'Divisions', from: 'panel', nth: 1 },
  divTrailer:   { tint: true, text: 'Divisions', from: 'panel', nth: 2 },
  divRentals:   { tint: true, text: 'Divisions', from: 'panel', nth: 3 },
  divSystem:    { tint: true, text: 'Divisions', from: 'panel', nth: 4 },
};

/* The parts inside a node, and the pieces the rest of the screen is
   built from. Looked up by their own words. */
const PARTS: Record<string, Target> = {
  initials:      { text: 'DM' },
  roleName:      { text: 'Depot Manager' },
  roleDivision:  { text: 'STC SERVICE' },
  roleCount:     { text: '88 of 148' },

  meterLabel:    { text: 'TECHNICIAN 23/148' },
  meterLow:      { text: '16%' },
  meterMid:      { text: '59%' },
  meterHigh:     { text: '100%' },

  verdictAllowed:     { text: 'Allowed' },
  verdictDenied:      { text: 'Denied' },
  verdictConditional: { text: 'Conditional' },
  verdictInherited:   { text: 'Inherited' },
  verdictAbsent:      { text: 'Not in role' },

  scopeOn:   { text: 'Own site' },
  scopeOff:  { text: 'Assigned jobs' },

  groupHead:  { text: 'Jobs and workshop', up: 1 },
  groupCount: { text: '19/31' },
  capLabel:   { text: 'Create a job' },
  capKey:     { text: 'job.create' },
  capSource:  { text: 'Explicit' },

  segmentOn:   { text: 'Tree' },
  segmentOff:  { text: 'Grid' },
  buttonGhost: { text: 'Fit', up: 1 },
  buttonQuiet: { text: 'Export', up: 1 },
  buttonPrimary: { text: 'Edit role', up: 1 },
  buttonDanger:  { text: 'Archive role', up: 1 },
  buttonRefused: { text: 'Delete role', up: 1 },
  search:      { text: 'Find a role or a person', placeholder: true },

  statAllowed:     { text: 'ALLOWED' },
  statConditional: { text: 'CONDITIONAL' },
  statBlocked:     { text: 'BLOCKED' },

  listGroupHead: { text: '4 · STC SERVICE' },
  listRowOn:     { text: 'Depot Manager', up: 1 },

  /* ---- The containers, so the layout is the kit's too ----

     A first version typed the panel padding, the gap between sibling
     nodes and the row padding by hand, and `npm run check:invention`
     counted forty six values it had no business holding. Every one of
     them is IN the kit; they were typed because they are boxes rather
     than devices and it did not occur to me to read them.

     `up: 1` on a word inside each, so the box is found the same way as
     a button. */
  panel:      { text: 'Find a role or a person', placeholder: true, up: 2 },
  toolbarRow: { text: 'Tree', up: 2 },
  card:       { text: 'Coverage by group', up: 1 },
  capRow:     { text: 'Create a job', up: 2 },
  meterRow:   { text: 'Jobs and workshop', up: 2 },
  auditRow:   { text: 'G Sutton · 14 Aug 2026, 09:12', up: 1 },

  auditLine:  { text: 'G Sutton · 14 Aug 2026, 09:12' },
  holdersHead: { text: 'Holders' },
  systemStrip: { text: 'SYSTEM ROLES' },
  archivedChip: { text: '3 archived roles' },
};

const READ = [
  'display', 'flexDirection', 'alignItems', 'justifyContent', 'gap', 'flexWrap',
  'gridTemplateColumns',
  'width', 'minWidth', 'maxWidth', 'height', 'minHeight',
  'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'marginTop', 'marginRight', 'marginBottom', 'marginLeft',
  'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
  'borderTopColor', 'borderRightColor', 'borderBottomColor', 'borderLeftColor',
  'borderStyle', 'borderRadius',
  'backgroundColor', 'color', 'boxShadow', 'opacity',
  'fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing',
  'textTransform', 'fontVariantNumeric', 'whiteSpace',
];

async function main() {
  const url = renderable();
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(4000);

  const failed = await page.evaluate(
    'document.body.innerText.indexOf("Error unpacking") >= 0');
  if (failed) throw new Error('the kit did not unpack in the browser');

  /* ---- Lay the whole page out before reading any of it ----

     Sections below the fold come up with a zero box until they have
     been on screen once. Read without this, "Not in role" measures 0 by
     0 and the pill it names has no size at all, which would have been
     ported as a pill with no size at all.

     So every section is scrolled through, then back to the top. Nothing
     is measured until the browser has laid all of it out. */
  const height = await page.evaluate('document.documentElement.scrollHeight') as number;
  for (let y = 0; y < height; y += 600) {
    await page.evaluate(`window.scrollTo(0, ${'${y}'})`.replace('${y}', String(y)));
    await page.waitForTimeout(120);
  }
  await page.evaluate('window.scrollTo(0, 0)');
  await page.waitForTimeout(600);

  /* Passed as a STRING. `tsx` compiles named functions with a `__name`
     helper that exists in Node and not in a page, so a function handed
     to `evaluate` throws ReferenceError the moment it is called. */
  const BROWSER = `window.__rolesKit = function (config) {
    var READ = config.read;

    /* The words have to be on something LAID OUT.

       Several of these appear twice in the kit: once in the panel that
       demonstrates them and once in a block the page has not sized,
       which measures zero by zero. Taking the first match ported "Not
       in role" and "Own site" as a pill with no width and no height. */
    function laidOut(e) {
      var r = e.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    }

    function exact(text) {
      var all = document.querySelectorAll('*');
      for (var i = 0; i < all.length; i++) {
        var e = all[i];
        if (e.children.length === 0 && (e.textContent || '').trim() === text && laidOut(e)) return e;
      }
      /* An element whose own text matches even with children, which is
         how a button with an icon in it reads. */
      for (var j = 0; j < all.length; j++) {
        var f = all[j];
        if ((f.textContent || '').trim() === text && f.children.length <= 2 && laidOut(f)) return f;
      }
      return null;
    }

    /* The bordered, rounded box a set of words sits inside. That is what
       the kit uses for every card, chip and panel, so it is a reliable
       way to find one without naming a class. */
    /* The control a set of words sits inside.

       A button or a link first, because that is what a control is. Then
       the nearest rounded ancestor narrower than a panel: everything in
       this kit sits on white, so "has a background" alone climbs past
       the chip and lands on the panel behind it. That is how "3
       archived roles" came out 1126 wide. */
    function boxOf(el) {
      var e = el;
      while (e && e !== document.body) {
        if (e.tagName === 'BUTTON' || e.tagName === 'A') return e;
        var s = getComputedStyle(e);
        var w = e.getBoundingClientRect().width;
        if (s.borderRadius !== '0px' && w > 0 && w < 600) return e;
        e = e.parentElement;
      }
      return el;
    }

    /* The demonstration panel that follows a section label, and the
       cards inside it. The kit lays each set out as one panel of
       siblings, so nth is the kit's own order. */
    function panelAfter(label, nth) {
      var hit = exact(label);
      if (!hit) return null;
      var block = hit.parentElement;
      while (block && block !== document.body) {
        var next = block.nextElementSibling;
        if (next) {
          var s = getComputedStyle(next);
          if (s.borderTopWidth !== '0px' || s.borderRadius !== '0px') {
            var kids = Array.prototype.slice.call(next.children);
            /* One wrapper deep where the panel wraps its row. */
            if (kids.length === 1 && kids[0].children.length > 1) {
              kids = Array.prototype.slice.call(kids[0].children);
            }
            return kids[nth] || null;
          }
        }
        block = block.parentElement;
      }
      return null;
    }

    function styleOf(el) {
      if (!el) return null;
      var s = getComputedStyle(el);
      var out = {};
      for (var i = 0; i < READ.length; i++) out[READ[i]] = s[READ[i]];
      var r = el.getBoundingClientRect();
      out.__w = Math.round(r.width);
      out.__h = Math.round(r.height);
      return out;
    }

    var out = { nodes: {}, parts: {}, missing: [] };

    Object.keys(config.nodes).forEach(function (k) {
      var t = config.nodes[k];
      var el = panelAfter(t.text, t.nth || 0);
      if (!el) { out.missing.push('node:' + k); return; }
      if (t.tint) {
        /* The tint bar: the first child that is narrow and full height,
           which is what a left edge strip is and what nothing else in
           the card is. */
        var kids = Array.prototype.slice.call(el.children);
        var bar = null;
        for (var q = 0; q < kids.length; q++) {
          var kr = kids[q].getBoundingClientRect();
          if (kr.width > 0 && kr.width <= 6 && kr.height >= el.getBoundingClientRect().height - 4) {
            bar = kids[q]; break;
          }
        }
        if (!bar) { out.missing.push('tint:' + k); return; }
        out.nodes[k] = styleOf(bar);
        return;
      }
      out.nodes[k] = styleOf(el);
    });

    Object.keys(config.parts).forEach(function (k) {
      var t = config.parts[k];
      var hit = t.placeholder
        ? document.querySelector('[placeholder="' + t.text + '"]')
        : exact(t.text);
      if (!hit) { out.missing.push('part:' + k + ' (' + t.text + ')'); return; }
      var el = hit;
      for (var i = 0; i < (t.up || 0); i++) el = boxOf(el.parentElement || el);
      out.parts[k] = styleOf(el);
    });

    return out;
  };`;

  await page.addScriptTag({ content: BROWSER });
  const read = await page.evaluate(
    `window.__rolesKit(${JSON.stringify({ nodes: NODES, parts: PARTS, read: READ })})`,
  ) as { nodes: Record<string, unknown>; parts: Record<string, unknown>; missing: string[] };

  await browser.close();

  if (read.missing.length > 0) {
    console.log('\n  the kit does not carry these, so nothing can be ported for them:\n');
    for (const m of read.missing) console.log(`    ${m}`);
    console.log('\n  Either the words changed in a new kit, or the target is wrong.\n');
    process.exit(1);
  }

  const body = `/* GENERATED by scripts/roles-kit-extract.ts from ${SOURCE}.
 *
 * Do not edit. Run \`npm run roles-kit:extract\` when a new kit arrives
 * and commit the result: \`npm run check:roles-kit\` regenerates it and
 * fails if this file has drifted from the kit.
 *
 * These are the kit's own computed styles, read back out of the
 * rendered page by a browser. The Roles components import them so that
 * no Roles component has to contain a number, which is the only
 * reliable way to stop one being invented.
 *
 * \`__w\` and \`__h\` are the measured box, carried so a component can
 * assert against them rather than set them. */

export const ROLE_NODES = ${JSON.stringify(read.nodes, null, 2)} as const;

export const ROLE_PARTS = ${JSON.stringify(read.parts, null, 2)} as const;
`;

  writeFileSync(OUT, body);
  console.log(`\n  ${Object.keys(read.nodes).length} nodes and `
    + `${Object.keys(read.parts).length} parts written to ${OUT}\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
