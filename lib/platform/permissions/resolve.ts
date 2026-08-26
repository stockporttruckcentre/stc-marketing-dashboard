/* =============================================================
   What this person may actually do, resolved once per screen.

   Every screen needs the answer before it draws, because CLAUDE.md is
   explicit that a control which appears and then refuses teaches people
   the tool is unreliable. So a page reads the set here, hands it down,
   and every button decides whether to exist from it.

   ---- This does not authorize anything ----

   It is what the interface shows. The authorization is `command_may()`
   in the database, evaluated inside the same transaction as the write,
   under row level security. That is the only place an answer cannot be
   walked around by calling a different route, and it stays the
   authority whatever this file returns.

   Two things follow from that, and both are deliberate:

   1. A route never trusts a set that arrived from a browser. It
      resolves its own.
   2. This being wrong makes the interface wrong, never the data. A
      button that should have been hidden still fails at the database.

   ---- Where the answer comes from ----

   `capability_report()`, added in migration 048, which answers in
   `command_may`'s own order: an explicit refusal, then an explicit
   grant, then the person's role template, then the legacy role seed for
   anybody who has not been given a template yet.

   Asking the database rather than deriving it here is the point. A
   second implementation of the resolution order is a second thing to
   keep in step, and `check:capabilities` asserts the database's answer
   matches `command_may` capability by capability. Nothing asserts that
   about a copy written in TypeScript, because there is no copy.
   ============================================================= */
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  type Capabilities, type Capability, type CapabilityScope,
  CAPABILITY_BY_KEY,
} from './catalog';

/** One capability, as the admin screen needs to explain it. */
export type ResolvedCapability = {
  key: Capability;
  granted: boolean;
  /** Plain words: where the answer came from. */
  source: string;
  scope: CapabilityScope | null;
  reason: string | null;
  grantedBy: string | null;
  expiresAt: string | null;
};

export type Resolved = {
  /** Just the ones they hold, for `holds(caps, 'social.approve')`. */
  caps: Capabilities;
  /** How far each one reaches. */
  scopes: Partial<Record<Capability, CapabilityScope>>;
  /** Everything, granted or not, with its provenance. */
  all: ResolvedCapability[];
};

const EMPTY: Resolved = { caps: new Set(), scopes: {}, all: [] };

/**
 * Resolve one person's capabilities.
 *
 * `userId` defaults to the signed in person. Passing somebody else is
 * administration, and the database refuses it unless the caller holds
 * `admin.users` or `admin.audit`, so this does not repeat that check
 * and cannot disagree with it.
 *
 * Returns an empty set on failure rather than throwing. A screen whose
 * permission read failed should draw with nothing enabled, which is the
 * safe direction: the alternative is a page that will not load at all
 * because one query timed out.
 */
export async function resolveCapabilities(
  supabase: SupabaseClient,
  userId?: string,
): Promise<Resolved> {
  let id = userId;
  if (!id) {
    const { data } = await supabase.auth.getUser();
    id = data?.user?.id;
  }
  if (!id) return EMPTY;

  const { data, error } = await supabase.rpc('capability_report', { p_user: id });
  if (error || !Array.isArray(data)) return EMPTY;

  const caps: Capabilities = new Set();
  const scopes: Partial<Record<Capability, CapabilityScope>> = {};
  const all: ResolvedCapability[] = [];

  for (const row of data as Record<string, unknown>[]) {
    const key = row.key as Capability;
    /* A capability the database knows and the mirror does not is a
       deployment running ahead of this build. Skipping it is right:
       nothing here can name it, so nothing here can use it, and
       `check:catalog` is what stops the two drifting for long. */
    if (!CAPABILITY_BY_KEY[key]) continue;

    const granted = row.granted === true;
    const scope = (row.scope as CapabilityScope | null) ?? null;
    if (granted) {
      caps.add(key);
      if (scope) scopes[key] = scope;
    }
    all.push({
      key,
      granted,
      source: String(row.source ?? ''),
      scope,
      reason: (row.reason as string | null) ?? null,
      grantedBy: (row.granted_by as string | null) ?? null,
      expiresAt: (row.expires_at as string | null) ?? null,
    });
  }

  return { caps, scopes, all };
}

/**
 * The same question from a route, which has one more thing to do about
 * the answer.
 *
 * A route that finds somebody lacks a capability returns 403 and stops.
 * It does not fall back to a narrower read, because a route that
 * quietly returns less than was asked for is how somebody concludes
 * their data has been deleted.
 */
export function refuse(cap: Capability): Response {
  const entry = CAPABILITY_BY_KEY[cap];
  return new Response(
    JSON.stringify({
      error: 'not permitted',
      capability: cap,
      /* Named in the words the admin screen uses, so somebody can ask
         for the right thing rather than pasting an error at an
         administrator. */
      needs: entry ? entry.label : cap,
    }),
    { status: 403, headers: { 'content-type': 'application/json' } },
  );
}
