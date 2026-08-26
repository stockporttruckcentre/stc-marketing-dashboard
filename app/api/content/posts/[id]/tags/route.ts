import { NextRequest, NextResponse } from 'next/server';
import { requireCapability } from '@/lib/api/guard';

export const dynamic = 'force-dynamic';

/* The tags on a post, replaced as a set. Tagging is not managing tags:
   somebody who may write content may put an existing tag on their own
   post, which is why this asks for `social.draft` and not
   `social.tags`. */
export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const gate = await requireCapability('social.draft');
  if (!gate.ok) return gate.response;
  const { supabase } = gate;

  const body = await req.json().catch(() => ({})) as { tag_ids?: string[] };
  const wanted = (body.tag_ids ?? []).filter(Boolean);

  const { error: clearErr } = await supabase
    .from('social_post_tags').delete().eq('post_id', params.id);
  if (clearErr) {
    return NextResponse.json({ ok: false, error: 'update_failed', message: clearErr.message }, { status: 400 });
  }

  if (wanted.length) {
    const { error } = await supabase.from('social_post_tags')
      .insert(wanted.map((tag_id) => ({ post_id: params.id, tag_id })));
    if (error) {
      return NextResponse.json({ ok: false, error: 'update_failed', message: error.message }, { status: 400 });
    }
  }
  return NextResponse.json({ ok: true, tag_ids: wanted });
}
