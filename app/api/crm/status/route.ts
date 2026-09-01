import { NextRequest, NextResponse } from 'next/server';
import { requireCapability } from '@/lib/api/guard';

export const dynamic = 'force-dynamic';

/* =============================================================
   Setting the status on several accounts at once.

   ---- The thing that makes this less simple than it looks ----

   An account's status is not always its own. Migration 043 made a
   company's status derive from its leads, because that is how the
   business described it working:

     the moment you open a new lead on the tracker for a company in the
     CRM its status dynamically changes based on the reason for the lead
     and also the status of the lead

   A trigger on `crm_leads` rewrites `crm_contacts.status` whenever a
   lead moves. So writing the column directly on an account that has
   leads produces a value that is wrong the moment anybody touches one
   of those deals, and wrong in the worst way: it looks like it worked.

   ---- What this does about it ----

   It splits the selection.

   An account with no leads owns its own status. Nobody has pitched to
   them yet, the column is not derived from anything, and setting it is
   exactly what somebody means. Those are written.

   An account with leads is left alone, and the response names them and
   says why, so the screen can tell somebody rather than quietly doing
   four out of six. Their status is a reading of their deals, and the
   place to change it is the deal.

   Silently moving every lead on an account to match would be the other
   option and it is worse: an account with three open quotes would have
   all three forced to won by a click on a grid, which is not what
   anybody meant by "set these to won".
   ============================================================= */

/* The six the column allows. Restated here rather than imported from
   the grid, because this is the boundary: a value arriving from a
   browser is a value somebody could have typed. */
const STATUSES = ['lead', 'contacted', 'quoted', 'won', 'customer', 'lost'] as const;
type Status = typeof STATUSES[number];

export async function POST(req: NextRequest) {
  const gate = await requireCapability('crm.edit');
  if (!gate.ok) return gate.response;
  const { supabase } = gate;

  const body = await req.json().catch(() => ({})) as { ids?: unknown; status?: unknown };

  const ids = Array.isArray(body.ids)
    ? body.ids.filter((v): v is string => typeof v === 'string')
    : [];
  const status = body.status as Status;

  if (ids.length === 0) {
    return bad('Nothing was selected.');
  }
  if (!STATUSES.includes(status)) {
    return bad(`That is not a status. It is one of: ${STATUSES.join(', ')}.`);
  }
  if (ids.length > 500) {
    return bad('That is more than 500 at once. Narrow the selection.');
  }

  /* Which of them have leads, in one query rather than one per row. */
  const { data: withLeads, error: leadErr } = await supabase
    .from('crm_leads')
    .select('contact_id')
    .in('contact_id', ids);

  if (leadErr) {
    return NextResponse.json(
      { ok: false, error: 'read_failed', message: leadErr.message }, { status: 400 },
    );
  }

  const derived = new Set((withLeads ?? []).map((l) => l.contact_id as string));
  const direct = ids.filter((id) => !derived.has(id));

  let changed = 0;
  if (direct.length > 0) {
    const { data, error } = await supabase
      .from('crm_contacts')
      .update({ status, last_activity_at: new Date().toISOString() })
      .in('id', direct)
      /* Row level security decides which of these the caller may
         actually touch, and the count comes back from what was really
         written rather than from what was asked for. Reporting the
         asked for number would tell somebody six changed when their
         policy allowed four. */
      .select('id');

    if (error) {
      return NextResponse.json(
        { ok: false, error: 'write_failed', message: error.message }, { status: 400 },
      );
    }
    changed = data?.length ?? 0;
  }

  /* Named, not just counted. "2 were left alone" sends somebody
     hunting; "Dawson Group and Stobart were left alone" does not. */
  let skipped: string[] = [];
  if (derived.size > 0) {
    const { data } = await supabase
      .from('crm_contacts')
      .select('company_name')
      .in('id', [...derived])
      .limit(25);
    skipped = (data ?? []).map((c) => c.company_name as string).filter(Boolean);
  }

  return NextResponse.json({
    ok: true,
    status,
    changed,
    /* Asked for but not written, whether because their status is
       derived or because a policy refused the row. */
    untouched: ids.length - changed,
    derivedCount: derived.size,
    derivedNames: skipped,
  });
}

function bad(message: string) {
  return NextResponse.json({ ok: false, error: 'bad_request', message }, { status: 400 });
}
