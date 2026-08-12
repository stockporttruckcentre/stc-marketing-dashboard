/* =============================================================
   What a customer export actually contains.

   One shape, built once on the server, then rendered as a page, a
   spreadsheet or a document. Without this the three formats drift and
   the Word version quietly ends up missing a field the PDF has.

   The export exists to be handed to somebody: a colleague picking up the
   account, a manager before a meeting, a file note. So it leads with who
   the customer is and where the relationship stands, not with database
   columns in schema order.
   ============================================================= */
import type { CRMContact, ContactNote, ContactAddress, CrmList } from '@/lib/types';

export type ExportField = { label: string; value: string; numeric?: number | null };
export type ExportSection = { title: string; fields: ExportField[] };

export type ExportModel = {
  company: string;
  subtitle: string;
  status: string;
  generatedAt: string;
  generatedBy: string;
  sections: ExportSection[];
  addresses: { label: string; address: string; city: string; primary: boolean }[];
  links: { label: string; url: string; kind: string }[];
  notes: { author: string; at: string; atISO: string; text: string }[];
};

const gbp = (n: number | null | undefined) =>
  n == null ? '' : new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 }).format(Number(n));

const dateOnly = (s: string | null | undefined) =>
  s ? new Date(s).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : '';

export function buildExportModel(
  c: CRMContact,
  notes: ContactNote[],
  addresses: ContactAddress[],
  list: CrmList | undefined,
  generatedBy: string,
): ExportModel {
  const fleetTotal = (c.trucks ?? 0) + (c.trailers ?? 0) + (c.vans ?? 0);

  return {
    company: c.company_name,
    subtitle: [c.contact_name, c.location, list?.name].filter(Boolean).join(' · '),
    status: c.status,
    generatedAt: new Date().toLocaleString('en-GB', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
    }),
    generatedBy,
    sections: [
      {
        title: 'Who to speak to',
        fields: [
          { label: 'Contact name', value: c.contact_name ?? '' },
          { label: 'Email', value: c.email ?? '' },
          { label: 'Phone', value: c.phone ?? '' },
          { label: 'Account owner', value: c.assigned_to ?? '' },
        ],
      },
      {
        title: 'Where it stands',
        fields: [
          { label: 'Status', value: c.status },
          { label: 'Estimated value', value: gbp(c.estimated_value), numeric: c.estimated_value },
          { label: 'Sale price', value: gbp(c.sale_price), numeric: c.sale_price },
          { label: 'First enquiry', value: dateOnly(c.date_of_enquiry) },
          { label: 'Last contact', value: dateOnly(c.last_contact) },
          { label: 'Source', value: c.source ?? '' },
        ],
      },
      {
        title: 'The business',
        fields: [
          { label: 'Employees', value: c.employee_count?.toLocaleString() ?? '', numeric: c.employee_count },
          { label: 'Turnover', value: gbp(c.turnover), numeric: c.turnover },
          { label: 'Trucks', value: c.trucks?.toString() ?? '', numeric: c.trucks },
          { label: 'Trailers', value: c.trailers?.toString() ?? '', numeric: c.trailers },
          { label: 'Vans', value: c.vans?.toString() ?? '', numeric: c.vans },
          { label: 'Total fleet', value: fleetTotal ? fleetTotal.toString() : '', numeric: fleetTotal || null },
        ],
      },
    ].map((s) => ({ ...s, fields: s.fields.filter((f) => f.value !== '') }))
      .filter((s) => s.fields.length > 0),

    addresses: addresses.map((a) => ({
      label: a.label, address: a.address ?? '', city: a.city ?? '', primary: a.is_primary,
    })),
    links: (c.links ?? []).map((l) => ({ label: l.label, url: l.url, kind: l.kind })),
    notes: notes.map((n) => ({
      author: n.author_name,
      at: new Date(n.created_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
      atISO: n.created_at,
      text: n.text,
    })),
  };
}

/** Filename stem shared by every format, so a set of exports sorts together. */
export function exportStem(company: string) {
  return `${company.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}-${new Date().toISOString().slice(0, 10)}`;
}
