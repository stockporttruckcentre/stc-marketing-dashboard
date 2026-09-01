'use client';

/* The same face on both screens.

   The directory and the permission hub are two pages that list the same
   people, and a person recognised by their initials on one and by a
   different colour of circle on the other reads as two different people
   for the half second that matters. */
export function Avatar({
  name, url, size = 32,
}: { name: string | null; url?: string | null; size?: number }) {
  const initials = (name ?? '')
    .split(/\s+/).filter(Boolean).slice(0, 2)
    .map((w) => w[0]!.toUpperCase()).join('') || '?';

  if (url) {
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={url}
        alt=""
        style={{
          width: size, height: size, flex: 'none', borderRadius: 'var(--r-full)',
          objectFit: 'cover', border: '1px solid var(--border)',
        }}
      />
    );
  }

  return (
    <span style={{
      width: size, height: size, flex: 'none', borderRadius: 'var(--r-full)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--bg-subtle)', border: '1px solid var(--border)',
      fontFamily: 'var(--panton)', fontWeight: 700, fontSize: Math.round(size * 0.36),
      color: 'var(--text-muted)', letterSpacing: '0.02em',
    }}>{initials}</span>
  );
}
