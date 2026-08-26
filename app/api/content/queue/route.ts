import { NextRequest, NextResponse } from 'next/server';
import { requireCapability } from '@/lib/api/guard';

export const dynamic = 'force-dynamic';

/* What the queue would do with something right now.

   The composer shows it before anybody commits: "next free slot is
   Tuesday 9:00 AM". A person choosing between the queue and a time
   should be able to see what the queue would pick. */
export async function GET(req: NextRequest) {
  const gate = await requireCapability('social.view');
  if (!gate.ok) return gate.response;
  const { supabase } = gate;

  const ids = (req.nextUrl.searchParams.get('channels') ?? '').split(',').filter(Boolean);
  if (!ids.length) {
    return NextResponse.json({ ok: true, slots: {} });
  }

  const slots: Record<string, string | null> = {};
  for (const id of ids.slice(0, 25)) {
    const { data } = await supabase.rpc('content_next_slot', { p_channel: id, p_after: null });
    slots[id] = (data as string | null) ?? null;
  }
  return NextResponse.json({ ok: true, slots });
}
