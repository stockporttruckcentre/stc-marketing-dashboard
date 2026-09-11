'use client';

import { useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { EmptyState, NotProvisioned, Skeleton } from '@/components/kit/primitives';
import { RolesScreen, type Me, type NavSectionView } from './RolesScreen';
import { buildModel, type Cap, type Grant, type Holder, type Template } from './model';
import './roles-tokens.css';
import './roles-page.css';
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

   ---- What is not written ----

   Nothing, from this screen. `set_role_capability` (migration 108)
   is still in the database and still refuses everything it refused,
   but the kit's Edit permissions button opens a modal that has not
   been handed over in the form this screen was, so the button is
   drawn and not wired. Stated in the recap rather than filled in.
   ============================================================= */
export function RolesPage({ nav, me }: { nav: NavSectionView[]; me: Me }) {
  const supabase = useMemo(() => createClient(), []);
  const [roles, setRoles] = useState<Template[] | null>(null);
  const [caps, setCaps] = useState<Cap[]>([]);
  const [grants, setGrants] = useState<Grant[]>([]);
  const [holders, setHolders] = useState<Holder[]>([]);
  const [missing, setMissing] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      const [tpl, cat, gr, hd] = await Promise.all([
        supabase.from('role_templates')
          .select('id, slug, name, description, department, manages, escalates_to, sort_order, customised_at')
          .eq('is_active', true).order('sort_order'),
        supabase.from('capability_catalog')
          .select('key, label, description, area, feature, danger, position')
          .eq('is_active', true).order('position'),
        supabase.from('role_template_capabilities').select('role_template_id, capability, scope'),
        supabase.from('role_holders').select('id, role_template_id, name, job_title').eq('is_active', true),
      ]);
      if (!live) return;
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
    })();
    return () => { live = false; };
  }, [supabase]);

  const model = useMemo(
    () => (roles && roles.length > 0 ? buildModel({ roles, caps, grants, holders }) : null),
    [roles, caps, grants, holders],
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
      <RolesScreen model={model} nav={nav} me={me} />
    </div>
  );
}
