/* =============================================================
   What a customer is worth, across every lead on them.

   From the business:

     people want to know the total prospect value for a customer based
     on all their leads. currently you only see the potential £ of all
     open leads.

   ---- Why this is a module and not a sum in two components ----

   The CRM record and the tracker both have to answer it, and they are
   different screens written months apart. Two sums drift: one starts
   counting lost leads, the other starts reading `sale_price` on a won
   one, and then the same customer is worth two different amounts
   depending on which tab somebody is looking at. That is worse than not
   showing the figure at all, because both look authoritative.

   ---- The one judgement in here, stated rather than buried ----

   Four figures come out, not one, because "what is this customer worth"
   is really three questions with different answers:

     open   still winnable. The pipeline figure, and the one that was
            already on the tracker.
     won    money actually taken. A won lead's `sale_price` where it has
            one, its estimate where it does not, because a maintenance
            account imported with a revenue figure has the first and a
            trailer sale marked won by hand may only have the second.
     lost   what was chased and missed. Real, and worth seeing next to
            the others, so a customer who has been quoted six times and
            bought once reads correctly.

   The headline is `openAndWon`: open plus won, and NOT lost. Money that
   was lost is not value, and adding it to a customer's worth would make
   the worst customer in the book look like the best. That is the sort of
   figure that gets read out in a meeting once and then never trusted
   again.

   ---- Leads with no value on them ----

   Counted, and said out loud. A pipeline of £40,000 across six leads
   means something different when two of the six carry no figure at all,
   and a total that quietly ignores them is a total somebody will later
   discover was never the whole picture.
   ============================================================= */

/** The little a value needs to know about a lead. */
export type ValuableLead = {
  status: string;
  type?: string | null;
  estimated_value?: number | string | null;
  sale_price?: number | string | null;
};

export type LeadValue = {
  /** Still winnable: lead, contacted, quoted. */
  open: { count: number; total: number; priced: number };
  /** Won: customer or won. Uses `sale_price` where there is one. */
  won: { count: number; total: number; priced: number };
  /** Chased and missed. */
  lost: { count: number; total: number; priced: number };
  /** Open plus won. The headline, and deliberately not including lost. */
  openAndWon: number;
  /** Every lead on the customer, whatever state. */
  leads: number;
  /** How many of them carry no figure at all. */
  unpriced: number;
};

const OPEN = new Set(['lead', 'contacted', 'quoted']);
const WON = new Set(['won', 'customer']);

/** A number, or nothing. Postgres numerics arrive as strings. */
function amount(v: number | string | null | undefined): number | null {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * What one lead is worth.
 *
 * A won lead is worth what it sold for where that is recorded, and its
 * estimate where it is not. The two are different things and neither is
 * always there: a maintenance account imported with a year's revenue has
 * only the first, and a trailer sale somebody marked won without filling
 * in the price has only the second.
 */
export function valueOf(lead: ValuableLead): number | null {
  if (WON.has(lead.status)) {
    return amount(lead.sale_price) ?? amount(lead.estimated_value);
  }
  return amount(lead.estimated_value);
}

/** What a set of leads is worth, split the three ways that matter. */
export function valueLeads(leads: ValuableLead[]): LeadValue {
  const bucket = () => ({ count: 0, total: 0, priced: 0 });
  const out: LeadValue = {
    open: bucket(), won: bucket(), lost: bucket(),
    openAndWon: 0, leads: leads.length, unpriced: 0,
  };

  for (const lead of leads) {
    const value = valueOf(lead);
    if (value == null) out.unpriced += 1;

    const into = OPEN.has(lead.status) ? out.open
      : WON.has(lead.status) ? out.won
      : lead.status === 'lost' ? out.lost
      : null;

    /* A status the six do not cover cannot be counted into any of them.
       Nothing writes one today, and silently folding it into `open`
       would be the kind of guess that shows up as a wrong total months
       later. It still counts in `leads`, so the row count and the money
       disagreeing is itself the signal. */
    if (!into) continue;

    into.count += 1;
    if (value != null) { into.total += value; into.priced += 1; }
  }

  out.open.total = round(out.open.total);
  out.won.total = round(out.won.total);
  out.lost.total = round(out.lost.total);
  out.openAndWon = round(out.open.total + out.won.total);
  return out;
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Money, the way every other figure on these screens is written. */
export function pounds(n: number, pence = false): string {
  return n.toLocaleString('en-GB', {
    style: 'currency', currency: 'GBP',
    minimumFractionDigits: pence ? 2 : 0,
    maximumFractionDigits: pence ? 2 : 0,
  });
}

/**
 * The caveat under a total, or nothing where there is none.
 *
 * A figure with two leads missing from it needs to say so next to
 * itself. Somewhere else on the page is somewhere nobody reads.
 */
export function whatIsMissing(v: LeadValue): string | null {
  if (v.unpriced === 0) return null;
  if (v.unpriced === v.leads) {
    return `None of the ${v.leads} carry a value yet, so there is nothing to total.`;
  }
  return `${v.unpriced} of the ${v.leads} carry no value, so this is what the rest come to.`;
}
