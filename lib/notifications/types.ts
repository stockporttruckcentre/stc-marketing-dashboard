import type { Tone } from '@/components/kit/primitives';

/* =============================================================
   What a notification is, on this side of the wire.

   The catalogue lives in the database, in `notification_kinds`, and
   that is deliberate: the settings screen reads it, so a kind added
   there appears as a toggle without a line of this file changing.

   What is here is only the part a database cannot hold, which is how a
   thing should look and what a person can do about it. Three maps,
   keyed on the same strings the catalogue uses.

   A kind missing from any of them still works. It draws with the
   neutral icon, the tone its severity implies, and no buttons beyond
   opening it. That is the point of the fallbacks: a kind seeded into
   the catalogue by somebody who never opened this file produces a
   plain notification rather than a crash.
   ============================================================= */

export type NotificationSeverity = 'info' | 'attention' | 'urgent';
export type NotificationAudience = 'personal' | 'team';

/** One line inside a bunch. Written by `notify` when two become one. */
export type BunchItem = {
  title: string | null;
  body: string | null;
  link: string | null;
  id: string | null;
};

export type NotificationRow = {
  id: string;
  user_id: string;
  kind: string;
  title: string;
  body: string | null;
  link_path: string | null;
  audience: NotificationAudience;
  severity: NotificationSeverity;
  group_key: string | null;
  item_count: number;
  subject_kind: string | null;
  subject_id: string | null;
  payload: Record<string, unknown> | null;
  actor_id: string | null;
  read_at: string | null;
  dismissed_at: string | null;
  actioned_at: string | null;
  action_taken: string | null;
  due_at: string | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
};

/** What the settings screen draws, straight from `notification_choices`. */
export type NotificationChoice = {
  key: string;
  category: string;
  label: string;
  blurb: string;
  audience: NotificationAudience;
  severity: NotificationSeverity;
  may_mute: boolean;
  enabled: boolean;
  is_default: boolean;
  sort_order: number;
};

export type NotificationSettings = {
  muted_until: string | null;
  quiet_from: number;
  quiet_to: number;
  bundle_minutes: number;
};

export type NotificationCounts = {
  personal: number;
  team: number;
  /** Unread, unanswered, and asking something of you. The red one. */
  waiting: number;
};

/* -------------------------------------------------------------
   The categories, in the order the settings screen shows them.

   Named for what somebody would call the part of the application they
   are about, not for the tables involved.
   ------------------------------------------------------------- */
export const CATEGORIES = [
  { key: 'diary',      label: 'Diary',        blurb: 'Meetings, calls and what is on today' },
  { key: 'work',       label: 'Work',         blurb: 'Tasks put on you, and their dates' },
  { key: 'crm',        label: 'CRM',          blurb: 'Accounts, prospects, imports and exports' },
  { key: 'content',    label: 'Content',      blurb: 'Posts waiting for approval, and the answer' },
  { key: 'sales',      label: 'Sales',        blurb: 'Commission to confirm, and monthly figures' },
  { key: 'fleetsmart', label: 'FleetSmart+',  blurb: 'Contracts answered, and renewals coming up' },
  { key: 'admin',      label: 'Your account', blurb: 'Roles, permissions and anything broken' },
  { key: 'team',       label: 'The business', blurb: 'What everybody else is doing. All off by default.' },
] as const;

export type CategoryKey = typeof CATEGORIES[number]['key'];

/* -------------------------------------------------------------
   How a kind reads.

   The icon is a lucide name resolved by the card, so this file stays a
   data file and does not import a hundred components.
   ------------------------------------------------------------- */
export const KIND_ICON: Record<string, string> = {
  'meeting.invited':         'CalendarPlus',
  'meeting.answered':        'CalendarCheck',
  'meeting.proposed':        'CalendarClock',
  'meeting.moved':           'CalendarClock',
  'meeting.cancelled':       'CalendarX',
  'meeting.soon':            'Clock',
  'call.soon':               'Phone',
  'diary.today':             'CalendarDays',
  'guest.answered':          'UserCheck',

  'task.assigned':           'ListChecks',
  'task.due':                'Clock',
  'task.overdue':            'AlertTriangle',
  'task.release_requested':  'Undo2',
  'task.released':           'Check',

  'crm.account_assigned':    'Building2',
  'crm.lead_assigned':       'Target',
  'crm.winback':             'RotateCcw',
  'crm.dormant':             'Moon',
  'crm.import_finished':     'Upload',
  'crm.export_ready':        'Download',

  'content.review_requested': 'Eye',
  'content.approved':        'Check',
  'content.rejected':        'Undo2',
  'content.due':             'Send',

  'sales.commission':        'BadgePoundSterling',
  'sales.milestone_close':   'TrendingUp',
  'sales.milestone_hit':     'Trophy',

  'fleetsmart.renewal':      'ShieldAlert',
  'fleetsmart.decided':      'ShieldCheck',

  'admin.role_changed':      'KeyRound',
  'system.alert':            'AlertTriangle',
  'system.sync_failure':     'AlertTriangle',
  'system.message':          'MessageSquare',
  'analytics.anomaly':       'Activity',

  'team.trailer_sold':       'Truck',
  'team.contract_won':       'Trophy',
  'team.account_created':    'Building2',
  'team.milestone_hit':      'Trophy',
};

/**
 * The colour a notification carries.
 *
 * Severity first, because that is what the person is actually being
 * told, and then a handful of overrides where the kind says something
 * the severity cannot: a milestone hit is good news and an overdue
 * task is not, and both are the same severity.
 */
const KIND_TONE: Record<string, Tone> = {
  'meeting.cancelled':     'danger',
  'task.overdue':          'danger',
  'content.rejected':      'danger',
  'system.alert':          'danger',
  'system.sync_failure':   'danger',
  'fleetsmart.renewal':    'warning',
  'crm.dormant':           'warning',
  'crm.winback':           'info',
  'meeting.answered':      'success',
  'content.approved':      'success',
  'task.released':         'success',
  'sales.milestone_hit':   'success',
  'team.milestone_hit':    'success',
  'team.contract_won':     'success',
  'team.trailer_sold':     'success',
  'sales.commission':      'accent',
  'admin.role_changed':    'accent',
};

const SEVERITY_TONE: Record<NotificationSeverity, Tone> = {
  urgent: 'danger', attention: 'warning', info: 'neutral',
};

export function toneOf(n: Pick<NotificationRow, 'kind' | 'severity'>): Tone {
  return KIND_TONE[n.kind] ?? SEVERITY_TONE[n.severity] ?? 'neutral';
}

/* -------------------------------------------------------------
   What somebody can do about one, from the notification itself.

   This is the difference between a feed and a thing worth opening. An
   invitation that makes you go and find the meeting to answer it has
   wasted the trip.

   Every action names the endpoint that carries it out. Nothing here
   decides whether somebody may: the API asks the database, and the
   database asks the same policies the screen behind it asks.
   ------------------------------------------------------------- */
export type NotificationAction = {
  /** Sent back as `action_taken`, so what was done is on the record. */
  key: string;
  label: string;
  /**
   * Navy for the one to press, quiet for the rest.
   *
   * Not red, and that is rule one of the kit doing real work here. A
   * notification list is a column of independent cards, each with its
   * own primary action, so an accent on the primary is not one red
   * button on a screen: it is one per card, and a screenful of them is
   * a screen where nothing stands out. Screenshotted at 1080p with
   * five cards and it read as a wall of red.
   *
   * Red is kept for the thing red is for, which is destructive intent,
   * and nothing here is destructive: clearing a notification is a small
   * X, and calling a meeting off happens in the diary.
   */
  variant: 'primary' | 'secondary' | 'ghost';
  icon?: string;
  /**
   * `answer` posts to the invitation route. `open` follows the link.
   * `done` only marks it answered, for the ones where the doing
   * happens elsewhere and this is just closing the loop.
   */
  does: 'answer' | 'open' | 'done' | 'download';
};

export const KIND_ACTIONS: Record<string, NotificationAction[]> = {
  'meeting.invited': [
    { key: 'accept',  label: 'I can make it', variant: 'primary',   icon: 'Check', does: 'answer' },
    { key: 'decline', label: 'I cannot',      variant: 'secondary', icon: 'X',     does: 'answer' },
    { key: 'suggest', label: 'Suggest a time', variant: 'ghost',    icon: 'Clock', does: 'open' },
  ],
  'meeting.proposed': [
    { key: 'open', label: 'Look at the time they suggested', variant: 'primary', icon: 'CalendarClock', does: 'open' },
  ],
  'sales.commission': [
    { key: 'confirmed', label: 'That is right', variant: 'primary',   icon: 'Check',        does: 'done' },
    { key: 'queried',   label: 'That is wrong', variant: 'secondary', icon: 'AlertTriangle', does: 'open' },
  ],
  'crm.export_ready': [
    { key: 'download', label: 'Download it again', variant: 'primary', icon: 'Download', does: 'download' },
  ],
  'content.review_requested': [
    { key: 'open', label: 'Read it', variant: 'primary', icon: 'Eye', does: 'open' },
  ],
  'task.release_requested': [
    { key: 'open', label: 'Decide', variant: 'primary', icon: 'ArrowRight', does: 'open' },
  ],
  'fleetsmart.renewal': [
    { key: 'open', label: 'Start the renewal', variant: 'primary', icon: 'ArrowRight', does: 'open' },
  ],
  'crm.winback': [
    { key: 'open',    label: 'Have another go', variant: 'primary', icon: 'RotateCcw', does: 'open' },
    { key: 'dropped', label: 'Leave it',        variant: 'ghost',   does: 'done' },
  ],
  'crm.dormant': [
    { key: 'open', label: 'Open the prospect', variant: 'primary', icon: 'ArrowRight', does: 'open' },
  ],
};

export function actionsFor(n: Pick<NotificationRow, 'kind' | 'item_count'>): NotificationAction[] {
  /* A bunch loses its buttons. Three invitations behind one row cannot
     share an Accept: it would have to mean all three, and somebody who
     meant one has just accepted two meetings they have not read. The
     card offers the list instead. */
  if (n.item_count > 1) return [];
  return KIND_ACTIONS[n.kind] ?? [];
}

/* -------------------------------------------------------------
   When it happened, in the fewest words that are still exact.
   ------------------------------------------------------------- */
export function ago(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  const secs = Math.round((now.getTime() - then.getTime()) / 1000);

  if (secs < 45) return 'just now';
  if (secs < 90) return 'a minute ago';

  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins} minutes ago`;

  const hours = Math.round(mins / 60);
  if (hours < 24) return hours === 1 ? 'an hour ago' : `${hours} hours ago`;

  const sameYear = then.getFullYear() === now.getFullYear();
  const days = Math.round(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;

  return then.toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

/** Something in the future, said forwards. Used by the swept reminders. */
export function until(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  const mins = Math.round((then.getTime() - now.getTime()) / 60000);
  if (mins <= 0) return 'now';
  if (mins < 60) return `in ${mins} minutes`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return hours === 1 ? 'in an hour' : `in ${hours} hours`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'tomorrow' : `in ${days} days`;
}

/** The items inside a bunch, defended against a payload that is not one. */
export function bunchItems(n: Pick<NotificationRow, 'payload'>): BunchItem[] {
  const raw = (n.payload as { items?: unknown } | null)?.items;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((r): r is Record<string, unknown> => typeof r === 'object' && r !== null)
    .map((r) => ({
      title: typeof r.title === 'string' ? r.title : null,
      body:  typeof r.body === 'string' ? r.body : null,
      link:  typeof r.link === 'string' ? r.link : null,
      id:    typeof r.id === 'string' ? r.id : null,
    }));
}

/** The "see all of them" link a bunch carries, when the caller gave one. */
export function allLink(n: Pick<NotificationRow, 'payload'>): string | null {
  const v = (n.payload as { allLink?: unknown } | null)?.allLink;
  return typeof v === 'string' && v.length > 0 ? v : null;
}
