'use client';

import { useRef, useState } from 'react';
import { Camera, Loader, Trash2 } from 'lucide-react';
import { Button, Label } from '@/components/kit/primitives';
import { createClient } from '@/lib/supabase/client';

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

  const initials = name.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase();

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

    const { error: saved } = await supabase.from('profiles')
      .update({ avatar_url: next }).eq('id', userId);
    if (saved) { setBusy(false); setError(saved.message); return; }

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

  async function clear() {
    setBusy(true);
    setError(null);
    const { error: saved } = await supabase.from('profiles')
      .update({ avatar_url: null }).eq('id', userId);
    if (saved) { setBusy(false); setError(saved.message); return; }
    const old = url ? keyFromUrl(url) : null;
    if (old) await supabase.storage.from(BUCKET).remove([old]);
    setUrl(null);
    setBusy(false);
  }

  return (
    <div>
      <Label>Your picture</Label>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 8 }}>
        <div style={{
          width: 64, height: 64, borderRadius: 'var(--r-full)', flex: 'none',
          background: 'var(--bg-subtle)', border: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          overflow: 'hidden',
          fontFamily: 'var(--panton)', fontWeight: 800, fontSize: 20,
          color: 'var(--text-muted)', letterSpacing: '-0.02em',
        }}>
          {url
            /* eslint-disable-next-line @next/next/no-img-element */
            ? <img src={url} alt="" width={64} height={64}
                style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            : initials || '?'}
        </div>

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
