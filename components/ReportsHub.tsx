'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft, FileText, Loader, Printer, RefreshCw, SlidersHorizontal, AlertTriangle,
  Search, CalendarRange, Building2, GitBranch, Wrench, Play, Layers, Filter, X, Star,
} from 'lucide-react';
import { Alert, Button, Card, Chip, Label, PageHead, SearchInput } from '@/components/kit/primitives';
import { ReportView } from '@/components/reports/ReportView';
import {
  CATEGORY_LABEL, REPORTS, reportBySlug, reportsByCategory,
  type ReportCategory, type ReportDef,
} from '@/lib/reports/catalogue';
import { defaultFilters, docxHref, printHref } from '@/lib/reports/link';
import {
  DIVISION_LABEL, PERIOD_LABEL,
  type Division, type Period, type Report, type ReportFilters,
} from '@/lib/reports/types';

/* =============================================================
   The Reports screen.

   From the business:

     Add a reports tab ... Categorise the report types. Have options when
     running reports to include/exclude divisions and data types ... easy
     to present, quickly runnable.

   "Quickly runnable" is the requirement that shaped this. A report you
   have to configure before you can see it is a form, and a form before a
   meeting is why nobody runs the report. So:

     picking a report runs it, immediately, on sensible defaults
     changing a filter re-runs it, without a Run button to find
     the paper copy is one press away and needs no second screen

   The filters sit above the report rather than beside it, because a
   report is read at full width and a sidebar of switches steals a
   quarter of it for something touched once.
   ============================================================= */

type Person = { id: string; full_name: string | null; email: string | null };

const DIVISIONS: Division[] = ['stc', 'trailer', 'rental'];
const PERIODS: Period[] = ['week', 'fortnight', 'month', 'quarter', 'fy', 'year'];

export function ReportsHub({ people, mayExport, initial = null }: {
  people: Person[];
  mayExport: boolean;
  /**
   * A report named in the address, so the command bar can land on one.
   *
   * Typing "top customers" has to open the top customers report, not the
   * screen it lives on. An entry per report was the whole reason the
   * command bar was rebuilt, and a hub that ignored the parameter would
   * answer nine different sentences with the same page.
   */
  initial?: string | null;
}) {
  const [slug, setSlug] = useState<string | null>(initial);
  const [filters, setFilters] = useState<ReportFilters>(defaultFilters);
  const [report, setReport] = useState<Report | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(true);

  const def = slug ? reportBySlug(slug) : null;

  /* Every run is numbered, so a slow one that finishes after a faster
     one cannot overwrite it. Changing three chips quickly is three
     requests, and without this the report on screen is whichever server
     answered last rather than whichever was asked last. */
  const runNo = useRef(0);

  const run = useCallback(async (forSlug: string, f: ReportFilters) => {
    const mine = ++runNo.current;
    setBusy(true);
    setFailed(null);
    try {
      const res = await fetch('/api/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: forSlug, ...f }),
      });
      const body = await res.json();
      if (mine !== runNo.current) return;
      if (!res.ok) {
        setFailed(body?.message || body?.error || 'The report could not be run.');
        setReport(null);
        return;
      }
      setReport(body as Report);
    } catch {
      if (mine !== runNo.current) return;
      setFailed('The report could not be reached. Check the connection and try again.');
      setReport(null);
    } finally {
      if (mine === runNo.current) setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (!slug) return;
    run(slug, filters);
  }, [slug, filters, run]);

  function open(d: ReportDef) {
    /* Filters reset with the report. A person filter left over from
       "Dean's won leads" silently narrowing the next report is the kind
       of wrong that gets presented in a meeting. */
    setReport(null);
    setFilters(defaultFilters());
    setSlug(d.slug);
  }

  function back() {
    setSlug(null);
    setReport(null);
    setFailed(null);
  }

  if (!def) return <Catalogue onOpen={open} />;

  return (
    <div>
      <PageHead
        eyebrow="Reports"
        title={def.title}
        sub={def.blurb}
        action={(
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Button variant="secondary" onClick={back}>
              <ArrowLeft size={14} /> All reports
            </Button>
            <Button variant="secondary" onClick={() => setShowFilters((s) => !s)}>
              <SlidersHorizontal size={14} /> {showFilters ? 'Hide options' : 'Options'}
            </Button>
            <Button variant="secondary" onClick={() => run(def.slug, filters)} disabled={busy}>
              {busy ? <Loader size={14} className="spin" /> : <RefreshCw size={14} />} Refresh
            </Button>
            {mayExport && (
              <>
                <Button
                  variant="secondary"
                  onClick={() => window.open(docxHref(def.slug, filters), '_blank')}
                  disabled={busy || !report}
                >
                  <FileText size={14} /> Word
                </Button>
                <Button
                  variant="accent"
                  onClick={() => window.open(printHref(def.slug, filters), '_blank')}
                  disabled={busy || !report}
                >
                  <Printer size={14} /> Print or PDF
                </Button>
              </>
            )}
          </div>
        )}
      />

      {showFilters && (
        <Options
          def={def}
          filters={filters}
          people={people}
          onChange={setFilters}
        />
      )}

      {failed && (
        <div style={{ marginTop: 16 }}>
          <Alert tone="danger">
            <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>{failed}</span>
          </Alert>
        </div>
      )}

      <div style={{ marginTop: 18, position: 'relative', minHeight: 220 }}>
        {busy && !report && <Waiting />}
        {report && (
          <div style={{ opacity: busy ? 0.55 : 1, transition: 'opacity 140ms ease' }}>
            <Card>
              <ReportView report={report} />
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}

/* =============================================================
   The hub, built to the reports reference.

   `STCUIReports.html`, section one: "Reports hub shell. The landing
   screen. A saved-report library on the left, the run queue on the
   right, and everything answers one question: is my export ready."

   Recreated rather than lifted, as the design system's own handoff
   note requires: this is React and Tailwind-era CSS variables, not the
   prototype's markup. Every value below is the reference's own, read
   off the rendered page rather than guessed:

     the shell        1px border, r-md, overflow hidden, --bg behind
     the header band  --surface, 16px 20px, Panton 800 at 21px
     the left rail    196px, --surface, 31px rows, 9.5px 0.18em labels
     the table        34px head on --bg-subtle, 36px rows, 1px rules
     the right rail   250px, --surface, bordered cards at r

   ---- Three places it does not follow the reference, and why ----

   Each of these is the reference describing something this product does
   not have. Drawing it anyway would put a lie on the screen.

   1. NO RUN QUEUE. The reference's third column watches long exports
      finish, because that is "the commonest question on this screen".
      Our reports are built and returned in one request; there is
      nothing to queue and nothing to wait for. So the third column
      holds the one thing that genuinely belongs at the side of this
      screen: the agenda of the meeting report, which is what somebody
      walking into a meeting wants to see.

   2. NO Schedule OR New report BUTTON. Neither exists yet. A header
      button that opens nothing is worse than a bare header.

   3. NO Format COLUMN. Every report here exports as both a PDF and a
      Word document, so a format chip would say the same thing on every
      row. The column carries the section count instead, which is the
      thing that actually differs.

   The export buttons on the report itself are untouched, per the
   instruction: they already match how every other screen exports.
   ============================================================= */

const CATEGORY_ICON: Record<ReportCategory, typeof CalendarRange> = {
  meeting: CalendarRange,
  customers: Building2,
  pipeline: GitBranch,
  operations: Wrench,
};

/** The one pinned to the top of the list and shown in the side rail. */
const FEATURED = 'biweekly';

function Catalogue({ onOpen }: { onOpen: (d: ReportDef) => void }) {
  const [only, setOnly] = useState<ReportCategory | null>(null);
  const [term, setTerm] = useState('');

  const featured = useMemo(() => reportBySlug(FEATURED), []);

  /* Everything a report is about, as one string. A report is found by
     what is IN it as much as by its name: somebody looking for the
     FleetSmart+ numbers has no reason to know they live inside the
     meeting pack. */
  const matches = useCallback((r: ReportDef) => {
    const q = term.trim().toLowerCase();
    if (!q) return true;
    const hay = [r.title, r.blurb, CATEGORY_LABEL[r.category], ...r.sections.map((s) => s.label)]
      .join(' ').toLowerCase();
    return q.split(/\s+/).every((word) => hay.includes(word));
  }, [term]);

  /* One flat list, ordered by category so the rail and the table agree,
     with the meeting report first wherever it appears. The reference's
     table is one list with a starred row at the top, not a set of
     grouped sections. */
  const rows = useMemo(() => reportsByCategory()
    .flatMap((g) => g.reports)
    .filter((r) => matches(r) && (!only || r.category === only))
    .sort((a, b) => (a.slug === FEATURED ? -1 : b.slug === FEATURED ? 1 : 0)),
  [matches, only]);

  const counts = useMemo(() => {
    const by = new Map<ReportCategory, number>();
    for (const r of REPORTS) by.set(r.category, (by.get(r.category) ?? 0) + 1);
    return by;
  }, []);

  return (
    /* No width cap. From the business, looking at it in the app:

         I feel like it's been plopped on the page rather than designed
         around our actual app, there's a lot of blank space on the
         right. If you simply extend the middle column out more so the
         page fits though it'll make the rows feel too long. The whole
         shell just needs expanding to suit our actual page size.

       Both halves of that are right, and the second is the harder one.
       A capped shell floating in a 1600px content area reads as a
       component borrowed from somewhere else. Stretching only the
       middle gives a report name at the far left and its Run button
       two feet away, with nothing in between.
    
       So the width is spent on all three columns AND on a column that
       did not exist: what the report answers. That sentence was always
       in the catalogue and there was nowhere to put it. Now the extra
       width carries information rather than air, and the row still
       reads as one thing because the eye never crosses an empty gap. */
    <div>
      <div style={{
        border: '1px solid var(--border)', borderRadius: 'var(--r-md)',
        overflow: 'hidden', background: 'var(--bg)',
      }}>
        {/* ---- header band ---- */}
        <div style={{
          background: 'var(--surface)', borderBottom: '1px solid var(--border)',
          padding: '16px 20px', display: 'flex', alignItems: 'flex-start',
          justifyContent: 'space-between', gap: 16,
        }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <h1 style={{
              margin: 0, fontFamily: 'var(--panton)', fontWeight: 800, fontSize: 21,
              letterSpacing: '-0.03em', color: 'var(--text)',
            }}>Reports</h1>
            <span style={{ fontSize: 12.5, color: 'var(--text-subtle)' }}>
              {REPORTS.length} reports · {counts.size} categories · every one runs on the spot
            </span>
          </div>
        </div>

        <div className="reports-body" style={{ display: 'flex', minHeight: 330 }}>
          <Rail only={only} setOnly={setOnly} counts={counts} />

          {/* ---- the list ---- */}
          <div style={{
            flex: 1, minWidth: 0, padding: '16px 18px',
            display: 'flex', flexDirection: 'column', gap: 14,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
              <div style={{
                display: 'flex', alignItems: 'center', height: 28, width: 220,
                background: 'var(--surface)', border: '1px solid var(--border-strong)',
                borderRadius: 'var(--r)',
              }}>
                <span style={{ display: 'flex', alignItems: 'center', paddingLeft: 10, color: 'var(--text-subtle)' }}>
                  <Search size={14} />
                </span>
                <input
                  value={term}
                  onChange={(e) => setTerm(e.target.value)}
                  placeholder="Search reports"
                  style={{
                    flex: 1, minWidth: 0, height: '100%', padding: '0 10px 0 2px',
                    background: 'transparent', color: 'var(--text)', border: 0, outline: 0,
                    fontFamily: 'var(--inter)', fontSize: 12, letterSpacing: '-0.01em',
                  }}
                />
              </div>

              {/* The reference's filter pill with its count. Drawn only
                  when a filter is on, because a pill reading "0" is a
                  control that says nothing. */}
              {only && (
                <button
                  onClick={() => setOnly(null)}
                  title="Show every report again"
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6, height: 28,
                    padding: '0 10px', background: 'var(--bg-subtle)',
                    border: '1px solid var(--border-strong)', borderRadius: 'var(--r)',
                    color: 'var(--text)', fontFamily: 'var(--inter)',
                    fontSize: 12, fontWeight: 600, cursor: 'pointer',
                  }}
                >
                  <Filter size={13} />
                  {CATEGORY_LABEL[only]}
                  <X size={12} style={{ color: 'var(--text-subtle)' }} />
                </button>
              )}

              <span style={{ flex: 1 }} />
              <span style={{ fontSize: 11.5, color: 'var(--text-subtle)' }}>
                {term.trim() ? `${rows.length} of ${REPORTS.length}` : 'Sorted by category'}
              </span>
            </div>

            <div style={{
              border: '1px solid var(--border)', borderRadius: 'var(--r-md)',
              overflow: 'hidden', background: 'var(--surface)',
            }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    {/* Every fixed width here is as narrow as its
                        content allows, so the answers column gets the
                        rest. Measured rather than chosen: at the app's
                        real content width the longest blurb has to fit
                        without an ellipsis, because a sentence cut off
                        on the widest possible screen reads as a fault
                        rather than as a summary. */}
                    <Th width={210}>Report</Th>
                    <Th className="reports-answers">What it answers</Th>
                    <Th width={150}>Category</Th>
                    <Th width={78} align="right">Sections</Th>
                    <Th width={84}>{''}</Th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, at) => (
                    <ReportRow
                      key={r.slug}
                      def={r}
                      pinned={r.slug === FEATURED}
                      last={at === rows.length - 1}
                      onOpen={onOpen}
                    />
                  ))}
                </tbody>
              </table>

              {rows.length === 0 && (
                <div style={{
                  padding: '26px 14px', textAlign: 'center',
                  fontSize: 12.5, color: 'var(--text-subtle)',
                }}>
                  Nothing matches that. Try a customer word like spend or growth, or a part of
                  the business like stock, pipeline or complaints.
                </div>
              )}
            </div>
          </div>

          {featured && <Agenda def={featured} onOpen={onOpen} />}
        </div>
      </div>

      {/* The reference carries a line of commentary under the shell
          explaining what the three columns are for. That is a note to
          whoever builds it, not copy for whoever uses it, and it is
          wrong the moment the rails stand down on a narrow screen. */}

      {/* The rails stand down one at a time, widest first. The agenda
          is the one you can lose without losing the screen: the meeting
          report is still the pinned first row of the table. The list is
          what somebody came for, so the list is what survives. */}
      <style>{`
        /* The answers column goes first, and it goes early. Below the
           width where it can hold a whole sentence, every row of it ends
           in an ellipsis, and a column that is truncated on all nine
           rows carries no information: it is noise with a heading on it.
           1600 is where the longest blurb stops fitting, measured rather
           than picked. */
        @media (max-width: 1599px) { .reports-answers { display: none !important; } }
        @media (max-width: 1240px) { .reports-agenda { display: none !important; } }
        @media (max-width: 940px) {
          .reports-body { display: block !important; }
          .reports-rail { display: none !important; }
        }
      `}</style>
    </div>
  );
}

function Th({ children, align = 'left', width, className }: {
  children: React.ReactNode; align?: 'left' | 'right'; width?: number; className?: string;
}) {
  return (
    <th className={className} style={{
      textAlign: align, padding: '0 12px', height: 34,
      background: 'var(--bg-subtle)', borderBottom: '1px solid var(--border)',
      fontFamily: 'var(--panton)', fontWeight: 700, fontSize: 10.5,
      letterSpacing: '0.13em', textTransform: 'uppercase',
      color: 'var(--text-subtle)', whiteSpace: 'nowrap', width,
    }}>{children}</th>
  );
}

/* =============================================================
   The library rail.

   The reference's own shape: a heading in 9.5px Panton at 0.18em, rows
   at 31px, a monospaced count on the right, and the selected row
   carrying a 2px accent bar down its left edge rather than a fill.
   ============================================================= */
function Rail({ only, setOnly, counts }: {
  only: ReportCategory | null;
  setOnly: (c: ReportCategory | null) => void;
  counts: Map<ReportCategory, number>;
}) {
  const row = (
    key: ReportCategory | null,
    label: string,
    count: number,
    Icon: typeof Layers,
    tall: boolean,
  ) => {
    const on = only === key;
    return (
      <button
        key={label}
        onClick={() => setOnly(key)}
        aria-pressed={on}
        style={{
          position: 'relative', display: 'flex', alignItems: 'center', gap: 10,
          width: '100%', height: tall ? 31 : 29, padding: '0 10px', textAlign: 'left',
          border: 0, borderRadius: 'var(--r)',
          background: on ? 'var(--bg-subtle)' : 'transparent',
          color: on ? 'var(--text)' : 'var(--text-muted)',
          fontFamily: 'var(--inter)', fontSize: 12.5, fontWeight: on ? 600 : 500,
          cursor: 'pointer',
        }}
      >
        {on && (
          <span style={{
            position: 'absolute', left: 0, top: 6, bottom: 6, width: 2,
            borderRadius: 1, background: 'var(--accent)',
          }} />
        )}
        <span style={{ display: 'flex', color: on ? 'var(--accent)' : 'var(--text-subtle)' }}>
          <Icon size={15} />
        </span>
        <span style={{
          flex: 1, minWidth: 0, whiteSpace: 'nowrap',
          overflow: 'hidden', textOverflow: 'ellipsis',
        }}>{label}</span>
        <span style={{ fontFamily: 'var(--mono)', fontSize: 10.5, color: 'var(--text-subtle)' }}>
          {count}
        </span>
      </button>
    );
  };

  const heading = (text: string, first = false) => (
    <span style={{
      display: 'block', padding: first ? '8px 10px 5px' : '14px 10px 5px',
      fontFamily: 'var(--panton)', fontWeight: 700, fontSize: 9.5,
      letterSpacing: '0.18em', color: 'var(--text-subtle)',
    }}>{text}</span>
  );

  return (
    <nav className="reports-rail" style={{
      flex: 'none', width: 220, background: 'var(--surface)',
      borderRight: '1px solid var(--border)', padding: '10px 8px',
      display: 'flex', flexDirection: 'column', gap: 1,
    }}>
      {heading('LIBRARY', true)}
      {row(null, 'All reports', REPORTS.length, Layers, true)}
      {heading('BY CATEGORY')}
      {(['meeting', 'customers', 'pipeline', 'operations'] as ReportCategory[]).map((c) =>
        row(c, CATEGORY_LABEL[c], counts.get(c) ?? 0, CATEGORY_ICON[c], false))}
    </nav>
  );
}

/* =============================================================
   What the third column holds instead of a run queue.

   The reference watches long exports finish. Nothing here takes long
   enough to watch, so the column carries the meeting agenda: the ten
   sections of the bi-weekly report, in the order the meeting takes
   them. It is the same information the queue was giving, one step
   earlier: not "is it ready" but "what is on it".
   ============================================================= */
function Agenda({ def, onOpen }: { def: ReportDef; onOpen: (d: ReportDef) => void }) {
  return (
    <aside className="reports-agenda" style={{
      flex: 'none', width: 300, background: 'var(--surface)',
      borderLeft: '1px solid var(--border)', padding: 16,
      display: 'flex', flexDirection: 'column', gap: 12,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontFamily: 'var(--panton)', fontWeight: 700, fontSize: 12.5, color: 'var(--text)' }}>
          On the agenda
        </span>
        <span style={{
          display: 'inline-flex', alignItems: 'center', height: 20, padding: '0 8px',
          background: 'rgba(9, 22, 58, 0.08)', color: 'var(--primary)',
          border: '1px solid transparent', borderRadius: 'var(--r-sm)',
          fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap',
        }}>{def.sections.length} sections</span>
      </div>

      <div style={{
        border: '1px solid var(--border)', borderRadius: 'var(--r)',
        padding: '11px 12px', display: 'flex', flexDirection: 'column', gap: 9,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <span style={{ color: 'var(--accent)', display: 'flex' }}><CalendarRange size={14} /></span>
          <span style={{ flex: 1, fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>
            {def.title}
          </span>
        </div>
        <span style={{ fontSize: 10.5, color: 'var(--text-subtle)', lineHeight: 1.45 }}>
          Reds and ambers open it, because nothing else matters if a customer is walking. The
          diary closes it.
        </span>
        <Button variant="accent" size="sm" onClick={() => onOpen(def)} style={{ width: '100%' }}>
          <Play size={13} /> Run it
        </Button>
      </div>

      <ol style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column' }}>
        {def.sections.map((s, at) => (
          <li key={s.id} style={{
            display: 'flex', alignItems: 'baseline', gap: 8, padding: '4px 0',
            borderTop: at === 0 ? 'none' : '1px solid var(--border)',
          }}>
            <span style={{
              fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text-subtle)',
              minWidth: 14, textAlign: 'right',
            }}>{at + 1}</span>
            <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{s.label}</span>
          </li>
        ))}
      </ol>

      <div style={{ paddingTop: 11, borderTop: '1px solid var(--border)' }}>
        <span style={{ fontSize: 11, color: 'var(--text-subtle)', lineHeight: 1.45 }}>
          PDF and Word come off the report itself. Nothing is stored, so run it again whenever.
        </span>
      </div>
    </aside>
  );
}

/* One report, as a row in the reference's table. */
function ReportRow({ def, pinned, last, onOpen }: {
  def: ReportDef;
  /** The meeting report, marked the way the reference marks its first row. */
  pinned: boolean;
  last: boolean;
  onOpen: (d: ReportDef) => void;
}) {
  const [over, setOver] = useState(false);
  const cell = {
    padding: '0 12px', height: 36,
    borderBottom: last ? 'none' : '1px solid var(--border)',
    fontSize: 12.5, whiteSpace: 'nowrap' as const,
  };

  return (
    <tr
      onMouseEnter={() => setOver(true)}
      onMouseLeave={() => setOver(false)}
      style={{ background: over ? 'var(--bg-subtle)' : 'transparent' }}
    >
      <td style={{ ...cell, color: 'var(--text)', fontWeight: 600 }}>
        <button
          onClick={() => onOpen(def)}
          title={def.blurb}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 9,
            border: 0, background: 'transparent', padding: 0, cursor: 'pointer',
            fontFamily: 'var(--inter)', fontSize: 12.5, fontWeight: 600, color: 'var(--text)',
          }}
        >
          {pinned && (
            <span style={{ color: 'var(--accent)', display: 'flex' }} title="Pinned">
              <Star size={13} />
            </span>
          )}
          {def.title}
        </button>
      </td>
      {/* The one thing the reference's table had no room for and this
          page does. It is the sentence the catalogue has always carried,
          and it is what somebody actually chooses a report by: not its
          name, which they may never have read, but the question it
          answers. Truncated with the full text on hover only when the
          window is too narrow to hold it. */}
      <td
        className="reports-answers"
        title={def.blurb}
        style={{
          ...cell, color: 'var(--text-muted)',
          overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 0,
        }}
      >{def.blurb}</td>
      <td style={{ ...cell, color: 'var(--text-subtle)' }}>{CATEGORY_LABEL[def.category]}</td>
      <td style={{ ...cell, textAlign: 'right', color: 'var(--text-subtle)', fontFamily: 'var(--mono)', fontSize: 11.5 }}>
        {def.sections.length}
      </td>
      <td style={{ ...cell, textAlign: 'right' }}>
        <Button variant="secondary" size="sm" onClick={() => onOpen(def)}>Run</Button>
      </td>
    </tr>
  );
}

/* =============================================================
   The options.

   Only the ones that mean something for this report are drawn. A person
   filter on the stock report would be a control that changes nothing,
   and a control that changes nothing is read as a broken one.
   ============================================================= */
function Options({
  def, filters, people, onChange,
}: {
  def: ReportDef;
  filters: ReportFilters;
  people: Person[];
  onChange: (f: ReportFilters) => void;
}) {
  const set = (patch: Partial<ReportFilters>) => onChange({ ...filters, ...patch });

  const toggleDivision = (d: Division) => {
    const on = filters.divisions.includes(d);
    set({ divisions: on ? filters.divisions.filter((x) => x !== d) : [...filters.divisions, d] });
  };

  const toggleSection = (id: string) => {
    const off = filters.exclude.includes(id);
    set({ exclude: off ? filters.exclude.filter((x) => x !== id) : [...filters.exclude, id] });
  };

  return (
    <Card>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {def.uses.divisions && (
          <Field
            label="Divisions"
            hint="None picked means all three."
          >
            {DIVISIONS.map((d) => (
              <Chip
                key={d}
                active={filters.divisions.length === 0 || filters.divisions.includes(d)}
                onClick={() => toggleDivision(d)}
              >{DIVISION_LABEL[d]}</Chip>
            ))}
          </Field>
        )}

        {def.uses.period && (
          <Field label="Period">
            {PERIODS.map((p) => (
              <Chip key={p} active={filters.period === p} onClick={() => set({ period: p })}>
                {PERIOD_LABEL[p]}
              </Chip>
            ))}
          </Field>
        )}

        {def.uses.person && people.length > 0 && (
          <Field label="Whose">
            <Chip active={!filters.person} onClick={() => set({ person: null })}>Everybody</Chip>
            {people.map((p) => (
              <Chip
                key={p.id}
                active={filters.person === p.id}
                onClick={() => set({ person: p.id })}
              >{p.full_name || p.email || 'Unnamed'}</Chip>
            ))}
          </Field>
        )}

        <Field
          label="Sections"
          hint="Switch one off to leave it out of the report and out of the export."
        >
          {def.sections.map((s) => (
            <Chip
              key={s.id}
              active={!filters.exclude.includes(s.id)}
              onClick={() => toggleSection(s.id)}
            >{s.label}</Chip>
          ))}
        </Field>
      </div>
    </Card>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 9, marginBottom: 7 }}>
        <Label>{label}</Label>
        {hint && <span style={{ fontSize: 11.5, color: 'var(--text-subtle)' }}>{hint}</span>}
      </div>
      <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>{children}</div>
    </div>
  );
}

function Waiting() {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '26px 0', color: 'var(--text-muted)', fontSize: 13,
    }}>
      <Loader size={15} className="spin" /> Reading the figures.
    </div>
  );
}
