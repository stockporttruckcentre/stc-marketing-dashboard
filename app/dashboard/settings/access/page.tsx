import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { AccessReport } from '@/components/platform/AccessReport';

export const dynamic = 'force-dynamic';

/* =============================================================
   What can I open, and why not.

   Open to anybody signed in, deliberately. It answers a question about
   THE PERSON READING IT and nothing else, so there is nothing here to
   withhold: it tells you what you already experience every time you
   click something.

   ---- Why it exists ----

   An evening was lost to every gated page bouncing to the dashboard
   with nothing said. Permissions were granted three times over,
   correctly, and changed nothing, because the fault was never a missing
   grant. There was no way to see what the system actually believed.

   This is that way. It reports, in order:

     who the DATABASE thinks you are, which is not always who the
       application thinks you are, and when those two disagree nothing
       else on this page will make sense
     which role you are on and where it came from
     every capability, whether you hold it, and by what route
     whether the lookup itself is working at all

   The last one is the one that mattered: a lookup that fails looks
   exactly like a refusal from outside, and this is where the two stop
   looking alike.
   ============================================================= */
export default async function AccessPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  /* ---- Does the database agree about who is asking? ----

     `command_may` resolves against `auth.uid()`. If the request reaches
     PostgREST without a session, that is null and EVERY capability
     answers false, which is indistinguishable from a person with no
     permissions until you ask this question directly. */
  const { data: actor, error: actorError } = await supabase.rpc('current_actor');

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, full_name, email, role, role_template_id, is_active')
    .eq('id', user.id)
    .maybeSingle();

  const p = profile as {
    id: string; full_name: string | null; email: string | null;
    role: string | null; role_template_id: string | null; is_active: boolean;
  } | null;

  const { data: template } = p?.role_template_id
    ? await supabase.from('role_templates')
        .select('name, slug, is_active, customised_at')
        .eq('id', p.role_template_id).maybeSingle()
    : { data: null };

  /* The full resolution, straight from the database, per capability. */
  const { data: report, error: reportError } =
    await supabase.rpc('capability_report', { p_user: user.id });

  /* And one direct call, because the report and `command_may` are two
     different functions and a page guard uses the second. If these two
     ever disagree, that IS the bug, and this is where it shows. */
  const { data: spotCheck, error: spotError } =
    await supabase.rpc('command_may', { p_capability: 'revenue.view' });

  return (
    <AccessReport
      signedInAs={{ id: user.id, email: user.email ?? null }}
      databaseSees={{ actor: (actor as string | null) ?? null, error: actorError?.message ?? null }}
      profile={p}
      template={template as { name: string; slug: string; is_active: boolean; customised_at: string | null } | null}
      report={{
        rows: Array.isArray(report)
          ? (report as { key: string; label: string; area: string; granted: boolean; source: string; scope: string | null }[])
          : [],
        error: reportError?.message ?? null,
      }}
      spotCheck={{ capability: 'revenue.view', answer: spotCheck as boolean | null, error: spotError?.message ?? null }}
    />
  );
}
