/* =============================================================
   The role seed, written from the one place the roles are defined.

   `lib/platform/permissions/roles.ts` is where the eleven roles live,
   in the words the business used. This turns that into the SQL that
   seeds `role_templates` and `role_template_capabilities`.

   ---- Why generated ----

   Eleven roles across ninety capabilities is around four hundred rows.
   Typed by hand into a migration, the file and the database disagree
   the first time somebody edits one of them, and a permission that
   disagrees does not throw: it silently answers no, and the screen
   shows a button that the route behind it refuses. That is the exact
   fault `check:capabilities` was written for after the FleetSmart+ four
   were in the code and not in the database for seven migrations.

   So the migration carries a generated block between two markers, and
   `npm run check:roles` regenerates it and fails if what is committed
   has drifted. Same arrangement as `gen:writable-columns`.

     npm run gen:roles      rewrite the block in the migration
     npm run check:roles    prove the block matches roles.ts

   Run the generator after editing `roles.ts`, and commit both.
   ============================================================= */
import { readFileSync, writeFileSync } from 'node:fs';
import { ROLE_TEMPLATES } from '../lib/platform/permissions/roles';

const MIGRATION = 'supabase/migrations/103_the_eleven_roles.sql';
const OPEN = '-- >>> GENERATED FROM lib/platform/permissions/roles.ts. Do not edit by hand.';
const CLOSE = '-- <<< END GENERATED';

const quote = (s: string) => `'${s.replace(/'/g, "''")}'`;

export function seedSql(): string {
  const lines: string[] = [];

  lines.push('DELETE FROM role_template_capabilities');
  lines.push(' WHERE role_template_id IN (SELECT id FROM role_templates WHERE slug IN (');
  lines.push(`   ${ROLE_TEMPLATES.map((r) => quote(r.slug)).join(', ')}`);
  lines.push(' ));');
  lines.push('');
  lines.push('INSERT INTO role_templates (slug, name, description, is_system, sort_order) VALUES');
  lines.push(ROLE_TEMPLATES.map((r) =>
    `  (${quote(r.slug)}, ${quote(r.name)}, ${quote(r.description)}, TRUE, ${r.sort})`).join(',\n'));
  lines.push('ON CONFLICT (slug) DO UPDATE');
  lines.push('  SET name = EXCLUDED.name,');
  lines.push('      description = EXCLUDED.description,');
  lines.push('      is_system = TRUE,');
  lines.push('      is_active = TRUE,');
  lines.push('      sort_order = EXCLUDED.sort_order;');
  lines.push('');
  lines.push('INSERT INTO role_template_capabilities (role_template_id, capability, scope)');
  lines.push('SELECT rt.id, v.capability, v.scope::capability_scope');
  lines.push('  FROM role_templates rt');
  lines.push('  JOIN (VALUES');

  const rows: string[] = [];
  for (const role of ROLE_TEMPLATES) {
    rows.push(`  -- ---- ${role.name} (${role.capabilities.length}) ----`);
    for (const cap of role.capabilities) {
      rows.push(`  (${quote(role.slug)}, ${quote(cap)}, 'company')`);
    }
  }
  /* Commas go on afterwards, so a comment line never carries one. */
  const body = rows.map((line, i) => {
    if (line.trim().startsWith('--')) return line;
    const isLast = rows.slice(i + 1).every((l) => l.trim().startsWith('--'));
    return isLast ? line : `${line},`;
  });
  lines.push(body.join('\n'));
  lines.push('  ) AS v(slug, capability, scope) ON v.slug = rt.slug');
  lines.push('ON CONFLICT (role_template_id, capability) DO UPDATE SET scope = EXCLUDED.scope;');

  return lines.join('\n');
}

function main() {
  const check = process.argv.includes('--check');
  const file = readFileSync(MIGRATION, 'utf8');
  const from = file.indexOf(OPEN);
  const to = file.indexOf(CLOSE);

  if (from < 0 || to < 0) {
    console.log(`\n  FAIL  ${MIGRATION} has no generated block.`);
    console.log(`        It needs the marker ${OPEN}`);
    console.log(`        and ${CLOSE} after it.\n`);
    process.exit(1);
  }

  const wanted = `${OPEN}\n\n${seedSql()}\n\n`;
  const found = file.slice(from, to);

  if (check) {
    if (found === wanted) {
      const caps = ROLE_TEMPLATES.reduce((a, r) => a + r.capabilities.length, 0);
      console.log(`\n  ok    ${ROLE_TEMPLATES.length} roles and ${caps} grants, and the migration says the same\n`);
      process.exit(0);
    }
    console.log('\n  FAIL  the migration has drifted from lib/platform/permissions/roles.ts');
    console.log('        Regenerate it:  npm run gen:roles\n');
    process.exit(1);
  }

  writeFileSync(MIGRATION, file.slice(0, from) + wanted + file.slice(to));
  const caps = ROLE_TEMPLATES.reduce((a, r) => a + r.capabilities.length, 0);
  console.log(`\n  wrote ${MIGRATION}`);
  console.log(`  ${ROLE_TEMPLATES.length} roles, ${caps} grants\n`);
}

main();
