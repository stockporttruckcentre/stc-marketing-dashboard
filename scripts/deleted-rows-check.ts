/* =============================================================
   A deleted row never comes back.

   ---- The fault this exists because of ----

   From the business, using the social planner for real:

     i tried to delete it as i've already remade the post and the draft
     is still sat there.

   The delete had worked. `soft_delete` stamped `deleted_at`, the screen
   took the card away, and then the next page load put it back, because
   the planner's server read was

     .from('social_posts').select('*').order(...)

   with no `deleted_at` filter on it. The refresh read next door,
   `/api/content/posts`, has always had one. So two reads of one table
   disagreed about what existed, and which answer somebody got depended
   on whether they had reloaded the page.

   That is not a social planner bug. It is one line missing from one
   query, and there is nothing about that line that makes it easier to
   remember on the next screen than it was on this one.

   ---- The rule ----

     A READ OF A TABLE THAT CAN BE SOFT DELETED SAYS SO.

   The tables are read out of the migrations rather than listed here, so
   a table that gains `deleted_at` tomorrow is covered tomorrow.

   ---- Why a baseline ----

   This rule was written years of screens too late, and there are reads
   across the CRM that predate it. Failing all of them today would mean
   turning the check off, which is how a rule stops being enforced. So
   the count each file is allowed is recorded in
   `scripts/deleted-rows-baseline.json`. It may FALL and may never RISE:
   an old screen can be fixed whenever somebody is in it, and a new
   unfiltered read fails on the day it is written.

   Run with `npm run check:deleted-rows`.
   ============================================================= */
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const BASELINE = 'scripts/deleted-rows-baseline.json';
const ROOTS = ['app', 'components', 'lib'];

let bad = 0;
const say = (s: string) => console.log(s);

/* -------------------------------------------------------------
   Which tables can be soft deleted

   Asked of a real PostgreSQL with this repository's schema on it, not
   parsed out of the SQL text. The first version of this parsed the
   migrations, found NOTHING, and printed a pass: `deleted_at` is added
   in several shapes in this repository and the regular expressions
   matched none of them. A check that silently covers zero tables and
   says "ok" is worse than no check, so the count is asserted below as
   well.
   ------------------------------------------------------------- */
function softDeletable(): Set<string> {
  const out = execFileSync('psql', [
    '-p', '55432', '-U', 'postgres', '-d', 'stctest', '-tAc',
    "SELECT table_name FROM information_schema.columns "
    + "WHERE table_schema = 'public' AND column_name = 'deleted_at' ORDER BY table_name",
  ], {
    encoding: 'utf8',
    env: { ...process.env, PGHOST: '/var/tmp/pgtest', PATH: `/usr/lib/postgresql/16/bin:${process.env.PATH}` },
  });
  return new Set(out.split('\n').map((l) => l.trim()).filter(Boolean));
}

/* -------------------------------------------------------------
   Every read, and whether it says anything about deletes
   ------------------------------------------------------------- */
type Read = { file: string; line: number; table: string; chain: string };

function readsIn(file: string, tables: Set<string>): Read[] {
  const src = readFileSync(file, 'utf8');
  const out: Read[] = [];

  for (const m of src.matchAll(/\.from\(\s*'([a-z_][\w]*)'\s*\)/g)) {
    const table = m[1]!;
    if (!tables.has(table)) continue;

    /* The rest of the statement: to the first `;` outside brackets. */
    let i = m.index! + m[0].length, depth = 0, quote = '';
    for (; i < src.length; i += 1) {
      const c = src[i]!;
      if (quote) { if (c === '\\') { i += 1; continue; } if (c === quote) quote = ''; continue; }
      if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
      if (c === '(' || c === '{' || c === '[') { depth += 1; continue; }
      if (c === ')' || c === '}' || c === ']') { depth -= 1; if (depth < 0) break; continue; }
      if (c === ';' && depth === 0) break;
    }
    const chain = src.slice(m.index!, i);

    /* A write is not a read. `soft_delete` itself, and the restore that
       undoes it, are the two things that must touch deleted rows. */
    if (/\.(insert|upsert|update|delete)\s*\(/.test(chain)) continue;
    if (!/\.select\s*\(/.test(chain)) continue;

    /* ---- One record, by its id, is a different question ----

       This rule is about LISTS: the read that decides what is on a
       screen, which is where a deleted row reappears and nobody is
       looking for it. Fetching one record by its primary key is
       usually a drawer somebody opened, a row just written being read
       back, or a restore, and all three have a reason to see a deleted
       row. Holding those to the same rule would add a filter to a
       hundred harmless lines, and a rule that makes noise is a rule
       people learn to skip. */
    if (/\.eq\(\s*'id'\s*,/.test(chain) && /\.(single|maybeSingle)\s*\(/.test(chain)) continue;

    out.push({
      file, table, chain,
      line: src.slice(0, m.index).split('\n').length,
    });
  }
  return out;
}

say('\n  A deleted row never comes back\n  ------------------------------');

let tables: Set<string>;
try {
  tables = softDeletable();
} catch {
  say('  skip  needs the disposable PostgreSQL. Start it, then `npm run check:deleted-rows`.\n');
  process.exit(0);
}

/* ---- The check, checked ----

   Zero tables means the question was asked wrongly, and the answer to a
   question asked wrongly is not "everything is fine". */
if (tables.size < 10 || !tables.has('social_posts') || !tables.has('crm_contacts')) {
  say(`  FAIL  only ${tables.size} soft deletable table(s) found, and the list is supposed to`);
  say('        include social_posts and crm_contacts. The discovery is broken, so nothing');
  say('        below means anything.');
  process.exit(1);
}
say(`  ${tables.size} table(s) can be soft deleted, asked of PostgreSQL.`);

const files: string[] = [];
const walk = (dir: string) => {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full);
    else if (/\.tsx?$/.test(name)) files.push(full);
  }
};
for (const r of ROOTS) walk(r);

const missing = new Map<string, Read[]>();
let reads = 0;
for (const file of files) {
  for (const r of readsIn(file, tables)) {
    reads += 1;
    if (/deleted_at/.test(r.chain)) continue;
    const held = missing.get(file) ?? [];
    held.push(r);
    missing.set(file, held);
  }
}

const base: Record<string, number> = existsSync(BASELINE)
  ? JSON.parse(readFileSync(BASELINE, 'utf8'))
  : {};

if (process.argv.includes('--write')) {
  const next: Record<string, number> = {};
  for (const [file, rs] of [...missing].sort()) next[file] = rs.length;
  writeFileSync(BASELINE, `${JSON.stringify(next, null, 2)}\n`);
  say(`\n  Baseline written: ${Object.keys(next).length} file(s), `
    + `${[...missing.values()].reduce((n, r) => n + r.length, 0)} unfiltered read(s).\n`);
  process.exit(0);
}

say(`  ${reads} read(s) of those tables across ${ROOTS.join(', ')}.\n`);

for (const [file, rs] of [...missing].sort()) {
  const allowed = base[file] ?? 0;
  if (rs.length > allowed) {
    bad += 1;
    say(`  FAIL  ${file}: ${rs.length} read(s) with no deleted_at filter, ${allowed} allowed`);
    for (const r of rs) say(`          line ${r.line}: ${r.table}`);
  }
}

/* The ratchet only ratchets if a file that has been fixed cannot slip
   back, so a count that has FALLEN is reported as a baseline to rewrite
   rather than left as slack. */
for (const [file, allowed] of Object.entries(base)) {
  const now = (missing.get(file) ?? []).length;
  if (now < allowed) {
    bad += 1;
    say(`  FAIL  ${file}: down to ${now} from ${allowed}. Run with --write to bank it.`);
  }
}

const total = [...missing.values()].reduce((n, r) => n + r.length, 0);
const allowedTotal = Object.values(base).reduce((n, v) => n + v, 0);

if (bad === 0) {
  say(`  ok    no read of a soft deletable table forgets its filter, `
    + `beyond the ${allowedTotal} this repository started with`);
  say('\n  A deleted row stays deleted, on every screen written from here on.\n');
  process.exit(0);
}
say(`\n  ${bad} file(s) out of step. ${total} unfiltered read(s) against ${allowedTotal} allowed.`);
say('  Add .is(\'deleted_at\', null) to the read, or run --write if the count has fallen.\n');
process.exit(1);
