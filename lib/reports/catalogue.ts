/* =============================================================
   Which reports exist, and what each one is for.

   From the business:

     Categorise the report types ... Have options when running reports to
     include/exclude divisions and data types.

   One list, read by the screen that offers them, the route that builds
   them and the check that sweeps them. A report missing from here is a
   report nobody can run, which is the same rule the command bar's
   action list has and for the same reason.

   ---- Why the sections are declared here as well ----

   Because "include/exclude data types" needs a list of the data types
   BEFORE the report is run. A screen that can only offer to exclude a
   section after it has seen one has to run the report to draw its own
   filter, which is a page that flickers and a Word export that cannot
   be asked for without opening the screen first.

   So each report declares its sections and the builder fills them. The
   two agreeing is asserted by `npm run check:reports`.
   ============================================================= */

export type ReportCategory = 'meeting' | 'customers' | 'pipeline' | 'operations';

export const CATEGORY_LABEL: Record<ReportCategory, string> = {
  meeting: 'Meetings',
  customers: 'Customers',
  pipeline: 'Pipeline and people',
  operations: 'Operations',
};

/* The same categories, short enough for a 196px rail.
   "Pipeline and people" is the right name in a table column, where
   there is room to say what it means, and it is one word too long for
   a sidebar row, where it wraps to two lines and breaks the rhythm of
   every row beside it. Two labels rather than one truncated with an
   ellipsis, because "Pipeline and peo..." is not a name. */
export const CATEGORY_SHORT: Record<ReportCategory, string> = {
  meeting: 'Meetings',
  customers: 'Customers',
  pipeline: 'Pipeline',
  operations: 'Operations',
};

export const CATEGORY_BLURB: Record<ReportCategory, string> = {
  meeting: 'Everything for a meeting, in the order it is taken.',
  customers: 'Who is spending, who has stopped, and who is moving.',
  pipeline: 'What is open, who is working it, and what closed.',
  operations: 'Stock, jobs and contracts.',
};

export type ReportDef = {
  slug: string;
  title: string;
  /** One line on the card. What question it answers. */
  blurb: string;
  category: ReportCategory;
  /** Section ids, in the order they appear, with a label for the filter. */
  sections: { id: string; label: string }[];
  /** Which filters mean anything here. A person filter on a stock report does not. */
  uses: { divisions: boolean; period: boolean; person: boolean };
};

export const REPORTS: ReportDef[] = [
  /* =============================================================
     The one the business asked for by name.

     From the business:

       The first report will be a bi-weekly meeting report. Summarises
       any open reds/ambers and their reason, and anything else in this
       whole app you feel the MD and FD and Sales Director will want to
       go through the sales and marketing team with bi-weekly ... ensure
       it's in a proper meeting order and not all over the show, easy to
       present, quickly runnable.

     THE ORDER IS THE FEATURE. A meeting runs in one direction:

       1. problems      the reds and ambers, with their reasons. Nothing
                        else matters if a customer is walking.
       2. money in      what Protean invoiced, against last year.
       3. what closed   won deals and new FleetSmart+ contracts: the
                        good news, early, because a meeting that opens
                        with problems and never reaches wins is a
                        meeting people dread.
       4. what is open  pipeline by person, so the sales director can
                        ask about a name rather than a number.
       5. what is late  open jobs and anything gone quiet.
       6. what is next  the diary: who is seeing whom before the next
                        one of these.

     Anybody can switch a section off. Nobody has to reorder them,
     because the order is the point.
     ============================================================= */
  {
    slug: 'biweekly',
    title: 'Bi-weekly meeting',
    blurb: 'The whole picture, in the order a meeting takes it. Reds first, diary last.',
    category: 'meeting',
    uses: { divisions: true, period: true, person: false },
    sections: [
      { id: 'health',     label: 'Reds and ambers' },
      { id: 'revenue',    label: 'Invoiced revenue' },
      { id: 'won',        label: 'What closed' },
      { id: 'fleetsmart', label: 'New FleetSmart+ contracts' },
      { id: 'pipeline',   label: 'Pipeline by person' },
      { id: 'newleads',   label: 'Leads opened' },
      { id: 'openjobs',   label: 'Open jobs' },
      { id: 'stock',      label: 'Trailer stock' },
      { id: 'quiet',      label: 'Gone quiet' },
      { id: 'diary',      label: 'In the diary' },
    ],
  },

  {
    slug: 'top-customers',
    title: 'Top 10 customers',
    blurb: 'Biggest spenders this year, with what they spent last year beside it.',
    category: 'customers',
    uses: { divisions: true, period: false, person: false },
    sections: [
      { id: 'top', label: 'The top ten' },
      { id: 'share', label: 'What they are worth together' },
    ],
  },

  {
    slug: 'bottom-customers',
    title: 'Bottom 10 customers',
    blurb: 'Live accounts spending the least. Who is worth a call, and who is barely trading.',
    category: 'customers',
    uses: { divisions: true, period: false, person: false },
    sections: [
      { id: 'bottom', label: 'The bottom ten' },
    ],
  },

  {
    slug: 'growth-revenue',
    title: 'Biggest increases, by value',
    blurb: 'Who is spending more than last year, in pounds.',
    category: 'customers',
    uses: { divisions: true, period: false, person: false },
    sections: [
      { id: 'up', label: 'Spending more' },
      { id: 'down', label: 'Spending less' },
    ],
  },

  {
    slug: 'growth-volume',
    title: 'Biggest increases, by volume',
    blurb: 'Who is sending us more work, counted in invoices rather than pounds.',
    category: 'customers',
    uses: { divisions: true, period: false, person: false },
    sections: [
      { id: 'up', label: 'More jobs than last year' },
      { id: 'down', label: 'Fewer jobs than last year' },
    ],
  },

  {
    slug: 'won',
    title: 'Won leads',
    blurb: 'What closed, by whom, over any period and any division.',
    category: 'pipeline',
    uses: { divisions: true, period: true, person: true },
    sections: [
      { id: 'summary', label: 'The headline' },
      { id: 'deals', label: 'Every deal' },
    ],
  },

  {
    slug: 'pipeline',
    title: 'Open pipeline',
    blurb: 'What is being worked, by person and by stage.',
    category: 'pipeline',
    uses: { divisions: true, period: false, person: true },
    sections: [
      { id: 'byperson', label: 'By person' },
      { id: 'bystage', label: 'By stage' },
      { id: 'biggest', label: 'The biggest open deals' },
    ],
  },

  {
    slug: 'health',
    title: 'Customer problems',
    blurb: 'Every open red and amber, how long it has been open, and whether it has been chased.',
    category: 'customers',
    uses: { divisions: false, period: false, person: false },
    sections: [
      { id: 'open', label: 'Open now' },
      { id: 'due', label: 'Due a chase' },
      { id: 'closed', label: 'Closed recently' },
    ],
  },

  {
    slug: 'operations',
    title: 'Stock and open jobs',
    blurb: 'What is on the yard and what is in the workshop.',
    category: 'operations',
    uses: { divisions: true, period: false, person: false },
    sections: [
      { id: 'stock', label: 'Trailer stock' },
      { id: 'openjobs', label: 'Open jobs' },
      { id: 'oldest', label: 'Oldest open jobs' },
    ],
  },
];

export function reportBySlug(slug: string): ReportDef | null {
  return REPORTS.find((r) => r.slug === slug) ?? null;
}

export function reportsByCategory(): { category: ReportCategory; reports: ReportDef[] }[] {
  const order: ReportCategory[] = ['meeting', 'customers', 'pipeline', 'operations'];
  return order
    .map((category) => ({ category, reports: REPORTS.filter((r) => r.category === category) }))
    .filter((g) => g.reports.length > 0);
}
