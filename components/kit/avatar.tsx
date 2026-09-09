'use client';

/* =============================================================
   One face, everywhere a face is drawn.

   There were three of these: the team directory's, which could show a
   picture, and the work board's and the diary's, which could only ever
   show initials because neither had anywhere to put a URL. So somebody
   uploaded a photograph in Settings, saw it on their own sidebar, and
   then went on looking like two grey letters to every colleague on
   every other screen in the product.

   ---- Why the ring is a prop rather than a second component ----

   The diary needs the circle to carry whether somebody has accepted,
   and that was the reason it grew its own copy. It is one border and
   one text decoration. Passing them in costs less than a second
   implementation that drifts, and drift here is the exact bug this
   file exists to close: two circles for one person, differing by a
   shade, read as two different people for the half second that
   matters.

   ---- A picture that will not load ----

   The bucket is public, but a URL can still 404 after somebody clears
   an object by hand, and a broken image icon in a 22px circle is worse
   than initials. `onError` drops back to the initials rather than
   leaving the browser to draw its own placeholder.
   ============================================================= */
import { useState } from 'react';

export type AvatarRing = {
  /** Overrides the default hairline. */
  border?: string;
  /** For somebody who has declined: the name is struck through. */
  struck?: boolean;
  /** Dimmed, again for a decline. */
  muted?: boolean;
};

export function initialsOf(name: string | null | undefined): string {
  return (name ?? '')
    .split(/\s+/).filter(Boolean).slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '').join('') || '?';
}

export function Avatar({
  name, url, size = 32, title, ring, decorative = false,
}: {
  name: string | null;
  /** `profiles.photo_url`. Null or missing draws the initials. */
  url?: string | null;
  size?: number;
  title?: string;
  ring?: AvatarRing;
  /** True where the name is already written next to it, so a screen
      reader is not told it twice. */
  decorative?: boolean;
}) {
  const [broke, setBroke] = useState(false);
  const initials = initialsOf(name);
  const border = ring?.border ?? '1px solid var(--border)';

  const shell: React.CSSProperties = {
    width: size, height: size, flex: 'none', borderRadius: 'var(--r-full)',
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    overflow: 'hidden', border,
  };

  if (url && !broke) {
    return (
      <span
        style={{ ...shell, background: 'var(--bg-subtle)' }}
        title={title ?? name ?? undefined}
        aria-hidden={decorative ? 'true' : undefined}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt={decorative ? '' : (name ?? '')}
          onError={() => setBroke(true)}
          style={{
            width: '100%', height: '100%', objectFit: 'cover', display: 'block',
            opacity: ring?.muted ? 0.55 : 1,
          }}
        />
      </span>
    );
  }

  return (
    <span
      style={{
        ...shell,
        background: 'var(--bg-subtle)',
        fontFamily: 'var(--panton)', fontWeight: 700,
        /* Panton is never set below 11px, which is rule four. A 22px
           circle would put it at 9.3, so the floor is held here rather
           than left to whichever caller picked the smallest size. */
        fontSize: Math.max(11, Math.round(size * 0.38)),
        letterSpacing: '0.02em',
        color: ring?.muted ? 'var(--text-subtle)' : 'var(--text-muted)',
        textDecoration: ring?.struck ? 'line-through' : 'none',
      }}
      title={title ?? name ?? undefined}
      aria-hidden={decorative ? 'true' : undefined}
    >{initials}</span>
  );
}
