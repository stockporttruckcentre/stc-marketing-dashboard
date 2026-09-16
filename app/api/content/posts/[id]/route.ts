import { NextRequest, NextResponse } from 'next/server';
import { requireCapability } from '@/lib/api/guard';

export const dynamic = 'force-dynamic';

/* =============================================================
   Editing a post, and deleting one.

   ---- The allowlist ----

   `WRITABLE` is what a request may name. Anything else is dropped
   silently rather than refused, because a request carrying a column
   this route does not write is usually a stale client rather than an
   attack, and a 400 would make an old tab unusable.

   `status` is deliberately absent, and it is the point of the list.
   Migration 050 closed the column, and the transition routes are the
   only way it moves.

   ---- What used to run here, and why it does not ----

   A "compliance check" ran on every save and recorded a verdict against
   the words. It was not STC's. From the business, looking at a social
   post:

     why does one of my social post pages say "US English. STC and Frame
     use American spelling throughout." Why has frame made it through to
     this app? that's dangerous

   Correct on both counts. The rules were another company's: a
   blockchain's name, a share ticker, "the protocol", transactions per
   second, token prices, and a US spelling rule that would have told
   the marketing team to write Stockport Truck Center and to bill for
   labor. It cited `docs/source/STC_CONTEXT.md`, which does not exist in
   this repository and never has.

   It is gone. Nothing lints a post on the way past. The verdict columns
   are left on the table because they hold rows somebody may want to
   read, and the screens still draw a finding if one is ever there, so a
   policy STC actually writes has somewhere to go.
   ============================================================= */

const WRITABLE = {
  content: 'content',
  caption: 'caption',
  first_comment: 'first_comment',
  hashtags: 'hashtags',
  scheduled_at: 'scheduled_at',
  campaign_id: 'campaign_id',
  link_url: 'link_url',
  utm_source: 'utm_source',
  utm_medium: 'utm_medium',
  utm_campaign: 'utm_campaign',
  utm_content: 'utm_content',
  internal_note: 'internal_note',
  image_url: 'image_url',
  board_position: 'board_position',
} as const;

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const gate = await requireCapability('social.draft');
  if (!gate.ok) return gate.response;
  const { supabase } = gate;

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const patch: Record<string, unknown> = {};
  for (const key of Object.keys(WRITABLE) as (keyof typeof WRITABLE)[]) {
    if (key in body) patch[WRITABLE[key]] = body[key];
  }

  if ('status' in body) {
    return NextResponse.json(
      {
        ok: false,
        error: 'bad_request',
        message: 'A post’s status moves by submitting, approving, scheduling or publishing it, not by being written.',
      },
      { status: 400 },
    );
  }
  if (!Object.keys(patch).length) {
    return NextResponse.json({ ok: false, error: 'bad_request', message: 'Nothing to change.' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('social_posts').update(patch).eq('id', params.id).select('*').single();

  if (error) {
    return NextResponse.json({ ok: false, error: 'update_failed', message: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true, post: data });
}

/**
 * Check the words and record what was found.
 *
 * Everything a channel would receive, joined the same way
 * `content_lint_subject` joins it, so the hash the database computes is
 * about the same text this checked.
 */
/**
 * Delete.
 *
 * Soft, through the shared function, so it lands in the audit trail and
 * can be restored. A published post keeps its record whatever happens
 * to the draft: it went out, and nothing here can unsend it.
 */
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const gate = await requireCapability('social.delete');
  if (!gate.ok) return gate.response;
  const { supabase } = gate;

  const { error } = await supabase.rpc('soft_delete', {
    p_table: 'social_posts',
    p_id: params.id,
    p_reason: 'Deleted from Content.',
  });

  if (error) {
    return NextResponse.json({ ok: false, error: 'delete_failed', message: error.message }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
