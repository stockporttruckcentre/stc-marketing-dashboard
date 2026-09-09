/* =============================================================
   The eleven roles say what the business said they say.

   `npm run check:roles` proves the migration matches
   `lib/platform/permissions/roles.ts`. That is a check that two files
   agree, and two files can agree while both being wrong: whoever wrote
   the capability list is the same person who would write the check
   that reads it back.

   So this one does not read the roles file at all. Every line below is
   a sentence from the message the roles came out of, turned into a
   yes or a no, and asserted against the database the migration built.
   A role that quietly loses a capability in some future edit fails
   here rather than in front of somebody who cannot open a screen.

   Needs the disposable Postgres, the same one every other SQL check
   uses:  bash scripts/sql/build-test-db.sh
   ============================================================= */
import { execFileSync } from 'node:child_process';

const PSQL_ENV = {
  ...process.env,
  PATH: `/usr/lib/postgresql/16/bin:${process.env.PATH ?? ''}`,
  PGHOST: process.env.PGHOST ?? '/var/tmp/pgtest',
};

/** slug, capability, whether they should hold it, and the words it came from. */
type Rule = [string, string, boolean];

const QUOTED: Array<{ said: string; rules: Rule[] }> = [
  {
    said: 'Admin: "run reports, see the revenue tab entirely and import but no '
      + 'export, see team page, use company finder, see CRM pipeline, see '
      + 'Fleetsmart, access their own diary and work and dashboard. No analytics tab."',
    rules: [
      ['office_admin', 'reports.view', true],
      ['office_admin', 'revenue.view', true],
      ['office_admin', 'revenue.import', true],
      ['office_admin', 'revenue.export', false],
      ['office_admin', 'reports.export', false],
      ['office_admin', 'analytics.view', false],
      ['office_admin', 'finder.view', true],
      ['office_admin', 'crm.view', true],
      ['office_admin', 'fleetsmart.view', true],
      ['office_admin', 'work.view', true],
      ['office_admin', 'crm.export', false],
      ['office_admin', 'crm.import', false],
    ],
  },
  {
    said: 'Sr Admin: "the same but gives full access to the revenue tab. They can '
      + 'export reports, not just view them."',
    rules: [
      ['sr_office_admin', 'revenue.export', true],
      ['sr_office_admin', 'reports.export', true],
      ['sr_office_admin', 'revenue.import', true],
      ['sr_office_admin', 'analytics.view', false],
      ['sr_office_admin', 'access.decide', true],
    ],
  },
  {
    said: 'Marketing: "no trailer sales access, no sales tracker (but can see leads '
      + 'in crm records), access to revenue entirely but cannot export/import ... '
      + 'aside from people able to approve posts or add brand kit assets. Cannot '
      + 'export from the CRM, cannot import to CRM but can create records, cannot '
      + 'create leads."',
    rules: [
      ['marketing_exec', 'crm.create', true],
      ['marketing_exec', 'leads.create', false],
      ['marketing_exec', 'tracker.view', false],
      ['marketing_exec', 'stock.view', false],
      ['marketing_exec', 'revenue.view', true],
      ['marketing_exec', 'revenue.import', false],
      ['marketing_exec', 'revenue.export', false],
      ['marketing_exec', 'crm.export', false],
      ['marketing_exec', 'crm.import', false],
      ['marketing_exec', 'social.approve', false],
      ['marketing_exec', 'social.publishNow', false],
      ['marketing_exec', 'brand.manage', false],
      ['marketing_exec', 'brand.view', true],
      ['marketing_exec', 'social.draft', true],
      ['marketing_exec', 'social.schedule', true],
    ],
  },
  {
    said: 'Sr Marketing: "full access to revenue, can export from the CRM and import '
      + 'to it, can do what marketer cannot."',
    rules: [
      ['sr_marketing', 'crm.export', true],
      ['sr_marketing', 'crm.import', true],
      ['sr_marketing', 'revenue.export', true],
      ['sr_marketing', 'social.approve', true],
      ['sr_marketing', 'brand.manage', true],
    ],
  },
  {
    said: 'Sales: "Dean can add a customer, create a lead, update the lead, create a '
      + 'contract and make it live, manage and add stock but not export it all ... '
      + 'run reports to send to Tom, can see what\'s set to be posted on socials ... '
      + 'They can grab a colour from the brand kit if they need it but can\'t manage '
      + 'them." Plus: "a sales person joining a company, exporting their crm and '
      + 'stock, then leaving the company. We can\'t risk that."',
    rules: [
      ['sales_rep', 'crm.create', true],
      ['sales_rep', 'leads.create', true],
      ['sales_rep', 'stock.edit', true],
      ['sales_rep', 'stock.export', false],
      ['sales_rep', 'crm.export', false],
      ['sales_rep', 'crm.import', false],
      ['sales_rep', 'reports.view', true],
      ['sales_rep', 'reports.export', true],
      ['sales_rep', 'social.view', true],
      ['sales_rep', 'social.approve', false],
      ['sales_rep', 'social.schedule', false],
      ['sales_rep', 'brand.view', true],
      ['sales_rep', 'brand.manage', false],
      ['sales_rep', 'fleetsmart.build', true],
      ['sales_rep', 'fleetsmart.send', true],
      ['sales_rep', 'fleetsmart.discount', false],
      ['sales_rep', 'tracker.view', true],
      ['sales_rep', 'work.view', true],
    ],
  },
  {
    said: 'Sr Sales: "the sales overseer ... We can\'t risk that but Sr Sales can '
      + 'have access."',
    rules: [
      ['sr_sales', 'crm.export', true],
      ['sr_sales', 'stock.export', true],
      ['sr_sales', 'crm.import', true],
      ['sr_sales', 'access.decide', true],
      ['sr_sales', 'crm.viewOthers', true],
      ['sr_sales', 'fleetsmart.discount', true],
    ],
  },
  {
    said: 'Sr Finance: "financial director level, he\'ll need full access across the '
      + 'app but doesn\'t need anything in the Marketing section of the global sidebar."',
    rules: [
      ['sr_finance', 'social.draft', false],
      ['sr_finance', 'social.view', false],
      ['sr_finance', 'brand.view', false],
      ['sr_finance', 'brand.manage', false],
      ['sr_finance', 'marketing.edit', false],
      ['sr_finance', 'news.view', false],
      ['sr_finance', 'admin.users', true],
      ['sr_finance', 'revenue.export', true],
      ['sr_finance', 'crm.export', true],
      ['sr_finance', 'analytics.view', true],
    ],
  },
  {
    said: 'Finance: "can see dashboard, analytics, all of reports, work, diary, crm, '
      + 'company finder, trailer sales, fleetsmart+, all of revenue, team."',
    rules: [
      ['finance', 'analytics.view', true],
      ['finance', 'reports.view', true],
      ['finance', 'reports.export', true],
      ['finance', 'revenue.view', true],
      ['finance', 'revenue.import', true],
      ['finance', 'revenue.export', true],
      ['finance', 'crm.view', true],
      ['finance', 'finder.view', true],
      ['finance', 'stock.view', true],
      ['finance', 'fleetsmart.view', true],
      ['finance', 'work.view', true],
      ['finance', 'social.draft', false],
    ],
  },
  {
    said: 'BD: "this is tom\'s role, he manages sales and marketing departments. He '
      + 'needs everything they have and ways of managing them."',
    rules: [
      ['business_development', 'admin.usersDepartment', true],
      ['business_development', 'admin.users', false],
      ['business_development', 'social.approve', true],
      ['business_development', 'stock.export', true],
      ['business_development', 'crm.export', true],
      ['business_development', 'access.decide', true],
      ['business_development', 'brand.manage', true],
      ['business_development', 'tracker.view', true],
    ],
  },
  {
    said: 'MD and Developer: "access to the entire app."',
    rules: [
      ['managing_director', 'admin.users', true],
      ['managing_director', 'admin.settings', true],
      ['managing_director', 'revenue.import', true],
      ['managing_director', 'social.approve', true],
      ['developer', 'admin.audit', true],
      ['developer', 'admin.users', true],
      ['developer', 'revenue.export', true],
    ],
  },
];

/* Every role is somebody's job, so every role must be able to sign in
   and land somewhere. A role holding nothing is a role that shows an
   empty sidebar, which reads as a broken application. */
const MUST_HOLD = ['work.view', 'access.request'];

function query(sql: string): string[] {
  const out = execFileSync(
    'psql', ['-p', '55432', '-U', 'postgres', '-d', 'stctest', '-tAq', '-c', sql],
    { env: PSQL_ENV, encoding: 'utf8' },
  );
  return out.split('\n').map((s) => s.trim()).filter(Boolean);
}

function main() {
  let held: Set<string>;
  let active: string[];
  try {
    held = new Set(query(
      `SELECT rt.slug || ' ' || c.capability
         FROM role_templates rt
         JOIN role_template_capabilities c ON c.role_template_id = rt.id
        WHERE rt.is_active`,
    ));
    active = query('SELECT slug FROM role_templates WHERE is_active ORDER BY sort_order');
  } catch {
    console.error('  no test database. Build one first:  bash scripts/sql/build-test-db.sh');
    process.exit(1);
  }

  const problems: string[] = [];
  let checked = 0;

  for (const group of QUOTED) {
    const failed: string[] = [];
    for (const [slug, cap, should] of group.rules) {
      checked += 1;
      const has = held.has(`${slug} ${cap}`);
      if (has !== should) {
        failed.push(`      ${slug} ${has ? 'holds' : 'does not hold'} ${cap}, and should ${should ? '' : 'not '}`.trimEnd());
      }
    }
    if (failed.length > 0) {
      problems.push(`\n  ${group.said}\n${failed.join('\n')}`);
    }
  }

  for (const slug of active) {
    for (const cap of MUST_HOLD) {
      checked += 1;
      if (!held.has(`${slug} ${cap}`)) {
        problems.push(`\n  ${slug} does not hold ${cap}, so it cannot do its own work`);
      }
    }
  }

  if (active.length !== 11) {
    problems.push(`\n  ${active.length} active role templates, not 11: ${active.join(', ')}`);
  }

  if (problems.length > 0) {
    console.log(`\n  FAIL  ${problems.length} of the roles do not say what the business said\n`);
    console.log(problems.join('\n'));
    console.log('');
    process.exit(1);
  }

  console.log(`\n  ok    ${active.length} roles, ${checked} assertions from the business's own words, all held\n`);
}

main();
