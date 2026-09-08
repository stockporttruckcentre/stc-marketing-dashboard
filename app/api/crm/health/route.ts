import { NextRequest, NextResponse } from 'next/server';
import { requireCapability } from '@/lib/api/guard';

export const dynamic = 'force-dynamic';

/* =============================================================
   Setting where an account stands, and telling people about it.

   Two verbs, one route, because they are the same subject and the
   caller has the same thing in front of it:

     POST { contact_id, level, reason }   set green, amber or red
     POST { contact_id, alert: true, note }  tell the account managers

   Neither decides anything. `crm_set_health` and `crm_alert_health` in
   migration 099 hold the rules, including who may do it: they check
   `command_may('crm.health')` themselves, so a caller that got past
   this guard by some other route still cannot write.

   The guard is here as well because a refusal from a route is a
   sentence somebody can act on and a refusal from row level security
   is a Postgres error code. Both, in that order.
   ============================================================= */

const LEVELS = ['green', 'amber', 'red'];

export async function POST(req: NextRequest) {
  const gate = await requireCapability('crm.health');
  if (!gate.ok) return gate.response;

  const b = await req.json().catch(() => ({})) as {
    contact_id?: string; level?: string; reason?: string;
    alert?: boolean; note?: string;
  };

  if (!b.contact_id) {
    return NextResponse.json({ error: 'Which customer?' }, { status: 400 });
  }

  /* Telling people is its own act. From the business: "Add a button to
     alert the account manager(s) manually with the reason." Somebody
     can flag an account amber on Monday, work it themselves, and decide
     on Wednesday that the account manager needs to know. */
  if (b.alert) {
    const { data, error } = await gate.supabase.rpc('crm_alert_health', {
      p_contact: b.contact_id,
      p_note: b.note ?? null,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    const said = data as { ok: boolean; why?: string; told?: number; level?: string };
    if (!said?.ok) return NextResponse.json({ error: said?.why ?? 'That did not go through.' }, { status: 400 });
    return NextResponse.json(said);
  }

  if (!b.level || !LEVELS.includes(b.level)) {
    return NextResponse.json({ error: 'Green, amber or red.' }, { status: 400 });
  }

  const { data, error } = await gate.supabase.rpc('crm_set_health', {
    p_contact: b.contact_id,
    p_level: b.level,
    p_reason: b.reason ?? null,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  const said = data as { ok: boolean; why?: string; told?: number; level?: string };
  if (!said?.ok) return NextResponse.json({ error: said?.why ?? 'That did not go through.' }, { status: 400 });
  return NextResponse.json(said);
}

/**
 * What is open on one account, or everything open.
 *
 * `?contact=` for the drawer, nothing for the report. The report needs
 * every open red and amber with its reason, which is the first thing
 * the bi-weekly meeting goes through.
 */
export async function GET(req: NextRequest) {
  const gate = await requireCapability('crm.view');
  if (!gate.ok) return gate.response;

  const contact = req.nextUrl.searchParams.get('contact');

  let q = gate.supabase
    .from('crm_health_events')
    .select('*, account:crm_contacts ( id, company_name, assigned_to )')
    .order('raised_at', { ascending: false });

  if (contact) q = q.eq('contact_id', contact);
  else q = q.is('resolved_at', null);

  const { data, error } = await q.limit(contact ? 20 : 200);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ events: data ?? [] });
}
