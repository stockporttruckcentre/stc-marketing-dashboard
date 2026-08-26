import { NextRequest, NextResponse } from 'next/server';
import { requireCapability } from '@/lib/api/guard';
import { planCommand } from '@/lib/command/plan';
import { capabilitiesFor } from '@/lib/crm/permissions';
import { postgrestStore } from '@/lib/command/store/postgrest';
import { runSelect } from '@/lib/command/ir/read';
import type { Profile } from '@/lib/types';

export const dynamic = 'force-dynamic';

/* =============================================================
   Why can the stock list see a trailer that the command bar cannot?

   Both read `stock_trailers` through the same session and the same row
   level policies, so when one finds a unit and the other says "nothing
   here matches that", the difference is in the lookup, not in the
   permissions. Guessing at it from outside is what the last two rounds
   of this were, and it is slow and it is rude to somebody who can see
   the trailer on their screen.

   So this asks the database the same four questions, in the running
   application, as the person who is signed in:

     1. exactly     the value, matched as typed
     2. loosely     the value as a substring, which is what the bar does
     3. by digits   the digits alone, which is what it does now, because
                    one real yard holds STC148909 and 145602
     4. through the command bar's own planner, end to end

   And where it finds the row, it reports the stored value one character
   at a time with its code point, because a trailing space, a
   non-breaking space or a Unicode dash is invisible on a screen and
   fatal to a match. Every one of those looks exactly like a bug in the
   command bar and none of them is.

     /api/admin/diag-lookup?q=STC145505

   Read only. It runs no writes and can perform no command: the plan is
   built and the selection is read, and nothing is applied.
   ============================================================= */

/** A string with its invisible characters made visible. */
function characters(value: string) {
  return [...value].map((ch) => ({
    ch,
    code: 'U+' + ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0'),
    ordinary: /[A-Za-z0-9-]/.test(ch),
  }));
}

export async function GET(req: NextRequest) {
  /* Read only, and it reports rows from the stock list, so it is held to
     the same bar as the other diagnostics under /admin. */
  const gate = await requireCapability('admin.users');
  if (!gate.ok) return gate.response;
  const { supabase, user } = gate;

  const q = (req.nextUrl.searchParams.get('q') ?? '').trim();
  if (!q) {
    return NextResponse.json({
      error: 'Add ?q= and the stock number you are looking at, for example ?q=STC145505',
    }, { status: 400 });
  }

  const digits = q.match(/\d{3,10}/)?.[0] ?? null;
  const like = (v: string) => `%${v.replace(/[%_]/g, (m) => `\\${m}`)}%`;

  const [exact, loose, byDigits, sample] = await Promise.all([
    supabase.from('stock_trailers').select('id, stc_no, status, category, location').eq('stc_no', q),
    supabase.from('stock_trailers').select('id, stc_no, status, category, location').ilike('stc_no', like(q)),
    digits
      ? supabase.from('stock_trailers').select('id, stc_no, status, category, location').ilike('stc_no', like(digits))
      : Promise.resolve({ data: [], error: null }),
    supabase.from('stock_trailers').select('stc_no').limit(2000),
  ]);

  /* What the whole stock list looks like, since the shape of the
     numbers is the thing that decides whether a match can work. */
  const all = ((sample.data ?? []) as { stc_no: string | null }[])
    .map((r) => r.stc_no)
    .filter((v): v is string => typeof v === 'string');

  const shapes = {
    total: all.length,
    withStcPrefix: all.filter((v) => /^STC/i.test(v)).length,
    bareDigits: all.filter((v) => /^\d+$/.test(v)).length,
    demoRows: all.filter((v) => /^DEMO-/i.test(v)).length,
    withSpaces: all.filter((v) => /\s/.test(v)).length,
    somethingElse: all.filter(
      (v) => !/^STC/i.test(v) && !/^\d+$/.test(v) && !/^DEMO-/i.test(v),
    ).slice(0, 10),
  };

  /* And the same sentence the person typed, through the planner and the
     store, so the answer is the bar's own answer rather than an
     impression of it. */
  const profile = { role: (gate as { profile?: Profile }).profile?.role ?? 'admin' } as Profile;
  const caps = [...capabilitiesFor(profile)];
  const sentence = `add £1 refurb cost to ${q}`;
  let throughTheBar: unknown = null;
  try {
    const planned = planCommand(sentence, { actorCapabilities: caps });
    const step = planned?.plan.steps.find((s) => s.op === 'update' || s.op === 'select');
    const where = step && 'match' in step
      ? (step as { match?: { where?: unknown } }).match?.where
      : (step as { where?: unknown } | undefined)?.where;

    const select = step && step.op === 'update' && 'match' in step
      ? (step as { match: any }).match
      : (step as any);

    const read = select
      ? await runSelect(select, { store: postgrestStore(supabase as never) })
      : null;

    throughTheBar = {
      sentence,
      planned: !!planned,
      condition: where ?? null,
      found: read && read.ok ? read.rows.length : null,
      why: read && !read.ok ? read.why : null,
    };
  } catch (e) {
    throughTheBar = { sentence, error: e instanceof Error ? e.message : String(e) };
  }

  const hit = ((loose.data ?? []) as any[])[0] ?? ((byDigits.data ?? []) as any[])[0] ?? null;

  return NextResponse.json({
    askedFor: q,
    digitsUsed: digits,
    signedInAs: user?.email ?? null,

    matches: {
      exactly: (exact.data ?? []).length,
      asASubstring: (loose.data ?? []).length,
      byDigitsAlone: (byDigits.data ?? []).length,
    },

    /* The row itself, if anything found it, with every character named.
       A stock number that looks right on screen and will not match
       almost always has something in it that does not print. */
    row: hit
      ? {
          stc_no: hit.stc_no,
          exactly: `[${hit.stc_no}]`,
          length: String(hit.stc_no ?? '').length,
          characters: characters(String(hit.stc_no ?? '')),
          status: hit.status,
          category: hit.category,
          location: hit.location,
        }
      : null,

    throughTheBar,
    shapes,

    errors: {
      exact: exact.error?.message ?? null,
      loose: loose.error?.message ?? null,
      byDigits: (byDigits as { error?: { message?: string } }).error?.message ?? null,
      sample: sample.error?.message ?? null,
    },
  });
}
