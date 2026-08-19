/* =============================================================
   Writing a social post, in one place.

   The composer in `components/SocialPlanner.tsx` fills in three things
   the person never types: who wrote it, whether it needs approving, and
   the date it goes out if nobody picked one. Those are properties of who
   is writing rather than of what the post says, and a second copy of
   them is how the command bar's drafts would end up unattributed or
   waiting for approval that an admin's own drafts do not need.

   `command_create_post` in migration 022 is the operation. This is the
   thin wrapper both callers use, and `PLATFORMS` lives here so the
   composer's checkboxes and the sentence reader agree about what a
   platform is called.
   ============================================================= */

/** Where a post can go. The composer's checkboxes and the words. */
export const PLATFORMS = ['Facebook', 'LinkedIn', 'Instagram', 'X'] as const;
export type Platform = (typeof PLATFORMS)[number];

/** What the composer starts with, and what a sentence naming none means. */
export const DEFAULT_PLATFORMS: Platform[] = ['Facebook', 'LinkedIn'];

/** The narrowest slice of the client this needs. */
type Rpc = {
  rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
};

export type PostOutcome =
  | { ok: true; id: string; status: string }
  | { ok: false; why: string };

/**
 * Write a post.
 *
 * The author and the status come from the profile of whoever is asking,
 * inside the function, because a client that decided its own status
 * could put a post straight to approved.
 */
export async function createPost(
  client: Rpc,
  input: {
    content: string;
    platforms?: readonly string[];
    scheduledDate?: string | null;
    caption?: string | null;
    hashtags?: readonly string[];
    imageUrl?: string | null;
  },
): Promise<PostOutcome> {
  const { data, error } = await client.rpc('command_create_post', {
    p_content: input.content,
    p_platforms: [...(input.platforms ?? DEFAULT_PLATFORMS)],
    p_scheduled: input.scheduledDate ?? null,
    p_caption: input.caption ?? null,
    p_hashtags: [...(input.hashtags ?? [])],
    p_image: input.imageUrl ?? null,
  });
  if (error) return { ok: false, why: String((error as { message?: string })?.message ?? error) };

  const body = (data ?? {}) as { id?: string; status?: string };
  return { ok: true, id: String(body.id ?? ''), status: String(body.status ?? 'draft') };
}
