'use client';

import type { Report, Section } from '@/lib/reports/types';

/* =============================================================
   Drawing a report.

   One component for every report, because a report is data and this
   reads it. The screen uses it, the export page uses it, and the print
   stylesheet has one shape to get right rather than nine.

   ---- Built for paper as much as for a screen ----

   From the business:

     Ensure all reports fully formatted and ready to present ... check
     them to ensure it's not picking up the sidebar and random white
     space like they usually do.

   Two separate things, and they are fixed in two separate places. The
   sidebar is the export page's job: `/export/report` is outside the
   dashboard layout, exactly as the CRM record export already is, so
   there is no sidebar in the tree to print.

   The white space is this file's. It comes from three habits that look
   fine on a screen and waste a third of a sheet of A4:

     a card with a shadow and 24px of padding round every section
     a page that starts a third of the way down under a hero heading
     tables that centre themselves in a narrow column

   So sections are separated by a rule rather than by a box, the heading
   block is four lines at the top, and tables are full width. Anything
   that would break across a page keeps its heading with it, which is
   what `break-inside: avoid` on a section is for.
   ============================================================= */

export function ReportView({ report, forPrint = false }: {
  report: Report;
  /** Paper rather than a screen: no interaction, tighter, black on white. */
  forPrint?: boolean;
}) {
  return (
    <article
      id="stc-report"
      style={{
        fontFamily: 'var(--inter)',
        color: 'var(--text)',
        maxWidth: forPrint ? undefined : 980,
        display: 'flex', flexDirection: 'column', gap: forPrint ? 18 : 22,
      }}
    >
      <header style={{ borderBottom: '2px solid var(--text)', paddingBottom: 10 }}>
        <div style={{
          fontFamily: 'var(--panton)', fontWeight: 700, fontSize: 11,
          letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--text-subtle)',
        }}>
          Stockport Truck Centre
        </div>
        <h1 style={{
          margin: '4px 0 0', fontFamily: 'var(--panton)', fontWeight: 800,
          fontSize: forPrint ? 24 : 27, letterSpacing: '-0.03em', lineHeight: 1.15,
        }}>{report.title}</h1>
        <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>
          {report.subtitle}
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--text-subtle)', marginTop: 2 }}>
          Run {new Date(report.generatedAt).toLocaleString('en-GB', {
            weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
            hour: '2-digit', minute: '2-digit',
          })}
        </div>
      </header>

      {report.sections.length === 0 && (
        <p style={{ fontSize: 13.5, color: 'var(--text-muted)' }}>
          Every section is switched off, so there is nothing to show. Turn one back on.
        </p>
      )}

      {report.sections.map((s) => (
        <section key={s.id} style={{ breakInside: 'avoid', pageBreakInside: 'avoid' }}>
          <Body section={s} forPrint={forPrint} />
        </section>
      ))}

      <footer style={{
        borderTop: '1px solid var(--border)', paddingTop: 8,
        fontSize: 10.5, color: 'var(--text-subtle)',
      }}>
        Figures come from the systems that own them: invoiced revenue from Protean, deals from the
        sales tracker, stock from the stock list. Nothing on this page is estimated except where it
        says so.
      </footer>
    </article>
  );
}

function Head({ title, note }: { title?: string; note?: string }) {
  if (!title) return null;
  return (
    <div style={{ marginBottom: 8 }}>
      <h2 style={{
        margin: 0, fontFamily: 'var(--panton)', fontWeight: 800, fontSize: 15,
        letterSpacing: '-0.02em',
      }}>{title}</h2>
      {note && (
        <div style={{ fontSize: 11.5, color: 'var(--text-subtle)', marginTop: 2, lineHeight: 1.45 }}>
          {note}
        </div>
      )}
    </div>
  );
}

function Body({ section, forPrint }: { section: Section; forPrint: boolean }) {
  if (section.kind === 'note') {
    return (
      <>
        <Head title={section.title} />
        <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.55 }}>
          {section.text}
        </p>
      </>
    );
  }

  if (section.kind === 'stats') {
    return (
      <>
        <Head title={section.title} note={section.note} />
        <div style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${Math.min(section.stats.length, 4)}, 1fr)`,
          gap: 1, background: 'var(--border)', border: '1px solid var(--border)',
        }}>
          {section.stats.map((s) => (
            <div key={s.label} style={{ background: 'var(--surface)', padding: '10px 12px' }}>
              <div style={{
                fontFamily: 'var(--panton)', fontWeight: 700, fontSize: 10,
                letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-subtle)',
              }}>{s.label}</div>
              <div style={{
                fontFamily: 'var(--panton)', fontWeight: 800, fontSize: 21,
                letterSpacing: '-0.02em', marginTop: 3,
                fontVariantNumeric: 'tabular-nums',
              }}>{s.value}</div>
              {s.sub && (
                <div style={{ fontSize: 11, color: 'var(--text-subtle)', marginTop: 1 }}>{s.sub}</div>
              )}
            </div>
          ))}
        </div>
      </>
    );
  }

  if (section.kind === 'list') {
    return (
      <>
        <Head title={section.title} note={section.note} />
        {section.items.length === 0 ? (
          <Empty what={section.empty} />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {section.items.map((i, at) => (
              <div key={`${i.title}-${at}`} style={{
                display: 'flex', gap: 10, alignItems: 'flex-start',
                padding: '7px 0', borderTop: at === 0 ? 'none' : '1px solid var(--border)',
              }}>
                {i.tone && i.tone !== 'neutral' && (
                  <span style={{
                    width: 8, height: 8, borderRadius: 'var(--r-full)', flex: 'none',
                    marginTop: 5, background: `var(--${i.tone})`,
                  }} />
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600 }}>{i.title}</div>
                  {i.detail && (
                    <div style={{ fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.5, marginTop: 1 }}>
                      {i.detail}
                    </div>
                  )}
                  {i.meta && (
                    <div style={{ fontSize: 11.5, color: 'var(--text-subtle)', marginTop: 1 }}>{i.meta}</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </>
    );
  }

  return (
    <>
      <Head title={section.title} note={section.note} />
      {section.rows.length === 0 ? (
        <Empty what={section.empty} />
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: forPrint ? 11.5 : 12.5 }}>
            <thead>
              <tr>
                {section.columns.map((c) => (
                  <th key={c.key} style={{
                    textAlign: c.align ?? 'left',
                    padding: '5px 8px',
                    borderBottom: '1px solid var(--text)',
                    fontFamily: 'var(--panton)', fontWeight: 700, fontSize: 10,
                    letterSpacing: '0.09em', textTransform: 'uppercase',
                    color: 'var(--text-subtle)', whiteSpace: 'nowrap',
                    width: c.width,
                  }}>{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {section.rows.map((r, at) => (
                <tr key={at}>
                  {section.columns.map((c) => (
                    <td key={c.key} style={{
                      textAlign: c.align ?? 'left',
                      padding: '5px 8px',
                      borderBottom: '1px solid var(--border)',
                      fontVariantNumeric: c.align === 'right' ? 'tabular-nums' : undefined,
                      color: 'var(--text-muted)',
                    }}>{r[c.key] ?? '—'}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function Empty({ what }: { what?: string }) {
  return (
    <div style={{
      fontSize: 12.5, color: 'var(--text-subtle)', fontStyle: 'italic',
      padding: '6px 0',
    }}>
      {what ?? 'Nothing to show.'}
    </div>
  );
}

/* =============================================================
   What stops the sidebar and the white space getting onto the paper.

   The same technique as the FleetSmart+ contract, and for the same
   reason it was needed there: the report sits inside a shell that is a
   grid with a fixed first column, so anything positioned or padded
   above it decides the printed width.

   `:has()` names the ancestor chain without naming the shell, which is
   what went stale last time: the old contract rules named the drawer,
   correctly, and had never heard of `.app`.
   ============================================================= */
export function ReportPrintRules() {
  return (
    <style>{`
      @media print {
        @page { size: A4 portrait; margin: 14mm 12mm; }

        /* Everything that is not on the chain to the report, gone.
           display:none rather than visibility:hidden: a hidden element
           keeps its box, and a hidden 248px sidebar in a grid column
           still reserves 248px. */
        body:has(#stc-report) *:not(:has(#stc-report)):not(#stc-report):not(#stc-report *) {
          display: none !important;
        }

        /* Every ancestor flattened, whatever it happens to be. */
        body:has(#stc-report) :has(#stc-report) {
          display: block !important;
          position: static !important;
          width: auto !important;
          max-width: none !important;
          margin: 0 !important;
          padding: 0 !important;
          overflow: visible !important;
          background: #fff !important;
        }

        #stc-report {
          position: static !important;
          width: 100% !important;
          max-width: none !important;
          margin: 0 !important;
          padding: 0 !important;
          color: #000 !important;
          background: #fff !important;
        }

        /* Black on white, whatever theme the reader had on. A report
           printed out of dark mode is a sheet of grey. */
        #stc-report * { color: #000 !important; background: transparent !important; }
        #stc-report th, #stc-report td { border-color: #999 !important; }

        /* A heading at the bottom of a page with its table overleaf is
           the commonest way a printed report reads as broken. */
        #stc-report section { break-inside: avoid; page-break-inside: avoid; }
        #stc-report thead { display: table-header-group; }
      }
    `}</style>
  );
}
