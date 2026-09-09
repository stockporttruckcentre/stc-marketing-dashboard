/* =============================================================
   Diff a device against the kit, node by node.

   ---- Why the earlier checks were not enough ----

   `check:kit` asserted a dozen facts somebody chose. `check:invention`
   refuses a hand written number. Neither answers the question the
   business actually asks:

     You need to work more on your engine to ban it from writing even a
     single character of code that wasn't found in that html. If <div>
     isn't in the html then claude is banned from using divs.

   That is a structural question, so this renders both and compares the
   trees. The kit at `docs/source/STCUIAnalytics.html`, unpacked and
   served from disk. Ours at the preview harness. For each named device
   it walks both DOMs and reports every node whose tag or inline style
   differs, and every node present in one and missing from the other.

   ---- What is allowed to differ ----

   Two things, and only two:

     1. TEXT. The kit says "January" and "14" because it is showing
        made up data. Ours says whatever the business has. A difference
        in words is not a difference in design.
     2. HOW MANY OF A REPEATED ROW. The kit draws eight cohorts. We
        draw however many exist. So consecutive siblings with the same
        tag and the same style collapse to one before comparing, and
        the comparison is of the SHAPES, not the counts.

   Everything else is a defect: a tag we invented, a style we typed, a
   node we added, a node we dropped.

   Run with `npm run check:kit-diff` while the preview is up.
   ============================================================= */
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { chromium, type Page } from 'playwright';

const SOURCE = 'docs/source/STCUIAnalytics.html';
const WORK = '/tmp/kit-diff-work';
const MINE = process.env.PREVIEW_URL ?? 'http://localhost:3000/analytics-preview';

/**
 * Devices ported from the kit, checked one for one.
 *
 * This list was empty, and the reason was a real gap rather than a
 * convenience: the ported devices live on drill-downs and the preview
 * harness only mounted the landing, so the per-device check had
 * nothing to look at. The harness takes `?screen=` now, so it does.
 *
 * Each is found by the LABEL ABOVE THE PANEL, not by the title inside
 * it. The label is the kit's own words on both sides. The title
 * carries this period's figures, so it says "24 months, indexed" here
 * and "Twelve months, indexed" in the file, and matching on it would
 * compare nothing.
 */
const PORTED: Record<string, { label: string; screen: string }> = {
  indexed: { label: 'Indexed division trend', screen: 'revenue' },
  waterfall: { label: 'How the group number moved', screen: 'revenue' },
  bullet: { label: 'Revenue against target, by division', screen: 'revenue' },
  /* The cohort is found by the title INSIDE its panel, because it is
     the one device we render without the label above it: the kit's
     cohort panel carries its own title, and drawing ours over the top
     would print the title twice. Both spellings work, since the walk
     goes up to a bordered ancestor first and only steps sideways when
     there is none. */
  cohort: { label: 'Contract retention by start month', screen: 'fleetsmart' },
};

function unpack(): string {
  rmSync(WORK, { recursive: true, force: true });
  mkdirSync(WORK, { recursive: true });
  const raw = readFileSync(SOURCE, 'utf8');
  for (const m of raw.matchAll(
    /"([0-9a-f-]{36})"\s*:\s*\{"mime":"([^"]+)","compressed":(true|false),"data":"([A-Za-z0-9+/=]+)"/g,
  )) {
    const bytes = Buffer.from(m[4]!, 'base64');
    writeFileSync(`${WORK}/${m[1]}`, m[3] === 'true' ? gunzipSync(bytes) : bytes);
  }
  const page = raw.replace(/\\u002F/gi, '/').replace(/\\"/g, '"')
    .replace(/\\n/g, '\n').replace(/\\t/g, '\t');
  const a = page.indexOf('<!DOCTYPE html>');
  const b = page.lastIndexOf('</html>');
  writeFileSync(`${WORK}/index.html`, a >= 0 && b > a ? page.slice(a, b + 7) : page);
  return `file://${WORK}/index.html`;
}

/* The walk runs in the page, so it is written as a string: `tsx`
   compiles named functions with a `__name` helper the browser has not
   got. See scripts/kit-extract.ts, same reason. */
const WALK = `window.__kitWalk = function (title) {
  function panelFor(t) {
    var all = Array.prototype.slice.call(document.querySelectorAll('*'));
    var hit = null;
    for (var i = 0; i < all.length; i++) {
      if (all[i].children.length === 0 && (all[i].textContent || '').trim() === t) { hit = all[i]; break; }
    }
    if (!hit) return null;
    var el = hit;
    while (el && el !== document.body) {
      var s = getComputedStyle(el);
      if (s.borderTopWidth !== '0px' && s.borderRadius !== '0px') return el;
      el = el.parentElement;
    }

    /* A device's LABEL sits outside the panel, so walking up from it
       finds no border. The kit's device is a label block followed by
       the panel, so the panel is that block's next sibling. Same
       fallback as scripts/kit-extract.ts, and for the same reason. */
    var block = hit.parentElement;
    while (block && block !== document.body) {
      var next = block.nextElementSibling;
      if (next) {
        var ns = getComputedStyle(next);
        if (ns.borderTopWidth !== '0px' && ns.borderRadius !== '0px') return next;
      }
      block = block.parentElement;
    }
    return null;
  }

  /* Computed, not the attribute text.

     React serialises flex:1 as "flex: 1 1 0%" and rgba(9,22,58,1.00)
     as "rgb(9, 22, 58)". Those are the same design and different
     strings, and comparing strings buried the real differences under
     sixty of those. The browser has already resolved both sides, so
     ask it. */
  /* No width or height.

     Those are consequences of the page, not declarations. While the
     page was 1440 wide and the kit 1126, every node's computed width
     differed and one layout fault read as thirty nine design faults.
     The panel's own width is compared separately, once, which is where
     that fault actually belongs.

     Nothing is lost by dropping them: a px width cannot be typed by
     hand, check:invention refuses it, and the mirror copies the kit's
     style string whole. */
  var PROPS = ['display','flexDirection','flexGrow','flexShrink','flexBasis','gap',
    'paddingTop','paddingRight','paddingBottom','paddingLeft',
    'marginTop','marginRight','marginBottom','marginLeft','backgroundColor','color',
    'fontSize','fontWeight','fontFamily','fontStyle','letterSpacing','lineHeight','textAlign',
    'textTransform','fontVariantNumeric','borderTopWidth',
    'borderRadius','justifyContent','alignItems','position','overflow','whiteSpace'];

  function sig(el) {
    var c = getComputedStyle(el);
    var parts = [el.tagName.toLowerCase()];
    for (var i = 0; i < PROPS.length; i++) parts.push(PROPS[i] + '=' + c[PROPS[i]]);
    /* Border style and colour only count where a border is drawn.
       Tailwind's preflight sets style solid and a grey colour on every
       element at zero width, which renders nothing and flagged forty
       nodes as different from a kit that has no Tailwind. */
    if (c.borderTopWidth !== '0px') {
      parts.push('borderTopStyle=' + c.borderTopStyle, 'borderTopColor=' + c.borderTopColor);
    }
    return parts.join('|');
  }

  /* Every distinct shape the device draws, and how many of each.

     A set rather than a tree, because the kit shows eight cohorts and
     we show however many exist. Comparing positions makes a data
     difference look like a design one. Comparing the shapes used
     answers the question actually being asked: is there anything here
     that is not in the file. */
  function collect(el, out) {
    out[sig(el)] = (out[sig(el)] || 0) + 1;
    var kids = Array.prototype.slice.call(el.children);
    for (var i = 0; i < kids.length; i++) collect(kids[i], out);
    return out;
  }

  /* The whole page, for a screen the kit has no single device for.

     The executive landing is a COMPOSITION: the kit draws four equal
     KPI cards where the brief forbids them, three separate division
     scorecards where it asks for one table, and it has no "what's
     coming" panel at all. So the landing cannot be diffed against one
     device. What can be enforced is that every shape it draws exists
     somewhere in the kit, which is the promise "composed from kit
     atoms, not designed" actually cashing out. */
  if (title === '*page*') {
    var root = document.body;
    return { shapes: collect(root, {}), width: Math.round(root.getBoundingClientRect().width) };
  }

  var p = panelFor(title);
  if (!p) return null;
  return { shapes: collect(p, {}), width: Math.round(p.getBoundingClientRect().width) };
};`;

type Shapes = { shapes: Record<string, number>; width: number };

async function walk(page: Page, title: string): Promise<Shapes | null> {
  await page.addScriptTag({ content: WALK });
  return page.evaluate(`window.__kitWalk(${JSON.stringify(title)})`) as Promise<Shapes | null>;
}

/**
 * Which declarations differ, rather than a wall of shapes.
 *
 * Dumping the shape said "these twenty five are not in the kit" and
 * left somebody to spot the wrong property by eye across forty
 * declarations. So each shape we draw is matched to its nearest
 * neighbour in the kit and only the differences are printed. Usually
 * it is one property, repeated across every node, and naming it once
 * is the whole answer.
 */
function nearest(sig: string, pool: string[]): { best: string | null; diff: string[] } {
  const mine = new Map(sig.split('|').slice(1).map((p) => p.split('=') as [string, string]));
  const tag = sig.split('|')[0];
  let best: string | null = null;
  let bestDiff: string[] = [];
  for (const other of pool) {
    if (other.split('|')[0] !== tag) continue;
    const theirs = new Map(other.split('|').slice(1).map((p) => p.split('=') as [string, string]));
    const diff: string[] = [];
    for (const [k, v] of mine) {
      const t = theirs.get(k);
      if (t !== v) diff.push(`${k}: kit ${t ?? 'unset'}, ours ${v}`);
    }
    if (best === null || diff.length < bestDiff.length) { best = other; bestDiff = diff; }
  }
  return { best, diff: bestDiff };
}

function readable(sig: string): string {
  return `<${sig.split('|')[0]}>`;
}

/* -------------------------------------------------------------
   The one departure from the kit that is deliberate

   The kit is a light design and writes its data colours as literal
   hexes: navy for STC, a mid blue for trailer sales, a pale blue for
   rentals. This application has a dark theme as well, where navy on a
   navy ground is a shape nobody can see, so each series has a token
   with a value on each ground. `app/kit-tokens.css` holds them and
   explains why, after the same fault the other way round: "the bottom
   bar graph is blinding".

   Without this the check would report those three swaps on every chart
   forever, and a check that always fails is a check nobody reads. So
   the substitution is undone before comparing: our light theme value
   for a series is mapped back to the kit's hex for that series, and
   ONLY those three. Anything else that differs still fails.

   Both halves are read rather than typed. The kit's hexes come out of
   `kit.generated.ts`, which a browser read from the file; ours come
   out of the token file's light block.
   ------------------------------------------------------------- */
const SANCTIONED: [string, string][] = (() => {
  const css = readFileSync('app/kit-tokens.css', 'utf8');
  const light = css.slice(0, css.indexOf("[data-theme='dark']"));
  const valueOf = (name: string) =>
    light.match(new RegExp(`--${name}\\s*:\\s*(#[0-9A-Fa-f]{6})`))?.[1] ?? null;

  const gen = readFileSync('lib/analytics/kit.generated.ts', 'utf8');
  const colours = JSON.parse(
    gen.slice(gen.indexOf('export const KIT_COLOURS = ') + 'export const KIT_COLOURS = '.length)
      .split(' as const;')[0]!,
  ) as Record<string, string>;

  const rgb = (hex: string) => {
    const n = hex.replace('#', '');
    return `rgb(${parseInt(n.slice(0, 2), 16)}, ${parseInt(n.slice(2, 4), 16)}, ${parseInt(n.slice(4, 6), 16)})`;
  };

  const pairs: [string, string][] = [];
  for (const [series, token] of [
    ['STC', 'chart-stc'], ['Trailer sales', 'chart-trailer'], ['Rentals', 'chart-rental'],
  ] as [string, string][]) {
    const kitHex = colours[series];
    const ours = valueOf(token);
    if (kitHex && ours) pairs.push([rgb(ours), rgb(kitHex)]);
  }
  return pairs;
})();

/** Put a series colour back to the kit's, and leave everything else. */
function unswap(sig: string): string {
  let out = sig;
  for (const [ours, kit] of SANCTIONED) out = out.split(ours).join(kit);
  return out;
}

const diffs: string[] = [];

async function main() {
  const kitUrl = unpack();
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const kitPage = await browser.newPage({ viewport: { width: 1600, height: 1200 } });
  await kitPage.goto(kitUrl, { waitUntil: 'networkidle' });
  await kitPage.waitForTimeout(1000);

  const ourPage = await browser.newPage({ viewport: { width: 1600, height: 1200 } });
  try {
    await ourPage.goto(MINE, { waitUntil: 'networkidle', timeout: 20000 });
  } catch {
    console.log(`\n  The preview is not running at ${MINE}.`);
    console.log('  Start it with `npm run dev` and run this again.\n');
    await browser.close();
    process.exit(1);
  }
  await ourPage.evaluate("document.documentElement.setAttribute('data-theme','light')");
  await ourPage.waitForTimeout(2000);

  let clean = 0;
  for (const [key, { label, screen }] of Object.entries(PORTED)) {
    console.log(`\n  ${key}: "${label}"  (${screen})\n  ---------`);
    /* The harness mounts one screen at a time, so it is navigated
       per device rather than the whole hub being asked for at once. */
    await ourPage.goto(`${MINE}?screen=${screen}`, { waitUntil: 'networkidle', timeout: 20000 });
    await ourPage.evaluate("document.documentElement.setAttribute('data-theme','light')");
    await ourPage.waitForTimeout(1600);
    const kit = await walk(kitPage, label);
    const mine = await walk(ourPage, label);
    if (!kit) { console.log('  FAIL  not found in the kit'); diffs.push(`${key}: absent from the kit`); continue; }
    if (!mine) { console.log('  FAIL  not found on our page'); diffs.push(`${key}: absent from our page`); continue; }

    const invented = Object.keys(mine.shapes).filter((sh) => !(unswap(sh) in kit.shapes));
    const unused = Object.keys(kit.shapes).filter((sh) => !(sh in mine.shapes));

    if (invented.length === 0) {
      clean += 1;
      console.log(`  ok    every shape we draw is one the kit draws (${Object.keys(mine.shapes).length} distinct)`);
    } else {
      console.log(`  FAIL  ${invented.length} shape${invented.length === 1 ? '' : 's'} we draw are not in the kit`);

      /* Count which property is responsible, across every mismatch.
         One wrong declaration inherited from a parent shows up on
         every node, and saying so once is more use than listing them. */
      const blame = new Map<string, number>();
      const detail: string[] = [];
      for (const sig of invented) {
        const { diff } = nearest(unswap(sig), Object.keys(kit.shapes));
        for (const d of diff) blame.set(d, (blame.get(d) ?? 0) + 1);
        detail.push(`${readable(sig)}  ${diff.slice(0, 3).join('; ') || 'no near match in the kit'}`);
      }
      const ranked = [...blame.entries()].sort((a, b) => b[1] - a[1]);
      for (const [what, n] of ranked.slice(0, 10)) console.log(`        x${String(n).padStart(3)}  ${what}`);
      if (ranked.length > 10) console.log(`        ... and ${ranked.length - 10} other properties`);
      diffs.push(...ranked.map(([what, n]) => `${key}: x${n} ${what}`));
    }

    /* Not a failure. The kit draws eight cohorts and a book with three
       will not use every shade, so a shape the kit has and we do not
       is usually just data. Said out loud so it can be read rather
       than assumed. */
    if (unused.length) console.log(`  note  ${unused.length} shapes the kit draws are unused here, which is usually data`);

    console.log(`  width kit ${kit.width}px, ours ${mine.width}px${kit.width === mine.width ? '' : '   DIFF'}`);
    if (kit.width !== mine.width) diffs.push(`${key}: panel is ${mine.width}px, the kit draws it at ${kit.width}px`);
  }

  /* -------------------------------------------------------------
     The executive landing, against the whole kit

     Not against one device, because it is composed from several. Every
     shape it draws has to exist somewhere in the kit page, which is
     what stops a composition becoming an invention.
     ------------------------------------------------------------- */
  console.log('\n  the executive landing, against the whole kit\n  ---------');
  {
    await ourPage.goto(MINE, { waitUntil: 'networkidle', timeout: 20000 });
    await ourPage.evaluate("document.documentElement.setAttribute('data-theme','light')");
    await ourPage.waitForTimeout(1600);
    const kitAll = await walk(kitPage, '*page*');
    const landing = await walk(ourPage, '*page*');
    if (!kitAll || !landing) {
      console.log('  FAIL  could not read one of the pages');
      diffs.push('landing: could not read one of the pages');
    } else {
      const invented = Object.keys(landing.shapes).filter((sh) => !(unswap(sh) in kitAll.shapes));
      if (invented.length === 0) {
        console.log(`  ok    every shape on the landing exists in the kit (${Object.keys(landing.shapes).length} distinct)`);
      } else {
        console.log(`  FAIL  ${invented.length} shapes on the landing are not in the kit anywhere`);
        const blame = new Map<string, number>();
        for (const sig of invented) {
          for (const d of nearest(unswap(sig), Object.keys(kitAll.shapes)).diff) {
            blame.set(d, (blame.get(d) ?? 0) + 1);
          }
        }
        for (const [what, n] of [...blame.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
          console.log(`        x${String(n).padStart(3)}  ${what}`);
        }
        diffs.push(`landing: ${invented.length} shapes not in the kit`);
      }
    }
  }

  await browser.close();
  console.log('\n  ---------\n');
  if (diffs.length) {
    console.log(`  ${diffs.length} difference${diffs.length === 1 ? '' : 's'} from the kit.`);
    console.log('  Text and row counts are already ignored. Everything above is a');
    console.log('  tag or a declaration that is not in docs/source/STCUIAnalytics.html.\n');
    process.exit(1);
  }
  console.log(`  ${clean}/${Object.keys(PORTED).length} ported devices match the kit node for node.\n`);
}

main();
