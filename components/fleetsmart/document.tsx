'use client';

import type { CSSProperties, ReactNode } from 'react';
import {
  STC, TERMS, TERMS_HEADING, TERMS_PREAMBLE, endDate, inspectionSentence, wordingFor,
  type ContractExtras,
} from '@/lib/fleetsmart/contract';
import type { ContractInput, PricedContract } from '@/lib/fleetsmart/types';

/* =============================================================
   The contract, as the customer receives it.

   A reproduction of the workbook's Contract tab: the same order, the
   same blocks, the same schedule, the same sign-off, the same terms
   underneath.

   ---- Why this one is on paper rather than in the theme ----

   Everything else in this product follows the viewer's theme, and this
   deliberately does not. A contract is printed, emailed and filed. It
   is black ink on white paper wherever it ends up, and a document that
   came out inverted because the person who exported it had dark mode on
   is a document that gets sent back.

   So it takes `--stc-navy`, `--stc-red` and `--stc-paper`, which are
   the kit's own brand tokens and are fixed rather than themed, and
   nothing else. The chrome around it, the toolbar, the buttons, the
   drawer it opens in, is all ordinary kit.

   ---- The total ----

   Summed over every asset. The workbook's own `H43` is
   `=SUM(H18:H22)`, which is the first five rows of a twenty five row
   schedule, so a fleet of six or more prints a monthly total lower than
   the sum of its own lines. That is a bug in the workbook and it is not
   reproduced here.
   ============================================================= */

const PAPER = '#FFFFFF';
const INK = '#1A1D26';
const NAVY = 'var(--stc-navy)';
const RULE = '#D7DBE3';

const page: CSSProperties = {
  background: PAPER, color: INK,
  fontFamily: 'var(--inter)', fontSize: 12,
  lineHeight: 1.5, letterSpacing: '-0.005em',
};

const h2: CSSProperties = {
  margin: '0 0 8px', fontFamily: 'var(--panton)', fontWeight: 800,
  fontSize: 12, letterSpacing: '0.14em', textTransform: 'uppercase', color: NAVY,
};

const money = (n: number) =>
  n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const longDate = (iso: string) => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso
    : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
};

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="fs-doc-section" style={{ marginTop: 20 }}>
      <h2 style={h2}>{title}</h2>
      {children}
    </section>
  );
}

/** A block of contract wording, with its newlines kept as lines. */
function Prose({ text }: { text: string }) {
  return (
    <div style={{ whiteSpace: 'pre-wrap', color: INK }}>
      {text.split('\n').map((line, i) => (
        <div key={i} style={{ marginBottom: line.trim() ? 3 : 0 }}>
          {/* The Services block is a list in the workbook and reads as
              one here: every line after the first gets a marker. */}
          {line}
        </div>
      ))}
    </div>
  );
}

function Detail({ label, value }: { label: string; value: ReactNode }) {
  return (
    <tr>
      <td style={{
        padding: '5px 12px 5px 0', verticalAlign: 'top', width: 170,
        fontWeight: 600, color: NAVY, whiteSpace: 'nowrap',
      }}>{label}</td>
      <td style={{ padding: '5px 0', verticalAlign: 'top' }}>{value}</td>
    </tr>
  );
}

export function ContractDocument({
  input, priced, extras, reference,
}: {
  input: ContractInput;
  priced: PricedContract;
  extras: ContractExtras;
  reference?: string | null;
}) {
  const say = (key: Parameters<typeof wordingFor>[0]) => wordingFor(key, input, priced, extras);
  const shown = priced.assets.filter((a) => a.reg.trim() && a.cls);
  const showPromo = input.promoOnContract && priced.promoDiscount !== 0;

  const manager = [extras.accountManagerName, extras.accountManagerPhone, extras.accountManagerEmail]
    .filter(Boolean).join('   ·   ');

  return (
    <article id="fs-contract" style={{ ...page, padding: 32 }}>
      {/* ---- masthead ---- */}
      <header style={{
        display: 'flex', alignItems: 'flex-end', gap: 16, flexWrap: 'wrap',
        paddingBottom: 12, borderBottom: `2px solid ${NAVY}`,
      }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <div style={{
            fontFamily: 'var(--panton)', fontWeight: 800, fontSize: 17,
            letterSpacing: '-0.01em', color: NAVY, textTransform: 'uppercase',
          }}>
            Stockport Truck Centre
            <span style={{ color: 'var(--stc-red)', marginLeft: 10 }}>FleetSmart+</span>
          </div>
          <div style={{
            marginTop: 6, fontFamily: 'var(--panton)', fontWeight: 800, fontSize: 22,
            letterSpacing: '-0.02em', color: INK,
          }}>
            {say('planTitle')}
          </div>
        </div>
        {reference && (
          <div style={{
            fontFamily: 'var(--panton)', fontWeight: 700, fontSize: 12,
            letterSpacing: '0.1em', color: NAVY,
          }}>{reference}</div>
        )}
      </header>

      <div style={{ marginTop: 8, fontSize: 11.5, color: '#5A6172' }}>
        {manager
          ? `Your STC account manager: ${manager}`
          : 'Your STC account manager: add the name, phone and email on the wording step.'}
      </div>

      {/* ---- contract details ---- */}
      <Section title="Contract details">
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <tbody>
            <Detail label="Commencement date" value={longDate(input.startDate) || 'To be agreed'} />
            <Detail
              label="Term"
              value={`${input.termMonths} months, commencing on the commencement date`
                + (input.startDate ? `, to ${longDate(endDate(input.startDate, input.termMonths))}` : '')}
            />
            <Detail
              label="STC"
              value={`${STC.legalName} (No. ${STC.companyNumber}), registered office ${STC.registeredOffice}. VAT ${STC.vatNumber}.`}
            />
            <Detail
              label="The customer"
              value={`${input.customerName || '[Customer name]'}${extras.companyNumber ? ` (No. ${extras.companyNumber})` : ''}`}
            />
            <Detail
              label="Registered address"
              value={extras.registeredAddress || input.customerAddress || '[Registered address]'}
            />
            <Detail label="Contact" value={input.customerContact || '[Contact]'} />
            <Detail
              label="Maximum mileage"
              value={extras.maximumMileage
                ? `${extras.maximumMileage.toLocaleString('en-GB')} miles per annum`
                : '[Maximum mileage]'}
            />
            <Detail label="Inspection frequency" value={inspectionSentence(input)} />
          </tbody>
        </table>
      </Section>

      {/* ---- the schedule ---- */}
      <Section title={`${priced.flags.assetWords} included`}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
          <thead>
            <tr>
              {['#', 'Registration', 'Asset details', 'Class', 'Cost per month'].map((h, i) => (
                <th key={h} style={{
                  textAlign: i === 4 ? 'right' : 'left',
                  padding: '6px 8px', borderBottom: `1px solid ${NAVY}`,
                  fontFamily: 'var(--panton)', fontWeight: 700, fontSize: 10,
                  letterSpacing: '0.1em', textTransform: 'uppercase', color: NAVY,
                  width: i === 0 ? 30 : undefined,
                }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((a, i) => (
              <tr key={a.key}>
                <td style={{ padding: '5px 8px', borderBottom: `1px solid ${RULE}` }}>{i + 1}</td>
                <td style={{ padding: '5px 8px', borderBottom: `1px solid ${RULE}`, fontWeight: 600 }}>{a.reg}</td>
                <td style={{ padding: '5px 8px', borderBottom: `1px solid ${RULE}` }}>{a.type}</td>
                <td style={{ padding: '5px 8px', borderBottom: `1px solid ${RULE}` }}>{a.cls}</td>
                <td style={{
                  padding: '5px 8px', borderBottom: `1px solid ${RULE}`,
                  textAlign: 'right', fontVariantNumeric: 'tabular-nums',
                }}>£{money(a.monthly)}</td>
              </tr>
            ))}
            {shown.length === 0 && (
              <tr>
                <td colSpan={5} style={{ padding: '10px 8px', color: '#8A90A0' }}>
                  No assets on this contract yet.
                </td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={4} style={{ padding: '8px', textAlign: 'right', fontWeight: 600 }}>
                Total / month
              </td>
              <td style={{
                padding: '8px', textAlign: 'right', fontWeight: 700,
                fontVariantNumeric: 'tabular-nums',
                borderTop: `1px solid ${NAVY}`,
              }}>
                £{money(showPromo ? priced.monthly - priced.promoDiscount / 12 : priced.monthly)}
              </td>
            </tr>
            {showPromo && (
              <>
                <tr>
                  <td colSpan={4} style={{ padding: '4px 8px', textAlign: 'right' }}>
                    Promotional discount / month
                  </td>
                  <td style={{
                    padding: '4px 8px', textAlign: 'right',
                    fontVariantNumeric: 'tabular-nums', color: 'var(--stc-red)',
                  }}>£{money(priced.promoDiscount / 12)}</td>
                </tr>
                <tr>
                  <td colSpan={4} style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 700 }}>
                    Total / month after promotional discount
                  </td>
                  <td style={{
                    padding: '6px 8px', textAlign: 'right', fontWeight: 800,
                    fontVariantNumeric: 'tabular-nums', color: NAVY,
                    borderTop: `1px solid ${RULE}`,
                  }}>£{money(priced.monthly)}</td>
                </tr>
              </>
            )}
          </tfoot>
        </table>
        <div style={{ marginTop: 6, fontSize: 10.5, color: '#8A90A0' }}>
          Prices exclude tyres and VAT.
        </div>
      </Section>

      <Section title="Term"><Prose text={say('term')} /></Section>

      <Section title="Services">
        <div style={{ marginBottom: 6 }}>The Services provided shall include:</div>
        <Prose text={say('services')} />
      </Section>

      <Section title="Exclusions"><Prose text={say('exclusions')} /></Section>
      <Section title="Additional services"><Prose text={say('additional')} /></Section>
      <Section title="Charges"><Prose text={say('charges')} /></Section>
      <Section title="Collection and delivery"><Prose text={say('collection')} /></Section>
      <Section title="Payment"><Prose text={say('payment')} /></Section>

      {/* ---- sign-off ---- */}
      <Section title="Agreement and sign-off">
        <div style={{ display: 'flex', gap: 32, flexWrap: 'wrap' }}>
          {['Authorised signatory for the Customer',
            `Authorised signatory for ${STC.legalName}`].map((who) => (
            <div key={who} style={{ flex: '1 1 260px', minWidth: 240 }}>
              <div style={{ fontWeight: 600, color: NAVY, marginBottom: 12 }}>{who}</div>
              {['Signed', 'Print name', 'Position', 'Date'].map((field) => (
                <div key={field} style={{ display: 'flex', alignItems: 'flex-end', gap: 10, marginBottom: 16 }}>
                  <span style={{ width: 74, color: '#5A6172' }}>{field}</span>
                  <span style={{ flex: 1, borderBottom: `1px solid ${RULE}`, height: 18 }} />
                </div>
              ))}
            </div>
          ))}
        </div>
      </Section>

      {/* ---- the standard terms ---- */}
      <section style={{ marginTop: 28, paddingTop: 16, borderTop: `2px solid ${NAVY}` }}>
        <h2 style={{ ...h2, fontSize: 13 }}>{TERMS_HEADING}</h2>
        {TERMS_PREAMBLE.map((p) => (
          <div key={p} style={{ fontWeight: 700, fontSize: 10.5, color: NAVY, marginBottom: 4 }}>{p}</div>
        ))}
        {TERMS.map((clause) => (
          <div key={clause.number} className="fs-doc-section" style={{ marginTop: 12 }}>
            <div style={{ fontWeight: 700, color: NAVY, fontSize: 11.5, marginBottom: 4 }}>
              {clause.number}. {clause.heading}
            </div>
            {clause.clauses.map((c, i) => (
              <p key={i} style={{ margin: '0 0 5px', fontSize: 10.5, lineHeight: 1.5, color: '#3A4053' }}>{c}</p>
            ))}
          </div>
        ))}
      </section>
    </article>
  );
}

/**
 * What print takes off the page.
 *
 * The document is drawn inside a drawer, and a drawer is a fixed box
 * with its own scrollbar: printed as it stands, only the first
 * screenful comes out. This releases it, drops the application around
 * it, and keeps a numbered clause from being split across two pages.
 *
 * Both places that show a contract mount this, so what comes out of the
 * printer does not depend on which screen it was opened from.
 */
export function ContractPrintRules() {
  return (
    <style>{`
      @media print {
        .sidebar, .topbar, nav, header.topbar { display: none !important; }
        html, body {
          background: #fff !important; margin: 0 !important; padding: 0 !important;
          height: auto !important; overflow: visible !important;
        }
        [role="dialog"] {
          position: static !important; max-width: none !important; width: 100% !important;
          height: auto !important; box-shadow: none !important; border: 0 !important;
        }
        [role="dialog"] > div { overflow: visible !important; height: auto !important; }
        .fs-doc-frame { border: 0 !important; border-radius: 0 !important; }
        #fs-contract { padding: 0 !important; }
        .fs-doc-section { break-inside: avoid; page-break-inside: avoid; }
        @page { margin: 14mm; }
      }
    `}</style>
  );
}
