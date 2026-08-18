/* =============================================================
   Somewhere to put bytes that are not a row.

   A post's image is a file on a bucket and a URL in a column. The bytes
   cannot go in the row: an image in `social_posts.image_url` would be
   megabytes of base64 on every read of the planner, and the browser
   renders that column as the source of an `<img>`.

   So this is a port, exactly like `Store`. The mutation runtime knows
   there is somewhere to put a file and does not know it is Supabase
   storage, which is what lets the checks run the whole path against a
   fake with no bucket anywhere.

   IT IS NOT PART OF THE TRANSACTION, AND THAT HAS CONSEQUENCES.

   The upload happens before the programme commits, so:

     upload succeeds
     database transaction fails
     -> an object nobody references

   The first version of this port had `put` and nothing else, and a key
   built from `Date.now()`. Every retry of the same confirmed command
   therefore uploaded ANOTHER copy under another key, and the first was
   left behind for good. A file is not expensive like a Lusha credit,
   but it is still an external effect belonging to a command that
   failed, and "cheap" is not a reason to leave litter nobody can find.

   THREE OPERATIONS, AND A KEY THAT DOES NOT MOVE.

     stage    put the bytes at a DETERMINISTIC key, derived from the
              confirmation, the file's own digest, the operation and
              what it is for. The same confirmed command staged twice
              reuses the object rather than making a second one, and
              says which it did.
     remove   take a staged object away when the transaction it
              belonged to did not commit.
     abandon  record, durably, that an object could not be removed. A
              cleanup that fails silently is the same litter with a
              clear conscience.

   THE INVARIANT.

     the database command fails
     -> nothing live points at the upload
     -> retrying makes no second copy
     -> anything left behind is recorded and findable
   ============================================================= */

export type StagedFile =
  | {
      ok: true;
      /** Where it can be fetched from. */
      url: string;
      /** The key it was stored under, so it can be removed again. */
      key: string;
      /**
       * True when this exact object was already there.
       *
       * The retry path. It is worth reporting rather than swallowing:
       * a command that says it uploaded something and did not is the
       * same lie in the other direction.
       */
      reused: boolean;
    }
  | { ok: false; why: string };

export type FileStore = {
  /**
   * Put bytes at a key the caller chose, and say where they landed.
   *
   * The key is deterministic and supplied, never invented here. That is
   * the whole recovery story: the same command retried asks for the
   * same key and gets the same object.
   */
  stage(file: {
    key: string;
    name: string;
    mime: string;
    bytes: Uint8Array;
  }): Promise<StagedFile>;

  /** Take a staged object away. */
  remove(key: string): Promise<{ ok: true } | { ok: false; why: string }>;

  /**
   * Write down that an object is orphaned and could not be removed.
   *
   * Called only when `remove` itself failed. A command that leaves
   * external state behind says so somewhere durable rather than
   * reporting that it left none.
   */
  abandon(key: string, why: string): Promise<void>;
};

/**
 * The key one upload gets, forever.
 *
 * Everything that decides WHICH file this is, and nothing that decides
 * when it happened:
 *
 *   confirmation  which confirmed command. A retry of the same one is
 *                 the same upload
 *   digest        the bytes themselves. A different file under the same
 *                 confirmation is a different object
 *   operation     what it is being uploaded for
 *   target        which record, where there is one
 *
 * No clock. A timestamp in the key is what made every retry a second
 * copy, and it bought nothing: collisions are what the digest and the
 * confirmation are for.
 */
export function stagingKey(input: {
  confirmation: string;
  digest: string;
  operation: string;
  target?: string | null;
  /** Kept only so a person looking at a bucket can tell what it is. */
  name: string;
}): string {
  const stem = input.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-60) || 'file';
  const parts = [input.operation, input.confirmation, input.digest, input.target ?? 'none'];
  return `${fold(parts.join('|'))}-${stem}`;
}

/**
 * A short, stable fold of a string.
 *
 * FNV-1a, the same one `context.ts` uses on a file's contents, because
 * this runs where `crypto` may not and it only has to be stable and
 * collision-resistant enough to name an object.
 */
function fold(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  let g = 0x01000193;
  for (let i = text.length - 1; i >= 0; i -= 1) {
    g ^= text.charCodeAt(i);
    g = Math.imul(g, 0x811c9dc5) >>> 0;
  }
  return `${h.toString(36)}${g.toString(36)}`;
}

/**
 * What a caller that has not wired one up gets.
 *
 * A refusal by name rather than a silent no-op. A command that needed
 * somewhere to put a file and quietly did not put it anywhere would
 * report success and leave a post with no image on it.
 */
export const NO_FILES: FileStore = {
  async stage() {
    return { ok: false, why: 'there is nowhere to put a file on this request' };
  },
  async remove() {
    return { ok: false, why: 'there is nowhere to put a file on this request' };
  },
  async abandon() { /* nothing was staged, so there is nothing to record */ },
};
