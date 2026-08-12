'use client';

import { useState } from 'react';
import {
  Printer, FileSpreadsheet, FileText, Copy, Mail, Check, Loader, ArrowLeft,
} from 'lucide-react';
import { Button, Label, Badge, Alert } from '@/components/kit/primitives';
import type { ExportModel } from '@/lib/crm/export-model';

/* =============================================================
   Customer export.

   Five ways out of one document. PDF goes through the browser's own
   print pipeline, which is why the print stylesheet at the bottom of
   this file matters: it drops the toolbar, flattens the page to white
   and stops sections breaking across a page boundary.
   ============================================================= */

const TONE: Record<string, 'info' | 'warning' | 'accent' | 'success' | 'neutral'> = {
  lead: 'info', contacted: 'warning', quoted: 'accent',
  won: 'success', customer: 'success', lost: 'neutral',
};

export function ExportView({ model: m, contactId }: { model: ExportModel; contactId: string }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  function flash(what: string) {
    setDone(what);
    setTimeout(() => setDone((d) => (d === what ? null : d)), 2200);
  }

  function download(format: 'xlsx' | 'docx') {
    setBusy(format);
    // A plain navigation: the route replies with a Content-Disposition
    // attachment, so the browser saves it without leaving this tab.
    const a = document.createElement('a');
    a.href = `/api/crm/export/${format}?id=${contactId}`;
    a.download = '';
    a.click();
    setTimeout(() => { setBusy(null); flash(format); }, 900);
  }

  async function copy() {
    setBusy('copy');
    const html = document.getElementById('export-doc')?.innerHTML ?? '';
    const text = plainText(m);
    try {
      if (navigator.clipboard && (window as any).ClipboardItem) {
        await navigator.clipboard.write([
          new (window as any).ClipboardItem({
            'text/html': new Blob([html], { type: 'text/html' }),
            'text/plain': new Blob([text], { type: 'text/plain' }),
          }),
        ]);
      } else {
        await navigator.clipboard.writeText(text);
      }
      flash('copy');
    } catch {
      setNote('The browser refused clipboard access. Select the document and copy manually.');
    }
    setBusy(null);
  }

  function email() {
    // A real PDF attachment has to be assembled and sent server side.
    // Until Microsoft sign-in is connected there is no mailbox to send
    // from, so this opens a draft with the summary inline instead.
    const body = encodeURIComponent(plainText(m));
    const subject = encodeURIComponent(`${m.company} account summary`);
    window.location.href = `mailto:?subject=${subject}&body=${body}`;
    setNote('Opened a draft with the summary in the body. Sending it as a PDF attachment needs the Microsoft mail connection, which is not live yet.');
  }

  return (
    <div className="kit" style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      {/* ---- toolbar ---- */}
      <div className="export-bar" style={{
        position: 'sticky', top: 0, zIndex: 5,
        background: 'var(--surface)', borderBottom: '1px solid var(--border)',
        padding: '11px 22px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
      }}>
        <button onClick={() => window.close()} title="Close this tab"
          style={{
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
        <Button variant="secondary" onClick={() => download('xlsx')} disabled={busy === 'xlsx'}>
          {busy === 'xlsx' ? <Loader size={14} className="spin" /> : done === 'xlsx' ? <Check size={14} /> : <FileSpreadsheet size={14} />} Excel
        </Button>
        <Button variant="secondary" onClick={() => download('docx')} disabled={busy === 'docx'}>
          {busy === 'docx' ? <Loader size={14} className="spin" /> : done === 'docx' ? <Check size={14} /> : <FileText size={14} />} Word
        </Button>
        <Button variant="secondary" onClick={copy} disabled={busy === 'copy'}>
          {done === 'copy' ? <Check size={14} /> : <Copy size={14} />} {done === 'copy' ? 'Copied' : 'Copy'}
        </Button>
        <Button variant="secondary" onClick={email}>
          <Mail size={14} /> Email
        </Button>

        <span style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--text-subtle)' }}>
          Save as PDF uses your browser print dialogue. Choose &ldquo;Save as PDF&rdquo; as the destination.
        </span>
      </div>

      {note && (
        <div className="export-bar" style={{ padding: '12px 22px 0' }}>
          <Alert tone="info">{note}</Alert>
        </div>
      )}

      {/* ---- the document ---- */}
      <div style={{ padding: '26px 22px 60px', display: 'flex', justifyContent: 'center' }}>
        <article id="export-doc" style={{
          width: '100%', maxWidth: 820, background: 'var(--surface)',
          border: '1px solid var(--border)', borderRadius: 'var(--r-md)',
          padding: '38px 44px 46px',
        }}>
          <div style={{ borderBottom: '2px solid var(--border-emphasis)', paddingBottom: 16, marginBottom: 26 }}>
            <Label>Stockport Truck Centre</Label>
            <h1 style={{
              margin: '9px 0 0', fontFamily: 'var(--panton)', fontWeight: 800, fontSize: 34,
              lineHeight: 1.1, letterSpacing: '-0.035em', color: 'var(--text)',
            }}>{m.company}</h1>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8, flexWrap: 'wrap' }}>
              <Badge tone={TONE[m.status] ?? 'neutral'} dot>{m.status}</Badge>
              <span style={{ fontSize: 13.5, color: 'var(--text-muted)' }}>{m.subtitle}</span>
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--text-subtle)', marginTop: 10 }}>
              Exported by {m.generatedBy} on {m.generatedAt}
            </div>
          </div>

          {m.sections.map((s) => (
            <section key={s.title} className="export-section" style={{ marginBottom: 26 }}>
              <SectionRule title={s.title} />
              <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: '186px 1fr' }}>
                {s.fields.map((f) => (
                  <div key={f.label} style={{ display: 'contents' }}>
                    <dt style={{
                      fontSize: 13, color: 'var(--text-muted)', padding: '7px 0',
                      borderBottom: '1px solid var(--border)',
                    }}>{f.label}</dt>
                    <dd style={{
                      margin: 0, fontSize: 14, color: 'var(--text)', padding: '7px 0',
                      borderBottom: '1px solid var(--border)',
                      fontVariantNumeric: 'tabular-nums',
                    }}>{f.value}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}

          {m.addresses.length > 0 && (
            <section className="export-section" style={{ marginBottom: 26 }}>
              <SectionRule title="Sites" />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
                {m.addresses.map((a, i) => (
                  <div key={i} style={{
                    padding: '11px 14px', borderRadius: 'var(--r)',
                    background: 'var(--surface-sunken)',
                    borderLeft: `2px solid ${a.primary ? 'var(--accent)' : 'var(--border-strong)'}`,
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 3 }}>
                      <span style={{ fontFamily: 'var(--panton)', fontWeight: 700, fontSize: 14, color: 'var(--text)' }}>{a.label}</span>
                      {a.primary && <Badge tone="accent">Primary</Badge>}
                    </div>
                    <div style={{ fontSize: 13.5, color: 'var(--text-muted)', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{a.address}</div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {m.links.length > 0 && (
            <section className="export-section" style={{ marginBottom: 26 }}>
              <SectionRule title="Links" />
              {m.links.map((l, i) => (
                <div key={i} style={{ display: 'flex', gap: 10, padding: '6px 0', borderBottom: '1px solid var(--border)', fontSize: 13.5 }}>
                  <span style={{ width: 176, color: 'var(--text-muted)' }}>{l.label}</span>
                  <a href={l.url} style={{ color: 'var(--accent)', wordBreak: 'break-all' }}>{l.url}</a>
                </div>
              ))}
            </section>
          )}

          {m.notes.length > 0 && (
            <section className="export-section">
              <SectionRule title="Notes and history" />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
                {m.notes.map((n, i) => (
                  <div key={i} style={{
                    padding: '11px 14px', borderRadius: 'var(--r)',
                    background: 'var(--surface-sunken)', borderLeft: '2px solid var(--accent)',
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 5 }}>
                      <Label>{n.author}</Label>
                      <span style={{ fontSize: 11.5, color: 'var(--text-subtle)' }}>{n.at}</span>
                    </div>
                    <div style={{ fontSize: 13.5, color: 'var(--text)', whiteSpace: 'pre-wrap', lineHeight: 1.55 }}>{n.text}</div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </article>
      </div>

      <style>{`
        @media print {
          .export-bar { display: none !important; }
          .kit { background: #fff !important; }
          #export-doc {
            border: none !important; border-radius: 0 !important;
            padding: 0 !important; max-width: none !important;
          }
          .export-section { break-inside: avoid; page-break-inside: avoid; }
          @page { margin: 16mm; }
        }
      `}</style>
    </div>
  );
}

function SectionRule({ title }: { title: string }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12, marginBottom: 11,
      paddingBottom: 7, borderBottom: '1px solid var(--border-emphasis)',
    }}>
      <span style={{
        fontFamily: 'var(--panton)', fontWeight: 700, fontSize: 11, lineHeight: 1,
        letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--accent)',
      }}>{title}</span>
    </div>
  );
}

/** Plain text version, for the clipboard fallback and the email body. */
function plainText(m: ExportModel): string {
  const out: string[] = [m.company, m.subtitle, `Exported by ${m.generatedBy} on ${m.generatedAt}`, ''];
  for (const s of m.sections) {
    out.push(s.title.toUpperCase());
    for (const f of s.fields) out.push(`  ${f.label}: ${f.value}`);
    out.push('');
  }
  if (m.addresses.length) {
    out.push('SITES');
    for (const a of m.addresses) out.push(`  ${a.label}${a.primary ? ' (primary)' : ''}: ${a.address.replace(/\n/g, ', ')}`);
    out.push('');
  }
  if (m.notes.length) {
    out.push('NOTES');
    for (const n of m.notes) out.push(`  ${n.author}, ${n.at}\n  ${n.text}\n`);
  }
  return out.join('\n');
}
