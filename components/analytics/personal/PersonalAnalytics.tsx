'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, RotateCcw, TrendingDown, TrendingUp, UserRound, X } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { readable } from '@/lib/protean/rpc';
import type { Viewable } from '@/lib/analytics/scope';
import {
  Alert, Badge, Button, Chip, EmptyState, PageHead, compactMoney,
} from '@/components/kit/primitives';
import { Select, TextInput } from '@/components/kit/forms';
import { Panel, PanelGrid, Sub } from '@/components/analytics/legacy/panel';
import { Tile } from '@/components/analytics/legacy/tiles';

/* =============================================================
   Personal Analytics: one person's portfolio.

   From the agreed development scope, Task 2:

     This is not a salesperson leaderboard. It answers: How is this
     person's customer portfolio performing?

   ---- What feeds the target figure, written down ----

   The scope asks for this to be documented rather than assumed, and
   the business settled it:

     the 600k target thing will come from pipeline on the tracker

   So every figure on this screen comes from `crm_leads`, the tracker,
   through `personal_pipeline` and `personal_overview` in migration 119.
   A person's portfolio is the deals whose `owner_id` is them. That is a
   real column pointing at a real profile, so nothing here matches a
   name against a name.

   TARGET BEARING REVENUE IS WON WORK, EXCLUDING TRAILER SALES, DATED
   INTO THIS FINANCIAL YEAR BY ITS ORDER DATE. Trailer Sales is beside
   it and never added into it, because the scope says so in as many
   words. Open pipeline is beside both and is never called revenue.

   ---- Nothing here is zero because it is unknown ----

     Unknown figures must be null/not known, never zero.

   `money` below prints "Not known" for null and "£0" for nought, and
   the two are different sentences. There is no percentage against a
   missing target: a percentage of nothing is not nought.
   ============================================================= */

type Overview = {
  person_id: string;
  full_name: string | null;
  financial_year: string;
  fy_target: number | null;
  target_revenue: number | null;
  trailer_revenue: number | null;
  open_pipeline: number | null;
  open_deals: number;
  won_deals: number;
  lost_deals: number;
  customers: number;
  unpriced: number;
  won_undated: number;
  achieved: number | null;
  to_go: number | null;
};

type PipelineRow = {
  lead_type: string;
  open_count: number;
  open_total: number | null;
  won_count: number;
  won_total: number | null;
  lost_count: number;
  lost_total: number | null;
  unpriced: number;
  won_undated: number;
};

type Mover = {
  contact_id: string;
  company_name: string | null;
  this_year: number;
  last_year: number;
  change: number;
  change_pct: number | null;
  divisions: string | null;
};

/** The tracker's three deal types, in the words the business uses. */
const TYPE_LABEL: Record<string, string> = {
  maintenance: 'Maintenance and STC',
  rental: 'Rentals',
  trailer_sales: 'Trailer Sales',
};

const ORDER = ['maintenance', 'rental', 'trailer_sales'];

/** Money, and the difference between nought and not known. */
const money = (n: number | null | undefined): string =>
  (n == null ? 'Not known' : compactMoney(Number(n)));

const num = (n: number | null | undefined): number | null =>
  (n == null ? null : Number(n));

/** How many movers each list shows. The company panels show ten. */
const SHOW_MOVERS = 10;

export function PersonalAnalytics({
  person, people, selfId, asked, onAsked, onLeave, onPerson,
}: {
  person: string;
  people: Viewable[];
  selfId: string | null;
  /** The as-at date, shared with the company screen so it survives the switch. */
  asked: string;
  onAsked: (v: string) => void;
  onLeave: () => void;
  onPerson: (id: string) => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const upto = /^\d{4}-\d{2}-\d{2}$/.test(asked) ? asked : undefined;

  const [overview, setOverview] = useState<Overview | null>(null);
  const [pipeline, setPipeline] = useState<PipelineRow[]>([]);
  const [movers, setMovers] = useState<Mover[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState<string | null>(null);

  /* ---- Every panel moves together, or none of them do ----

     From the scope: "Selecting a person refreshes the entire Personal
     scope consistently [...] No panel may remain scoped to the previous
     person."

     So there is ONE load for the whole screen and one piece of state
     holding its answer. A panel cannot be left on the last person
     because no panel owns its own request. */
  const load = useCallback(async () => {
    setLoading(true);
    setFailed(null);
    /* Cleared rather than left showing while the next person loads. Two
       seconds of somebody else's revenue under a new name is worse than
       two seconds of nothing. */
    setOverview(null);
    setPipeline([]);
    setMovers([]);
    try {
      const [o, p, m] = await Promise.all([
        supabase.rpc('personal_overview', { p_person: person, p_when: upto ?? null }),
        supabase.rpc('personal_pipeline', { p_person: person, p_when: upto ?? null }),
        supabase.rpc('personal_movers', {
          p_person: person, p_upto: upto ?? null, p_limit: SHOW_MOVERS * 2,
        }),
      ]);
      if (o.error) throw readable(o.error);
      if (p.error) throw readable(p.error);
      if (m.error) throw readable(m.error);

      setOverview(((o.data ?? []) as Overview[])[0] ?? null);
      setPipeline((p.data ?? []) as PipelineRow[]);
      setMovers((m.data ?? []) as Mover[]);
    } catch (e) {
      setFailed(e instanceof Error ? e.message : 'The figures would not load.');
    } finally {
      setLoading(false);
    }
  }, [supabase, person, upto]);

  useEffect(() => { void load(); }, [load]);

  const who = people.find((p) => p.id === person) ?? null;
  const isSelf = person === selfId;
  const canSwitch = people.length > 1;

  const gainers = movers.filter((m) => Number(m.change) > 0).slice(0, SHOW_MOVERS);
  const fallers = movers
    .filter((m) => Number(m.change) < 0)
    .sort((a, b) => Number(a.change) - Number(b.change))
    .slice(0, SHOW_MOVERS);

  const year = overview?.financial_year
    ? new Date(`${overview.financial_year}T00:00:00`).toLocaleDateString('en-GB', {
      month: 'short', year: 'numeric',
    })
    : null;

  return (
    <div className="kit" style={{ padding: '18px 24px 40px', maxWidth: 1480, margin: '0 auto' }}>
      {/* ---- the control bar ---- */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
        padding: '2px 0 12px',
      }}>
        <PageHead
          eyebrow="Analytics, personal"
          title={who?.full_name ?? overview?.full_name ?? 'This portfolio'}
          sub={year
            ? `The portfolio year from ${year}, against the same point in the year before it.`
            : 'One person’s portfolio, across maintenance, rentals and trailer sales.'}
        />

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 7 }}>
          {/* The selector holds only people the database says this
              person may open. It is drawn from the same function the
              rule is made of, so it cannot offer somebody who would
              then be refused. */}
          {canSwitch && (
            <div style={{ width: 230 }}>
              <Select
                value={person}
                onChange={onPerson}
                title="Whose portfolio to show"
              >
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.full_name}{p.is_self ? ' (you)' : ''} · {p.role_name}
                  </option>
                ))}
              </Select>
            </div>
          )}
          <Chip active onClick={onLeave} title="Back to the company and its divisions">
            <UserRound size={12} /> Personal
          </Chip>
          <Button variant="ghost" size="sm" onClick={onLeave} title="Leave the personal view">
            <X size={12} /> Whole company
          </Button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <div style={{ width: 146 }}>
            <TextInput type="date" value={asked} onChange={onAsked} />
          </div>
          {asked && (
            <Button variant="ghost" size="sm" onClick={() => onAsked('')}>
              <RotateCcw size={12} /> Today
            </Button>
          )}
        </div>
      </div>

      {!isSelf && who && (
        <div style={{ marginBottom: 12 }}>
          <Alert tone="info">
            <span style={{ flex: 1 }}>
              Every figure below is {who.full_name}&#8217;s portfolio, not yours.
            </span>
            {selfId && (
              <Button variant="secondary" size="sm" onClick={() => onPerson(selfId)}>
                Back to mine <ArrowRight size={12} />
              </Button>
            )}
          </Alert>
        </div>
      )}

      {failed && (
        <div style={{ marginBottom: 12 }}>
          <Alert tone="danger">
            <span style={{ flex: 1 }}>{failed}</span>
            <Button variant="ghost" size="sm" onClick={() => void load()}>Try again</Button>
          </Alert>
        </div>
      )}

      {/* ---- the headline ---- */}
      <div style={{
        display: 'grid', gap: 10, marginBottom: 14,
        gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
      }}>
        <Tile
          label="Target, this year"
          value={overview?.fy_target == null ? 'Not set' : money(num(overview.fy_target))}
          note={overview?.fy_target == null
            ? 'Nobody has set one. That is not the same as nought.'
            : year ? `Financial year from ${year}` : undefined}
        />
        <Tile
          label="Towards target"
          value={money(num(overview?.target_revenue))}
          note="Won work on the tracker. Trailer sales are not in this."
        />
        <Tile
          label="Achieved"
          value={overview?.achieved == null ? 'Not known' : `${Number(overview.achieved).toFixed(1)}%`}
          note={overview?.fy_target == null ? 'No target to measure against' : undefined}
        />
        <Tile
          label={Number(overview?.to_go ?? 0) < 0 ? 'Ahead of target' : 'Left to find'}
          value={overview?.to_go == null
            ? 'Not known'
            : money(Math.abs(Number(overview.to_go)))}
          tone={overview?.to_go != null && Number(overview.to_go) > 0 ? 'warning' : 'plain'}
        />
        <Tile
          label="Open pipeline"
          value={money(num(overview?.open_pipeline))}
          note={`${overview?.open_deals ?? 0} open deal(s). Not revenue.`}
        />
        <Tile
          label="Trailer Sales"
          value={money(num(overview?.trailer_revenue))}
          note="Reported here, and kept out of the target figure."
        />
        <Tile
          label="Customers"
          value={String(overview?.customers ?? 0)}
          note="Anybody they hold a deal against, in any state."
        />
      </div>

      {/* ---- what the figures cannot tell you ----

          Said on the screen rather than swallowed. A portfolio with
          eleven unpriced deals in it has a pipeline figure that is
          smaller than the pipeline, and nobody can tell from the
          number. */}
      {overview && (overview.unpriced > 0 || overview.won_undated > 0) && (
        <div style={{ marginBottom: 14 }}>
          <Alert tone="warning">
            <span style={{ flex: 1 }}>
              {overview.unpriced > 0 && (
                <>{overview.unpriced} deal{overview.unpriced === 1 ? '' : 's'} carry no
                figure, so they are counted but add nothing. </>
              )}
              {overview.won_undated > 0 && (
                <>{overview.won_undated} won deal{overview.won_undated === 1 ? '' : 's'} have
                no order date, so they are in no financial year and count towards no target.</>
              )}
            </span>
          </Alert>
        </div>
      )}

      <PanelGrid>
        {/* ---- the three divisions, from one screen ---- */}
        <Panel
          span={12}
          title="Across the three"
          hint="Maintenance, rentals and trailer sales, without switching tabs"
          table={{
            columns: ['Open pipeline', 'Open', 'Won this year', 'Won', 'Lost'],
            rows: ORDER.filter((t) => pipeline.some((p) => p.lead_type === t)).map((t) => {
              const row = pipeline.find((p) => p.lead_type === t)!;
              return {
                name: TYPE_LABEL[t] ?? t,
                cells: [
                  money(num(row.open_total)),
                  String(row.open_count),
                  money(num(row.won_total)),
                  String(row.won_count),
                  String(row.lost_count),
                ],
              };
            }),
          }}
        >
          {pipeline.length === 0 ? (
            <EmptyState
              what={loading ? 'Reading the tracker' : 'No deals on this portfolio'}
              why={loading
                ? 'One moment.'
                : 'Nothing on the tracker is owned by this person yet.'}
            />
          ) : (
            <div style={{ display: 'grid', gap: 10, padding: 12 }}>
              {ORDER.map((t) => {
                const row = pipeline.find((p) => p.lead_type === t);
                if (!row) return null;
                return (
                  <div
                    key={t}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
                      padding: '10px 12px',
                      border: '1px solid var(--border)', borderRadius: 'var(--r)',
                      background: 'var(--surface-sunken)',
                    }}
                  >
                    <strong style={{ minWidth: 168, fontSize: 13 }}>{TYPE_LABEL[t] ?? t}</strong>
                    <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
                      Won this year <strong style={{ color: 'var(--text)' }}>
                        {money(num(row.won_total))}
                      </strong>
                    </span>
                    <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
                      Open pipeline <strong style={{ color: 'var(--text)' }}>
                        {money(num(row.open_total))}
                      </strong>
                    </span>
                    <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                      <Badge tone="neutral">{row.open_count} open</Badge>
                      <Badge tone="neutral">{row.won_count} won</Badge>
                      {row.lost_count > 0 && <Badge tone="neutral">{row.lost_count} lost</Badge>}
                    </span>
                  </div>
                );
              })}
              <Sub>
                Won this year is work with an order date inside the financial year. Open
                pipeline is still winnable and is not revenue.
              </Sub>
            </div>
          )}
        </Panel>

        <MoverPanel
          title="Biggest gainers"
          hint="Customers in this portfolio spending more than the same point last year"
          rows={gainers}
          loading={loading}
          up
        />
        <MoverPanel
          title="Biggest fallers"
          hint="Customers in this portfolio spending less than the same point last year"
          rows={fallers}
          loading={loading}
        />
      </PanelGrid>
    </div>
  );
}

/* One panel, drawn twice, because a gainer and a faller are the same
   row read from opposite ends. */
function MoverPanel({ title, hint, rows, loading, up = false }: {
  title: string; hint: string; rows: Mover[]; loading: boolean; up?: boolean;
}) {
  return (
    <Panel
      span={6}
      title={title}
      hint={hint}
      table={{
        columns: ['This year', 'Last year', 'Change'],
        rows: rows.map((m) => ({
          name: m.company_name ?? 'Unnamed',
          cells: [
            money(Number(m.this_year)),
            money(Number(m.last_year)),
            `${Number(m.change) > 0 ? '+' : ''}${money(Number(m.change))}`,
          ],
        })),
      }}
    >
      {rows.length === 0 ? (
        <EmptyState
          what={loading ? 'Reading the invoices' : `No ${up ? 'gainers' : 'fallers'} to show`}
          why={loading
            ? 'One moment.'
            : 'Nobody in this portfolio has moved, or none of them are bound to Protean yet.'}
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {rows.map((m) => (
            <Link
              key={m.contact_id}
              href={`/dashboard/crm?contact=${m.contact_id}`}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '9px 14px', textDecoration: 'none', color: 'inherit',
                borderBottom: '1px solid var(--border)',
              }}
            >
              {up ? <TrendingUp size={13} color="var(--success)" />
                : <TrendingDown size={13} color="var(--danger)" />}
              <span style={{ flex: 1, fontSize: 13, minWidth: 0, overflow: 'hidden',
                textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {m.company_name ?? 'Unnamed'}
              </span>
              <span style={{ fontSize: 12.5, color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                {money(Number(m.last_year))} &#8594; {money(Number(m.this_year))}
              </span>
              <strong style={{
                fontSize: 13, fontVariantNumeric: 'tabular-nums',
                color: up ? 'var(--success)' : 'var(--danger)', minWidth: 74, textAlign: 'right',
              }}>
                {Number(m.change) > 0 ? '+' : ''}{money(Number(m.change))}
              </strong>
            </Link>
          ))}
        </div>
      )}
    </Panel>
  );
}
