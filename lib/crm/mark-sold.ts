/* =============================================================
   Marking a deal sold.

   One business operation with three parts, and the parts are the reason
   it is an operation rather than a field write. Setting
   `crm_contacts.status = 'customer'` looks like the whole thing and is
   not: a sale raises a commission line, flips the stock unit, and tells
   every other rep chasing the same unit that it is gone.

   ALL THREE, OR NONE.

   This used to do them as three separate statements and had an explicit
   partial path: the tracker updated, the stock update failed, and it
   said so. That leaves a deal marked won against a unit still showing
   as available, which is the exact state a sale is supposed to remove,
   and it leaves somebody to work out by hand which half happened.

   So the writes are `command_mark_sold`, one plpgsql function and
   therefore one transaction. The commission arithmetic went with them,
   because a figure worked out here and written there can disagree.

   Both callers run this: the tracker route the sales list uses, and the
   command bar's `deal.markSold` capability. Two implementations of a
   sale is how one of them ends up not cascading.

   Nothing here decides permission. Both callers gate on `stock.edit`
   first, and the function is SECURITY INVOKER so RLS still applies:
   this makes a set of writes atomic and widens nothing.
   ============================================================= */

export type MarkSoldInput = {
  /** The tracker row, which is a `crm_contacts` record. */
  trackerId: string;
  salePrice?: number | null;
  profit?: number | null;
  commission?: number | null;
  dispatchDate?: string | null;
};

export type MarkSoldResult =
  | {
      ok: true;
      trackerId: string;
      commission: number | null;
      stockTrailerId: string | null;
      stockUpdated: boolean;
      /** Other reps' rows on the same unit, told it is gone. */
      cascadedOthers: number;
    }
  /* No `partial`. There is no partial outcome to report: the writes
     are one transaction, so it happened or it did not. */
  | { ok: false; error: string };

/** The slice of Supabase this needs, so nothing here imports a client. */
type Queryable = {
  from: (table: string) => any;
  rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
};

export type Actor = { id: string };

/** Initials, which is what the stock list shows for a rep. */
function repInitials(fullName: string | null | undefined): string {
  if (!fullName) return 'Unknown';
  const initials = fullName.split(' ').map((p) => p[0]).join('');
  return initials || fullName;
}

/**
 * Carry a sale through the three places that have to know about it.
 *
 * `today` is a parameter rather than a call to the clock, so the same
 * input produces the same result and a preview can be compared against
 * what execution will do.
 */
export async function markSold(
  supabase: Queryable,
  actor: Actor,
  input: MarkSoldInput,
  today: string = new Date().toISOString().slice(0, 10),
): Promise<MarkSoldResult> {
  if (!input.trackerId) return { ok: false, error: 'no deal named' };

  /* The rep's initials are what the stock list shows, and they come
     from the caller's profile rather than from the request. */
  const { data: profile } = await supabase
    .from('profiles').select('full_name').eq('id', actor.id).single();

  const { data, error } = await supabase.rpc('command_mark_sold', {
    p_tracker_id: input.trackerId,
    p_rep_initials: repInitials(profile?.full_name),
    p_sale_price: input.salePrice ?? null,
    p_profit: input.profit ?? null,
    p_commission: input.commission ?? null,
    p_dispatch_date: input.dispatchDate ?? null,
    p_today: today,
  });

  if (error) {
    const message = String((error as { message?: string }).message ?? error);
    /* No partial state to report, because there is no partial state.
       The transaction either committed or it did not. */
    return { ok: false, error: message };
  }

  const result = (data ?? {}) as {
    trackerId?: string;
    commission?: number | null;
    stockTrailerId?: string | null;
    stockUpdated?: boolean;
    cascadedOthers?: number;
  };

  return {
    ok: true,
    trackerId: result.trackerId ?? input.trackerId,
    commission: result.commission ?? null,
    stockTrailerId: result.stockTrailerId ?? null,
    stockUpdated: !!result.stockUpdated,
    cascadedOthers: result.cascadedOthers ?? 0,
  };
}
