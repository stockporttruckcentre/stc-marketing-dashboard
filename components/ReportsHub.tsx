'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft, FileText, Loader, Printer, RefreshCw, SlidersHorizontal, AlertTriangle,
} from 'lucide-react';
import { Alert, Button, Card, Chip, Label, PageHead } from '@/components/kit/primitives';
import { ReportView } from '@/components/reports/ReportView';
import {
  CATEGORY_BLURB, CATEGORY_LABEL, reportBySlug, reportsByCategory, type ReportDef,
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

   Categories, because the business asked for them and because nine
   reports in one list is a list nobody reads to the bottom of. The
   meeting report is first and on its own, which is what it is for.
   ============================================================= */
function Catalogue({ onOpen }: { onOpen: (d: ReportDef) => void }) {
  const groups = useMemo(() => reportsByCategory(), []);
  return (
    <div>
      <PageHead
        eyebrow="Workspace"
        title="Reports"
        sub="Pick one and it runs. Narrow it by division, period or person once it is open."
      />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 26 }}>
        {groups.map((g) => (
          <section key={g.category}>
            <div style={{ marginBottom: 10 }}>
              <Label>{CATEGORY_LABEL[g.category]}</Label>
              <div style={{ fontSize: 12.5, color: 'var(--text-subtle)', marginTop: 3 }}>
                {CATEGORY_BLURB[g.category]}
              </div>
            </div>
            <div style={{
              display: 'grid', gap: 10,
              gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
            }}>
              {g.reports.map((r) => (
                <button
                  key={r.slug}
                  onClick={() => onOpen(r)}
                  style={{
                    textAlign: 'left', cursor: 'pointer',
                    padding: '14px 15px', borderRadius: 'var(--r-md)',
                    border: '1px solid var(--border)', background: 'var(--surface)',
                    fontFamily: 'var(--inter)',
                    display: 'flex', flexDirection: 'column', gap: 5,
                  }}
                >
                  <span style={{
                    fontFamily: 'var(--panton)', fontWeight: 800, fontSize: 15,
                    letterSpacing: '-0.02em', color: 'var(--text)',
                  }}>{r.title}</span>
                  <span style={{ fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.5 }}>
                    {r.blurb}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--text-subtle)', marginTop: 2 }}>
                    {r.sections.length} {r.sections.length === 1 ? 'section' : 'sections'}
                  </span>
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
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
