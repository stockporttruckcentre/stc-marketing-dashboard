import type { ExportModel } from './export-model';

/* =============================================================
   The export as an email body.

   Not the same markup as the on-screen document, and it cannot be.
   Outlook renders mail through Word, which means:

     - <style> blocks are stripped, so every rule is inline
     - CSS custom properties do not resolve, so colours are literal hex
     - flexbox and grid are ignored, so layout is tables
     - margins on block elements are unreliable, so spacing is cell padding

   Pasting the screen version into Outlook produces a stack of unstyled
   text. This produces something that survives.

   It is deliberately a fragment, not a whole document: it gets pasted
   above a signature that already exists in the compose window, so no
   <html>, <body> or reset.
   ============================================================= */

const NAVY = '#09163A';
const RED = '#CF2417';
const MUTED = '#46527A';
const SUBTLE = '#7A7A74';
const RULE = '#E2E2DE';
const PAPER = '#F7F7F5';

const esc = (s: any) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const FONT = "font-family:'Segoe UI',Calibri,Arial,sans-serif";

function sectionTitle(text: string) {
  return `<tr><td style="padding:22px 0 7px 0;border-bottom:1px solid ${RULE}">
    <span style="${FONT};font-size:11px;font-weight:bold;letter-spacing:1.4px;text-transform:uppercase;color:${RED}">${esc(text)}</span>
  </td></tr>`;
}

function fieldRows(fields: { label: string; value: string }[]) {
  return `<tr><td style="padding:6px 0 0 0">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse">
      ${fields.map((f, i) => `
        <tr${i % 2 === 0 ? ` style="background:${PAPER}"` : ''}>
          <td width="34%" style="${FONT};font-size:13px;color:${MUTED};padding:7px 10px;vertical-align:top">${esc(f.label)}</td>
          <td style="${FONT};font-size:14px;color:${NAVY};padding:7px 10px;vertical-align:top">${esc(f.value)}</td>
        </tr>`).join('')}
    </table>
  </td></tr>`;
}

export function exportEmailHtml(m: ExportModel): string {
  const parts: string[] = [];

  parts.push(`<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;max-width:660px">`);

  // masthead
  parts.push(`<tr><td style="padding:0 0 4px 0">
    <span style="${FONT};font-size:11px;font-weight:bold;letter-spacing:2px;text-transform:uppercase;color:${SUBTLE}">Stockport Truck Centre</span>
  </td></tr>`);
  parts.push(`<tr><td style="padding:0 0 3px 0">
    <span style="${FONT};font-size:26px;font-weight:bold;color:${NAVY};line-height:1.2">${esc(m.company)}</span>
  </td></tr>`);
  parts.push(`<tr><td style="padding:0 0 3px 0">
    <span style="${FONT};font-size:13px;color:${MUTED}">${esc(m.status.toUpperCase())} &nbsp;&middot;&nbsp; ${esc(m.subtitle)}</span>
  </td></tr>`);
  parts.push(`<tr><td style="padding:0 0 10px 0;border-bottom:2px solid ${NAVY}">
    <span style="${FONT};font-size:11px;color:${SUBTLE}">Exported by ${esc(m.generatedBy)} on ${esc(m.generatedAt)}</span>
  </td></tr>`);

  for (const s of m.sections) {
    parts.push(sectionTitle(s.title));
    parts.push(fieldRows(s.fields.map((f) => ({ label: f.label, value: f.value }))));
  }

  if (m.addresses.length) {
    parts.push(sectionTitle('Sites'));
    parts.push(`<tr><td style="padding:8px 0 0 0">
      ${m.addresses.map((a) => `
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;margin-bottom:8px">
          <tr>
            <td width="3" style="background:${a.primary ? RED : RULE};font-size:0;line-height:0">&nbsp;</td>
            <td style="background:${PAPER};padding:9px 12px">
              <div style="${FONT};font-size:14px;font-weight:bold;color:${NAVY};padding-bottom:2px">
                ${esc(a.label)}${a.primary ? ` <span style="font-size:10px;color:${RED};letter-spacing:1px">PRIMARY</span>` : ''}
              </div>
              <div style="${FONT};font-size:13px;color:${MUTED};line-height:1.5">${esc(a.address).replace(/\n/g, '<br>')}</div>
            </td>
          </tr>
        </table>`).join('')}
    </td></tr>`);
  }

  if (m.links.length) {
    parts.push(sectionTitle('Links'));
    parts.push(`<tr><td style="padding:6px 0 0 0">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse">
        ${m.links.map((l) => `<tr>
          <td width="34%" style="${FONT};font-size:13px;color:${MUTED};padding:5px 10px 5px 0">${esc(l.label)}</td>
          <td style="padding:5px 0"><a href="${esc(l.url)}" style="${FONT};font-size:13px;color:${RED}">${esc(l.url)}</a></td>
        </tr>`).join('')}
      </table>
    </td></tr>`);
  }

  if (m.notes.length) {
    parts.push(sectionTitle('Notes and history'));
    parts.push(`<tr><td style="padding:8px 0 0 0">
      ${m.notes.map((n) => `
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;margin-bottom:8px">
          <tr>
            <td width="3" style="background:${RED};font-size:0;line-height:0">&nbsp;</td>
            <td style="background:${PAPER};padding:9px 12px">
              <div style="${FONT};font-size:10px;font-weight:bold;letter-spacing:1.2px;text-transform:uppercase;color:${SUBTLE};padding-bottom:4px">
                ${esc(n.author)} &nbsp;&middot;&nbsp; ${esc(n.at)}
              </div>
              <div style="${FONT};font-size:14px;color:${NAVY};line-height:1.55">${esc(n.text).replace(/\n/g, '<br>')}</div>
            </td>
          </tr>
        </table>`).join('')}
    </td></tr>`);
  }

  parts.push(`<tr><td style="padding:18px 0 0 0;border-top:1px solid ${RULE}">
    <span style="${FONT};font-size:11px;color:${SUBTLE}">Generated from the STC CRM</span>
  </td></tr>`);
  parts.push(`</table>`);

  return parts.join('\n');
}
