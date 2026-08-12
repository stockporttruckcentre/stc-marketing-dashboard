'use client';

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
      display: 'flex', alignItems: 'center', gap: 10,
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
      <span style={{ fontSize: 11.5, color: 'var(--text-subtle)', marginLeft: 'auto' }}>
        Admin only. Everyone else lands on their assigned view.
      </span>
    </div>
  );
}
