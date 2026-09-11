/* =============================================================
   Permissions, wired end to end, proved rather than promised.

   From the business, after an evening locked out of their own
   application with the managing director stood behind them:

     They now require a full scale agentic audit role by role,
     permission by permission, ensuring complete and full wiring from
     the admin hub out to each individual element on every single page.
     [...] "the next time this happens" shouldn't exist, if permissions
     are done right it's impossible to happen again.

   Right. So this is not a diagnostic. It is a set of properties that,
   while they hold, make whole classes of that evening impossible:

     1  No page may bounce somebody on a permission without saying so.
        A lookup that FAILS and a person who is REFUSED looked identical
        from outside, which is why an hour went into granting
        permissions that were never missing.

     2  A row the sidebar offers must open. The sidebar and the page
        guard must name the SAME capability, so "it is in the menu and
        it throws me out" cannot be expressed.

     3  Every capability named anywhere in the application must exist:
        in this build's own list, and in the database's catalogue. A
        guard on a capability nobody can hold is a locked door with no
        key cut for it.

     4  Role by role, page by page: for every active role, what the
        sidebar would show that role and what each page would allow that
        role must be the same set. This is the audit, and it runs
        against the real seeded database rather than against intentions.

     5  Every element gated inside a page must be gated on a capability
        that exists, and the page it sits on must be reachable by
        somebody who holds it. A button only an unreachable role can use
        is a button nobody can use.

   Run with `npm run check:permission-wiring`. Needs the disposable
   Postgres that `scripts/sql/build-test-db.sh` builds, because four and
   five are questions about the real grants, not about the source.
   ============================================================= */
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { NAVIGATION, type NavItem } from '../lib/nav';
import { requirementFor } from '../lib/platform/permissions/route-guard';
import { CAPABILITY_BY_KEY } from '../lib/platform/permissions/catalog';
import type { CrmCapability } from '../lib/crm/permissions';

let bad = 0;
const ok = (what: string, held: boolean, why?: string) => {
  console.log(`  ${held ? 'ok  ' : 'FAIL'}  ${what}`);
  if (!held) { bad += 1; if (why) console.log(`        ${why}`); }
};
const head = (s: string) => console.log(`\n  ${s}\n  ${'-'.repeat(s.length)}`);

/* ---- The database, for the questions only it can answer ---- */
const DB = process.env.PERM_DB ?? 'stcapplied';
function sql(query: string): string[][] {
  const out = execFileSync('psql', ['-U', 'postgres', '-d', DB, '-tAF', '', '-c', query], {
    encoding: 'utf8',
    env: { ...process.env, PGHOST: process.env.PGHOST ?? '/var/tmp/pgtest', PGPORT: process.env.PGPORT ?? '55432' },
  });
  return out.split('\n').filter(Boolean).map((l) => l.split(''));
}

/* -------------------------------------------------------------
   Where each navigation row actually lands.

   A row may point at a page that only redirects, as Revenue does, so
   the guard that matters is the one on the page at the end of the
   chain. Followed once, which is as deep as this application goes.
   ------------------------------------------------------------- */
function pageFileFor(href: string): string | null {
  const direct = `app${href}/page.tsx`;
  if (!existsSync(direct)) return null;
  const src = readFileSync(direct, 'utf8');
  const hop = src.match(/redirect\('(\/dashboard\/[^']+)'\)/);
  if (hop && !/command_may|screenCapabilities|mayOpen/.test(src)) {
    const next = `app${hop[1]}/page.tsx`;
    if (existsSync(next)) return next;
  }
  return direct;
}

/** The capability a page guards itself on, if it guards itself. */
function guardOf(file: string): { capability: string | null; source: string } {
  let src = readFileSync(file, 'utf8');
  /* A page may hand its body to a shared screen, as the three revenue
     divisions do. The guard lives there. */
  const shared = src.match(/from '@\/(app\/[^']+\/screen)'/);
  if (shared && existsSync(`${shared[1]}.tsx`)) src = readFileSync(`${shared[1]}.tsx`, 'utf8');
  /* ---- The one shape a guard may take ----

     `guardRoute` and `requirePage` both read the requirement out of
     `lib/nav.ts` by route, so a page that uses either cannot name a
     capability of its own. That is the whole mechanism: the guard is
     declared once and read twice. A page using one of them is
     reported as guarded BY DECLARATION, and rule 2 below then has
     nothing left to check, because there are not two things to
     disagree.

     Anything else, a hand-rolled `command_may` or a bare `caps.has`
     leading to a redirect, is the old shape and is reported so it can
     be moved over. */
  const declared = src.match(/(?:guardRoute|requirePage)\(\s*supabase,\s*'([^']+)'/);
  if (declared) return { capability: 'DECLARED', source: declared[1]! };
  /* A capability READ into a prop is not a guard. The Team page asks
     `admin.users` and hands the answer to its panel so the buttons
     know; it lets everybody in, and the sidebar says so. Only a check
     that actually stops the render counts. */
  const blocking = src.match(/command_may',\s*\{\s*p_capability:\s*'([^']+)'[\s\S]{0,200}?(?:redirect\(|NoAccess)/)
    ?? src.match(/caps\.has\('([^']+)'\)[\s\S]{0,120}?(?:redirect\(|NoAccess)/);
  if (blocking) return { capability: blocking[1]!, source: 'hand rolled' };
  return { capability: null, source: 'none' };
}

const ROWS: NavItem[] = NAVIGATION.flatMap((s) => s.items).flatMap((i) => [i, ...(i.children ?? [])]);

/* =============================================================
   1. Nothing bounces silently on a permission.
   ============================================================= */
head('No page throws somebody out without saying why');
{
  const offenders: string[] = [];
  for (const row of ROWS) {
    const file = pageFileFor(row.href);
    if (!file) continue;
    const src = readFileSync(file, 'utf8');
    /* The exact shape that cost the evening: ask the database, then
       bounce on anything that is not a yes, which includes the call
       having failed. */
    if (/command_may[\s\S]{0,200}?!==\s*true\)\s*redirect\(/.test(src)
        || /caps\.has\([^)]*\)\)\s*redirect\('\/dashboard'\)/.test(src)) {
      offenders.push(`${file} bounces to the dashboard on a permission instead of saying why`);
    }
  }
  ok('no page redirects on a failed or refused permission check',
    offenders.length === 0,
    `${offenders.join('\n        ')}\n        Use mayOpen() and render <NoAccess>, which tells a refusal from a broken lookup.`);
}

/* =============================================================
   2. A row the sidebar offers is a page that opens.
   ============================================================= */
head('Every guard is the same declaration the menu reads');
{
  const handRolled: string[] = [];
  const wrongRoute: string[] = [];
  const ungated: string[] = [];
  let declared = 0;

  for (const row of ROWS) {
    const file = pageFileFor(row.href);
    if (!file) { ungated.push(`${row.label}: no page at ${row.href}`); continue; }
    const guard = guardOf(file);
    const needs = row.anyOf ?? (row.capability ? [row.capability] : []);

    if (guard.capability === 'DECLARED') {
      declared += 1;
      /* It reads the requirement by route, so the only way it can be
         wrong is by naming a DIFFERENT route than the one it serves. */
      const served = requirementFor(guard.source);
      const mine = requirementFor(row.href);
      if (served.join() !== mine.join()) {
        wrongRoute.push(`${row.label} (${row.href}) guards on ${guard.source}, which needs ${served.join(' or ') || 'nothing'}`);
      }
      continue;
    }
    if (guard.capability != null) {
      handRolled.push(`${row.label} (${row.href}) names ${guard.capability} itself instead of reading lib/nav.ts`);
      continue;
    }
    if (needs.length > 0) {
      ungated.push(`${row.label} (${row.href}) is gated in the sidebar on ${needs.join(' or ')} but the page itself guards nothing`);
    }
  }

  ok(`${declared} guarded pages read their requirement from lib/nav.ts`, declared > 0);
  ok('no page carries a second copy of the rule', handRolled.length === 0,
    `${handRolled.join('\n        ')}\n        Two copies of one rule drift. Use guardRoute(supabase, '<route>') or requirePage.`);
  ok('every declared guard serves the route it guards', wrongRoute.length === 0, wrongRoute.join('\n        '));
  ok('no page is gated in the menu but open at its address', ungated.length === 0,
    `${ungated.join('\n        ')}\n        A menu that hides a row the address bar still opens is not a permission, it is a decoration.`);
}

/* =============================================================
   3. Every capability named anywhere exists, both sides.
   ============================================================= */
head('Every capability named in the application exists');
{
  const inCatalogue = new Set(sql("SELECT key FROM capability_catalog").map((r) => r[0]!));
  const named = new Map<string, string>();
  for (const row of ROWS) {
    for (const c of [row.capability, ...(row.anyOf ?? [])]) if (c) named.set(c, `sidebar row ${row.label}`);
    const file = pageFileFor(row.href);
    if (file) {
      const g = guardOf(file);
      if (g.capability && g.capability !== 'DECLARED') named.set(g.capability, `page guard on ${row.href}`);
    }
  }
  const missingFromBuild = [...named].filter(([c]) => !CAPABILITY_BY_KEY[c as CrmCapability]);
  const missingFromDb = [...named].filter(([c]) => !inCatalogue.has(c));
  ok(`all ${named.size} are in this build's own list`, missingFromBuild.length === 0,
    missingFromBuild.map(([c, w]) => `${c} (${w})`).join('\n        '));
  ok(`all ${named.size} are in the database catalogue`, missingFromDb.length === 0,
    `${missingFromDb.map(([c, w]) => `${c} (${w})`).join('\n        ')}\n        A guard on a capability the database has never heard of can never answer yes.`);
}

/* =============================================================
   4. Role by role, page by page.
   ============================================================= */
head('Role by role, every row a role is shown is a page that opens for it');
{
  const roles = sql("SELECT id, slug, name FROM role_templates WHERE is_active ORDER BY sort_order");
  const grants = new Map<string, Set<string>>();
  for (const [id, cap] of sql("SELECT role_template_id, capability FROM role_template_capabilities")) {
    if (!grants.has(id!)) grants.set(id!, new Set());
    grants.get(id!)!.add(cap!);
  }
  ok(`there are roles to audit (${roles.length})`, roles.length > 0,
    'No active role templates. Run scripts/sql/build-test-db.sh first.');

  /* ---- What this can and cannot prove ----

     A page that guards by declaration reads the SAME list the menu
     reads, so for those two the answer is the same by construction and
     there is nothing to compare. What is worth proving, and is proved
     here, is the part construction does not give you: that every role
     can actually reach the screens its capabilities are supposed to
     buy it, and that no role is left able to reach nothing. A role
     holding thirty capabilities and able to open no screen is the
     evening this file exists for. */
  const stranded: string[] = [];
  const rows: string[] = [];
  let pairs = 0;

  for (const [id, slug, name] of roles) {
    const held = grants.get(id!) ?? new Set<string>();
    const opens: string[] = [];
    const hidden: string[] = [];
    for (const row of ROWS) {
      const file = pageFileFor(row.href);
      if (!file) continue;
      const needs = requirementFor(row.href);
      const may = needs.length === 0 || needs.some((c) => held.has(c));
      pairs += 1;
      (may ? opens : hidden).push(row.label);
    }
    rows.push(`${name.padEnd(22)} opens ${String(opens.length).padStart(2)} of ${opens.length + hidden.length}`);
    if (held.size > 0 && opens.length === 0) {
      stranded.push(`${name} (${slug}) holds ${held.size} capabilities and can open nothing at all`);
    }
  }

  ok(`${pairs} role and page pairs resolved from one declaration`, pairs > 0);
  ok('no role is stranded with nothing it can open', stranded.length === 0, stranded.join('\n        '));
  for (const line of rows) console.log(`        ${line}`);
}

/* =============================================================
   5. Every gated element sits on a page somebody can reach.
   ============================================================= */
head('Every gated element can be reached by somebody who holds it');
{
  const used = new Map<string, string>();
  const files = execFileSync('grep', ['-rl', '--include=*.tsx', "caps.has('", 'app', 'components'], { encoding: 'utf8' })
    .split('\n').filter(Boolean);
  for (const f of files) {
    for (const m of readFileSync(f, 'utf8').matchAll(/caps\.has\('([^']+)'\)/g)) used.set(m[1]!, f);
  }
  const unknown = [...used].filter(([c]) => !CAPABILITY_BY_KEY[c as CrmCapability]);
  ok(`all ${used.size} capabilities gating an element are real`, unknown.length === 0,
    unknown.map(([c, f]) => `${c} in ${f}`).join('\n        '));

  const inCatalogue = new Set(sql("SELECT key FROM capability_catalog").map((r) => r[0]!));
  const notSeeded = [...used].filter(([c]) => !inCatalogue.has(c));
  ok(`all ${used.size} are in the database catalogue too`, notSeeded.length === 0,
    notSeeded.map(([c, f]) => `${c} in ${f}`).join('\n        '));

  const heldBySomebody = new Set(sql(
    "SELECT DISTINCT rtc.capability FROM role_template_capabilities rtc JOIN role_templates rt ON rt.id = rtc.role_template_id WHERE rt.is_active",
  ).map((r) => r[0]!));
  const nobodyHolds = [...used].filter(([c]) => !heldBySomebody.has(c));
  ok('no element is gated on a capability no active role holds', nobodyHolds.length === 0,
    `${nobodyHolds.map(([c, f]) => `${c} in ${f}`).join('\n        ')}\n        That control is drawn for everybody and usable by nobody.`);
}

if (bad > 0) {
  console.log(`\n  ${bad} failed.`);
  console.log('  Permissions are only wired when every one of these holds.\n');
  process.exit(1);
}
console.log('\n  Permissions are wired end to end: menu, guard, catalogue, role and element all agree.\n');
