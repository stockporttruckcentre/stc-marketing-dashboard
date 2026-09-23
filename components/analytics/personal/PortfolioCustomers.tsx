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

   `column` names the column each one orders, so the header can say
   which of the three the list is currently sorted by. */
const SORTS = [
  { key: 'this_year', label: 'This year, highest first',      column: 'this_year' },
  { key: 'last_year', label: 'Last year, highest first',      column: 'last_year' },
  { key: 'change',    label: 'Biggest rise first',            column: 'change' },
  { key: 'open',      label: 'Open pipeline value, highest first', column: null },
  { key: 'name',      label: 'Name, A to Z',                  column: null },
] as const;

/* The three number columns, and the room the two buttons take. One set
   of widths, used by the header and by every row, so a column heading
   cannot drift away from the figures underneath it. */
const W_THIS = 78;
const W_LAST = 78;
const W_CHANGE = 96;
const W_ACTIONS = 72;

type SortKey = typeof SORTS[number]['key'];
const SORT_KEYS = SORTS.map((s) => s.key);

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
  const sortedColumn = SORTS.find((s2) => s2.key === sort)?.column ?? null;

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
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Label>Sort by</Label>
          <Select
            value={sort}
            onChange={(v) => {
              setSort(v as SortKey);
              writeChoice('portfolio-customer-sort', v);
            }}
          >
            {SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </Select>
        </div>
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
          {/* Twenty rows deep, and the rest on the scroll. The height is
              what makes it a list rather than a page: twenty rows of
              revenue above the fold and the next twenty a flick away. */}
          {/* The headings, which were not there at all. Sticky, because a
              list twenty rows deep is scrolled and a heading that has
              gone off the top is a heading nobody has. */}
          <div style={{
            position: 'sticky', top: 0, zIndex: 1,
            display: 'flex', alignItems: 'center', gap: 12,
            padding: '7px 12px',
            background: 'var(--surface-sunken)',
            borderBottom: '1px solid var(--border)',
          }}>
            <Label style={{ flex: 1, minWidth: 0 }}>Customer</Label>
            <Label style={{
              width: W_THIS, textAlign: 'right',
              color: sortedColumn === 'this_year' ? 'var(--text)' : undefined,
            }}>This year</Label>
            <Label style={{
              width: W_LAST, textAlign: 'right',
              color: sortedColumn === 'last_year' ? 'var(--text)' : undefined,
            }}>Last year</Label>
            <Label style={{
              width: W_CHANGE, textAlign: 'right',
              color: sortedColumn === 'change' ? 'var(--text)' : undefined,
            }}>Change</Label>
            <span style={{ width: W_ACTIONS }} />
          </div>

          <div
            style={{ maxHeight: 520, overflowY: 'auto' }}
            onScroll={(e) => {
              const el = e.currentTarget;
              if (el.scrollHeight - el.scrollTop - el.clientHeight < 80) void fetchMore();
            }}
          >
            {shown.map((r) => {
              const up = Number(r.change) > 0;
              return (
                <div key={r.contact_id} style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '10px 12px', borderBottom: '1px solid var(--border)',
                }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: 13.5, fontWeight: 600, color: 'var(--text)',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {r.company_name ?? 'Unnamed'}
                    </div>
                    <div style={{ fontSize: 11.5, color: 'var(--text-subtle)' }}>
                      {[
                        r.divisions,
                        r.invoices ? `${r.invoices} ${r.invoices === 1 ? 'invoice' : 'invoices'}` : null,
                        ukDate(r.last_billed) ? `last billed ${ukDate(r.last_billed)}` : null,
                        /* THE OPEN PIPELINE SAYS WHAT IT IS WORTH, NOT
                           JUST HOW MANY.

                           From the business: "I sorted by pipeline and
                           can't tell what it's actually sorting as the
                           top customer has 1 lead, the one below it has
                           2, then the one below it has 1."

                           Exactly right, and the sort was not the fault.
                           `personal_customers` orders that option by the
                           open VALUE and the row printed only the COUNT,
                           so the list was in a perfectly good order by a
                           number that was nowhere on the screen. One
                           £90k lead sits above two £4k ones and looks
                           like a bug. The figure being sorted on is now
                           the one printed. */
                        r.open_deals
                          ? `${r.open_deals} open${r.open_value != null
                              ? `, ${compactMoney(Number(r.open_value))}` : ''}`
                          : null,
                      ].filter(Boolean).join(' · ') || 'Nothing billed yet'}
                    </div>
                  </div>

                  <span style={{
                    fontSize: 13, color: 'var(--text)', fontVariantNumeric: 'tabular-nums',
                    width: W_THIS, textAlign: 'right',
                  }}>{compactMoney(Number(r.this_year))}</span>

                  <span style={{
                    fontSize: 12, color: 'var(--text-subtle)', fontVariantNumeric: 'tabular-nums',
                    width: W_LAST, textAlign: 'right',
                  }}>{compactMoney(Number(r.last_year))}</span>

                  <span
                    /* The figure says its own direction: the arrow, the
                       colour and the sign are three readings of one
                       fact, and a change of nought has none of them. */
                    title={Number(r.change) === 0
                      ? 'The same as this point last year'
                      : `${up ? 'Up' : 'Down'} ${compactMoney(Math.abs(Number(r.change)))} on this point last year`}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 4, width: W_CHANGE,
                      justifyContent: 'flex-end',
                      fontSize: 12.5, fontVariantNumeric: 'tabular-nums',
                      color: Number(r.change) === 0 ? 'var(--text-subtle)'
                        : up ? 'var(--success)' : 'var(--danger)',
                    }}>
                    {Number(r.change) !== 0 && (up ? <TrendingUp size={12} /> : <TrendingDown size={12} />)}
                    {Number(r.change) === 0 ? compactMoney(0)
                      : `${up ? '+' : '\u2212'}${compactMoney(Math.abs(Number(r.change)))}`}
                    {r.change_pct != null && <span>({Math.abs(Number(r.change_pct))}%)</span>}
                  </span>

                  <span style={{ width: W_ACTIONS, display: 'flex', justifyContent: 'flex-end' }}>
                    <Button size="sm" variant="ghost"
                      title={`Set a reminder about ${r.company_name ?? 'this customer'}`}
                      onClick={() => setRemind(r)}>
                      <Bell size={13} />
                    </Button>
                    <Button size="sm" variant="ghost"
                      title="Break their revenue down, and compare them with somebody else"
                      onClick={() => { setOpen(r); setAgainst(''); }}>
                      <ArrowRight size={13} />
                    </Button>
                  </span>
                </div>
              );
            })}
          </div>

          <div style={{
            padding: '9px 12px', fontSize: 12, color: 'var(--text-subtle)',
            display: 'flex', alignItems: 'center', gap: 10,
          }}>
            <span>
              Showing {shown.length} of {total}
              {find.trim() ? ` matching, from ${rows.length} loaded` : ''}
            </span>
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
