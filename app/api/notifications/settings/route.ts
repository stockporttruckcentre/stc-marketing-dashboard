import { NextRequest, NextResponse } from 'next/server';
import { requireCapability } from '@/lib/api/guard';

export const dynamic = 'force-dynamic';

/* =============================================================
   What somebody wants to hear about.

   Every toggle on the settings screen comes from
   `notification_choices`, which is the catalogue joined to this
   person's preferences and filtered by what they can actually do. So
   the screen has no list of its own: a kind added to the catalogue
   appears here, and a kind that needs a capability they do not hold
   never does.

   Writes go through `notification_choose`, which refuses the ones that
   cannot be turned off rather than letting a row be written that
   `notify` would then ignore. A setting that appears to save and does
   nothing is worse than one that says no.
   ============================================================= */

export async function GET() {
  const gate = await requireCapability();
  if (!gate.ok) return gate.response;
  const { supabase, user } = gate;

  const [{ data: choices, error }, { data: settings }] = await Promise.all([
    supabase.rpc('notification_choices'),
    supabase.from('notification_settings').select('*').eq('user_id', user.id).maybeSingle(),
  ]);

  if (error && isMissing(error)) {
    return NextResponse.json({
      ok: true, provisioned: false, choices: [], settings: null,
      needs: 'migration 065',
    });
  }
  if (error) {
    return NextResponse.json(
      { ok: false, error: 'read_failed', message: error.message }, { status: 400 },
    );
  }

  return NextResponse.json({
    ok: true,
    provisioned: true,
    choices: choices ?? [],
    /* No row is the normal state for somebody who has never changed
       anything, so the defaults are stated here rather than leaving the
       screen to invent them. */
    settings: settings ?? {
      muted_until: null, quiet_from: 0, quiet_to: 0, bundle_minutes: 10,
    },
  });
}

export async function POST(req: NextRequest) {
  const gate = await requireCapability();
  if (!gate.ok) return gate.response;
  const { supabase } = gate;

  const body = await req.json().catch(() => ({})) as {
    do?: string;
    kind?: string; category?: string; enabled?: boolean;
    quietFrom?: number; quietTo?: number; bundleMinutes?: number;
    muteHours?: number;
  };

  switch (body.do) {
    case 'kind': {
      if (!body.kind || typeof body.enabled !== 'boolean') {
        return bad('Say which one and whether it is on.');
      }
      const { error } = await supabase.rpc('notification_choose', {
        p_kind: body.kind, p_enabled: body.enabled,
      });
      return error ? fail(error.message) : NextResponse.json({ ok: true });
    }

    case 'category': {
      if (!body.category || typeof body.enabled !== 'boolean') {
        return bad('Say which group and whether it is on.');
      }
      const { data, error } = await supabase.rpc('notification_choose_category', {
        p_category: body.category, p_enabled: body.enabled,
      });
      return error ? fail(error.message) : NextResponse.json({ ok: true, changed: data });
    }

    case 'settings': {
      const { data, error } = await supabase.rpc('notification_settings_set', {
        p_quiet_from: clampHour(body.quietFrom),
        p_quiet_to: clampHour(body.quietTo),
        p_bundle: clampBundle(body.bundleMinutes),
        p_muted_until: null,
        p_clear_mute: false,
      });
      return error ? fail(error.message) : NextResponse.json({ ok: true, settings: data });
    }

    case 'mute': {
      /* Hours rather than a timestamp, so the browser's clock cannot
         set a mute that outlives the week. */
      const hours = Number(body.muteHours);
      const until = Number.isFinite(hours) && hours > 0
        ? new Date(Date.now() + Math.min(hours, 24 * 14) * 3600_000).toISOString()
        : null;

      const { data, error } = await supabase.rpc('notification_settings_set', {
        p_quiet_from: null, p_quiet_to: null, p_bundle: null,
        p_muted_until: until,
        p_clear_mute: until === null,
      });
      return error ? fail(error.message) : NextResponse.json({ ok: true, settings: data });
    }

    default:
      return bad('Say what to set: kind, category, settings or mute.');
  }
}

function clampHour(v: unknown): number | null {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(23, Math.round(n)));
}

function clampBundle(v: unknown): number | null {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(240, Math.round(n)));
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
