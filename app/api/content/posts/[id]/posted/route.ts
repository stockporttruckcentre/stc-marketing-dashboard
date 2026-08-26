import { NextRequest, NextResponse } from 'next/server';
import { requireCapability } from '@/lib/api/guard';

export const dynamic = 'force-dynamic';

/* =============================================================
   Recording that something went out by hand.

   The planner has always had a Mark posted button. No network driver
   exists yet, because every one of them needs an app registration and
   several need review first, so without this every post in the product
   would sit at Scheduled forever while somebody posted it on the
   network themselves.

   `content_mark_posted` records it as manual rather than pretending
   this product published it, which is the only way the history reads
   honestly once drivers do land.

   The capability is deliberately the wider of the pair: anybody who
   could press the button before can press it now.
   ============================================================= */

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const gate = await requireCapability('marketing.edit');
  if (!gate.ok) return gate.response;
  const { supabase } = gate;

  const body = await req.json().catch(() => ({})) as { note?: string };

  const { data, error } = await supabase.rpc('content_mark_posted', {
    p_post: params.id,
    p_note: body.note?.trim() || null,
  });

  if (error) {
    return NextResponse.json(
      { ok: false, error: 'refused', message: error.message.replace(/^ERROR:\s*/, '') },
      { status: 400 },
    );
  }
  return NextResponse.json({ ok: true, post: data });
}
