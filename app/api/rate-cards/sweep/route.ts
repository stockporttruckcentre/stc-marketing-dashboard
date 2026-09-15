import { NextResponse } from 'next/server';
import { requireCapability } from '@/lib/api/guard';

export const dynamic = 'force-dynamic';

/* =============================================================
   Tell the account manager when a rate card is nearly a year old.

   From the business:

     Rates are usually only good for a year so if a rate card is 11
     months old, send a notification to the owner of this account that
     they should look in to it.

   ---- Why a route and not a cron ----

   The same reason the CRM health chase is a route: there is nowhere in
   this installation to run one. This is a Next application and a
   Supabase database, and neither has a scheduler anybody here
   administers.

   So the sweep is a thing that can be POSTed, and it is SAFE to POST at
   any frequency: `rate_card_sweep_stale` stamps each card it warns
   about, and the next sweep skips it. Running it four times in a minute
   sends one notification.

   That makes it callable from whatever ends up doing the calling: a
   Supabase scheduled function, a machine in the office with a task
   scheduler, or somebody pressing a button. The sweep does not care and
   does not have to change when that is decided.

   GET says what WOULD go out and changes nothing, which is worth its
   own verb: somebody asking "why has nobody been told about Dole" needs
   to see the answer without causing it.
   ============================================================= */

export async function GET() {
  const gate = await requireCapability('ratecard.view');
  if (!gate.ok) return gate.response;

  const { data, error } = await gate.supabase.rpc('rate_card_sweep_stale', { p_dry_run: true });
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
  }
  return NextResponse.json({ ok: true, would_warn: data ?? [] });
}

export async function POST() {
  const gate = await requireCapability('ratecard.view');
  if (!gate.ok) return gate.response;

  const { data, error } = await gate.supabase.rpc('rate_card_sweep_stale', { p_dry_run: false });
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
  }
  const warned = (data ?? []) as unknown[];
  return NextResponse.json({ ok: true, warned: warned.length, cards: warned });
}
