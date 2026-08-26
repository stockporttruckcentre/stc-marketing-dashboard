/* =============================================================
   Every column this application asks the database for.

   A function that is missing and a column that is missing fail the same
   way, and only one of the two was ever checked. This is the other one,
   and it exists because of a real failure:

     Nothing was changed
     column stock_trailers.sale_price does not exist

   Somebody marked two trailers sold and got a column name they had
   never typed. Two more of the same kind were sitting behind it, one of
   which broke every Lusha lookup a sentence could reach.

   None of them were visible from inside the test suite. The fake
   PostgREST handed back an empty cell for a column nothing holds, and
   `check:postgres` says so itself: the READ is simulated, because the
   store speaks PostgREST and the disposable server speaks SQL. So the
   one thing never proven was the one thing that broke.

   WHAT THIS READS.

   The source, not a list somebody maintains. Every `.from('table')`
   with a `.select('columns')` after it, in `app`, `lib` and
   `components`, checked against the real catalogue of the disposable
   server. A column added to a query without being added to the schema
   is caught here rather than by somebody in Bredbury.

   WHAT IT CANNOT SEE, AND SAYS SO.

   A select built from a variable or a template literal is a string this
   cannot read. Those are counted and listed rather than passed over in
   silence, because a check that quietly skips what it cannot do is how
   the last three got out.

     ./scripts/sql/build-test-db.sh && npm run check:columns
   ============================================================= */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const PSQL = '/usr/lib/postgresql/16/bin/psql';
const SOCKET = '/var/tmp/pgtest';

/* -------------------------------------------------------------
   Reading the source
   ------------------------------------------------------------- */

type Ask = { file: string; line: number; table: string; columns: string[] };
type Unreadable = { file: string; line: number; table: string; why: string };

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.next' || name.startsWith('.')) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) { sources(path, out); continue; }
    if (/\.tsx?$/.test(name)) out.push(path);
  }
  return out;
}

/** Split a select list on the commas between columns, not inside embeds. */
function columnsIn(list: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of list) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) { out.push(current); current = ''; continue; }
    current += ch;
  }
  if (current.trim()) out.push(current);
  return out.map((c) => c.trim()).filter(Boolean);
}

/**
 * What a query asks for, from the text of the call.
 *
 * `.from('x')` and the `.select(...)` that follows it, which is almost
 * always on the same line or the next one. A `.from` with no select at
 * all is a delete, an update or an insert and asks for no columns.
 */
function asksIn(file: string): { asks: Ask[]; unreadable: Unreadable[] } {
  const text = readFileSync(file, 'utf8');
  const asks: Ask[] = [];
  const unreadable: Unreadable[] = [];

  /* A column list held in a constant is still a column list. One is
     declared once and used by two queries in the tracker's company
     search, which is good practice and was invisible to this. */
  const constants = new Map<string, string>();
  const declared = /\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*'([^']*)'/g;
  let named: RegExpExecArray | null;
  while ((named = declared.exec(text))) constants.set(named[1], named[2]);

  /* Paged helpers, which take the table and the columns as arguments so
     the `.from` is inside the helper and says nothing. Named one by one
     rather than guessed at: a pattern loose enough to find these by
     shape would match half the calls in the repository. */
  const paged = /\bfetchAll\(\s*[A-Za-z_$][\w$]*\s*,\s*'([a-z_]+)'\s*,\s*'([^']*)'/g;
  let page: RegExpExecArray | null;
  while ((page = paged.exec(text))) {
    const columns = columnsIn(page[2]);
    if (columns.length === 1 && columns[0] === '*') continue;
    asks.push({
      file, line: text.slice(0, page.index).split('\n').length,
      table: page[1], columns,
    });
  }

  const from = /\.from\(\s*'([a-z_]+)'\s*\)/g;
  let hit: RegExpExecArray | null;
  while ((hit = from.exec(text))) {
    const table = hit[1];
    const line = text.slice(0, hit.index).split('\n').length;
    /* The window after `.from(...)`: long enough to reach a select on
       the next line or two, short enough not to reach the next query. */
    const after = text.slice(hit.index + hit[0].length, hit.index + hit[0].length + 400);
    const chain = after.split(/\.from\(/)[0];

    const select = /\.select\(\s*(['"`])([\s\S]*?)\1\s*[,)]/.exec(chain);
    if (!select) {
      const byName = /\.select\(\s*([A-Za-z_$][\w$]*)\s*[,)]/.exec(chain);
      const held = byName ? constants.get(byName[1]) : undefined;
      if (held !== undefined) {
        const columns = columnsIn(held);
        if (!(columns.length === 1 && columns[0] === '*')) {
          asks.push({ file, line, table, columns });
        }
        continue;
      }
      // A select built from something this cannot follow, or none at all.
      if (byName) unreadable.push({ file, line, table, why: 'the column list is a variable' });
      continue;
    }
    if (select[1] === '`' && select[2].includes('${')) {
      unreadable.push({ file, line, table, why: 'the column list is built at run time' });
      continue;
    }
    const columns = columnsIn(select[2]);
    if (columns.length === 1 && columns[0] === '*') continue;
    asks.push({ file, line, table, columns });
  }

  /* THE OTHER TWO WAYS TO NAME A COLUMN.

     Reading one that is not there is the failure that got out, and it
     is not the only shape of it. Narrowing on a column the table does
     not have fails identically, and so does writing one. A select is
     just where it happened to bite first. */
  const from2 = /\.from\(\s*'([a-z_]+)'\s*\)/g;
  let hit2: RegExpExecArray | null;
  while ((hit2 = from2.exec(text))) {
    const table = hit2[1];
    const line = text.slice(0, hit2.index).split('\n').length;
    const chain = text
      .slice(hit2.index + hit2[0].length, hit2.index + hit2[0].length + 700)
      .split(/\.from\(/)[0];

    const named = new Set<string>();

    /* Narrowing and ordering: `.eq('status', ...)`, `.order('name')`.
       `.or(...)` is a filter grammar of its own and is left alone. */
    const filter = /\.(eq|neq|gt|gte|lt|lte|like|ilike|is|in|contains|order)\(\s*'([^']+)'/g;
    let f: RegExpExecArray | null;
    while ((f = filter.exec(chain))) {
      // An embedded filter names the other table, not this one.
      if (!f[2].includes('.')) named.add(f[2]);
    }

    /* Writing: the keys of the object handed to insert, update or
       upsert, where they are written out rather than spread in. */
    const write = /\.(insert|update|upsert)\(\s*\{([^{}]*)\}/g;
    let w: RegExpExecArray | null;
    while ((w = write.exec(chain))) {
      if (w[2].includes('...')) continue;
      for (const pair of w[2].split(',')) {
        const key = /^\s*([a-z_][a-z_0-9]*)\s*:/.exec(pair);
        if (key) named.add(key[1]);
      }
    }

    if (named.size) asks.push({ file, line, table, columns: [...named] });
  }

  return { asks, unreadable };
}

/* -------------------------------------------------------------
   Asking the database
   ------------------------------------------------------------- */

/**
 * A column of the table, an embedded resource, or an alias.
 *
 * PostgREST accepts three shapes in a select list and only the first is
 * a column of the table being read:
 *
 *   company_name                a column
 *   crm_lists(name)             a related table, joined
 *   name:company_name           the same column under another name
 *
 * The middle one is checked as its own table, because an embed of a
 * table that is not there fails exactly as loudly.
 */
function parts(column: string): { table: string | null; column: string } | null {
  const embed = /^([a-z_]+)(?:!inner|!left)?\s*\(([\s\S]*)\)$/.exec(column);
  if (embed) return { table: embed[1], column: '' };
  const aliased = /^[A-Za-z_][A-Za-z_0-9]*\s*:\s*([a-z_]+)$/.exec(column);
  const name = aliased ? aliased[1] : column;
  if (!/^[a-z_][a-z_0-9]*$/.test(name)) return null;
  return { table: null, column: name };
}

function catalogue(): Map<string, Set<string>> {
  const out = execFileSync(
    PSQL,
    ['-p', '55432', '-U', 'postgres', '-d', 'stctest', '-tAq', '-v', 'ON_ERROR_STOP=1',
     '-c', `SELECT table_name || '|' || column_name FROM information_schema.columns
              WHERE table_schema = 'public'`],
    { env: { ...process.env, PGHOST: SOCKET }, encoding: 'utf8' },
  );
  const map = new Map<string, Set<string>>();
  for (const row of out.trim().split('\n').filter(Boolean)) {
    const [table, column] = row.split('|');
    if (!map.has(table)) map.set(table, new Set());
    map.get(table)!.add(column);
  }
  return map;
}

/* -------------------------------------------------------------
   Running it
   ------------------------------------------------------------- */

function main() {
  const files = ['app', 'lib', 'components'].flatMap((d) => sources(join(ROOT, d)));
  const asks: Ask[] = [];
  const unreadable: Unreadable[] = [];
  for (const f of files) {
    const found = asksIn(f);
    asks.push(...found.asks);
    unreadable.push(...found.unreadable);
  }

  console.log(`\n  ${asks.length} queries name their columns, across ${files.length} files.\n`);

  if (!existsSync(PSQL) || !existsSync(`${SOCKET}/.s.PGSQL.55432`)) {
    console.log('  The disposable server is not running, so this proves nothing.');
    console.log('  Build it with scripts/sql/build-test-db.sh\n');
    process.exitCode = 1;
    return;
  }

  const schema = catalogue();
  let checked = 0;
  const bad: string[] = [];

  for (const ask of asks) {
    const known = schema.get(ask.table);
    if (!known) {
      bad.push(`${relative(ROOT, ask.file)}:${ask.line}  no table called ${ask.table}`);
      continue;
    }
    for (const raw of ask.columns) {
      const p = parts(raw);
      if (!p) continue;
      if (p.table !== null) {
        checked += 1;
        if (!schema.has(p.table)) {
          bad.push(`${relative(ROOT, ask.file)}:${ask.line}  ${ask.table} embeds ${p.table}, which is not there`);
        }
        continue;
      }
      checked += 1;
      if (!known.has(p.column)) {
        bad.push(`${relative(ROOT, ask.file)}:${ask.line}  column ${ask.table}.${p.column} does not exist`);
      }
    }
  }

  for (const line of bad) console.log(`   FAIL  ${line}`);

  console.log(`\n  ${checked - bad.length}/${checked} columns asked for are really there.`);

  if (unreadable.length) {
    console.log(`\n  ${unreadable.length} column lists this cannot read, and does not pretend to:`);
    for (const u of unreadable) {
      console.log(`     ${relative(ROOT, u.file)}:${u.line}  ${u.table}, ${u.why}`);
    }
  }
  console.log('');

  if (bad.length) process.exitCode = 1;
}

main();
