'use client';

/* =============================================================
   The Roles tab, with fabricated roles, for looking at. Dev only.

   ---- Why this exists ----

   From the business, with two screenshots of the live tab:

     It's built the roles page and the whole UI is broken. Look at it.
     This is because it didn't bother to look at what it created.

   That is exactly what happened. The component read five tables behind
   a login, so nothing rendered it before it merged, and it went live
   with every block stamped at the kit demo's own width and height: a
   five line paragraph forced to fourteen pixels, running over the card
   under it.

   So the screen is split from its loader, and this mounts the real
   screen with the eleven roles, a handful of capabilities and two
   holders. `scripts/roles-render-check.ts` opens it in a browser,
   screenshots it, and fails if any two text blocks overlap.

   `notFound()` in production, like the harnesses next door.
   ============================================================= */

import { notFound } from 'next/navigation';
import { RolesView } from '@/components/admin/roles-chart';

const ROLE = (slug: string, name: string, dept: string, up: string | null, sort: number, manages: string[] = []) => ({
  id: `role-${slug}`, slug, name, description: `${name}: what this role is for, in a sentence long enough to wrap across several lines so the layout has to cope with it.`,
  department: dept, manages, escalates_to: up, sort_order: sort, customised_at: null,
});

const ROLES = [
  ROLE('developer', 'Developer', 'exec', null, 1, ['sales', 'marketing', 'finance', 'admin', 'exec']),
  ROLE('managing_director', 'Managing Director', 'exec', null, 2, ['sales', 'marketing', 'finance', 'admin', 'exec']),
  ROLE('business_development', 'Business Development', 'exec', 'managing_director', 3, ['sales', 'marketing']),
  ROLE('sr_sales', 'Sr Sales', 'sales', 'business_development', 4, ['sales']),
  ROLE('sales_rep', 'Sales', 'sales', 'sr_sales', 5),
  ROLE('sr_marketing', 'Sr Marketing', 'marketing', 'business_development', 6, ['marketing']),
  ROLE('marketing_exec', 'Marketing', 'marketing', 'sr_marketing', 7),
  ROLE('sr_finance', 'Sr Finance', 'finance', 'managing_director', 8, ['finance', 'admin']),
  ROLE('finance', 'Finance', 'finance', 'sr_finance', 9),
  ROLE('sr_office_admin', 'Sr Admin', 'admin', 'managing_director', 10, ['admin']),
  ROLE('office_admin', 'Admin', 'admin', 'sr_office_admin', 11),
];

const CAP = (key: string, label: string, area: string, feature: string, danger = 'routine', position = 10) => ({
  key, label, area, feature, danger, position,
  description: `${label}. A description of what this permission allows and where it applies.`,
});

const CAPS = [
  CAP('crm.view', 'See the CRM', 'CRM', 'Access'),
  CAP('crm.edit', 'Edit a customer record', 'CRM', 'Records', 'routine', 20),
  CAP('crm.export', 'Export the CRM', 'CRM', 'Exports', 'sensitive', 30),
  CAP('crm.import', 'Import into the CRM', 'CRM', 'Imports', 'sensitive', 40),
  CAP('stock.view', 'See trailer stock', 'Stock', 'Access'),
  CAP('stock.edit', 'Edit a trailer', 'Stock', 'Records', 'routine', 20),
  CAP('admin.users', 'Manage people', 'Admin', 'People', 'destructive'),
  CAP('admin.roles', 'Change what a role can do', 'Admin', 'Roles', 'destructive', 45),
  CAP('access.request', 'Ask for something you may not do', 'Admin', 'Requests', 'routine', 40),
  CAP('access.decide', 'Decide those requests', 'Admin', 'Requests', 'sensitive', 50),
  CAP('work.view', 'See the Work tab', 'Work', 'Access'),
  CAP('work.assign', 'Give somebody a task', 'Work', 'Tasks', 'routine', 20),
];

const HOLD = (role: string, ...keys: string[]) =>
  keys.map((k) => ({ role_template_id: `role-${role}`, capability: k, scope: k === 'crm.view' ? 'own' : 'company' }));

const GRANTS = [
  ...HOLD('developer', ...CAPS.map((c) => c.key)),
  ...HOLD('managing_director', ...CAPS.map((c) => c.key)),
  ...HOLD('business_development', 'crm.view', 'crm.edit', 'crm.export', 'crm.import', 'stock.view', 'stock.edit', 'access.request', 'access.decide', 'work.view', 'work.assign'),
  ...HOLD('sr_sales', 'crm.view', 'crm.edit', 'crm.export', 'stock.view', 'stock.edit', 'access.request', 'access.decide', 'work.view', 'work.assign'),
  ...HOLD('sales_rep', 'crm.view', 'crm.edit', 'stock.view', 'access.request', 'work.view'),
  ...HOLD('sr_marketing', 'crm.view', 'crm.edit', 'crm.export', 'access.request', 'access.decide', 'work.view'),
  ...HOLD('marketing_exec', 'crm.view', 'access.request', 'work.view'),
  ...HOLD('sr_finance', 'crm.view', 'crm.export', 'stock.view', 'admin.users', 'admin.roles', 'access.request', 'access.decide', 'work.view', 'work.assign'),
  ...HOLD('finance', 'crm.view', 'stock.view', 'access.request', 'work.view'),
  ...HOLD('sr_office_admin', 'crm.view', 'crm.import', 'access.request', 'access.decide', 'work.view'),
  ...HOLD('office_admin', 'crm.view', 'access.request', 'work.view'),
];

const HOLDERS = [
  { id: 'u-alex', role_template_id: 'role-developer', name: 'Alex Ellis', job_title: 'Marketing & Development' },
  { id: 'u-dean', role_template_id: 'role-sales_rep', name: 'Dean Mann', job_title: 'Sales' },
  { id: 'u-wayne', role_template_id: 'role-sr_finance', name: 'Wayne Kenny', job_title: 'Finance Director' },
];

const HISTORY = [
  { id: 1, at: '2026-09-10T09:12:00Z', actor_label: 'Alex Ellis', kind: 'granted', role_template_id: 'role-sales_rep', capability_label: 'Export the CRM', scope_before: null, scope_after: 'company' },
  { id: 2, at: '2026-09-09T16:40:00Z', actor_label: 'Alex Ellis', kind: 'revoked', role_template_id: 'role-sales_rep', capability_label: 'Export the CRM', scope_before: 'company', scope_after: null },
];

export default function RolesPreview() {
  if (process.env.NODE_ENV === 'production') notFound();
  return (
    <div className="kit" style={{ padding: 24, maxWidth: 1200, margin: '0 auto' }}>
      <RolesView
        data={{ roles: ROLES, caps: CAPS, grants: GRANTS, holders: HOLDERS, history: HISTORY }}
        mayEdit
        busy={null}
        said={null}
        failed={null}
        onToggle={() => undefined}
        onRescope={() => undefined}
      />
    </div>
  );
}
