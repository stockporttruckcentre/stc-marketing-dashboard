import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { capabilitiesFor, type CrmCapabilities, type CrmCapability } from '@/lib/crm/permissions';
import type { UserRole } from '@/lib/types';

/* =============================================================
   The check every write route was missing.

   `lib/crm/permissions.ts` has said what each role may do since the
   permission model went in. The command bar filters on it, and
   /api/command/edit checks it per field. Almost nothing else did.

   The comment left in mark-sold explains how that happened: "RLS handles
   ownership". For the rows a person owns, it does. What row level
   security cannot express is "a viewer may not create stock", because
   that is a statement about a role, not about a row. A viewer inserting
   a brand new trailer breaks no row policy: the row is theirs, they just
   should never have been able to make it.

   So this is the missing half, in one place so it reads the same
   everywhere and so a new route has an obvious thing to call.

     const gate = await requireCapability('stock.edit');
     if (!gate.ok) return gate.response;
     const { supabase, user, caps } = gate;

   Interface gating in the bar is a courtesy. This is the part that
   actually stops anything.
   ============================================================= */

export type Gate =
  | { ok: true; supabase: ReturnType<typeof createClient>; user: { id: string; email?: string };
      role: UserRole; caps: CrmCapabilities; fullName: string }
  | { ok: false; response: NextResponse };

/**
 * Signed in, and allowed to do this.
 *
 * Pass no capability to check only that somebody is signed in, which is
 * right for a read that RLS already scopes.
 */
export async function requireCapability(capability?: CrmCapability): Promise<Gate> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return {
      ok: false,
      response: NextResponse.json(
        { ok: false, error: 'unauthorized', message: 'Sign in first.' },
        { status: 401 },
      ),
    };
  }

  const { data: profile } = await supabase
    .from('profiles').select('role, full_name').eq('id', user.id).single();

  /* No profile row means no role, and no role means the least access
     rather than the most. The dashboard layout makes the same choice. */
  const role = ((profile as { role?: UserRole } | null)?.role ?? 'viewer') as UserRole;
  const fullName = (profile as { full_name?: string } | null)?.full_name
    ?? user.email?.split('@')[0] ?? 'Somebody';
  const caps = capabilitiesFor({ role });

  if (capability && !caps.has(capability)) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          ok: false,
          error: 'forbidden',
          message: DENIALS[capability] ?? 'You do not have access to do that.',
        },
        { status: 403 },
      ),
    };
  }

  return { ok: true, supabase, user: { id: user.id, email: user.email }, role, caps, fullName };
}

/**
 * What to say when it is refused.
 *
 * Named per capability rather than one generic sentence, because "you do
 * not have access" tells somebody nothing about who to ask. These say
 * what the missing permission is for.
 */
const DENIALS: Partial<Record<CrmCapability, string>> = {
  'crm.create': 'You can look at the CRM but not add to it. An administrator can change that.',
  'crm.edit': 'Your access is read only, so this record cannot be changed.',
  'crm.delete': 'Deleting records needs more access than you have.',
  'crm.assign': 'Only somebody who can assign accounts may change the owner.',
  'crm.manageLists': 'Making and sharing lists needs more access than you have.',
  'crm.proposal': 'Raising a proposal needs sales access.',
  'crm.proposalForOthers': 'Raising a proposal in somebody else’s name is a manager’s job.',
  'crm.delegate': 'Booking into a diary needs more access than you have.',
  'crm.enrich': 'Lusha searching is switched off until it is agreed who can spend the credits.',
  'crm.import': 'Importing a spreadsheet needs more access than you have.',
  'crm.export': 'Exporting needs more access than you have.',
  'admin.users': 'Only an administrator can do that.',
  'stock.edit': 'Changing the stock list needs more access than you have.',
  'marketing.edit': 'Changing marketing content needs more access than you have.',
  'marketing.approve': 'Approving content needs more access than you have.',
};

/** For the routes that only need to know somebody is signed in. */
export async function requireUser(): Promise<Gate> {
  return requireCapability();
}
