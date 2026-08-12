'use client';

import { useEffect, useState } from 'react';
import {
  Card, Kpi, Label, SectionHead, EmptyState, NotProvisioned, Row,
  compactMoney, money,
} from '@/components/kit/primitives';
import type { Profile } from '@/lib/types';

/**
 * The exec dashboard is a separate render, not the rep view with widgets
 * hidden. Different questions, different queries, and a different data
 * path: everything here comes from a server route that aggregates across
 * every rep's private tracker, which no browser query can see.
 *
 * Read only throughout. No next actions, no per-deal alerts, no meeting
 * list. The score, not the game.
 */
export function ExecDashboard({ profile }: { profile: Profile }) {
  const [data, setData] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/dashboard/exec', { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => { if (!cancelled) { if (j.error) setError(j.error); else setData(j); } })
      .catch((e) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, []);

  const firstName = (profile.full_name || '').split(' ')[0] || 'there';

  return (
    <div className="kit" style={{ display: 'flex', flexDirection: 'column', gap: 24, paddingBottom: 40 }}>
      <div>
        <Label>Company</Label>
        <h1 style={{
          margin: '6px 0 0', fontFamily: 'var(--panton)', fontWeight: 800, fontSize: 30,
          lineHeight: 1.15, letterSpacing: '-0.03em', color: 'var(--text)',
        }}>Where we are, {firstName}</h1>
        <div style={{ fontSize: 13, color: 'var(--text-subtle)', marginTop: 4 }}>
          {new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
        </div>
      </div>

      {error && (
        <Card style={{ borderLeft: '2px solid var(--danger)' }}>
          <Label style={{ color: 'var(--danger)' }}>Could not load</Label>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 6 }}>{error}</div>
        </Card>
      )}

      {data && !data.available && (
        <NotProvisioned
          what="Company-wide revenue, pipeline by rep and year-on-year movement."
          needs={data.needs}
        />
      )}

      {data?.available && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
            <Kpi
              label="Revenue year to date"
              value={compactMoney(data.totals.revenueYtd)}
              emphasis
              sub={data.target.available && data.target.ytd
                ? `${Math.round((data.totals.revenueYtd / data.target.ytd) * 100)}% of target`
                : 'No target loaded'}
            />
            <Kpi label="Revenue this month" value={compactMoney(data.totals.revenueMtd)}
                 sub={data.target.available && data.target.mtd ? `Target ${compactMoney(data.target.mtd)}` : 'No target loaded'} />
            <Kpi label="Open pipeline" value={compactMoney(data.totals.openValue)}
                 sub={`${data.totals.openDeals} live proposals`} />
            <Kpi label="Reps trading" value={String(data.perRep.filter((r: any) => r.revenueYtd > 0).length)}
                 sub={`of ${data.perRep.length} with a tracker`} />
          </div>

          <Card>
            <SectionHead title="Pipeline by rep" hint="Open proposals and revenue booked this year" />
            {data.perRep.length === 0 ? (
              <EmptyState
                what="No rep pipelines to summarise yet."
                why="Each rep's figures appear here once they have a sales tracker with deals on it."
              />
            ) : (
              <div>
                <Row style={{ borderBottom: '1px solid var(--border-strong)', minHeight: 28, padding: '0 0 7px' }}>
                  <span style={{ flex: 1 }}><Label>Rep</Label></span>
                  <span style={{ width: 70, textAlign: 'right' }}><Label>Open</Label></span>
                  <span style={{ width: 90, textAlign: 'right' }}><Label>Pipeline</Label></span>
                  <span style={{ width: 90, textAlign: 'right' }}><Label>Won YTD</Label></span>
                </Row>
                {data.perRep.map((r: any) => (
                  <Row key={r.rep}>
                    <span style={{ flex: 1, fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>{r.rep}</span>
                    <span style={{ width: 70, textAlign: 'right', fontSize: 13, fontVariantNumeric: 'tabular-nums', color: 'var(--text-muted)' }}>
                      {r.openDeals}
                    </span>
                    <span style={{ width: 90, textAlign: 'right', fontSize: 13, fontVariantNumeric: 'tabular-nums', color: 'var(--text-muted)' }}>
                      {compactMoney(r.openValue)}
                    </span>
                    <span style={{ width: 90, textAlign: 'right', fontSize: 13, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: 'var(--text)' }}>
                      {compactMoney(r.revenueYtd)}
                    </span>
                  </Row>
                ))}
              </div>
            )}
            <div style={{ fontSize: 11.5, color: 'var(--text-subtle)', marginTop: 12, lineHeight: 1.5 }}>
              Commission is deliberately not shown. It stays between a rep and their own tracker.
            </div>
          </Card>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16, alignItems: 'start' }}>
            <Card>
              <SectionHead title="Year-on-year movement" />
              <NotProvisioned
                what="Accounts spiking or dropping against the same period last year, biggest change first."
                needs={data.yoyAlerts.needs}
              />
            </Card>
            <Card>
              <SectionHead title="Invoice volume" />
              <NotProvisioned
                what="Separate invoice jobs per account against last year, highlighting accounts trending down."
                needs={data.invoiceVolume.needs}
              />
            </Card>
            <Card>
              <SectionHead title="Friday digest" />
              <NotProvisioned
                what="A preview of the weekly summary that goes out by email."
                needs={data.weeklyDigest.needs}
              />
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
