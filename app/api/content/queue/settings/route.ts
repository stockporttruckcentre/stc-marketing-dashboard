import { NextRequest, NextResponse } from 'next/server';
import { requireCapability } from '@/lib/api/guard';

export const dynamic = 'force-dynamic';

/* =============================================================
   What time of day the queue puts a post out.

   From the business:

     'next free slot' in socials, have this push it to the next
     available day where nothing is scheduled, at 3pm.

   Three o'clock is the answer, and it is a setting rather than a number
   inside a function, because:

     once I leave STC in a couple of months it has no more developer at
     all [...] The app should be self-sufficient

   The rule itself, the next day with nothing on it, lives in
   `content_next_slot` in migration 122. This route is only the time.

   ---- What used to be here ----

   A per channel week grid: Monday 09:00, Monday 13:00, Tuesday 09:00.
   Nobody ever filled it in, so the queue had nowhere to put anything
   and the control did nothing while the screen looked finished.
   ============================================================= */

const TIME = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

export async function GET() {
  const gate = await requireCapability('social.view');
  if (!gate.ok) return gate.response;

  const { data, error } = await gate.supabase
    .from('tenant_settings').select('social_queue_time').limit(1).maybeSingle();
  if (error) {
    return NextResponse.json({ ok: false, error: 'read_failed', message: error.message }, { status: 400 });
  }
  return NextResponse.json({ ok: true, at: (data?.social_queue_time as string | null) ?? '15:00:00' });
}

export async function PUT(req: NextRequest) {
  const gate = await requireCapability('social.channels');
  if (!gate.ok) return gate.response;

  const body = await req.json().catch(() => ({})) as { at?: string };
  const at = String(body.at ?? '');
  if (!TIME.test(at)) {
    return NextResponse.json({
      ok: false, error: 'bad_time', message: 'A time of day, as 24 hour clock. "15:00".',
    }, { status: 400 });
  }

  /* One row, locked to one row by its own primary key, so there is
     nothing to match on. `neq('id', false)` is how a single row table
     is updated through PostgREST without naming a key it does not have
     a second value for. */
  const { error } = await gate.supabase
    .from('tenant_settings')
    .update({ social_queue_time: at.length === 5 ? `${at}:00` : at })
    .eq('id', true);
  if (error) {
    return NextResponse.json({ ok: false, error: 'update_failed', message: error.message }, { status: 400 });
  }

  const { data } = await gate.supabase
    .from('tenant_settings').select('social_queue_time').limit(1).maybeSingle();
  return NextResponse.json({ ok: true, at: (data?.social_queue_time as string | null) ?? at });
}
