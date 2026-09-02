'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  TrendingUp, TrendingDown, Minus, Wrench, Users, ChevronRight, Receipt,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { Badge, EmptyState, Label, SectionHead, money } from '@/components/kit/primitives';
import {
  customerSpend, openWorkFor, accountsOf,
  type CustomerSpend, type OpenWork, type AccountLine,
} from '@/lib/protean/rpc';

/* =============================================================
   What this customer spends, on the customer.

   From the business:

     ensure this updates CRM records too with an open jobs section,
     revnue last year vs this year, jobs invoiced total this financial
     year etc. The data is there so it should be interconnected

   On the CRM record. Written as a self contained block that takes a
   contact id and reads its own figures, so the same thing can go on the
   tracker's lead drawer without a second layout answering the same
   question with a second number, the way `CustomerValue` already does.
   It is not mounted there yet.

   ---- Three figures, and what each is for ----

   The company's year runs April to April, set once in tenant_settings,
   and "this year" means that year everywhere. It is labelled with the
   month it began rather than with the word "financial", so nobody has
   to know the setting to read the number.

   Against the same point last year is the comparison somebody acts on,
   so it is the one with the arrow. Cut like for like: this year is only
   complete to today, and against a whole previous year every customer
   in the book reads as a collapse.

   Lifetime is there because a customer of fifteen years and a customer
   of eight months read completely differently at the same annual spend.

   ---- Why open work is here and not only on the revenue screen ----

   "What have we got on for them" is asked while looking at the
   customer, usually just before ringing them. A job sitting open for
   six weeks is the reason for the call.
   ============================================================= */

export function ProteanSpend({ contactId, dense }: { contactId: string; dense?: boolean }) {
  const supabase = createClient();
  const [spend, setSpend] = useState<CustomerSpend | null>(null);
  const [jobs, setJobs] = useState<OpenWork[]>([]);
  const [accounts, setAccounts] = useState<AccountLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState<string | null>(null);
  const [showAccounts, setShowAccounts] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(null);
    try {
      const got = await customerSpend(supabase, contactId);
      setSpend(got);
      if (got && (got.open_jobs > 0 || got.accounts > 1)) {
        const [work, accs] = await Promise.all([
          got.open_jobs > 0 ? openWorkFor(supabase, contactId) : Promise.resolve([]),
          got.accounts > 1 ? accountsOf(supabase, contactId) : Promise.resolve([]),
        ]);
        setJobs(work);
        setAccounts(accs);
      } else {
        setJobs([]);
        setAccounts([]);
      }
    } catch (e) {
      /* Said out loud rather than rendered as zeroes. A spend panel that
         quietly shows nothing when it could not read is indistinguishable
         from a customer who has not spent anything. */
      setFailed(e instanceof Error ? e.message : 'Their spend would not load.');
    } finally {
      setLoading(false);
    }
  }, [supabase, contactId]);

  useEffect(() => { void load(); }, [load]);

  if (loading) {
    return <Quiet>Reading what they have spent.</Quiet>;
  }

  if (failed) {
    return (
      <EmptyState
        what="Their spend could not be read"
        why={failed.includes('does not exist')
          ? 'The Protean tables are not on this database yet. Run the revenue migrations and this fills in.'
          : failed}
      />
    );
  }

  if (!spend || (spend.accounts === 0 && spend.lifetime === 0)) {
    return (
      <EmptyState
        what="Nothing billed through Protean"
        why="No Protean account is bound to this customer yet. If they are billing us, they are waiting under Revenue, Accounts."
      />
    );
  }

  const fyMonth = spend.fy_started
    ? new Date(`${spend.fy_started}T00:00:00`).toLocaleDateString('en-GB', {
      month: 'short', year: 'numeric',
    })
    : null;

  const daysOpen = (d: string | null) => {
    if (!d) return null;
    return Math.round((Date.now() - new Date(`${d}T00:00:00`).getTime()) / 86_400_000);
  };

  return (
    <div>
      {spend.group_name && (
        <div style={{ marginBottom: 12 }}>
          <Badge tone="neutral" dot>
            <Users size={11} style={{ marginRight: 2 }} />
            Part of {spend.group_name}
          </Badge>
        </div>
      )}

      <div style={{
        display: 'grid', gap: dense ? 10 : 12, marginBottom: 14,
        gridTemplateColumns: `repeat(auto-fit, minmax(${dense ? 130 : 150}px, 1fr))`,
      }}>
        <Figure
          label={fyMonth ? `Invoiced since ${fyMonth}` : 'Invoiced this year'}
          value={money(spend.this_year)}
        />
        <Figure label="Same point last year" value={money(spend.last_year)} quiet />
        <Change from={Number(spend.last_year || 0)} to={Number(spend.this_year || 0)} />
        <Figure
          label="All time"
          value={money(spend.lifetime)}
          quiet
          note={`${spend.invoices.toLocaleString('en-GB')} ${spend.invoices === 1 ? 'invoice' : 'invoices'}`}
        />
      </div>

      <div style={{
        fontSize: 12, color: 'var(--text-subtle)', marginBottom: 16,
        display: 'flex', gap: 14, flexWrap: 'wrap',
      }}>
        {spend.first_billed && <span>First billed {spend.first_billed}</span>}
        {spend.last_billed && <span>Last billed {spend.last_billed}</span>}
        {spend.accounts > 1 && (
          <button
            onClick={() => setShowAccounts((v) => !v)}
            style={{
              border: 'none', background: 'transparent', padding: 0, font: 'inherit',
              color: 'var(--accent)', fontWeight: 600, cursor: 'pointer',
            }}
          >
            {showAccounts ? 'Hide' : 'Show'} the {spend.accounts} Protean accounts
          </button>
        )}
      </div>

      {showAccounts && accounts.length > 0 && (
        <div style={{
          border: '1px solid var(--border)', borderRadius: 'var(--r)',
          marginBottom: 16, overflow: 'hidden',
        }}>
          {accounts.map((a) => (
            <div key={a.alpha} style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px',
              borderBottom: '1px solid var(--border)', fontSize: 12.5,
            }}>
              <span style={{ flex: 1, minWidth: 0, color: 'var(--text)' }}>
                {a.protean_name}
                <span style={{ color: 'var(--text-subtle)', marginLeft: 8 }}>{a.alpha}</span>
              </span>
              <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--text-muted)' }}>
                {a.invoices} inv
              </span>
              <span style={{
                fontFamily: 'var(--panton)', fontWeight: 700,
                fontVariantNumeric: 'tabular-nums', color: 'var(--text)',
              }}>{money(a.net)}</span>
            </div>
          ))}
        </div>
      )}

      <SectionHead
        title="On the system now"
        hint={spend.open_jobs > 0
          ? `${spend.open_jobs} open, worth ${money(spend.open_value)}`
          : undefined}
      />

      {spend.open_jobs === 0 ? (
        <EmptyState
          what="Nothing open"
          why="No job for this customer is open on Protean as of the last import."
        />
      ) : (
        <div style={{
          border: '1px solid var(--border)', borderRadius: 'var(--r)', overflow: 'hidden',
        }}>
          {jobs.map((j) => {
            const age = daysOpen(j.logged_on);
            return (
              <div key={j.job_no} style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px',
                borderBottom: '1px solid var(--border)', fontSize: 12.5, flexWrap: 'wrap',
              }}>
                <Wrench size={13} style={{ color: 'var(--text-subtle)', flexShrink: 0 }} />
                <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--text-muted)' }}>
                  {j.job_no}
                </span>
                <span style={{ flex: 1, minWidth: 120, color: 'var(--text)' }}>
                  {j.job_type ?? 'Job'}
                  {j.equip_no && (
                    <span style={{ color: 'var(--text-subtle)', marginLeft: 8 }}>{j.equip_no}</span>
                  )}
                </span>
                {j.depot && (
                  <span style={{ color: 'var(--text-subtle)' }}>{j.depot}</span>
                )}
                {age != null && (
                  <span style={{ color: age > 30 ? 'var(--warning)' : 'var(--text-subtle)' }}>
                    {age} {age === 1 ? 'day' : 'days'}
                  </span>
                )}
                <span style={{
                  fontFamily: 'var(--panton)', fontWeight: 700,
                  fontVariantNumeric: 'tabular-nums', color: 'var(--text)',
                }}>{money(j.job_total)}</span>
              </div>
            );
          })}
        </div>
      )}

      {spend.oldest_open && spend.open_jobs > 0 && (
        <div style={{ fontSize: 11.5, color: 'var(--text-subtle)', marginTop: 8 }}>
          <Receipt size={11} style={{ verticalAlign: -1, marginRight: 5 }} />
          Oldest has been open since {spend.oldest_open}. From the last Protean import.
        </div>
      )}
    </div>
  );
}

function Figure({ label, value, note, quiet }: {
  label: string; value: string; note?: string; quiet?: boolean;
}) {
  return (
    <div>
      <Label>{label}</Label>
      <div style={{
        fontFamily: 'var(--panton)', fontWeight: 800, fontSize: 20, marginTop: 4,
        fontVariantNumeric: 'tabular-nums',
        color: quiet ? 'var(--text-muted)' : 'var(--text)',
      }}>{value}</div>
      {note && (
        <div style={{ fontSize: 11.5, color: 'var(--text-subtle)', marginTop: 2 }}>{note}</div>
      )}
    </div>
  );
}

/** Up, down or level, in colour and in a word. */
function Change({ from, to }: { from: number; to: number }) {
  const diff = to - from;
  const pct = from ? (100 * diff) / from : null;
  const colour = diff > 0 ? 'var(--success)' : diff < 0 ? 'var(--danger)' : 'var(--text-subtle)';
  const Icon = diff > 0 ? TrendingUp : diff < 0 ? TrendingDown : Minus;

  return (
    <div>
      <Label>Up or down</Label>
      <div style={{
        fontFamily: 'var(--panton)', fontWeight: 800, fontSize: 20, marginTop: 4,
        fontVariantNumeric: 'tabular-nums', color: colour,
        display: 'flex', alignItems: 'center', gap: 6,
      }}>
        <Icon size={16} style={{ flexShrink: 0 }} />
        {diff === 0 ? 'level' : money(Math.abs(diff))}
      </div>
      {pct != null && diff !== 0 && (
        <div style={{ fontSize: 11.5, color: 'var(--text-subtle)', marginTop: 2 }}>
          {diff > 0 ? '+' : '-'}{Math.abs(pct).toFixed(0)}% on last year
        </div>
      )}
    </div>
  );
}

function Quiet({ children }: { children: React.ReactNode }) {
  return <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{children}</span>;
}
