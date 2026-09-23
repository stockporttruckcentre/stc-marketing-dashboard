/* =============================================================
   A deal, as the order form's boxes.

   Separate from the route so the mapping can be tested without a
   request, and separate from `fill.ts` so the filler knows nothing
   about the CRM. One file answers "where does each box come from", and
   it is the only place that answers it.

   ---- What is deliberately left blank ----

   Three boxes on the form have nothing behind them in this database:

     Company Number          `crm_contacts` holds no company number
     VAT Registration Number nor a VAT number
     Order Number            deals have no order number of their own

   They print blank, to be typed. Filling them with something that looks
   right is how a customer receives somebody else's company number.

   The summary MOT Expiry box is filled ONLY when the deal has exactly
   one unit, where its own MOT is the only answer the box can have. With
   two units it is left blank, because the schedule below already gives
   both and picking one of them to print at the top is a decision
   nobody asked for.

   ---- VAT ----

   Twenty per cent, which is the UK standard rate. It is the one figure
   here not read from the data, so it is a named constant with the date
   it was last true, rather than a 0.2 in the middle of a sum.
   ============================================================= */
import type { OrderForm, OrderLine } from './fill';

/** The UK standard rate, unchanged since 4 January 2011. */
export const VAT_RATE = 0.20;

export type DealForForm = {
  lead: {
    id: string;
    what: string | null;
    requirement: string | null;
    new_or_used: string | null;
    dispatch_date: string | null;
    estimated_value: number | null;
    sale_price: number | null;
    on_hire_date: string | null;
    off_hire_estimate: string | null;
    term_months: number | null;
    hire_rate: number | null;
    service_cycle: string | null;
    maintenance_cover: string | null;
    vendor_rate: number | null;
  };
  account: {
    company_name: string | null;
    contact_name: string | null;
    email: string | null;
    phone: string | null;
    address: string | null;
    location: string | null;
  } | null;
  vendor: {
    name: string | null;
    maintenance_rate: number | null;
  } | null;
  units: Array<{
    quantity: number;
    rate: number | null;
    trailer: {
      stc_no: string | null;
      chassis_number: string | null;
      ministry_no: string | null;
      mot_date: string | null;
      make: string | null;
      model: string | null;
      year: number | null;
      new_or_used: string | null;
      retail_price: number | null;
      expected_delivery: string | null;
      description: string | null;
    } | null;
  }>;
};

const GBP = (n: number) =>
  n.toLocaleString('en-GB', { style: 'currency', currency: 'GBP', minimumFractionDigits: 2 });

/** A date the way a customer reads one, or blank. */
export function longDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

/** A date in a table cell, where there is no room for the month in full. */
export function shortDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

const COVER_ON_FORM: Record<string, string> = {
  net_net: 'NET/NET',
  rm: 'R&M',
  full_rm_tyres: 'Full R&M + Tyres',
};

/** Every non blank line of a block, joined. Blank lines never print. */
function lines(...parts: Array<string | null | undefined>): string {
  return parts.map((p) => (p ?? '').trim()).filter(Boolean).join('\n');
}

export function formFor(deal: DealForForm): OrderForm {
  const { lead, account, vendor, units } = deal;

  const orderLines: OrderLine[] = units.map((u) => {
    const t = u.trailer;
    /* The price on the line, or the unit's own retail price where
       nobody has priced the deal yet. A blank is printed rather than a
       nought: nought is a price and nobody agreed it. */
    const price = u.rate ?? t?.retail_price ?? null;
    return {
      manufacturer: lines(
        [t?.make, t?.model].filter(Boolean).join(' '),
      ).replace(/\n/g, ' ') + (t?.year ? ` ${t.year}` : ''),
      qty: String(u.quantity ?? 1),
      chassis: t?.chassis_number ?? '',
      stockNo: t?.stc_no ?? '',
      motExpiry: shortDate(t?.mot_date) || '',
      ministryNo: t?.ministry_no ?? '',
      condition: t?.new_or_used ?? lead.new_or_used ?? '',
      netPrice: price == null ? '' : GBP(Number(price)),
    };
  });

  /* The net is what the lines add up to, so the form and its own
     schedule cannot disagree. A deal with no priced units falls back to
     what was agreed, then to the estimate, and where there is none of
     the three every money box prints blank. */
  const fromLines = units.reduce((sum, u) => {
    const price = u.rate ?? u.trailer?.retail_price ?? null;
    return price == null ? sum : sum + Number(price) * (u.quantity ?? 1);
  }, 0);
  const anyPriced = units.some((u) => (u.rate ?? u.trailer?.retail_price) != null);
  const net = anyPriced ? fromLines : (lead.sale_price ?? lead.estimated_value ?? null);

  const vat = net == null ? null : Math.round(net * VAT_RATE * 100) / 100;
  const total = net == null || vat == null ? null : net + vat;

  /* The specification box takes what the deal says it is for, and the
     hire terms underneath it, because "details below to be generated on
     order form if populated" is exactly what was asked for and the
     template has no boxes of its own for a term or a service cycle. */
  const hire = lines(
    lead.on_hire_date ? `On hire from: ${longDate(lead.on_hire_date)}` : null,
    lead.off_hire_estimate ? `Estimated off hire: ${longDate(lead.off_hire_estimate)}` : null,
    lead.term_months ? `Term: ${lead.term_months} months` : null,
    lead.hire_rate != null ? `Rate: ${GBP(Number(lead.hire_rate))}` : null,
    lead.service_cycle ? `Service cycle: ${lead.service_cycle}` : null,
    lead.maintenance_cover
      ? `Cover: ${COVER_ON_FORM[lead.maintenance_cover] ?? lead.maintenance_cover}` : null,
    vendor?.name
      ? `Maintained by ${vendor.name}`
        + ((lead.vendor_rate ?? vendor.maintenance_rate) != null
          ? ` at ${GBP(Number(lead.vendor_rate ?? vendor.maintenance_rate))}`
          : '')
      : null,
  );

  /* One unit, so the summary MOT has exactly one answer. Two, and it is
     left blank rather than one of them being picked. */
  const onlyUnit = units.length === 1 ? units[0].trailer : null;

  const delivery = lines(
    account?.address ?? account?.location ?? null,
  );

  return {
    customer_name:     account?.company_name ?? '',
    /* Not held against a customer in this CRM. Typed on the form. */
    company_number:    '',
    vat_number:        '',
    registered_office: account?.address ?? '',
    representative:    account?.contact_name ?? '',
    contact_details:   lines(account?.email, account?.phone),
    /* Deals carry no order number of their own. */
    order_number:      '',
    delivery_estimate: longDate(lead.dispatch_date ?? onlyUnit?.expected_delivery ?? null),
    mot_expiry:        onlyUnit ? shortDate(onlyUnit.mot_date) : '',
    specification:     lines(lead.what, lead.requirement, onlyUnit?.description, hire),
    net_price:         net == null ? '' : GBP(net),
    vat:               vat == null ? '' : GBP(vat),
    delivery_address:  delivery,
    total_price:       total == null ? '' : GBP(total),
    /* Nothing in the CRM records a deposit, so this prints the three
       lines the template meant to carry and somebody fills them in. */
    deposit:           '',
    lines: orderLines,
  };
}

/** What a generated file is called, on the customer's machine. */
export function fileNameFor(deal: DealForForm, variant: 'order' | 'proposal'): string {
  const who = (deal.account?.company_name ?? 'Customer')
    .replace(/[^A-Za-z0-9 ]+/g, '').trim().replace(/\s+/g, '-') || 'Customer';
  const when = new Date().toISOString().slice(0, 10);
  const what = variant === 'proposal' ? 'Proposal' : 'Order-Form';
  return `STC-Trailer-Sales-${what}-${who}-${when}.docx`;
}
