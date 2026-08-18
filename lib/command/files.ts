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

   IT IS NOT PART OF THE TRANSACTION, AND DOES NOT PRETEND TO BE.

   An object put on a bucket cannot be rolled back by a failing SQL
   statement. Unlike a Lusha lookup it costs nothing, so a failed write
   leaves an orphaned object and is recovered by asking again rather
   than by a ledger of purchases. The preparer contract is where that
   distinction already lives: `describe` never uploads, `run` does, and
   the row write goes into the programme's own transaction.
   ============================================================= */

export type StoredFile =
  | { ok: true; url: string }
  | { ok: false; why: string };

export type FileStore = {
  /**
   * Put bytes somewhere they can be fetched from, and say where.
   *
   * `name` is a suggestion. The implementation decides the real key, so
   * two people uploading `photo.jpg` do not overwrite each other.
   */
  put(file: { name: string; mime: string; bytes: Uint8Array }): Promise<StoredFile>;
};

/**
 * What a caller that has not wired one up gets.
 *
 * A refusal by name rather than a silent no-op. A command that needed
 * somewhere to put a file and quietly did not put it anywhere would
 * report success and leave a post with no image on it.
 */
export const NO_FILES: FileStore = {
  async put() {
    return { ok: false, why: 'there is nowhere to put a file on this request' };
  },
};
