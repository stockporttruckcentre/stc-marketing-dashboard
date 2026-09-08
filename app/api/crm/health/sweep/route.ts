import { NextResponse } from 'next/server';
import { requireCapability } from '@/lib/api/guard';

export const dynamic = 'force-dynamic';

/* =============================================================
   Chasing the reds and ambers that have gone quiet.

   From the business:

     With a 7-day cooldown (ensure weekends/holidays/bankholidays
     respected) on Amber and 3-day on red (before you are alerted in
     notifs to chase, by email to chase, and as a Work task to chase.
     Email stuff may have to come after SSO plug in.

   Two of the three land, and the third is named rather than faked. The
   work is all in `crm_health_chase()`, migration 099: it reads the view
   that knows what is due in WORKING days, raises a notification and a
   task per account manager, and stamps the event so the next sweep does
   not do it again.

   ---- Why a route and not a cron ----

   Because there is nowhere to run a cron. This installation is a Next
   application and a Supabase database; there is no scheduler in either
   that anybody here administers. So the sweep is a thing that can be
   POSTed, and it is SAFE to POST at any frequency: everything it does
   is deduplicated on the event and the chase count, so running it four
   times in a minute raises one chase.

   That makes it callable from whatever ends up doing the calling: a
   Supabase scheduled function, a machine in the office with a task
   scheduler, or somebody pressing a button on the reports screen. The
   sweep does not care and does not have to be changed when that is
   decided.

   GET says what WOULD go out, and changes nothing. Worth having its own
   verb: somebody looking at "why has nobody chased Booker" needs to see
   the answer without causing it.
   ============================================================= */

export async function GET() {
  const gate = await requireCapability('crm.view');
  if (!gate.ok) return gate.response;

  const { data, error } = await gate.supabase
    .from('crm_health_due_a_chase')
    .select('*')
    .order('level')
    .order('working_days_quiet', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ due: data ?? [] });
}

export async function POST() {
  /* The same capability that lets somebody raise a flag lets them push
     the chases out. It is not an administrator's button: it sends
     people a reminder about work they already agreed to do. */
  const gate = await requireCapability('crm.health');
  if (!gate.ok) return gate.response;

  const { data, error } = await gate.supabase.rpc('crm_health_chase');
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json(data ?? { ok: true, accounts: 0, notified: 0, tasks: 0 });
}
