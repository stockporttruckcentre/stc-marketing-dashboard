import { NextRequest, NextResponse } from 'next/server';
import { requireCapability } from '@/lib/api/guard';
import { ukToday } from '@/lib/format/date';

export const dynamic = 'force-dynamic';

/**
 * "Remind me in a week."
 *
 * Writes to dashboard_actions when that table exists, so the reminder
 * turns up in the dashboard's action queue. Until the migration is run it
 * falls back to stamping last_contact, which at least keeps the record
 * out of the "gone quiet" list for the right length of time.
 */
export async function POST(req: NextRequest) {
  /* On its fallback path this stamps last_contact on any contact id it is
     handed, so it is an edit whichever branch it takes. */
  const gate = await requireCapability('crm.edit');
  if (!gate.ok) return gate.response;
  const { supabase, user } = gate;

  const { contact_id, due_at } = await req.json().catch(() => ({})) as { contact_id?: string; due_at?: string };
  if (!contact_id) return NextResponse.json({ error: 'contact_id required' }, { status: 400 });

  const { data: contact } = await supabase
    .from('crm_contacts').select('company_name').eq('id', contact_id).single();
  const name = (contact as any)?.company_name ?? 'this customer';

  const { error } = await supabase.from('dashboard_actions').insert({
    user_id: user.id,
    contact_id,
    type: 'quote_followup',
    title: `Follow up ${name}`,
    due_at: due_at ?? null,
    created_by: user.id,
  });

  if (error) {
    await supabase.from('crm_contacts')
      .update({ last_contact: ukToday() })
      .eq('id', contact_id);
    return NextResponse.json({
      ok: true, queued: false,
      note: 'Recorded against the contact. Run the dashboard migration for a real reminder queue.',
    });
  }
  return NextResponse.json({ ok: true, queued: true });
}
