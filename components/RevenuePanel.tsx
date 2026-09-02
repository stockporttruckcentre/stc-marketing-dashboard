'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  TrendingUp, TrendingDown, Upload, Download, ChevronRight, Minus,
  Settings2, Trash2, X, Loader,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import {
  Alert, Badge, Button, Card, EmptyState, Label, PageHead, SearchInput,
  SectionHead, Tabs, money,
} from '@/components/kit/primitives';
import { Field, Modal, TextInput } from '@/components/kit/forms';
import { useToast } from '@/components/kit/toast';
import { ImportPanel } from '@/components/revenue/import-panel';
import { DataTable, Count, Money, type Col } from '@/components/revenue/table';
import { ExportWizard } from '@/components/revenue/export-wizard';
import { ModeratePanel } from '@/components/revenue/moderate-panel';
import {
  yearOnYear, groupRevenue, groupBreakdown, companyRevenue, everyOpenJob,
  type YearOnYear, type GroupRevenue, type GroupLine, type CompanyRevenue,
  type OpenJob, type Division,
} from '@/lib/protean/rpc';
import { whatToShow, REVENUE_TABS, type RevenueTab } from '@/lib/protean/screen';
import { groupsToOffer } from '@/lib/protean/customers';
import {
  nameGroup, putInGroup, renameGroup, forgetGroup, groupMembers,
  declineGroupSuggestion, declinedGroupNames, readable,
  type GroupMember,
} from '@/lib/protean/rpc';

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

export function RevenuePanel({ mayImport, division, divisionName }: {
  mayImport: boolean;
  /* One screen per division. Two systems that use the same account code
     for different companies cannot share a page without somebody
     eventually reading one as the other. */
  division: Division;
  divisionName: string;
}) {
  const supabase = createClient();
  const { say } = useToast();

  const [tab, setTab] = useState<Tab>('customers');
  const [company, setCompany] = useState<CompanyRevenue | null>(null);
  const [customers, setCustomers] = useState<YearOnYear[]>([]);
  const [groups, setGroups] = useState<GroupRevenue[]>([]);
  const [open, setOpen] = useState<OpenJob[]>([]);
  const [waiting, setWaiting] = useState(0);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [totals, yoy, grp, jobs, queue, unplaced] = await Promise.all([
        companyRevenue(supabase, division),
        yearOnYear(supabase, division),
        groupRevenue(supabase, division),
        everyOpenJob(supabase, division),
        supabase.rpc('protean_to_moderate', { p_division: division }),
        supabase.rpc('protean_jobs_without_account', { p_division: division }),
      ]);
      if (queue.error) throw readable(queue.error);
      if (unplaced.error) throw readable(unplaced.error);
      setCompany(totals);
      setCustomers(yoy);
      setGroups(grp);
      setOpen(jobs);
      /* Accounts waiting plus work with no account. Both need a person,
         and a badge that counted only the first said nothing was
         waiting on a screen that was showing SAF Holland's jobs. */
      setWaiting(((queue.data ?? []) as unknown[]).length
        + ((unplaced.data ?? []) as unknown[]).length);
    } catch (e) {
      say({ tone: 'danger', title: e instanceof Error ? e.message : 'The revenue would not load.' });
    } finally {
      setLoading(false);
    }
  }, [supabase, say, division]);

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

  /* EVERY HEADLINE FIGURE COMES FROM THE DATABASE, NOT FROM THE LIST.

     These used to be worked out by adding up the rows on screen, which
     is wrong the moment the list is not all of them, and PostgREST caps
     a response at a thousand rows whatever limit is asked for. With
     1,009 jobs open the screen showed a thousand and quietly reported
     the value of a thousand as the value of all of them.

     A total that is a sum of what happens to have been fetched is a
     total that goes wrong silently and gets larger as the business
     does. So the company function counts them, in the database, over
     everything. */
  const totals = useMemo(() => ({
    thisYear: Number(company?.this_year || 0),
    lastYear: Number(company?.last_year || 0),
    change: Number(company?.change || 0),
    openValue: Number(company?.open_value || 0),
    openJobs: Number(company?.open_jobs || 0),
    lastYearFull: Number(company?.last_year_full || 0),
    fyStarted: company?.fy_started ?? null,
  }), [company]);

  /* The period every "this year" figure is measured over, named rather
     than left as a word somebody has to know the setting for. */
  const yearLabel = totals.fyStarted
    ? new Date(`${totals.fyStarted}T00:00:00`).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })
    : null;

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
    { key: 'open', label: 'Open work', count: company ? Number(company.open_jobs) : open.length },
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
        title={divisionName}
        sub={yearLabel
          /* Named from the setting rather than written out, because the
             company's year moved from January to April and a sentence
             that says January is a sentence somebody has to remember to
             come back and change. */
          ? `Invoiced since ${yearLabel}, and everything still open on the system.`
          : 'Everything invoiced, and everything still open on the system.'}
        action={(
          <div style={{ display: 'flex', gap: 9 }}>
            <Button
              variant="secondary"
              onClick={() => setExporting(true)}
              /* White with navy text, as asked, rather than the kit's
                 default secondary. Navy acts, and this one acts. */
              style={{ background: '#FFFFFF', color: 'var(--primary)', borderColor: 'var(--border-strong)' }}
            >
              <Download size={14} />
              Export
            </Button>
            {mayImport && tab !== 'import' && (
              <Button variant="primary" onClick={() => setTab('import')}>
                <Upload size={14} />
                Put this week in
              </Button>
            )}
          </div>
        )}
      />

      {showing.stats && (
        <div style={{
          display: 'grid', gap: 12, marginBottom: 18,
          gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
        }}>
          <Stat label="Invoiced this year" value={money(totals.thisYear)} />
          <Stat
            label="Same point last year"
            value={money(totals.lastYear)}
            quiet
            under={totals.lastYearFull
              ? { label: 'Whole of last year', value: money(totals.lastYearFull) }
              : undefined}
          />
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
        {showing.body === 'groups' && (
          <Groups rows={groups} division={division} onChanged={() => void load()} />
        )}
        {showing.body === 'open' && <OpenWork rows={shownJobs} loading={loading} />}
        {showing.body === 'accounts' && <ModeratePanel division={division} onChanged={() => void load()} />}
        {showing.body === 'import' && (
          <ImportPanel division={division} divisionName={divisionName} onDone={() => void load()} />
        )}
      </div>

      {exporting && (
        <ExportWizard
          division={division}
          divisionName={divisionName}
          fyStarted={totals.fyStarted}
          onClose={() => setExporting(false)}
        />
      )}
    </div>
  );
}

/* -------------------------------------------------------------
   Customers, this year against the same point last year.

   Two columns for open work rather than one, because the business
   asked for the count and the value to be told apart and no formatting
   trick beats putting them under two headings that each say which is
   which.
   ------------------------------------------------------------- */
function Customers({ rows, loading }: { rows: YearOnYear[]; loading: boolean }) {
  if (loading) return <Card><Quiet>Reading the invoices.</Quiet></Card>;
  if (!rows.length) {
    return <EmptyState what="No customer of that name" why="Nothing billed matches what you typed." />;
  }

  const cols: Col<YearOnYear>[] = [
    {
      key: 'name', label: 'Customer', flex: 2.4, minWidth: 200,
      sort: (r) => r.company_name,
      cell: (r) => (
        <>
          <span style={{ fontWeight: 600 }}>{r.company_name}</span>
          {r.alphas?.length > 1 && (
            <span style={{ marginLeft: 8 }}><Badge tone="neutral">{r.alphas.length} accounts</Badge></span>
          )}
        </>
      ),
    },
    {
      key: 'this', label: 'This year', flex: 1.1, minWidth: 100, align: 'right',
      sort: (r) => Number(r.this_year || 0),
      cell: (r) => <Money>{money(r.this_year)}</Money>,
    },
    {
      key: 'last', label: 'Last year', flex: 1.1, minWidth: 100, align: 'right',
      sort: (r) => Number(r.last_year || 0),
      cell: (r) => <Money quiet>{money(r.last_year)}</Money>,
    },
    {
      key: 'change', label: 'Change', flex: 1.2, minWidth: 110, align: 'right',
      sort: (r) => Number(r.change || 0),
      cell: (r) => <Change from={Number(r.last_year || 0)} to={Number(r.this_year || 0)} />,
    },
    {
      key: 'jobs', label: 'Jobs open', flex: 0.8, minWidth: 84, align: 'right',
      sort: (r) => Number(r.open_jobs || 0),
      cell: (r) => <Count n={Number(r.open_jobs || 0)} />,
    },
    {
      key: 'openvalue', label: 'Open value', flex: 1.1, minWidth: 100, align: 'right',
      sort: (r) => Number(r.open_value || 0),
      cell: (r) => (Number(r.open_value) ? <Money quiet>{money(r.open_value)}</Money>
        : <span style={{ color: 'var(--text-subtle)' }}>—</span>),
    },
    {
      key: 'billed', label: 'Last billed', flex: 1, minWidth: 96, align: 'right',
      sort: (r) => r.last_billed,
      cell: (r) => <Money quiet>{r.last_billed ?? '—'}</Money>,
    },
  ];

  return (
    <DataTable
      columns={cols}
      rows={rows}
      rowKey={(r) => r.contact_id}
      initial={{ key: 'this', desc: true }}
    />
  );
}

/* -------------------------------------------------------------
   Groups, and what each account inside one billed.
   ------------------------------------------------------------- */
type BoundAccount = {
  alpha: string;
  protean_name: string;
  contact_id: string | null;
  ignored: boolean;
};

function Groups({ rows, division, onChanged }: {
  rows: GroupRevenue[];
  division: Division;
  onChanged: () => void;
}) {
  const supabase = createClient();
  const { say } = useToast();
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const [lines, setLines] = useState<Record<string, GroupLine[]>>({});

  /* THE SUGGESTIONS COME FROM EVERY ACCOUNT, NOT FROM THE QUEUE.

     They used to be worked out from the moderation queue, which holds
     only accounts nobody has placed yet. So they disappeared at exactly
     the moment they became usable: place the three Dawson accounts and
     the Dawson suggestion vanishes with them, leaving a Groups tab
     reading zero and no way to make one. */
  const [accounts, setAccounts] = useState<BoundAccount[]>([]);
  const [inGroup, setInGroup] = useState<Record<string, string | null>>({});
  const [declined, setDeclined] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [managing, setManaging] = useState<GroupRevenue | null>(null);

  const loadAccounts = useCallback(async () => {
    const [accs, contacts, no] = await Promise.all([
      supabase.from('protean_accounts').select('alpha, protean_name, contact_id, ignored'),
      supabase.from('crm_contacts').select('id, group_id'),
      declinedGroupNames(supabase),
    ]);
    setAccounts(((accs.data ?? []) as BoundAccount[]).filter((a) => !a.ignored));
    const map: Record<string, string | null> = {};
    for (const c of (contacts.data ?? []) as { id: string; group_id: string | null }[]) {
      map[c.id] = c.group_id;
    }
    setInGroup(map);
    setDeclined(no);
  }, [supabase]);

  useEffect(() => { void loadAccounts(); }, [loadAccounts]);

  const suggestions = useMemo(
    () => groupsToOffer(
      accounts.map((a) => ({ account: a.alpha, name: a.protean_name, contactId: a.contact_id })),
      (id) => inGroup[id] ?? null,
      declined,
    ),
    [accounts, inGroup, declined],
  );

  const accept = useCallback(async (name: string, contacts: string[]) => {
    setBusy(name);
    try {
      const group = await nameGroup(supabase, name);
      for (const id of contacts) await putInGroup(supabase, id, group);
      say({ tone: 'success', title: `${name} is a group of ${contacts.length}.` });
      await loadAccounts();
      onChanged();
    } catch (e) {
      say({ tone: 'danger', title: e instanceof Error ? e.message : 'That would not save.' });
    } finally { setBusy(null); }
  }, [supabase, say, loadAccounts, onChanged]);

  const decline = useCallback(async (name: string) => {
    setBusy(name);
    try {
      await declineGroupSuggestion(supabase, name);
      say({ tone: 'neutral', title: `${name} will not be suggested again.` });
      await loadAccounts();
    } catch (e) {
      say({ tone: 'danger', title: e instanceof Error ? e.message : 'That would not save.' });
    } finally { setBusy(null); }
  }, [supabase, say, loadAccounts]);

  const expand = useCallback(async (id: string) => {
    if (openGroup === id) { setOpenGroup(null); return; }
    setOpenGroup(id);
    if (!lines[id]) {
      const got = await groupBreakdown(supabase, id, division);
      setLines((was) => ({ ...was, [id]: got }));
    }
  }, [openGroup, lines, supabase, division]);

  const cols: Col<GroupRevenue>[] = [
    {
      key: 'name', label: 'Group', flex: 2.4, minWidth: 200,
      sort: (g) => g.group_name,
      cell: (g) => (
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
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
        </span>
      ),
    },
    {
      key: 'this', label: 'This year', flex: 1.1, minWidth: 100, align: 'right',
      sort: (g) => Number(g.this_year || 0),
      cell: (g) => <Money>{money(g.this_year)}</Money>,
    },
    {
      key: 'last', label: 'Last year', flex: 1.1, minWidth: 100, align: 'right',
      sort: (g) => Number(g.last_year || 0),
      cell: (g) => <Money quiet>{money(g.last_year)}</Money>,
    },
    {
      key: 'change', label: 'Change', flex: 1.2, minWidth: 110, align: 'right',
      sort: (g) => Number(g.change || 0),
      cell: (g) => <Change from={Number(g.last_year || 0)} to={Number(g.this_year || 0)} />,
    },
    {
      key: 'jobs', label: 'Jobs open', flex: 0.8, minWidth: 84, align: 'right',
      sort: (g) => Number(g.open_jobs || 0),
      cell: (g) => <Count n={Number(g.open_jobs || 0)} />,
    },
    {
      key: 'openvalue', label: 'Open value', flex: 1.1, minWidth: 100, align: 'right',
      sort: (g) => Number(g.open_value || 0),
      cell: (g) => (Number(g.open_value) ? <Money quiet>{money(g.open_value)}</Money>
        : <span style={{ color: 'var(--text-subtle)' }}>—</span>),
    },
    {
      key: 'manage', label: '', flex: 0.7, minWidth: 74, align: 'right',
      cell: (g) => (
        <Button
          variant="ghost" size="sm"
          onClick={(e) => { e.stopPropagation(); setManaging(g); }}
        >
          <Settings2 size={13} />
          Manage
        </Button>
      ),
    },
  ];

  const table = rows.length > 0 ? (
    <DataTable
      columns={cols}
      rows={rows}
      rowKey={(g) => g.group_id}
      initial={{ key: 'this', desc: true }}
      onRowClick={(g) => void expand(g.group_id)}
      /* Drawn under the row it belongs to. It used to sit after the
         whole table, so opening one group put its accounts at the foot
         of the page and read as belonging to all of them. */
      expanded={(g) => (openGroup !== g.group_id ? null : (
        <div style={{ background: 'var(--surface-sunken)' }}>
          {(lines[g.group_id] ?? []).map((l) => (
            <div key={`${l.division}:${l.alpha}`} style={{
              display: 'flex', alignItems: 'center', minHeight: 34, fontSize: 12.5,
              borderBottom: '1px solid var(--border)',
            }}>
              <span style={{ flex: 2.4, minWidth: 200, padding: '0 14px 0 36px' }}>
                {l.protean_name}
                <span style={{ color: 'var(--text-subtle)', marginLeft: 8 }}>
                  {l.alpha} · {l.company_name}
                </span>
              </span>
              <span style={{ flex: 1.1, minWidth: 100, padding: '0 14px', textAlign: 'right' }}>
                <Money>{money(l.this_year)}</Money>
              </span>
              <span style={{ flex: 1.1, minWidth: 100, padding: '0 14px', textAlign: 'right' }}>
                <Money quiet>{money(l.last_year)}</Money>
              </span>
              <span style={{ flex: 1.2, minWidth: 110, padding: '0 14px', textAlign: 'right' }}>
                <Change from={Number(l.last_year || 0)} to={Number(l.this_year || 0)} />
              </span>
              <span style={{ flex: 0.8, minWidth: 84, padding: '0 14px', textAlign: 'right' }}>
                <Count n={Number(l.open_jobs || 0)} />
              </span>
              <span style={{ flex: 1.1, minWidth: 100, padding: '0 14px', textAlign: 'right' }}>
                <Money quiet>{Number(l.open_value) ? money(l.open_value) : '—'}</Money>
              </span>
              <span style={{ flex: 0.7, minWidth: 74 }} />
            </div>
          ))}
          {!lines[g.group_id] && (
            <div style={{ padding: '10px 14px 10px 36px' }}><Quiet>Reading the accounts.</Quiet></div>
          )}
          {lines[g.group_id]?.length === 0 && (
            <div style={{ padding: '10px 14px 10px 36px' }}>
              <Quiet>Nothing in this division for this group.</Quiet>
            </div>
          )}
        </div>
      ))}
    />
  ) : (
    <EmptyState
      what="No groups yet"
      why="A group totals several customers together without merging them, so Montgomery Transport, Distribution and Tank Services read as one number and as three."
    />
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {table}

      {managing && (
        <ManageGroup
          group={managing}
          onClose={() => setManaging(null)}
          onChanged={async () => { await loadAccounts(); onChanged(); }}
        />
      )}

      {suggestions.length > 0 && (
        <Card>
          <SectionHead
            title="These might be one group"
            hint="Customers whose names start the same way. Read each one before accepting it."
          />
          <Alert tone="warning">
            A shared first word is a reason to look, not a reason to group. Fleet Assist and
            Fleet Operations are unrelated companies.
          </Alert>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12 }}>
            {suggestions.map((g) => (
              <div key={g.name} style={{
                display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
                border: '1px solid var(--border)', borderRadius: 'var(--r)', padding: 10,
              }}>
                <div style={{ flex: 1, minWidth: 240 }}>
                  <div style={{
                    fontFamily: 'var(--panton)', fontWeight: 700, fontSize: 14,
                    color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 8,
                  }}>
                    {g.name}
                    <Badge tone="neutral">{g.contacts.length} customers</Badge>
                  </div>
                  <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 5 }}>
                    {g.members.map((m) => m.name).join(', ')}
                  </div>
                </div>
                <Button
                  variant="secondary" size="sm" disabled={!!busy}
                  onClick={() => void accept(g.name, g.contacts)}
                >
                  Make this a group
                </Button>
                <Button
                  variant="ghost" size="sm" disabled={!!busy}
                  onClick={() => void decline(g.name)}
                  title="Stop offering this"
                >
                  Not a group
                </Button>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

/* -------------------------------------------------------------
   Managing a group.

   From the business: "I can't edit the group or remove a group."

   `name_a_group`, `put_in_group` and `forget_group` have existed since
   the groups were built and only the first two were ever reachable. So
   a group made by accident, or named badly, or with one member too
   many, was permanent from the screen's point of view.

   That is worse than a wrong suggestion. A person who cannot undo a
   thing stops using it, and stops trusting the next thing that offers
   to do something for them.
   ------------------------------------------------------------- */
function ManageGroup({ group, onClose, onChanged }: {
  group: GroupRevenue;
  onClose: () => void;
  onChanged: () => void | Promise<void>;
}) {
  const supabase = createClient();
  const { say } = useToast();
  const [name, setName] = useState(group.group_name);
  const [members, setMembers] = useState<GroupMember[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmGone, setConfirmGone] = useState(false);

  useEffect(() => {
    void (async () => {
      try { setMembers(await groupMembers(supabase, group.group_id)); }
      catch { setMembers([]); }
    })();
  }, [supabase, group.group_id]);

  const rename = async () => {
    if (name.trim() === group.group_name) return;
    setBusy('name');
    try {
      await renameGroup(supabase, group.group_id, name.trim());
      say({ tone: 'success', title: `Renamed to ${name.trim()}.` });
      await onChanged();
      onClose();
    } catch (e) {
      say({ tone: 'danger', title: e instanceof Error ? e.message : 'That would not save.' });
    } finally { setBusy(null); }
  };

  const remove = async (m: GroupMember) => {
    setBusy(m.contact_id);
    try {
      await putInGroup(supabase, m.contact_id, null);
      setMembers((was) => (was ?? []).filter((x) => x.contact_id !== m.contact_id));
      say({ tone: 'success', title: `${m.company_name} is out of ${group.group_name}.` });
      await onChanged();
    } catch (e) {
      say({ tone: 'danger', title: e instanceof Error ? e.message : 'That would not save.' });
    } finally { setBusy(null); }
  };

  const forget = async () => {
    setBusy('forget');
    try {
      await forgetGroup(supabase, group.group_id);
      say({ tone: 'success', title: `${group.group_name} is gone. Its customers are not.` });
      await onChanged();
      onClose();
    } catch (e) {
      say({ tone: 'danger', title: e instanceof Error ? e.message : 'That would not save.' });
    } finally { setBusy(null); }
  };

  return (
    <Modal
      title={`Manage ${group.group_name}`}
      description="A group is a way of looking at customers, so nothing here touches their records."
      onClose={busy ? undefined : onClose}
      width={520}
      footer={<Button variant="ghost" onClick={onClose} disabled={!!busy}>Done</Button>}
    >
      <Field label="Name">
        <div style={{ display: 'flex', gap: 8 }}>
          <TextInput value={name} onChange={setName} />
          <Button
            variant="secondary"
            onClick={() => void rename()}
            disabled={!!busy || !name.trim() || name.trim() === group.group_name}
          >
            {busy === 'name' ? <Loader size={13} className="spin" /> : null}
            Rename
          </Button>
        </div>
      </Field>

      <div style={{ marginTop: 18 }}>
        <SectionHead
          title="In this group"
          hint={members ? `${members.length}` : undefined}
        />
        {members === null && <Quiet>Reading the members.</Quiet>}
        {members?.length === 0 && (
          <EmptyState
            what="Nobody is in it"
            why="An empty group counts nothing. Add customers from a suggestion, or forget it below."
          />
        )}
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {(members ?? []).map((m) => (
            <div key={m.contact_id} style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0',
              borderBottom: '1px solid var(--border)', fontSize: 13,
            }}>
              <span style={{ flex: 1, minWidth: 0, color: 'var(--text)' }}>
                {m.company_name}
                <span style={{ color: 'var(--text-subtle)', marginLeft: 8, fontSize: 11.5 }}>
                  {m.accounts} {m.accounts === 1 ? 'account' : 'accounts'}
                </span>
              </span>
              <Money quiet>{money(m.net)}</Money>
              <Button
                variant="ghost" size="sm" disabled={!!busy}
                onClick={() => void remove(m)}
                title={`Take ${m.company_name} out of this group`}
              >
                {busy === m.contact_id ? <Loader size={13} className="spin" /> : <X size={13} />}
              </Button>
            </div>
          ))}
        </div>
      </div>

      <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
        {confirmGone ? (
          <>
            <Alert tone="warning">
              This removes the group only. Every customer stays exactly as they are, keeps their
              accounts and keeps their revenue. They stop being totalled together.
            </Alert>
            <div style={{ display: 'flex', gap: 9, marginTop: 12 }}>
              <Button variant="danger" onClick={() => void forget()} disabled={!!busy}>
                {busy === 'forget' ? <Loader size={13} className="spin" /> : <Trash2 size={13} />}
                Forget {group.group_name}
              </Button>
              <Button variant="ghost" onClick={() => setConfirmGone(false)} disabled={!!busy}>
                Keep it
              </Button>
            </div>
          </>
        ) : (
          <Button variant="ghost" onClick={() => setConfirmGone(true)} disabled={!!busy}>
            <Trash2 size={13} />
            Forget this group
          </Button>
        )}
      </div>
    </Modal>
  );
}

/* -------------------------------------------------------------
   What is open on the system, oldest first.

   Oldest first because the question this screen answers is which job
   has been sitting there longest, not which arrived most recently.
   ------------------------------------------------------------- */
function OpenWork({ rows, loading }: { rows: OpenJob[]; loading: boolean }) {
  if (loading) return <Card><Quiet>Reading the workshop.</Quiet></Card>;
  if (!rows.length) {
    return <EmptyState what="Nothing open" why="No job on the system is waiting, or nothing matches what you typed." />;
  }

  const days = (d: string | null) => {
    if (!d) return null;
    return Math.round((Date.now() - new Date(`${d}T00:00:00`).getTime()) / 86_400_000);
  };

  const cols: Col<OpenJob>[] = [
    {
      key: 'job', label: 'Job', flex: 0.9, minWidth: 88,
      sort: (j) => j.job_no,
      cell: (j) => <span style={{ fontVariantNumeric: 'tabular-nums' }}>{j.job_no}</span>,
    },
    {
      key: 'customer', label: 'Customer', flex: 2.4, minWidth: 200,
      sort: (j) => j.protean_name,
      cell: (j) => (
        <>
          <span style={{ fontWeight: 600 }}>{j.protean_name}</span>
          {!j.alpha && <span style={{ marginLeft: 8 }}><Badge tone="warning">No account</Badge></span>}
        </>
      ),
    },
    {
      key: 'type', label: 'Type', flex: 1.5, minWidth: 130,
      sort: (j) => j.job_type,
      cell: (j) => <span style={{ color: 'var(--text-muted)' }}>{j.job_type ?? '—'}</span>,
    },
    {
      key: 'depot', label: 'Depot', flex: 1, minWidth: 92,
      sort: (j) => j.depot,
      cell: (j) => <span style={{ color: 'var(--text-muted)' }}>{j.depot ?? '—'}</span>,
    },
    {
      key: 'logged', label: 'Logged', flex: 1, minWidth: 96,
      sort: (j) => j.logged_on,
      cell: (j) => <span style={{ color: 'var(--text-muted)' }}>{j.logged_on ?? '—'}</span>,
    },
    {
      key: 'age', label: 'Days open', flex: 0.9, minWidth: 88, align: 'right',
      sort: (j) => days(j.logged_on),
      cell: (j) => {
        const age = days(j.logged_on);
        if (age == null) return <span style={{ color: 'var(--text-subtle)' }}>—</span>;
        return age > 30
          ? <Badge tone="warning">{age}</Badge>
          : <Count n={age} />;
      },
    },
    {
      key: 'value', label: 'Value', flex: 1.1, minWidth: 100, align: 'right',
      sort: (j) => Number(j.job_total || 0),
      cell: (j) => <Money>{money(j.job_total)}</Money>,
    },
  ];

  return (
    <DataTable
      columns={cols}
      rows={rows}
      rowKey={(j) => `${j.division}:${j.job_no}`}
      initial={{ key: 'logged', desc: false }}
    />
  );
}

/* ---------- the small shared pieces ---------- */

/** Up, down or level, said in colour and in a word. */
function Change({ from, to }: { from: number; to: number }) {
  const diff = to - from;
  const pct = from ? (100 * diff) / from : null;
  const tone = diff > 0 ? 'var(--success)' : diff < 0 ? 'var(--danger)' : 'var(--text-subtle)';
  const Icon = diff > 0 ? TrendingUp : diff < 0 ? TrendingDown : Minus;

  return (
    <span style={{
      fontVariantNumeric: 'tabular-nums', color: tone,
      display: 'inline-flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6,
    }}>
      <Icon size={13} style={{ flexShrink: 0 }} />
      <span>{diff === 0 ? 'level' : money(Math.abs(diff))}</span>
      {pct != null && diff !== 0 && (
        <span style={{ fontSize: 11.5, opacity: 0.85 }}>{Math.abs(pct).toFixed(0)}%</span>
      )}
    </span>
  );
}

function Stat({ label, value, note, under, quiet, tone }: {
  label: string; value: string; note?: string;
  /* A second figure inside the same card, smaller.
     From the business: "show the total last financial year in full in
     the same card smaller underneath this current number". They are the
     same question at two lengths, so they belong in one card: the same
     point is what you act on, the whole year is what you are aiming at. */
  under?: { label: string; value: string };
  quiet?: boolean; tone?: 'up' | 'down';
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
      {under && (
        <div style={{
          marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border)',
          display: 'flex', alignItems: 'baseline', gap: 7,
        }}>
          <span style={{ fontSize: 11.5, color: 'var(--text-subtle)' }}>{under.label}</span>
          <span style={{
            fontFamily: 'var(--panton)', fontWeight: 700, fontSize: 14,
            fontVariantNumeric: 'tabular-nums', color: 'var(--text-muted)',
            marginLeft: 'auto',
          }}>{under.value}</span>
        </div>
      )}
    </Card>
  );
}

function Quiet({ children }: { children: React.ReactNode }) {
  return <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{children}</span>;
}
