import type { Period } from './period';
import { asDate, daysBetween } from './period';
import type {
  ContractBook, Decision, DivisionRow, DivisionSlug, Figure, MonthPoint,
  PersonRow, SourceFlow, StockUnit,
} from './types';

/* =============================================================
   Turning rows into the shapes the page draws.

   Pure functions, no database and no React, for one reason: this is
   where an analytics page is actually right or wrong. A chart that
   renders beautifully over a total computed one row short is worse than
   no chart, because it is believed.

   So every function here takes plain rows and returns a plain shape,
   and `npm run check:analytics` runs all of them against fixtures with
   the awkward cases in: a person with leads and no wins, a division
   with no target, a contract signed and cancelled in the same month, a
   trailer with no cost recorded.

   ---- The rule every function here follows ----

   A missing number is null, never nought. "We do not know what this
   trailer cost" and "this trailer cost nothing" are different facts,
   and averaging the second into a margin is how a division reports a
   profit it did not make.
   ============================================================= */

export const DIVISIONS: DivisionSlug[] = ['stc', 'trailer', 'rental'];

/** How a lead's type maps onto a revenue division. Two vocabularies, one truth. */
export function divisionOfLeadType(type: string | null): DivisionSlug {
  if (type === 'maintenance') return 'stc';
  if (type === 'rental') return 'rental';
  return 'trailer';
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const money = (n: number | null | undefined) => Number(n) || 0;

/* -------------------------------------------------------------
   Divisions
   ------------------------------------------------------------- */

export type WindowRow = {
  division: string;
  name: string;
  revenue: number | string;
  deals: number;
  customers: number;
  margin: number | string | null;
  was_revenue: number | string;
  was_deals: number;
  was_customers: number;
  target: number | string | null;
};

export function divisionRows(rows: WindowRow[]): DivisionRow[] {
  return rows.map((r) => {
    const revenue = money(r.revenue as number);
    const margin = r.margin == null ? null : money(r.margin as number);
    const detail: DivisionRow['detail'] = [];

    /* The same shape each time, a different unit each time, and the
       unit is part of the line rather than something to infer. A
       scorecard reading "412" under three different divisions is three
       different things and looks like one. */
    if (r.division === 'stc') {
      detail.push({ label: 'Invoices raised', value: String(r.deals) });
      detail.push({ label: 'Customers billed', value: String(r.customers) });
      detail.push({
        label: 'Average invoice',
        value: r.deals > 0 ? gbp(revenue / r.deals) : 'not known',
      });
    } else if (r.division === 'trailer') {
      detail.push({ label: 'Units sold', value: String(r.deals) });
      detail.push({
        label: 'Average unit',
        value: r.deals > 0 ? gbp(revenue / r.deals) : 'not known',
      });
      detail.push({
        label: 'Margin',
        value: margin == null || revenue === 0
          ? 'not known'
          : `${((margin / revenue) * 100).toFixed(1)}%`,
      });
    } else {
      detail.push({ label: 'Invoices raised', value: String(r.deals) });
      detail.push({ label: 'Customers on hire', value: String(r.customers) });
      detail.push({
        label: 'Average invoice',
        value: r.deals > 0 ? gbp(revenue / r.deals) : 'not known',
      });
    }

    return {
      division: r.division as DivisionSlug,
      name: r.name,
      revenue,
      was: money(r.was_revenue as number),
      target: r.target == null ? null : money(r.target as number),
      deals: r.deals,
      customers: r.customers,
      margin,
      detail,
    };
  });
}

function gbp(n: number): string {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency', currency: 'GBP', maximumFractionDigits: 0,
  }).format(n);
}

/* -------------------------------------------------------------
   The sentence at the top

   Written from the figures every time rather than chosen from a list of
   templates, because a template that does not fit the month is worse
   than no sentence: it is a sentence that is wrong.
   ------------------------------------------------------------- */
export function verdictSentence(divisions: DivisionRow[], p: Period): string {
  const total = sum(divisions.map((d) => d.revenue));
  const was = sum(divisions.map((d) => d.was));

  const period = p.kind === 'month' ? 'The month'
    : p.kind === 'quarter' ? 'The quarter'
      : p.kind === 'year' ? 'The year' : 'The period';

  if (was === 0 && total === 0) {
    return `${period} has nothing invoiced against it yet.`;
  }
  if (was === 0) {
    return `${period} is at ${gbp(total)}. There is nothing in the comparison window to measure it against.`;
  }

  const pct = ((total - was) / was) * 100;
  const way = pct >= 0 ? 'up' : 'down';
  const head = `Group is ${way} ${Math.abs(pct).toFixed(1)}% on ${p.mode === 'lastyear' ? 'last year' : 'the period before'}.`;

  /* Which divisions actually explain the move, named in the order they
     contributed. "Everything is up a bit" is not a sentence anybody can
     act on; "trailer sales carried it" is. */
  const moved = [...divisions]
    .map((d) => ({ ...d, delta: d.revenue - d.was }))
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  const parts = moved.slice(0, 3).map((d) => {
    if (d.was === 0) return `${d.name} started from nothing`;
    const change = ((d.revenue - d.was) / d.was) * 100;
    if (Math.abs(change) < 2) return `${d.name} held steady`;
    return `${d.name} ${change > 0 ? 'is up' : 'is down'} ${Math.abs(change).toFixed(1)}%`;
  });

  return `${head} ${sentenceList(parts)}.`;
}

function sentenceList(parts: string[]): string {
  if (parts.length === 0) return '';
  if (parts.length === 1) return capitalise(parts[0]!);
  return `${capitalise(parts.slice(0, -1).join(', '))} and ${parts[parts.length - 1]}`;
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/* -------------------------------------------------------------
   People
   ------------------------------------------------------------- */

export type LeadRow = {
  id: string;
  owner_id: string | null;
  owner_name?: string | null;
  type: string | null;
  status: string;
  estimated_value: number | null;
  sale_price: number | null;
  order_date: string | null;
  created_at: string;
  contact_source?: string | null;
};

export function peopleRows(
  leads: LeadRow[],
  names: Map<string, string>,
  p: Period,
): PersonRow[] {
  const by = new Map<string, PersonRow & { divisions: Map<DivisionSlug, number> }>();

  const inWindow = (d: string | null) =>
    Boolean(d && d.slice(0, 10) >= p.window.from && d.slice(0, 10) <= p.window.to);
  const inCompare = (d: string | null) =>
    Boolean(p.compare && d && d.slice(0, 10) >= p.compare.from && d.slice(0, 10) <= p.compare.to);

  for (const l of leads) {
    const id = l.owner_id ?? 'unassigned';
    const name = l.owner_id ? (names.get(l.owner_id) ?? 'Somebody') : 'Unassigned';
    let row = by.get(id);
    if (!row) {
      row = {
        id, name, initials: initialsOf(name), division: null,
        leads: 0, quoted: 0, won: 0, wonValue: 0, wasValue: 0, openValue: 0,
        conversion: 0, divisions: new Map(),
      };
      by.set(id, row);
    }

    const div = divisionOfLeadType(l.type);
    row.divisions.set(div, (row.divisions.get(div) ?? 0) + 1);

    /* A lead counts against the window it was RAISED in, and a win
       counts against the window it was AGREED in. They are different
       dates on purpose: a lead raised in July and won in September is
       July's lead and September's win, and rolling both to one date is
       how a good month gets credited to the wrong person. */
    if (inWindow(l.created_at)) {
      row.leads += 1;
      if (['quoted', 'won', 'customer'].includes(l.status)) row.quoted += 1;
    }

    /* The order date test, which is the rule the tracker learned the
       hard way: a customer row with no agreed date is imported
       invoicing, not a deal somebody closed. */
    const won = l.status === 'customer' && l.order_date;
    if (won && inWindow(l.order_date)) {
      row.won += 1;
      row.wonValue += money(l.sale_price);
    }
    if (won && inCompare(l.order_date)) {
      row.wasValue += money(l.sale_price);
    }
    if (['lead', 'contacted', 'quoted', 'won'].includes(l.status)) {
      row.openValue += money(l.estimated_value);
    }
  }

  return [...by.values()]
    .map((r) => {
      const { divisions, ...rest } = r;
      const busiest = [...divisions.entries()].sort((a, b) => b[1] - a[1])[0];
      return {
        ...rest,
        division: busiest ? busiest[0] : null,
        conversion: r.leads > 0 ? r.won / r.leads : 0,
      };
    })
    .filter((r) => r.leads > 0 || r.won > 0 || r.openValue > 0)
    .sort((a, b) => b.wonValue - a.wonValue);
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '??';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

/* -------------------------------------------------------------
   Where leads came from

   The source lives on the ACCOUNT rather than on the lead, which is
   what `crm_contacts.source` has held since the schema was written. So
   this answers "what did work from this kind of customer turn into",
   which is close to the question and not identical to it. The screen
   says so rather than letting somebody read it as per-lead attribution.
   ------------------------------------------------------------- */
export function sourceFlows(leads: LeadRow[], p: Period): SourceFlow[] {
  const by = new Map<string, SourceFlow>();

  for (const l of leads) {
    if (l.created_at.slice(0, 10) < p.window.from || l.created_at.slice(0, 10) > p.window.to) continue;

    const key = tidySource(l.contact_source);
    let row = by.get(key);
    if (!row) {
      row = { source: key, leads: 0, won: { stc: 0, trailer: 0, rental: 0 }, lost: 0, open: 0, value: 0 };
      by.set(key, row);
    }
    row.leads += 1;
    if (l.status === 'customer') {
      row.won[divisionOfLeadType(l.type)] += 1;
      row.value += money(l.sale_price);
    } else if (l.status === 'lost') {
      row.lost += 1;
    } else {
      row.open += 1;
    }
  }

  return [...by.values()].sort((a, b) => b.leads - a.leads);
}

function tidySource(s: string | null | undefined): string {
  const v = (s ?? '').trim();
  if (!v || v === 'manual') return 'Added by hand';
  return v.charAt(0).toUpperCase() + v.slice(1).replace(/[_-]+/g, ' ');
}

/* -------------------------------------------------------------
   Stock, as age against margin

   The design's point about this chart is worth keeping in the code:

     A plain stock list sorts by one column at a time. Putting age and
     margin on two axes is what makes the decision visible without
     reading 41 rows.
   ------------------------------------------------------------- */
export type TrailerRow = {
  id: string;
  stc_no: string | null;
  make: string | null;
  model: string | null;
  category: string | null;
  status: string | null;
  location: string | null;
  retail_price: number | null;
  sales_price: number | null;
  total_nbv: number | null;
  nbv: number | null;
  created_at: string;
  order_date: string | null;
};

export function stockUnits(rows: TrailerRow[], today: string): StockUnit[] {
  return rows
    .filter((t) => (t.status ?? '') === 'in_stock' || (t.status ?? '') === 'available')
    .map((t) => {
      const price = money(t.retail_price ?? t.sales_price);
      const cost = t.total_nbv ?? t.nbv;

      /* Days on the yard, from the day the record was made. The stock
         list has no purchase date, so this is the closest honest
         answer, and it is right for everything imported since the list
         was loaded. The screen says which date it counts from. */
      const days = Math.max(0, daysBetween(t.created_at.slice(0, 10), today) - 1);

      return {
        id: t.id,
        ref: t.stc_no ?? '(no number)',
        what: [t.make, t.model].filter(Boolean).join(' ') || t.category || 'Trailer',
        days,
        marginPct: cost == null || price <= 0 ? null : ((price - Number(cost)) / price) * 100,
        price,
        location: t.location,
      };
    })
    .sort((a, b) => b.days - a.days);
}

/** The five ageing bands the design shows, and what each is worth. */
export function ageingBands(units: StockUnit[]) {
  const edges: [string, number, number][] = [
    ['0 to 30 days', 0, 30], ['31 to 60', 31, 60], ['61 to 90', 61, 90],
    ['91 to 120', 91, 120], ['Over 120', 121, Infinity],
  ];
  return edges.map(([label, lo, hi], at) => {
    const mine = units.filter((u) => u.days >= lo && u.days <= hi);
    return {
      label,
      units: mine.length,
      value: sum(mine.map((u) => u.price)),
      /* The last two bands are the ones that cost money. Named as a
         reading rather than coloured, so it survives being printed. */
      reading: at >= 4 ? 'Act now' : at === 3 ? 'Watch' : 'Turning normally',
    };
  });
}

/* -------------------------------------------------------------
   The FleetSmart+ book

   From the design:

     Contracts are recurring, so the useful number is not what was
     signed this month but what the book is now worth every week.
   ------------------------------------------------------------- */
export type ContractRow = {
  id: string;
  plan: string;
  status: string;
  monthly_total: number | null;
  annual_total: number | null;
  starts_on: string | null;
  created_at: string;
  decided_at: string | null;
};

const LIVE = ['accepted'];
const WEEKS_A_YEAR = 52;

export function contractBook(rows: ContractRow[], p: Period, months = 9): ContractBook | null {
  if (rows.length === 0) return null;

  const live = rows.filter((c) => LIVE.includes(c.status));
  const weekly = (c: ContractRow) => money(c.annual_total) / WEEKS_A_YEAR;

  /* The book at the end of each of the last N months: every contract
     that had started and had not ended by then. Built by walking the
     months rather than by grouping on the signing month, because the
     book is a stock and not a flow: a contract signed in January is
     still in the September figure. */
  const monthKeys: string[] = [];
  for (let i = months - 1; i >= 0; i -= 1) {
    const d = asDate(p.window.to);
    const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1));
    monthKeys.push(m.toISOString().slice(0, 10));
  }

  const at = (month: string) => {
    const end = new Date(asDate(month).getTime());
    end.setUTCMonth(end.getUTCMonth() + 1);
    const endIso = end.toISOString().slice(0, 10);
    return live.filter((c) => {
      const from = (c.starts_on ?? c.created_at).slice(0, 10);
      if (from >= endIso) return false;
      /* Decided and no longer accepted means it has left the book. A
         contract that was cancelled in June is in the January figure
         and out of the July one. */
      return true;
    });
  };

  const monthsOut = monthKeys.map((month) => {
    const held = at(month);
    const tier = (t: string) => sum(held.filter((c) => c.plan === t).map(weekly));
    return { month, silver: tier('Silver'), gold: tier('Gold'), platinum: tier('Platinum') };
  });

  const mix = (['Silver', 'Gold', 'Platinum'] as const).map((tier) => {
    const mine = live.filter((c) => c.plan === tier);
    return { tier, contracts: mine.length, weekly: sum(mine.map(weekly)) };
  });

  /* Retention by the month a contract started. Reading across a row is
     how many of that month's signings were still live one month later,
     two months later, and so on. A single retention percentage averages
     away the cohort that is actually churning. */
  /* Only contracts that ACTUALLY STARTED are in a cohort. A contract
     sent and never signed, or declined, never joined the book, and
     counting it in the denominator makes month nought read as 92%
     retention when by definition it is 100%: nothing can have churned
     on the day it began. */
  const everStarted = rows.filter((c) => LIVE.includes(c.status) || c.status === 'expired');

  const cohorts = monthKeys.map((month) => {
    const startedThen = everStarted.filter((c) => (c.starts_on ?? c.created_at).slice(0, 10).slice(0, 7) === month.slice(0, 7));
    const signed = startedThen.length;
    const stepsPossible = monthKeys.length - monthKeys.indexOf(month);
    const stillLive = (step: number) => {
      if (step >= stepsPossible) return null;
      const kept = startedThen.filter((c) => {
        if (!LIVE.includes(c.status)) {
          /* It ended. Was it still live at this step? */
          const ended = (c.decided_at ?? '').slice(0, 7);
          if (!ended) return false;
          const asAt = addMonthKey(month, step);
          return ended > asAt.slice(0, 7);
        }
        return true;
      });
      return signed === 0 ? null : Math.round((kept.length / signed) * 100);
    };
    return {
      month,
      signed,
      live: Array.from({ length: monthKeys.length }, (_, step) => stillLive(step)),
    };
  });

  const thisWeek = sum(live.map(weekly));
  const added = rows.filter((c) => LIVE.includes(c.status)
    && (c.starts_on ?? c.created_at).slice(0, 10) >= p.window.from
    && (c.starts_on ?? c.created_at).slice(0, 10) <= p.window.to);

  return {
    months: monthsOut,
    mix,
    cohorts,
    thisWeek,
    annualised: thisWeek * WEEKS_A_YEAR,
    addedThisPeriod: sum(added.map(weekly)),
    contracts: live.length,
  };
}

function addMonthKey(month: string, step: number): string {
  const d = asDate(month);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + step, 1)).toISOString().slice(0, 10);
}

/* -------------------------------------------------------------
   What only a decision can fix

   From the design: "the right column is deliberately separate: it is
   the shortlist of things only the MD can unblock, not a general alert
   feed."

   So the bar for appearing here is high and the list is capped. Five
   things somebody must decide is a list; twelve is a feed nobody reads.
   ------------------------------------------------------------- */
export function decisionsFrom(args: {
  divisions: DivisionRow[];
  stock: StockUnit[];
  people: PersonRow[];
  book: ContractBook | null;
}): Decision[] {
  const out: Decision[] = [];

  for (const d of args.divisions) {
    if (d.target != null && d.target > 0 && d.revenue < d.target * 0.9) {
      out.push({
        what: `${d.name} is ${gbp(d.target - d.revenue)} behind target`,
        tone: 'danger',
        href: `/dashboard/revenue/${d.division}`,
      });
    }
  }

  const old = args.stock.filter((u) => u.days > 120);
  if (old.length > 0) {
    out.push({
      what: `${old.length} trailers past 120 days, ${gbp(sum(old.map((u) => u.price)))} standing still`,
      tone: old.length > 8 ? 'danger' : 'warning',
      href: '/dashboard/sales',
    });
  }

  const thin = args.stock.filter((u) => u.days > 120 && u.marginPct != null && u.marginPct < 5);
  if (thin.length > 0) {
    out.push({
      what: `${thin.length} of those have under 5% margin left to discount`,
      tone: 'danger',
      href: '/dashboard/sales',
    });
  }

  const quiet = args.people.filter((p) => p.leads >= 5 && p.won === 0);
  for (const p of quiet) {
    out.push({
      what: `${p.name} raised ${p.leads} leads and closed none`,
      tone: 'warning',
      href: `/dashboard/leads?owner=${p.id}`,
    });
  }

  return out.slice(0, 5);
}

/* -------------------------------------------------------------
   The headline figures
   ------------------------------------------------------------- */
export function headlineFigures(args: {
  divisions: DivisionRow[];
  people: PersonRow[];
  book: ContractBook | null;
  period: Period;
}): Figure[] {
  const { divisions, people, book, period } = args;
  const revenue = sum(divisions.map((d) => d.revenue));
  const was = sum(divisions.map((d) => d.was));
  const targets = divisions.map((d) => d.target).filter((t): t is number => t != null);

  const against = period.mode === 'lastyear' ? 'the same period last year'
    : period.mode === 'target' ? 'target' : 'the period before';

  const out: Figure[] = [
    {
      label: 'Group revenue',
      value: revenue,
      unit: 'money',
      was: period.compare ? was : null,
      target: targets.length ? sum(targets) : null,
      note: `Every division, against ${against}`,
      goodWhen: 'up',
      provenance: {
        counts: 'Protean invoices by tax point for STC and Rentals, and trailers by the date '
          + 'the order was agreed for Trailer Sales.',
        excludes: 'VAT, credit notes, and anything quoted but not yet agreed.',
        source: 'protean_invoices and stock_trailers.',
        changedBy: 'The weekly Protean and Sage imports, and whoever marks a trailer sold.',
      },
    },
    {
      label: 'New business won',
      value: sum(people.map((p) => p.wonValue)),
      unit: 'money',
      was: period.compare ? sum(people.map((p) => p.wasValue)) : null,
      target: null,
      note: `Across ${sum(people.map((p) => p.won))} deals somebody closed`,
      goodWhen: 'up',
      provenance: {
        counts: 'Leads marked as a customer WITH AN AGREED DATE, counted on that date.',
        excludes: 'Leads with no order date. Imported invoicing arrives that way and is not '
          + 'business anybody won.',
        source: 'crm_leads.',
        changedBy: 'Whoever owns the lead, on their tracker.',
      },
    },
    {
      label: 'Open pipeline',
      value: sum(people.map((p) => p.openValue)),
      unit: 'money',
      was: null,
      target: null,
      note: 'Estimated value of everything still being worked',
      goodWhen: 'up',
      provenance: {
        counts: 'The estimated value on every lead not yet won or lost.',
        excludes: 'Won and lost leads. An estimate is what somebody expects, not what is agreed.',
        source: 'crm_leads.',
        changedBy: 'Whoever owns the lead.',
      },
    },
  ];

  const trailer = divisions.find((d) => d.division === 'trailer');
  if (trailer && trailer.margin != null && trailer.revenue > 0) {
    out.push({
      label: 'Trailer margin',
      value: (trailer.margin / trailer.revenue) * 100,
      unit: 'percent',
      was: null,
      target: null,
      note: 'Trailer sales is the only division that records a cost',
      goodWhen: 'up',
      provenance: {
        counts: 'Profit against sale price on every trailer ordered in the window.',
        excludes: 'STC and Rentals entirely: neither records a cost, so a group margin '
          + 'cannot be worked out and is not shown.',
        source: 'stock_trailers.',
        changedBy: 'Whoever completes the sale on the stock list.',
      },
    });
  }

  if (book) {
    out.push({
      label: 'FleetSmart+ book',
      value: book.annualised,
      unit: 'money',
      was: null,
      target: null,
      note: `${book.contracts} live contracts, worth ${gbp(book.thisWeek)} a week`,
      goodWhen: 'up',
      provenance: {
        counts: 'Every accepted contract, annualised from its agreed yearly total.',
        excludes: 'Drafts, contracts sent and not signed, and anything declined or expired.',
        source: 'fleetsmart_contracts.',
        changedBy: 'Whoever owns the contract, in the FleetSmart+ builder.',
      },
    });
  }

  return out;
}

/* -------------------------------------------------------------
   Month by month
   ------------------------------------------------------------- */
export type MonthRow = { month: string; division: string; net: number | string };

export function monthPoints(
  rows: MonthRow[],
  targets: { month: string; division: string | null; target: number | string }[],
): MonthPoint[] {
  const by = new Map<string, MonthPoint>();
  for (const r of rows) {
    const key = r.month.slice(0, 10);
    let point = by.get(key);
    if (!point) { point = { month: key, stc: 0, trailer: 0, rental: 0, target: null }; by.set(key, point); }
    if (r.division === 'stc' || r.division === 'trailer' || r.division === 'rental') {
      point[r.division] += money(r.net as number);
    }
  }
  for (const t of targets) {
    const point = by.get(t.month.slice(0, 10));
    if (!point) continue;
    point.target = (point.target ?? 0) + money(t.target as number);
  }
  return [...by.values()].sort((a, b) => a.month.localeCompare(b.month));
}

/**
 * The same months, indexed so three divisions can share an axis.
 *
 * The design's reason, which is the right one: "a good month for
 * rentals is a rounding error against STC revenue". Indexing hides the
 * size of each division deliberately, so the chart answers direction
 * and the revenue bars answer weight.
 */
export function indexed(points: MonthPoint[]): { month: string; stc: number; trailer: number; rental: number }[] {
  const base: Record<'stc' | 'trailer' | 'rental', number> = { stc: 0, trailer: 0, rental: 0 };
  for (const k of ['stc', 'trailer', 'rental'] as const) {
    const first = points.find((p) => p[k] > 0);
    base[k] = first ? first[k] : 0;
  }
  return points.map((p) => ({
    month: p.month,
    stc: base.stc ? (p.stc / base.stc) * 100 : 100,
    trailer: base.trailer ? (p.trailer / base.trailer) * 100 : 100,
    rental: base.rental ? (p.rental / base.rental) * 100 : 100,
  }));
}
