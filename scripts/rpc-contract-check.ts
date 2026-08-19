/* =============================================================
   Does the database this application is pointed at carry the functions
   it calls?

   A deployment can be perfectly correct in every file and still refuse
   every command, because the database behind it is older than the code
   in front of it. That failure looks like this, from PostgREST:

     Could not find the function public.command_perform(p_steps)
     in the schema cache

   Nothing in the repository catches that. `check:postgres` runs against
   a database this script builds from every migration, so it can only
   ever agree with itself; the fake store agrees with itself for the same
   reason. The question this answers is the other one: given a database
   somebody deployed against, does it hold every function the current
   Store can call, with the argument names PostgREST matches on, granted
   to the role that will call it?

   TWO WAYS TO RUN IT.

     npm run check:rpc          against the local disposable server
     npm run check:rpc -- --sql prints a standalone query to paste into
                                the SQL editor of ANY Supabase project

   The second one is the point. It takes no credentials, reads nothing,
   writes nothing, and answers "is this database ready for this branch"
   for a project this session cannot reach.

   THE LIST IS READ OUT OF THE CODE.

   Every capability the store dispatches, every projection it asks for,
   and every `.rpc(` in the application, so a function added to the
   runtime cannot be forgotten here. The argument names come from the
   same argument builders the store uses at run time, called with an
   empty invocation: what is being checked is the SHAPE PostgREST
   matches on, which is the set of names, not the values.
   ============================================================= */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { FUNCTIONS, PROJECTIONS } from '../lib/command/store/postgrest';

/* -------------------------------------------------------------
   What the code calls
   ------------------------------------------------------------- */

type Expected = {
  name: string;
  /** The argument names the caller sends. PostgREST matches on these. */
  args: string[];
  /** Which database role has to be able to execute it. */
  role: 'authenticated' | 'service_role';
  /** Where the call is made, so a failure names something to open. */
  where: string;
};

/** The invocation shape an argument builder is given at run time. */
const EMPTY = { capability: '', subjects: [], args: {} };

function fromStore(): Expected[] {
  const out: Expected[] = [];
  for (const [capability, fn] of Object.entries(FUNCTIONS)) {
    out.push({
      name: fn.name,
      args: Object.keys(fn.args(EMPTY as never)),
      role: 'authenticated',
      where: `store dispatch for ${capability}`,
    });
  }
  for (const [capability, fn] of Object.entries(PROJECTIONS)) {
    out.push({
      name: fn.name,
      args: Object.keys(fn.args(EMPTY as never)),
      role: 'authenticated',
      where: `projection for ${capability}`,
    });
  }
  return out;
}

/**
 * Every other `.rpc(` in the application, with the argument names it
 * passes.
 *
 * Read out of the source rather than listed, because a list is a thing
 * that goes stale the first time somebody adds a call. The object
 * literal that follows the name is scanned for its top level keys,
 * which is what the client sends.
 */
function fromSource(): Expected[] {
  const out: Expected[] = [];
  const walk = (dir: string): string[] => {
    const found: string[] = [];
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules' || entry.startsWith('.')) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) { found.push(...walk(full)); continue; }
      if (/\.(ts|tsx)$/.test(entry)) found.push(full);
    }
    return found;
  };

  for (const file of [...walk('lib'), ...walk('app')]) {
    const body = readFileSync(file, 'utf8');
    for (const m of body.matchAll(/\.rpc\(\s*'([a-z_]+)'\s*,\s*\{([\s\S]{0,600}?)\}\s*\)/g)) {
      const [, name, payload] = m;
      /* Top level keys only: a nested object's keys are values, not
         arguments. Counting braces is enough for a payload this shape. */
      const args: string[] = [];
      let depth = 0;
      for (const line of payload.split('\n')) {
        const key = depth === 0 ? /^\s*([a-z_]+)\s*:/.exec(line)?.[1] : null;
        if (key) args.push(key);
        depth += (line.match(/[[{(]/g) ?? []).length - (line.match(/[\]})]/g) ?? []).length;
      }
      out.push({
        name,
        args,
        role: /external|note_orphan/.test(name) ? 'service_role' : 'authenticated',
        where: file,
      });
    }
  }
  return out;
}

/** One row per function, with every argument name any caller sends. */
function expected(): Expected[] {
  const merged = new Map<string, Expected>();
  for (const e of [...fromStore(), ...fromSource()]) {
    const held = merged.get(`${e.name}|${e.role}`);
    if (!held) { merged.set(`${e.name}|${e.role}`, { ...e, args: [...e.args] }); continue; }
    for (const a of e.args) if (!held.args.includes(a)) held.args.push(a);
  }
  return [...merged.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/* -------------------------------------------------------------
   The question, as one SQL statement
   ------------------------------------------------------------- */

/**
 * A query that answers it against any database, with no client.
 *
 * Every expected function becomes a row of (name, args, role), and the
 * query reports what the database has beside it. It reads catalogues
 * only: nothing here writes, and nothing here needs a service role.
 */
export function contractSql(list: Expected[] = expected()): string {
  const rows = list.map((e) => `    ('${e.name}', ARRAY[${
    e.args.map((a) => `'${a}'`).join(', ')}]::TEXT[], '${e.role}')`).join(',\n');

  return `-- What this branch's command runtime calls, and whether this
-- database can answer. Reads catalogues only: no writes, no data.
WITH wanted(name, args, role) AS (
  VALUES
${rows}
),
found AS (
  SELECT w.name, w.args, w.role,
         p.oid,
         COALESCE(p.proargnames, ARRAY[]::TEXT[]) AS has_args
    FROM wanted w
    LEFT JOIN pg_proc p
      ON p.proname = w.name
     AND p.pronamespace = 'public'::REGNAMESPACE
)
SELECT * FROM (
SELECT name,
       CASE
         WHEN oid IS NULL THEN 'MISSING: no such function'
         WHEN NOT (args <@ has_args)
           THEN 'WRONG ARGUMENTS: has ' || array_to_string(has_args, ', ')
                || ', called with ' || array_to_string(args, ', ')
         WHEN NOT has_function_privilege(role, oid, 'EXECUTE')
           THEN 'NOT GRANTED to ' || role
         ELSE 'ok'
       END AS state
  FROM found
) AS answer
 ORDER BY state <> 'ok' DESC, name;

-- PostgREST caches the schema. After running migrations, tell it to
-- look again, or the functions exist and the API still says they do not.
-- NOTIFY pgrst, 'reload schema';
`;
}

/* -------------------------------------------------------------
   Running it here
   ------------------------------------------------------------- */

const PSQL = '/usr/lib/postgresql/16/bin/psql';
const SOCKET = '/var/tmp/pgtest';

function main() {
  const list = expected();

  if (process.argv.includes('--sql')) {
    console.log(contractSql(list));
    return;
  }

  console.log(`\n  ${list.length} functions this branch's runtime calls.\n`);

  if (!existsSync(PSQL) || !existsSync(`${SOCKET}/.s.PGSQL.55432`)) {
    console.log('  The disposable server is not running, so this proves nothing.');
    console.log('  Build it with scripts/sql/build-test-db.sh, or run with --sql');
    console.log('  and paste the query into the SQL editor of the database you');
    console.log('  are asking about.\n');
    process.exitCode = 1;
    return;
  }

  const out = execFileSync(
    PSQL,
    ['-p', '55432', '-U', 'postgres', '-d', 'stctest', '-tAq', '-v', 'ON_ERROR_STOP=1',
     '-c', contractSql(list).split('-- PostgREST caches')[0]],
    { env: { ...process.env, PGHOST: SOCKET }, encoding: 'utf8' },
  );

  const rows = out.trim().split('\n').filter(Boolean).map((l) => l.split('|'));
  const bad = rows.filter((r) => r[1] !== 'ok');
  for (const [name, state] of rows) {
    console.log(`   ${state === 'ok' ? ' ok ' : 'FAIL'}  ${name.padEnd(30)} ${state === 'ok' ? '' : state}`);
  }
  console.log(`\n  ${rows.length - bad.length}/${rows.length} callable, with the argument names PostgREST matches on.\n`);
  if (bad.length) process.exitCode = 1;
}

main();
