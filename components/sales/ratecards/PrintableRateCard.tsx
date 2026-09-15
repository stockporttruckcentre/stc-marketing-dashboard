'use client';

import { useEffect } from 'react';
import { sheetWrites, WINGDINGS_TICK } from '@/lib/ratecards/sheet';
import { money, longDate } from '@/lib/ratecards/format';
import type { FullCard } from '@/lib/ratecards/types';

/* =============================================================
   The rate card, laid out for paper.

   Drawn from `sheetWrites`, the same list of values the workbook gets,
   so the PDF a customer is sent and the spreadsheet they are sent carry
   identical figures. That is the whole reason this does not lay the
   card out from `card.rates` directly: two readings of the same data
   drift, and these two go to the same person.
   ============================================================= */
export function PrintableRateCard({ card }: { card: FullCard }) {
  /* Opening the print dialogue is what somebody came here to do. Done
     after paint so the dialogue is never over a half-drawn page. */
  useEffect(() => {
    const id = window.setTimeout(() => window.print(), 350);
    return () => window.clearTimeout(id);
  }, []);

  const values = new Map(sheetWrites(card).map((w) => [w.at, w.value]));
  const c = card.card;

  const sections: { name: string; rows: typeof card.rates }[] = [];
  for (const r of card.rates) {
    if (r.section === 'Parts Rates') continue;
    const last = sections[sections.length - 1];
    if (last && last.name === r.section) last.rows.push(r);
    else sections.push({ name: r.section, rows: [r] });
  }

  const byRate = (rows: typeof card.rates) => {
    const map = new Map<string, typeof card.rates>();
    for (const r of rows) map.set(r.rate_id, [...(map.get(r.rate_id) ?? []), r]);
    return [...map.values()];
  };

  const fs = card.fleetsmart;
  const showFs = fs.shown && fs.contract;

  return (
    <main className="sheet">
      <style>{`
        @page { size: A4 landscape; margin: 12mm; }
        body { margin: 0; }
        .sheet {
          font-family: Calibri, system-ui, sans-serif;
          color: #000; font-size: 10pt; padding: 10mm;
        }
        .sheet h1 { font-size: 18pt; margin: 0 0 2mm; font-weight: 700; }
        .sheet .eff { font-size: 10pt; margin: 0 0 4mm; }
        .sheet table { border-collapse: collapse; width: 100%; }
        .sheet td, .sheet th {
          border: 1px solid #000; padding: 1.4mm 2mm; font-size: 9pt; vertical-align: middle;
        }
        .sheet th { background: #09163A; color: #fff; font-weight: 700; text-align: left; }
        .sheet td.n { text-align: right; font-variant-numeric: tabular-nums; }
        .sheet td.c { text-align: center; }
        .sheet .band td { background: #EFEFEC; font-weight: 700; }
        .sheet .head { display: flex; gap: 10mm; margin-bottom: 5mm; }
        .sheet .head dl { margin: 0; display: grid; grid-template-columns: auto 1fr; gap: 0.6mm 3mm; font-size: 9pt; }
        .sheet .head dt { font-weight: 700; }
        .sheet .head dd { margin: 0; }
        .sheet .cols { display: flex; gap: 6mm; align-items: flex-start; }
        .sheet .cols > * { flex: 1; }
        .sheet .auth { margin-top: 5mm; font-size: 9pt; }
        .sheet .tick { font-weight: 700; }
        @media print { .noprint { display: none; } }
      `}</style>

      <div className="noprint" style={{ marginBottom: 12, fontSize: 13 }}>
        Printing {c.ref}. Choose &ldquo;Save as PDF&rdquo; as the destination.
        {' '}
        <button onClick={() => window.print()} style={{ marginLeft: 8 }}>Print again</button>
      </div>

      <h1>{c.customer_name}</h1>
      <p className="eff">Effective from {longDate(c.effective_from)}</p>

      <div className="head">
        <dl>
          <dt>Main contact</dt><dd>{c.main_contact ?? ''}</dd>
          <dt>Address</dt><dd>{c.address ?? ''}</dd>
          <dt>Telephone</dt><dd>{c.telephone ?? ''}</dd>
          <dt>Email</dt><dd>{c.email ?? ''}</dd>
          {c.other_detail && <><dt>Other</dt><dd>{c.other_detail}</dd></>}
          {c.accounts_detail && <><dt>Accounts</dt><dd>{c.accounts_detail}</dd></>}
        </dl>
      </div>

      <div className="cols">
        <table>
          <thead>
            <tr>
              <th style={{ width: '40%' }}>Item</th>
              <th className="c">Price</th>
              <th className="c">1-axle</th>
              <th className="c">2-axle</th>
              <th className="c">3-axle</th>
              <th className="c">4-axle</th>
            </tr>
          </thead>
          <tbody>
            {sections.map((s) => (
              <>
                <tr className="band" key={`band-${s.name}`}>
                  <td colSpan={6}>{s.name}</td>
                </tr>
                {byRate(s.rows).map((cols) => {
                  const first = cols[0]!;
                  const byAxle = new Map(cols.map((r) => [r.axle, r]));
                  const single = byAxle.get(0);
                  return (
                    <tr key={first.rate_id}>
                      <td>{first.item}</td>
                      <td className="n">{cell(single)}</td>
                      {[1, 2, 3, 4].map((a) => (
                        <td className="n" key={a}>{cell(byAxle.get(a))}</td>
                      ))}
                    </tr>
                  );
                })}
              </>
            ))}
          </tbody>
        </table>

        {showFs && (
          <table>
            <thead>
              <tr>
                <th style={{ width: '55%' }}>FleetSmart+ inclusions</th>
                <th className="c">Silver</th>
                <th className="c">Gold</th>
                <th className="c">Platinum</th>
              </tr>
            </thead>
            <tbody>
              <tr className="band">
                <td colSpan={4}>
                  {c.customer_name} contract status: on FleetSmart+, {fs.contract?.plan}
                </td>
              </tr>
              {fs.inclusions.map((i) => (
                <tr key={i.inclusion}>
                  <td>{i.inclusion}</td>
                  <td className="c tick">{i.silver ? '✓' : ''}</td>
                  <td className="c tick">{i.gold ? '✓' : ''}</td>
                  <td className="c tick">{i.platinum ? '✓' : ''}</td>
                </tr>
              ))}
              {(fs.extras ?? []).map((e) => (
                <tr key={`x-${e.inclusion}`}>
                  <td>{e.inclusion}</td>
                  <td className="c tick">{e.tiers.includes('Silver') ? '✓' : ''}</td>
                  <td className="c tick">{e.tiers.includes('Gold') ? '✓' : ''}</td>
                  <td className="c tick">{e.tiers.includes('Platinum') ? '✓' : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="auth">
        <strong>Invoicing &amp; authority instruction and contact.</strong>{' '}
        {c.accounts_detail ?? ''}
        <br />
        All work MUST be authorised prior to commencement.
      </div>
    </main>
  );

  /* The value the workbook would carry for this cell, so the paper and
     the spreadsheet cannot say different numbers. */
  function cell(r: (typeof card.rates)[number] | undefined): string {
    if (!r) return '';
    if (r.price !== null) return money(r.price);
    if (r.text_value) return r.text_value;
    if (r.basis === 'tbc') return 'TBC';
    return '';
  }
}
