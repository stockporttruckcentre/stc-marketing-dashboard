import { NextRequest, NextResponse } from 'next/server';
import { requireCapability } from '@/lib/api/guard';

export const dynamic = 'force-dynamic';

/* =============================================================
   A channel's posting times.

   Replaced as a set, because that is what the editor is: a week grid
   somebody ticks. Sending each change separately would leave a channel
   with no slots for as long as it took the next request to land, and
   `content_next_slot` would answer null in the meantime.

   Times are the channel's own, and stored as a plain TIME. What UTC
   instant 9am on a Tuesday means is worked out when a post is queued,
   in `content_next_slot`, because a stored instant would drift by an
   hour twice a year.
   ============================================================= */

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const gate = await requireCapability('social.channels');
  if (!gate.ok) return gate.response;
  const { supabase } = gate;

  const body = await req.json().catch(() => ({})) as {
    slots?: { day_of_week: number; at_time: string }[];
  };
  const wanted = (body.slots ?? []).filter(
    (s) => Number.isInteger(s.day_of_week) && s.day_of_week >= 0 && s.day_of_week <= 6
      && /^\d{2}:\d{2}(:\d{2})?$/.test(s.at_time),
  );

  const { error: clearErr } = await supabase
    .from('social_channel_slots').delete().eq('channel_id', params.id);
  if (clearErr) {
    return NextResponse.json({ ok: false, error: 'update_failed', message: clearErr.message }, { status: 400 });
  }

  if (wanted.length) {
    /* Deduplicated here rather than relying on the unique index to
       refuse, because a grid that sent the same cell twice is a
       client bug and refusing the whole save over it would lose the
       other thirteen slots somebody just set. */
    const seen = new Set<string>();
    const rows = wanted.filter((s) => {
      const key = `${s.day_of_week}:${s.at_time}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).map((s) => ({ channel_id: params.id, day_of_week: s.day_of_week, at_time: s.at_time }));

    const { error } = await supabase.from('social_channel_slots').insert(rows);
    if (error) {
      return NextResponse.json({ ok: false, error: 'update_failed', message: error.message }, { status: 400 });
    }
  }

  const { data } = await supabase
    .from('social_channel_slots').select('*').eq('channel_id', params.id)
    .order('day_of_week').order('at_time');

  return NextResponse.json({ ok: true, slots: data ?? [] });
}
