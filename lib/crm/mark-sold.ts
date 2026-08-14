/* =============================================================
   Marking a deal sold.

   One business operation with three parts, and the parts are the reason
   it is an operation rather than a field write. Setting
   `crm_contacts.status = 'customer'` looks like the whole thing and is
   not: a sale raises a commission line, flips the stock unit, and tells
   every other rep chasing the same unit that it is gone.

   Lifted out of `app/api/tracker/mark-sold/route.ts` unchanged so the
   route and the command bar's capability run the SAME code. Two
   implementations of a sale is how one of them ends up not cascading.

   Nothing here decides permission. Both callers gate on `stock.edit`
   first, which is what the route's own comment explains: RLS covers the
   caller's own tracker row and covers neither the stock unit nor the
   other reps' rows.
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
      /** Exactly what changed, for a preview or an audit line. */
      changes: { table: string; id: string; set: Record<string, unknown> }[];
    }
  | { ok: false; error: string; partial?: boolean };

/** The slice of Supabase this needs, so nothing here imports a client. */
type Queryable = {
  from: (table: string) => any;
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

  const { data: row, error: readErr } = await supabase
    .from('crm_contacts').select('*').eq('id', input.trackerId).single();
  if (readErr || !row) return { ok: false, error: readErr?.message ?? 'that deal is not there' };

  /* Commission follows the row's own rate unless somebody supplied a
     figure. Ten percent is the fallback the tracker has always used. */
  const profit = input.profit ?? row.profit ?? null;
  const rate = row.commission_rate ?? 0.10;
  const commission = input.commission
    ?? (profit != null ? Number((Number(profit) * rate).toFixed(2)) : null);

  const { data: profile } = await supabase
    .from('profiles').select('full_name').eq('id', actor.id).single();
  const repName = repInitials(profile?.full_name);

  const changes: { table: string; id: string; set: Record<string, unknown> }[] = [];

  /* 1. The tracker row itself. */
  const trackerUpdate: Record<string, unknown> = {
    status: 'customer',
    sale_price: input.salePrice ?? row.sale_price,
    profit,
    commission,
    order_date: row.order_date ?? today,
  };
  if (input.dispatchDate) trackerUpdate.dispatch_date = input.dispatchDate;

  const { error: tErr } = await supabase
    .from('crm_contacts').update(trackerUpdate).eq('id', input.trackerId);
  if (tErr) return { ok: false, error: `the deal did not update: ${tErr.message}` };
  changes.push({ table: 'crm_contacts', id: input.trackerId, set: trackerUpdate });

  /* 2. The stock unit, when the deal is linked to one. */
  let stockUpdated = false;
  if (row.stock_trailer_id) {
    const stockUpdate: Record<string, unknown> = {
      status: 'sold',
      customer: row.company_name,
      sales_rep: repName,
      sales_price: input.salePrice ?? row.sale_price,
      profit,
      order_date: trackerUpdate.order_date,
    };
    if (input.dispatchDate) stockUpdate.dispatch_date = input.dispatchDate;
    const { error: sErr } = await supabase
      .from('stock_trailers').update(stockUpdate).eq('id', row.stock_trailer_id);
    if (sErr) {
      return {
        ok: false,
        error: `the deal updated, but the stock unit did not: ${sErr.message}`,
        partial: true,
      };
    }
    stockUpdated = true;
    changes.push({ table: 'stock_trailers', id: row.stock_trailer_id, set: stockUpdate });
  }

  /* 3. Everybody else chasing the same unit.
     First to sell wins. Their row says sold; their commission and
     dispatch date stay empty, because they did not make the sale.
     Leaving those alone is what keeps the numbers honest. */
  let cascadedOthers = 0;
  if (row.stock_trailer_id) {
    const { data: others, error: cErr } = await supabase
      .from('crm_contacts')
      .update({ status: 'customer' })
      .eq('stock_trailer_id', row.stock_trailer_id)
      .neq('id', input.trackerId)
      .not('status', 'eq', 'customer')
      .select('id');
    if (!cErr && others) {
      cascadedOthers = others.length;
      for (const other of others as { id: string }[]) {
        changes.push({ table: 'crm_contacts', id: other.id, set: { status: 'customer' } });
      }
    }
  }

  return {
    ok: true,
    trackerId: input.trackerId,
    commission,
    stockTrailerId: row.stock_trailer_id ?? null,
    stockUpdated,
    cascadedOthers,
    changes,
  };
}
