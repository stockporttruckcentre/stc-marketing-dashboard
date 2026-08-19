/* =============================================================
   Changing what somebody is allowed to do, in one place.

   The admin screen wrote `profiles.role` straight from the browser. The
   command bar goes through `command_set_role`, which checks the
   capability, refuses to leave the company with no administrator, and
   writes an audit line. Two paths to the most dangerous write in the
   application, and the one with the safeguards was the one somebody had
   to type a sentence to reach.

   Row level security still governed the update, so nothing was open to
   an outsider. What was missing was everything else the function does:

     the capability     asked for by name, not inferred from a policy
     the last admin     an account with no administrator cannot be
                        recovered from inside the application
     the audit line     who changed whose role, and when

   Nothing here decides permission and nothing here is a second copy of
   the rule. It is the one call, and both callers make it.
   ============================================================= */
import type { UserRole } from '@/lib/types';

/** The narrowest slice of the client the change needs. */
type Rpc = {
  rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
};

export type RoleChangeOutcome =
  | { ok: true; was: UserRole; now: UserRole; who: string }
  | { ok: false; why: string };

export async function setRole(
  client: Rpc, user: string, role: UserRole,
): Promise<RoleChangeOutcome> {
  const { data, error } = await client.rpc('command_set_role', {
    p_user: user,
    p_role: role,
  });
  if (error) return { ok: false, why: String((error as { message?: string })?.message ?? error) };

  const body = (data ?? {}) as { was?: UserRole; now?: UserRole; name?: string };
  return {
    ok: true,
    was: body.was ?? role,
    now: body.now ?? role,
    who: body.name ?? '',
  };
}
