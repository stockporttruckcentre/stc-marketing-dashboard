import { NextRequest, NextResponse } from 'next/server';
import { requireCapability } from '@/lib/api/guard';
import type { CrmCapability } from '@/lib/crm/permissions';

export const dynamic = 'force-dynamic';

/* =============================================================
   Moving a post through the workflow.

   One route rather than six, because every transition has the same
   shape: name the move, pass a note, get the post back. Six routes
   would be six places to forget the capability check.

   The capability is chosen here AND asked for again in the database.
   That is not redundancy for its own sake. This one produces the
   sentence a person reads when they are refused, which a database
   exception cannot: `command_may` answers a question, it does not know
   who to ask for access. The one in the database is the one that
   actually stops anything, and it holds whatever this file does.
   ============================================================= */

type Move = 'submit' | 'approve' | 'reject' | 'schedule' | 'unschedule' | 'publish';

const NEEDS: Record<Move, CrmCapability> = {
  submit:     'social.draft',
  approve:    'social.approve',
  reject:     'social.approve',
  schedule:   'social.schedule',
  unschedule: 'social.schedule',
  publish:    'social.publishNow',
};

const CALLS: Record<Move, string> = {
  submit:     'content_submit',
  approve:    'content_approve',
  reject:     'content_reject',
  schedule:   'content_schedule',
  unschedule: 'content_unschedule',
  publish:    'content_publish_now',
};

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => ({})) as {
    move?: Move; note?: string; at?: string | null;
  };
  const move = body.move;

  if (!move || !(move in NEEDS)) {
    return NextResponse.json(
      { ok: false, error: 'bad_request', message: 'Which move? One of submit, approve, reject, schedule, unschedule or publish.' },
      { status: 400 },
    );
  }

  const gate = await requireCapability(NEEDS[move]);
  if (!gate.ok) return gate.response;
  const { supabase } = gate;

  const args: Record<string, unknown> = { p_post: params.id };
  if (move === 'submit' || move === 'approve') args.p_note = body.note?.trim() || null;
  if (move === 'reject') args.p_note = body.note?.trim() ?? '';
  if (move === 'schedule') args.p_at = body.at ?? null;

  const { data, error } = await supabase.rpc(CALLS[move], args);

  if (error) {
    /* The database's own words. They are written to be read by the
       person who hit them: "you wrote this, so somebody else has to
       approve it" beats "permission denied", and rewriting them here
       would mean two places to keep in step. */
    return NextResponse.json(
      { ok: false, error: 'refused', message: error.message.replace(/^ERROR:\s*/, '') },
      { status: 400 },
    );
  }
  return NextResponse.json({ ok: true, post: data });
}

/** The timeline for one post. Buffer calls this Activity. */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const gate = await requireCapability('social.view');
  if (!gate.ok) return gate.response;
  const { supabase } = gate;

  const { data, error } = await supabase
    .from('activity')
    .select('id, at, actor_id, actor_label, verb, subject_type, subject_id, subject_label, summary, metadata, is_system')
    .eq('subject_type', 'social_post')
    .eq('subject_id', params.id)
    .order('at', { ascending: false })
    .limit(100);

  if (error) {
    return NextResponse.json({ ok: false, error: 'query_failed', message: error.message }, { status: 400 });
  }
  return NextResponse.json({ ok: true, activity: data ?? [] });
}
