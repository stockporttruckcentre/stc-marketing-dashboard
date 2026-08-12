'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Plus, FileText, CalendarPlus, Search, ArrowRight, Clock, AlertTriangle,
  Bell, Target, Briefcase, CalendarDays,
} from 'lucide-react';
import {
  Card, Kpi, Badge, Button, EmptyState, NotProvisioned, Label, SectionHead, Row,
  money, compactMoney,
} from '@/components/kit/primitives';
import type { Profile } from '@/lib/types';

type Missing = { available: false; needs: string };
type Payload = any;

export function RepDashboard({ profile }: { profile: Profile }) {
  const router = useRouter();
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [staleDays, setStaleDays] = useState(7);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    fetch(`/api/dashboard/rep?staleDays=${staleDays}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => { if (!cancelled) { if (j.error) setError(j.error); else setData(j); } })
      .catch((e) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [staleDays]);

  const firstName = (profile.full_name || '').split(' ')[0] || 'there';
  const greet = () => {
    const h = new Date().getHours();
    return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  };

  return (
    <div className="kit" style={{ display: 'flex', flexDirection: 'column', gap: 24, paddingBottom: 40 }}>

      {/* Page head + quick actions. One red button on this screen: Add prospect. */}
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 260 }}>
          <Label>Workspace</Label>
          <h1 style={{
            margin: '6px 0 0', fontFamily: 'var(--panton)', fontWeight: 800, fontSize: 30,
            lineHeight: 1.15, letterSpacing: '-0.03em', color: 'var(--text)',
          }}>{greet()}, {firstName}</h1>
          <div style={{ fontSize: 13, color: 'var(--text-subtle)', marginTop: 4 }}>
            {new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Button variant="accent" onClick={() => router.push('/dashboard/crm')}>
            <Plus size={14} /> Add prospect
          </Button>
          <Button variant="secondary" onClick={() => router.push('/dashboard/sales')}>
            <FileText size={14} /> Generate proposal
          </Button>
          <Button variant="secondary" onClick={() => router.push('/dashboard/calendar')}>
            <CalendarPlus size={14} /> Schedule a call
          </Button>
          <Button variant="ghost" disabled title="Natural language search is Tier 3">
            <Search size={14} /> Search
          </Button>
        </div>
      </div>

      {error && (
        <Card style={{ borderLeft: '2px solid var(--danger)' }}>
          <Label style={{ color: 'var(--danger)' }}>Could not load</Label>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 6 }}>{error}</div>
        </Card>
      )}

      {!data && !error && <LoadingGrid />}

      {data && !data.hasTracker && (
        <EmptyState
          what="You do not have a sales tracker yet."
          why="Your dashboard is built from your own pipeline. Opening the sales tracker once creates it, and this page fills in straight away."
          action={<Button variant="primary" onClick={() => router.push('/dashboard/leads')}>Open sales tracker <ArrowRight size={13} /></Button>}
        />
      )}

      {data && data.hasTracker && (
        <>
          {/* KPI strip */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12 }}>
            <Kpi label="Open proposals" value={String(data.counts.open)}
                 sub={`${data.inFlight.prospective.count} new, ${data.inFlight.existing.count} existing`} />
            <Kpi label="Pipeline value"
                 value={compactMoney(data.inFlight.prospective.value + data.inFlight.existing.value)}
                 sub="Estimated, open proposals" />
            <Kpi label="Needs chasing" value={String(data.stale.items.length)}
                 tone={data.stale.items.length > 0 ? 'warning' : undefined}
                 sub={`No progress in ${data.staleDays} days`} emphasis={data.stale.items.length > 0} />
            <Kpi label="Revenue this month" value={compactMoney(data.revenueMtd)}
                 sub={data.target.available ? `Target ${compactMoney(data.target.target)}` : 'No target loaded'} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 16, alignItems: 'start' }}>

            {/* 1. What to do next */}
            <Card>
              <SectionHead title="What to do next" hint={data.actions.derived ? 'Derived' : undefined} />
              {data.actions.items.length === 0 ? (
                <EmptyState
                  what="Nothing needs you right now."
                  why="This fills with today's meetings and any proposal that has gone quiet. Adding a next action when you create a prospect will also land it here."
                />
              ) : (
                <div>
                  {data.actions.items.map((a: any) => (
                    <Row key={`${a.kind}-${a.id}`} onClick={() => a.contactId && router.push(`/dashboard/leads?contact=${a.contactId}`)}>
                      {a.kind === 'meeting' ? <CalendarDays size={15} style={{ color: 'var(--info)', flexShrink: 0 }} />
                                            : <Clock size={15} style={{ color: 'var(--warning)', flexShrink: 0 }} />}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>{a.title}</div>
                        {a.subtitle && <div style={{ fontSize: 12, color: 'var(--text-subtle)' }}>{a.subtitle}</div>}
                      </div>
                      {a.due && (
                        <span style={{ fontSize: 12, color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                          {new Date(a.due).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      )}
                    </Row>
                  ))}
                  {data.actions.derived && (
                    <div style={{ fontSize: 11.5, color: 'var(--text-subtle)', marginTop: 10, lineHeight: 1.5 }}>
                      Derived from meetings and stalled proposals. Becomes a real queue you can tick off once
                      the scheduled-actions table is added.
                    </div>
                  )}
                </div>
              )}
            </Card>

            {/* 2. Inactive prospects */}
            <Card>
              <SectionHead
                title="Gone quiet"
                action={
                  <div style={{ display: 'flex', gap: 4 }}>
                    {[7, 10, 14].map((d) => (
                      <Button key={d} size="sm" variant={d === staleDays ? 'primary' : 'ghost'} onClick={() => setStaleDays(d)}>
                        {d}d
                      </Button>
                    ))}
                  </div>
                }
              />
              {data.stale.items.length === 0 ? (
                <EmptyState
                  what={`Nothing has been sitting for ${data.staleDays} days.`}
                  why="Every open proposal has had activity recently. Anything that goes quiet shows here, biggest value first."
                />
              ) : (
                <div>
                  {data.stale.items.slice(0, 6).map((d: any) => (
                    <Row key={d.id} onClick={() => router.push(`/dashboard/leads?contact=${d.id}`)}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {d.company_name}
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--text-subtle)' }}>
                          {d.contact_name || 'No contact name'}
                        </div>
                      </div>
                      <span style={{ fontSize: 13, fontVariantNumeric: 'tabular-nums', color: 'var(--text-muted)' }}>
                        {d.value == null ? '—' : money(d.value)}
                      </span>
                      <Badge tone={d.daysSince >= 14 ? 'danger' : 'warning'} dot>{d.daysSince}d</Badge>
                    </Row>
                  ))}
                  {!data.usingRealActivity && (
                    <div style={{ fontSize: 11.5, color: 'var(--text-subtle)', marginTop: 10, lineHeight: 1.5 }}>
                      Measured from the last edit, not from real activity. Run the dashboard migration to start
                      recording calls and notes properly, or this counts a typo fix as progress.
                    </div>
                  )}
                </div>
              )}
            </Card>

            {/* 3. Proposals in flight, split */}
            <Card>
              <SectionHead title="Proposals in flight" />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                {([
                  ['Prospective', data.inFlight.prospective, 'New names and first quotes'],
                  ['Existing', data.inFlight.existing, 'Repeat business and renewals'],
                ] as const).map(([title, side, hint]) => (
                  <div key={title} style={{
                    border: '1px solid var(--border)', borderRadius: 'var(--r)', padding: 12,
                    display: 'flex', flexDirection: 'column', gap: 4,
                  }}>
                    <Label>{title}</Label>
                    <span style={{
                      fontFamily: 'var(--panton)', fontWeight: 800, fontSize: 24, lineHeight: 1.1,
                      letterSpacing: '-0.03em', fontVariantNumeric: 'tabular-nums', color: 'var(--text)',
                    }}>{side.count}</span>
                    <span style={{ fontSize: 12.5, color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                      {compactMoney(side.value)}
                    </span>
                    <span style={{ fontSize: 11.5, color: 'var(--text-subtle)', lineHeight: 1.4 }}>{hint}</span>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 12 }}>
                <Link href="/dashboard/leads" style={{ fontSize: 12.5, fontWeight: 600 }}>
                  Open the tracker <ArrowRight size={12} style={{ verticalAlign: 'middle' }} />
                </Link>
              </div>
            </Card>

            {/* 4. Top 5 stuck by revenue */}
            <Card>
              <SectionHead title="Biggest stuck deals" hint="By value" />
              {data.topStuck.items.length === 0 ? (
                <EmptyState
                  what="No big deals are stuck."
                  why="The five highest-value proposals with no recent progress appear here, so nothing large slips quietly."
                />
              ) : (
                <div>
                  {data.topStuck.items.map((d: any, i: number) => (
                    <Row key={d.id} onClick={() => router.push(`/dashboard/leads?contact=${d.id}`)}>
                      <span style={{
                        fontFamily: 'var(--panton)', fontWeight: 800, fontSize: 13,
                        color: 'var(--text-subtle)', width: 16, fontVariantNumeric: 'tabular-nums',
                      }}>{i + 1}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {d.company_name}
                        </div>
                      </div>
                      <span style={{ fontSize: 13, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: 'var(--text)' }}>
                        {d.value == null ? '—' : money(d.value)}
                      </span>
                      <Badge tone={d.daysSince >= 14 ? 'danger' : 'warning'}>{d.daysSince}d</Badge>
                    </Row>
                  ))}
                </div>
              )}
            </Card>

            {/* 5. My portfolio */}
            <Card>
              <SectionHead title="My portfolio" />
              {!data.portfolio.available ? (
                <NotProvisioned
                  what="Accounts allocated to you, with their open work and revenue."
                  needs={(data.portfolio as Missing).needs}
                />
              ) : (
                <>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
                    <Kpi label="Accounts" value={String(data.portfolio.accounts)} />
                    <Kpi label="Open" value={String(data.portfolio.openProposals)} />
                    <Kpi label="Revenue" value={compactMoney(data.portfolio.revenue)} />
                  </div>
                  {data.portfolio.provisional && (
                    <div style={{ fontSize: 11.5, color: 'var(--text-subtle)', marginTop: 10, lineHeight: 1.5 }}>
                      Matched on the free-text assigned-to field, so this is approximate. It becomes exact once
                      account ownership is a real table.
                    </div>
                  )}
                </>
              )}
            </Card>

            {/* 6. Meetings */}
            <Card>
              <SectionHead title="Next seven days" hint="CRM calendar" />
              {(data.meetings.items ?? []).length === 0 ? (
                <EmptyState
                  what="Nothing in the diary this week."
                  why="Meetings booked in the CRM appear here. Outlook meetings join them once the calendar sync is connected."
                  action={<Button size="sm" variant="secondary" onClick={() => router.push('/dashboard/calendar')}>Open calendar</Button>}
                />
              ) : (
                <div>
                  {data.meetings.items.slice(0, 6).map((m: any) => (
                    <Row key={m.id}>
                      <CalendarDays size={15} style={{ color: 'var(--text-subtle)', flexShrink: 0 }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {m.title}
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--text-subtle)', fontVariantNumeric: 'tabular-nums' }}>
                          {new Date(m.start_at).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                        </div>
                      </div>
                    </Row>
                  ))}
                </div>
              )}
            </Card>

            {/* 7. Notifications */}
            <Card>
              <SectionHead title="Notifications" />
              {!data.notifications.available ? (
                <NotProvisioned
                  what="New leads assigned to you, colleague messages and system alerts."
                  needs={(data.notifications as Missing).needs}
                />
              ) : data.notifications.items.length === 0 ? (
                <EmptyState
                  what="Nothing unread."
                  why="Leads assigned to you and system alerts land here. Anything you dismiss stays dismissed."
                />
              ) : (
                <div>
                  {data.notifications.items.map((n: any) => (
                    <Row key={n.id} onClick={() => n.link_path && router.push(n.link_path)}>
                      <Bell size={15} style={{ color: 'var(--accent)', flexShrink: 0 }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>{n.title}</div>
                        {n.body && <div style={{ fontSize: 12, color: 'var(--text-subtle)' }}>{n.body}</div>}
                      </div>
                    </Row>
                  ))}
                </div>
              )}
            </Card>

            {/* 8. Revenue vs target */}
            <Card>
              <SectionHead title="Against target" hint="This month" />
              {!data.target.available ? (
                <NotProvisioned
                  what="Your revenue this month measured against your number, and against the same month last year."
                  needs={(data.target as Missing).needs}
                />
              ) : (
                <TargetGauge actual={data.revenueMtd} target={data.target.target} />
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

/** Progress against target. A plain arc reads better at this size than a radar. */
function TargetGauge({ actual, target }: { actual: number; target: number }) {
  const pct = target > 0 ? Math.min(1.5, actual / target) : 0;
  const deg = Math.min(180, pct * 180);
  const hit = actual >= target;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
      <div style={{ position: 'relative', width: 120, height: 62, flexShrink: 0 }}>
        <div style={{
          position: 'absolute', inset: 0, borderRadius: '120px 120px 0 0',
          background: `conic-gradient(from 270deg at 50% 100%, ${hit ? 'var(--success)' : 'var(--accent)'} ${deg}deg, var(--bg-subtle) ${deg}deg 180deg, transparent 180deg)`,
        }} />
        <div style={{
          position: 'absolute', left: 14, right: 14, bottom: 0, top: 14,
          borderRadius: '100px 100px 0 0', background: 'var(--surface)',
        }} />
        <div style={{
          position: 'absolute', bottom: 2, left: 0, right: 0, textAlign: 'center',
          fontFamily: 'var(--panton)', fontWeight: 800, fontSize: 17,
          letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums', color: 'var(--text)',
        }}>{Math.round(pct * 100)}%</div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div>
          <Label>Booked</Label>
          <div style={{ fontFamily: 'var(--panton)', fontWeight: 800, fontSize: 20, fontVariantNumeric: 'tabular-nums', color: 'var(--text)' }}>
            {money(actual)}
          </div>
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
          of {money(target)}
        </div>
      </div>
    </div>
  );
}

function LoadingGrid() {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 16 }}>
      {[0, 1, 2, 3].map((i) => (
        <Card key={i}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ height: 14, width: '38%', background: 'var(--bg-subtle)', borderRadius: 'var(--r)' }} />
            <div style={{ height: 11, width: '100%', background: 'var(--bg-subtle)', borderRadius: 'var(--r)' }} />
            <div style={{ height: 11, width: '82%', background: 'var(--bg-subtle)', borderRadius: 'var(--r)' }} />
            <div style={{ height: 11, width: '64%', background: 'var(--bg-subtle)', borderRadius: 'var(--r)' }} />
          </div>
        </Card>
      ))}
    </div>
  );
}
