import { NextRequest, NextResponse } from 'next/server';
import { requireCapability } from '@/lib/api/guard';

export const dynamic = 'force-dynamic';

/* =============================================================
   The library.

   A picture the company keeps, whether or not anything has used it
   yet. It points at a row in `files`, which migration 052 already gives
   with classification, permissions and a driver per file. Research
   section 5: the asset store exists, and building a second one inside
   Content is the mistake.

   Bytes go to `/api/files`. This is the entry that makes one of those
   files a thing people search, tag and reuse, rather than an attachment
   on one post nobody can find again.

   Sprinklr approves assets, not only posts, and it is right: a logo
   lockup nobody signed off should not reach a public account because
   somebody found it in a folder.
   ============================================================= */

export async function POST(req: NextRequest) {
  const gate = await requireCapability('social.library');
  if (!gate.ok) return gate.response;
  const { supabase, user } = gate;

  const body = await req.json().catch(() => ({})) as {
    file_id?: string; name?: string; description?: string; alt_text?: string;
    tag_ids?: string[];
  };
  if (!body.file_id || !body.name?.trim()) {
    return NextResponse.json(
      { ok: false, error: 'bad_request', message: 'A library entry needs a file and a name.' },
      { status: 400 },
    );
  }

  const { data, error } = await supabase
    .from('social_library')
    .insert({
      file_id: body.file_id,
      name: body.name.trim(),
      description: body.description?.trim() || null,
      alt_text: body.alt_text?.trim() || null,
      added_by: user.id,
    })
    .select('*').single();

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json(
        { ok: false, error: 'duplicate', message: 'That file is already in the library.' },
        { status: 400 },
      );
    }
    return NextResponse.json({ ok: false, error: 'create_failed', message: error.message }, { status: 400 });
  }

  const item = data as { id: string };
  if (body.tag_ids?.length) {
    await supabase.from('social_library_tags')
      .insert(body.tag_ids.map((tag_id) => ({ library_id: item.id, tag_id })));
  }
  return NextResponse.json({ ok: true, item: data });
}

export async function PATCH(req: NextRequest) {
  const gate = await requireCapability('social.library');
  if (!gate.ok) return gate.response;
  const { supabase, user, caps } = gate;

  const body = await req.json().catch(() => ({})) as {
    id?: string; name?: string; description?: string; alt_text?: string;
    is_active?: boolean; approve?: boolean; used?: boolean; tag_ids?: string[];
  };
  if (!body.id) {
    return NextResponse.json({ ok: false, error: 'bad_request', message: 'Which asset?' }, { status: 400 });
  }

  /* Using an asset is not editing it. The count and the date are what
     answer "which of these is worth keeping", which is the question a
     library of four hundred pictures exists to answer. */
  if (body.used) {
    const { data: cur } = await supabase
      .from('social_library').select('use_count').eq('id', body.id).single();
    const next = (((cur as { use_count?: number } | null)?.use_count) ?? 0) + 1;
    await supabase.from('social_library')
      .update({ use_count: next, last_used_at: new Date().toISOString() })
      .eq('id', body.id);
    return NextResponse.json({ ok: true, use_count: next });
  }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.name !== undefined) patch.name = body.name.trim();
  if (body.description !== undefined) patch.description = body.description.trim() || null;
  if (body.alt_text !== undefined) patch.alt_text = body.alt_text.trim() || null;
  if (body.is_active !== undefined) patch.is_active = body.is_active;

  if (body.approve !== undefined) {
    /* Approving an asset is approving content, not managing a library.
       Somebody who uploads pictures should not be the person who signs
       them off. */
    if (!caps.has('social.approve') && !caps.has('marketing.approve')) {
      return NextResponse.json(
        {
          ok: false,
          error: 'forbidden',
          message: 'You can add to the library. Signing an asset off needs approval access.',
        },
        { status: 403 },
      );
    }
    patch.approved_at = body.approve ? new Date().toISOString() : null;
    patch.approved_by = body.approve ? user.id : null;
  }

  const { data, error } = await supabase
    .from('social_library').update(patch).eq('id', body.id).select('*').single();

  if (error) {
    return NextResponse.json({ ok: false, error: 'update_failed', message: error.message }, { status: 400 });
  }

  if (body.tag_ids) {
    await supabase.from('social_library_tags').delete().eq('library_id', body.id);
    if (body.tag_ids.length) {
      await supabase.from('social_library_tags')
        .insert(body.tag_ids.map((tag_id) => ({ library_id: body.id!, tag_id })));
    }
  }
  return NextResponse.json({ ok: true, item: data });
}
