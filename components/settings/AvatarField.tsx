'use client';

import { useRef, useState } from 'react';
import { Camera, Loader, Trash2 } from 'lucide-react';
import { Button, Label } from '@/components/kit/primitives';
import { createClient } from '@/lib/supabase/client';
import { Avatar } from '@/components/kit/avatar';

/* =============================================================
   A face on your profile.

   From the business: "Add options to update your profile pic."

   ---- Where the file goes ----

   `brand-assets`, which is the bucket this application already has and
   already treats as its one place for files: see `lib/social/media.ts`.
   A second bucket for one image per employee would be a second set of
   policies to get right.

   The key is `avatars/<user id>/<timestamp>.<ext>`, and the timestamp is
   the whole of why it is there. Uploading over the same key gives every
   browser and every CDN in between a URL whose contents changed, which
   is the definition of a cache that will now show the old picture for
   an unpredictable length of time. A new key every time is a new URL
   every time, and the old object is deleted after the new one is
   written rather than before.

   ---- Which column it writes ----

   `profiles.photo_url`, through `update_my_profile`, and both halves of
   that matter. The column, because this uploader used to write
   `avatar_url` while the team directory and the admin panel read
   `photo_url`: a picture uploaded here appeared on your own sidebar and
   nowhere else in the product. Migration 101 folded the two into one.

   Through the RPC rather than a table update, because a direct write
   is how the wrong column got picked in the first place. The function
   is the only writer, so there is one place to look.

   ---- What it refuses ----

   Anything that is not an image, and anything over 2MB. Both are
   checked here for the message and again by the bucket for the rule: a
   size limit only enforced in a browser is a suggestion.
   ============================================================= */

const MAX_BYTES = 2 * 1024 * 1024;
const BUCKET = 'brand-assets';

export function AvatarField({ userId, name, initial }: {
  userId: string;
  /** For the initials, when there is no picture. */
  name: string;
  initial: string | null;
}) {
  const supabase = createClient();
  const [url, setUrl] = useState<string | null>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pick = useRef<HTMLInputElement>(null);

  async function upload(file: File) {
    setError(null);

    if (!file.type.startsWith('image/')) {
      setError('That is not an image.');
      return;
    }
    if (file.size > MAX_BYTES) {
      setError(`That is ${(file.size / 1024 / 1024).toFixed(1)}MB. Two is the limit.`);
      return;
    }

    setBusy(true);
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '');
    const key = `avatars/${userId}/${Date.now()}.${ext}`;

    const { error: up } = await supabase.storage.from(BUCKET)
      .upload(key, file, { contentType: file.type, upsert: false });
    if (up) { setBusy(false); setError(up.message); return; }

    const { data } = supabase.storage.from(BUCKET).getPublicUrl(key);
    const next = data.publicUrl;

    const saved = await save(next);
    if (saved) { setBusy(false); setError(saved); return; }

    /* The old one goes AFTER the new one is saved, so a failure
       anywhere above leaves somebody with the picture they had rather
       than with none. */
    if (url) {
      const old = keyFromUrl(url);
      if (old) await supabase.storage.from(BUCKET).remove([old]);
    }

    setUrl(next);
    setBusy(false);
  }

  /* An empty string clears, a null leaves the field alone. That is
     `update_my_profile`'s convention for all nine of its arguments and
     it is what lets this form post one field without blanking the
     other eight. */
  async function save(url: string | null): Promise<string | null> {
    const { error } = await supabase.rpc('update_my_profile', {
      p_full_name: null, p_job_title: null, p_location: null,
      p_timezone: null, p_working_hours: null, p_responsibilities: null,
      p_skills: null, p_photo_url: url ?? '', p_theme: null,
    });
    return error ? error.message : null;
  }

  async function clear() {
    setBusy(true);
    setError(null);
    const saved = await save(null);
    if (saved) { setBusy(false); setError(saved); return; }
    const old = url ? keyFromUrl(url) : null;
    if (old) await supabase.storage.from(BUCKET).remove([old]);
    setUrl(null);
    setBusy(false);
  }

  return (
    <div>
      <Label>Your picture</Label>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 8 }}>
        {/* The same circle everybody else will see you in, so what this
            tab previews is what the team list draws. */}
        <Avatar name={name} url={url} size={64} decorative />

        <div style={{ display: 'flex', flexDirection: 'column', gap: 7, minWidth: 0 }}>
          <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
            <Button size="sm" variant="secondary" disabled={busy}
              onClick={() => pick.current?.click()}>
              {busy ? <Loader size={13} className="spin" /> : <Camera size={13} />}
              {url ? 'Change' : 'Upload a picture'}
            </Button>
            {url && (
              <Button size="sm" variant="ghost" disabled={busy} onClick={clear}>
                <Trash2 size={13} /> Remove
              </Button>
            )}
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--text-subtle)', lineHeight: 1.45 }}>
            {error
              ? <span style={{ color: 'var(--danger)' }}>{error}</span>
              : 'A square one looks best. Two megabytes at most. Everybody on the team can see it.'}
          </div>
        </div>
      </div>

      <input
        ref={pick}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          /* Cleared so that picking the same file twice, after a failed
             upload, fires the change event again. */
          e.target.value = '';
          if (file) void upload(file);
        }}
      />
    </div>
  );
}

/** The object key inside a public URL, for deleting the one being replaced. */
function keyFromUrl(url: string): string | null {
  const at = url.indexOf(`/${BUCKET}/`);
  if (at === -1) return null;
  const key = url.slice(at + BUCKET.length + 2);
  return key.startsWith('avatars/') ? key : null;
}
