import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { VIEW_AS_COOKIE } from '@/lib/platform/permissions/view-as';

/* =============================================================
   Turning "view as" on and off.

   POST { userId }   draw the interface for that person
   DELETE            go back to being yourself

   `admin.users` is asked of the database on both, and asked again on
   every page load in `viewingAs`. Checking once and trusting a cookie
   afterwards is how a permission that has been taken away goes on
   working, and this is the one feature where that would matter most.
   ============================================================= */

export const dynamic = 'force-dynamic';

async function mayViewAs() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, why: 'Not signed in.', status: 401 };

  const { data: mayManage } = await supabase.rpc('command_may', { p_capability: 'admin.users' });
  if (mayManage !== true) {
    return { ok: false as const, why: 'Viewing as somebody else needs Manage users.', status: 403 };
  }
  return { ok: true as const, supabase, user };
}

export async function POST(request: Request) {
  const gate = await mayViewAs();
  if (!gate.ok) return NextResponse.json({ error: gate.why }, { status: gate.status });

  const body = await request.json().catch(() => ({})) as { userId?: string };
  const userId = String(body.userId ?? '').trim();
  if (!userId) return NextResponse.json({ error: 'No user named.' }, { status: 400 });

  if (userId === gate.user.id) {
    return NextResponse.json({ error: 'That is you already.' }, { status: 400 });
  }

  /* It has to be somebody who exists, or the banner names nobody and
     the interface is drawn from an empty capability set, which looks
     exactly like a broken account rather than a mistyped id. */
  const { data: them } = await gate.supabase
    .from('profiles').select('id, full_name').eq('id', userId).maybeSingle();
  if (!them) return NextResponse.json({ error: 'No such person.' }, { status: 404 });

  const res = NextResponse.json({
    ok: true,
    viewingAs: (them as { full_name?: string }).full_name ?? 'them',
  });
  res.cookies.set(VIEW_AS_COOKIE, userId, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: process.env.NODE_ENV === 'production',
    /* No maxAge on purpose. It ends with the browser session, so
       nobody comes back tomorrow still wearing somebody else's face. */
  });
  return res;
}

export async function DELETE() {
  /* Deliberately not gated. Somebody whose administrator permission was
     removed while they were viewing as another person must still be
     able to stop, and stopping is the safe direction. */
  const res = NextResponse.json({ ok: true });
  res.cookies.set(VIEW_AS_COOKIE, '', { path: '/', maxAge: 0 });
  return res;
}
