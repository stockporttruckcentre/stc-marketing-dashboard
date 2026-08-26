/* =============================================================
   Is the clearability metadata what the database actually says?

   `clear the status on STC143980` is a sentence this application can
   read and a thing Postgres will refuse, because `stock_trailers.status`
   is NOT NULL. Offering it produces a constraint error at the last
   moment that nobody can act on, so the writable dictionary records
   which columns may be emptied.

   That record is a second copy of something the schema already knows,
   and the last time this project kept a second copy of a database fact
   by hand it was wrong within days. So it is not maintained by memory:
   this parses the SQL and fails if the two disagree, IN BOTH
   DIRECTIONS.

     a field marked clearable whose column is NOT NULL      fails
     a nullable writable column left unmarked               fails

   The second direction matters as much as the first. Without it, the
   safe default quietly becomes the permanent answer and half the
   clearing commands stop working for no reason anybody wrote down.

     npm run check:fields
   ============================================================= */
import { readFileSync, readdirSync } from 'fs';
import { WRITABLE_FIELDS, NOT_NULL_COLUMNS } from '../lib/command/fields';

let pass = 0, fail = 0;
const failures: string[] = [];
const ok = (what: string, cond: boolean, got = '') => {
  if (cond) { pass++; return; }
  fail++;
  failures.push(`  ${what}${got ? `\n    ${got}` : ''}`);
};

/** entity id -> the table it is stored in. */
const TABLE: Record<string, string> = {
  trailers: 'stock_trailers',
  contacts: 'crm_contacts',
  leads:    'crm_leads',
  posts:    'social_posts',
  meetings: 'calendar_events',
};

const sql = [
  readFileSync('supabase/schema.sql', 'utf8'),
  ...readdirSync('supabase/migrations')
    .filter((f) => f.endsWith('.sql'))
    .map((f) => readFileSync(`supabase/migrations/${f}`, 'utf8')),
].join('\n');

/**
 * Columns the SQL declares NOT NULL, per table.
 *
 * Three ways a column can acquire the constraint, and all three count:
 * in the CREATE TABLE body, in an ADD COLUMN, and in a later ALTER
 * COLUMN ... SET NOT NULL. Reading only the first is how a check like
 * this passes while being wrong.
 */
function notNullColumns(table: string): Set<string> {
  const found = new Set<string>();

  /* Every CREATE TABLE for this table, since a migration may restate
     it. `[\s\S]` rather than the s flag, so this needs no newer target. */
  const creates = sql.matchAll(
    new RegExp(`CREATE TABLE (?:IF NOT EXISTS )?${table}\\s*\\(([\\s\\S]*?)\\n\\);`, 'g'),
  );
  for (const create of creates) {
    for (const line of create[1].split('\n')) {
      const m = /^\s*([a-z_0-9]+)\s+[^,]*NOT NULL/i.exec(line);
      if (m) found.add(m[1]);
    }
  }

  for (const m of sql.matchAll(
    new RegExp(`ALTER TABLE\\s+${table}\\s+ADD COLUMN\\s+(?:IF NOT EXISTS\\s+)?([a-z_0-9]+)[^;]*NOT NULL`, 'gi'),
  )) found.add(m[1]);

  for (const m of sql.matchAll(
    new RegExp(`ALTER TABLE\\s+${table}\\s+ALTER COLUMN\\s+([a-z_0-9]+)\\s+SET NOT NULL`, 'gi'),
  )) found.add(m[1]);

  /* A column made nullable again stops counting. */
  for (const m of sql.matchAll(
    new RegExp(`ALTER TABLE\\s+${table}\\s+ALTER COLUMN\\s+([a-z_0-9]+)\\s+DROP NOT NULL`, 'gi'),
  )) found.delete(m[1]);

  return found;
}

const byTable = new Map<string, Set<string>>();
for (const [entity, table] of Object.entries(TABLE)) {
  byTable.set(entity, notNullColumns(table));
}

/* The parser has to find something, or every assertion below passes by
   reading an empty set. */
for (const [entity, cols] of byTable) {
  ok(`the schema for ${TABLE[entity]} was read`, cols.size > 0, `${cols.size} NOT NULL columns`);
}

/* -------------------------------------------------------------
   Both directions
   ------------------------------------------------------------- */

for (const f of WRITABLE_FIELDS) {
  const notNull = byTable.get(f.entity);
  if (!notNull) { ok(`${f.entity} is a table this check knows`, false); continue; }
  const isNotNull = notNull.has(f.key);

  if (f.clearable) {
    ok(`${f.entity}.${f.key} is marked clearable and the column allows it`, !isNotNull,
      `${TABLE[f.entity]}.${f.key} is NOT NULL`);
  } else {
    ok(`${f.entity}.${f.key} is not clearable and the column says why`, isNotNull,
      `${TABLE[f.entity]}.${f.key} is nullable, so clearing it should be allowed`);
  }
}

/* The declared set used to build the generated tail must say the same
   thing as the SQL, or the two halves of the dictionary disagree. */
for (const declared of NOT_NULL_COLUMNS) {
  const [entity, key] = declared.split('.');
  ok(`${declared} really is NOT NULL`, byTable.get(entity)?.has(key) === true);
}
for (const [entity, cols] of byTable) {
  for (const col of cols) {
    if (!WRITABLE_FIELDS.some((f) => f.entity === entity && f.key === col)) continue;
    ok(`${entity}.${col} is declared NOT NULL where the dictionary can see it`,
      NOT_NULL_COLUMNS.has(`${entity}.${col}`));
  }
}

/* ------------------------------------------------------------- */

const clearable = WRITABLE_FIELDS.filter((f) => f.clearable).length;
console.log(`\n  ${clearable}/${WRITABLE_FIELDS.length} writable fields may be emptied.`);
console.log(`  ${pass}/${pass + fail} nullability assertions hold.\n`);
if (failures.length) {
  console.log('  failures:');
  for (const f of failures.slice(0, 25)) console.log(f);
  if (failures.length > 25) console.log(`  and ${failures.length - 25} more`);
  console.log();
}
if (fail) process.exitCode = 1;
