'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft, FileText, Loader, Printer, RefreshCw, SlidersHorizontal, AlertTriangle,
  Search, CalendarRange, Building2, GitBranch, Wrench, Play, Layers,
} from 'lucide-react';
import { Alert, Button, Card, Chip, Label, PageHead, SearchInput } from '@/components/kit/primitives';
import { ReportView } from '@/components/reports/ReportView';
import {
  CATEGORY_BLURB, CATEGORY_LABEL, REPORTS, reportBySlug, reportsByCategory,
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
   Picking one.

   From the business, having seen the first version:

     now re-style the reports landing page as it's just cards everywhere
     and not much like a reports hub

   They are right, and the fix is the kit's third rule rather than a
   different card. NINE THINGS IN A GRID OF BOXES IS A GALLERY. A hub is
   an index: you arrive knowing roughly what you want, you find its name,
   you open it. A gallery makes you read every tile because each one is
   the same size and weight as the last, and none of them tells you where
   you are.

   So three things changed and none of them is decoration:

     1. A RAIL, so the page says what kinds of report exist before you
        read a single title, and clicking one narrows the list rather
        than scrolling you to it.
     2. THE MEETING REPORT IS FEATURED, once, at the top. It is the one
        the business asked for by name and the one that will be run
        fortnightly forever. Nine peers in a grid gave it exactly the
        same weight as "Bottom 10 customers".
     3. THE REST ARE ROWS, separated by 1px rules rather than boxed.
        "Borders before shadows", and it is the difference between
        scanning nine names in one movement and reading nine cards.

   A search box, because nine becomes fifteen and a rail alone does not
   survive that. It matches the title, the blurb and the section names,
   so typing "fleetsmart" finds the meeting report because FleetSmart+ is
   a section of it.
   ============================================================= */

const CATEGORY_ICON: Record<ReportCategory, typeof CalendarRange> = {
  meeting: CalendarRange,
  customers: Building2,
  pipeline: GitBranch,
  operations: Wrench,
};

/** The one that gets the top of the page. */
const FEATURED = 'biweekly';

function Catalogue({ onOpen }: { onOpen: (d: ReportDef) => void }) {
  const [only, setOnly] = useState<ReportCategory | null>(null);
  const [term, setTerm] = useState('');

  const featured = useMemo(() => reportBySlug(FEATURED), []);

  /* Everything the report is about, as one string. A report is found by
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

  const searching = term.trim().length > 0;

  /* ---- Featured, or in the list, and never neither ----

     This condition had `matches(featured)` in it and that was a bug the
     screenshot found before anybody else could: typing "fleetsmart"
     matched the meeting report through its section names, so the flag
     said "it is featured at the top", the list dropped it as a
     duplicate, and the panel itself was suppressed because a search was
     running. The report vanished, and so did the "nothing matches" line,
     because that was keyed on the same flag. A blank page.

     So the flag now says one thing only: is the panel actually drawn.
     While a search is running it is not, and the report is therefore in
     the list where the search can find it. */
  const showFeatured = !searching && Boolean(featured) && (!only || only === 'meeting');

  /* The featured report comes out of the list below it.
     Listing it twice reads as a bug rather than as emphasis, and the
     row said "Above" to explain itself, which is a label apologising
     for a layout. While a search is running there is no featured panel,
     so it goes back into the list where it can be found. */
  const groups = useMemo(() => reportsByCategory()
    .map((g) => ({
      ...g,
      reports: g.reports.filter((r) => matches(r) && !(showFeatured && r.slug === FEATURED)),
    }))
    .filter((g) => g.reports.length > 0 && (!only || g.category === only)),
  [matches, only, showFeatured]);
  const found = groups.reduce((n, g) => n + g.reports.length, 0);

  return (
    /* The heading is capped to the same measure as the list under it, so
       the search box sits over the rows it filters rather than out at
       the window edge with a screen of nothing between them. */
    <div style={{ maxWidth: 1154 }}>
      <PageHead
        eyebrow="Workspace"
        title="Reports"
        sub="Pick one and it runs. Narrow it by division, period or person once it is open."
        action={(
          <div style={{ display: 'flex', width: 260 }}>
            <SearchInput
              value={term}
              onChange={setTerm}
              placeholder="Find a report"
              icon={<Search size={14} />}
            />
          </div>
        )}
      />

      <div className="reports-hub" style={{ display: 'flex', gap: 28, alignItems: 'flex-start' }}>
        <Rail only={only} setOnly={setOnly} />

        {/* Capped rather than filling the window. A row 1900px wide puts
            the chevron a screen away from the title it belongs to, and
            the eye has to travel the whole width to pair them up. The
            kit's own reading measure does the same job everywhere else. */}
        <div style={{
          flex: 1, minWidth: 0, maxWidth: 940,
          display: 'flex', flexDirection: 'column', gap: 30,
        }}>
          {showFeatured && <Featured def={featured!} onOpen={onOpen} />}

          {groups.map((g) => (
            <section key={g.category}>
              <div style={{
                display: 'flex', alignItems: 'baseline', gap: 12,
                paddingBottom: 8, borderBottom: '2px solid var(--border-emphasis)',
              }}>
                <span style={{
                  fontFamily: 'var(--panton)', fontWeight: 800, fontSize: 13,
                  letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--text)',
                }}>{CATEGORY_LABEL[g.category]}</span>
                {/* Beside the heading it counts, not pinned to the far
                    right of the page where it reads as a stray digit
                    belonging to nothing. */}
                <span style={{
                  fontFamily: 'var(--panton)', fontWeight: 700, fontSize: 11.5,
                  fontVariantNumeric: 'tabular-nums', color: 'var(--text-subtle)',
                }}>{g.reports.length}</span>
                <span style={{ fontSize: 12, color: 'var(--text-subtle)', flex: 1 }}>
                  {CATEGORY_BLURB[g.category]}
                </span>
              </div>

              <div>
                {g.reports.map((r, at) => (
                  <ReportRow key={r.slug} def={r} first={at === 0} onOpen={onOpen} />
                ))}
              </div>
            </section>
          ))}

          {found === 0 && !showFeatured && (
            <div style={{
              padding: '30px 0', borderTop: '1px solid var(--border)',
              fontSize: 13, color: 'var(--text-muted)',
            }}>
              Nothing matches &ldquo;{term.trim()}&rdquo;. Try a customer word like spend or growth,
              or a part of the business like stock, pipeline or complaints.
            </div>
          )}
        </div>
      </div>

      {/* The rail is a second column until there is no room for one, and
          then it is nothing: on a narrow screen the categories are three
          taps away from the list they filter, which is worse than
          scrolling past nine names. */}
      <style>{`
        @media (max-width: 900px) {
          .reports-hub { display: block !important; }
          .reports-rail { display: none !important; }
        }
      `}</style>
    </div>
  );
}

/* The kinds of report there are, before anybody has read a title. */
function Rail({ only, setOnly }: {
  only: ReportCategory | null;
  setOnly: (c: ReportCategory | null) => void;
}) {
  const counts = useMemo(() => {
    const by = new Map<ReportCategory, number>();
    for (const r of REPORTS) by.set(r.category, (by.get(r.category) ?? 0) + 1);
    return by;
  }, []);

  const row = (
    key: ReportCategory | null,
    label: string,
    count: number,
    Icon: typeof Layers,
  ) => {
    const on = only === key;
    return (
      <button
        key={label}
        onClick={() => setOnly(key)}
        aria-pressed={on}
        style={{
          display: 'flex', alignItems: 'center', gap: 9, width: '100%',
          height: 32, padding: '0 10px 0 11px', textAlign: 'left',
          border: 'none', borderLeft: `2px solid ${on ? 'var(--accent)' : 'var(--border)'}`,
          background: on ? 'var(--bg-subtle)' : 'transparent',
          color: on ? 'var(--text)' : 'var(--text-muted)',
          fontFamily: 'var(--inter)', fontSize: 12.5, fontWeight: on ? 600 : 500,
          cursor: 'pointer',
        }}
      >
        <Icon size={13} style={{ flex: 'none', color: on ? 'var(--accent)' : 'var(--text-subtle)' }} />
        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {label}
        </span>
        <span style={{
          fontFamily: 'var(--panton)', fontWeight: 700, fontSize: 11,
          fontVariantNumeric: 'tabular-nums', color: 'var(--text-subtle)',
        }}>{count}</span>
      </button>
    );
  };

  return (
    <nav className="reports-rail" style={{
      position: 'sticky', top: 8, flex: 'none', width: 186,
      display: 'flex', flexDirection: 'column', gap: 1,
    }}>
      <div style={{ padding: '0 0 9px 11px' }}>
        <Label>What kind</Label>
      </div>
      {row(null, 'Everything', REPORTS.length, Layers)}
      {(['meeting', 'customers', 'pipeline', 'operations'] as ReportCategory[]).map((c) =>
        row(c, CATEGORY_LABEL[c], counts.get(c) ?? 0, CATEGORY_ICON[c]))}
    </nav>
  );
}

/* =============================================================
   The meeting report, given the top of the page.

   It is not a bigger card. It is the only thing on the screen that
   states its contents, because that is what somebody about to walk into
   a meeting wants to know: what will be on the paper. The ten section
   names are the answer, and they are also the thing you switch off once
   you are inside.
   ============================================================= */
function Featured({ def, onOpen }: { def: ReportDef; onOpen: (d: ReportDef) => void }) {
  return (
    <section style={{
      border: '1px solid var(--border-strong)', borderRadius: 'var(--r-md)',
      borderLeft: '3px solid var(--accent)', background: 'var(--surface)',
      padding: '16px 18px 17px',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 260 }}>
          <Label>Run it before every meeting</Label>
          <h2 style={{
            margin: '6px 0 0', fontFamily: 'var(--panton)', fontWeight: 800, fontSize: 22,
            letterSpacing: '-0.03em', lineHeight: 1.15, color: 'var(--text)',
          }}>{def.title}</h2>
          <p style={{
            margin: '5px 0 0', fontSize: 13, color: 'var(--text-muted)',
            lineHeight: 1.55, maxWidth: '62ch',
          }}>
            {def.blurb} Reds and ambers open it, because nothing else matters if a
            customer is walking, and the diary closes it.
          </p>
        </div>
        <Button variant="accent" onClick={() => onOpen(def)}>
          <Play size={14} /> Run it
        </Button>
      </div>

      <div style={{
        display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 13,
        paddingTop: 12, borderTop: '1px solid var(--border)',
      }}>
        {def.sections.map((s, at) => (
          <span key={s.id} style={{
            display: 'inline-flex', alignItems: 'center', gap: 5,
            height: 22, padding: '0 8px', borderRadius: 'var(--r)',
            background: 'var(--surface-sunken)', border: '1px solid var(--border)',
            fontFamily: 'var(--inter)', fontSize: 11.5, color: 'var(--text-muted)',
          }}>
            <span style={{
              fontFamily: 'var(--panton)', fontWeight: 700, fontSize: 10,
              fontVariantNumeric: 'tabular-nums', color: 'var(--text-subtle)',
            }}>{at + 1}</span>
            {s.label}
          </span>
        ))}
      </div>
    </section>
  );
}

/* =============================================================
   One report, as a row you can run.

   From the business:

     my issue is only the top one looks like a report. The rest don't as
     there's no run buttons

   The row was a link wearing a chevron, and a chevron says "there is
   more of this somewhere" rather than "this produces a document". Every
   row now carries the same verb the featured panel does, so the list
   reads as nine things you run rather than nine things you navigate to.

   ---- Why the Run buttons are not red ----

   The kit's first rule: red is the single most important action on a
   screen, and three red buttons means none. Nine of them means the
   featured report stops standing out at all, and the one report the
   business runs fortnightly is the one that has to.

   So the featured panel keeps the accent and says "Run it"; the rows
   are secondary and say "Run". Same verb, same weight of meaning,
   different weight on the page.

   ---- Why the row is a div and the buttons are buttons ----

   A button inside a button is invalid, and the row needs two things to
   click: the title, because people click titles, and Run, because the
   business asked for it. So the row is a plain element, the title is a
   button covering the whole left side, and Run is its own. Both open the
   same report, and hovering either lights the whole row so it still
   reads as one thing.
   ============================================================= */
function ReportRow({ def, first, onOpen }: {
  def: ReportDef;
  first: boolean;
  onOpen: (d: ReportDef) => void;
}) {
  const [over, setOver] = useState(false);
  const wake = { onMouseEnter: () => setOver(true), onMouseLeave: () => setOver(false) };

  return (
    <div
      {...wake}
      style={{
        display: 'flex', alignItems: 'center', gap: 14,
        borderTop: first ? 'none' : '1px solid var(--border)',
        background: over ? 'var(--bg-subtle)' : 'transparent',
        transition: 'background 120ms var(--ease, ease)',
      }}
    >
      <button
        onClick={() => onOpen(def)}
        onFocus={() => setOver(true)}
        onBlur={() => setOver(false)}
        style={{
          flex: 1, minWidth: 0, display: 'block', textAlign: 'left',
          padding: '11px 0 11px 2px', border: 'none', background: 'transparent',
          cursor: 'pointer', fontFamily: 'var(--inter)',
        }}
      >
        <span style={{
          display: 'block',
          fontFamily: 'var(--panton)', fontWeight: 700, fontSize: 14.5,
          letterSpacing: '-0.01em', color: 'var(--text)',
        }}>{def.title}</span>
        <span style={{
          display: 'block', fontSize: 12.5, color: 'var(--text-muted)',
          lineHeight: 1.5, marginTop: 2, maxWidth: '72ch',
        }}>{def.blurb}</span>
      </button>

      <span style={{
        flex: 'none', fontSize: 11.5, color: 'var(--text-subtle)',
        fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap',
      }}>
        {def.sections.length} {def.sections.length === 1 ? 'section' : 'sections'}
      </span>

      <span
        style={{ flex: 'none', paddingRight: 2 }}
        onFocus={() => setOver(true)}
        onBlur={() => setOver(false)}
      >
        <Button variant="secondary" onClick={() => onOpen(def)}>
          <Play size={13} /> Run
        </Button>
      </span>
    </div>
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
