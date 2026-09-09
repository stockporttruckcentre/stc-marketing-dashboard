/* =============================================================
   What this app can actually do.

   The intent catalogue handles sentences. This handles the rest: every
   screen that exists, what people call it, and what you can do once you
   are there. Without it, typing a bare word like "meeting" matched
   nothing and the bar sat there doing nothing, which is the fastest way
   to teach somebody that a search box is not worth using.

   Keep this in step with the sidebar. If a screen is added there and not
   here, the toolbar cannot reach it.
   ============================================================= */

export type Feature = {
  id: string;
  /** What it is called in the sidebar. */
  title: string;
  path: string;
  /** Everything a person might type instead of the title. */
  aliases: string[];
  /** One line, shown under the suggestion. */
  blurb: string;
  /** Commands that make sense here, offered alongside the screen itself. */
  actions?: { label: string; phrase: string }[];
};

export const FEATURES: Feature[] = [
  {
    id: 'work', title: 'Work', path: '/dashboard/work',
    /* Not "jobs" alone: in a workshop a job is a booked in vehicle, and
       that word will want to mean the other thing later. "Job" is still
       an object word on the action itself, which is where it can lose a
       fair fight rather than claiming the screen outright. */
    aliases: ['work', 'tasks', 'todo', 'to do', 'my work', 'my tasks', 'workload'],
    blurb: 'Tasks, delegation and projects, through saved views',
    actions: [
      { label: 'Raise a task', phrase: 'add task ' },
      { label: 'What is stuck', phrase: 'blocked work' },
    ],
  },
  {
    id: 'calendar', title: 'Diary', path: '/dashboard/calendar',
    aliases: ['meeting', 'meetings', 'diary', 'appointment', 'appointments', 'calendar', 'schedule', 'events', 'availability', 'agenda', 'calls', 'site visits'],
    blurb: 'Every call, meeting, visit and inspection, and who has answered',
    actions: [
      { label: 'Schedule a call', phrase: 'schedule a call for ' },
      { label: 'Show my meetings this week', phrase: 'show my meetings this week' },
    ],
  },
  {
    id: 'crm', title: 'CRM pipeline', path: '/dashboard/crm',
    /* Not "companies": in this application's own vocabulary a company
       is one we do not have yet, which is the finder. Customers,
       contacts and accounts are this screen. */
    aliases: ['crm', 'contacts', 'customers', 'clients', 'accounts', 'prospects', 'leads', 'pipeline'],
    blurb: 'Shared and personal contact lists',
    actions: [
      { label: 'Add a prospect', phrase: 'add prospect ' },
      { label: 'Find a customer', phrase: 'show me ' },
    ],
  },
  {
    id: 'tracker', title: 'Sales tracker', path: '/dashboard/leads',
    aliases: ['tracker', 'my deals', 'my pipeline', 'proposals', 'quotes', 'commission', 'deals', 'opportunities'],
    blurb: 'Your own pipeline, and what you have earned',
    actions: [
      { label: 'Generate a proposal', phrase: 'generate a proposal for ' },
      { label: 'What has gone quiet', phrase: 'show me stalled proposals' },
    ],
  },
  {
    id: 'stock', title: 'Trailer stock', path: '/dashboard/sales',
    aliases: ['stock', 'stocklist', 'stock list', 'trailers', 'inventory', 'units', 'fleet', 'vehicles'],
    blurb: 'Every trailer, across six statuses',
    actions: [
      { label: 'Add a trailer', phrase: 'create trailer STC' },
      { label: 'What have we sold recently', phrase: 'how many trailers have we sold in the past 4 weeks' },
    ],
  },
  {
    id: 'fleetsmart', title: 'FleetSmart+', path: '/dashboard/fleetsmart',
    /* "Fleet" alone belongs to the stock screen, which had it first and
       means a set of trailers by it. These all say contract or
       FleetSmart out loud so neither screen takes the other's word. */
    aliases: ['fleetsmart', 'fleet smart', 'fleetsmart plus', 'maintenance contract',
              'maintenance contracts', 'service contract', 'r and m', 'contract builder'],
    blurb: 'Fixed price maintenance contracts, priced off the rate card',
    actions: [
      { label: 'Build a contract', phrase: 'build a maintenance contract' },
      { label: 'What is with customers', phrase: 'fleetsmart' },
    ],
  },
  /* Analytics is a landing and seven screens now, not one page.

     The landing answers "how are we doing" in thirty seconds and the
     rest are the thirty minutes: each is its own route, so each is its
     own screen here. Leaving them out kept the aliases on the landing,
     and "leaderboard" then reached a page that no longer has one. */
  {
    id: 'analytics', title: 'Analytics', path: '/dashboard/analytics',
    aliases: ['analytics', 'reports', 'reporting', 'figures', 'numbers', 'performance'],
    blurb: 'The thirty second view: group revenue, target, divisions and what needs attention',
    actions: [
      { label: 'How far from target', phrase: 'how much do we need to invoice to hit target' },
    ],
  },
  {
    id: 'analyticsRevenue', title: 'Revenue analysis', path: '/dashboard/analytics/revenue',
    aliases: ['revenue', 'profit', 'indexed trend', 'division trend', 'revenue drill down',
              'what moved the group number'],
    blurb: 'Indexed division trend, how the group number moved, and the target position',
  },
  {
    id: 'analyticsPipeline', title: 'Sales and pipeline analysis', path: '/dashboard/analytics/pipeline',
    aliases: ['pipeline detail', 'lead sources', 'where leads come from', 'source flow',
              'pipeline drill down'],
    blurb: 'Where leads came from and what became of them',
  },
  {
    id: 'analyticsCustomers', title: 'Customer analysis', path: '/dashboard/analytics/customers',
    aliases: ['customer analysis', 'spend by customer', 'who is spending',
              'customer movement', 'customers drill down'],
    blurb: 'Who is spending, and who has moved',
  },
  {
    id: 'analyticsStock', title: 'Stock analysis', path: '/dashboard/analytics/stock',
    aliases: ['stock age', 'stock ageing', 'old stock', 'what to discount'],
    blurb: 'Age against margin, and what is tied up',
  },
  {
    id: 'analyticsBook', title: 'FleetSmart+ book', path: '/dashboard/analytics/fleetsmart',
    aliases: ['contract book', 'the book', 'recurring revenue', 'contract retention',
              'tier mix', 'annualised contracts'],
    blurb: 'Weekly contracted value, tier mix and retention by cohort',
  },
  {
    /* Not "People analysis". The word people belongs to the Team
       directory, and the title has to reach its own screen: "people
       analysis" landed on Team, Admin and the exceptions list and
       never on this one. */
    id: 'analyticsPeople', title: 'Conversion and leaderboard', path: '/dashboard/analytics/people',
    aliases: ['leaderboard', 'who is closing', 'who is selling', 'conversion rate',
              'win rate', 'close rate', 'sales leaderboard'],
    blurb: 'Leaderboard and conversion against the group rate',
  },
  {
    id: 'analyticsTargets', title: 'Targets', path: '/dashboard/analytics/targets',
    aliases: ['targets', 'revenue target', 'monthly target', 'the budget',
              'set a target', 'division target'],
    blurb: 'Monthly revenue targets for the financial year, group and per division',
  },
  {
    id: 'finder', title: 'Company finder', path: '/dashboard/finder',
    aliases: ['finder', 'prospecting', 'lusha', 'companies', 'find companies', 'new business',
              'search companies'],
    blurb: 'Find companies near a depot and add them to the CRM',
  },
  {
    id: 'news', title: 'Industry news', path: '/dashboard/news',
    aliases: ['news', 'press', 'industry', 'insolvency', 'gazette', 'administration', 'updates'],
    blurb: 'Trade press and insolvency notices matched to customers',
  },
  {
    id: 'social', title: 'Social planner', path: '/dashboard/social',
    aliases: ['social', 'posts', 'marketing', 'facebook', 'linkedin', 'instagram', 'content'],
    blurb: 'Draft, approve and schedule posts',
  },
  {
    id: 'brand', title: 'Brand kit', path: '/dashboard/brand',
    aliases: ['brand', 'logo', 'logos', 'fonts', 'colours', 'colors', 'assets', 'artwork'],
    blurb: 'Logos, fonts and colour swatches',
  },
  /* Two screens where there was one. The directory belongs to
     everybody and the permission hub does not, so the words divide the
     same way: who works here against who can do what. */
  {
    id: 'team', title: 'Team', path: '/dashboard/team',
    aliases: ['team', 'staff', 'people', 'colleagues', 'directory', 'who works here'],
    blurb: 'Who works here and what they look after',
  },
  {
    id: 'admin', title: 'Admin', path: '/dashboard/admin',
    aliases: ['admin', 'users', 'roles', 'permissions', 'manage users', 'user management'],
    blurb: 'Roles, permissions and accounts',
  },
  {
    id: 'settings', title: 'Settings', path: '/dashboard/settings',
    aliases: ['settings', 'preferences', 'password', 'theme', 'dark mode', 'light mode', 'my account'],
    blurb: 'Your name, password, theme and what you can do',
  },
  {
    id: 'dashboard', title: 'Dashboard', path: '/dashboard',
    aliases: ['dashboard', 'home', 'overview', 'today', 'my day', 'start'],
    blurb: 'Where you are now',
  },
];

export type Suggestion = {
  kind: 'feature' | 'action';
  label: string;
  sub: string;
  /** Navigate here, or seed the bar with this phrase. */
  path?: string;
  phrase?: string;
  score: number;
};

/**
 * Rank the whole feature surface against whatever has been typed.
 * Runs on every keystroke, so it stays simple: substring and prefix
 * matching over titles and aliases.
 */
export function suggestFeatures(input: string, limit = 6): Suggestion[] {
  const q = input.trim().toLowerCase();
  if (!q) return [];

  const out: Suggestion[] = [];
  for (const f of FEATURES) {
    let best = 0;
    const targets = [f.title.toLowerCase(), ...f.aliases];
    for (const t of targets) {
      if (t === q) best = Math.max(best, 100);
      else if (t.startsWith(q)) best = Math.max(best, 80 - (t.length - q.length));
      else if (q.length >= 3 && t.includes(q)) best = Math.max(best, 55);
      else if (q.length >= 4 && q.includes(t) && t.length >= 4) best = Math.max(best, 45);
    }
    if (!best) continue;

    out.push({
      kind: 'feature', label: `Open ${f.title}`, sub: f.blurb,
      path: f.path, score: best,
    });
    for (const a of f.actions ?? []) {
      out.push({
        kind: 'action', label: a.label, sub: `In ${f.title}`,
        phrase: a.phrase, score: best - 5,
      });
    }
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}

export function featureByPath(path: string): Feature | undefined {
  return FEATURES.find((f) => f.path === path);
}
