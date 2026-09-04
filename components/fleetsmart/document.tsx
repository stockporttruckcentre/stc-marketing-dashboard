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

/**
 * Which of the two documents this is.
 *
 * From the business:
 *
 *   the ability to generate a proposal, which will be the generated
 *   contract minus all the t&c's and customer sign area ... the proposal
 *   would end at "Prices exclude tyres and VAT." below the assets
 *
 * So a proposal is a PREFIX of the contract rather than a document of
 * its own: the same masthead, the same details, the same schedule, the
 * same total, and then it stops. Nothing is worded differently and no
 * figure is worked out twice, which is the whole reason it is a variant
 * of this component and not a second one. A price that could disagree
 * between the proposal and the contract is the one fault neither
 * document may ever have.
 */
export type DocumentVariant = 'contract' | 'proposal';

export function ContractDocument({
  input, priced, extras, reference, variant = 'contract',
}: {
  input: ContractInput;
  priced: PricedContract;
  extras: ContractExtras;
  reference?: string | null;
  variant?: DocumentVariant;
}) {
  const say = (key: Parameters<typeof wordingFor>[0]) => wordingFor(key, input, priced, extras);
  const shown = priced.assets.filter((a) => a.reg.trim() && a.cls);
  const showPromo = input.promoOnContract && priced.promoDiscount !== 0;
  const isProposal = variant === 'proposal';

  const manager = [extras.accountManagerName, extras.accountManagerPhone, extras.accountManagerEmail]
    .filter(Boolean).join('   ·   ');

  return (
    <article id="fs-contract" style={{ ...page, padding: 32 }}>
      {/* ---- masthead ---- */}
      <header style={{
        display: 'flex', alignItems: 'flex-end', gap: 16, flexWrap: 'wrap',
        paddingBottom: 12, borderBottom: `2px solid ${NAVY}`,
      }}>
        {/* The emblem, left of the name, on the screen and on the paper.
            A contract that goes to a customer with no mark on it looks
            like a quote somebody typed. `print-color-adjust` is what
            stops a browser helpfully dropping it to save ink. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/assets/stc-logo-emblem.png"
          alt=""
          width={44}
          height={44}
          style={{
            width: 44, height: 44, objectFit: 'contain', flex: 'none',
            printColorAdjust: 'exact', WebkitPrintColorAdjust: 'exact',
          } as React.CSSProperties}
        />
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
        <div style={{ textAlign: 'right', flex: 'none' }}>
          {/* WHICH DOCUMENT THIS IS, ON THE DOCUMENT.

              A proposal is the contract with the wording, the signing
              area and the terms taken off, so on paper the two are
              identical for the first page and a half. Without a word
              saying which one somebody is holding, the difference
              between a quote and a signed agreement is whether anybody
              scrolled to the end. */}
          {isProposal && (
            <div style={{
              display: 'inline-block', marginBottom: reference ? 5 : 0,
              padding: '2px 8px', border: `1px solid ${NAVY}`,
              fontFamily: 'var(--panton)', fontWeight: 800, fontSize: 10,
              letterSpacing: '0.16em', textTransform: 'uppercase', color: NAVY,
              printColorAdjust: 'exact', WebkitPrintColorAdjust: 'exact',
            } as React.CSSProperties}>Proposal</div>
          )}
          {reference && (
            <div style={{
              fontFamily: 'var(--panton)', fontWeight: 700, fontSize: 12,
              letterSpacing: '0.1em', color: NAVY,
            }}>{reference}</div>
          )}
        </div>
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

      {/* ---- WHERE A PROPOSAL ENDS ----

          Named by the business to the line above: everything from here
          down is the contract, and a proposal carries none of it. */}
      {isProposal ? null : (
        <>
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
        </>
      )}
    </article>
  );
}

/**
 * Print one of the two documents, under a name a customer can read.
 *
 * ---- Why the title is set here ----
 *
 * A browser takes the PDF's title, and the filename it offers when
 * somebody presses Save, from `document.title`. Every screen in this
 * application is called "STC Marketing Dashboard", so a contract sent
 * to a haulier arrived as `STC Marketing Dashboard.pdf` with the same
 * name inside its properties. That is the internal name of an internal
 * tool, on a document that leaves the building.
 *
 * So the title is the document, the customer and the reference, and it
 * is put back afterwards. `afterprint` rather than a timer: the print
 * dialog can sit open for a minute while somebody picks a printer, and
 * a title restored underneath them is a title restored before the PDF
 * is written.
 *
 * ---- Two frames before printing ----
 *
 * The proposal is the contract drawn with one prop changed, so the page
 * has to change first and print second. The first frame is the state
 * settling and the second is the document having laid out. Printing in
 * between prints the document that was on screen a moment ago, which
 * for a proposal means the standard terms and the signing page reach
 * somebody who was only sent a price.
 */
export function printContract({ variant, customerName, reference, onReady }: {
  variant: DocumentVariant;
  customerName?: string | null;
  reference?: string | null;
  /** Called before the two frame wait, to put the right document on screen. */
  onReady?: () => void;
}): void {
  onReady?.();

  const before = document.title;
  document.title = [
    `FleetSmart+ ${variant === 'proposal' ? 'Proposal' : 'Contract'}`,
    customerName?.trim() || null,
    reference?.trim() || null,
  ].filter(Boolean).join(', ');

  const restore = () => {
    document.title = before;
    window.removeEventListener('afterprint', restore);
  };
  window.addEventListener('afterprint', restore);

  requestAnimationFrame(() => requestAnimationFrame(() => window.print()));
}

/**
 * What print takes off the page.
 *
 * The contract is drawn inside a drawer, inside the dashboard shell.
 * Printed as it stands it comes out as a screenful of a scroll box
 * inside a grid column. This takes it out of all of that.
 *
 * Both places that show a contract mount this, so what comes out of the
 * printer does not depend on which screen it was opened from.
 *
 * ---- The white band down the left ----
 *
 * From the business:
 *
 *   when you save a PDF either from the builder wizard or the popup
 *   allowing you to enter email addresses to send it to, there's a
 *   large white space on the left of the PDF, the actual fleetsmart+
 *   contract covers 50% of the width of the PDF
 *
 * The cause was two rules a long way from here. The shell is
 *
 *   .app  { display: grid; grid-template-columns: 248px 1fr }
 *   .main { position: relative }
 *
 * so every screen in the application lays out in the second column, and
 * that column is a positioned box. The contract was
 * `position: absolute; left: 0; width: 100%`, which resolves against
 * the nearest POSITIONED ancestor: `.main`. On a 1440px window that
 * column is 1192px and everything looks right. On A4 the page is about
 * 688 points wide, the grid still reserves 248 of them for a sidebar
 * that is not being printed, and the contract gets the 440 that are
 * left. 248 of white down the left of every sheet, and a contract at
 * 64% of the width.
 *
 * ---- Why the fix does not name the shell ----
 *
 * Naming `.app` and `.main` would fix it today and break the next time
 * anything is put between the drawer and the body, which is exactly how
 * this broke: the rules below used to name the drawer, correctly, and
 * knew nothing about the two elements outside it.
 *
 * `:has()` names the CHAIN rather than the elements. Every ancestor of
 * the contract, whatever it happens to be, stops being a grid cell, a
 * flex item, a scroll box and a positioned box; everything that is not
 * on that chain leaves the layout altogether. Add a wrapper next month
 * and it is flattened too, without anybody remembering this file.
 *
 * Everything is scoped to `body:has(#fs-contract)`. Without that scope,
 * a page with no contract on it would match the "not on the chain" rule
 * with every element it has and print a blank sheet.
 */
export function ContractPrintRules() {
  return (
    <style>{`
      @media print {
        /* ---- 1. Only the contract, and only the boxes it sits in ----

           Removed from the LAYOUT rather than hidden. Hiding keeps the
           box: a hidden sidebar in a 248px grid column still reserves
           248px, which is the fault this is fixing. */
        body:has(#fs-contract) *:not(:has(#fs-contract)):not(#fs-contract):not(#fs-contract *) {
          display: none !important;
        }

        /* ---- 2. Every box between the body and the contract stops
                   constraining it ---- */
        body:has(#fs-contract) :has(#fs-contract) {
          display: block !important;
          position: static !important;
          width: auto !important; min-width: 0 !important; max-width: none !important;
          height: auto !important; min-height: 0 !important; max-height: none !important;
          margin: 0 !important; padding: 0 !important;
          border: 0 !important; border-radius: 0 !important;
          box-shadow: none !important; background: none !important;
          overflow: visible !important;
          transform: none !important; filter: none !important;
          grid-template-columns: none !important; grid-template-rows: none !important;
          flex: none !important; gap: 0 !important;
        }

        /* ---- 3. The contract, in normal flow, at the page's width ----

           Normal flow rather than absolutely positioned. It used to be
           absolute because that was how it escaped the drawer; with the
           chain above flattened there is nothing left to escape, and a
           block paginates across sheets in a way an out of flow box
           does not. */
        #fs-contract {
          position: static !important;
          width: 100% !important; max-width: none !important;
          margin: 0 !important; padding: 0 !important;
          box-shadow: none !important; border: 0 !important; border-radius: 0 !important;
          background: #fff !important;
        }

        html, body {
          background: #fff !important; margin: 0 !important; padding: 0 !important;
          width: auto !important; height: auto !important; overflow: visible !important;
        }

        .fs-doc-section { break-inside: avoid; page-break-inside: avoid; }
        @page { margin: 14mm; }
      }
    `}</style>
  );
}
