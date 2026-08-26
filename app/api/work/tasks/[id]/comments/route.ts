import { NextRequest, NextResponse } from 'next/server';
import { requireCapability } from '@/lib/api/guard';

export const dynamic = 'force-dynamic';

/* =============================================================
   What was said about a piece of work.

   The reason this is worth having in the product rather than in a group
   chat: the reason a date moved, or why something was blocked for nine
   days, is the first thing anybody asks and the last thing anybody can
   find. Kept on the task, it is still there when the person who wrote
   it has left.

   Reach is `can_reach_task_id`, the same function every other policy
   asks, so a comment can never be more visible than the work it is on.
   ============================================================= */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const gate = await requireCapability('work.view');
  if (!gate.ok) return gate.response;

  const { data, error } = await gate.supabase
    .from('task_comments')
    .select('id, task_id, author_id, body, reply_to, mentions, created_at, edited_at')
    .eq('task_id', params.id)
    .is('deleted_at', null)
    .order('created_at', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data ?? []);
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const gate = await requireCapability('work.view');
  if (!gate.ok) return gate.response;

  const b = await req.json().catch(() => ({}));
  const body = String(b.body ?? '').trim();
  if (!body) return NextResponse.json({ error: 'Write something first.' }, { status: 400 });
  if (body.length > 10_000) {
    return NextResponse.json({ error: 'That is longer than a note should be.' }, { status: 400 });
  }

  const { data, error } = await gate.supabase
    .from('task_comments')
    .insert({
      task_id: params.id,
      author_id: gate.user.id,
      body,
      /* A reply, so a long thread reads as a conversation rather than a
         flat list. Null is a note on the task itself. */
      reply_to: b.reply_to || null,
    })
    .select('id, task_id, author_id, body, reply_to, mentions, created_at, edited_at')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data);
}
