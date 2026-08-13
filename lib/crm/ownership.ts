/* =============================================================
   Who owns an account.

   The meeting asked for a rep to be able to see just their own
   customers. That sounds like a filter and it is not, because there was
   nothing dependable to filter on.

   `crm_contacts.assigned_to` is a free text column. It holds whatever
   somebody typed into a spreadsheet cell: "Alex", "alex ellis",
   "A.Ellis", "alex@stockporttruckcentre.co.uk", and a good number of
   blanks. Filtering on equality against a profile name would quietly
   hide half a rep's portfolio, which is worse than not filtering at all.

   Two halves to the fix.

   Reading: match generously. A person is identified by several keys, and
   a contact belongs to them if its assigned_to folds down to any of
   them. That covers the history already in the database.

   Writing: match exactly. The Assigned column is a picker of real
   people, not a text box, so everything written from today is canonical
   and the generous matching is only ever cleaning up the past.

   This deliberately does not need the `account_ownership` table. When
   that arrives it becomes the source of truth and this becomes the
   backfill: `ownerKeys` is what maps the old text onto a real user id.
   ============================================================= */
import type { CRMContact, Profile } from '@/lib/types';

/** Lowercase, punctuation folded, single spaced. "A.Ellis" and "a ellis" meet here. */
export function ownerKey(v: string | null | undefined): string {
  if (!v) return '';
  return String(v)
    .toLowerCase()
    .replace(/[._\-]+/g, ' ')
    .replace(/[^a-z0-9@ ]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Every string that plausibly means this person: their name, their email,
 * the local part of their email, and their first name on its own.
 *
 * First name is included because half the CRM says "Alex" and refusing to
 * match it would leave those rows ownerless. It is the one loose rule
 * here, and it is why `ownersAmbiguous` exists below.
 */
export function ownerKeys(p: Profile): string[] {
  const keys = new Set<string>();
  const add = (s: string | null | undefined) => { const k = ownerKey(s); if (k) keys.add(k); };

  add(p.full_name);
  add(p.email);
  if (p.email) add(p.email.split('@')[0]);

  const first = ownerKey(p.full_name).split(' ')[0];
  if (first && first.length > 2) keys.add(first);

  return [...keys];
}

/**
 * Two people whose first names collide, so the loose first-name rule
 * would claim the same rows for both. The UI says so rather than showing
 * one of them somebody else's portfolio.
 */
export function ownersAmbiguous(profiles: Profile[]): string[] {
  const seen = new Map<string, number>();
  for (const p of profiles) {
    const first = ownerKey(p.full_name).split(' ')[0];
    if (first && first.length > 2) seen.set(first, (seen.get(first) ?? 0) + 1);
  }
  return [...seen.entries()].filter(([, n]) => n > 1).map(([k]) => k);
}

export function isOwnedBy(contact: CRMContact, profile: Profile, ambiguous: string[] = []): boolean {
  const assigned = ownerKey(contact.assigned_to);
  if (!assigned) return false;
  return ownerKeys(profile).some((k) => k === assigned && !ambiguous.includes(k));
}

/** What the Assigned column offers. Canonical names, so new rows need no fuzzy matching. */
export function ownerOptions(profiles: Profile[]): string[] {
  return profiles
    .map((p) => p.full_name)
    .filter((n): n is string => Boolean(n && n.trim()))
    .sort((a, b) => a.localeCompare(b));
}

export type Scope = { kind: 'all' } | { kind: 'mine' } | { kind: 'person'; id: string } | { kind: 'unassigned' };

export function applyScope(
  rows: CRMContact[], scope: Scope, me: Profile, profiles: Profile[],
): CRMContact[] {
  if (scope.kind === 'all') return rows;
  const ambiguous = ownersAmbiguous(profiles);
  if (scope.kind === 'unassigned') return rows.filter((r) => !ownerKey(r.assigned_to));
  if (scope.kind === 'mine') return rows.filter((r) => isOwnedBy(r, me, ambiguous));
  const who = profiles.find((p) => p.id === scope.id);
  return who ? rows.filter((r) => isOwnedBy(r, who, ambiguous)) : rows;
}

export function scopeToParam(s: Scope): string {
  return s.kind === 'person' ? `person:${s.id}` : s.kind;
}

export function scopeFromParam(v: string | null): Scope {
  if (!v) return { kind: 'all' };
  if (v.startsWith('person:')) return { kind: 'person', id: v.slice(7) };
  if (v === 'mine' || v === 'unassigned') return { kind: v };
  return { kind: 'all' };
}
