import { NextRequest, NextResponse } from 'next/server';
import { requireCapability } from '@/lib/api/guard';

export const dynamic = 'force-dynamic';

/* =============================================================
   Dragging a card.

   `content_move_card` in migration 055, which is the point: moving a
   card between columns that mean different statuses IS the transition,
   with the transition's own permission. Dragging a card from In review
   to Ready is approving it, and it asks for `social.approve` exactly as
   the button does.

   Moving between two columns that mean the same status, Ideas and
   Writing, is organizing and needs only the right to edit the post.
   ============================================================= */

export async function POST(req: NextRequest) {
  /* The narrow capability, because the database decides what the move
     actually costs. Asking for `social.approve` here would refuse a
     writer tidying their own Ideas column. */
  const gate = await requireCapability('social.draft');
  if (!gate.ok) return gate.response;
  const { supabase } = gate;

  const body = await req.json().catch(() => ({})) as {
    post_id?: string; column_id?: string; position?: number;
  };
  if (!body.post_id || !body.column_id) {
    return NextResponse.json(
      { ok: false, error: 'bad_request', message: 'Which card, and which column?' },
      { status: 400 },
    );
  }

  const { data, error } = await supabase.rpc('content_move_card', {
    p_post: body.post_id,
    p_column: body.column_id,
    p_position: body.position ?? 0,
  });

  if (error) {
    return NextResponse.json(
      { ok: false, error: 'refused', message: error.message.replace(/^ERROR:\s*/, '') },
      { status: 400 },
    );
  }
  return NextResponse.json({ ok: true, post: data });
}
