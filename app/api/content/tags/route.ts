import { NextRequest, NextResponse } from 'next/server';
import { requireCapability } from '@/lib/api/guard';
import { slugify } from '@/lib/content/types';

export const dynamic = 'force-dynamic';

/* =============================================================
   Tags.

   How content is organized, and more usefully how it is reported on:
   Buffer's tag analytics answers "how does recruitment content do
   against product content", which is a better question than "how did
   Tuesday do".

   No colour. The STC kit's rule is that colour never carries data on its own,
   a tag palette is exactly that, and it stops working past about eight
   tags anyway. Tags are words.
   ============================================================= */

export async function POST(req: NextRequest) {
  const gate = await requireCapability('social.tags');
  if (!gate.ok) return gate.response;
  const { supabase, user } = gate;

  const body = await req.json().catch(() => ({})) as { name?: string; description?: string };
  const name = body.name?.trim();
  if (!name) {
    return NextResponse.json({ ok: false, error: 'bad_request', message: 'A tag needs a name.' }, { status: 400 });
  }

  const slug = slugify(name);
  if (!slug) {
    return NextResponse.json(
      { ok: false, error: 'bad_request', message: 'That name has nothing in it a tag can be keyed by. Use letters or numbers.' },
      { status: 400 },
    );
  }

  const { data, error } = await supabase
    .from('social_tags')
    .insert({ name, slug, description: body.description?.trim() || null, created_by: user.id })
    .select('*').single();

  if (error) {
    if (error.code === '23505') {
      /* Already there. Handing back the existing one beats an error:
         two people naming the same tag on the same afternoon is
         ordinary, and it is the same tag. */
      const { data: existing } = await supabase
        .from('social_tags').select('*').eq('slug', slug).single();
      if (existing) return NextResponse.json({ ok: true, tag: existing, existed: true });
    }
    return NextResponse.json({ ok: false, error: 'create_failed', message: error.message }, { status: 400 });
  }
  return NextResponse.json({ ok: true, tag: data });
}

export async function PATCH(req: NextRequest) {
  const gate = await requireCapability('social.tags');
  if (!gate.ok) return gate.response;
  const { supabase } = gate;

  const body = await req.json().catch(() => ({})) as {
    id?: string; name?: string; description?: string; is_active?: boolean;
    /** Fold this tag into another one, keeping every post it was on. */
    merge_into?: string;
  };
  if (!body.id) {
    return NextResponse.json({ ok: false, error: 'bad_request', message: 'Which tag?' }, { status: 400 });
  }

  if (body.merge_into) {
    if (body.merge_into === body.id) {
      return NextResponse.json(
        { ok: false, error: 'bad_request', message: 'A tag cannot be merged into itself.' },
        { status: 400 },
      );
    }
    const { data: rows } = await supabase
      .from('social_post_tags').select('post_id').eq('tag_id', body.id);

    for (const r of (rows ?? []) as { post_id: string }[]) {
      /* Ignoring a duplicate rather than refusing: a post carrying both
         tags already is the common case in a merge, and it is already
         in the state the merge is trying to reach. */
      await supabase.from('social_post_tags')
        .insert({ post_id: r.post_id, tag_id: body.merge_into });
    }
    await supabase.from('social_post_tags').delete().eq('tag_id', body.id);
    await supabase.from('social_tags').update({ is_active: false }).eq('id', body.id);

    return NextResponse.json({ ok: true, merged: (rows ?? []).length });
  }

  const patch: Record<string, unknown> = {};
  if (body.name !== undefined) patch.name = body.name.trim();
  if (body.description !== undefined) patch.description = body.description.trim() || null;
  if (body.is_active !== undefined) patch.is_active = body.is_active;

  const { data, error } = await supabase
    .from('social_tags').update(patch).eq('id', body.id).select('*').single();

  if (error) {
    return NextResponse.json({ ok: false, error: 'update_failed', message: error.message }, { status: 400 });
  }
  return NextResponse.json({ ok: true, tag: data });
}
