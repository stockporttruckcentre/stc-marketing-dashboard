import { NextRequest, NextResponse } from 'next/server';
import { requireCapability } from '@/lib/api/guard';

export const dynamic = 'force-dynamic';

/* =============================================================
   The channels a post goes to, and what each one receives.

   Replaced as a set rather than patched one at a time. The composer's
   channel picker is a set: somebody ticks LinkedIn and unticks X in one
   gesture, and sending that as an add and a remove leaves a window
   where the post has neither.

   A channel already published to is never removed. Its variant carries
   the permalink and the external id, which is the only record that the
   post went out at all.
   ============================================================= */

type Body = {
  channel_ids?: string[];
  variants?: Record<string, { content?: string | null; first_comment?: string | null; scheduled_at?: string | null }>;
};

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const gate = await requireCapability('social.draft');
  if (!gate.ok) return gate.response;
  const { supabase } = gate;

  const body = await req.json().catch(() => ({})) as Body;
  const wanted = (body.channel_ids ?? []).filter(Boolean);

  const { data: existing, error: readErr } = await supabase
    .from('social_post_variants')
    .select('id, channel_id, state')
    .eq('post_id', params.id);

  if (readErr) {
    return NextResponse.json({ ok: false, error: 'query_failed', message: readErr.message }, { status: 400 });
  }

  const rows = (existing ?? []) as { id: string; channel_id: string; state: string }[];
  const out = rows.filter((r) => !wanted.includes(r.channel_id));
  const gone = out.filter((r) => r.state !== 'published' && r.state !== 'publishing');
  const kept = out.filter((r) => r.state === 'published' || r.state === 'publishing');

  if (gone.length) {
    const { error } = await supabase.from('social_post_variants')
      .delete().in('id', gone.map((r) => r.id));
    if (error) {
      return NextResponse.json({ ok: false, error: 'update_failed', message: error.message }, { status: 400 });
    }
  }

  const have = new Set(rows.map((r) => r.channel_id));
  const added = wanted.filter((c) => !have.has(c));
  if (added.length) {
    const { error } = await supabase.from('social_post_variants').insert(
      added.map((channel_id, i) => ({
        post_id: params.id,
        channel_id,
        content: body.variants?.[channel_id]?.content?.trim() || null,
        first_comment: body.variants?.[channel_id]?.first_comment?.trim() || null,
        position: rows.length + i,
      })),
    );
    if (error) {
      return NextResponse.json({ ok: false, error: 'update_failed', message: error.message }, { status: 400 });
    }
  }

  for (const channel_id of wanted.filter((c) => have.has(c))) {
    const v = body.variants?.[channel_id];
    if (!v) continue;
    await supabase.from('social_post_variants')
      .update({
        content: v.content?.trim() || null,
        first_comment: v.first_comment?.trim() || null,
        ...(v.scheduled_at !== undefined ? { scheduled_at: v.scheduled_at } : {}),
      })
      .eq('post_id', params.id).eq('channel_id', channel_id);
  }

  const { data: after } = await supabase
    .from('social_post_variants').select('*').eq('post_id', params.id).order('position');

  return NextResponse.json({
    ok: true,
    variants: after ?? [],
    /* Said rather than silently ignored. Somebody who unticked a
       channel that has already published should be told why it is
       still there. */
    kept: kept.map((r) => r.channel_id),
  });
}
