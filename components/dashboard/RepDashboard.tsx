'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Plus, FileText, CalendarPlus, ArrowRight, Clock, Bell, CalendarDays, ChevronDown,
} from 'lucide-react';
import {
  Card, Kpi, Figure, Badge, Button, EmptyState, NotProvisioned, Label, SectionHead, Row,
  money, compactMoney,
} from '@/components/kit/primitives';
import { CommandBar } from './CommandBar';
import type { Profile } from '@/lib/types';

/* =============================================================
   Sales rep dashboard.

   Laid out by what a rep needs first, not as a uniform grid. Three
   zones with genuinely different weights:

     the toolbar        one input that does everything
     today              a single strip of figures, not four cards
     work / reference   a wide primary column and a quieter rail

   The old version made every card the same size, which left ragged
   gaps and gave a page where nothing looked more important than
   anything else. Density is a feature, but sameness is not.
   ============================================================= */

type Missing = { available: false; needs: string };

export function RepDashboard({ profile }: { profile: Profile }) {
  const router = useRouter();
  const [data, setData] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [staleDays, setStaleDays] = useState(7);
  const [showAllStale, setShowAllStale] = useState(false);
  const [seed, setSeed] = useState<{ text: string; nonce: number } | undefined>();

  useEffect(() => {
    let cancelled = false;
    setData(null);
    fetch(`/api/dashboard/rep?staleDays=${staleDays}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => { if (!cancelled) { if (j.error) setError(j.error); else setData(j); } })
      .catch((e) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [staleDays]);

  const fire = (text: string) => setSeed({ text, nonce: Date.now() });
  const firstName = (profile.full_name || '').split(' ')[0] || 'there';
  const greet = () => {
    const h = new Date().getHours();
    return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  };

  const stale = data?.stale?.items ?? [];
  const shown = showAllStale ? stale : stale.slice(0, 5);

  return (
    <div className="kit" style={{ display: 'flex', flexDirection: 'column', gap: 20, paddingBottom: 48 }}>

      {/* ---- head ---- */}
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <Label>Workspace</Label>
          <h1 style={{
            margin: '6px 0 0', fontFamily: 'var(--panton)', fontWeight: 800, fontSize: 30,
            lineHeight: 1.15, letterSpacing: '-0.03em', color: 'var(--text)',
          }}>{greet()}, {firstName}</h1>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Button variant="accent" onClick={() => fire('add prospect ')}>
            <Plus size={14} /> Add prospect
          </Button>
          <Button variant="secondary" onClick={() => fire('generate a proposal for ')}>
            <FileText size={14} /> Generate proposal
          </Button>
          <Button variant="secondary" onClick={() => fire('schedule a call for ')}>
            <CalendarPlus size={14} /> Schedule a call
          </Button>
        </div>
      </div>

      {/* ---- the toolbar. The spine of the page: every quick action feeds it ---- */}
      <CommandBar seed={seed} />

      {error && (
        <Card style={{ borderLeft: '2px solid var(--danger)' }}>
          <Label style={{ color: 'var(--danger)' }}>Could not load</Label>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 6 }}>{error}</div>
        </Card>
      )}

      {!data && !error && <Loading />}

      {data && !data.hasTracker && (
        <EmptyState
          what="You do not have a sales tracker yet."
          why="This page is built from your own pipeline. Opening the sales tracker once creates it, and everything here fills in straight away."
          action={<Button variant="primary" onClick={() => router.push('/dashboard/leads')}>Open sales tracker <ArrowRight size={13} /></Button>}
        />
      )}

      {data?.hasTracker && (
        <>
          {/* ---- today, as one strip rather than four competing cards ---- */}
          <Card padded={false}>
            <div style={{ display: 'flex', flexWrap: 'wrap' }}>
              {[
                { label: 'Open proposals', value: String(data.counts.open), sub: `${data.inFlight.prospective.count} new, ${data.inFlight.existing.count} existing` },
                { label: 'Pipeline', value: compactMoney(data.inFlight.prospective.value + data.inFlight.existing.value), sub: 'Estimated value' },
                { label: 'Needs chasing', value: String(stale.length), sub: `Quiet ${data.staleDays} days or more`, tone: stale.length ? ('warning' as const) : undefined },
                { label: 'Booked this month', value: compactMoney(data.revenueMtd), sub: data.target.available ? `of ${compactMoney(data.target.target)}` : 'No target set' },
              ].map((f, i) => (
                <div key={f.label} style={{
                  flex: '1 1 180px', minWidth: 0, padding: '14px 18px',
                  borderLeft: i === 0 ? 'none' : '1px solid var(--border)',
                }}>
                  <Figure {...f} />
                </div>
              ))}
            </div>
          </Card>

          {/* ---- work on the left, reference on the right ---- */}
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.7fr) minmax(280px, 1fr)', gap: 16, alignItems: 'start' }}
               className="dash-split">

            {/* primary column */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>

              <Card>
                <SectionHead title="Needs you today" hint={data.actions.derived ? 'From your diary and stalled work' : undefined} />
                {data.actions.items.length === 0 ? (
                  <EmptyState
                    what="Nothing is waiting on you."
                    why="Today's meetings and anything that has gone quiet land here. Setting a next action when you add a prospect will put it here too."
                  />
                ) : (
                  <div>
                    {data.actions.items.map((a: any) => (
                      <Row key={`${a.kind}-${a.id}`} onClick={() => a.contactId && router.push(`/dashboard/leads?contact=${a.contactId}`)}>
                        {a.kind === 'meeting'
                          ? <CalendarDays size={15} style={{ color: 'var(--info)', flexShrink: 0 }} />
                          : <Clock size={15} style={{ color: 'var(--warning)', flexShrink: 0 }} />}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--text)' }}>{a.title}</div>
                          {a.subtitle && <div style={{ fontSize: 12, color: 'var(--text-subtle)' }}>{a.subtitle}</div>}
                        </div>
                        {a.due && (
                          <span style={{ fontSize: 12.5, color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                            {new Date(a.due).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        )}
                      </Row>
                    ))}
                  </div>
                )}
              </Card>

              {/* Widgets 2 and 4 are one query. Showing them as two cards
                  duplicated the same rows and made the page look busier
                  than it is. One table, biggest first, expandable. */}
              <Card>
                <SectionHead
                  title="Gone quiet"
                  hint={stale.length ? 'Biggest value first' : undefined}
                  action={
                    <div style={{ display: 'flex', gap: 3 }}>
                      {[7, 10, 14].map((d) => (
                        <Button key={d} size="sm" variant={d === staleDays ? 'primary' : 'ghost'} onClick={() => setStaleDays(d)}>{d}d</Button>
                      ))}
                    </div>
                  }
                />
                {stale.length === 0 ? (
                  <EmptyState
                    what={`Nothing has been sitting for ${data.staleDays} days.`}
                    why="Every open proposal has had activity recently. Anything that stalls appears here, largest value at the top."
                  />
                ) : (
                  <div>
                    <Row style={{ minHeight: 26, padding: '0 0 7px', borderBottom: '1px solid var(--border-strong)' }}>
                      <span style={{ width: 18 }} />
                      <span style={{ flex: 1 }}><Label>Customer</Label></span>
                      <span style={{ width: 96, textAlign: 'right' }}><Label>Value</Label></span>
                      <span style={{ width: 54, textAlign: 'right' }}><Label>Quiet</Label></span>
                    </Row>
                    {shown.map((d: any, i: number) => (
                      <Row key={d.id} onClick={() => router.push(`/dashboard/leads?contact=${d.id}`)}>
                        <span style={{
                          width: 18, fontFamily: 'var(--panton)', fontWeight: 800, fontSize: 12,
                          color: i < 5 ? 'var(--text-muted)' : 'var(--text-subtle)', fontVariantNumeric: 'tabular-nums',
                        }}>{i + 1}</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {d.company_name}
                          </div>
                          <div style={{ fontSize: 12, color: 'var(--text-subtle)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {d.contact_name || 'No named contact'}
                          </div>
                        </div>
                        <span style={{ width: 96, textAlign: 'right', fontSize: 13, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: 'var(--text)' }}>
                          {d.value == null ? '—' : money(d.value)}
                        </span>
                        <span style={{ width: 54, textAlign: 'right' }}>
                          <Badge tone={d.daysSince >= 14 ? 'danger' : 'warning'}>{d.daysSince}d</Badge>
                        </span>
                      </Row>
                    ))}
                    {stale.length > 5 && (
                      <button onClick={() => setShowAllStale((v) => !v)}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 6, marginTop: 10,
                          border: 'none', background: 'transparent', cursor: 'pointer',
                          color: 'var(--text-muted)', fontSize: 12.5, fontWeight: 600, fontFamily: 'var(--inter)',
                        }}>
                        <ChevronDown size={13} style={{ transform: showAllStale ? 'rotate(180deg)' : 'none', transition: 'transform 120ms cubic-bezier(0.2,0,0,1)' }} />
                        {showAllStale ? 'Show top five only' : `Show all ${stale.length}`}
                      </button>
                    )}
                    {!data.usingRealActivity && (
                      <div style={{ fontSize: 11.5, color: 'var(--text-subtle)', marginTop: 12, lineHeight: 1.5 }}>
                        Measured from the last edit rather than real activity, so a typo fix counts as progress.
                        Running the dashboard migration fixes that.
                      </div>
                    )}
                  </div>
                )}
              </Card>
            </div>

            {/* quieter reference rail */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>

              <Card>
                <SectionHead title="Against target" />
                {!data.target.available
                  ? <NotProvisioned what="Your month measured against your number." needs={(data.target as Missing).needs} />
                  : <TargetGauge actual={data.revenueMtd} target={data.target.target} />}
              </Card>

              <Card>
                <SectionHead title="In flight" />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {([
                    ['Prospective', data.inFlight.prospective],
                    ['Existing', data.inFlight.existing],
                  ] as const).map(([title, side]) => {
                    const total = data.inFlight.prospective.value + data.inFlight.existing.value;
                    const pct = total > 0 ? Math.round((side.value / total) * 100) : 0;
                    return (
                      <div key={title}>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 5 }}>
                          <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', flex: 1 }}>{title}</span>
                          <span style={{ fontSize: 13, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: 'var(--text)' }}>
                            {side.count}
                          </span>
                          <span style={{ fontSize: 12, color: 'var(--text-subtle)', fontVariantNumeric: 'tabular-nums', width: 52, textAlign: 'right' }}>
                            {compactMoney(side.value)}
                          </span>
                        </div>
                        <div style={{ height: 5, borderRadius: 'var(--r-full)', background: 'var(--bg-subtle)', overflow: 'hidden' }}>
                          <div style={{
                            height: '100%', width: `${pct}%`,
                            background: title === 'Prospective' ? 'var(--info)' : 'var(--success)',
                            borderRadius: 'var(--r-full)',
                          }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div style={{ marginTop: 12 }}>
                  <Link href="/dashboard/leads" style={{ fontSize: 12.5, fontWeight: 600 }}>
                    Open the tracker <ArrowRight size={11} style={{ verticalAlign: 'middle' }} />
                  </Link>
                </div>
              </Card>

              <Card>
                <SectionHead title="My portfolio" />
                {!data.portfolio.available ? (
                  <NotProvisioned
                    what="The accounts allocated to you, with their open work and revenue."
                    needs={(data.portfolio as Missing).needs}
                  />
                ) : (
                  <>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                      {[
                        ['Accounts', String(data.portfolio.accounts)],
                        ['Open proposals', String(data.portfolio.openProposals)],
                        ['Revenue', money(data.portfolio.revenue)],
                      ].map(([k, v]) => (
                        <div key={k} style={{
                          display: 'flex', alignItems: 'baseline', gap: 10,
                          paddingBottom: 8, borderBottom: '1px solid var(--border)',
                        }}>
                          <span style={{ fontSize: 13, color: 'var(--text-muted)', flex: 1 }}>{k}</span>
                          <span style={{
                            fontFamily: 'var(--panton)', fontWeight: 800, fontSize: 17,
                            letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums',
                            color: 'var(--text)', whiteSpace: 'nowrap',
                          }}>{v}</span>
                        </div>
                      ))}
                    </div>
                    {data.portfolio.provisional && (
                      <div style={{ fontSize: 11.5, color: 'var(--text-subtle)', marginTop: 10, lineHeight: 1.5 }}>
                        Matched on the free-text assigned-to field, so approximate until account ownership is a real table.
                      </div>
                    )}
                  </>
                )}
              </Card>

              <Card>
                <SectionHead title="Next seven days" />
                {(data.meetings.items ?? []).length === 0 ? (
                  <EmptyState
                    what="Nothing in the diary."
                    why="Meetings booked in the CRM show here. Outlook joins them when the calendar sync is connected."
                    action={<Button size="sm" variant="secondary" onClick={() => fire('schedule a call for ')}>Book one</Button>}
                  />
                ) : (
                  <div>
                    {data.meetings.items.slice(0, 5).map((m: any) => (
                      <Row key={m.id} onClick={() => router.push('/dashboard/calendar')}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {m.title}
                          </div>
                          <div style={{ fontSize: 11.5, color: 'var(--text-subtle)', fontVariantNumeric: 'tabular-nums' }}>
                            {new Date(m.start_at).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                          </div>
                        </div>
                      </Row>
                    ))}
                  </div>
                )}
              </Card>

              <Card>
                <SectionHead title="Notifications" />
                {!data.notifications.available ? (
                  <NotProvisioned
                    what="Leads assigned to you, messages and system alerts."
                    needs={(data.notifications as Missing).needs}
                  />
                ) : data.notifications.items.length === 0 ? (
                  <EmptyState what="Nothing unread." why="Anything assigned to you turns up here, and stays dismissed once you clear it." />
                ) : (
                  <div>
                    {data.notifications.items.map((n: any) => (
                      <Row key={n.id} onClick={() => n.link_path && router.push(n.link_path)}>
                        <Bell size={14} style={{ color: 'var(--accent)', flexShrink: 0 }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>{n.title}</div>
                          {n.body && <div style={{ fontSize: 11.5, color: 'var(--text-subtle)' }}>{n.body}</div>}
                        </div>
                      </Row>
                    ))}
                  </div>
                )}
              </Card>
            </div>
          </div>
        </>
      )}

      <style>{`
        @media (max-width: 1080px) {
          .dash-split { grid-template-columns: minmax(0, 1fr) !important; }
        }
      `}</style>
    </div>
  );
}

/** Progress against target. An arc reads better than a radar at this size. */
function TargetGauge({ actual, target }: { actual: number; target: number }) {
  const pct = target > 0 ? Math.min(1.5, actual / target) : 0;
  const deg = Math.min(180, pct * 180);
  const hit = actual >= target;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
      <div style={{ position: 'relative', width: 108, height: 56, flexShrink: 0 }}>
        <div style={{
          position: 'absolute', inset: 0, borderRadius: '108px 108px 0 0',
          background: `conic-gradient(from 270deg at 50% 100%, ${hit ? 'var(--success)' : 'var(--accent)'} ${deg}deg, var(--bg-subtle) ${deg}deg 180deg, transparent 180deg)`,
        }} />
        <div style={{
          position: 'absolute', left: 13, right: 13, bottom: 0, top: 13,
          borderRadius: '90px 90px 0 0', background: 'var(--surface)',
        }} />
        <div style={{
          position: 'absolute', bottom: 1, left: 0, right: 0, textAlign: 'center',
          fontFamily: 'var(--panton)', fontWeight: 800, fontSize: 16,
          letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums', color: 'var(--text)',
        }}>{Math.round(pct * 100)}%</div>
      </div>
      <div style={{ minWidth: 0 }}>
        <Label>Booked</Label>
        <div style={{
          fontFamily: 'var(--panton)', fontWeight: 800, fontSize: 19, marginTop: 3,
          fontVariantNumeric: 'tabular-nums', color: 'var(--text)', whiteSpace: 'nowrap',
        }}>{money(actual)}</div>
        <div style={{ fontSize: 12, color: 'var(--text-subtle)', fontVariantNumeric: 'tabular-nums' }}>
          of {money(target)}
        </div>
      </div>
    </div>
  );
}

function Loading() {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.7fr) minmax(280px, 1fr)', gap: 16 }}>
      {[0, 1].map((c) => (
        <div key={c} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {[0, 1].map((i) => (
            <Card key={i}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ height: 13, width: '36%', background: 'var(--bg-subtle)', borderRadius: 'var(--r)' }} />
                <div style={{ height: 10, width: '100%', background: 'var(--bg-subtle)', borderRadius: 'var(--r)' }} />
                <div style={{ height: 10, width: '78%', background: 'var(--bg-subtle)', borderRadius: 'var(--r)' }} />
              </div>
            </Card>
          ))}
        </div>
      ))}
    </div>
  );
}
