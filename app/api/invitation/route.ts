import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

/* =============================================================
   A guest answering, with no account and no session.

   ---- Why this is not behind the guard every other route uses ----

   Because there is nobody to guard. Somebody following a link out of
   their inbox has never signed in here and never will. The token in the
   link is the whole of what says who they are, and `calendar_guest_answer`
   in migration 062 is what checks it.

   That function is SECURITY DEFINER, granted to `anon`, and it reads
   the guest by token and nothing else. It cannot be talked into
   answering a different invitation, and there is no table grant behind
   it to walk through: `anon` has SELECT on nothing.

   The anonymous key is used deliberately rather than the service role
   one. A route that holds the service role key and takes a token from
   the internet is a route where one mistake is the whole database.
   ============================================================= */

function anonymous() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false } },
  );
}

/** A token is 64 hex characters. Anything else is not worth a round trip. */
function readToken(v: string | null): string | null {
  return v && /^[0-9a-f]{64}$/.test(v) ? v : null;
}

export async function GET(req: NextRequest) {
  const token = readToken(req.nextUrl.searchParams.get('token'));
  if (!token) return NextResponse.json({ ok: false, why: 'not_found' }, { status: 404 });

  const { data, error } = await anonymous().rpc('calendar_guest_view', { p_token: token });
  if (error) return NextResponse.json({ ok: false, why: 'not_found' }, { status: 404 });
  return NextResponse.json(data);
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const token = readToken(typeof body.token === 'string' ? body.token : null);
  const action = String(body.action ?? '');

  if (!token) return NextResponse.json({ ok: false, why: 'not_found' }, { status: 404 });
  if (!['accept', 'decline', 'propose'].includes(action)) {
    return NextResponse.json(
      { ok: false, message: 'You can accept, say you cannot make it, or suggest another time.' },
      { status: 400 },
    );
  }

  const { data, error } = await anonymous().rpc('calendar_guest_answer', {
    p_token: token,
    p_action: action,
    p_start: typeof body.startAt === 'string' && body.startAt
      ? new Date(body.startAt).toISOString() : null,
    p_end: null,
    p_note: typeof body.note === 'string' ? body.note.trim().slice(0, 600) : null,
  });

  if (error) {
    return NextResponse.json(
      { ok: false, message: error.message.replace(/^ERROR:\s*/, '') },
      { status: 400 },
    );
  }
  return NextResponse.json(data);
}
