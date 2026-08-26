import { NextRequest, NextResponse } from 'next/server';
import { requireCapability } from '@/lib/api/guard';

export const dynamic = 'force-dynamic';

/* =============================================================
   The bell.

   ---- Why a route rather than reading the table from the browser ----

   Row level security already scopes `notifications` to whoever is
   asking, so a client side select would return the right rows. What it
   would not do is the other three things opening the bell has to do:

     run the sweep      the reminders nobody's row change can produce
     apply "live"       due, not expired, not dismissed, four conditions
     keep one answer    so the count on the bell and the list under it
                        cannot disagree

   That last one is the reason. Two places computing "unread" is two
   places that will drift, and the first symptom is a red dot over an
   empty list, which teaches people the bell lies.

   ---- What it does not do ----

   It never writes a notification. Nothing outside `notify` does, and
   `notify` is SECURITY DEFINER in the database precisely so that a
   browser holding the public key cannot post itself a message saying
   its role changed.
   ============================================================= */

/** GET: the feed, the counts, and a sweep if one is due. */
export async function GET(req: NextRequest) {
  const gate = await requireCapability();
  if (!gate.ok) return gate.response;
  const { supabase } = gate;

  const url = new URL(req.url);
  const audience = url.searchParams.get('audience') ?? 'personal';
  const unread = url.searchParams.get('unread') === 'true';
  const limit = Number(url.searchParams.get('limit') ?? 50);

  if (!['personal', 'team', 'all'].includes(audience)) {
    return NextResponse.json(
      { ok: false, error: 'bad_request', message: 'Ask for personal, team or all.' },
      { status: 400 },
    );
  }

  /* Opening sweeps and counts in one call. It returns -1 for the sweep
     when another one ran in the last few minutes, which is the normal
     case and is not a failure. */
  const [{ data: counts, error: countErr }, { data: rows, error: feedErr }] = await Promise.all([
    supabase.rpc('notification_open'),
    supabase.rpc('notification_feed', {
      p_audience: audience,
      p_unread: unread,
      p_limit: Number.isFinite(limit) ? limit : 50,
    }),
  ]);

  if (countErr && isMissing(countErr)) {
    /* The migration is not applied yet. Say so plainly rather than
       showing a bell that is empty for a reason nobody can see. */
    return NextResponse.json({
      ok: true, provisioned: false,
      counts: { personal: 0, team: 0, waiting: 0 }, items: [],
      needs: 'migration 065 and 066',
    });
  }

  if (feedErr) {
    return NextResponse.json(
      { ok: false, error: 'read_failed', message: feedErr.message },
      { status: 400 },
    );
  }

  return NextResponse.json({
    ok: true,
    provisioned: true,
    counts: counts ?? { personal: 0, team: 0, waiting: 0 },
    items: rows ?? [],
  });
}

/**
 * POST: doing something with one.
 *
 * Read, dismiss and act are three different things and all three are
 * here, because they are three verbs on one noun rather than three
 * resources.
 */
export async function POST(req: NextRequest) {
  const gate = await requireCapability();
  if (!gate.ok) return gate.response;
  const { supabase } = gate;

  const body = await req.json().catch(() => ({})) as {
    do?: string; ids?: string[]; id?: string; audience?: string; what?: string;
  };

  const ids = Array.isArray(body.ids)
    ? body.ids.filter((v): v is string => typeof v === 'string')
    : body.id ? [body.id] : [];

  switch (body.do) {
    case 'read': {
      if (ids.length === 0) return bad('Nothing to mark read.');
      const { data, error } = await supabase.rpc('notification_read', { p_ids: ids });
      return error ? fail(error.message) : NextResponse.json({ ok: true, changed: data });
    }

    case 'read_all': {
      const audience = body.audience ?? 'personal';
      const { data, error } = await supabase.rpc('notification_read_all', { p_audience: audience });
      return error ? fail(error.message) : NextResponse.json({ ok: true, changed: data });
    }

    case 'dismiss': {
      if (ids.length === 0) return bad('Nothing to dismiss.');
      const { data, error } = await supabase.rpc('notification_dismiss', { p_ids: ids });
      return error ? fail(error.message) : NextResponse.json({ ok: true, changed: data });
    }

    case 'acted': {
      if (ids.length !== 1) return bad('One at a time.');
      if (!body.what) return bad('Say what was done.');
      const { data, error } = await supabase.rpc('notification_acted', {
        p_id: ids[0], p_what: body.what,
      });
      return error ? fail(error.message) : NextResponse.json({ ok: true, changed: data });
    }

    default:
      return bad('Say what to do: read, read_all, dismiss or acted.');
  }
}

function bad(message: string) {
  return NextResponse.json({ ok: false, error: 'bad_request', message }, { status: 400 });
}

function fail(message: string) {
  return NextResponse.json({ ok: false, error: 'write_failed', message }, { status: 400 });
}

function isMissing(error: { code?: string; message?: string }): boolean {
  return error.code === '42883' || error.code === 'PGRST202'
    || (error.message ?? '').includes('does not exist');
}
