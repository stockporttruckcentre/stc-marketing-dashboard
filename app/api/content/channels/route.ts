import { NextRequest, NextResponse } from 'next/server';
import { requireCapability } from '@/lib/api/guard';

export const dynamic = 'force-dynamic';

/* =============================================================
   Connecting a channel.

   ---- What this does not do yet ----

   It does not authenticate against the network. Every one of them needs
   an app registration and several need review before they grant a
   posting scope, and none of that has happened. See the standing
   decision on anything that costs the user a ticket.

   So a channel created here is a record of an account, in the state it
   is actually in: `disconnected`. It can be planned against, scheduled
   into and reported on. It cannot publish, and `content_publish_now`
   refuses a post whose channels are all disconnected rather than
   pretending.

   That is the honest version of "never add a button that does nothing".
   The alternative, hiding Content until a credential arrives, would
   hold up everything else the screen does.
   ============================================================= */

export async function POST(req: NextRequest) {
  const gate = await requireCapability('social.channels');
  if (!gate.ok) return gate.response;
  const { supabase, user } = gate;

  const body = await req.json().catch(() => ({})) as {
    network_key?: string; handle?: string; display_name?: string;
    profile_url?: string; timezone?: string; entity_id?: string | null;
  };

  if (!body.network_key || !body.handle?.trim()) {
    return NextResponse.json(
      { ok: false, error: 'bad_request', message: 'A channel needs a network and a handle.' },
      { status: 400 },
    );
  }

  const handle = body.handle.trim().replace(/^@/, '');

  const { data, error } = await supabase
    .from('social_channels')
    .insert({
      network_key: body.network_key,
      handle,
      display_name: body.display_name?.trim() || handle,
      profile_url: body.profile_url?.trim() || null,
      timezone: body.timezone || 'Europe/London',
      entity_id: body.entity_id ?? null,
      state: 'disconnected',
      connected_by: user.id,
    })
    .select('*')
    .single();

  if (error) {
    const already = error.code === '23505';
    return NextResponse.json(
      {
        ok: false,
        error: already ? 'duplicate' : 'create_failed',
        message: already
          ? `There is already a ${body.network_key} channel for @${handle}.`
          : error.message,
      },
      { status: 400 },
    );
  }
  return NextResponse.json({ ok: true, channel: data });
}

export async function PATCH(req: NextRequest) {
  const gate = await requireCapability('social.channels');
  if (!gate.ok) return gate.response;
  const { supabase } = gate;

  const body = await req.json().catch(() => ({})) as {
    id?: string; display_name?: string; timezone?: string;
    profile_url?: string; is_active?: boolean; position?: number;
  };
  if (!body.id) {
    return NextResponse.json({ ok: false, error: 'bad_request', message: 'Which channel?' }, { status: 400 });
  }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.display_name !== undefined) patch.display_name = body.display_name.trim();
  if (body.timezone !== undefined) patch.timezone = body.timezone;
  if (body.profile_url !== undefined) patch.profile_url = body.profile_url.trim() || null;
  if (body.is_active !== undefined) patch.is_active = body.is_active;
  if (body.position !== undefined) patch.position = body.position;

  const { data, error } = await supabase
    .from('social_channels').update(patch).eq('id', body.id).select('*').single();

  if (error) {
    return NextResponse.json({ ok: false, error: 'update_failed', message: error.message }, { status: 400 });
  }
  return NextResponse.json({ ok: true, channel: data });
}
