'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  TrendingUp, TrendingDown, Upload, ChevronRight, Minus,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import {
  Alert, Badge, Button, Card, EmptyState, Label, PageHead, SearchInput,
  SectionHead, Tabs, money,
} from '@/components/kit/primitives';
import { useToast } from '@/components/kit/toast';
import { ImportPanel } from '@/components/revenue/import-panel';
import { ModeratePanel } from '@/components/revenue/moderate-panel';
import {
  yearOnYear, groupRevenue, groupBreakdown,
  type YearOnYear, type GroupRevenue, type GroupLine,
} from '@/lib/protean/rpc';
import { whatToShow, REVENUE_TABS, type RevenueTab } from '@/lib/protean/screen';

/* =============================================================
   What Protean has billed.

   The business asked where this should live:

     I'm unsure where's best to show this data, whether it's background
     data that just updates analytics page and each CRM record's spend
     or if we have a dedicated place for showing these jobs open on the
     system.

   Both, and they are not the same question.

   Revenue IS background data. It belongs on the customer record and on
   analytics, because "what has this company spent" is asked while
   looking at the company, not while looking at a revenue screen.

   Open work is not background data. Nobody can currently see what is on
   the ramps for a customer at all, and a job sitting open for six weeks
   is a conversation somebody should be having. That needs somewhere to
   be looked at deliberately.

   So this screen is the deliberate one, and it carries the import as
   well because the import is the thing somebody comes here to do twice
   a week.

   ---- The comparison is like for like ----

   This year is only complete to today. Measured against a whole
   previous year every customer in the book looks like a collapse, and
   on the real export the difference is not academic: to 2 September the
   company is up £474,727, and against the whole of last year the same
   rows read as down £1.88m. A £2.35m swing on identical data.
   ============================================================= */

/* The tab names live with the render gate, so the check that sweeps
   every state and the screen that draws them cannot drift apart. */
type Tab = RevenueTab;

export function RevenuePanel({ mayImport }: { mayImport: boolean }) {
  const supabase = createClient();
  const { say } = useToast();

  const [tab, setTab] = useState<Tab>('customers');
  const [customers, setCustomers] = useState<YearOnYear[]>([]);
  const [groups, setGroups] = useState<GroupRevenue[]>([]);
  const [open, setOpen] = useState<OpenJob[]>([]);
  const [waiting, setWaiting] = useState(0);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [yoy, grp, jobs, queue] = await Promise.all([
        yearOnYear(supabase),
        groupRevenue(supabase),
        supabase
          .from('protean_open_jobs')
          .select('job_no, protean_name, job_type, status, depot, logged_on, job_total, alpha')
          .eq('still_open', true)
          .order('logged_on', { ascending: true })
          .limit(2000),
        supabase.rpc('protean_to_moderate'),
      ]);
      setCustomers(yoy);
      setGroups(grp);
      setOpen((jobs.data ?? []) as OpenJob[]);
      setWaiting(((queue.data ?? []) as unknown[]).length);
    } catch (e) {
      say({ tone: 'danger', title: e instanceof Error ? e.message : 'The revenue would not load.' });
    } finally {
      setLoading(false);
    }
  }, [supabase, say]);

  useEffect(() => { void load(); }, [load]);

  /* The command bar sends people straight to a tab: "the moderation
     queue" lands on Accounts, "import protean" lands on Import. Read
     from the address rather than through `useSearchParams`, which would
     put a Suspense boundary around the whole screen for one string. */
  useEffect(() => {
    const asked = new URLSearchParams(window.location.search).get('tab');
    if (asked && (REVENUE_TABS as string[]).includes(asked)) {
      if (asked !== 'import' || mayImport) setTab(asked as Tab);
    }
  }, [mayImport]);

  const totals = useMemo(() => {
    const thisYear = customers.reduce((s, c) => s + Number(c.this_year || 0), 0);
    const lastYear = customers.reduce((s, c) => s + Number(c.last_year || 0), 0);
    const openValue = open.reduce((s, j) => s + Number(j.job_total || 0), 0);
    return { thisYear, lastYear, change: thisYear - lastYear, openValue };
  }, [customers, open]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return customers;
    return customers.filter((c) => c.company_name.toLowerCase().includes(needle));
  }, [q, customers]);

  const shownJobs = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return open;
    return open.filter((j) =>
      j.protean_name.toLowerCase().includes(needle)
      || (j.job_no ?? '').toLowerCase().includes(needle));
  }, [q, open]);

  const tabs: { key: Tab; label: string; count?: number }[] = [
    { key: 'customers', label: 'Customers', count: customers.length },
    { key: 'groups', label: 'Groups', count: groups.length },
    { key: 'open', label: 'Open work', count: open.length },
    { key: 'accounts', label: 'Accounts', count: waiting || undefined },
    ...(mayImport ? [{ key: 'import' as Tab, label: 'Import' }] : []),
  ];

  /* Every render gate on this screen, decided in one place that a check
     can sweep. It used to be an inline ternary here, and it hid the tab
     bar whenever the database was empty, which is the state every
     installation starts in. The Import tab therefore did not exist, so
     the two buttons that switch to it changed a piece of state nothing
     was reading and did nothing at all. See lib/protean/screen.ts. */
  const showing = whatToShow({
    loading,
    tab,
    customers: customers.length,
    groups: groups.length,
    openJobs: open.length,
    waiting,
    mayImport,
  });

  return (
    <div className="kit" style={{ padding: '22px 24px 40px', maxWidth: 1320, margin: '0 auto' }}>
      <PageHead
        eyebrow="Revenue"
        title="What Protean has billed"
        sub="Everything invoiced since January, and everything still open on the system."
        action={mayImport && tab !== 'import' ? (
          <Button variant="primary" onClick={() => setTab('import')}>
            <Upload size={14} />
            Put this week in
          </Button>
        ) : undefined}
      />

      {showing.stats && (
        <div style={{
          display: 'grid', gap: 12, marginBottom: 18,
          gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
        }}>
          <Stat label="Invoiced this year" value={money(totals.thisYear)} />
          <Stat label="Same point last year" value={money(totals.lastYear)} quiet />
          <Stat
            label="Up or down"
            value={money(Math.abs(totals.change))}
            tone={totals.change >= 0 ? 'up' : 'down'}
            note={totals.lastYear
              ? `${totals.change >= 0 ? '+' : '-'}${Math.abs(100 * totals.change / totals.lastYear).toFixed(1)}%`
              : undefined}
          />
          <Stat label="Open on the system" value={money(totals.openValue)}
            note={`${open.length} ${open.length === 1 ? 'job' : 'jobs'}`} />
        </div>
      )}

      {waiting > 0 && showing.body !== 'accounts' && (
        <div style={{ marginBottom: 16 }}>
          <Alert tone="warning">
            {waiting} Protean {waiting === 1 ? 'account has' : 'accounts have'} no customer yet,
            so their billing is in the company total and on nobody&apos;s record.
            <button
              onClick={() => setTab('accounts')}
              style={{
                marginLeft: 8, border: 'none', background: 'transparent', padding: 0,
                color: 'var(--accent)', font: 'inherit', fontWeight: 600, cursor: 'pointer',
              }}
            >Place them</button>
          </Alert>
        </div>
      )}

      {showing.tabs && <Tabs value={tab} onChange={setTab} tabs={tabs} />}

      <div style={{ marginTop: 16 }}>
        {showing.invitation && (
          <EmptyState
            what="Nothing has been imported yet"
            why="Run the invoiced report and the open jobs report out of Protean, save them as CSV, and drop them into Import."
            action={mayImport ? (
              <Button variant="primary" onClick={() => setTab('import')}>
                <Upload size={14} />
                Import
              </Button>
            ) : undefined}
          />
        )}

        {(showing.body === 'customers' || showing.body === 'open') && (
          <div style={{ display: 'flex', marginBottom: 12 }}>
            <SearchInput
              value={q}
              onChange={setQ}
              placeholder={showing.body === 'customers' ? 'Find a customer' : 'Find a job or a customer'}
            />
          </div>
        )}

        {showing.body === 'customers' && <Customers rows={shown} loading={loading} />}
        {showing.body === 'groups' && <Groups rows={groups} />}
        {showing.body === 'open' && <OpenWork rows={shownJobs} loading={loading} />}
        {showing.body === 'accounts' && <ModeratePanel onChanged={() => void load()} />}
        {showing.body === 'import' && <ImportPanel onDone={() => void load()} />}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------
   Customers, this year against the same point last year.
   ------------------------------------------------------------- */
function Customers({ rows, loading }: { rows: YearOnYear[]; loading: boolean }) {
  if (loading) return <Card><Quiet>Reading the invoices.</Quiet></Card>;
  if (!rows.length) {
    return <EmptyState what="No customer of that name" why="Nothing billed matches what you typed." />;
  }

  return (
    <Card padded={false}>
      <Head cells={['Customer', 'This year', 'Same point last year', 'Change', 'Open', 'Last billed']} />
      {rows.map((r) => (
        <div key={r.contact_id} style={ROW}>
          <div style={{ ...CELL, flex: 2.2, minWidth: 190 }}>
            <span style={{ fontWeight: 600 }}>{r.company_name}</span>
            {r.alphas?.length > 1 && (
              <span style={{ marginLeft: 8 }}>
                <Badge tone="neutral">{r.alphas.length} accounts</Badge>
              </span>
            )}
          </div>
          <Num>{money(r.this_year)}</Num>
          <Num quiet>{money(r.last_year)}</Num>
          <Change from={Number(r.last_year || 0)} to={Number(r.this_year || 0)} />
          <Num quiet>{r.open_jobs ? `${r.open_jobs} · ${money(r.open_value)}` : '—'}</Num>
          <Num quiet>{r.last_billed ?? '—'}</Num>
        </div>
      ))}
    </Card>
  );
}

/* -------------------------------------------------------------
   Groups, and what each account inside one billed.
   ------------------------------------------------------------- */
function Groups({ rows }: { rows: GroupRevenue[] }) {
  const supabase = createClient();
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const [lines, setLines] = useState<Record<string, GroupLine[]>>({});

  const expand = useCallback(async (id: string) => {
    if (openGroup === id) { setOpenGroup(null); return; }
    setOpenGroup(id);
    if (!lines[id]) {
      const got = await groupBreakdown(supabase, id);
      setLines((was) => ({ ...was, [id]: got }));
    }
  }, [openGroup, lines, supabase]);

  if (!rows.length) {
    return (
      <EmptyState
        what="No groups yet"
        why="A group totals several customers together without merging them, so Montgomery Transport, Distribution and Tank Services can be read as one number and as three. Suggestions appear under Accounts."
      />
    );
  }

  return (
    <Card padded={false}>
      <Head cells={['Group', 'This year', 'Same point last year', 'Change', 'Open', '']} />
      {rows.map((g) => (
        <div key={g.group_id}>
          <button
            onClick={() => void expand(g.group_id)}
            style={{ ...ROW, width: '100%', border: 'none', background: 'transparent', cursor: 'pointer', textAlign: 'left' }}
          >
            <div style={{ ...CELL, flex: 2.2, minWidth: 190, display: 'flex', alignItems: 'center', gap: 8 }}>
              <ChevronRight
                size={14}
                style={{
                  color: 'var(--text-subtle)', flexShrink: 0,
                  transform: openGroup === g.group_id ? 'rotate(90deg)' : 'none',
                  transition: 'transform 120ms',
                }}
              />
              <span style={{ fontWeight: 600 }}>{g.group_name}</span>
              <Badge tone="neutral">
                {g.customers} {g.customers === 1 ? 'customer' : 'customers'} · {g.accounts} accounts
              </Badge>
            </div>
            <Num>{money(g.this_year)}</Num>
            <Num quiet>{money(g.last_year)}</Num>
            <Change from={Number(g.last_year || 0)} to={Number(g.this_year || 0)} />
            <Num quiet>{g.open_jobs ? `${g.open_jobs} · ${money(g.open_value)}` : '—'}</Num>
            <div style={{ ...CELL, flex: 1, minWidth: 90 }} />
          </button>

          {openGroup === g.group_id && (
            <div style={{ background: 'var(--surface-sunken)', padding: '4px 0' }}>
              {(lines[g.group_id] ?? []).map((l) => (
                <div key={l.alpha} style={{ ...ROW, borderBottom: 'none' }}>
                  <div style={{ ...CELL, flex: 2.2, minWidth: 190, paddingLeft: 34 }}>
                    <span>{l.protean_name}</span>
                    <span style={{ color: 'var(--text-subtle)', marginLeft: 8, fontSize: 11.5 }}>
                      {l.alpha} · {l.company_name}
                    </span>
                  </div>
                  <Num>{money(l.this_year)}</Num>
                  <Num quiet>{money(l.last_year)}</Num>
                  <Change from={Number(l.last_year || 0)} to={Number(l.this_year || 0)} />
                  <Num quiet>{l.open_jobs ? `${l.open_jobs} · ${money(l.open_value)}` : '—'}</Num>
                  <div style={{ ...CELL, flex: 1, minWidth: 90 }} />
                </div>
              ))}
              {!lines[g.group_id] && (
                <div style={{ padding: '8px 14px' }}><Quiet>Reading the accounts.</Quiet></div>
              )}
            </div>
          )}
        </div>
      ))}
    </Card>
  );
}

/* -------------------------------------------------------------
   What is open on the system, oldest first.

   Oldest first because the question this screen answers is which job
   has been sitting there longest, not which arrived most recently.
   ------------------------------------------------------------- */
type OpenJob = {
  job_no: string;
  protean_name: string;
  job_type: string | null;
  status: string | null;
  depot: string | null;
  logged_on: string | null;
  job_total: number | null;
  alpha: string | null;
};

function OpenWork({ rows, loading }: { rows: OpenJob[]; loading: boolean }) {
  if (loading) return <Card><Quiet>Reading the workshop.</Quiet></Card>;
  if (!rows.length) {
    return <EmptyState what="Nothing open" why="No job on the system is waiting, or nothing matches what you typed." />;
  }

  const days = (d: string | null) => {
    if (!d) return null;
    const then = new Date(`${d}T00:00:00`);
    return Math.round((Date.now() - then.getTime()) / 86_400_000);
  };

  return (
    <Card padded={false}>
      <Head cells={['Job', 'Customer', 'Type', 'Depot', 'Logged', 'Value']} />
      {rows.map((j) => {
        const age = days(j.logged_on);
        return (
          <div key={j.job_no} style={ROW}>
            <div style={{ ...CELL, flex: 1, minWidth: 90 }}>
              <span style={{ fontVariantNumeric: 'tabular-nums' }}>{j.job_no}</span>
            </div>
            <div style={{ ...CELL, flex: 2.4, minWidth: 190 }}>
              <span style={{ fontWeight: 600 }}>{j.protean_name}</span>
              {!j.alpha && <span style={{ marginLeft: 8 }}><Badge tone="warning">No account</Badge></span>}
            </div>
            <div style={{ ...CELL, flex: 1.4, minWidth: 120 }}>
              <span style={{ color: 'var(--text-muted)' }}>{j.job_type ?? '—'}</span>
            </div>
            <div style={{ ...CELL, flex: 1, minWidth: 90 }}>
              <span style={{ color: 'var(--text-muted)' }}>{j.depot ?? '—'}</span>
            </div>
            <div style={{ ...CELL, flex: 1.2, minWidth: 110 }}>
              <span style={{ color: 'var(--text-muted)' }}>{j.logged_on ?? '—'}</span>
              {age != null && age > 30 && (
                <span style={{ marginLeft: 8 }}><Badge tone="warning">{age} days</Badge></span>
              )}
            </div>
            <Num>{money(j.job_total)}</Num>
          </div>
        );
      })}
    </Card>
  );
}

/* ---------- the small shared pieces ---------- */

const ROW: React.CSSProperties = {
  display: 'flex', alignItems: 'center', minHeight: 36,
  borderBottom: '1px solid var(--border)', fontSize: 13,
};
const CELL: React.CSSProperties = {
  padding: '0 14px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  color: 'var(--text)',
};

function Head({ cells }: { cells: string[] }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', minHeight: 32,
      background: 'var(--bg-subtle)', borderBottom: '1px solid var(--border)',
    }}>
      {cells.map((c, i) => (
        <div key={c || i} style={{
          ...CELL,
          flex: i === 0 ? 2.2 : 1,
          minWidth: i === 0 ? 190 : 90,
          textAlign: i === 0 ? 'left' : 'right',
        }}>
          <Label>{c}</Label>
        </div>
      ))}
    </div>
  );
}

function Num({ children, quiet }: { children: React.ReactNode; quiet?: boolean }) {
  return (
    <div style={{
      ...CELL, flex: 1, minWidth: 90, textAlign: 'right',
      fontVariantNumeric: 'tabular-nums',
      color: quiet ? 'var(--text-muted)' : 'var(--text)',
    }}>{children}</div>
  );
}

/** Up, down or level, said in colour and in a word. */
function Change({ from, to }: { from: number; to: number }) {
  const diff = to - from;
  const pct = from ? (100 * diff) / from : null;
  const tone = diff > 0 ? 'var(--success)' : diff < 0 ? 'var(--danger)' : 'var(--text-subtle)';
  const Icon = diff > 0 ? TrendingUp : diff < 0 ? TrendingDown : Minus;

  return (
    <div style={{
      ...CELL, flex: 1, minWidth: 90, textAlign: 'right',
      fontVariantNumeric: 'tabular-nums', color: tone,
      display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6,
    }}>
      <Icon size={13} style={{ flexShrink: 0 }} />
      <span>{diff === 0 ? 'level' : money(Math.abs(diff))}</span>
      {pct != null && diff !== 0 && (
        <span style={{ fontSize: 11.5, opacity: 0.85 }}>{Math.abs(pct).toFixed(0)}%</span>
      )}
    </div>
  );
}

function Stat({ label, value, note, quiet, tone }: {
  label: string; value: string; note?: string; quiet?: boolean; tone?: 'up' | 'down';
}) {
  const colour = tone === 'up' ? 'var(--success)' : tone === 'down' ? 'var(--danger)' : undefined;
  return (
    <Card>
      <Label>{label}</Label>
      <div style={{
        fontFamily: 'var(--panton)', fontWeight: 800, fontSize: 25, marginTop: 5,
        letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums',
        color: colour ?? (quiet ? 'var(--text-muted)' : 'var(--text)'),
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        {tone === 'up' && <TrendingUp size={18} />}
        {tone === 'down' && <TrendingDown size={18} />}
        {value}
      </div>
      {note && (
        <div style={{ fontSize: 12, color: 'var(--text-subtle)', marginTop: 4 }}>{note}</div>
      )}
    </Card>
  );
}

function Quiet({ children }: { children: React.ReactNode }) {
  return <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{children}</span>;
}
