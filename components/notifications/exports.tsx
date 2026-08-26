'use client';

import { useCallback, useEffect, useState } from 'react';
import { Download, FileSpreadsheet, FileText } from 'lucide-react';
import { ago } from '@/lib/notifications/types';
import { Button, EmptyState } from '@/components/kit/primitives';

/* =============================================================
   Every export you still have, with a button against each.

   An export announced once in a feed and then buried under a fortnight
   of meeting invitations is an export nobody can find again, which
   defeats the point of keeping it. So it gets its own tab: a short
   list, newest first, one button per row, and nothing else on it.

   It reads the bucket rather than the notifications, so clearing the
   card that announced an export does not lose the file, and a card that
   outlived its file cannot offer a button that fails. See the route.
   ============================================================= */

type Kept = {
  path: string;
  name: string;
  createdAt: string | null;
  bytes: number | null;
  url: string;
};

export function KeptExports() {
  const [items, setItems] = useState<Kept[]>([]);
  const [loading, setLoading] = useState(true);
  const [provisioned, setProvisioned] = useState(true);
  const [keepDays, setKeepDays] = useState(30);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/notifications/exports', { cache: 'no-store' });
      const json = await res.json();
      setLoading(false);
      if (!json.ok) return;
      setItems(json.items ?? []);
      setProvisioned(json.provisioned !== false);
      setKeepDays(json.keepDays ?? 30);
    } catch {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return <Pad>Looking.</Pad>;
  }

  if (!provisioned) {
    return (
      <div style={{ padding: '16px 13px' }}>
        <EmptyState
          what="Exports are not being kept"
          why="There is no exports bucket on this project yet, so an export downloads and nothing is held onto. Everything else works as it did."
        />
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div style={{ padding: '16px 13px' }}>
        <EmptyState
          what="Nothing kept yet"
          why={`Export a customer from their record and the file is held here for ${keepDays} days, so losing your copy does not mean running it again.`}
        />
      </div>
    );
  }

  return (
    <div>
      {items.map((f) => (
        <div
          key={f.path}
          style={{
            display: 'flex', alignItems: 'center', gap: 11,
            padding: '11px 13px', borderBottom: '1px solid var(--border)',
          }}
        >
          <span style={{
            flex: 'none', width: 26, height: 26, borderRadius: 'var(--r)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'var(--bg-subtle)', color: 'var(--text-muted)',
          }}>
            {f.name.endsWith('.docx') ? <FileText size={14} /> : <FileSpreadsheet size={14} />}
          </span>

          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontSize: 12.5, fontWeight: 600, color: 'var(--text)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>{f.name}</div>
            <div style={{ fontSize: 11.5, color: 'var(--text-subtle)' }}>
              {f.createdAt ? ago(f.createdAt) : 'date unknown'}
              {f.bytes != null && `, ${size(f.bytes)}`}
            </div>
          </div>

          {/* A real link rather than a click handler. The route answers
              with a redirect to a signed URL, and letting the browser
              follow it is what makes the file save instead of opening
              in a tab. */}
          <a href={f.url} download style={{ textDecoration: 'none', flex: 'none' }}>
            <Button size="sm" variant="primary"><Download size={13} /> Download</Button>
          </a>
        </div>
      ))}

      <div style={{ padding: '9px 13px', fontSize: 11.5, color: 'var(--text-subtle)' }}>
        Kept for {keepDays} days. Older ones are cleared out the next time you export something.
      </div>
    </div>
  );
}

function Pad({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ padding: '22px 16px', fontSize: 12.5, color: 'var(--text-subtle)' }}>
      {children}
    </div>
  );
}

function size(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
