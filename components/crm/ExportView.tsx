'use client';

import { useState } from 'react';
import {
  Printer, FileSpreadsheet, FileText, Copy, Mail, Check, Loader, ArrowLeft,
  X, ClipboardCheck, AlertTriangle,
} from 'lucide-react';
import { Button, Label, Badge, Alert } from '@/components/kit/primitives';
import { exportEmailHtml } from '@/lib/crm/export-email-html';
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
  const [emailOpen, setEmailOpen] = useState(false);
  const [emailCopied, setEmailCopied] = useState(false);
  const [to, setTo] = useState('');

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

  /**
   * Put the email-safe version on the clipboard.
   *
   * Not the markup on screen: that uses CSS custom properties and grid,
   * neither of which Outlook understands, so pasting it produces a stack
   * of unstyled text. `exportEmailHtml` renders the same model as inline
   * styled tables, which is what survives Word's rendering engine.
   */
  async function putOnClipboard(): Promise<boolean> {
    const html = exportEmailHtml(m);
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
      return true;
    } catch {
      setNote('The browser refused clipboard access. Select the document below and copy it manually.');
      return false;
    }
  }

  async function copy() {
    setBusy('copy');
    if (await putOnClipboard()) flash('copy');
    setBusy(null);
  }

  /**
   * Email keeps the sender's own signature, which rules out the obvious
   * approaches. A mailto body is plain text only, and a draft created
   * through Graph does not pick up an Outlook signature either, because
   * Outlook only inserts one when a person starts a new message in the
   * client.
   *
   * So the formatted HTML goes on the clipboard and the compose window
   * opens blank, with the signature already in it, ready to paste above.
   *
   * The first version of this fired the mailto immediately and left a
   * sentence behind explaining the paste. That reads as a broken button:
   * you press Email, an empty message appears, and nothing tells you the
   * clipboard is loaded. So the two steps are now two visible steps, and
   * the compose window only opens when you ask for it.
   *
   * The tidier version, where the ribbon add-in drops this straight into
   * an open compose with no paste at all, is noted in the build state doc
   * for when the Office add-in is built.
   */
  async function email() {
    setBusy('email');
    // Copied inside the click, while the page still holds the user
    // gesture that the clipboard API insists on.
    const copied = await putOnClipboard();
    setEmailCopied(copied);
    setBusy(null);
    setNote(null);
    setEmailOpen(true);
  }

  async function recopy() {
    setBusy('recopy');
    const copied = await putOnClipboard();
    setEmailCopied(copied);
    if (copied) { setNote(null); flash('recopy'); }
    setBusy(null);
  }

  /**
   * If the clipboard worked, the compose window is left blank so the
   * paste lands cleanly. If it did not, the summary goes in as plain
   * text: a readable message beats an empty one, and mailto bodies are
   * plain text whatever we do. Clients vary on how long a mailto they
   * accept, so it is trimmed well short of where they start dropping it.
   */
  function mailtoHref(): string {
    const subject = encodeURIComponent(`${m.company} account summary`);
    const recipient = encodeURIComponent(to.trim());
    let href = `mailto:${recipient}?subject=${subject}`;
    if (!emailCopied) {
      const body = plainText(m).slice(0, 1600);
      href += `&body=${encodeURIComponent(body)}`;
    }
    return href;
  }

  return (
    /* Its own scroll container on purpose. `globals.css` puts
       `overflow: hidden` on the body and lets `.content` inside the
       dashboard shell do the scrolling, and this page is deliberately
       outside that shell, so without this the document is simply cut off
       at the bottom of the window with no way to reach the rest. */
    <div className="kit export-scroll" style={{ height: '100vh', overflowY: 'auto', background: 'var(--bg)' }}>
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
        <Button variant="secondary" onClick={email} disabled={busy === 'email'}>
          {busy === 'email' ? <Loader size={14} className="spin" /> : <Mail size={14} />} Email
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

      {emailOpen && (
        <EmailPanel
          company={m.company}
          copied={emailCopied}
          to={to}
          setTo={setTo}
          href={mailtoHref()}
          busy={busy === 'recopy'}
          recopied={done === 'recopy'}
          onRecopy={recopy}
          onClose={() => setEmailOpen(false)}
        />
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
          /* Anything that is not the document is hidden, including app
             chrome that might wrap this page in future. */
          .export-bar, .sidebar, .topbar, nav, header.topbar { display: none !important; }
          html, body {
            background: #fff !important; margin: 0 !important; padding: 0 !important;
            height: auto !important; overflow: visible !important;
          }
          /* The on-screen scroll container has to release the page, or
             print only ever gets the first window's worth of it. */
          .export-scroll { height: auto !important; overflow: visible !important; }
          .kit { background: #fff !important; }
          #export-doc {
            border: none !important; border-radius: 0 !important;
            padding: 0 !important; max-width: none !important; width: 100% !important;
          }
          .export-section { break-inside: avoid; page-break-inside: avoid; }
          a { color: #09163A !important; text-decoration: none !important; }
          @page { margin: 16mm; }
        }
      `}</style>
    </div>
  );
}

/* =============================================================
   Send by email.

   Two steps, both visible, because the alternative is a button that
   appears to open an empty message for no reason.

   Step one has already happened by the time this opens: the formatted
   summary is on the clipboard. Step two is the compose window, opened
   from a real link rather than a scripted navigation, so the export tab
   stays put behind it and can be pasted from again if the first attempt
   goes somewhere unhelpful.

   The signature is the whole reason for the paste. Outlook only inserts
   one when a person starts a message in the client, so a draft built by
   the server would arrive without it. That changes when Microsoft
   sign-in is live: Graph can then attach the PDF and send it from the
   user's own mailbox.
   ============================================================= */
function EmailPanel({
  company, copied, to, setTo, href, busy, recopied, onRecopy, onClose,
}: {
  company: string;
  copied: boolean;
  to: string;
  setTo: (v: string) => void;
  href: string;
  busy: boolean;
  recopied: boolean;
  onRecopy: () => void;
  onClose: () => void;
}) {
  return (
    <div
      className="export-bar"
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 40, background: 'rgba(9, 22, 58, 0.44)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 520, background: 'var(--surface)',
          border: '1px solid var(--border)', borderRadius: 'var(--r-md)',
          boxShadow: 'var(--shadow-3)', overflow: 'hidden',
        }}
      >
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '14px 18px', borderBottom: '1px solid var(--border)',
        }}>
          <Mail size={16} style={{ color: 'var(--accent)' }} />
          <span style={{
            fontFamily: 'var(--panton)', fontWeight: 700, fontSize: 15,
            letterSpacing: '-0.01em', color: 'var(--text)',
          }}>Send by email</span>
          <button onClick={onClose} aria-label="Close" style={{
            marginLeft: 'auto', width: 28, height: 28, display: 'grid', placeItems: 'center',
            border: '1px solid var(--border)', borderRadius: 'var(--r)',
            background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer',
          }}>
            <X size={14} />
          </button>
        </div>

        <div style={{ padding: '16px 18px 18px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {copied ? (
            <div style={{
              display: 'flex', gap: 10, alignItems: 'flex-start',
              padding: '11px 13px', borderRadius: 'var(--r)',
              background: 'var(--surface-sunken)', borderLeft: '2px solid var(--success)',
            }}>
              <ClipboardCheck size={16} style={{ color: 'var(--accent)', flexShrink: 0, marginTop: 1 }} />
              <div style={{ fontSize: 13.5, color: 'var(--text)', lineHeight: 1.5 }}>
                The {company} summary is on your clipboard, formatted. Open a new
                message and press Ctrl and V above your signature.
              </div>
            </div>
          ) : (
            <div style={{
              display: 'flex', gap: 10, alignItems: 'flex-start',
              padding: '11px 13px', borderRadius: 'var(--r)',
              background: 'var(--surface-sunken)', borderLeft: '2px solid var(--warning)',
            }}>
              <AlertTriangle size={16} style={{ color: 'var(--accent)', flexShrink: 0, marginTop: 1 }} />
              <div style={{ fontSize: 13.5, color: 'var(--text)', lineHeight: 1.5 }}>
                The browser blocked clipboard access, so the message opens with a
                plain text version of the summary instead. Try Copy again below to
                get the formatted one.
              </div>
            </div>
          )}

          <div>
            <Label>Send to (optional)</Label>
            <input
              type="email"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="name@company.co.uk"
              style={{
                marginTop: 6, width: '100%', height: 32, padding: '0 10px',
                border: '1px solid var(--border)', borderRadius: 'var(--r)',
                background: 'var(--surface-sunken)', color: 'var(--text)',
                fontFamily: 'var(--inter)', fontSize: 13.5,
              }}
            />
            <div style={{ fontSize: 11.5, color: 'var(--text-subtle)', marginTop: 5 }}>
              Leave it blank to pick the recipient in Outlook.
            </div>
          </div>

          <div style={{ display: 'flex', gap: 9, flexWrap: 'wrap' }}>
            {/* A real link, not a scripted navigation. The mail client
                takes the handoff and this tab is left alone. */}
            <a
              href={href}
              onClick={() => setTimeout(onClose, 400)}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 7, height: 32,
                padding: '0 13px', borderRadius: 'var(--r)', border: '1px solid transparent',
                background: 'var(--accent)', color: '#fff', textDecoration: 'none',
                fontFamily: 'var(--inter)', fontSize: 13, fontWeight: 500,
              }}
            >
              <Mail size={14} /> Open a new message
            </a>
            <Button variant="secondary" onClick={onRecopy} disabled={busy}>
              {busy ? <Loader size={14} className="spin" /> : recopied ? <Check size={14} /> : <Copy size={14} />}
              {recopied ? 'Copied' : 'Copy again'}
            </Button>
          </div>

          <div style={{ fontSize: 11.5, color: 'var(--text-subtle)', lineHeight: 1.55, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
            Sending the PDF as an attachment straight from your own mailbox needs
            Microsoft sign-in. It is on the list for when that goes live.
          </div>
        </div>
      </div>
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
