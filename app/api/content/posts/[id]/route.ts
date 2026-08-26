import { NextRequest, NextResponse } from 'next/server';
import { requireCapability } from '@/lib/api/guard';
import { copyGate } from '@/lib/platform/compliance/copy-lint';
import { createServiceRoleClient } from '@/lib/supabase/server';

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

   ---- The compliance check runs here ----

   `copyGate` knows about Regulation FD, the predecessor chain name and
   US spelling. That belongs in TypeScript, not a trigger. So the words
   are checked as they are saved and the verdict is recorded against a
   hash of them, which means editing invalidates the verdict rather than
   leaving a stale green tick on changed copy.

   The verdict is written with the service role because
   `content_record_lint` refuses anything else. A verdict a browser
   could write is a verdict that always says clean.
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

  const post = data as { content: string; first_comment: string | null; caption: string | null };
  const lint = await recordLint(params.id, post);
  return NextResponse.json({ ok: true, post: { ...data, ...lint } });
}

/**
 * Check the words and record what was found.
 *
 * Everything a channel would receive, joined the same way
 * `content_lint_subject` joins it, so the hash the database computes is
 * about the same text this checked.
 */
async function recordLint(
  id: string,
  post: { content: string; first_comment: string | null; caption: string | null },
) {
  const text = [post.content ?? '', post.first_comment ?? '', post.caption ?? ''].join('\n');
  const verdict = copyGate(text, 'outbound');
  const findings = [...verdict.blocking, ...verdict.advisory];
  const severity = verdict.blocking.length ? 'blocking'
    : verdict.advisory.length ? 'advisory' : 'clean';

  try {
    const admin = createServiceRoleClient();
    const { data } = await admin.rpc('content_record_lint', {
      p_post: id,
      p_severity: severity,
      p_findings: findings,
    });
    if (data) return data as Record<string, unknown>;
  } catch {
    /* A deployment with no service role key still saves the post. The
       verdict is missing rather than wrong, and the composer shows the
       findings it computed itself either way. */
  }
  return { lint_severity: severity, lint_findings: findings };
}

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
