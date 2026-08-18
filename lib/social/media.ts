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
import type { FileStore, StoredFile } from '@/lib/command/files';

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
  file: { name: string; mime: string; bytes: Uint8Array },
): Promise<StoredFile> {
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
  return files.put(file);
}

/** The narrowest slice of the Supabase client this needs. */
type Buckets = {
  storage: {
    from: (bucket: string) => {
      upload: (path: string, body: Blob | ArrayBuffer | Uint8Array, opts?: { upsert?: boolean; contentType?: string })
        => PromiseLike<{ error: { message: string } | null }>;
      getPublicUrl: (path: string) => { data: { publicUrl: string } };
    };
  };
};

/**
 * The real bucket, as a `FileStore`.
 *
 * The only place in this application that names Supabase storage. Every
 * caller above talks to the port, which is what lets the whole path be
 * checked with no bucket anywhere.
 */
export function bucketStore(client: Buckets, at: () => number = Date.now): FileStore {
  return {
    async put(file) {
      const key = imageKey(file.name, at());
      const { error } = await client.storage.from(BUCKET)
        .upload(key, file.bytes, { upsert: false, contentType: file.mime });
      if (error) return { ok: false, why: error.message };
      const { data } = client.storage.from(BUCKET).getPublicUrl(key);
      return { ok: true, url: data.publicUrl };
    },
  };
}
