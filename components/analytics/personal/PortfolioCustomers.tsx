'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowRight, Bell, GitCompare, TrendingDown, TrendingUp, X } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import {
  Badge, Button, EmptyState, Label, SearchInput, compactMoney, money,
} from '@/components/kit/primitives';
import { Drawer, Select } from '@/components/kit/forms';
import { useToast } from '@/components/kit/toast';
import { ReminderModal } from '@/components/crm/ReminderModal';
import type { CRMContact } from '@/lib/types';
import { readChoice, writeChoice } from '@/lib/ui/remember';
import { Leaderboard } from '@/components/analytics/kit/leaderboard';

/* =============================================================
   THE CUSTOMERS ON THIS PORTFOLIO, AND WHAT THEY SPEND.

   From the business:

     personal portfolio should have a list like the revenue tab of
     customers and their revenue. limit to 20 rows with scrolling. can
     click into a customer and see their broken down revenue, set
     reminder button against each, compare against another customer.

   Four things, and all four are here: the list, the drill in, the
   reminder, and the comparison.

   ---- Twenty rows with scrolling, not twenty rows ----

   The list asks the database for twenty at a time and fetches the next
   twenty when somebody reaches the bottom, so a portfolio of ninety
   customers is ninety customers rather than the top twenty with the
   rest missing. Every row carries how many there are in total, so the
   panel can say "20 of 93" without asking a second question.

   ---- The figures are the same figures ----

   `personal_customers` reads every invoice through `invoice_customer`,
   the same route the revenue tab and the movers panel take, so the
   three cannot answer one question with three numbers. The check
   asserts that directly rather than trusting it.
   ============================================================= */

const PAGE = 20;

type Row = {
  contact_id: string;
  company_name: string | null;
  this_year: number;
  last_year: number;
  change: number;
  change_pct: number | null;
  invoices: number;
  last_billed: string | null;
  divisions: string | null;
  open_deals: number;
  open_value: number | null;
  total_rows: number;
};

type Part = {
  grain: 'division' | 'month';
  label: string;
  sort_key: string;
  this_year: number;
  last_year: number | null;
  invoices: number;
};

/* ---- THE SORT SAYS WHICH WAY ROUND, AND WHICH COLUMN ----

   From the business: "unsure how the Sort works on Customers on this
   portfolio. There are no row headers to know what any of the data
   means and it's not clear what it actually sorting and in what order."

   Both halves were true, and the second was worse than unclear. The
   option read "Biggest change" and `personal_customers` sorts that
   column DESCENDING, so it put the biggest RISES at the top and the
   biggest falls at the very bottom, which is the opposite of what
   somebody scanning for a problem expects to find first. It is called
   what it does now.

   AND EVERY ONE OF THEM ORDERS A COLUMN THAT IS ON THE SCREEN. Open
   pipeline was not. The list came back correctly ordered by the open
   VALUE and the row printed This year in the big figure on the right,
   so a perfectly good order read as noise:

     "I sorted by pipeline and can't tell what it's actually sorting as
     the top customer has 1 lead, the one below it has 2, then the one
     below it has 1."

   Sorting a list by a number that is nowhere on it cannot be explained
   with a better label, so Open is a column now. `column` names the one
   each option orders, and the heading of that column is drawn in the
   stronger ink. */
const SORTS = [
  { key: 'this_year', label: 'This year, highest first',            column: 'this_year' },
  { key: 'last_year', label: 'Last year, highest first',            column: 'last_year' },
  { key: 'change',    label: 'Biggest rise first',                  column: 'change' },
  { key: 'open',      label: 'Open pipeline value, highest first',  column: 'open' },
  { key: 'name',      label: 'Name, A to Z',                        column: 'name' },
] as const;

/* The kit's own leaderboard carries every width, gap and weight this
   table uses. See `components/analytics/kit/leaderboard.tsx`: the five
   numbers that used to live here were the fault the business reported. */

/** The "no value here" glyph, which is a placeholder and not writing. */
const NOTHING = '\u2014';

type SortKey = typeof SORTS[number]['key'];
const SORT_KEYS = SORTS.map((s) => s.key);

/* Two letters for the kit's round chip. The kit puts a person's
   initials in it; a company's are the first letter of its first two
   real words, which is what a fleet manager writes on a job card. */
const initialsOf = (name: string | null) => (name ?? '?')
  .replace(/[^A-Za-z0-9 ]/g, ' ')
  .split(/\s+/)
  .filter(Boolean)
  .slice(0, 2)
  .map((w) => w[0].toUpperCase())
  .join('') || '?';

const ukDate = (v: string | null) => {
  if (!v) return null;
  try {
    return new Date(`${v}T00:00:00`).toLocaleDateString('en-GB', {
      day: '2-digit', month: 'short', year: '2-digit',
    });
  } catch { return v; }
};

export function PortfolioCustomers({ person, upto, me }: {
  person: string;
  upto?: string;
  /** Whose diary a reminder lands in. Always the person setting it. */
  me: string;
}) {
  const supabase = useMemo(() => createClient(), []);
  const { say } = useToast();

  /* How somebody sorts their own list is a preference, so it lasts
     past the reload. `lib/ui/remember.ts`, same as everywhere else. */
  const [sort, setSort] = useState<SortKey>(
    () => readChoice<SortKey>('portfolio-customer-sort', SORT_KEYS) ?? 'this_year',
  );
  const [find, setFind] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  const [open, setOpen] = useState<Row | null>(null);
  const [against, setAgainst] = useState<string>('');
  const [remind, setRemind] = useState<Row | null>(null);

  const page = useCallback(async (from: number) => {
    const { data, error } = await supabase.rpc('personal_customers', {
      p_person: person, p_upto: upto ?? null,
      p_limit: PAGE, p_offset: from, p_sort: sort,
    });
    if (error) { setFailed(error.message); return [] as Row[]; }
    setFailed(null);
    return (data ?? []) as Row[];
  }, [supabase, person, upto, sort]);

  useEffect(() => {
    let dead = false;
    void (async () => {
      setLoading(true);
      const first = await page(0);
      if (dead) return;
      setRows(first);
      setLoading(false);
    })();
    return () => { dead = true; };
  }, [page]);

  const total = rows[0]?.total_rows ?? 0;

  async function fetchMore() {
    if (more || rows.length >= total) return;
    setMore(true);
    const next = await page(rows.length);
    setRows((r) => [...r, ...next]);
    setMore(false);
  }

  /* Typed into the box, filtered here rather than at the database. The
     list is a portfolio, not the whole CRM: a rep with ninety customers
     has ninety rows, and a round trip per keystroke for ninety rows is
     a round trip nobody needs. */
  const shown = find.trim()
    ? rows.filter((r) => (r.company_name ?? '').toLowerCase().includes(find.trim().toLowerCase()))
    : rows;

  const other = against ? rows.find((r) => r.contact_id === against) ?? null : null;

  /* Which of the three columns the list is in the order of, so the
     heading can say so. Open pipeline and name order the list by
     something that is not one of the three, and mark none of them. */
  /* The bar is read against the biggest this-year figure on the list,
     which is the kit's own arrangement: its widest row fills the slot
     and every other one is a fraction of it. */
  const widest = shown.reduce((m, r) => Math.max(m, Number(r.this_year)), 0);
  const sumThis = shown.reduce((t, r) => t + Number(r.this_year), 0);
  const sumLast = shown.reduce((t, r) => t + Number(r.last_year), 0);
  const sumOpen = shown.reduce((t, r) => t + Number(r.open_value ?? 0), 0);

  return (
    <>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
        padding: '10px 12px', borderBottom: '1px solid var(--border)',
      }}>
        <SearchInput
          value={find}
          onChange={setFind}
          placeholder="Find a customer on this portfolio"
        />
      </div>

      {failed && (
        <div style={{ padding: 12, fontSize: 13, color: 'var(--danger)' }}>
          The customer list would not load. {failed}
        </div>
      )}

      {loading ? (
        <div style={{ padding: 14, fontSize: 13, color: 'var(--text-subtle)' }}>
          Reading what they spend.
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          what="No customers on this portfolio yet."
          why="A customer appears here once there is a deal on this person's tracker against them."
        />
      ) : (
        <>
          {/* The kit's own leaderboard, which is a list of names with
              numbers against them and is what this table should always
              have been.

              From the business:

                75% blank room on the rows which is a banned primitive,
                and none of it was used for the extra column and instead
                you just made the other columns smaller.

              The kit's row spends its spare width on a 22px progression
              bar rather than on whitespace, so there is no blank to
              distribute and Open has a column of its own. Everything
              drawn below comes out of `kit.generated.ts`: this file
              contains no length, no colour and no weight.

              The two fills are last year behind and this year in front,
              both against the biggest this-year figure in the list, so
              the bar reads as "how much of the best customer is this
              one, and was it more or less than last year". */}
          <Leaderboard
            title="Customers"
            legend="This year, against the biggest on the list"
            sort={(
              <Select
                value={sort}
                onChange={(v) => {
                  setSort(v as SortKey);
                  writeChoice('portfolio-customer-sort', v);
                }}
              >
                {SORTS.map((s2) => <option key={s2.key} value={s2.key}>{s2.label}</option>)}
              </Select>
            )}
            rows={shown.map((r, i) => {
              const thisYear = Number(r.this_year);
              const lastYear = Number(r.last_year);
              const change = Number(r.change);
              return {
                key: r.contact_id,
                name: r.company_name ?? 'Unnamed',
                sub: [
                  r.invoices ? `${r.invoices} ${r.invoices === 1 ? 'invoice' : 'invoices'}` : null,
                  ukDate(r.last_billed) ? `last billed ${ukDate(r.last_billed)}` : null,
                ].filter(Boolean).join(' · ') || 'Nothing billed yet',
                initials: initialsOf(r.company_name),
                badge: r.divisions || undefined,
                bar: widest ? thisYear / widest : 0,
                figures: [
                  compactMoney(lastYear),
                  r.open_deals ? compactMoney(Number(r.open_value ?? 0)) : NOTHING,
                ],
                headline: compactMoney(thisYear),
                /* The sign is in the words, not only in the colour.
                   The kit puts a rise or fall arrow beside the figure
                   and `kit-extract` does not yet carry the path data
                   for one, so without a sign the only thing saying
                   which way it went would be green against red. */
                delta: change === 0 ? undefined
                  : {
                      text: `${change > 0 ? '+' : '\u2212'}${r.change_pct != null
                        ? `${Math.abs(Number(r.change_pct))}%`
                        : compactMoney(Math.abs(change))}`,
                      up: change > 0,
                    },
                titles: {
                  bar: `${money(lastYear)} last year, ${money(thisYear)} this year`,
                  figures: [
                    `${money(lastYear)} to this point last year`,
                    r.open_deals
                      ? `${r.open_deals} open ${r.open_deals === 1 ? 'deal' : 'deals'}, worth ${money(Number(r.open_value ?? 0))} between them`
                      : 'Nothing open with them',
                  ],
                  headline: `${money(thisYear)} invoiced this year`,
                  delta: change === 0
                    ? 'The same as this point last year'
                    : `${change > 0 ? 'Up' : 'Down'} ${money(Math.abs(change))} on this point last year`,
                },
                onClick: () => { setOpen(r); setAgainst(''); },
                after: (
                  <>
                    <Button size="sm" variant="ghost"
                      title={`Set a reminder about ${r.company_name ?? 'this customer'}`}
                      onClick={(e) => { e.stopPropagation(); setRemind(r); }}>
                      <Bell size={13} />
                    </Button>
                    <Button size="sm" variant="ghost"
                      title="Break their revenue down, and compare them with somebody else"
                      onClick={(e) => { e.stopPropagation(); setOpen(r); setAgainst(''); }}>
                      <ArrowRight size={13} />
                    </Button>
                  </>
                ),
              };
            })}
            total={{
              label: `Showing ${shown.length} of ${total}${find.trim() ? ` matching, from ${rows.length} loaded` : ''}`,
              figures: [compactMoney(sumLast), compactMoney(sumOpen)],
              headline: compactMoney(sumThis),
            }}
          />

          <div style={{
            padding: '9px 12px', fontSize: 12, color: 'var(--text-subtle)',
            display: 'flex', alignItems: 'center', gap: 10,
          }}>
            {rows.length < total && !find.trim() && (
              <Button size="sm" variant="ghost" disabled={more} onClick={() => void fetchMore()}>
                {more ? 'Loading' : 'Load the next 20'}
              </Button>
            )}
          </div>
        </>
      )}

      {open && (
        <CustomerBreakdown
          person={person}
          upto={upto}
          row={open}
          others={rows.filter((r) => r.contact_id !== open.contact_id)}
          against={against}
          onAgainst={setAgainst}
          other={other}
          onClose={() => { setOpen(null); setAgainst(''); }}
        />
      )}

      {remind && (
        <ReminderModal
          contact={{ id: remind.contact_id, company_name: remind.company_name } as CRMContact}
          me={me}
          onClose={() => setRemind(null)}
          onDone={(m) => { setRemind(null); say({ tone: 'success', title: m }); }}
        />
      )}
    </>
  );
}

/* -------------------------------------------------------------
   One customer, broken down, and optionally beside another.
   ------------------------------------------------------------- */
function CustomerBreakdown({ person, upto, row, others, against, onAgainst, other, onClose }: {
  person: string;
  upto?: string;
  row: Row;
  others: Row[];
  against: string;
  onAgainst: (v: string) => void;
  other: Row | null;
  onClose: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [parts, setParts] = useState<Part[]>([]);
  const [theirs, setTheirs] = useState<Part[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState<string | null>(null);

  const read = useCallback(async (contact: string) => {
    const { data, error } = await supabase.rpc('personal_customer_breakdown', {
      p_person: person, p_contact: contact, p_upto: upto ?? null,
    });
    if (error) { setFailed(error.message); return [] as Part[]; }
    return (data ?? []) as Part[];
  }, [supabase, person, upto]);

  useEffect(() => {
    let dead = false;
    void (async () => {
      setLoading(true);
      setFailed(null);
      const mine = await read(row.contact_id);
      if (!dead) { setParts(mine); setLoading(false); }
    })();
    return () => { dead = true; };
  }, [read, row.contact_id]);

  useEffect(() => {
    let dead = false;
    void (async () => {
      if (!against) { setTheirs([]); return; }
      const got = await read(against);
      if (!dead) setTheirs(got);
    })();
    return () => { dead = true; };
  }, [read, against]);

  const divisions = parts.filter((p) => p.grain === 'division');
  const months = parts.filter((p) => p.grain === 'month');
  const theirDivisions = theirs.filter((p) => p.grain === 'division');
  const biggestMonth = Math.max(1, ...months.map((m) => Number(m.this_year)));

  return (
    <Drawer
      eyebrow="On this portfolio"
      title={row.company_name ?? 'Unnamed'}
      hint={`${row.invoices} ${row.invoices === 1 ? 'invoice' : 'invoices'} this year${
        row.divisions ? `, through ${row.divisions}` : ''}`}
      onClose={onClose}
      width={760}
      footer={
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%' }}>
          <GitCompare size={14} style={{ color: 'var(--text-subtle)' }} />
          <Label>Compare against</Label>
          <Select value={against} onChange={onAgainst}>
            <option value="">Nobody</option>
            {others.map((o) => (
              <option key={o.contact_id} value={o.contact_id}>{o.company_name ?? 'Unnamed'}</option>
            ))}
          </Select>
          {against && (
            <Button size="sm" variant="ghost" onClick={() => onAgainst('')}>
              <X size={13} /> Clear
            </Button>
          )}
          <Button size="sm" style={{ marginLeft: 'auto' }} onClick={onClose}>Close</Button>
        </div>
      }
    >
      {failed && (
        <div style={{ fontSize: 13, color: 'var(--danger)', marginBottom: 10 }}>
          Their breakdown would not load. {failed}
        </div>
      )}

      {/* ---- the headline, and the other one beside it when asked ---- */}
      <div style={{
        display: 'grid', gap: 10, marginBottom: 14,
        gridTemplateColumns: other ? '1fr 1fr' : '1fr',
      }}>
        <Side row={row} />
        {other && <Side row={other} muted />}
      </div>

      {loading ? (
        <div style={{ fontSize: 13, color: 'var(--text-subtle)' }}>Reading their invoices.</div>
      ) : (
        <>
          <Label>By division</Label>
          {divisions.length === 0 ? (
            <div style={{ fontSize: 13, color: 'var(--text-subtle)', padding: '8px 0 14px' }}>
              Nothing invoiced through any division this year or last.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, margin: '6px 0 16px' }}>
              {divisions.map((d) => {
                const mirror = theirDivisions.find((t) => t.label === d.label);
                return (
                  <div key={d.label} style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '8px 11px', borderRadius: 'var(--r)',
                    border: '1px solid var(--border)', background: 'var(--surface-sunken)',
                  }}>
                    <span style={{ flex: 1, fontSize: 13, color: 'var(--text)' }}>{d.label}</span>
                    <span style={{ fontSize: 11.5, color: 'var(--text-subtle)' }}>
                      {d.invoices} {d.invoices === 1 ? 'invoice' : 'invoices'}
                    </span>
                    <span style={{
                      fontSize: 12.5, color: 'var(--text-subtle)',
                      fontVariantNumeric: 'tabular-nums', minWidth: 74, textAlign: 'right',
                    }}>{money(Number(d.last_year))}</span>
                    <span style={{
                      fontSize: 13, color: 'var(--text)', fontWeight: 600,
                      fontVariantNumeric: 'tabular-nums', minWidth: 78, textAlign: 'right',
                    }}>{money(Number(d.this_year))}</span>
                    {other && (
                      <span style={{
                        fontSize: 12.5, color: 'var(--chart-rental)',
                        fontVariantNumeric: 'tabular-nums', minWidth: 78, textAlign: 'right',
                      }}>{mirror ? money(Number(mirror.this_year)) : 'Nothing'}</span>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <Label>Month by month, this year</Label>
          {months.length === 0 ? (
            <div style={{ fontSize: 13, color: 'var(--text-subtle)', padding: '8px 0' }}>
              Nothing invoiced yet this financial year.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginTop: 6 }}>
              {months.map((m) => (
                <div key={m.sort_key} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ width: 74, fontSize: 12, color: 'var(--text-subtle)' }}>{m.label}</span>
                  <div style={{
                    flex: 1, height: 8, borderRadius: 4,
                    background: 'var(--surface-sunken)', overflow: 'hidden',
                  }}>
                    {/* A chart colour, not an action colour. `--accent`
                        is what buttons are, and it inverts between the
                        two themes: a bar drawn in it reads as something
                        to press. `scripts/chart-colour-check.ts` is
                        what says so, and it said so about this line. */}
                    <div style={{
                      width: `${Math.round((Number(m.this_year) / biggestMonth) * 100)}%`,
                      height: '100%', background: 'var(--chart-company)',
                    }} />
                  </div>
                  <span style={{
                    fontSize: 12.5, color: 'var(--text)',
                    fontVariantNumeric: 'tabular-nums', minWidth: 74, textAlign: 'right',
                  }}>{money(Number(m.this_year))}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </Drawer>
  );
}

function Side({ row, muted }: { row: Row; muted?: boolean }) {
  const up = Number(row.change) > 0;
  return (
    <div style={{
      padding: '11px 13px', borderRadius: 'var(--r)',
      border: `1px solid ${muted ? 'var(--chart-rental)' : 'var(--border-strong)'}`,
      background: 'var(--surface)',
    }}>
      <Label>{row.company_name ?? 'Unnamed'}</Label>
      <div style={{
        fontFamily: 'var(--panton)', fontSize: 22, fontWeight: 800,
        color: 'var(--text)', fontVariantNumeric: 'tabular-nums', margin: '2px 0 4px',
      }}>{money(Number(row.this_year))}</div>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6, fontSize: 12,
        color: Number(row.change) === 0 ? 'var(--text-subtle)'
          : up ? 'var(--success)' : 'var(--danger)',
      }}>
        {Number(row.change) !== 0 && (up ? <TrendingUp size={12} /> : <TrendingDown size={12} />)}
        {money(Math.abs(Number(row.change)))} against {money(Number(row.last_year))} last year
      </div>
      {row.open_deals > 0 && (
        <div style={{ marginTop: 7 }}>
          <Badge tone="neutral">
            {row.open_deals} open, {row.open_value == null ? 'not priced' : money(Number(row.open_value))}
          </Badge>
        </div>
      )}
    </div>
  );
}
