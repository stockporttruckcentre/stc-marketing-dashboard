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
import { RolesScreen } from '../components/admin/roles/RolesScreen';
import { buildModel, behaviourFor, DEPARTMENTS, type Input } from '../components/admin/roles/model';
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
const nav = [
  { label: 'Workspace', items: [{ label: 'Dashboard', icon: 'dashboard' as const, active: false }] },
  { label: 'Admin', items: [{ label: 'Admin', icon: 'admin' as const, active: true }] },
];
const mine = renderToStaticMarkup(createElement(RolesScreen, {
  model: buildModel(input), nav, me: { initials: 'GS', name: 'Gary Sutton', role: 'Managing Director' },
})).replace(/^<style>[\s\S]*?<\/style>/, '');
const kitHtml = readFileSync(`${KIT}/roles-page.html`, 'utf8')
  .replace(/<!--[\s\S]*?-->/g, '').replace(/<link[^>]*>/g, '');

/* ---- 3. In a browser ---- */
async function main() {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();

  /* The comparison, run inside the page so the browser does the
     parsing and neither side is read by a regex. */
  const COMPARE = `(function (kitHtml, mineHtml) {
    var parse = function (h) { var d = new DOMParser().parseFromString(h, 'text/html'); return d.querySelector('.r-62'); };
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
    var norm = function (tok) {
      if (/^sp-/.test(tok)) return 'sp-ID';
      if (/^lucide/.test(tok)) return null;
      for (var k in DATA) if (DATA[k].indexOf(tok) >= 0) return k.toUpperCase();
      return tok;
    };
    var sig = function (el) {
      var cls = (el.getAttribute('class') || '').split(/\\s+/).filter(Boolean).map(norm).filter(Boolean).sort();
      return el.tagName.toLowerCase() + (cls.length ? '.' + cls.join('.') : '');
    };
    var BOUND = ['for', 'id', 'data-list', 'data-for', 'title', 'placeholder', 'value', 'checked', 'hidden', 'style', 'class', 'xmlns'];
    var attrs = function (el) {
      var out = [];
      for (var i = 0; i < el.attributes.length; i++) { var a = el.attributes[i]; if (BOUND.indexOf(a.name) < 0) out.push(a.name + '=' + a.value); }
      return out.sort().join(' ');
    };
    var kids = function (el) { return Array.prototype.filter.call(el.childNodes, function (n) { return n.nodeType === 1; }); };

    /* (1) The static shell: everything outside the repeating regions,
       text included, must be identical. */
    var EMPTY = ['.roles-nav', '.r-6i', '.r-6q', '.r-6t', '.r-71', '.r-7j', '.r-7l', '.roles-inspector'];
    var BLANK = ['.r-4x', '.r-7p', '.r-7q'];
    var shell = function (root) {
      var c = root.cloneNode(true);
      Array.prototype.forEach.call(c.querySelectorAll(':scope > input'), function (n) { n.remove(); });
      EMPTY.forEach(function (s) { Array.prototype.forEach.call(c.querySelectorAll(s), function (n) { n.innerHTML = ''; }); });
      BLANK.forEach(function (s) { Array.prototype.forEach.call(c.querySelectorAll(s), function (n) { n.textContent = ''; }); });
      var ser = function (el) {
        var s = '<' + el.tagName.toLowerCase();
        var as = [];
        for (var i = 0; i < el.attributes.length; i++) as.push(el.attributes[i].name + '="' + el.attributes[i].value + '"');
        s += as.sort().map(function (a) { return ' ' + a; }).join('') + '>';
        Array.prototype.forEach.call(el.childNodes, function (n) {
          if (n.nodeType === 1) s += ser(n); else if (n.nodeType === 3 && n.textContent.trim()) s += n.textContent.trim();
        });
        return s + '</' + el.tagName.toLowerCase() + '>';
      };
      return ser(c);
    };
    var a = shell(K), b = shell(M), at = 0;
    while (at < a.length && a[at] === b[at]) at++;
    var shellSame = a === b;

    /* (2) Structure inside the loops: edges, adjacencies and elements.
       The in-shell navigation is skipped below its own element: its
       rows are this person's real sections in their real order, and
       its icons are the application's, so its insides are data. */
    var scan = function (root) { return Array.prototype.filter.call(root.querySelectorAll('*'), function (el) { return !el.closest('.roles-nav') || el.classList.contains('roles-nav'); }); };
    var edges = function (root) { var s = {}; scan(root).forEach(function (el) {
      var p = el.parentElement; if (p) s[sig(p) + ' > ' + sig(el)] = 1; }); return s; };
    var pairs = function (root) { var s = {}; scan(root).forEach(function (el) {
      if (el.classList.contains('roles-nav')) return;
      var ks = kids(el); for (var i = 1; i < ks.length; i++) s[sig(el) + ': ' + sig(ks[i - 1]) + ' + ' + sig(ks[i])] = 1; }); return s; };
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
    var unknown = {};
    Array.prototype.forEach.call(M.querySelectorAll('*'), function (el) {
      (el.getAttribute('class') || '').split(/\\s+/).filter(Boolean).forEach(function (t) {
        if (/^lucide/.test(t) || /^sp-/.test(t)) return; if (!defined[t]) unknown[t] = 1; }); });

    /* (4) Inline styles: only a bar width the kit has no class for. */
    var styled = [];
    Array.prototype.forEach.call(M.querySelectorAll('[style]'), function (el) {
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
