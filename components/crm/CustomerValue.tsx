'use client';

import { Briefcase, ChevronRight } from 'lucide-react';
import {
  pounds, valueLeads, valueOf, whatIsMissing, type ValuableLead,
} from '@/lib/crm/lead-value';

/* =============================================================
   What a customer is worth, and every pitch that makes it up.

   From the business:

     I should be able to click a customer in the tracker or crm and still
     see all leads open for them and the potential value of all those
     leads so it's truly a connected environment

   The same block on both screens, deliberately. A rep opening Dawson
   from the tracker and a manager opening Dawson from the CRM are asking
   the same question, and two panels that answer it in two layouts make
   somebody check whether they also answer it with two numbers.

   ---- Why the headline is one figure and the rest are three ----

   "What is this customer worth" is the question, and the honest answer
   has parts. So the number that gets read out loud is open plus won,
   large, and the three that make it up sit under it at a size that says
   they are the working out.

   Lost is shown and is not in the headline. It belongs on the screen,
   because a customer quoted six times who bought once reads completely
   differently from one quoted twice who bought both, and it does not
   belong in the total, because money that was lost is not value.
   ============================================================= */

export function CustomerValue({
  leads, onOpenLead, currentLeadId, dense,
}: {
  leads: ValuableLead[];
  /** Where a pitch goes when somebody clicks it. Omitted means no link. */
  onOpenLead?: (lead: ValuableLead & { id?: string }) => void;
  /** The pitch already open, so it is marked rather than offered again. */
  currentLeadId?: string;
  /** Tighter, for a drawer that already has a lot on it. */
  dense?: boolean;
}) {
  const v = valueLeads(leads);
  const caveat = whatIsMissing(v);

  if (v.leads === 0) {
    return (
      <div style={{
        padding: dense ? '11px 13px' : '13px 15px',
        border: '1px solid var(--border)', borderRadius: 'var(--r-md)',
        background: 'var(--surface-sunken)',
        fontFamily: 'var(--inter)', fontSize: 12.5, color: 'var(--text-subtle)',
      }}>
        Nothing has been pitched to them yet, so there is nothing to value.
      </div>
    );
  }

  return (
    <div style={{
      border: '1px solid var(--border-strong)', borderRadius: 'var(--r-md)',
      background: 'var(--surface)', overflow: 'hidden',
    }}>
      {/* ---- the figure ---- */}
      <div style={{
        display: 'flex', alignItems: 'flex-end', gap: 20, flexWrap: 'wrap',
        padding: dense ? '12px 14px' : '14px 16px',
        background: 'var(--bg-subtle)', borderBottom: '1px solid var(--border)',
      }}>
        <div>
          <Cap>This customer, all in</Cap>
          <div style={{
            marginTop: 3, fontFamily: 'var(--panton)', fontWeight: 800,
            fontSize: dense ? 22 : 26, letterSpacing: '-0.025em',
            color: 'var(--text)', fontVariantNumeric: 'tabular-nums', lineHeight: 1.05,
          }}>
            {pounds(v.openAndWon)}
          </div>
          <div style={{
            marginTop: 3, fontFamily: 'var(--inter)', fontSize: 11.5,
            color: 'var(--text-subtle)',
          }}>
            open and won across {v.leads} lead{v.leads === 1 ? '' : 's'}
          </div>
        </div>

        <span style={{ flex: 1 }} />

        <Part label="Still open" count={v.open.count} total={v.open.total} strong />
        <Part label="Won" count={v.won.count} total={v.won.total} />
        <Part label="Lost" count={v.lost.count} total={v.lost.total} faded />
      </div>

      {(caveat || v.lost.count > 0) && (
        <p style={{
          margin: 0, padding: '8px 14px', borderBottom: '1px solid var(--border)',
          fontFamily: 'var(--inter)', fontSize: 11.5, lineHeight: 1.5,
          color: 'var(--text-subtle)',
        }}>
          {caveat}
          {caveat && v.lost.count > 0 ? ' ' : ''}
          {v.lost.count > 0
            && 'Lost is shown but is not in the total, because money that was lost is not value.'}
        </p>
      )}

      {/* ---- and every pitch that makes it up ---- */}
      <div>
        {leads.map((l, i) => {
          const lead = l as ValuableLead & { id?: string; what?: string | null; requirement?: string | null };
          const value = valueOf(lead);
          const isOpen = ['lead', 'contacted', 'quoted'].includes(lead.status);
          const isThisOne = lead.id != null && lead.id === currentLeadId;

          return (
            <div
              key={lead.id ?? i}
              onClick={onOpenLead && !isThisOne ? () => onOpenLead(lead) : undefined}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: dense ? '8px 14px' : '9px 14px',
                borderBottom: i === leads.length - 1 ? 0 : '1px solid var(--border)',
                background: isThisOne ? 'var(--bg-subtle)' : 'transparent',
                cursor: onOpenLead && !isThisOne ? 'pointer' : 'default',
                opacity: lead.status === 'lost' ? 0.6 : 1,
              }}
            >
              <span style={{
                width: 3, height: 18, flex: 'none', borderRadius: 2,
                background: isOpen ? 'var(--accent)' : 'var(--border-strong)',
              }} />
              <Briefcase size={13} style={{ flex: 'none', color: 'var(--text-subtle)' }} />

              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{
                  display: 'block', fontFamily: 'var(--inter)', fontSize: 13,
                  color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}>
                  {TYPE_LABEL[String(lead.type)] ?? lead.type ?? 'Lead'}
                  {lead.what ? <span style={{ color: 'var(--text-subtle)' }}> · {lead.what}</span> : null}
                  {isThisOne && (
                    <span style={{
                      marginLeft: 7, fontFamily: 'var(--panton)', fontWeight: 700,
                      fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase',
                      color: 'var(--text-subtle)',
                    }}>the one open</span>
                  )}
                </span>
                <span style={{
                  display: 'block', fontFamily: 'var(--inter)', fontSize: 11.5,
                  color: 'var(--text-subtle)',
                }}>{STATUS_LABEL[lead.status] ?? lead.status}</span>
              </span>

              <span style={{
                fontFamily: 'var(--panton)', fontWeight: 700, fontSize: 13,
                fontVariantNumeric: 'tabular-nums',
                color: value == null ? 'var(--text-subtle)' : 'var(--text-muted)',
                whiteSpace: 'nowrap',
              }}>
                {/* The placeholder, not a zero. A lead nobody has put a
                    figure on has no value, which is a different thing
                    from being worth nothing. */}
                {value == null ? '—' : pounds(value)}
              </span>

              {onOpenLead && !isThisOne && (
                <ChevronRight size={14} style={{ flex: 'none', color: 'var(--text-subtle)' }} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const TYPE_LABEL: Record<string, string> = {
  trailer_sales: 'Trailer sales',
  maintenance: 'Maintenance',
  rental: 'Rental and leasing',
};

const STATUS_LABEL: Record<string, string> = {
  lead: 'A lead, nothing sent yet',
  contacted: 'Being worked',
  quoted: 'Quoted, waiting on them',
  won: 'Won',
  customer: 'Won, and a customer',
  lost: 'Lost',
};

function Cap({ children }: { children: React.ReactNode }) {
  return (
    <span style={{
      fontFamily: 'var(--panton)', fontWeight: 700, fontSize: 10.5,
      letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-subtle)',
    }}>{children}</span>
  );
}

function Part({ label, count, total, strong, faded }: {
  label: string; count: number; total: number; strong?: boolean; faded?: boolean;
}) {
  return (
    <div style={{ textAlign: 'right', opacity: faded ? 0.7 : 1 }}>
      <Cap>{label}</Cap>
      <div style={{
        marginTop: 2, fontFamily: 'var(--panton)', fontWeight: strong ? 800 : 700,
        fontSize: 15, letterSpacing: '-0.015em', color: 'var(--text)',
        fontVariantNumeric: 'tabular-nums',
      }}>{pounds(total)}</div>
      <div style={{ fontFamily: 'var(--inter)', fontSize: 11, color: 'var(--text-subtle)' }}>
        {count} lead{count === 1 ? '' : 's'}
      </div>
    </div>
  );
}
