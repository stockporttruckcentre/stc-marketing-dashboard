import { NextRequest, NextResponse } from 'next/server';
import { requireCapability } from '@/lib/api/guard';

export const dynamic = 'force-dynamic';

/* =============================================================
   Asking somebody who does not work here.

   ---- Why the link comes back through this route ----

   The token is revoked from `authenticated` at the column level in
   migration 062, so no browser can read it off the table however it
   asks. `calendar_invite_guest` is SECURITY DEFINER and returns it once,
   to the server, and this route turns it into an absolute link and
   hands that back to whoever asked the guest.

   That is the whole delivery story today, and deliberately: there is no
   outbound mail transport here, and single sign on is coming, so
   nothing builds a channel that is about to be replaced. The organiser
   copies the link into their own Outlook message. The guest's answer
   lands in the diary either way, which is the half that does not change
   when a transport arrives.
   ============================================================= */

/** Where the guest answers. Absolute, because it is leaving the building. */
function invitationLink(req: NextRequest, token: string): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '');
  const origin = configured || req.nextUrl.origin;
  return `${origin}/invitation/${token}`;
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const gate = await requireCapability('crm.delegate');
  if (!gate.ok) return gate.response;

  const body = await req.json().catch(() => ({}));
  const email = typeof body.email === 'string' ? body.email.trim() : '';
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 120) : '';

  /* A name is enough. Most of the time that is all there is: putting
     Wayne on a meeting so the sales team can see Wayne is in it. An
     address as well gives them a link, which is worth having on the day
     this application is reachable from outside the VPN and is a record
     of who they are until then. */
  if (!email && !name) {
    return NextResponse.json(
      { ok: false, error: 'bad_request', message: 'Give them a name, or an email address, or both.' },
      { status: 400 },
    );
  }
  if (email && !/^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(email)) {
    return NextResponse.json(
      { ok: false, error: 'bad_request', message: 'That is not an email address.' },
      { status: 400 },
    );
  }

  const { data, error } = await gate.supabase.rpc('calendar_invite_guest', {
    p_event: params.id,
    p_email: email,
    p_name: name,
    p_contact: typeof body.contact_id === 'string' ? body.contact_id : null,
    p_note: typeof body.note === 'string' ? body.note.trim().slice(0, 600) : null,
  });

  if (error) {
    return NextResponse.json(
      { ok: false, error: 'refused', message: error.message.replace(/^ERROR:\s*/, '') },
      { status: 400 },
    );
  }

  const guest = data as { id: string; token: string; email: string | null; name: string };
  const who = guest.name || guest.email || 'They';

  /* The link only comes back where there is somewhere to send it. A
     name on a meeting has nothing to answer and offering a link for one
     would be offering something with no use. */
  return NextResponse.json({
    ok: true,
    guest: { id: guest.id, email: guest.email, name: guest.name },
    ...(guest.email ? { link: invitationLink(req, guest.token) } : {}),
    message: guest.email
      ? `${who} is on the meeting. The link lets them answer, if they can reach this application.`
      : `${who} is on the meeting. Everybody who can see it can see them.`,
  });
}

/* Taking one back. The row goes and the link stops working, which is
   the same thing said twice on purpose: a withdrawn invitation that
   still opens is not withdrawn. */
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const gate = await requireCapability('crm.delegate');
  if (!gate.ok) return gate.response;

  const guestId = req.nextUrl.searchParams.get('guest');
  if (!guestId) {
    return NextResponse.json(
      { ok: false, error: 'bad_request', message: 'Which guest?' },
      { status: 400 },
    );
  }

  const { error } = await gate.supabase.rpc('calendar_withdraw_guest', { p_guest: guestId });
  if (error) {
    return NextResponse.json(
      { ok: false, error: 'refused', message: error.message.replace(/^ERROR:\s*/, '') },
      { status: 400 },
    );
  }
  return NextResponse.json({ ok: true, message: 'They are off the meeting, and their link no longer opens.' });
}
