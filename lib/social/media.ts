/* =============================================================
   The picture on a social post.

   This was the body of `uploadImage` inside the composer, which meant
   the command bar could not put an image on a post without somebody
   writing the bucket name, the key rule and the type check a second
   time. It is one operation: which bucket, what a safe key looks like,
   and what counts as an image.

   REMOVING ONE IS NOT HERE, AND DOES NOT NEED TO BE.

   `image_url` is an ordinary writable column, so "remove the image from
   this post" is a field clear and goes through the same preview, the
   same allowlist and the same transaction as any other write. Nothing
   about taking a picture off a post is visual.
   ============================================================= */
import type { FileStore, StagedFile } from '@/lib/command/files';

/** The bucket the composer has always used. */
export const BUCKET = 'brand-assets';

/** What a social post will accept as a picture. */
export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif'];

/** The biggest picture worth putting on a post. */
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

/**
 * A key nobody else can collide with, out of a name anybody can type.
 *
 * The timestamp is passed in rather than read, so the same inputs
 * produce the same key and a check can assert it.
 */
export function imageKey(name: string, at: number): string {
  return `post-${at}-${name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80)}`;
}

export function looksLikeAnImage(file: { name: string; mime: string }): boolean {
  return IMAGE_TYPES.includes((file.mime ?? '').toLowerCase())
    || /\.(png|jpe?g|gif|webp|avif)$/i.test(file.name ?? '');
}

/**
 * Put a picture where a post can point at it.
 *
 * Both callers land here: the composer, which has a `File` from an
 * input, and the command bar's preparer, which has the bytes the
 * request carried.
 */
export async function storeImage(
  files: FileStore,
  file: { key: string; name: string; mime: string; bytes: Uint8Array },
): Promise<StagedFile> {
  if (!looksLikeAnImage(file)) {
    return { ok: false, why: `${file.name} is not an image, so it cannot go on a post` };
  }
  if (file.bytes.byteLength > MAX_IMAGE_BYTES) {
    return {
      ok: false,
      why: `${file.name} is ${(file.bytes.byteLength / 1_048_576).toFixed(1)}MB, `
        + `which is more than ${MAX_IMAGE_BYTES / 1_048_576}MB`,
    };
  }
  return files.stage(file);
}

/** The narrowest slice of the Supabase client this needs. */
type Buckets = {
  storage: {
    from: (bucket: string) => {
      upload: (path: string, body: Blob | ArrayBuffer | Uint8Array, opts?: { upsert?: boolean; contentType?: string })
        => PromiseLike<{ error: { message: string; statusCode?: string } | null }>;
      remove: (paths: string[]) => PromiseLike<{ error: { message: string } | null }>;
      getPublicUrl: (path: string) => { data: { publicUrl: string } };
    };
  };
  rpc?: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
};

/**
 * The real bucket, as a `FileStore`.
 *
 * The only place in this application that names Supabase storage. Every
 * caller above talks to the port, which is what lets the whole path be
 * checked with no bucket anywhere.
 *
 * `upsert: false` is deliberate and is what makes `stage` idempotent
 * rather than duplicating: the same key twice comes back as a conflict,
 * which is the object already being there, which is a reuse.
 */
export function bucketStore(
  client: Buckets,
  opts: { notes?: Notes; actor?: string | null } = {},
): FileStore {
  /* Reached on first use rather than on construction, so a request that
     never touches a file never asks for a storage client at all. The
     route check exercises the whole apply path with a stub that has no
     `storage` on it. */
  const bucket = () => client.storage.from(BUCKET);

  return {
    async stage(file) {
      const { error } = await bucket().upload(file.key, file.bytes, {
        upsert: false, contentType: file.mime,
      });

      if (error) {
        /* Already there. The key is deterministic, so the object under
           it is this same command's own earlier attempt: the same
           confirmation, the same bytes, the same target. Reusing it is
           the whole point of the key not moving. */
        if (isAlreadyThere(error)) {
          const { data } = bucket().getPublicUrl(file.key);
          return { ok: true, url: data.publicUrl, key: file.key, reused: true };
        }
        return { ok: false, why: error.message };
      }

      const { data } = bucket().getPublicUrl(file.key);
      return { ok: true, url: data.publicUrl, key: file.key, reused: false };
    },

    async remove(key) {
      const { error } = await bucket().remove([key]);
      if (error) return { ok: false, why: error.message };
      return { ok: true };
    },

    async abandon(key, why) {
      /* Only reachable when `remove` itself failed. Written down rather
         than swallowed, so the command can say honestly that it left
         something behind. */
      await opts.notes?.(key, BUCKET, why, opts.actor ?? null);
    },
  };
}

/** How a durable note about an orphan is written. Server only. */
export type Notes = (
  key: string, bucket: string, why: string, actor: string | null,
) => Promise<void>;

/**
 * Supabase storage's way of saying the object is already there.
 *
 * Checked on the code and on the words, because the two versions of the
 * client in use here report it differently and a missed conflict would
 * turn a reuse into a refusal.
 */
function isAlreadyThere(error: { message: string; statusCode?: string }): boolean {
  return error.statusCode === '409'
    || /already exists|duplicate|resource already/i.test(error.message ?? '');
}

/**
 * The orphan note, over a service-role client.
 *
 * Separate from `bucketStore` so the storage half can be faked without
 * a database and the database half without a bucket.
 */
export function orphanNotes(
  connect: () => { rpc: (n: string, a: Record<string, unknown>) => PromiseLike<{ error: unknown }> },
): Notes {
  let held: ReturnType<typeof connect> | null = null;
  return async (key, bucket, why, actor) => {
    try {
      await (held ??= connect()).rpc('command_note_orphan', {
        p_key: key, p_bucket: bucket, p_why: why, p_actor: actor,
      });
    } catch {
      /* Nothing left to do. The command already reports that it left
         external state behind; this was the attempt to make it
         findable. */
    }
  };
}
