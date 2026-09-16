'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Building2, UserRound } from 'lucide-react';
import { compactMoney, Label, NotProvisioned } from '@/components/kit/primitives';
import { analyticsHref } from '@/lib/analytics/scope';

/* =============================================================
   Company target and personal target, on the dashboard.

   From the agreed development scope, Task 4:

     The Dashboard overview target area should contain two clearly
     distinct concepts: Company Target [and] Personal Target.

   Two blocks, not one figure with a caption. They measure different
   things over the same year and somebody glancing at the screen has to
   be able to tell which is which without reading.

     At present no target exists, so it should show: `Company target`
     `Not set`

   It does, and there is no bar beside it, because a bar against nothing
   would draw as empty and read as "the company has achieved none of its
   target".

   ---- The click ----

     Clicking it must open `/dashboard/analytics` directly in: Personal
     -> current signed-in user. The user should not have to: 1. open
     Analytics 2. click Personal 3. select themselves.

   `analyticsHref({ kind: 'personal', person: null })` writes
   `?scope=personal` with nobody named, which the Analytics page reads
   as "whoever is signed in". So the link is the same for everybody and
   the server decides who it means.

   ---- Ineligible roles ----

   The whole personal block is absent for anybody the database says has
   no Personal view. Not greyed: absent. A finance controller has no
   portfolio and a target block for one would be a question they cannot
   answer.
   ============================================================= */

type Personal = {
  fy_target: number | null;
  target_revenue: number | null;
  achieved: number | null;
  to_go: number | null;
  open_pipeline: number | null;
  financial_year: string;
};

type Answer = {
  available: boolean;
  needs?: string;
  canPersonal?: boolean;
  personal?: Personal | null;
  company?: { target: number | null; actual: number | null };
};

const money = (n: number | null | undefined): string =>
  (n == null ? 'Not known' : compactMoney(Number(n)));

export function FinancialYearTargets() {
  const [data, setData] = useState<Answer | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await fetch('/api/dashboard/targets');
        const json = await res.json();
        if (alive) setData(json as Answer);
      } catch {
        if (alive) setData({ available: false, needs: 'the targets could not be read' });
      }
    })();
    return () => { alive = false; };
  }, []);

  if (!data) return null;

  if (!data.available) {
    return (
      <NotProvisioned
        what="The financial year targets."
        needs={data.needs ?? 'the targets migration running against this database'}
      />
    );
  }

  const year = data.personal?.financial_year
    ? new Date(`${data.personal.financial_year}T00:00:00`).toLocaleDateString('en-GB', {
      month: 'short', year: 'numeric',
    })
    : null;

  return (
    <div style={{
      display: 'grid', gap: 10,
      gridTemplateColumns: data.canPersonal ? 'repeat(auto-fit, minmax(260px, 1fr))' : '1fr',
    }}>
      {/* ---- The company ---- */}
      <div style={BLOCK}>
        <div style={HEAD}>
          <Building2 size={13} />
          <Label>Company target</Label>
        </div>
        <div style={FIGURE}>
          {data.company?.target == null ? 'Not set' : money(data.company.target)}
        </div>
        <div style={NOTE}>
          {data.company?.target == null
            ? 'Nobody has set one for this year. That is not the same as nought.'
            : year ? `Financial year from ${year}` : null}
        </div>
        {data.company?.actual != null && (
          <div style={NOTE}>
            {money(data.company.actual)} billed so far this year.
          </div>
        )}
      </div>

      {/* ---- The person, where they have one ---- */}
      {data.canPersonal && (
        <Link
          href={analyticsHref({ kind: 'personal', person: null })}
          style={{ ...BLOCK, textDecoration: 'none', color: 'inherit', cursor: 'pointer' }}
          title="Open your portfolio in Analytics"
        >
          <div style={HEAD}>
            <UserRound size={13} />
            <Label>Personal target</Label>
            <ArrowRight size={12} style={{ marginLeft: 'auto', opacity: 0.6 }} />
          </div>
          <div style={FIGURE}>
            {data.personal?.fy_target == null ? 'Not set' : money(data.personal.fy_target)}
          </div>

          {data.personal?.fy_target == null ? (
            <div style={NOTE}>
              Nobody has set one for this year. Your portfolio is still here to look at.
            </div>
          ) : (
            <>
              <div style={NOTE}>
                {money(data.personal.target_revenue)} won
                {data.personal.achieved != null
                  && `, ${Number(data.personal.achieved).toFixed(1)}% of it`}
              </div>
              <div style={NOTE}>
                {data.personal.to_go == null ? null
                  : Number(data.personal.to_go) > 0
                    ? `${money(Math.abs(Number(data.personal.to_go)))} left to find`
                    : `${money(Math.abs(Number(data.personal.to_go)))} ahead`}
              </div>
              {/* The bar exists only where there is something to measure
                  against. It is capped, because a rep at 140 per cent
                  should see a full bar rather than one that has run off
                  the end of the card. */}
              <div style={{
                height: 6, borderRadius: 3, background: 'var(--bg-subtle)',
                overflow: 'hidden', marginTop: 8,
              }}>
                <div style={{
                  width: `${Math.min(100, Math.max(0, Number(data.personal.achieved ?? 0)))}%`,
                  height: '100%',
                  background: Number(data.personal.achieved ?? 0) >= 100
                    ? 'var(--success)' : 'var(--accent)',
                }} />
              </div>
            </>
          )}

          <div style={{ ...NOTE, marginTop: 8 }}>
            Open pipeline {money(data.personal?.open_pipeline)}, which is not revenue.
          </div>
        </Link>
      )}
    </div>
  );
}

const BLOCK: React.CSSProperties = {
  display: 'block',
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--r-md)',
  padding: '12px 14px 14px',
  minWidth: 0,
};

const HEAD: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 7,
  color: 'var(--text-muted)', marginBottom: 6,
};

const FIGURE: React.CSSProperties = {
  fontFamily: 'var(--panton)', fontWeight: 800, fontSize: 26,
  letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums',
  color: 'var(--text)', lineHeight: 1.1,
};

const NOTE: React.CSSProperties = {
  fontSize: 12, color: 'var(--text-subtle)', marginTop: 4,
  fontVariantNumeric: 'tabular-nums',
};
