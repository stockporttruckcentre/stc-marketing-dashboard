/* =============================================================
   Every field on `Profile` is a real column.

   ---- The fault this exists because of ----

   From the business, looking at What you can do:

     says tom is on Administrator which is a removed role

   It did, for everybody. `profiles` has `role_template_id`, a uuid, and
   no `role_template` column at all. The Settings screen asked for
   `profile.role_template`, got undefined every single time, and fell
   through to the legacy `role` column, which still says `admin` for
   anybody who was an administrator before role templates existed.

   TypeScript would have caught it. It did not, because the screen took
   its profile as `Profile & Record<string, unknown>`, which makes any
   field name a legal read. That cast was there because five real
   columns were missing from `Profile`, so the honest fix was to write
   the columns down rather than to open the type.

   ---- The rule ----

     A FIELD ON `Profile` IS A COLUMN ON `profiles`, AND NOTHING WIDENS
     IT BACK OPEN.

   Both halves matter. The first stops the type describing a table that
   does not exist. The second stops the next person reaching for the
   cast when a column is missing.

   Needs the disposable PostgreSQL. Run with `npm run check:profile-fields`.
   ============================================================= */
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

let bad = 0;
const ok = (what: string, held: boolean, why?: string) => {
  console.log(`  ${held ? 'ok  ' : 'FAIL'}  ${what}`);
  if (!held) { bad += 1; if (why) console.log(`        ${why}`); }
};
const head = (s: string) => console.log(`\n  ${s}\n  ${'-'.repeat(s.length)}`);

/* Fields the type carries that are not columns, on purpose, because
   they are joined on by a query rather than stored. Each needs a reason
   and there are none today. */
const NOT_COLUMNS = new Set<string>([]);

function columns(): Set<string> {
  const out = execFileSync('psql', [
    '-p', '55432', '-U', 'postgres', '-d', 'stctest', '-tAc',
    "SELECT column_name FROM information_schema.columns "
    + "WHERE table_schema = 'public' AND table_name = 'profiles'",
  ], {
    encoding: 'utf8',
    env: { ...process.env, PGHOST: '/var/tmp/pgtest', PATH: `/usr/lib/postgresql/16/bin:${process.env.PATH}` },
  });
  return new Set(out.split('\n').map((l) => l.trim()).filter(Boolean));
}

/** The field names declared on the `Profile` interface. */
function declared(): string[] {
  const src = readFileSync('lib/types.ts', 'utf8');
  const start = src.indexOf('export interface Profile {');
  if (start < 0) throw new Error('no Profile interface in lib/types.ts');
  let depth = 0, i = src.indexOf('{', start);
  const from = i;
  for (; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') { depth -= 1; if (depth === 0) break; }
  }
  const body = src.slice(from + 1, i)
    /* Comments out, so a field name quoted in an explanation is not
       read as a field. This file's own banner mentions `role_template`
       precisely because it is not one. */
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');

  return [...body.matchAll(/^\s*([a-z_][a-z0-9_]*)\??\s*:/gim)].map((m) => m[1]!);
}

head('Every field on Profile is a column on profiles');

let cols: Set<string>;
try {
  cols = columns();
} catch {
  console.log('  skip  needs the disposable PostgreSQL on port 55432.\n');
  process.exit(0);
}

ok('the columns were read at all', cols.size > 5 && cols.has('id') && cols.has('role'),
  `only ${cols.size} column(s) came back, so nothing below means anything`);

const fields = declared();
ok('the interface was read at all', fields.length > 5, `found ${fields.length} field(s)`);

const strays = fields.filter((f) => !cols.has(f) && !NOT_COLUMNS.has(f));
ok(`all ${fields.length} fields exist on the table`, strays.length === 0,
  strays.length
    ? `${strays.join(', ')} ${strays.length === 1 ? 'is' : 'are'} not on profiles. A field `
      + 'that is not a column reads as undefined everywhere, silently.'
    : undefined);

/* The one that started it, named, because it is the shape of the fault
   rather than a typo: the name lives on `role_templates`. */
ok('and role_template in particular is not one of them',
  !fields.includes('role_template'),
  'the role\'s NAME is on role_templates, reached by role_template_id');

head('And nothing widens the type back open');

/* A cast to `Profile & Record<string, unknown>` makes every field name
   legal again, which is exactly how the fault survived review. */
const files: string[] = [];
const walk = (dir: string) => {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full);
    else if (/\.tsx?$/.test(name)) files.push(full);
  }
};
for (const root of ['app', 'components', 'lib']) walk(root);

/* Comments out first. This check's own banner quotes the cast, and so
   does the note on `Profile` explaining why the columns are written
   down, and a scan that cannot tell an explanation from code reports
   the explanation. */
const codeOnly = (src: string) => src
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');

const widened = files.filter((f) =>
  /Profile\s*&\s*Record<\s*string\s*,\s*(unknown|any)\s*>/.test(codeOnly(readFileSync(f, 'utf8'))));

ok('no file takes a Profile as an open record', widened.length === 0,
  widened.length
    ? `${widened.join(', ')}. Add the missing column to Profile instead: the cast makes `
      + 'every typo a legal read.'
    : undefined);

console.log(bad === 0
  ? '\n  A field read off a profile is a column, and a typo is a compile error.\n'
  : `\n  ${bad} failed.\n`);
process.exit(bad === 0 ? 0 : 1);
