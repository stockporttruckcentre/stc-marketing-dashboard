import { NextRequest, NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { requireCapability } from '@/lib/api/guard';

export const dynamic = 'force-dynamic';

/* =============================================================
   Writing a post, and its channels with it.

   A post and the channels it goes to are one act as far as a person is
   concerned: they pick LinkedIn and X in the composer and press save
   once. Two requests would mean a post that exists with nowhere to go
   if the second one failed, and `content_submit` refuses a post with no
   channels, so that state is a dead end somebody has to notice.

   The status is not taken from the body. It never is: a browser that
   chose its own status could write `approved`, which is what migration
   050 closed and this route must not reopen.
   ============================================================= */

type Body = {
  content?: string;
  caption?: string | null;
  first_comment?: string | null;
  hashtags?: string[];
  channel_ids?: string[];
  /** Per channel overrides, keyed by channel id. Absent means "the post's words". */
  variants?: Record<string, { content?: string | null; first_comment?: string | null }>;
  scheduled_at?: string | null;
  campaign_id?: string | null;
  template_id?: string | null;
  link_url?: string | null;
  internal_note?: string | null;
  tag_ids?: string[];
  media?: { file_id: string; alt_text?: string | null }[];
  /* The picture on the post.

     From the business: "make it so images uploaded to social posts
     actually save". They did not. The composer uploaded the file to the
     bucket, held the URL in its own state and drew it in the preview,
     and then never sent it: this type had no `image_url` and the insert
     below never wrote one. So every new post lost its picture between
     the composer showing it and the row being written, and nothing
     anywhere said so.

     The PATCH route next door already accepted it, which is why editing
     a post and saving again looked like it should have worked and did
     not: the composer was not sending it to either. */
  image_url?: string | null;
};

export async function POST(req: NextRequest) {
  const gate = await requireCapability('social.draft');
  if (!gate.ok) return gate.response;
  const { supabase, user, fullName } = gate;

  const body = await req.json().catch(() => ({})) as Body;
  const words = (body.content ?? '').trim();
  if (!words) {
    return NextResponse.json(
      { ok: false, error: 'bad_request', message: 'A post with nothing in it is not a post.' },
      { status: 400 },
    );
  }

  const channels = (body.channel_ids ?? []).filter(Boolean);

  const { data: post, error } = await supabase
    .from('social_posts')
    .insert({
      content: words,
      caption: body.caption?.trim() || null,
      first_comment: body.first_comment?.trim() || null,
      hashtags: body.hashtags ?? [],
      /* Left empty on purpose. The trigger in migration 054 fills it
         from the variants below, so the legacy array cannot drift from
         the channels the post actually has. */
      platform: [],
      scheduled_date: (body.scheduled_at ?? new Date().toISOString()).slice(0, 10),
      scheduled_at: body.scheduled_at ?? null,
      created_by: fullName,
      author_id: user.id,
      campaign_id: body.campaign_id ?? null,
      template_id: body.template_id ?? null,
      link_url: body.link_url?.trim() || null,
      internal_note: body.internal_note?.trim() || null,
      image_url: body.image_url?.trim() || null,
    })
    .select('id')
    .single();

  if (error || !post) {
    return NextResponse.json(
      { ok: false, error: 'create_failed', message: error?.message ?? 'The post could not be saved.' },
      { status: 400 },
    );
  }

  const id = (post as { id: string }).id;
  const trouble = await attachAll(supabase, id, body, channels);
  if (trouble) {
    /* The post exists and half of what it needs does not, which is
       worse than no post at all: it would sit in Drafts looking
       finished. Rolled back by hand, because PostgREST has no
       transaction across requests. */
    await supabase.from('social_posts').delete().eq('id', id);
    return NextResponse.json({ ok: false, error: 'create_failed', message: trouble }, { status: 400 });
  }

  const { data: full } = await supabase.from('social_posts').select('*').eq('id', id).single();
  return NextResponse.json({ ok: true, post: full });
}

/** The variants, tags and media a post arrives with. */
async function attachAll(
  supabase: SupabaseClient,
  id: string,
  body: Body,
  channels: string[],
): Promise<string | null> {
  if (channels.length) {
    const rows = channels.map((channel_id, i) => ({
      post_id: id,
      channel_id,
      content: body.variants?.[channel_id]?.content?.trim() || null,
      first_comment: body.variants?.[channel_id]?.first_comment?.trim() || null,
      position: i,
    }));
    const { error } = await supabase.from('social_post_variants').insert(rows);
    if (error) return error.message;
  }

  if (body.tag_ids?.length) {
    const { error } = await supabase.from('social_post_tags')
      .insert(body.tag_ids.map((tag_id) => ({ post_id: id, tag_id })));
    if (error) return error.message;
  }

  if (body.media?.length) {
    const { error } = await supabase.from('social_media').insert(
      body.media.map((m, i) => ({
        post_id: id, file_id: m.file_id, alt_text: m.alt_text ?? null, position: i,
      })),
    );
    if (error) return error.message;
  }

  return null;
}

/**
 * The planner's own read.
 *
 * The page reads on the server for the first draw. This is for the
 * refresh after a write, so the board does not have to guess what the
 * trigger did to `platform`, `board_column_id` and `scheduled_date`.
 */
export async function GET(req: NextRequest) {
  const gate = await requireCapability('social.view');
  if (!gate.ok) return gate.response;
  const { supabase } = gate;

  const since = req.nextUrl.searchParams.get('since');
  let q = supabase.from('social_posts').select('*').is('deleted_at', null);
  if (since) q = q.gte('updated_at', since);

  const { data, error } = await q.order('updated_at', { ascending: false }).limit(500);
  if (error) {
    return NextResponse.json({ ok: false, error: 'query_failed', message: error.message }, { status: 400 });
  }

  /* ---- The channels, and the tags, with them ----

     From the business, having sent a post for approval with three
     channels on it:

       They now show nothing when i click them on the List tab and say
       no preview as no socials selected

     The channels were on the post. They were written by the create
     route, and `content_submit` refuses a post with no channels, so the
     submission itself proves they existed. What did not exist was any
     way for the screen to find out: the planner read the variants once,
     when the page was rendered on the server, and nothing ever read
     them again. A post created after that moment had no channels as far
     as the screen was concerned, for the rest of the session.

     So the refresh returns all three things a post is made of, and the
     screen replaces all three. One request, because two would let the
     posts and their channels arrive a moment apart and draw a post with
     nobody to send it to in between. */
  const [{ data: variants }, { data: postTags }] = await Promise.all([
    supabase.from('social_post_variants').select('*').order('position'),
    supabase.from('social_post_tags').select('post_id, tag_id'),
  ]);

  return NextResponse.json({
    ok: true,
    posts: data ?? [],
    variants: variants ?? [],
    postTags: postTags ?? [],
  });
}
