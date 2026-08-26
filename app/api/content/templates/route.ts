import { NextRequest, NextResponse } from 'next/server';
import { requireCapability } from '@/lib/api/guard';

export const dynamic = 'force-dynamic';

/* =============================================================
   Templates.

   A template is a body with the shape of a post already in it, not a
   saved draft. Saving a draft as a template copies its words: editing
   the draft afterward must not change what everybody else starts from,
   and a reference would mean it did.

   Two capabilities, on purpose. Writing content is enough to make a
   private template, which is somebody's own shorthand. Changing a
   shared one, which is what eleven other people start from, is
   `social.templates`.
   ============================================================= */

export async function POST(req: NextRequest) {
  const gate = await requireCapability('social.draft');
  if (!gate.ok) return gate.response;
  const { supabase, user, caps } = gate;

  const body = await req.json().catch(() => ({})) as {
    name?: string; description?: string; body?: string; first_comment?: string;
    network_keys?: string[]; hashtags?: string[]; is_shared?: boolean;
    from_post?: string;
  };

  let words = body.body?.trim() ?? '';
  let firstComment = body.first_comment?.trim() || null;
  let tags = body.hashtags ?? [];

  /* From an existing post: the words are copied now, so the template
     stops changing the moment it is made. */
  if (body.from_post) {
    const { data } = await supabase
      .from('social_posts')
      .select('content, first_comment, hashtags')
      .eq('id', body.from_post).single();
    const post = data as { content: string; first_comment: string | null; hashtags: string[] } | null;
    if (post) {
      words = words || post.content;
      firstComment = firstComment ?? post.first_comment;
      tags = tags.length ? tags : (post.hashtags ?? []);
    }
  }

  if (!body.name?.trim() || !words) {
    return NextResponse.json(
      { ok: false, error: 'bad_request', message: 'A template needs a name and something in it.' },
      { status: 400 },
    );
  }

  const shared = body.is_shared ?? true;
  if (shared && !caps.has('social.templates') && !caps.has('marketing.edit')) {
    return NextResponse.json(
      {
        ok: false,
        error: 'forbidden',
        message: 'You can save this as your own template. Sharing one with the team needs more access.',
      },
      { status: 403 },
    );
  }

  const { data, error } = await supabase
    .from('social_templates')
    .insert({
      name: body.name.trim(),
      description: body.description?.trim() || null,
      body: words,
      first_comment: firstComment,
      network_keys: body.network_keys ?? [],
      hashtags: tags,
      is_shared: shared,
      created_by: user.id,
    })
    .select('*').single();

  if (error) {
    return NextResponse.json({ ok: false, error: 'create_failed', message: error.message }, { status: 400 });
  }
  return NextResponse.json({ ok: true, template: data });
}

export async function PATCH(req: NextRequest) {
  const gate = await requireCapability('social.draft');
  if (!gate.ok) return gate.response;
  const { supabase } = gate;

  const body = await req.json().catch(() => ({})) as {
    id?: string; name?: string; description?: string; body?: string;
    first_comment?: string; network_keys?: string[]; hashtags?: string[];
    is_shared?: boolean; is_active?: boolean; used?: boolean;
  };
  if (!body.id) {
    return NextResponse.json({ ok: false, error: 'bad_request', message: 'Which template?' }, { status: 400 });
  }

  /* Using a template is not editing it, and the count is what tells
     somebody which templates are worth keeping. */
  if (body.used) {
    const { data: cur } = await supabase
      .from('social_templates').select('use_count').eq('id', body.id).single();
    const next = (((cur as { use_count?: number } | null)?.use_count) ?? 0) + 1;
    await supabase.from('social_templates').update({ use_count: next }).eq('id', body.id);
    return NextResponse.json({ ok: true, use_count: next });
  }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.name !== undefined) patch.name = body.name.trim();
  if (body.description !== undefined) patch.description = body.description.trim() || null;
  if (body.body !== undefined) patch.body = body.body.trim();
  if (body.first_comment !== undefined) patch.first_comment = body.first_comment.trim() || null;
  if (body.network_keys !== undefined) patch.network_keys = body.network_keys;
  if (body.hashtags !== undefined) patch.hashtags = body.hashtags;
  if (body.is_shared !== undefined) patch.is_shared = body.is_shared;
  if (body.is_active !== undefined) patch.is_active = body.is_active;

  const { data, error } = await supabase
    .from('social_templates').update(patch).eq('id', body.id).select('*').single();

  if (error) {
    return NextResponse.json({ ok: false, error: 'update_failed', message: error.message }, { status: 400 });
  }
  if (!data) {
    return NextResponse.json(
      { ok: false, error: 'forbidden', message: 'That is not a template you can change.' },
      { status: 403 },
    );
  }
  return NextResponse.json({ ok: true, template: data });
}
