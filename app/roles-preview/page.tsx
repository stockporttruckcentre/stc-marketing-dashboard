'use client';

/* =============================================================
   The Roles screen, with fabricated roles, for looking at. Dev only.

   From the business, with two screenshots of the live tab:

     It's built the roles page and the whole UI is broken. Look at it.
     This is because it didn't bother to look at what it created.

   The screen reads four tables behind a login, so nothing rendered it
   before it merged. This mounts the same screen with the eleven roles,
   a handful of capabilities and a few holders, and
   `scripts/roles-render-check.ts` opens it beside the kit's own
   `preview.html` in one browser and compares what each one drew.

   `notFound()` in production, like the harnesses next door.
   ============================================================= */

import { useState } from 'react';
import { notFound } from 'next/navigation';
import { RolesScreen } from '@/components/admin/roles/RolesScreen';
import { EditPermissions } from '@/components/admin/roles/EditPermissions';
import { buildModel } from '@/components/admin/roles/model';
import '@/components/admin/roles/roles-tokens.css';
import '@/components/admin/roles/roles-components.css';
import '@/components/admin/roles/roles-behaviour.css';
import '@/components/admin/roles/port.css';

const ROLE = (slug: string, name: string, dept: string, up: string | null, sort: number, manages: string[] = []) => ({
  id: `role-${slug}`, slug, name, description: `${name}: what this role is for.`,
  department: dept, manages, escalates_to: up, sort_order: sort, customised_at: null as string | null,
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
/* One role changed from its template, so the flag block has something to draw. */
ROLES[3]!.customised_at = '2026-09-01T09:00:00Z';

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

/* Sr Sales exports within their department only, so one key
   permission on the screen reads Conditional rather than Allowed. */
const HOLD = (role: string, ...keys: string[]) =>
  keys.map((k) => ({
    role_template_id: `role-${role}`, capability: k,
    scope: k === 'crm.view' ? 'own' : k === 'crm.export' && role === 'sr_sales' ? 'department' : 'company',
  }));

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
  ...HOLD('sr_office_admin', 'crm.view', 'crm.edit', 'crm.import', 'admin.users', 'access.request', 'access.decide', 'work.view', 'work.assign'),
  ...HOLD('office_admin', 'crm.view', 'crm.edit', 'access.request', 'work.view'),
];

const PERSON = (id: string, role: string, name: string, job: string) =>
  ({ id, role_template_id: `role-${role}`, name, job_title: job });

const HOLDERS = [
  PERSON('u1', 'managing_director', 'Gary Sutton', 'Managing Director'),
  PERSON('u2', 'sr_sales', 'Dean Whitfield', 'Head of Sales'),
  PERSON('u3', 'sales_rep', 'Sam Gill', 'Sales'),
  PERSON('u4', 'sales_rep', 'Marcus Hale', 'Sales'),
  PERSON('u5', 'sales_rep', 'Rob Price', 'Sales'),
  PERSON('u6', 'sales_rep', 'Dan Clarke', 'Sales'),
  PERSON('u7', 'sales_rep', 'Alan Booth', 'Sales'),
  PERSON('u8', 'sales_rep', 'Priya Nair', 'Sales'),
  PERSON('u9', 'developer', 'Alex Dawson', 'Developer'),
  PERSON('u10', 'office_admin', 'Wayne Kenny', 'Administrator'),
];

const NAV = [
  { label: 'Workspace', items: [
    { label: 'Dashboard', icon: 'dashboard' as const, active: false },
    { label: 'Analytics', icon: 'analytics' as const, active: false },
    { label: 'Reports', icon: 'reports' as const, active: false },
    { label: 'Work', icon: 'work' as const, active: false },
  ] },
  { label: 'Admin', items: [
    { label: 'Team', icon: 'team' as const, active: false },
    { label: 'Settings', icon: 'settings' as const, active: false },
    { label: 'Admin', icon: 'admin' as const, active: true },
  ] },
];

const HISTORY = [
  { id: 1, at: '2026-08-14T09:12:00Z', actor_label: 'G Sutton', kind: 'granted',
    role_template_id: 'role-sr_sales', capability_label: 'Export the CRM',
    scope_before: null, scope_after: 'company' },
  { id: 2, at: '2026-07-02T16:40:00Z', actor_label: 'A Dawson', kind: 'rescoped',
    role_template_id: 'role-sr_sales', capability_label: 'Decide those requests',
    scope_before: 'company', scope_after: 'department' },
  { id: 3, at: '2026-05-19T11:05:00Z', actor_label: 'G Sutton', kind: 'revoked',
    role_template_id: 'role-sr_sales', capability_label: 'Import into the CRM',
    scope_before: 'company', scope_after: null },
];

export default function RolesPreview() {
  if (process.env.NODE_ENV === 'production') notFound();
  const [editing, setEditing] = useState<string | null>(null);
  const model = buildModel({ roles: ROLES, caps: CAPS, grants: GRANTS, holders: HOLDERS, history: HISTORY });
  const role = ROLES.find((r) => r.slug === editing) ?? null;
  const held = new Map(GRANTS.filter((g) => g.role_template_id === role?.id).map((g) => [g.capability, g.scope]));
  return (
    <div className="roles-port">
      <RolesScreen model={model} nav={NAV} mayEdit
        me={{ initials: 'GS', name: 'Gary Sutton', role: 'Managing Director' }}
        onEdit={setEditing} onAssign={() => {}} />
      {role && (
        <EditPermissions role={role} caps={CAPS} held={held} saving={false} failed={null}
          onClose={() => setEditing(null)} onSave={() => setEditing(null)} />
      )}
    </div>
  );
}
