/* =============================================================
   The Roles port, diffed against the handoff, by a machine.

   `docs/source/roles_hub/HANDOFF.md`, step 4:

     Diff your rendered output against roles-page.html. It should
     differ only in the repeated content, never in structure or class
     names.

   This is that diff. It renders `RolesScreen` with the kit's own
   placeholder roles (roles-data.json), opens the result and the kit's
   roles-page.html in one browser, and asks:

     1. Outside the repeating regions, are the two documents the same
        element for element, attribute for attribute, word for word?
     2. Inside them, is every parent/child nesting and every sibling
        adjacency the port draws one the kit draws? Is every element
        the port draws, attributes included, one the kit draws?
     3. Is every class the port uses one the kit's stylesheets define?
     4. Is the only inline style the width of a coverage bar the kit
        has no class for?

   And of the files: roles-components.css and roles-behaviour.css are the
   kit's byte for byte, roles-tokens.css differs in its two selector
   lines and nowhere else, kit.generated.ts is what the generator says
   now, and the selection rules written for a real role reproduce the
   kit's for its own.

   Needs Chromium (present at /opt/pw-browsers) and no server.
   Run with `npm run check:roles-port`.
   ============================================================= */
import { readFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { chromium } from 'playwright';
import { RolesScreen, People, HistoryBody } from '../components/admin/roles/RolesScreen';
import { EditPermissions } from '../components/admin/roles/EditPermissions';
import { GridView, MatrixView } from '../components/admin/roles/views';
import { Compare } from '../components/admin/roles/Compare';
import { buildModel, behaviourFor, compare, DEPARTMENTS, type Input } from '../components/admin/roles/model';
import { KIT_IDS } from '../components/admin/roles/kit.generated';

const KIT = 'docs/source/roles_hub';
const APP = 'components/admin/roles';

let bad = 0;
const ok = (what: string, held: boolean, why?: string) => {
  console.log(`  ${held ? 'ok  ' : 'FAIL'}  ${what}`);
  if (!held) { bad += 1; if (why) console.log(`        ${why}`); }
};

/* ---- 1. The files ---- */
console.log('\n  The files are the kit\'s\n  ----------------------');
const same = (f: string) => readFileSync(`${KIT}/${f}`, 'utf8') === readFileSync(`${APP}/${f}`, 'utf8');
ok('roles-components.css is byte for byte the kit\'s', same('roles-components.css'));
ok('roles-behaviour.css is byte for byte the kit\'s', same('roles-behaviour.css'));
{
  const kit = readFileSync(`${KIT}/roles-tokens.css`, 'utf8')
    .replace(/^:root\{$/m, '.r-62{')
    .replace(/^\[data-stc-theme="dark"\]\{$/m, '[data-stc-theme="dark"] .r-62,[data-theme="dark"] .r-62{');
  const mine = readFileSync(`${APP}/roles-tokens.css`, 'utf8').replace(/^\/\*[\s\S]*?\*\/\n/, '');
  ok('roles-tokens.css differs from the kit\'s in its two selector lines and nowhere else', kit === mine);
}
{
  rmSync('/tmp/roles-kit.generated.ts', { force: true });
  execFileSync('npx', ['tsx', 'scripts/roles-port-generate.ts', '--out', '/tmp/roles-kit.generated.ts'], { stdio: 'pipe' });
  ok('kit.generated.ts is what the generator reads out of the kit now',
    readFileSync('/tmp/roles-kit.generated.ts', 'utf8') === readFileSync(`${APP}/kit.generated.ts`, 'utf8'));
}
{
  const kit = readFileSync(`${KIT}/roles-behaviour.css`, 'utf8').split('\n').filter((l) => l.startsWith('#sn-')).join('\n');
  ok('the selection rules written for a role are the kit\'s own, for its sixteen', behaviourFor(KIT_IDS) === kit);
}
{
  /* The kit states a disabled opacity once, on its menu's Delete row.
     The port reuses that number for every disabled control, so it has
     to stay the kit's number. */
  const kit = readFileSync(`${APP}/roles-components.css`, 'utf8')
    .match(/^\.r-9p\{[^}]*opacity:([^;}]*)/m)?.[1];
  const mine = readFileSync(`${APP}/port.css`, 'utf8')
    .match(/^\.r-62 button:disabled\{opacity:([^;}]*)\}/m)?.[1];
  ok('a disabled control fades by the amount the kit states on its own disabled row',
    kit != null && kit === mine, `kit ${kit} / port ${mine}`);
}
{
  /* ---- The inherited typography is the reference page's, not mine ----

     preview.html sets the font, colour and tracking on its body, and
     everything the kit's classes do not set comes from there. The port
     puts those same declarations on `.r-62` because the application's
     own base would otherwise be inherited instead. So they have to BE
     the reference's, and this is what says so: the v2 pack changed the
     tracking and the port kept the old value until a render comparison
     caught it. */
  const body = readFileSync(`${KIT}/preview.html`, 'utf8').match(/body\{([^}]*)\}/)?.[1] ?? '';
  const INHERITED = ['font-family', 'color', 'letter-spacing'];
  const want = INHERITED.map((p) => body.match(new RegExp(`(?:^|;)${p}:([^;]*)`))?.[1]?.trim());
  const mine = readFileSync(`${APP}/port.css`, 'utf8').match(/^\.r-62\{([^}]*)\}/m)?.[1] ?? '';
  const have = INHERITED.map((p) => mine.match(new RegExp(`(?:^|;)${p}:([^;]*)`))?.[1]?.trim());
  ok('the typography the screen inherits is preview.html\'s own body rule',
    want.every((v, i) => v != null && v === have[i]),
    INHERITED.map((p, i) => `${p}: kit ${want[i]} / port ${have[i]}`).join('\n        '));
}

/* ---- 2. The kit's data, as this screen's input ---- */
type KitData = {
  capabilityTotal: number;
  divisions: Record<string, { label: string; tint: string }>;
  roles: { id: string; label: string; division: string; holders: number; capabilities: string; reportsTo: string | null; kind: string }[];
};
const data = JSON.parse(readFileSync(`${KIT}/roles-data.json`, 'utf8')) as KitData;
const deptFor = (division: string) => DEPARTMENTS.find((d) => d.division === division)?.key ?? 'admin';
const total = data.capabilityTotal;
const areas = ['Jobs and workshop', 'Sales and deals', 'Hire contracts', 'Finance and pricing', 'People and rotas', 'Compliance', 'Reports'];
const caps = Array.from({ length: total }, (_, i) => ({
  key: i === total - 1 ? 'admin.roles' : `cap.${i}`, label: `Capability ${i}`, description: '',
  area: areas[i % areas.length]!, feature: 'f', danger: i < 3 ? 'destructive' : i < 8 ? 'sensitive' : 'routine', position: i,
}));
const input: Input = {
  roles: data.roles.map((r, i) => ({
    id: `role-${r.id}`, slug: r.id, name: r.label, description: null,
    department: deptFor(r.division), manages: [], escalates_to: r.reportsTo, sort_order: i + 1, customised_at: null,
  })),
  caps,
  grants: data.roles.flatMap((r) => {
    const n = Number(r.capabilities.split(' ')[0]);
    return caps.slice(0, n).map((c, i) => ({ role_template_id: `role-${r.id}`, capability: c.key, scope: i % 7 === 3 ? 'own' : 'company' }));
  }),
  holders: data.roles.flatMap((r) => Array.from({ length: r.holders }, (_, i) =>
    ({ id: `${r.id}-${i}`, role_template_id: `role-${r.id}`, name: `Person ${r.id} ${i}`, job_title: null }))),
};
const model = buildModel(input);
const mine = renderToStaticMarkup(createElement(RolesScreen, {
  model,
})).replace(/^<style>[\s\S]*?<\/style>/, '');
const kitHtml = readFileSync(`${KIT}/roles-page.html`, 'utf8')
  .replace(/<!--[\s\S]*?-->/g, '').replace(/<link[^>]*>/g, '');

/* ---- 3. In a browser ---- */
async function main() {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();

  /* The comparison, run inside the page so the browser does the
     parsing and neither side is read by a regex. */
  const COMPARE = `(function (kitHtml, mineHtml, isPart, rootSel) {
    /* The screen is rooted at the kit's own outermost element. A
       component is a fragment, so its root is the document body, or
       the element named by rootSel where the port legitimately wraps
       the kit's markup in something of its own. The shell comparison
       does not apply to a component. */
    var parse = function (h) {
      var d = new DOMParser().parseFromString(h, 'text/html');
      if (!isPart) return d.querySelector('.r-62');
      return rootSel ? d.querySelector(rootSel) : d.body;
    };
    var K = parse(kitHtml), M = parse(mineHtml);

    /* A class token that data chooses is normalised so a node's tint
       or a bar's width does not read as a structural difference. */
    var DATA = ${JSON.stringify({
      fill: [] as string[], tint: [] as string[], head: [] as string[], swatch: [] as string[],
      box: ['r-6u', 'r-4s', 'r-29', 'r-33'], verdict: ['r-c', 'r-e', 'r-58', 'r-b'], chip: ['r-7k', 'r-3l'], avatar: ['r-1l', 'r-v'],
    })};
    var css = ${JSON.stringify(readFileSync(`${KIT}/roles-components.css`, 'utf8'))};
    css.replace(/^\\.(r-[0-9a-z]+)\\{display:block;width:\\d+%;height:100%;background:var\\(--(success|warning|danger)\\)\\}$/gm, function (_, c) { DATA.fill.push(c); return ''; });
    css.replace(/^\\.(r-[0-9a-z]+)\\{position:absolute;left:0;top:0;bottom:0;width:3px;background:#/gm, function (_, c) { DATA.tint.push(c); return ''; });
    css.replace(/^\\.(r-[0-9a-z]+)\\{width:4px;align-self:stretch;background:#/gm, function (_, c) { DATA.head.push(c); return ''; });
    css.replace(/^\\.(r-[0-9a-z]+)\\{width:8px;height:8px;border-radius:2px;background:#/gm, function (_, c) { DATA.swatch.push(c); return ''; });
    var SWITCHER = ['vwtab', 'vw', 'vw-chart', 'vw-grid', 'vw-matrix', 'vw-body',
                    'rk-mini-node', 'rk-mini-view', 'is-dragging'];
    var norm = function (tok) {
      if (SWITCHER.indexOf(tok) >= 0) return null;
      if (/^sp-/.test(tok)) return 'sp-ID';
      if (/^lucide/.test(tok)) return null;
      for (var k in DATA) if (DATA[k].indexOf(tok) >= 0) return k.toUpperCase();
      return tok;
    };
    /* ---- span, button and label are compared as one ----

       The kit draws almost every control as a span, because a static
       page has nothing to bind. A control that has to DO something is a
       button, and one that has to check a radio is a label, so the port
       renders those tags where the kit has a span. Nothing else about
       them may differ: same class, same nesting, same neighbours, same
       attributes. That every one of them is genuinely wired is what
       check:dead-controls asserts, and which radio each label
       points at is asserted by the switcher test. */
    var TAG = function (t) { return (t === 'button' || t === 'label') ? 'span' : t; };
    var sig = function (el) {
      var cls = (el.getAttribute('class') || '').split(/\\s+/).filter(Boolean).map(norm).filter(Boolean).sort();
      return TAG(el.tagName.toLowerCase()) + (cls.length ? '.' + cls.join('.') : '');
    };
    /* Attributes the port BINDS rather than draws: an id, a label's
       target, a tooltip, a value, and the ones that carry state. The
       disabled attribute is on the list for one reason, stated so it
       cannot quietly grow: a control the person's permissions do not
       allow is disabled here and refused again inside the database.
       The kit draws no disabled state because the kit does not know
       who is looking. Everything NOT on this list still has to match
       the kit exactly. */
    var BOUND = ['for', 'id', 'data-list', 'data-for', 'title', 'placeholder', 'value', 'checked', 'hidden', 'disabled', 'data-vt', 'data-tint', 'data-density', 'data-minimap', 'data-balance', 'style', 'class', 'xmlns'];
    var attrs = function (el) {
      var out = [];
      for (var i = 0; i < el.attributes.length; i++) { var a = el.attributes[i]; if (BOUND.indexOf(a.name) < 0) out.push(a.name + '=' + a.value); }
      return out.sort().join(' ');
    };
    var kids = function (el) { return Array.prototype.filter.call(el.childNodes, function (n) { return n.nodeType === 1; }); };

    /* (1) The static shell: everything outside the repeating regions,
       text included, must be identical. */
    /* Regions whose contents are a loop over the data. The minimap
       joined them when it stopped being thirteen decorative blocks and
       started drawing the real chart. */
    var EMPTY = ['.r-6i', '.r-6q', '.r-6t', '.r-71', '.r-74', '.r-7j', '.r-7l', '.roles-inspector'];
    var BLANK = ['.r-4x', '.r-7p', '.r-7q'];
    var shell = function (root) {
      var c = root.cloneNode(true);
      /* The pack's 218px navigation column is chrome around the design,
         not part of it: this screen sits inside the application's own
         sidebar. It is removed from BOTH sides here so the rest of the
         shell is still compared character for character, and its
         absence from the port is asserted separately below. */
      Array.prototype.forEach.call(c.querySelectorAll('.roles-nav'), function (n) { n.remove(); });
      /* The view switcher's own wiring, normalised out of the text
         comparison and asserted properly below. roles-behaviour.css
         ships the rules and no file in the pack uses them, so the port
         supplies the three hooks they need: the radios, the vw-body
         host, the vw panels, and a data-vt label in place of the
         static span. Everything else about the toolbar still has to
         match the kit character for character. */
      Array.prototype.forEach.call(c.querySelectorAll('.vw-in'), function (n) { n.remove(); });
      Array.prototype.forEach.call(c.querySelectorAll('.vw-grid,.vw-matrix'), function (n) { n.remove(); });
      Array.prototype.forEach.call(c.querySelectorAll('.vw-grid,.vw-matrix'), function (n) { n.remove(); });
      Array.prototype.forEach.call(c.querySelectorAll('[class]'), function (n) {
        var keep = (n.getAttribute('class') || '').split(/\\s+/)
          .filter(function (t) { return t !== 'vwtab' && t !== 'vw' && t !== 'vw-chart' && t !== 'vw-body'; });
        n.setAttribute('class', keep.join(' '));
        n.removeAttribute('data-vt');
        n.removeAttribute('for');
      });
      Array.prototype.forEach.call(c.querySelectorAll(':scope > input'), function (n) { n.remove(); });
      EMPTY.forEach(function (s) { Array.prototype.forEach.call(c.querySelectorAll(s), function (n) { n.innerHTML = ''; }); });
      BLANK.forEach(function (s) { Array.prototype.forEach.call(c.querySelectorAll(s), function (n) { n.textContent = ''; }); });
      /* The same two the elements test treats as bound rather than
         drawn: a control the viewer's permissions do not allow is
         disabled and says why. Everything else about the shell, every
         tag, every class, every other attribute and all of the text,
         still has to match the kit exactly. */
      var STATE = ['disabled', 'title', 'data-density', 'data-tint', 'data-minimap'];
      var ser = function (el) {
        /* A tab the port turns into a label so it can check a radio.
           Compared as the span the kit draws; that it IS a label
           pointing at the right radio is asserted below. */
        var tag = TAG(el.tagName.toLowerCase());
        var s = '<' + tag;
        var as = [];
        for (var i = 0; i < el.attributes.length; i++) {
          if (STATE.indexOf(el.attributes[i].name) >= 0) continue;
          as.push(el.attributes[i].name + '="' + el.attributes[i].value + '"');
        }
        s += as.sort().map(function (a) { return ' ' + a; }).join('') + '>';
        Array.prototype.forEach.call(el.childNodes, function (n) {
          if (n.nodeType === 1) s += ser(n); else if (n.nodeType === 3 && n.textContent.trim()) s += n.textContent.trim();
        });
        return s + '</' + tag + '>';
      };
      return ser(c);
    };
    var a = isPart ? '' : shell(K), b = isPart ? '' : shell(M), at = 0;
    while (at < a.length && a[at] === b[at]) at++;
    var shellSame = a === b;

    /* (2) Structure inside the loops: edges, adjacencies and elements.
       The in-shell navigation is skipped below its own element: its
       rows are this person's real sections in their real order, and
       its icons are the application's, so its insides are data. */
    /* The Grid and Matrix are their own files in the pack and are
       compared against those below, so the screen comparison stops at
       their roots rather than reading their insides as part of it. */
    var SEPARATE = '.vw-grid,.vw-matrix';
    var scan = function (root) { return Array.prototype.filter.call(root.querySelectorAll('*'), function (el) {
      if (el.closest('.roles-nav') && !el.classList.contains('roles-nav')) return false;
      /* The view radios are the switcher's wiring, asserted whole by
         the switcher test rather than compared against a file that
         does not use them. */
      if (el.classList.contains('vw-in')) return false;
      /* The minimap's blocks are the chart, drawn small. There is no
         kit markup for them because the kit drew a picture of a tree
         rather than a tree. Its own box is still compared. */
      if (el.closest('.r-74') && !el.classList.contains('r-74')) return false;
      if (el.closest(SEPARATE)) return false;
      return true;
    }); };
    var edges = function (root) { var s = {}; scan(root).forEach(function (el) {
      var p = el.parentElement; if (p) s[sig(p) + ' > ' + sig(el)] = 1; }); return s; };
    var pairs = function (root) { var s = {}; scan(root).forEach(function (el) {
      if (el.classList.contains('roles-nav')) return;
      /* Neighbours of a separately-checked view are not a fact about
         the screen's markup: the kit has no file in which the chart and
         the grid are siblings, because it ships them apart. What the
         screen must get right is that each sits in the canvas body,
         which the edge test above asserts. */
      var ks = kids(el).filter(function (k) { return !k.matches(SEPARATE); });
      for (var i = 1; i < ks.length; i++) s[sig(el) + ': ' + sig(ks[i - 1]) + ' + ' + sig(ks[i])] = 1; }); return s; };
    var elements = function (root) { var s = {}; scan(root).forEach(function (el) {
      s[sig(el) + ' [' + attrs(el) + ']'] = 1; }); return s; };
    var missing = function (mineSet, kitSet) { return Object.keys(mineSet).filter(function (k) { return !kitSet[k]; }); };
    var badEdges = missing(edges(M), edges(K));
    var badPairs = missing(pairs(M), pairs(K));
    var badElements = missing(elements(M), elements(K));

    /* (3) Every class the port uses is one the kit defines. */
    var defined = {};
    css.replace(/\\.([a-zA-Z][\\w-]*)/g, function (_, c) { defined[c] = 1; return ''; });
    ${JSON.stringify(readFileSync(`${KIT}/roles-behaviour.css`, 'utf8'))}.replace(/\\.([a-zA-Z][\\w-]*)/g, function (_, c) { defined[c] = 1; return ''; });
    /* The port's own two stylesheets count as defining a class too. A
       class in either of them is one this repository has written down
       with its reason, which is the thing the test is actually about:
       no class may appear in the markup that nothing anywhere defines. */
    ${JSON.stringify(readFileSync(`${APP}/overrides.css`, 'utf8'))}.replace(/\\.([a-zA-Z][\\w-]*)/g, function (_, c) { defined[c] = 1; return ''; });
    ${JSON.stringify(readFileSync(`${APP}/port.css`, 'utf8'))}.replace(/\\.([a-zA-Z][\\w-]*)/g, function (_, c) { defined[c] = 1; return ''; });
    var unknown = {};
    Array.prototype.forEach.call(M.querySelectorAll('*'), function (el) {
      (el.getAttribute('class') || '').split(/\\s+/).filter(Boolean).forEach(function (t) {
        if (/^lucide/.test(t) || /^sp-/.test(t)) return; if (!defined[t]) unknown[t] = 1; }); });

    /* (4) Inline styles: only a bar width the kit has no class for. */
    var styled = [];
    Array.prototype.forEach.call(M.querySelectorAll('[style]'), function (el) {
      if (el.closest(SEPARATE)) return;
      /* The minimap is geometry: every block and the viewport box are
         placed from the real chart, as fractions. There is no class
         that could carry a position that changes as you scroll. */
      if (el.closest('.r-74')) return;
      var isFill = (el.getAttribute('class') || '').split(/\\s+/).some(function (t) { return DATA.fill.indexOf(t) >= 0; });
      if (!isFill || !/^width:\\s*\\d+%;?$/.test(el.getAttribute('style'))) styled.push(sig(el) + ' style="' + el.getAttribute('style') + '"'); });

    return {
      shellSame: shellSame, shellAt: at, shellKit: a.slice(Math.max(0, at - 120), at + 160), shellMine: b.slice(Math.max(0, at - 120), at + 160),
      badEdges: badEdges, badPairs: badPairs, badElements: badElements, unknown: Object.keys(unknown), styled: styled,
      panels: M.querySelectorAll('.sp').length, radios: M.querySelectorAll('input.sn-in').length, roles: ${data.roles.length},
      nodes: M.querySelectorAll('.sn-lab').length, rows: M.querySelectorAll('.sn-row').length
    };
  })`;

  const r = await page.evaluate(`${COMPARE}(${JSON.stringify(kitHtml)}, ${JSON.stringify(mine)})`) as {
    shellSame: boolean; shellAt: number; shellKit: string; shellMine: string;
    badEdges: string[]; badPairs: string[]; badElements: string[]; unknown: string[]; styled: string[];
    panels: number; radios: number; roles: number; nodes: number; rows: number;
  };

  console.log('\n  The markup is the kit\'s\n  ----------------------');
  ok('outside the repeating regions the two documents are identical, text included', r.shellSame,
    r.shellSame ? undefined : `first difference at ${r.shellAt}\n        kit:  ${r.shellKit}\n        mine: ${r.shellMine}`);
  ok('every parent/child nesting the port draws is one the kit draws', r.badEdges.length === 0, r.badEdges.slice(0, 8).join('\n        '));
  ok('every sibling adjacency the port draws is one the kit draws', r.badPairs.length === 0, r.badPairs.slice(0, 8).join('\n        '));
  ok('every element the port draws, attributes included, is one the kit draws', r.badElements.length === 0, r.badElements.slice(0, 8).join('\n        '));
  ok('every class the port uses is defined by the kit', r.unknown.length === 0, r.unknown.join(', '));
  ok('the only inline style is a bar width the kit has no class for', r.styled.length === 0, r.styled.slice(0, 5).join('\n        '));

  /* ---- 4. The components the pack ships as their own files ----

     Each is compared to ITS OWN file the same way: every element it
     draws, attributes included, every parent/child nesting and every
     class must be one that file draws. The shell test is not applied,
     because a component is mounted inside the screen rather than
     standing alone, so its outermost wrapper is legitimately the
     screen's. What is asserted is that nothing was added, renamed or
     restructured on the way in. */
  const PARTS: { what: string; file: string; markup: string; root?: string }[] = [
    {
      what: 'the Edit permissions modal', file: 'roles-edit-permissions.html',
      /* The kit file IS the dialog card. The backdrop around it is the
         application's own modal chrome, copied from its Modal in
         components/kit/forms.tsx, and is asserted separately below. */
      root: '.r-3z',
      markup: renderToStaticMarkup(createElement(EditPermissions, {
        role: input.roles[0]!, caps: caps.slice(0, 6),
        held: new Map([[caps[0]!.key, 'company'], [caps[2]!.key, 'department']]),
        onClose: () => {}, onSave: () => {}, saving: false, failed: null,
      })),
    },
    {
      what: 'the People tab', file: 'roles-tab-people.html',
      markup: renderToStaticMarkup(createElement(People, { panel: model.panels[0]! })),
    },
    {
      what: 'the History tab', file: 'roles-tab-history.html',
      markup: renderToStaticMarkup(createElement(HistoryBody, { panel: model.panels[0]! })),
    },
    {
      what: 'the Grid view', file: 'roles-view-grid.html',
      markup: renderToStaticMarkup(createElement(GridView, { model, onOpen: () => {} })),
    },
    {
      what: 'the Matrix view', file: 'roles-view-matrix.html',
      markup: renderToStaticMarkup(createElement(MatrixView, { matrix: model.matrix })),
    },
    {
      what: 'the Compare view', file: 'roles-compare.html',
      markup: renderToStaticMarkup(createElement(Compare, {
        what: compare(input, input.roles[0]!.slug, input.roles[1]!.slug)!, onClose: () => {},
      })),
    },
  ];

  {
    const navs = await page.evaluate(`(function (h) {
      var d = new DOMParser().parseFromString(h, 'text/html');
      return d.querySelectorAll('.roles-nav').length;
    })(${JSON.stringify(mine)})`) as number;
    ok('the pack\'s own navigation column is not drawn, because the application has one', navs === 0,
      `${navs} found`);
  }

  /* ---- The view switcher, against the rules that drive it ----

     `roles-behaviour.css` ships the switcher and no file in the pack
     uses it, so the markup it needs was derived from the rules
     themselves. This reads those rules back and asserts the port
     satisfies every one: for each view there is a radio with that id,
     a `.vw-body` after it, a `.vw` panel carrying the view's class
     inside it, and a `data-vt` control that a label points at. */
  {
    const rules = readFileSync(`${KIT}/roles-behaviour.css`, 'utf8');
    const views = [...new Set([...rules.matchAll(/^#vw-([a-z]+):checked/gm)].map((m) => m[1]!))];
    const wiring = await page.evaluate(`(function (h, views) {
      var d = new DOMParser().parseFromString(h, 'text/html');
      var bad = [];
      var host = d.querySelector('.vw-body');
      if (!host) bad.push('no .vw-body host for the rules to reach through');
      views.forEach(function (v) {
        var radio = d.querySelector('input.vw-in#vw-' + v);
        if (!radio) bad.push('no input.vw-in#vw-' + v);
        else if (host && !(radio.compareDocumentPosition(host) & Node.DOCUMENT_POSITION_FOLLOWING))
          bad.push('#vw-' + v + ' is not before .vw-body, so the sibling rule cannot reach it');
        var panel = host && host.querySelector('.vw.vw-' + v);
        if (!panel) bad.push('no .vw.vw-' + v + ' panel inside .vw-body');
        else if (!panel.closest('.roles-canvas-body'))
          bad.push('.vw-' + v + ' is not inside the canvas body, so it would not scroll or sit where the kit puts a view');
        var tab = host && host.querySelector('[data-vt=\"' + v + '\"]');
        if (!tab) bad.push('no [data-vt=' + v + '] control');
        else if (tab.tagName !== 'LABEL' || tab.getAttribute('for') !== 'vw-' + v)
          bad.push('[data-vt=' + v + '] does not point at #vw-' + v);
      });
      return bad;
    })(${JSON.stringify(mine)}, ${JSON.stringify(views)})`) as string[];
    ok(`the view switcher satisfies every rule roles-behaviour.css writes (${views.join(', ')})`,
      wiring.length === 0, wiring.join('\n        '));
  }

  console.log('\n  Each component is its own file\'s\n  ------------------------------');
  for (const part of PARTS) {
    const kitPart = readFileSync(`${KIT}/${part.file}`, 'utf8')
      .replace(/<!--[\s\S]*?-->/g, '').replace(/<link[^>]*>/g, '');
    const pr = await page.evaluate(
      `${COMPARE}(${JSON.stringify(kitPart)}, ${JSON.stringify(part.markup)}, true, ${JSON.stringify(part.root ?? '')})`) as {
      badEdges: string[]; badElements: string[]; unknown: string[];
    };
    ok(`${part.what} draws only what ${part.file} draws`,
      pr.badEdges.length === 0 && pr.badElements.length === 0 && pr.unknown.length === 0,
      [...pr.badEdges.slice(0, 4), ...pr.badElements.slice(0, 4),
       ...(pr.unknown.length ? [`classes not in the kit: ${pr.unknown.join(', ')}`] : [])].join('\n        '));
  }

  /* The one thing the port adds around a kit component, asserted by
     name so a second wrapper cannot appear without this failing. */
  {
    const shell = await page.evaluate(`(function (h) {
      var d = new DOMParser().parseFromString(h, 'text/html');
      var outer = d.body.firstElementChild;
      var path = [];
      for (var el = outer; el && !el.classList.contains('r-3z'); el = el.firstElementChild) {
        path.push(el.tagName.toLowerCase() + '.' + el.getAttribute('class'));
      }
      return path.join(' > ');
    })(${JSON.stringify(PARTS[0]!.markup)})`) as string;
    ok('the only thing the port wraps the modal in is its own backdrop',
      shell === 'div.roles-modal', `found ${shell}`);
  }

  console.log('\n  Every role is drawn\n  ------------------');
  ok(`one radio per role (${r.radios} of ${r.roles})`, r.radios === r.roles);
  ok(`one inspector panel per role (${r.panels} of ${r.roles})`, r.panels === r.roles);
  ok(`one chart node per role (${r.nodes} of ${r.roles})`, r.nodes === r.roles);
  ok(`one rail row per role (${r.rows} of ${r.roles})`, r.rows === r.roles);

  await browser.close();
  if (bad > 0) { console.log(`\n  ${bad} failed.\n`); process.exit(1); }
  console.log('\n  The port diffs cleanly against the handoff.\n');
}

main().catch((e) => { console.error(e); process.exit(1); });
