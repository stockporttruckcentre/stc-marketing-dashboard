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
    id: 'calendar', title: 'Team calendar', path: '/dashboard/calendar',
    aliases: ['meeting', 'meetings', 'diary', 'appointment', 'appointments', 'calendar', 'schedule', 'events', 'availability', 'agenda'],
    blurb: 'Meetings and events, with who can see them',
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
    id: 'analytics', title: 'Analytics', path: '/dashboard/analytics',
    aliases: ['analytics', 'reports', 'reporting', 'figures', 'numbers', 'performance', 'revenue', 'profit', 'leaderboard', 'targets'],
    blurb: 'Revenue, profit, leaderboard and stock mix',
    actions: [
      { label: 'How far from target', phrase: 'how much do we need to invoice to hit target' },
    ],
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
  {
    id: 'team', title: 'Team', path: '/dashboard/admin',
    aliases: ['team', 'users', 'staff', 'roles', 'permissions', 'people', 'admin'],
    blurb: 'Who has access, and at what level',
  },
  {
    id: 'settings', title: 'Settings', path: '/dashboard/settings',
    aliases: ['settings', 'preferences', 'password', 'theme', 'dark mode', 'light mode', 'my account'],
    blurb: 'Your name, password and theme',
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
