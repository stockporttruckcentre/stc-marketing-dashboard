'use client';

import { ArrowLeft, FileText, Printer } from 'lucide-react';
import { Button } from '@/components/kit/primitives';
import { ReportPrintRules, ReportView } from '@/components/reports/ReportView';
import type { Report } from '@/lib/reports/types';

/* =============================================================
   A report on its own, ready to print.

   The same arrangement the customer export uses, and for the same
   reason: a toolbar that is not part of the document, and a document
   that is the whole page. This one sits at `/export/report`, outside the
   dashboard layout, so there is no sidebar in the tree at all.

   From the business:

     check them to ensure it's not picking up the sidebar and random
     white space like they usually do.

   Being outside the layout answers the sidebar. `ReportPrintRules`
   answers the rest, and answers it structurally rather than by naming
   the shell: whatever this page is nested inside on the day, every
   ancestor of the report is flattened and everything else is removed.
   ============================================================= */
export function ReportPage({ report, docxUrl }: { report: Report; docxUrl: string }) {
  return (
    <div
      className="kit report-scroll"
      style={{ height: '100vh', overflowY: 'auto', background: 'var(--bg)' }}
    >
      <div className="report-bar" style={{
        position: 'sticky', top: 0, zIndex: 5,
        background: 'var(--surface)', borderBottom: '1px solid var(--border)',
        padding: '11px 22px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
      }}>
        <button onClick={() => window.close()} title="Close this tab" style={{
          display: 'inline-flex', alignItems: 'center', gap: 7, height: 32, padding: '0 11px',
          border: '1px solid var(--border)', borderRadius: 'var(--r)', background: 'transparent',
          color: 'var(--text-muted)', cursor: 'pointer', fontFamily: 'var(--inter)', fontSize: 13,
        }}>
          <ArrowLeft size={14} /> Close
        </button>

        <div style={{ width: 1, height: 22, background: 'var(--border)' }} />

        <Button variant="accent" onClick={() => window.print()}>
          <Printer size={14} /> Save as PDF
        </Button>
        <Button variant="secondary" onClick={() => { window.location.href = docxUrl; }}>
          <FileText size={14} /> Word
        </Button>

        <span style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--text-subtle)' }}>
          Save as PDF uses your browser print dialogue. Choose &ldquo;Save as PDF&rdquo; as the destination.
        </span>
      </div>

      <div style={{ padding: '26px 22px 60px', display: 'flex', justifyContent: 'center' }}>
        <div style={{
          width: '100%', maxWidth: 900, background: 'var(--surface)',
          border: '1px solid var(--border)', borderRadius: 'var(--r-md)',
          padding: '34px 40px 42px',
        }}>
          <ReportView report={report} forPrint />
        </div>
      </div>

      <ReportPrintRules />
      <style>{`
        @media print {
          /* The on screen scroll container has to release the page, or
             print only ever gets the first window's worth of it. This is
             the one thing the shared rules cannot do for themselves:
             they flatten the report's ancestors, and html and body are
             ancestors of everything rather than of the report. */
          html, body {
            height: auto !important; overflow: visible !important;
            margin: 0 !important; padding: 0 !important; background: #fff !important;
          }
        }
      `}</style>
    </div>
  );
}
