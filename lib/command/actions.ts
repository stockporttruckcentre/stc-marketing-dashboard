/* =============================================================
   Everything the command bar can do.

   The bar is not a stock search. It is the way into the whole product:
   go somewhere, make something, count something, export something, book
   something, change somebody's role, sign out. If a person can do it in
   this app, they should be able to type it here.

   Two rules this file exists to enforce.

   ONE ENTRY PER THING THE APP DOES. A feature that is not listed here
   cannot be reached by typing, which makes it invisible to anybody who
   works from the keyboard. The coverage check sweeps this list, so an
   action added without its words fails the build rather than being
   discovered missing by a user.

   NOTHING YOU CANNOT DO IS EVER OFFERED. Every action names the
   capability it needs. A read only viewer typing "delete" gets nothing,
   because offering an action that then refuses is worse than not
   offering it: it teaches people the tool is unreliable. "Elevate Dave
   to admin" works for an administrator and does not exist for anybody
   else.

   That gating is interface only, same as the rest of lib/crm/permissions.
   The routes behind these actions do their own checks.
   ============================================================= */
import type { CrmCapability, CrmCapabilities } from '@/lib/crm/permissions';

export type ActionKind =
  | 'navigate'   // take me to a screen
  | 'create'     // make a record
  | 'record'     // do something to a record I have to name
  | 'data'       // import, export, report
  | 'session'    // me: sign out, theme, profile
  | 'admin';     // other people: roles, access

export type CommandActionSpec = {
  id: string;
  label: string;
  /** One line under the suggestion. */
  blurb: string;
  kind: ActionKind;
  /** Needed to see this at all. Undefined means everybody. */
  capability?: CrmCapability;
  /** Where it goes, when it is a plain navigation. */
  path?: string;
  /**
   * What somebody types. Written as separate verb and object groups so
   * the two multiply rather than having to be listed together: eight
   * verbs and six objects is forty eight phrasings from fourteen words.
   */
  verbs?: string[];
  objects: string[];
  /** Whole phrases that name this action on their own. */
  phrases?: string[];
  /** Seeded into the bar when picked, for actions that need more said. */
  seed?: string;
};

/* -------------------------------------------------------------
   Verb groups, shared across actions so a synonym added once works
   everywhere it should.
   ------------------------------------------------------------- */
const GO = ['go to', 'open', 'show', 'view', 'take me to', 'jump to', 'see', 'find', 'where is', 'load', 'bring up'];
const MAKE = ['add', 'create', 'new', 'make', 'set up', 'start', 'raise', 'log', 'enter', 'put in', 'record'];
const REMOVE = ['delete', 'remove', 'bin', 'get rid of', 'drop', 'archive'];
const SEND = ['send', 'email', 'share', 'forward', 'issue'];
const CHANGE = ['change', 'edit', 'update', 'amend', 'set', 'switch', 'move'];
const PULL = ['export', 'download', 'save', 'pull', 'extract', 'get'];
const PUSH = ['import', 'upload', 'load in', 'bring in', 'attach'];

export const ACTIONS: CommandActionSpec[] = [
  /* ---------- navigation: every screen in the sidebar ---------- */
  { id: 'nav.dashboard', label: 'Dashboard', blurb: 'Your day at a glance', kind: 'navigate',
    path: '/dashboard', verbs: GO,
    objects: ['dashboard', 'home', 'overview', 'my day', 'workspace', 'front page', 'start', 'today', 'whats on today', 'my morning'] },

  { id: 'nav.crm', label: 'CRM pipeline', blurb: 'Contacts, lists and accounts', kind: 'navigate',
    path: '/dashboard/crm', verbs: GO,
    objects: ['crm', 'contacts', 'customers', 'clients', 'companies', 'accounts', 'pipeline', 'prospects', 'address book'] },

  { id: 'nav.tracker', label: 'Sales tracker', blurb: 'Your own deals and commission', kind: 'navigate',
    path: '/dashboard/leads', verbs: GO,
    objects: ['tracker', 'sales tracker', 'my deals', 'my leads', 'my pipeline', 'commission', 'my tracker', 'proposals', 'quotes', 'deals', 'opportunities', 'my quotes'] },

  { id: 'nav.stock', label: 'Trailer stock', blurb: 'Every unit and its status', kind: 'navigate',
    path: '/dashboard/sales', verbs: GO,
    objects: ['stock', 'stock list', 'stocklist', 'trailers', 'units', 'fleet', 'yard', 'inventory'] },

  { id: 'nav.calendar', label: 'Team calendar', blurb: 'Meetings, calls and visits', kind: 'navigate',
    path: '/dashboard/calendar', verbs: GO,
    objects: ['calendar', 'diary', 'meetings', 'appointments', 'schedule', 'agenda', 'whats on', 'events', 'availability', 'whos free', 'free time'] },

  { id: 'nav.analytics', label: 'Analytics', blurb: 'Revenue, leaderboards and trends', kind: 'navigate',
    path: '/dashboard/analytics', verbs: GO,
    objects: ['analytics', 'reports', 'reporting', 'figures', 'numbers', 'stats', 'performance', 'kpis', 'charts', 'revenue', 'profit', 'leaderboard', 'targets', 'how are we doing'] },

  { id: 'nav.news', label: 'Industry news', blurb: 'Haulage press in one place', kind: 'navigate',
    path: '/dashboard/news', verbs: GO,
    objects: ['news', 'industry news', 'press', 'headlines', 'articles', 'whats happening', 'trade press', 'insolvency', 'gazette', 'administration', 'liquidations', 'updates'] },

  { id: 'nav.finder', label: 'Company finder', blurb: 'Prospecting near a depot', kind: 'navigate',
    path: '/dashboard/finder', verbs: GO,
    objects: ['finder', 'company finder', 'lusha', 'prospecting', 'find companies', 'lead search', 'new business', 'search companies', 'cold leads'] },

  { id: 'nav.social', label: 'Social planner', blurb: 'Posts, approvals and schedule', kind: 'navigate',
    path: '/dashboard/social', verbs: GO, capability: 'marketing.edit',
    objects: ['social', 'social planner', 'posts', 'marketing', 'linkedin', 'content', 'campaign', 'facebook', 'instagram', 'socials'] },

  { id: 'nav.brand', label: 'Brand kit', blurb: 'Logos, fonts and templates', kind: 'navigate',
    path: '/dashboard/brand', verbs: GO,
    objects: ['brand', 'brand kit', 'logos', 'assets', 'fonts', 'templates', 'artwork', 'colours', 'colors', 'branding'] },

  { id: 'nav.team', label: 'Team', blurb: 'Who has access and to what', kind: 'navigate',
    path: '/dashboard/admin', verbs: GO, capability: 'admin.users',
    objects: ['team', 'users', 'staff', 'people', 'admin', 'permissions', 'roles', 'access'] },

  { id: 'nav.settings', label: 'Settings', blurb: 'Your profile and theme', kind: 'navigate',
    path: '/dashboard/settings', verbs: GO,
    objects: ['settings', 'preferences', 'options', 'my profile', 'account settings', 'config', 'password', 'change my password'] },

  /* ---------- making things ---------- */
  { id: 'make.contact', label: 'Add a contact', blurb: 'A new company on the CRM', kind: 'create',
    capability: 'crm.create', path: '/dashboard/crm', verbs: MAKE, seed: 'add contact ',
    objects: ['contact', 'customer', 'company', 'client', 'account', 'prospect', 'lead', 'business'] },

  { id: 'make.trailer', label: 'Add a trailer', blurb: 'A unit onto the stock list', kind: 'create',
    capability: 'stock.edit', path: '/dashboard/sales', verbs: MAKE, seed: 'add trailer ',
    objects: ['trailer', 'unit', 'stock', 'vehicle', 'trailer to stock', 'stock item'] },

  { id: 'make.meeting', label: 'Book a meeting', blurb: 'Into your diary or a colleague’s', kind: 'create',
    capability: 'crm.delegate', path: '/dashboard/calendar', verbs: [...MAKE, 'book', 'schedule', 'arrange', 'diarise', 'put in'],
    objects: ['meeting', 'visit', 'appointment', 'site visit', 'catch up'],
    phrases: ['schedule a meeting', 'book a visit', 'set up a meeting'] },

  { id: 'make.call', label: 'Schedule a call', blurb: 'A reminder to ring somebody', kind: 'create',
    capability: 'crm.delegate', path: '/dashboard/calendar', verbs: [...MAKE, 'book', 'schedule', 'arrange', 'diarise'],
    objects: ['call', 'phone call', 'callback', 'call back', 'ring', 'follow up call'],
    phrases: ['schedule a call', 'remind me to call', 'chase them'] },

  { id: 'make.note', label: 'Add a note', blurb: 'Onto a customer record', kind: 'create',
    capability: 'crm.edit', verbs: MAKE, seed: 'add note ',
    objects: ['note', 'comment', 'file note', 'remark', 'record of the call'] },

  { id: 'make.list', label: 'New CRM list', blurb: 'A working list of your own', kind: 'create',
    capability: 'crm.manageLists', path: '/dashboard/crm', verbs: MAKE,
    objects: ['list', 'crm list', 'working list', 'group', 'segment'] },

  { id: 'make.proposal', label: 'Generate a proposal', blurb: 'Trailer sales, maintenance or rental', kind: 'create',
    capability: 'crm.proposal', verbs: [...MAKE, 'generate', 'quote', 'propose', 'price up', 'work up'],
    objects: ['proposal', 'quote', 'quotation', 'offer', 'pricing', 'contract'],
    phrases: ['generate a proposal', 'quote them for'] },

  { id: 'make.post', label: 'New social post', blurb: 'Draft for approval', kind: 'create',
    capability: 'marketing.edit', path: '/dashboard/social', verbs: MAKE,
    objects: ['post', 'social post', 'flyer', 'advert', 'ad', 'linkedin post'] },

  /* ---------- doing things to a record ---------- */
  { id: 'rec.assign', label: 'Assign an account', blurb: 'Put it in somebody’s portfolio', kind: 'record',
    capability: 'crm.assign', verbs: [...CHANGE, 'assign', 'give', 'hand', 'allocate', 'transfer'],
    objects: ['owner', 'account owner', 'assigned to', 'portfolio', 'rep'],
    phrases: ['assign to', 'give this to', 'hand over to'] },

  { id: 'rec.markSold', label: 'Mark a trailer sold', blurb: 'Moves it out of stock', kind: 'record',
    capability: 'stock.edit', verbs: [...CHANGE, 'mark'],
    objects: ['sold', 'as sold', 'to sold', 'sold status'],
    phrases: ['mark as sold', 'this one is sold'] },

  /* Editing a field by typing it, rather than finding the row, opening
     the drawer and finding the box. lib/command/fields.ts holds the
     column list and lib/command/mutate.ts reads the sentence; this entry
     is how somebody discovers that the bar can do it at all. */
  { id: 'rec.editTrailerField', label: 'Change a trailer detail', blurb: 'Refurb cost, location, MOT, price', kind: 'record',
    capability: 'stock.edit', verbs: [...CHANGE, 'add', 'knock', 'clear'],
    objects: ['refurb cost', 'refurb', 'nbv', 'book value', 'retail price', 'mot', 'mot date',
              'trailer location', 'trailer detail', 'trailer field', 'stock detail'],
    phrases: ['add refurb', 'change the refurb', 'update the mot', 'move it to'],
    seed: 'set refurb cost on STC' },

  { id: 'rec.editContactField', label: 'Change a customer detail', blurb: 'Owner, status, phone, next action', kind: 'record',
    capability: 'crm.edit', verbs: [...CHANGE, 'add', 'clear'],
    objects: ['customer detail', 'contact detail', 'phone number', 'email address',
              'next action', 'fleet size', 'estimated value', 'customer field'],
    phrases: ['update the customer', 'change their number', 'set the next action'],
    seed: 'set next action on ' },

  { id: 'rec.delete', label: 'Delete a record', blurb: 'Gone, with a confirmation first', kind: 'record',
    capability: 'crm.delete', verbs: REMOVE,
    objects: ['contact', 'customer', 'trailer', 'record', 'row', 'list', 'note'] },

  { id: 'rec.link', label: 'Link two accounts', blurb: 'The same customer on both sides', kind: 'record',
    capability: 'crm.edit', verbs: ['link', 'join', 'connect', 'merge', 'twin', 'pair'],
    objects: ['accounts', 'records', 'customers', 'duplicates', 'same customer'] },

  { id: 'rec.docusign', label: 'Open DocuSign', blurb: 'To build and send the envelope', kind: 'record',
    capability: 'crm.proposal', verbs: [...SEND, 'sign', 'open'],
    objects: ['docusign', 'for signature', 'signing', 'e-sign', 'esign', 'signature'],
    phrases: ['send for signature', 'get this signed'] },

  /* ---------- data in and out ---------- */
  { id: 'data.exportCustomer', label: 'Export a customer', blurb: 'PDF, Excel, Word or email', kind: 'data',
    capability: 'crm.export', verbs: [...PULL, ...SEND],
    objects: ['customer', 'account summary', 'customer record', 'contact', 'this account'],
    phrases: ['export the customer', 'send the account over'] },

  { id: 'data.exportList', label: 'Export a list', blurb: 'The rows you are looking at, as CSV', kind: 'data',
    capability: 'crm.export', verbs: PULL,
    objects: ['list', 'csv', 'spreadsheet', 'the contacts', 'this view', 'these rows', 'report'] },

  { id: 'data.import', label: 'Import a spreadsheet', blurb: 'With a mapping and duplicate check', kind: 'data',
    capability: 'crm.import', verbs: PUSH,
    objects: ['spreadsheet', 'csv', 'excel', 'file', 'contacts', 'stock', 'data', 'sheet'] },

  { id: 'data.enrich', label: 'Enrich from Lusha', blurb: 'Fill in missing contact details', kind: 'data',
    capability: 'crm.enrich', verbs: ['enrich', 'lookup', 'look up', 'find details for', 'fill in'],
    objects: ['lusha', 'details', 'contact details', 'email address', 'phone number'] },

  /* ---------- me ---------- */
  { id: 'me.signOut', label: 'Sign out', blurb: 'End this session', kind: 'session',
    verbs: ['log', 'sign', 'switch'],
    objects: ['out', 'off', 'me out', 'log out', 'sign out', 'logout', 'signout', 'user'],
    phrases: ['log me out', 'sign me out', 'log out', 'sign out', 'logout', 'exit'] },

  { id: 'me.theme', label: 'Switch theme', blurb: 'Light or dark', kind: 'session',
    path: '/dashboard/settings', verbs: [...CHANGE, 'toggle'],
    objects: ['theme', 'dark mode', 'light mode', 'dark', 'light', 'appearance', 'colours'] },

  { id: 'me.profile', label: 'My profile', blurb: 'Your name and details', kind: 'session',
    path: '/dashboard/settings', verbs: [...GO, ...CHANGE],
    objects: ['my profile', 'my details', 'my name', 'my account', 'my settings'] },

  /* ---------- other people ----------
     Everything here is invisible without admin.users, which is the case
     the requirement named: "elevate dave to admin" works for one person
     and does not exist for anybody else. */
  { id: 'admin.role', label: 'Change somebody’s role', blurb: 'Admin, sales, restricted or read only', kind: 'admin',
    capability: 'admin.users', path: '/dashboard/admin', seed: 'make ',
    verbs: ['make', 'set', 'change', 'elevate', 'promote', 'demote', 'upgrade', 'downgrade', 'grant', 'give'],
    objects: ['admin', 'administrator', 'role', 'access', 'permissions', 'sales', 'viewer', 'read only', 'restricted'],
    phrases: ['elevate to admin', 'make them an admin', 'give them access', 'take their access away'] },

  { id: 'admin.addUser', label: 'Add a user', blurb: 'Somebody new on the system', kind: 'admin',
    capability: 'admin.users', path: '/dashboard/admin', verbs: MAKE,
    objects: ['user', 'member', 'colleague', 'someone', 'staff member', 'to the team'] },

  { id: 'admin.dashboard', label: 'Set somebody’s dashboard', blurb: 'Rep, exec or support view', kind: 'admin',
    capability: 'admin.users', path: '/dashboard/admin', verbs: [...CHANGE, 'give'],
    objects: ['dashboard', 'their dashboard', 'exec view', 'exec dashboard', 'rep view', 'landing page'] },
];

/* =============================================================
   Matching.
   ============================================================= */

const fold = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

export type ActionHit = { action: CommandActionSpec; score: number; matched: string };

/**
 * Actions matching what has been typed, best first, with anything the
 * person cannot do removed before scoring rather than after.
 *
 * Scoring, highest first:
 *   100  a whole phrase that names the action
 *    80  a verb and an object, in either order
 *    55  an object on its own
 *    35  a distinctive object as a prefix, for half typed words
 */
export function suggestActions(input: string, caps: CrmCapabilities, limit = 6): ActionHit[] {
  const q = fold(input);
  if (q.length < 2) return [];
  const words = q.split(' ');

  const hits: ActionHit[] = [];

  for (const a of ACTIONS) {
    if (a.capability && !caps.has(a.capability)) continue;

    let best: { score: number; matched: string } | null = null;
    const take = (score: number, matched: string) => {
      if (!best || score > best.score) best = { score, matched };
    };

    for (const p of a.phrases ?? []) {
      if (q.includes(fold(p))) take(100, p);
    }

    const objectHit = (a.objects ?? []).find((o) => q.includes(fold(o)));
    const verbHit = (a.verbs ?? []).find((v) => q.includes(fold(v)));

    // Word order does not matter. "open the stock list" and "stock list,
    // open it" are the same instruction.
    if (objectHit && verbHit) take(80, `${verbHit} ${objectHit}`);
    else if (objectHit) take(55, objectHit);
    // A verb on its own is a real thing to type. "Export" used to score
    // nothing at all, because only objects were counted, so the bar told
    // somebody their perfectly ordinary word was not a word.
    else if (verbHit) take(45, verbHit);

    if (!best) {
      // Half typed: "analyt" should already be offering Analytics.
      const prefix = (a.objects ?? []).find(
        (o) => o.length >= 4 && words.some((w) => w.length >= 3 && o.startsWith(w)),
      );
      if (prefix) take(35, prefix);
    }

    if (best) hits.push({ action: a, score: (best as { score: number }).score, matched: (best as { matched: string }).matched });
  }

  return hits
    .sort((x, y) => y.score - x.score || x.action.label.localeCompare(y.action.label))
    .slice(0, limit);
}

/** Everything this person can do, for the empty state and for the checks. */
export function availableActions(caps: CrmCapabilities): CommandActionSpec[] {
  return ACTIONS.filter((a) => !a.capability || caps.has(a.capability));
}
