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
    /* NOT "companies". `lib/command/finder.ts` is explicit that a
       company is one we do NOT have: "show me 20 customers near Hyde"
       is this screen and "show me 20 companies near Hyde" is the
       finder, one word apart. Claiming the word here sent every
       prospecting sentence to the account list. */
    objects: ['crm', 'contacts', 'customers', 'clients', 'accounts', 'pipeline', 'prospects', 'address book'] },

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
    objects: ['finder', 'companies', 'company', 'firms', 'businesses', 'hauliers', 'company finder', 'lusha', 'prospecting', 'find companies', 'lead search', 'new business', 'search companies', 'cold leads'] },

  /* `social.view` rather than `marketing.edit`, which is what it asked
     for before. The screen is readable by everybody who can read
     content, and gating navigation on the permission to WRITE meant a
     viewer could see the planner in the sidebar and not reach it by
     typing its own name. */
  { id: 'nav.social', label: 'Social planner', blurb: 'Posts, approvals and schedule', kind: 'navigate',
    path: '/dashboard/social', verbs: GO, capability: 'social.view',
    objects: ['social', 'social planner', 'planner', 'posts', 'marketing', 'linkedin',
              'content', 'campaign', 'facebook', 'instagram', 'socials',
              'content calendar', 'social calendar', 'the content planner'] },

  { id: 'nav.contentQueue', label: 'The posting queue', blurb: 'Posting times per channel', kind: 'navigate',
    path: '/dashboard/social?tab=queue', verbs: GO, capability: 'social.view',
    objects: ['queue', 'posting queue', 'posting times', 'slots', 'posting slots'] },

  { id: 'nav.contentLibrary', label: 'The content library', blurb: 'Pictures the company keeps', kind: 'navigate',
    path: '/dashboard/social?tab=library', verbs: GO, capability: 'social.view',
    objects: ['library', 'content library', 'media library', 'the pictures'] },

  { id: 'nav.contentApprovals', label: 'Posts waiting for approval', blurb: 'Everything sat with an approver', kind: 'navigate',
    path: '/dashboard/social?needs=review', verbs: [...GO, 'show', 'list'], capability: 'social.view',
    objects: ['approvals', 'posts waiting', 'pending posts', 'what needs approving',
              'the approval queue', 'posts for review', 'outstanding posts'],
    phrases: ['what content needs approving', 'show me the posts waiting for approval'] },

  { id: 'nav.contentChannels', label: 'Channels', blurb: 'The accounts content goes out to', kind: 'navigate',
    path: '/dashboard/social?tab=channels', verbs: GO, capability: 'social.channels',
    objects: ['channels', 'connected accounts', 'social accounts', 'the handles'] },

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
    capability: 'social.draft', path: '/dashboard/social?new=1', verbs: MAKE,
    objects: ['post', 'social post', 'flyer', 'advert', 'ad', 'linkedin post',
              'tweet', 'thread', 'draft'] },

  { id: 'make.campaign', label: 'New campaign', blurb: 'Structure above the post', kind: 'create',
    capability: 'social.draft', path: '/dashboard/social', verbs: MAKE,
    objects: ['campaign', 'content campaign', 'launch'] },

  { id: 'make.channel', label: 'Add a channel', blurb: 'An account content goes out to', kind: 'create',
    capability: 'social.channels', path: '/dashboard/social?tab=channels',
    verbs: [...MAKE, 'connect', 'link', 'hook up'],
    objects: ['channel', 'social account', 'handle', 'linkedin page', 'x account'] },

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
    objects: ['spreadsheet', 'csv', 'excel', 'file', 'contacts', 'customers', 'data', 'sheet'] },

  /* Stock is a different file onto a different list, gated on a
     different capability. A marketer may load stock and may not import
     customers, and one entry claiming both would offer whichever one
     they cannot do. */
  { id: 'stock.import', label: 'Load a stock file', blurb: 'A supplier list onto the stock screen', kind: 'data',
    capability: 'stock.edit', verbs: [...PUSH, 'sync', 'resync'],
    objects: ['stock', 'stock list', 'stock file', 'supplier list', 'trailers', 'units', 'inventory'],
    phrases: ['sync the stock list', 'load the supplier spreadsheet'] },

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

  /* NOBODY IS ADDED FROM INSIDE THIS APPLICATION.

     People arrive by signing up, which is Supabase auth and not a
     screen here, and an administrator then promotes them: the team
     screen says so in its own subtitle. There is no invite control, no
     admin API call and nothing holding a service role key to make one
     with, so there is no manual operation for a sentence to match.

     The entry stays, because the question is a real one and the team
     screen is the honest answer to it. What changed is the label: it
     said "add a user" and opened a screen that cannot. */
  { id: 'admin.addUser', label: 'See who has signed up', blurb: 'People join by signing up, then you promote them', kind: 'admin',
    capability: 'admin.users', path: '/dashboard/admin', verbs: MAKE,
    objects: ['user', 'new user', 'member', 'colleague', 'someone', 'staff member', 'to the team'] },

  { id: 'admin.dashboard', label: 'Set somebody’s dashboard', blurb: 'Rep, exec or support view', kind: 'admin',
    capability: 'admin.users', path: '/dashboard/admin', verbs: [...CHANGE, 'give'],
    objects: ['dashboard', 'their dashboard', 'exec view', 'exec dashboard', 'rep view', 'landing page'] },

  /* ---------- the CRM screen itself ----------

     Everything below this point came out of docs/command-bar-inventory.md,
     which is the app read screen by screen and handler by handler. The
     list above it was written from memory, which is how a whole tab ended
     up with no entries at all. Add a feature, add it to the inventory,
     add it here. */

  { id: 'crm.scopeMine', label: 'Just my accounts', blurb: 'Your own portfolio', kind: 'navigate',
    capability: 'crm.edit', path: '/dashboard/crm?scope=mine', verbs: [...GO, 'filter', 'switch to'],
    objects: ['my accounts', 'my customers', 'my portfolio', 'mine', 'my crm', 'my contacts'],
    phrases: ['just mine', 'only my accounts', 'what am i working on'] },

  { id: 'crm.scopeAll', label: 'The whole pipeline', blurb: 'Everybody’s accounts', kind: 'navigate',
    capability: 'crm.viewGlobal', path: '/dashboard/crm?scope=all', verbs: [...GO, 'filter', 'switch to'],
    objects: ['everyone', 'everybody', 'the whole pipeline', 'global crm', 'all accounts', 'the team’s accounts'],
    phrases: ['show me everyone', 'the global list'] },

  { id: 'crm.scopeUnassigned', label: 'Unassigned accounts', blurb: 'Nobody owns these yet', kind: 'navigate',
    capability: 'crm.viewGlobal', path: '/dashboard/crm?scope=unassigned', verbs: GO,
    objects: ['unassigned', 'unowned', 'no owner', 'nobody’s', 'up for grabs', 'unclaimed'],
    phrases: ['who has nobody on them', 'accounts with no rep'] },

  { id: 'crm.scopePerson', label: 'Somebody’s accounts', blurb: 'What a colleague is working on', kind: 'navigate',
    capability: 'crm.viewOthers', path: '/dashboard/crm', verbs: GO,
    objects: ['dave’s accounts', 'their accounts', 'their portfolio', 'somebody’s accounts', 'his accounts', 'her accounts'],
    phrases: ['what is dave working on', 'show me their pipeline'] },

  { id: 'crm.openList', label: 'Open a list', blurb: 'Switch to another working list', kind: 'navigate',
    capability: 'crm.view', path: '/dashboard/crm', verbs: GO,
    objects: ['list', 'working list', 'another list', 'my lists'] },

  { id: 'crm.deleteList', label: 'Delete a list', blurb: 'The list, not the companies on it', kind: 'record',
    capability: 'crm.manageLists', verbs: REMOVE,
    objects: ['list', 'working list', 'this list'],
    phrases: ['get rid of this list'] },

  { id: 'crm.shareList', label: 'Share a list', blurb: 'Give a colleague sight of it', kind: 'record',
    capability: 'crm.manageLists', verbs: [...SEND, 'give', 'grant'],
    objects: ['share a list', 'list access', 'share this list with', 'list sharing'],
    phrases: ['let dave see this list', 'give them the list'] },

  { id: 'crm.unshareList', label: 'Stop sharing a list', blurb: 'Take the access back', kind: 'record',
    capability: 'crm.manageLists', verbs: [...REMOVE, 'revoke', 'take back'],
    objects: ['list access', 'sharing', 'their access to the list'],
    phrases: ['stop sharing this list', 'take the list back'] },

  { id: 'crm.moveToList', label: 'Move rows to a list', blurb: 'Or copy them, leaving the originals', kind: 'record',
    capability: 'crm.edit', verbs: [...CHANGE, 'copy', 'duplicate into', 'file'],
    objects: ['to another list', 'into a list', 'to my tracker', 'between lists'],
    phrases: ['move these to', 'copy this into'] },

  { id: 'crm.search', label: 'Search this list', blurb: 'Filter the rows in front of you', kind: 'navigate',
    capability: 'crm.view', path: '/dashboard/crm', verbs: ['search', 'filter', 'look for', 'narrow'],
    objects: ['this list', 'the rows', 'the crm', 'contacts'] },

  { id: 'rec.unassign', label: 'Unassign an account', blurb: 'Put it back in the pool', kind: 'record',
    capability: 'crm.assign', verbs: [...REMOVE, 'unassign', 'release', 'hand back'],
    objects: ['owner', 'the rep', 'assignment', 'from my portfolio'],
    phrases: ['take this off me', 'put it back in the pool'] },

  { id: 'crm.unlink', label: 'Unlink two accounts', blurb: 'They are separate customers after all', kind: 'record',
    capability: 'crm.edit', verbs: ['unlink', 'separate', 'split', 'detach', 'untwin'],
    objects: ['accounts', 'these two', 'the twin', 'the link'] },

  { id: 'crm.addLink', label: 'Add a link to a record', blurb: 'Website, LinkedIn, Facebook, Instagram or X', kind: 'record',
    capability: 'crm.edit', verbs: MAKE,
    objects: ['website', 'linkedin', 'facebook', 'instagram', 'twitter', 'their site', 'a link', 'url'],
    phrases: ['add their website', 'put their linkedin on'] },

  { id: 'crm.removeLink', label: 'Remove a link', blurb: 'Off the customer record', kind: 'record',
    capability: 'crm.edit', verbs: REMOVE,
    objects: ['link', 'website link', 'their linkedin', 'the url'] },

  { id: 'crm.addAddress', label: 'Add an address', blurb: 'Another site for this customer', kind: 'record',
    capability: 'crm.edit', verbs: MAKE, seed: 'add address ',
    objects: ['address', 'site', 'depot', 'another site', 'their yard', 'location for'],
    phrases: ['add a second site', 'they have another depot'] },

  { id: 'crm.removeAddress', label: 'Remove an address', blurb: 'A site they no longer have', kind: 'record',
    capability: 'crm.edit', verbs: REMOVE,
    objects: ['address', 'site', 'this depot', 'the yard'] },

  { id: 'crm.primaryAddress', label: 'Set the main address', blurb: 'The one that shows on exports', kind: 'record',
    capability: 'crm.edit', verbs: [...CHANGE, 'mark', 'make'],
    objects: ['main address', 'primary address', 'head office', 'main site', 'registered address'],
    phrases: ['make this the main one'] },

  { id: 'crm.showMap', label: 'Show the sites on a map', blurb: 'Every address as a pin', kind: 'record',
    capability: 'crm.view', verbs: [...GO, 'map', 'plot'],
    objects: ['map', 'on the map', 'their sites', 'site map', 'where they are', 'pins'],
    phrases: ['show on map', 'plot their depots'] },

  { id: 'crm.addPin', label: 'Drop a pin', blurb: 'Place a site by hand on the map', kind: 'record',
    capability: 'crm.edit', verbs: [...MAKE, 'drop', 'place'],
    objects: ['pin', 'marker', 'a point on the map'] },

  { id: 'crm.undoPin', label: 'Undo a pin move', blurb: 'Put it back where it was', kind: 'record',
    capability: 'crm.edit', verbs: ['undo', 'revert', 'put back', 'redo'],
    objects: ['pin', 'the move', 'that drag', 'the map change'] },

  { id: 'crm.regeocode', label: 'Re-find an address on the map', blurb: 'Snap the pin back to the postcode', kind: 'record',
    capability: 'crm.edit', verbs: [...CHANGE, 'snap', 'refind', 'relocate'],
    objects: ['pin to the address', 'the geocode', 'back to the postcode'],
    phrases: ['snap it back to the address'] },

  { id: 'data.lushaBalance', label: 'Lusha credits left', blurb: 'What is on the allowance this month', kind: 'data',
    capability: 'crm.view', verbs: [...GO, 'check', 'how many'],
    objects: ['lusha credits', 'credits', 'lusha balance', 'enrichment credits', 'allowance'],
    phrases: ['how many credits have we got'] },

  /* ---------- sales tracker ---------- */

  { id: 'make.lead', label: 'New lead on the tracker', blurb: 'A deal of your own', kind: 'create',
    capability: 'crm.create', path: '/dashboard/leads', verbs: MAKE, seed: 'new lead ',
    objects: ['lead', 'deal', 'opportunity', 'enquiry', 'prospect', 'job'],
    phrases: ['new deal', 'log an enquiry'] },

  { id: 'tracker.fromCrm', label: 'Pull a lead in from the CRM', blurb: 'Onto your own tracker', kind: 'record',
    capability: 'crm.create', path: '/dashboard/leads', verbs: [...PUSH, 'pull', 'copy'],
    objects: ['from the crm', 'from the pipeline', 'onto my tracker', 'into my tracker'],
    phrases: ['pull them onto my tracker', 'take this one on'] },

  { id: 'tracker.linkStock', label: 'Link a trailer to a deal', blurb: 'So the sale knows which unit', kind: 'record',
    capability: 'crm.edit', verbs: ['link', 'attach', 'connect', 'tie', 'assign'],
    objects: ['trailer to the deal', 'stock to this', 'unit to the deal', 'a trailer'],
    phrases: ['which trailer is this deal for'] },

  { id: 'tracker.duplicate', label: 'Duplicate a deal', blurb: 'Same customer, second unit', kind: 'record',
    capability: 'crm.create', verbs: ['duplicate', 'copy', 'clone', 'repeat'],
    objects: ['deal', 'row', 'this one', 'the line'] },

  { id: 'tracker.commission', label: 'My commission', blurb: 'What you have earned and when', kind: 'navigate',
    /* Not ?view=commission. The sweep found nothing reads a view param
       on this page, so the link landed on the default tab and looked
       broken. A link that goes to the right screen and the wrong tab is
       worse than one that admits it. */
    capability: 'crm.view', path: '/dashboard/leads', verbs: [...GO, 'how much'],
    objects: ['commission', 'my commission', 'earnings', 'what i have earned', 'my bonus'],
    phrases: ['how much commission have i made'] },

  { id: 'tracker.side', label: 'Switch side of the business', blurb: 'Trailer sales or maintenance', kind: 'navigate',
    capability: 'crm.view', path: '/dashboard/leads', verbs: [...CHANGE, 'show'],
    objects: ['maintenance', 'workshop', 'trailer sales', 'the other side', 'service side'],
    phrases: ['show me the maintenance side'] },

  /* ---------- trailer stock ---------- */

  { id: 'stock.bulkStatus', label: 'Change status on several units', blurb: 'Everything you have selected', kind: 'record',
    capability: 'stock.edit', verbs: [...CHANGE, 'mark', 'bulk'],
    objects: ['status on these', 'all of these to', 'these units', 'the selected trailers'],
    phrases: ['mark all of these as', 'move these to in stock'] },

  { id: 'stock.bulkLocation', label: 'Move several units', blurb: 'To another depot in one go', kind: 'record',
    capability: 'stock.edit', verbs: [...CHANGE, 'bulk'],
    objects: ['these to', 'location on these', 'all of these to the yard', 'selected trailers to'],
    phrases: ['move all of these to bredbury'] },

  { id: 'stock.duplicate', label: 'Duplicate a trailer', blurb: 'Same spec, new stock number', kind: 'record',
    capability: 'stock.edit', verbs: ['duplicate', 'copy', 'clone', 'another one like'],
    objects: ['trailer', 'unit', 'this one', 'stock row'] },

  { id: 'stock.sendToTracker', label: 'Send a trailer to the tracker', blurb: 'Starts a deal against it', kind: 'record',
    capability: 'crm.create', verbs: [...SEND, 'push', 'raise'],
    objects: ['to the tracker', 'to my tracker', 'as a deal', 'to sales'],
    phrases: ['put this on my tracker', 'i have got a buyer for this'] },

  { id: 'stock.motDue', label: 'MOTs running out', blurb: 'Units needing a test booking', kind: 'navigate',
    capability: 'crm.view', path: '/dashboard/sales', verbs: [...GO, 'which', 'how many'],
    objects: ['mot', 'mots', 'mot due', 'tests due', 'expiring mots', 'plating'],
    phrases: ['what mots are running out', 'which trailers need testing'] },

  /* ---------- calendar ---------- */

  { id: 'make.visit', label: 'Book a site visit', blurb: 'Out to a customer’s yard', kind: 'create',
    capability: 'crm.delegate', path: '/dashboard/calendar',
    verbs: [...MAKE, 'book', 'schedule', 'arrange', 'diarise'],
    objects: ['visit', 'site visit', 'a trip out', 'a drop in', 'to go and see'],
    phrases: ['book a visit to', 'go and see them'] },

  { id: 'cal.edit', label: 'Change a meeting', blurb: 'Time, title, who is on it', kind: 'record',
    capability: 'crm.delegate', verbs: CHANGE,
    objects: ['meeting', 'the appointment', 'the call', 'my diary', 'the booking'] },

  { id: 'cal.reschedule', label: 'Move a meeting', blurb: 'To another day or time', kind: 'record',
    capability: 'crm.delegate', verbs: [...CHANGE, 'reschedule', 'push', 'bring forward', 'postpone', 'shift'],
    objects: ['meeting to', 'the call to', 'appointment to', 'it to next week'],
    phrases: ['move the meeting', 'push it back a week', 'can we do it another day'] },

  { id: 'cal.cancel', label: 'Cancel a meeting', blurb: 'Tells everybody on it', kind: 'record',
    capability: 'crm.delegate', verbs: [...REMOVE, 'cancel', 'call off', 'scrap'],
    objects: ['meeting', 'the call', 'appointment', 'the visit', 'it'],
    phrases: ['cancel my meeting', 'call the visit off'] },

  { id: 'cal.visibility', label: 'Make a meeting private or shared', blurb: 'Who else can see it', kind: 'record',
    capability: 'crm.delegate', verbs: [...CHANGE, 'hide', 'mark'],
    objects: ['private', 'visibility', 'shared', 'team visible', 'public'],
    phrases: ['keep this one private', 'let the team see it'] },

  { id: 'cal.invite', label: 'Invite somebody to a meeting', blurb: 'They accept, decline or suggest another time', kind: 'record',
    capability: 'crm.delegate', verbs: ['invite', 'add', 'include', 'bring', 'cc', 'rope in'],
    objects: ['tom', 'to the meeting', 'somebody', 'a colleague', 'them to it', 'attendee', 'invitee'],
    phrases: ['invite tom', 'add dave to the meeting', 'get tom on this one'] },

  { id: 'cal.accept', label: 'Accept an invitation', blurb: 'Puts it in your diary', kind: 'record',
    capability: 'crm.view', verbs: ['accept', 'confirm', 'agree to', 'say yes to', 'take'],
    objects: ['invite', 'invitation', 'the meeting', 'the time', 'it'],
    phrases: ['yes to the meeting', 'that time works'] },

  { id: 'cal.decline', label: 'Decline an invitation', blurb: 'They see that you cannot make it', kind: 'record',
    capability: 'crm.view', verbs: ['decline', 'reject', 'refuse', 'say no to', 'turn down'],
    objects: ['invite', 'invitation', 'the meeting', 'the time', 'it'],
    phrases: ['i cannot make it', 'no to the meeting', 'i am not free then'] },

  { id: 'cal.propose', label: 'Suggest another time', blurb: 'Goes back to them to accept', kind: 'record',
    capability: 'crm.view', verbs: ['suggest', 'propose', 'counter', 'offer', 'ask for'],
    objects: ['another time', 'a different day', 'a new time', 'to move it', 'thursday instead'],
    phrases: ['can we do thursday instead', 'suggest another time', 'how about friday'] },

  { id: 'cal.week', label: 'What is on this week', blurb: 'The next seven days', kind: 'navigate',
    capability: 'crm.view', path: '/dashboard/calendar', verbs: [...GO, 'what is'],
    objects: ['this week', 'my week', 'next 7 days', 'my diary', 'what is on', 'coming up'],
    phrases: ['what have i got on', 'what is on this week'] },

  /* ---------- social planner ----------

     The tab that had nothing at all, which is what prompted the sweep. */

  { id: 'social.platform', label: 'Pick channels for a post', blurb: 'Where it goes', kind: 'record',
    capability: 'social.draft', path: '/dashboard/social', verbs: [...CHANGE, 'pick', 'choose', 'target'],
    // Not a bare "x": one character is below the matcher's floor, so the
    // platform was listed and unreachable.
    objects: ['facebook', 'instagram', 'linkedin', 'twitter', 'on x', 'to x', 'platforms', 'channels'],
    phrases: ['post it to linkedin', 'put this on instagram'] },

  { id: 'social.image', label: 'Add an image to a post', blurb: 'Uploaded and shown in the preview', kind: 'record',
    capability: 'social.draft', path: '/dashboard/social', verbs: [...MAKE, ...PUSH],
    objects: ['image', 'picture', 'photo', 'graphic', 'artwork', 'image to the post'] },

  { id: 'social.removeImage', label: 'Remove a post image', blurb: 'Back to text only', kind: 'record',
    capability: 'social.draft', verbs: REMOVE,
    objects: ['image', 'picture', 'photo', 'the graphic'] },

  { id: 'social.schedule', label: 'Schedule a post', blurb: 'When it goes out', kind: 'record',
    capability: 'social.schedule', verbs: [...CHANGE, 'schedule', 'queue', 'plan', 'book in'],
    objects: ['post for', 'it for friday', 'the post date', 'posting date', 'when it goes out'],
    phrases: ['schedule this for monday', 'put it out on friday'] },

  { id: 'social.preview', label: 'Preview a post', blurb: 'How it looks on each channel', kind: 'record',
    capability: 'social.view', path: '/dashboard/social', verbs: [...GO, 'preview'],
    objects: ['post', 'how it looks', 'the preview', 'on instagram', 'the mock up'],
    phrases: ['what will it look like'] },

  { id: 'social.submit', label: 'Send a post for approval', blurb: 'Into somebody else’s queue', kind: 'record',
    capability: 'social.draft', verbs: [...SEND, 'submit', 'put in'],
    objects: ['for approval', 'to be approved', 'for review', 'to review'],
    phrases: ['send this for approval', 'put it in for review'] },

  { id: 'social.approve', label: 'Approve a social post', blurb: 'Clears it to be scheduled', kind: 'record',
    capability: 'social.approve', verbs: ['approve', 'sign off', 'ok', 'clear', 'pass', 'accept'],
    objects: ['post', 'posts', 'social post', 'the drafts', 'everything outstanding', 'the queue'],
    phrases: ['approve all the outstanding posts', 'sign off the social posts'] },

  { id: 'social.reject', label: 'Send a post back', blurb: 'Back to draft, with a reason', kind: 'record',
    capability: 'social.approve', verbs: ['reject', 'send back', 'bounce', 'refuse', 'knock back'],
    objects: ['post', 'social post', 'to draft', 'the draft'],
    phrases: ['send it back to draft', 'that post is not right'] },

  { id: 'social.queue', label: 'Queue an approved post', blurb: 'Into the next free slot', kind: 'record',
    capability: 'social.schedule', verbs: ['queue', 'schedule', 'line up', 'set live'],
    objects: ['approved posts', 'the post', 'it for posting'] },

  { id: 'social.markPosted', label: 'Mark a post as posted', blurb: 'It has gone out', kind: 'record',
    capability: 'marketing.edit', verbs: [...CHANGE, 'mark'],
    objects: ['as posted', 'as published', 'as live', 'posted', 'it as gone out'] },

  { id: 'social.delete', label: 'Delete a social post', blurb: 'Off the planner. Recoverable.', kind: 'record',
    capability: 'social.delete', verbs: REMOVE,
    objects: ['post', 'social post', 'the draft', 'this post'] },

  { id: 'social.publishNow', label: 'Publish a post now', blurb: 'Skips the queue. No undo.', kind: 'record',
    capability: 'social.publishNow', verbs: ['publish', 'push out', 'go live with'],
    objects: ['now', 'immediately', 'straight away', 'this post now', 'it now', 'right now'],
    phrases: ['publish this post now', 'publish it now', 'send it out immediately',
              'push this out now', 'go live with this post'] },

  { id: 'social.unschedule', label: 'Take a post out of the queue', blurb: 'Still approved, no longer booked', kind: 'record',
    capability: 'social.schedule', verbs: ['unschedule', 'pull', 'take out', 'hold', 'pause'],
    objects: ['the queue', 'from the queue', 'the schedule', 'this post from the queue'],
    phrases: ['take this out of the queue', 'pull it from the queue', 'unschedule this post'] },

  { id: 'social.tag', label: 'Tag a post', blurb: 'How it is grouped and reported on', kind: 'record',
    capability: 'social.tags', verbs: [...CHANGE, 'tag', 'label', 'file under'],
    objects: ['tag', 'tags', 'a tag on this post', 'as stock', 'as hiring'] },

  { id: 'social.firstComment', label: 'Set a first comment', blurb: 'Links kept out of the post', kind: 'record',
    capability: 'social.draft', verbs: [...CHANGE, ...MAKE],
    objects: ['first comment', 'the comment', 'a first comment on this post'] },

  { id: 'social.slots', label: 'Change a channel\u2019s posting times', blurb: 'What the queue fills', kind: 'record',
    capability: 'social.channels', path: '/dashboard/social?tab=queue',
    verbs: [...CHANGE, 'set'],
    objects: ['the queue times', 'when we post', 'the posting week'] },

  { id: 'social.libraryAdd', label: 'Add to the content library', blurb: 'A picture the company keeps', kind: 'record',
    capability: 'social.library', path: '/dashboard/social?tab=library', verbs: [...PUSH, ...MAKE],
    objects: ['to the library', 'an asset', 'a picture to the library'] },

  { id: 'social.approveAsset', label: 'Sign off a library asset', blurb: 'Before it reaches a public account', kind: 'record',
    capability: 'social.approve', path: '/dashboard/social?tab=library',
    verbs: ['sign off', 'clear'],
    objects: ['asset', 'the picture', 'library asset', 'this image'] },

  /* ---------- brand kit ---------- */

  { id: 'brand.upload', label: 'Upload a brand asset', blurb: 'Logo, font, template or image', kind: 'record',
    capability: 'marketing.edit', path: '/dashboard/brand', verbs: [...PUSH, ...MAKE],
    objects: ['logo', 'font', 'template', 'brand asset', 'asset', 'artwork to the brand kit'] },

  { id: 'brand.addColour', label: 'Add a brand colour', blurb: 'Name and hex', kind: 'record',
    capability: 'marketing.edit', path: '/dashboard/brand', verbs: MAKE,
    objects: ['colour', 'color', 'brand colour', 'hex', 'swatch', 'to the palette'] },

  { id: 'brand.delete', label: 'Delete a brand asset', blurb: 'Off the kit', kind: 'record',
    capability: 'marketing.edit', verbs: REMOVE,
    objects: ['logo', 'asset', 'brand asset', 'font', 'template', 'swatch'] },

  /* Copying is a declared client effect now, not a path. `clipboard` is
     a destination in the registry, the plan says the answer goes there,
     and the browser is what puts it there. The path stays because
     picking the action from the list is still a way of getting to the
     screen; what changed is that typing it copies. */
  { id: 'brand.copyHex', label: 'Copy a brand colour', blurb: 'The hex, on your clipboard', kind: 'data',
    capability: 'crm.view', path: '/dashboard/brand', verbs: ['copy', 'grab', 'get'],
    objects: ['hex', 'brand hex', 'brand colour', 'colour code', 'swatch'],
    phrases: ['what is our red', 'what is the navy hex'] },

  /* ---------- industry news ---------- */

  /* It sweeps every story past the cutoff before it adds anything, so
     it is gated where the button is gated. It used to say `crm.view`,
     which offered a viewer a refresh the database would refuse. */
  { id: 'news.refresh', label: 'Refresh the news', blurb: 'Pull the feeds again', kind: 'data',
    capability: 'marketing.edit', path: '/dashboard/news', verbs: ['refresh', 'update', 'reload', 'pull', 'fetch', 'sync'],
    objects: ['news', 'the feeds', 'headlines', 'industry news', 'the articles'] },

  { id: 'news.source', label: 'Filter news by source', blurb: 'One publication at a time', kind: 'navigate',
    capability: 'crm.view', path: '/dashboard/news', verbs: ['filter', 'show', 'only'],
    objects: ['source', 'publication', 'this outlet', 'commercial motor', 'motor transport'] },

  { id: 'news.search', label: 'Search the headlines', blurb: 'Across every feed', kind: 'navigate',
    capability: 'crm.view', path: '/dashboard/news', verbs: ['search', 'look for', 'find'],
    objects: ['news', 'headlines', 'articles', 'in the news', 'stories'],
    phrases: ['has anything been written about'] },

  { id: 'news.clear', label: 'Clear the news filters', blurb: 'Back to everything', kind: 'navigate',
    capability: 'crm.view', path: '/dashboard/news', verbs: ['clear', 'reset', 'show all'],
    objects: ['filters', 'the search', 'the source filter'] },

  { id: 'news.delete', label: 'Delete a news item', blurb: 'Off the board for everybody', kind: 'record',
    capability: 'marketing.edit', verbs: REMOVE,
    objects: ['article', 'news item', 'headline', 'story', 'this one off the news'] },

  { id: 'news.activity', label: 'Company activity', blurb: 'Filings and changes from the Gazette', kind: 'navigate',
    capability: 'crm.view', path: '/dashboard/news', verbs: [...GO, 'check'],
    objects: ['company activity', 'gazette', 'filings', 'companies house', 'insolvencies', 'business activity'],
    phrases: ['who has gone under', 'any company news'] },

  /* ---------- company finder ---------- */

  { id: 'finder.search', label: 'Find companies near a depot', blurb: 'Prospecting by place and industry', kind: 'navigate',
    capability: 'crm.view', path: '/dashboard/finder', verbs: ['find', 'search', 'look for', 'prospect', 'hunt'],
    objects: ['companies near', 'hauliers in', 'prospects near', 'firms around', 'businesses in'],
    phrases: ['who is near carrington', 'find hauliers around bredbury'] },

  /* Opening the screen is free and gated on crm.view above. Running the
     search is not: it reads somebody else's database and is charged
     for, so it needs what every other paid Lusha call needs, and the
     rollout lock hides it from everybody until that lifts. */
  { id: 'finder.run', label: 'Search for companies near a depot', blurb: 'A paid Lusha search, previewed first', kind: 'data',
    capability: 'crm.enrich', verbs: ['find', 'search for', 'look for', 'prospect for'],
    objects: ['waste companies near', 'hauliers within', 'construction firms near',
              'companies within miles of', 'firms near the depot'],
    phrases: ['find waste companies within 20 miles of hyde'] },

  { id: 'finder.add', label: 'Add a find to the CRM', blurb: 'One company onto a list', kind: 'record',
    capability: 'crm.create', verbs: MAKE,
    objects: ['to the crm', 'this company', 'them to my list', 'to the pipeline'] },

  { id: 'finder.addBulk', label: 'Add every selected find', blurb: 'The whole selection onto a list', kind: 'record',
    capability: 'crm.create', verbs: [...MAKE, 'bulk'],
    objects: ['all of these to the crm', 'the selection', 'everything selected', 'these companies'] },

  /* ---------- analytics ---------- */

  { id: 'analytics.period', label: 'Change the analytics period', blurb: 'Month, quarter or year', kind: 'navigate',
    capability: 'crm.view', path: '/dashboard/analytics', verbs: CHANGE,
    objects: ['period', 'the range', 'to this quarter', 'to last year', 'the date range', 'timeframe'] },

  { id: 'analytics.leaderboard', label: 'Rep leaderboard', blurb: 'Who is selling what', kind: 'navigate',
    capability: 'crm.view', path: '/dashboard/analytics', verbs: [...GO, 'who is'],
    objects: ['leaderboard', 'league table', 'top rep', 'best salesman', 'rankings', 'who is winning'],
    phrases: ['who has sold the most'] },

  { id: 'analytics.revenue', label: 'Revenue and profit', blurb: 'Over time, against last period', kind: 'navigate',
    capability: 'crm.view', path: '/dashboard/analytics', verbs: [...GO, 'how much'],
    objects: ['revenue', 'profit', 'turnover', 'margin', 'the numbers', 'performance'],
    phrases: ['how are we doing', 'how is the month looking'] },

  { id: 'analytics.breakdown', label: 'Break the numbers down', blurb: 'By make, status or depot', kind: 'navigate',
    capability: 'crm.view', path: '/dashboard/analytics', verbs: [...GO, 'split', 'break down', 'group'],
    objects: ['by make', 'by depot', 'by status', 'by rep', 'a breakdown', 'split by'] },

  /* ---------- me ---------- */

  { id: 'me.name', label: 'Change your name', blurb: 'How you show up to the team', kind: 'session',
    path: '/dashboard/settings', verbs: CHANGE,
    objects: ['my name', 'display name', 'what i am called', 'my details'] },

  { id: 'me.password', label: 'Change your password', blurb: 'On your own account', kind: 'session',
    path: '/dashboard/settings', verbs: [...CHANGE, 'reset'],
    objects: ['password', 'my password', 'login', 'passcode'],
    phrases: ['i want a new password'] },

  /* ---------- export pages ---------- */


  /* ---------- analytics, read properly this time ----------

     The first sweep skipped this screen and I wrote four entries for it
     from a grep. It has six periods, a rep filter, eight KPIs, four
     charts and a leaderboard you can click to filter by. */

  { id: 'analytics.period30', label: 'Last 30 days', blurb: 'Analytics for the past month', kind: 'navigate',
    capability: 'crm.view', path: '/dashboard/analytics?period=30d', verbs: [...GO, 'set'],
    objects: ['last 30 days', 'past 30 days', 'last month of figures', '30 day view'] },

  { id: 'analytics.period90', label: 'Last 90 days', blurb: 'Analytics for the past quarter', kind: 'navigate',
    capability: 'crm.view', path: '/dashboard/analytics?period=90d', verbs: [...GO, 'set'],
    objects: ['last 90 days', 'past 90 days', 'last three months', '90 day view'] },

  { id: 'analytics.periodMtd', label: 'This month so far', blurb: 'Month to date', kind: 'navigate',
    capability: 'crm.view', path: '/dashboard/analytics?period=mtd', verbs: [...GO, 'set'],
    objects: ['month to date', 'mtd', 'this month so far', 'so far this month'] },

  { id: 'analytics.periodQtd', label: 'This quarter', blurb: 'Quarter to date', kind: 'navigate',
    capability: 'crm.view', path: '/dashboard/analytics?period=qtd', verbs: [...GO, 'set'],
    objects: ['this quarter', 'quarter to date', 'qtd', 'the quarter'] },

  { id: 'analytics.periodYtd', label: 'Year to date', blurb: 'Since the first of January', kind: 'navigate',
    capability: 'crm.view', path: '/dashboard/analytics?period=ytd', verbs: [...GO, 'set'],
    objects: ['year to date', 'ytd', 'this year so far', 'since january'] },

  { id: 'analytics.periodAll', label: 'All time', blurb: 'Every dated record', kind: 'navigate',
    capability: 'crm.view', path: '/dashboard/analytics?period=all', verbs: [...GO, 'set'],
    objects: ['all time', 'ever', 'the lot', 'everything we have done', 'since the start'] },

  { id: 'analytics.repFilter', label: 'Focus analytics on one rep', blurb: 'Or back to the whole team', kind: 'navigate',
    capability: 'crm.view', path: '/dashboard/analytics', verbs: [...GO, 'filter', 'focus on'],
    objects: ['one rep', 'just dave', 'a single rep', 'whole team', 'everybody’s figures'],
    phrases: ['show me just dave’s numbers', 'back to the whole team'] },

  { id: 'analytics.commission', label: 'Commission paid', blurb: 'Ten per cent of profit, to the team', kind: 'navigate',
    capability: 'crm.view', path: '/dashboard/analytics', verbs: [...GO, 'how much'],
    objects: ['commission paid', 'commission bill', 'what the team earned', 'total commission'] },

  { id: 'analytics.avgDeal', label: 'Average deal size', blurb: 'Revenue over deals closed', kind: 'navigate',
    capability: 'crm.view', path: '/dashboard/analytics', verbs: [...GO, 'how much', 'whats'],
    objects: ['average deal', 'average sale', 'typical deal', 'deal size', 'average order value'] },

  { id: 'analytics.pipelineValue', label: 'Pipeline value', blurb: 'Estimated value of everything open', kind: 'navigate',
    capability: 'crm.view', path: '/dashboard/analytics', verbs: [...GO, 'how much'],
    objects: ['pipeline value', 'whats in the pipeline', 'open value', 'value of the pipeline'] },

  { id: 'analytics.conversion', label: 'Conversion rate', blurb: 'Open leads that become customers', kind: 'navigate',
    capability: 'crm.view', path: '/dashboard/analytics', verbs: [...GO, 'whats'],
    objects: ['conversion', 'conversion rate', 'close rate', 'win rate', 'strike rate'] },

  { id: 'analytics.stockValue', label: 'Stock available and its book value', blurb: 'What is sat on the yard', kind: 'navigate',
    capability: 'crm.view', path: '/dashboard/analytics', verbs: [...GO, 'how much'],
    objects: ['stock available', 'stock value', 'nbv on the yard', 'what stock is worth'] },

  { id: 'analytics.funnel', label: 'Pipeline funnel', blurb: 'Lead, contacted, quoted, won, customer, lost', kind: 'navigate',
    capability: 'crm.view', path: '/dashboard/analytics', verbs: GO,
    objects: ['funnel', 'pipeline funnel', 'the stages', 'stage breakdown', 'where deals are'] },

  { id: 'analytics.topCustomers', label: 'Top customers', blurb: 'By revenue in the period', kind: 'navigate',
    capability: 'crm.view', path: '/dashboard/analytics', verbs: [...GO, 'who are'],
    objects: ['top customers', 'best customers', 'biggest customers', 'who spends the most'] },

  { id: 'analytics.byMake', label: 'Stock by manufacturer', blurb: 'How many of each make on the yard', kind: 'navigate',
    capability: 'crm.view', path: '/dashboard/analytics', verbs: [...GO, 'split'],
    objects: ['by manufacturer', 'by make', 'stock by make', 'which makes', 'manufacturer split'] },

  { id: 'analytics.trend', label: 'Revenue and profit trend', blurb: 'Twelve months, either line toggleable', kind: 'navigate',
    capability: 'crm.view', path: '/dashboard/analytics', verbs: GO,
    objects: ['trend', 'monthly trend', 'the trend line', 'last 12 months', 'month by month'] },

  /* ---------- company finder ---------- */

  { id: 'finder.radius', label: 'Change the search radius', blurb: 'Miles around the chosen place', kind: 'navigate',
    capability: 'crm.view', path: '/dashboard/finder', verbs: [...CHANGE, 'widen', 'narrow'],
    objects: ['radius', 'search radius', 'the miles', 'how far out', 'distance'] },

  { id: 'finder.industry', label: 'Filter the search by industry', blurb: 'Haulage, construction, waste and the rest', kind: 'navigate',
    capability: 'crm.view', path: '/dashboard/finder', verbs: [...CHANGE, 'filter'],
    objects: ['industry', 'sector', 'trade', 'hauliers only', 'construction firms', 'waste collection'] },

  { id: 'finder.size', label: 'Filter the search by company size', blurb: 'Employee count, low and high', kind: 'navigate',
    capability: 'crm.view', path: '/dashboard/finder', verbs: [...CHANGE, 'filter'],
    objects: ['employee count', 'company size', 'headcount range', 'how many staff', 'size of firm'] },

  { id: 'finder.depot', label: 'Search around a depot', blurb: 'Or a postcode you type', kind: 'navigate',
    capability: 'crm.view', path: '/dashboard/finder', verbs: [...GO, 'search', 'look'],
    objects: ['around a depot', 'near hyde', 'around a postcode', 'from a depot', 'near a site'],
    phrases: ['who is near hyde', 'companies around a postcode'] },


  /* ---------- admin, settings and the three dashboards ----------

     Another screen the first sweep skipped. The demo seeder in
     particular writes real rows and had no way to be typed at. */

  { id: 'admin.roleAdmin', label: 'Make somebody an admin', blurb: 'Full access to everything', kind: 'admin',
    capability: 'admin.users', path: '/dashboard/admin', seed: 'make ',
    verbs: [...CHANGE, 'promote', 'elevate', 'upgrade'],
    objects: ['an admin', 'to admin', 'administrator', 'full access'] },

  { id: 'admin.roleSales', label: 'Make somebody sales', blurb: 'Their own portfolio and the pipeline', kind: 'admin',
    capability: 'admin.users', path: '/dashboard/admin', seed: 'make ',
    verbs: [...CHANGE, 'promote', 'move'],
    objects: ['to sales', 'a sales user', 'sales role', 'a rep'] },

  { id: 'admin.roleMarketer', label: 'Make somebody restricted', blurb: 'Updates records and nothing else', kind: 'admin',
    capability: 'admin.users', path: '/dashboard/admin', seed: 'make ',
    verbs: [...CHANGE, 'restrict', 'limit'],
    objects: ['to marketer', 'restricted', 'a marketer', 'restricted updater'] },

  { id: 'admin.roleViewer', label: 'Make somebody read only', blurb: 'Looks, touches nothing', kind: 'admin',
    capability: 'admin.users', path: '/dashboard/admin', seed: 'make ',
    verbs: [...CHANGE, 'demote', 'downgrade', 'restrict'],
    objects: ['read only', 'to viewer', 'a viewer', 'view only', 'take their access away'] },

  { id: 'admin.seedDemo', label: 'Load demo data', blurb: 'Marked rows you can clear again', kind: 'admin',
    capability: 'admin.users', path: '/dashboard', verbs: [...MAKE, 'seed', 'load'],
    objects: ['demo data', 'test data', 'sample data', 'dummy records', 'demo rows'],
    phrases: ['fill it with demo data'] },

  { id: 'admin.wipeDemo', label: 'Clear the demo data', blurb: 'Removes exactly the demo rows', kind: 'admin',
    capability: 'admin.users', path: '/dashboard', verbs: [...REMOVE, 'wipe', 'clear'],
    objects: ['demo data', 'test data', 'sample data', 'the demo rows'],
    phrases: ['get rid of the demo data'] },

  { id: 'admin.previewRep', label: 'Preview the rep dashboard', blurb: 'What a sales user sees', kind: 'admin',
    capability: 'admin.users', path: '/dashboard?view=rep', verbs: [...GO, 'preview'],
    objects: ['rep dashboard', 'rep view', 'sales rep view', 'as a rep'] },

  { id: 'admin.previewExec', label: 'Preview the exec dashboard', blurb: 'Company revenue and pipeline by rep', kind: 'admin',
    capability: 'admin.users', path: '/dashboard?view=exec', verbs: [...GO, 'preview'],
    objects: ['exec dashboard', 'exec view', 'the board view', 'as an exec'] },

  { id: 'admin.previewSupport', label: 'Preview the support dashboard', blurb: 'Planner, brand kit and news', kind: 'admin',
    capability: 'admin.users', path: '/dashboard?view=support', verbs: [...GO, 'preview'],
    objects: ['support dashboard', 'support view', 'marketer view', 'as support'] },

  { id: 'me.chaseWindow', label: 'Change what counts as gone quiet', blurb: 'Seven, ten or fourteen days', kind: 'session',
    path: '/dashboard', verbs: [...CHANGE, 'set'],
    objects: ['quiet window', 'stale days', 'chase window', 'how long before chasing', 'gone quiet after'] },

  { id: 'me.needsChasing', label: 'What needs chasing', blurb: 'Open work that has gone quiet', kind: 'navigate',
    capability: 'crm.view', path: '/dashboard', verbs: [...GO, 'what', 'which'],
    objects: ['needs chasing', 'gone quiet', 'stalled', 'sitting still', 'not heard back', 'needs a nudge'],
    phrases: ['what have i not chased', 'what has gone quiet'] },

  { id: 'me.needsMeToday', label: 'What needs me today', blurb: 'Diary and stalled work in one list', kind: 'navigate',
    capability: 'crm.view', path: '/dashboard', verbs: [...GO, 'what'],
    objects: ['needs me today', 'my to do', 'todays list', 'what is waiting on me', 'my actions'],
    phrases: ['what do i need to do today'] },

  { id: 'me.portfolio', label: 'My portfolio', blurb: 'Accounts allocated to you, and what they are worth', kind: 'navigate',
    capability: 'crm.view', path: '/dashboard', verbs: [...GO, 'how many'],
    objects: ['my portfolio', 'my accounts', 'accounts allocated to me', 'my book'] },

  { id: 'me.target', label: 'How I am doing against target', blurb: 'Booked this month against your number', kind: 'navigate',
    capability: 'crm.view', path: '/dashboard', verbs: [...GO, 'how much', 'am i'],
    objects: ['target', 'my target', 'against target', 'booked this month', 'am i on track'],
    phrases: ['how far off target am i', 'how much left to hit target'] },

  { id: 'me.notifications', label: 'My notifications', blurb: 'Anything unread and waiting', kind: 'navigate',
    capability: 'crm.view', path: '/dashboard', verbs: [...GO, 'check', 'any'],
    objects: ['notifications', 'unread', 'alerts', 'my bell', 'anything for me', 'messages'] },

  { id: 'me.inFlight', label: 'What is in flight', blurb: 'Open work split new against existing', kind: 'navigate',
    capability: 'crm.view', path: '/dashboard', verbs: [...GO, 'what'],
    objects: ['in flight', 'open work', 'open proposals', 'live proposals', 'what is open'] },

  { id: 'export.copy', label: 'Copy a customer export', blurb: 'Formatted, onto the clipboard', kind: 'data',
    capability: 'crm.export', verbs: ['copy', 'clipboard', 'grab'],
    objects: ['the export', 'this customer', 'the summary', 'to the clipboard'] },

  { id: 'export.email', label: 'Email a customer export', blurb: 'Straight into a new message', kind: 'data',
    capability: 'crm.export', verbs: SEND,
    objects: ['the export', 'this customer', 'the summary by email', 'it over'],
    phrases: ['email this to someone'] },

  { id: 'export.print', label: 'Print or save as PDF', blurb: 'The export page, laid out for paper', kind: 'data',
    capability: 'crm.export', verbs: ['print', 'save as', 'pdf'],
    objects: ['pdf', 'to paper', 'the export', 'a hard copy'],
    phrases: ['save it as a pdf'] },

  /* ---------- Work ----------

     The task system is meant to be how the business runs, so the bar
     has to reach it however somebody says it. Every one of these names
     the capability it needs, so a viewer typing "assign this to Dean"
     sees nothing rather than an action that appears and then refuses.

     "task list" is deliberately absent from the first entry. It
     collides with the CRM's own list actions and loses to them, so it
     would be an object word that never wins. "tasks" and "work" already
     carry the intent. */

  { id: 'nav.work', label: 'Work', blurb: 'Tasks, delegation and projects', kind: 'navigate',
    capability: 'work.view', path: '/dashboard/work', verbs: GO,
    objects: ['work', 'tasks', 'task', 'todo', 'to do', 'to-do', 'my work',
              'the work tab', 'jobs', 'workload'] },

  { id: 'nav.myWork', label: 'My work', blurb: 'Everything on you right now', kind: 'navigate',
    capability: 'work.view', path: '/dashboard/work?view=my-work', verbs: [...GO, 'show'],
    objects: ['my work', 'my tasks', 'my todo', 'what am i doing', 'what do i have on',
              'my jobs', 'my list'] },

  { id: 'nav.blockedWork', label: 'Blocked work', blurb: 'Everything stuck, oldest first', kind: 'navigate',
    capability: 'work.view', path: '/dashboard/work?view=blocked', verbs: [...GO, 'show'],
    objects: ['blocked', 'blocked work', 'blocked tasks', 'stuck', 'what is stuck',
              'blockers', 'held up'] },

  { id: 'nav.overdueWork', label: 'Overdue work', blurb: 'Past its date and not finished', kind: 'navigate',
    capability: 'work.view', path: '/dashboard/work?view=overdue', verbs: [...GO, 'show'],
    objects: ['overdue work', 'late work', 'late tasks', 'overdue tasks', 'past due work'] },

  { id: 'nav.assignedByMe', label: 'Work I assigned', blurb: 'What you put on other people', kind: 'navigate',
    capability: 'work.assignOthers', path: '/dashboard/work?view=assigned-by-me', verbs: [...GO, 'show'],
    objects: ['work i assigned', 'tasks i assigned', 'what i delegated', 'what i gave out',
              'assigned by me', 'my delegations'] },

  { id: 'make.task', label: 'Raise a task', blurb: 'Work for you or for somebody else', kind: 'create',
    capability: 'work.create', path: '/dashboard/work', verbs: MAKE, seed: 'add task ',
    objects: ['task', 'todo', 'to do', 'job', 'piece of work', 'ticket'] },

  { id: 'work.assign', label: 'Assign a task', blurb: 'Put work on a person or a department', kind: 'record',
    capability: 'work.assignOthers', path: '/dashboard/work',
    verbs: ['assign', 'give', 'hand', 'put', 'task', 'delegate'],
    objects: ['task', 'work', 'job', 'this task', 'it'] },

  { id: 'work.release', label: 'Ask to be let off a task', blurb: 'Cancel it, pass it on, or move the date', kind: 'record',
    capability: 'work.requestRelease', path: '/dashboard/work',
    verbs: ['hand back', 'give back', 'pass on', 'reassign', 'cannot do', 'ask off', 'push back'],
    objects: ['task', 'this task', 'work', 'this', 'it'],
    phrases: ['i cannot do this task', 'hand this task back', 'ask for more time on this',
              'pass this task to somebody else'] },

  { id: 'work.decide', label: 'Answer a release request', blurb: 'Grant or refuse work being handed back', kind: 'record',
    capability: 'work.decideRelease', path: '/dashboard/work?view=waiting-for-me',
    verbs: ['approve', 'grant', 'refuse', 'decline', 'answer'],
    objects: ['release request', 'handback', 'the request', 'release'] },

  { id: 'work.savedView', label: 'Build a view of work', blurb: 'Your own filters, layout and columns', kind: 'create',
    capability: 'work.views', path: '/dashboard/work', verbs: [...MAKE, ...CHANGE],
    objects: ['work view', 'task view', 'saved view', 'my own view', 'work filter',
              'board view', 'task board', 'work layout'],
    phrases: ['make my own work view', 'save this view', 'customise this view'] },

  { id: 'work.due', label: 'Change when work is due', blurb: 'Move a deadline on a task', kind: 'record',
    capability: 'work.setDue', path: '/dashboard/work', verbs: [...CHANGE, 'push', 'extend'],
    objects: ['due date', 'deadline', 'when it is due', 'task date'],
    phrases: ['push this task back', 'move the deadline', 'give this another week'] },

  /* Deliberately narrow. Bare "note" belongs to the CRM's file note and
     bare "comment" to a post's first comment, and both were here before
     this was. An object word two actions claim is an object word neither
     one wins on, so this one says "task" out loud. */
  { id: 'work.note', label: 'Add a note to a task', blurb: 'Why it moved, what you found', kind: 'record',
    capability: 'work.view', path: '/dashboard/work', verbs: [...MAKE, 'log'],
    objects: ['task note', 'note on a task', 'note on this task', 'task comment',
              'comment on a task', 'work note'],
    phrases: ['leave a note on this task', 'comment on this task', 'note on this task'] },

  /* ---------- FleetSmart+ ----------

     Contract work is talked about four different ways depending on who
     is talking: the workshop says R and M, the office says maintenance
     contract, the sales team says FleetSmart, and the customer says
     "the plan". All four have to land on the same screen.

     Bare "contract" is deliberately not here. It belongs to the
     proposal generator, which claimed it first, and an object word two
     actions both claim is one neither wins on. "Maintenance contract"
     and "fleetsmart" are unambiguous, and that is what these say. */

  { id: 'nav.fleetsmart', label: 'FleetSmart+', blurb: 'Fixed price maintenance contracts', kind: 'navigate',
    capability: 'fleetsmart.view', path: '/dashboard/fleetsmart', verbs: GO,
    objects: ['fleetsmart', 'fleet smart', 'fleetsmart+', 'fleetsmart plus', 'fleet smart plus',
              'maintenance contracts', 'maintenance contract', 'service contracts',
              'r and m', 'r&m', 'contract builder', 'the contracts tab'] },

  { id: 'make.fleetsmartContract', label: 'Build a maintenance contract',
    blurb: 'Priced off the rate card as you fill it in', kind: 'create',
    capability: 'fleetsmart.build', path: '/dashboard/fleetsmart', verbs: MAKE,
    objects: ['maintenance contract', 'fleetsmart contract', 'service contract',
              'r and m contract', 'fleetsmart quote', 'maintenance quote', 'contract for a fleet'],
    phrases: ['build a maintenance contract', 'price up a fleet', 'quote a maintenance contract',
              'new fleetsmart contract'] },

  { id: 'fleetsmart.send', label: 'Send a contract to the customer',
    blurb: 'Freezes the price and records who it went to', kind: 'record',
    capability: 'fleetsmart.send', path: '/dashboard/fleetsmart',
    verbs: ['send', 'issue', 'put out', 'get out', 'email over', 'share'],
    objects: ['maintenance contract', 'fleetsmart contract', 'the contract to the customer'],
    phrases: ['send the maintenance contract', 'get the fleetsmart contract out'] },

  { id: 'fleetsmart.decide', label: 'Record a contract answer',
    blurb: 'Accepted or declined, so it stops being pipeline', kind: 'record',
    capability: 'fleetsmart.build', path: '/dashboard/fleetsmart',
    verbs: ['record', 'mark', 'accept', 'decline', 'log'],
    objects: ['contract answer', 'contract decision', 'signed contract', 'declined contract',
              'maintenance contract answer'],
    phrases: ['they signed the maintenance contract', 'they turned the contract down',
              'mark the fleetsmart contract as accepted'] },

  /* The one action on this screen with its own permission. A salesman
     may build and send at rate card; only somebody holding the discount
     capability may take money off it, so a salesman typing this sees
     nothing rather than a control that appears and then refuses. */
  { id: 'fleetsmart.discount', label: 'Discount a maintenance contract',
    blurb: 'A manager rate off the whole contract', kind: 'record',
    capability: 'fleetsmart.discount', path: '/dashboard/fleetsmart',
    verbs: ['discount', 'reduce', 'knock off', 'take off', 'drop'],
    objects: ['manager discount', 'contract discount', 'discount on a maintenance contract',
              'fleetsmart discount'],
    phrases: ['discount the maintenance contract', 'give them a manager discount'] },
];

/* =============================================================
   Matching.
   ============================================================= */

const fold = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

export type ActionHit = {
  action: CommandActionSpec;
  score: number;
  matched: string;
  /**
   * Does anything in this application carry it out?
   *
   * An action with a `path` opens a screen and the screen does the
   * work, so it is carried out by definition. An action with neither a
   * path nor a seed is a label with nothing behind it, and offering it
   * as something to press Enter on teaches people the tool is
   * unreliable. This is the difference between a registry entry and a
   * capability, and the bar shows it rather than hiding it: a suggestion
   * that only seeds the bar says so.
   */
  runnable: boolean;
};

/**
 * Is there anything behind this action, or only a label?
 *
 * A screen counts: navigation is a real outcome and the screen does the
 * work. A seed counts as far as it goes, which is putting a sentence in
 * the bar for somebody to finish, and the caller is told which of the
 * two it is rather than being left to find out by pressing Enter.
 */
export function actionRunnable(a: CommandActionSpec): boolean {
  return !!a.path;
}

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

    /* WHOLE WORDS, NOT SUBSTRINGS.

       "Add Jane as a new user" was offered New social post, level with
       the Team screen, because the post action lists "ad" among its
       objects and "add" contains it. A word that happens to sit inside
       another word is not that word, and a bar that offers to write a
       social post to somebody adding a colleague has told them it does
       not understand the sentence.

       The plural is matched too, because "post" and "posts" are the
       same object and the half typed case is what the prefix rule
       below is for. */
    const said = ` ${q} `;
    const has = (w: string) => {
      const word = fold(w);
      return said.includes(` ${word} `) || said.includes(` ${word}s `);
    };
    const objectHit = (a.objects ?? []).find(has);
    const verbHit = (a.verbs ?? []).find(has);

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

    if (best) {
      hits.push({
        action: a,
        score: (best as { score: number }).score,
        matched: (best as { matched: string }).matched,
        runnable: actionRunnable(a),
      });
    }
  }

  return hits
    .sort((x, y) => y.score - x.score || x.action.label.localeCompare(y.action.label))
    .slice(0, limit);
}

/** Everything this person can do, for the empty state and for the checks. */
export function availableActions(caps: CrmCapabilities): CommandActionSpec[] {
  return ACTIONS.filter((a) => !a.capability || caps.has(a.capability));
}
