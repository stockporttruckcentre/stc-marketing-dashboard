/* =============================================================
   Take the CSS out of the kit, so nobody writes it again.

   ---- The failure this exists to end ----

   The Analytics hub was built three times and was wrong the same way
   each time. The kit was opened, a description was formed from it, and
   CSS was then AUTHORED from the description. A cohort grid described
   as "navy cells that fade as retention falls" came out as a table with
   46px cells on a ramp normalised to the data, when the file plainly
   says flex rows with a 3px gap, 30px tall, alpha on navy, on a fixed
   70 to 100 scale.

   Intent survives being read and retyped. Measurements do not. And it
   compounds, because changing the container from flex to a table means
   every number has to be re-derived, and re-deriving is judgement.

   `CLAUDE.md` said "Recreate, never lift", written for the design
   system's own reference pages. Applying it to a kit the business sends
   is what licensed all of the above. It does not apply here: a kit sent
   for a screen is used, not reinterpreted.

   ---- What this does ----

   Renders `docs/source/STCUIAnalytics.html` in a real browser and reads
   the DOM back. Not a regex over markup: the browser resolves what the
   page actually is, so what comes out is the kit's own structure and
   its own inline styles, verbatim.

   The output is committed. `npm run check:kit` re-runs this and fails
   if the committed copy has drifted from the file, so the two cannot
   quietly disagree.

   Run with `npm run kit:extract`.
   ============================================================= */
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { chromium } from 'playwright';

const SOURCE = 'docs/source/STCUIAnalytics.html';
const OUT = process.argv.includes('--out')
  ? process.argv[process.argv.indexOf('--out') + 1]!
  : 'lib/analytics/kit.generated.ts';
const WORK = '/tmp/kit-extract-work';

/* -------------------------------------------------------------
   1. Make the file renderable

   It arrives as a wrapper: the page escaped inside it, and every font
   and script gzipped and base64'd under a UUID. Written out beside the
   page so the relative URLs resolve, which is what makes the fonts real
   and therefore what makes the measurements real.
   ------------------------------------------------------------- */
function unpack(): string {
  rmSync(WORK, { recursive: true, force: true });
  mkdirSync(WORK, { recursive: true });
  const raw = readFileSync(SOURCE, 'utf8');

  const asset = /"([0-9a-f-]{36})"\s*:\s*\{"mime":"([^"]+)","compressed":(true|false),"data":"([A-Za-z0-9+/=]+)"/g;
  for (const m of raw.matchAll(asset)) {
    const bytes = Buffer.from(m[4]!, 'base64');
    writeFileSync(`${WORK}/${m[1]}`, m[3] === 'true' ? gunzipSync(bytes) : bytes);
  }

  const page = raw
    .replace(/\\u002F/gi, '/').replace(/\\"/g, '"')
    .replace(/\\n/g, '\n').replace(/\\t/g, '\t');
  const a = page.indexOf('<!DOCTYPE html>');
  const b = page.lastIndexOf('</html>');
  writeFileSync(`${WORK}/index.html`, a >= 0 && b > a ? page.slice(a, b + 7) : page);
  return `file://${WORK}/index.html`;
}

/* -------------------------------------------------------------
   2. The devices, named by the text the kit puts on them

   A component asks for its styles by the same title the kit gives the
   device, so the two cannot drift apart without this failing loudly.
   ------------------------------------------------------------- */
const DEVICES: Record<string, string> = {
  cohort: 'Contract retention by start month',
  tierStack: 'Weekly contracted value',
  bullet: 'Month to date against target',
  indexed: 'Twelve months, indexed',
  waterfall: 'August close to September month to date',
  leaderboard: 'September, new business by person',
  dotplot: 'Lead to won conversion',
  sourceFlow: 'Where leads came from, and what became of them',
  scatter: 'Stock age against margin',
  ageing: 'Stock ageing bands',
  mix: 'Mix today, 96 contracts',
  verdict: 'The month in a sentence',
};

type Node = { tag: string; style?: string; text?: string; kids?: Node[] };

async function main() {
  const url = unpack();
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);

  /* Passed as a STRING, not a function.
     `tsx` compiles named functions with a `__name` helper that exists
     in Node and not in a page, so a function handed to `evaluate`
     throws ReferenceError the moment it is called. A string is compiled
     by the browser and has no helper in it. */
  const BROWSER = `window.__kitExtract = function (devices) {
    function panelFor(title) {
      var all = Array.prototype.slice.call(document.querySelectorAll('*'));
      var hit = null;
      for (var i = 0; i < all.length; i++) {
        if (all[i].children.length === 0 && (all[i].textContent || '').trim() === title) { hit = all[i]; break; }
      }
      var el = hit;
      while (el && el !== document.body) {
        var s = getComputedStyle(el);
        if (s.borderTopWidth !== '0px' && s.borderRadius !== '0px') return el;
        el = el.parentElement;
      }
      return hit ? hit.parentElement : null;
    }

    function tree(el, depth) {
      var style = el.getAttribute('style');
      var node = { tag: el.tagName.toLowerCase() };
      if (style) node.style = style;

      /* childNodes, not children.

         The kit writes mixed content: its cohort legend is
         70%<span>...swatches...</span>100%, two text nodes either side
         of an element. Walking element children only threw both labels
         away at extraction, so no amount of care downstream could put
         them back, and the grid shipped with a scale nobody could read.

         A text node is a node. It is recorded as one. */
      var raw = Array.prototype.slice.call(el.childNodes);
      var kids = [];
      for (var i = 0; i < raw.length; i++) {
        var n = raw[i];
        if (n.nodeType === 3) {
          /* Double backslash on purpose. This whole function is a
             template literal, and in one of those a backslash before
             an s is not an escape sequence, so it collapses to a plain
             s before the browser ever sees it. Written singly this
             line compiled to a regex matching the LETTER s, and it
             deleted every s from the kit's text: "Contract retention
             by start month" came out as "by  tart month".

             No backticks in this comment either. They would close the
             literal. */
          var t = (n.nodeValue || '').replace(/\\s+/g, ' ');
          if (t.trim()) kids.push({ tag: '#text', text: t });
        } else if (n.nodeType === 1 && depth < 8) {
          kids.push(tree(n, depth + 1));
        }
      }

      if (kids.length === 1 && kids[0].tag === '#text') {
        node.text = kids[0].text.trim().slice(0, 160);
      } else if (kids.length) {
        node.kids = kids;
      }
      return node;
    }

    var out = {};
    Object.keys(devices).forEach(function (key) {
      var title = devices[key];
      var panel = panelFor(title);
      out[key] = panel ? { title: title, found: true, node: tree(panel, 0) }
                       : { title: title, found: false };
    });

    var colours = {};
    Array.prototype.slice.call(document.querySelectorAll('span[style*="background:#"]')).forEach(function (sw) {
      var m = (sw.getAttribute('style') || '').match(/background:(#[0-9A-Fa-f]{6})/);
      var name = ((sw.nextSibling && sw.nextSibling.textContent) || '').trim();
      if (m && name && name.length <= 24) colours[name] = m[1].toUpperCase();
    });

    var ramps = {};
    Object.keys(devices).forEach(function (key) {
      var panel = panelFor(devices[key]);
      if (!panel) return;
      var stops = [], rgb = '';
      Array.prototype.slice.call(panel.querySelectorAll('span[style*="rgba("]')).forEach(function (sw) {
        var m = (sw.getAttribute('style') || '').match(/background:rgba\\((\\d+,\\s*\\d+,\\s*\\d+),\\s*([0-9.]+)\\)/);
        if (m && !(sw.textContent || '').trim()) { rgb = m[1].replace(/\\s/g, ''); stops.push(Number(m[2])); }
      });
      if (stops.length >= 3) {
        var lab = (panel.textContent || '').match(/(\\d+)%[^%]*?(\\d+)%\\s*$/);
        ramps[key] = { rgb: rgb, stops: stops, from: lab ? Number(lab[1]) : null, to: lab ? Number(lab[2]) : null };
      }
    });

    return { devices: out, colours: colours, ramps: ramps };
  };`;

  /* Injected as a script tag and then called by expression.
     This Playwright build ignores the argument when `evaluate` is given
     a string, so passing the devices as JSON inside the expression is
     the only form that actually receives them. */
  /* A regex escape lost to the template literal is silent: the code
     still runs and quietly does something else. Written as `\s` inside
     these backticks it collapses to a plain `s`, so `/\s+/g` became
     `/s+/g` and deleted every letter s from the kit's text. "Contract
     retention by start month" came out as "by  tart month".

     So the emitted script is checked for the escapes it is supposed to
     carry, before it is used. */
  for (const needed of ['\\s+', '\\d+', '\\(']) {
    if (!BROWSER.includes(needed)) {
      throw new Error(
        `The browser script lost the escape ${needed} to the template literal. `
        + 'Inside backticks, write a double backslash.',
      );
    }
  }

  writeFileSync(`${WORK}/extract.js`, BROWSER);
  await page.addScriptTag({ path: `${WORK}/extract.js` });
  const result = await page.evaluate(
    `window.__kitExtract(${JSON.stringify(DEVICES)})`,
  ) as {
    devices: Record<string, unknown>;
    colours: Record<string, string>;
    ramps: Record<string, unknown>;
  };

  await browser.close();

  const lines: string[] = [];
  lines.push(`/* GENERATED by scripts/kit-extract.ts from ${SOURCE}.
 *
 * Do not edit. Run \`npm run kit:extract\` when a new kit arrives, and
 * commit the result: \`npm run check:kit\` regenerates it and fails if
 * this file has drifted from the kit.
 *
 * These are the kit's own inline styles, read back out of the rendered
 * page. Analytics components import them so that no analytics component
 * has to contain a number, which is the only reliable way to stop one
 * being invented. */
`);
  lines.push(`export const KIT_COLOURS = ${JSON.stringify(result.colours, null, 2)} as const;\n`);
  lines.push(`export const KIT_RAMPS = ${JSON.stringify(result.ramps, null, 2)} as const;\n`);
  lines.push(`export const KIT_DEVICES = ${JSON.stringify(result.devices, null, 2)} as const;\n`);
  writeFileSync(OUT, lines.join('\n'));

  const found = Object.values(result.devices).filter((d) => (d as { found: boolean }).found).length;
  console.log(`  wrote ${OUT}`);
  console.log(`  ${found}/${Object.keys(DEVICES).length} devices found`);
  for (const [k, v] of Object.entries(result.devices)) {
    const d = v as { title: string; found: boolean };
    if (!d.found) console.log(`  NOT FOUND  ${k}  "${d.title}"`);
  }
  console.log(`  ${Object.keys(result.colours).length} named colours, ${Object.keys(result.ramps).length} heat scales`);
}

main();
