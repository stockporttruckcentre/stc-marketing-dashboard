/* =============================================================
   The live vocabulary, on the server, as one actor's own session sees
   it.

   A word is a make because it appears in `stock_trailers.make`. That is
   what lets "how many Chereaus at Carrington" work with nothing written
   down, and it is why the server has to read the same values the
   browser did before it plans the same sentence.

   THE INVARIANT

     authoritative vocabulary = the values visible through THIS actor's
     own RLS session

   and nothing else. Everything is read through the caller's client and
   cached against their user id. There is no shared index, no second
   opinion about what is public, and nothing to keep in step with the
   database.

   WHY THERE IS NO SHARED CACHE, THOUGH THERE COULD BE ONE.

   An earlier version of this file classified tables as company wide or
   actor scoped, and cached the company wide half once for everybody.
   The classification was read off `supabase/schema.sql`, where
   `calendar_events` is `auth.role() = 'authenticated'` and every signed
   in person genuinely does see every row.

   `migrations/006_meeting_invites.sql` replaces that policy:

     CREATE POLICY "calendar_events_select" ON calendar_events
       FOR SELECT USING (
         created_by = auth.uid()
         OR visibility = 'team'
         OR (visibility = 'specific' AND auth.uid() = ANY (visible_to))
         OR EXISTS (SELECT 1 FROM calendar_invites i
                    WHERE i.event_id = calendar_events.id
                      AND i.user_id = auth.uid()));

   So the classification was wrong within days of being written, and it
   was wrong in the direction that leaks. Nothing escaped, because
   `calendar_events` declares no free text column and so contributes no
   vocabulary today. That is luck, not design.

   The lesson is the shape of the mistake rather than the mistake. A
   hand maintained list of "tables we believe everybody can see" is a
   second copy of the security model, kept in a different language, in a
   different file, updated by somebody remembering. Every RLS migration
   from now on would have to be accompanied by a change here that no
   test could demand and no reviewer would think to ask for.

   Reading everything through the actor's own client costs one query per
   entity per person per minute and follows every future migration
   automatically. If that cost ever shows up in a profile, the answer is
   a measurement and then a narrower cache, not an assumption.
   ============================================================= */
import { ENTITIES } from '../schema';
import { buildIndex, type VocabularyIndex, type VocabularySnapshot } from '../vocab';

/** How long one person's index is trusted before it is read again. */
const TTL_MS = 60_000;

/** How many people's indexes to keep. Least recently read is evicted. */
const ACTOR_CACHE_MAX = 200;

/**
 * Whatever can produce an index for the actor being planned for.
 *
 * A function rather than a client, so the planner does not import
 * anything that reaches a database and can be exercised against a known
 * vocabulary without one.
 */
export type VocabularySource = () => Promise<VocabularyIndex>;

/** The minimum of Supabase this needs, so nothing here imports a client. */
type Queryable = {
  from: (table: string) => {
    select: (columns: string) => {
      limit: (n: number) => PromiseLike<{ data: unknown[] | null; error: unknown }>;
    };
  };
};

/**
 * Distinct values for every free text column an entity declares.
 *
 * Only declared free text columns are read, so this can never widen
 * what is filterable. Values only, never row contents. Whatever the
 * caller's client can see is what comes back, which is the whole
 * point: the row RLS hides, its vocabulary is hidden with it, with no
 * separate rule to maintain and no way for the two to disagree.
 */
export async function buildVocabulary(supabase: Queryable): Promise<VocabularySnapshot> {
  const out: VocabularySnapshot = {};

  for (const entity of ENTITIES) {
    const columns = entity.filters.filter((f) => f.freeText).map((f) => f.column);
    if (!columns.length) continue;

    /* One read per entity rather than one per column. Distinct values
       are counted here instead of in the database because PostgREST has
       no group-by, and the alternative is a view per column. */
    const { data, error } = await supabase
      .from(entity.table)
      .select(columns.join(', '))
      .limit(20_000);
    if (error || !data) continue;

    const counts: Record<string, Map<string, number>> = {};
    for (const c of columns) counts[c] = new Map();
    for (const row of data as Record<string, unknown>[]) {
      for (const c of columns) {
        const v = String(row[c] ?? '').trim();
        if (v.length < 2 || v.length > 60) continue;
        counts[c].set(v, (counts[c].get(v) ?? 0) + 1);
      }
    }

    out[entity.id] = {};
    for (const c of columns) {
      out[entity.id][c] = [...counts[c].entries()]
        .map(([value, rows]) => ({ value, rows }))
        /* Commonest first, capped. A column with ten thousand distinct
           customer names does not need all of them in the browser to
           make the common ones reachable. */
        .sort((a, b) => b.rows - a.rows)
        .slice(0, 1200);
    }
  }

  return out;
}

/* -------------------------------------------------------------
   One cache, keyed by who asked
   ------------------------------------------------------------- */

type Cached = { index: VocabularyIndex; at: number };

/** Keyed by authenticated user id. Insertion order is read order. */
const actorCache = new Map<string, Cached>();
const actorInFlight = new Map<string, Promise<VocabularyIndex>>();

async function actorIndex(
  supabase: Queryable, actorId: string, now: number,
): Promise<VocabularyIndex> {
  const held = actorCache.get(actorId);
  if (held && now - held.at < TTL_MS) {
    /* Touch, so the least recently used entry is the one evicted. */
    actorCache.delete(actorId);
    actorCache.set(actorId, held);
    return held.index;
  }
  const running = actorInFlight.get(actorId);
  if (running) return running;

  const load = (async () => {
    try {
      const index = buildIndex(await buildVocabulary(supabase));
      actorCache.set(actorId, { index, at: Date.now() });
      while (actorCache.size > ACTOR_CACHE_MAX) {
        const oldest = actorCache.keys().next().value as string | undefined;
        if (oldest === undefined) break;
        actorCache.delete(oldest);
      }
      return index;
    } catch {
      /* A failed read leaves this person's own last index standing, or
         an empty one. Never somebody else's. */
      return actorCache.get(actorId)?.index ?? buildIndex({});
    } finally {
      actorInFlight.delete(actorId);
    }
  })();
  actorInFlight.set(actorId, load);
  return load;
}

/**
 * The vocabulary valid for one person, right now.
 *
 * Returned rather than installed: the caller installs it in the same
 * synchronous run as the planning, because an await between the two is
 * exactly where somebody else's request gets to install theirs.
 */
export function vocabularyFor(supabase: Queryable, actorId: string): VocabularySource {
  return () => actorIndex(supabase, actorId, Date.now());
}

/** Forget everything cached, for a check that means to load its own. */
export function resetVocabularyCaches(): void {
  actorCache.clear();
  actorInFlight.clear();
}

/** Who is currently held, so a check can assert the scoping. */
export function cachedActors(): string[] {
  return [...actorCache.keys()];
}
