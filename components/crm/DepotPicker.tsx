'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { Depot } from '@/lib/types';

/* =============================================================
   Which of our sites the work is for.

   From the business:

     on the proposal builder make it so i can choose the depot(s) the
     work is for. Then when we run a report on open pipeline we can
     filter by depot

   Depots come from the `depots` table, migration 154, rather than from
   a list in this file. There were already two lists of depots in the
   code and neither was right: the command bar's had nine with their
   misspellings, the company finder's had six and left out Carrington,
   where 874 of the 1,800 units on the stock list sit. A third one here
   would be a third thing to be wrong.

   ---- Why a chip row and not a multi select ----

   Three to nine options, all short, and the answer is usually one or
   two of them. A `<select multiple>` needs a modifier key to pick a
   second, which most people do not know and none discover, and it
   shows three rows of a nine row list. Chips show every option at once
   and cost one press each.
   ============================================================= */

/** Every depot that is still open, in the register's own order. */
export function useDepots(): { depots: Depot[]; loading: boolean; error: string | null } {
  const supabase = useMemo(() => createClient(), []);
  const [depots, setDepots] = useState<Depot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error: err } = await supabase
      .from('depots')
      .select('id, name, slug, is_active, sort_order')
      .eq('is_active', true)
      .order('sort_order')
      .order('name');
    if (err) setError(err.message);
    setDepots((data ?? []) as Depot[]);
    setLoading(false);
  }, [supabase]);

  useEffect(() => { void load(); }, [load]);
  return { depots, loading, error };
}

export function DepotChips({
  depots, picked, disabled, disabledWhy, onToggle,
}: {
  depots: Depot[];
  picked: string[];
  disabled?: boolean;
  /** What would have to change for these to work. */
  disabledWhy?: string;
  onToggle: (id: string) => void;
}) {
  const on = new Set(picked);
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {depots.map((d) => {
        const lit = on.has(d.id);
        return (
          <button
            key={d.id}
            type="button"
            disabled={disabled}
            title={disabled ? disabledWhy : lit ? `Not for ${d.name} after all` : `The work is for ${d.name}`}
            aria-pressed={lit}
            onClick={() => onToggle(d.id)}
            style={{
              height: 28, padding: '0 11px', borderRadius: 999,
              border: `1px solid ${lit ? 'var(--primary)' : 'var(--border-strong)'}`,
              background: lit ? 'var(--primary)' : 'var(--surface)',
              color: lit ? 'var(--on-primary)' : 'var(--text-muted)',
              fontFamily: 'var(--inter)', fontSize: 12.5,
              fontWeight: lit ? 600 : 500, letterSpacing: '-0.01em',
              cursor: disabled ? 'not-allowed' : 'pointer',
              opacity: disabled ? 0.5 : 1,
              transition: 'background 120ms cubic-bezier(0.2,0,0,1), border-color 120ms cubic-bezier(0.2,0,0,1)',
            }}
          >
            {d.name}
          </button>
        );
      })}
    </div>
  );
}

/**
 * The picker, bound to a deal, writing through `lead_depots_set`.
 *
 * Writes as you press rather than on a Save button, which is what every
 * other field on this drawer does. The call is one statement and it
 * either takes all of them or none, so there is no half saved state for
 * a Save button to protect anybody from.
 */
export function LeadDepots({
  leadId, value, readOnly = false, onChange,
}: {
  leadId: string;
  value: string[];
  readOnly?: boolean;
  onChange: (ids: string[]) => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const { depots, loading, error: loadError } = useDepots();
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function toggle(id: string) {
    const next = value.includes(id) ? value.filter((v) => v !== id) : [...value, id];
    /* Shown straight away and put back if the write is refused, rather
       than a spinner on a chip. A depot is one press and the round trip
       is longer than the decision. */
    onChange(next);
    setSaving(true);
    const { data, error: err } = await supabase.rpc('lead_depots_set', {
      p_lead: leadId, p_depots: next,
    });
    setSaving(false);
    if (err) { setError(err.message); onChange(value); return; }
    setError(null);
    onChange(((data ?? []) as { depot_id: string }[]).map((r) => r.depot_id));
  }

  const why = readOnly
    ? 'Somebody else’s lead. Open it from the customer’s CRM record to work on it.'
    : loading ? 'Still reading the depot list.' : undefined;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <DepotChips
        depots={depots}
        picked={value}
        disabled={readOnly || loading}
        disabledWhy={why}
        onToggle={(id) => void toggle(id)}
      />
      <span style={{ fontFamily: 'var(--inter)', fontSize: 11.5, color: 'var(--text-subtle)', lineHeight: 1.45 }}>
        {error ?? loadError ?? (
          value.length === 0
            ? 'Nobody has said, so this deal is in no depot’s pipeline.'
            : saving ? 'Saving.' : `For ${value.length} of ${depots.length} sites.`
        )}
      </span>
    </div>
  );
}
