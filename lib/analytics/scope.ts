/* =============================================================
   What Analytics is currently showing.

   From the agreed development scope, Task 1:

     Personal is not a fourth division. Model the state cleanly rather
     than pretending Personal is a division if that makes the existing
     `DivisionFilter` type semantically wrong.

   It would. `DivisionFilter` is `'stc' | 'rental' | 'trailer' | null`
   and every Protean helper in `lib/protean/rpc.ts` takes one and puts
   it in a WHERE clause against a division column. A fourth member
   called `personal` would type check its way into a dozen functions
   that would then look for a division nobody has.

   So the page's state is a Scope, and a Scope only produces a
   `DivisionFilter` where one is meaningful. `divisionOf` is the single
   place that conversion happens, and it answers `null` for Personal
   rather than inventing a division, because a personal portfolio spans
   all three.
   ============================================================= */
import type { Division, DivisionFilter } from '@/lib/protean/rpc';

export type Scope =
  /** Every division, which is what the page opens on. */
  | { kind: 'company' }
  /** One division, which is the drill in that has always been here. */
  | { kind: 'division'; slug: Division }
  /**
   * One person's portfolio.
   *
   * `person` is null for "whoever is signed in", so a link can be
   * written without knowing who will follow it. Task 4's dashboard
   * deep link relies on that.
   */
  | { kind: 'personal'; person: string | null };

export const COMPANY: Scope = { kind: 'company' };

const DIVISIONS: readonly string[] = ['stc', 'rental', 'trailer'];

/** The division a scope narrows to, where that means anything. */
export function divisionOf(scope: Scope): DivisionFilter {
  return scope.kind === 'division' ? scope.slug : null;
}

export function isPersonal(scope: Scope): boolean {
  return scope.kind === 'personal';
}

/* -------------------------------------------------------------
   The address bar

   From the scope: "Personal Analytics must support a stable state in
   the URL so another screen can open it directly [...] Refreshing the
   page while in Personal mode must retain the intended scope."

   One reader and one writer, both here, so the link Task 4 writes and
   the link this page reads are the same grammar.
   ------------------------------------------------------------- */

/** What goes in the address bar for a scope. Empty for the company. */
export function scopeQuery(scope: Scope): string {
  if (scope.kind === 'company') return '';
  if (scope.kind === 'division') return `?scope=${scope.slug}`;
  return scope.person ? `?scope=personal&person=${scope.person}` : '?scope=personal';
}

/** A whole address, for a link written from another screen. */
export function analyticsHref(scope: Scope): string {
  return `/dashboard/analytics${scopeQuery(scope)}`;
}

/**
 * The scope an address asks for, before anybody has been authorised.
 *
 * DELIBERATELY NOT A PERMISSION DECISION. This reads a string somebody
 * can type. Whether the person it names may be opened is answered by
 * `personal_analytics_may_view` in the database, by the server, every
 * time. The scope is explicit about the difference:
 *
 *   Do not trust a selected-person URL parameter without server-side
 *   validation.
 */
export function scopeFromQuery(
  params: { scope?: string | string[]; person?: string | string[] },
): Scope {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const asked = (one(params.scope) ?? '').toLowerCase();
  const person = one(params.person) ?? null;

  if (asked === 'personal') {
    return { kind: 'personal', person: UUID.test(person ?? '') ? person : null };
  }
  if (DIVISIONS.includes(asked)) return { kind: 'division', slug: asked as Division };
  return COMPANY;
}

/* Shape only. A well formed UUID belonging to somebody else still gets
   nothing back: this stops a malformed one reaching the database as a
   query parameter, it does not decide anything. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Somebody the signed-in person is allowed to open. */
export type Viewable = {
  id: string;
  full_name: string;
  email: string;
  role_slug: string;
  role_name: string;
  is_self: boolean;
};
