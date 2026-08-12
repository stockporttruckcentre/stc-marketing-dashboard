'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Label } from '@/components/kit/primitives';
import type { DashboardVariant } from '@/lib/dashboard/variant';

const VIEWS: { key: DashboardVariant; label: string }[] = [
  { key: 'rep', label: 'Sales rep' },
  { key: 'exec', label: 'Exec' },
  { key: 'support', label: 'Support' },
];

/**
 * Admin-only preview switch.
 *
 * Temporary scaffolding. Today Dave, Dean, Tom and Gareth are all `admin`,
 * so nothing can tell a rep from an exec and the exec view would otherwise
 * be unreachable. Once profiles.dashboard_variant exists and is set from
 * the Team screen, this becomes a convenience rather than the only way in,
 * and it can be dropped.
 *
 * It changes presentation only. Both dashboard API routes authorise on
 * their own, so switching here never widens what data comes back.
 */
export function VariantSwitch({ current }: { current: DashboardVariant }) {
  const router = useRouter();
  return (
    <div className="kit" style={{
      display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
      padding: '8px 12px', marginBottom: 16,
      background: 'var(--surface-sunken)',
      border: '1px solid var(--border)',
      borderLeft: '2px solid var(--border-emphasis)',
      borderRadius: 'var(--r)',
    }}>
      <Label>Previewing</Label>
      <div style={{ display: 'flex', gap: 2 }}>
        {VIEWS.map((v) => {
          const active = v.key === current;
          return (
            <button
              key={v.key}
              onClick={() => router.push(`/dashboard?view=${v.key}`)}
              style={{
                height: 26, padding: '0 11px', borderRadius: 'var(--r)',
                border: '1px solid ' + (active ? 'var(--border-emphasis)' : 'transparent'),
                background: active ? 'var(--surface)' : 'transparent',
                color: active ? 'var(--text)' : 'var(--text-muted)',
                fontSize: 12.5, fontWeight: active ? 600 : 500, cursor: 'pointer',
                transition: 'background 120ms cubic-bezier(0.2,0,0,1)',
              }}
            >{v.label}</button>
          );
        })}
      </div>
      <DemoData />
      <span style={{ fontSize: 11.5, color: 'var(--text-subtle)' }}>
        Admin only
      </span>
    </div>
  );
}


/**
 * Demo data control. Everything it writes is marked DEMO and the wipe
 * removes exactly those rows, so it is safe to run against a database
 * that also holds real records.
 */
function DemoData() {
  const router = useRouter();
  const [busy, setBusy] = useState<null | 'seed' | 'wipe'>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function run(mode: 'seed' | 'wipe') {
    setBusy(mode); setMsg(null);
    try {
      const r = await fetch('/api/admin/seed-demo', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      });
      const j = await r.json();
      setMsg(j.error
        ? j.error
        : mode === 'seed'
          ? `Seeded ${j.created?.deals ?? 0} deals, ${j.created?.stock ?? 0} trailers, ${j.created?.meetings ?? 0} meetings`
          : `Removed ${Object.values(j.wiped ?? {}).reduce((a: any, b: any) => a + b, 0)} demo rows`);
      router.refresh();
    } catch (e: any) { setMsg(e.message); }
    finally { setBusy(null); }
  }

  const btn = {
    height: 26, padding: '0 10px', borderRadius: 'var(--r)',
    border: '1px solid var(--border-strong)', background: 'var(--surface)',
    color: 'var(--text-muted)', fontSize: 12, cursor: 'pointer',
    fontFamily: 'var(--inter)',
  } as const;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto' }}>
      {msg && <span style={{ fontSize: 11.5, color: 'var(--text-subtle)' }}>{msg}</span>}
      <button style={btn} disabled={!!busy} onClick={() => run('seed')}>
        {busy === 'seed' ? 'Seeding' : 'Load demo data'}
      </button>
      <button style={btn} disabled={!!busy} onClick={() => run('wipe')}>
        {busy === 'wipe' ? 'Clearing' : 'Clear'}
      </button>
    </div>
  );
}
