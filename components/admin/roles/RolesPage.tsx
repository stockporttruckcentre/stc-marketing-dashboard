'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { EmptyState, NotProvisioned, Skeleton } from '@/components/kit/primitives';
import { RolesScreen, type Me, type NavSectionView } from './RolesScreen';
import { buildModel, type Cap, type Grant, type Holder, type Line, type Template } from './model';
import { EditPermissions, type Change } from './EditPermissions';
import './roles-tokens.css';
import './roles-components.css';
import './roles-behaviour.css';
import './port.css';

/* =============================================================
   The Roles tab: four tables in, the kit's screen out.

   The loader and the screen are two components on purpose.
   `RolesScreen` draws from props and knows nothing about Supabase, so
   `app/roles-preview` can mount it with fabricated roles and a browser
   can look at it before it merges. The last version of this tab went
   live without anybody rendering it, and the business sent two
   screenshots of the result.

   ---- What is read ----

   role_templates, capability_catalog and role_template_capabilities
   are the permission model itself: `command_may()` resolves every
   request in the application against those same rows, so what this
   screen says a role can do is what the database will let its people
   do. role_holders is who sits on each one.

   ---- What is written, and by whom ----

   Only `set_role_capability` (migration 108), one call per changed
   row, from the Edit permissions modal. That function is where the
   refusals live: it needs `admin.roles`, it will not let the last
   active holder of `admin.users` lose it, it will not let somebody
   strip their own role of `admin.roles` or `admin.users`, and it
   refuses an archived role. None of that is re-implemented here. The
   button is disabled without the capability so the modal is not
   offered to somebody it would only refuse, which is the same rule the
   command bar follows.

   A change applies to everybody on the role at once, because
   `command_may()` resolves through a JOIN to `role_templates` rather
   than a copy. That is the point of the screen, and the modal says so
   before saving.
   ============================================================= */
export function RolesPage({ nav, me, mayEdit }: {
  nav: NavSectionView[]; me: Me;
  /** `admin.roles`: may change what a role can do, not only read it. */
  mayEdit: boolean;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [roles, setRoles] = useState<Template[] | null>(null);
  const [caps, setCaps] = useState<Cap[]>([]);
  const [grants, setGrants] = useState<Grant[]>([]);
  const [holders, setHolders] = useState<Holder[]>([]);
  const [history, setHistory] = useState<Line[]>([]);
  const [missing, setMissing] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  const load = useCallback(async () => {
    {
      const [tpl, cat, gr, hd, hist] = await Promise.all([
        supabase.from('role_templates')
          .select('id, slug, name, description, department, manages, escalates_to, sort_order, customised_at')
          .eq('is_active', true).order('sort_order'),
        supabase.from('capability_catalog')
          .select('key, label, description, area, feature, danger, position')
          .eq('is_active', true).order('position'),
        supabase.from('role_template_capabilities').select('role_template_id, capability, scope'),
        supabase.from('role_holders').select('id, role_template_id, name, job_title').eq('is_active', true),
        /* ---- Newest first, and generously capped ----

           The History tab is per role, and the model slices this list
           by role. An earlier version took 40 rows globally and then
           filtered, which silently hid every change to a quiet role
           behind 40 changes to a busy one. Ordering and a cap well
           above the size of the table is the fix: changing what a role
           can do is a rare act, and 500 of them is years. */
        supabase.from('role_capability_history')
          .select('id, at, actor_label, kind, role_template_id, capability_label, scope_before, scope_after')
          .order('at', { ascending: false }).limit(500),
      ]);
      /* The roles arrive in 103, the shape columns in 105 and the
         holders view in 108. Until those are pasted this says which,
         rather than opening a raw schema error. */
      const err = tpl.error ?? cat.error ?? gr.error ?? hd.error;
      if (err?.code === '42P01' || err?.code === 'PGRST205' || err?.code === '42703') {
        setMissing(true); setRoles([]); return;
      }
      if (err) { setFailed(err.message); setRoles([]); return; }
      setRoles((tpl.data ?? []) as Template[]);
      setCaps((cat.data ?? []) as Cap[]);
      setGrants((gr.data ?? []) as Grant[]);
      setHolders((hd.data ?? []) as Holder[]);
      /* The history view arrives in 108, the newest of the three. A
         database without it still draws the whole screen rather than
         refusing it, and the History tab is simply empty. */
      setHistory(hist.error ? [] : ((hist.data ?? []) as Line[]));
    }
  }, [supabase]);

  useEffect(() => { void load(); }, [load]);

  /* ---- The editor ---- */
  const [editing, setEditing] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);

  const role = roles?.find((r) => r.slug === editing) ?? null;
  const held = useMemo(() => {
    const m = new Map<string, string>();
    if (role) for (const g of grants) if (g.role_template_id === role.id) m.set(g.capability, g.scope);
    return m;
  }, [grants, role]);

  const save = useCallback(async (changes: Change[]) => {
    if (!role || changes.length === 0) { setEditing(null); return; }
    setSaving(true); setRefused(null);
    for (const c of changes) {
      /* Allowed is a grant at company scope. Conditional restores the
         scope the row already had, which is the only narrower scope
         this control can name. Denied removes the grant, and the
         function ignores the scope argument when it does. */
      const scope = c.to === 'allowed' ? 'company' : c.to === 'conditional' ? c.scope : null;
      const { error } = await supabase.rpc('set_role_capability', {
        p_role: role.id, p_capability: c.cap.key,
        p_granted: c.to !== 'denied', p_scope: scope,
      });
      if (error) {
        /* Stop on the first refusal rather than carrying on. The rows
           before it are already written and the reload will show
           exactly which, so the screen never claims more than happened. */
        setSaving(false); setRefused(error.message); await load(); return;
      }
    }
    setSaving(false); setEditing(null);
    await load();
  }, [role, supabase, load]);

  const model = useMemo(
    () => (roles && roles.length > 0 ? buildModel({ roles, caps, grants, holders, history }) : null),
    [roles, caps, grants, holders, history],
  );

  if (missing) {
    return (
      <NotProvisioned
        what="The eleven roles are not in this database yet, so there is no hierarchy to draw."
        needs="migrations 103, 105 and 108, which are the SQL handed over in chat"
      />
    );
  }
  if (!roles) return <div>{[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} />)}</div>;
  if (!model) return <EmptyState what="No roles" why={failed ?? 'Nothing came back from role_templates.'} />;

  return (
    <div className="roles-port">
      <RolesScreen model={model} nav={nav} me={me} mayEdit={mayEdit}
        onEdit={(id) => { setRefused(null); setEditing(id); }} />
      {role && (
        <EditPermissions
          role={role} caps={caps} held={held} saving={saving} failed={refused}
          onClose={() => setEditing(null)} onSave={save}
        />
      )}
    </div>
  );
}
