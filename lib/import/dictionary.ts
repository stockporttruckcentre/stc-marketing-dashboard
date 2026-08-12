/* =============================================================
   What a column of somebody else's spreadsheet actually is.

   The old import took whatever headers a file happened to have and
   posted them straight at the database. On Dean's tracker that worked
   because Dean's tracker was the file it was written against. On
   anything else it silently dropped most of the sheet, which is the
   worst possible outcome: the import says "imported 340 contacts" and
   340 half empty rows appear.

   Two ways to recognise a column, because headers lie.

   Names. A dictionary of what people actually type. "em addrs",
   "E-Mail Address", "contact email" and "EMAIL" are one column. Matched
   after folding case, punctuation and spacing away, then by fuzzy
   distance so a typo still lands.

   Values. When the header is useless, or missing, or something nobody
   has seen before, the column is judged on what is in it. A column where
   most cells contain an @ is an email column whatever the header says.
   This is what catches "Column F" and "Unnamed: 3".

   A field is only claimed once. If two columns both look like the email,
   the stronger match wins and the other is reported as ignored rather
   than quietly overwriting.

   `target: null` is the important half of the dictionary. A trailer
   number in a customer import is not an unrecognised column, it is a
   recognised column with no home here, and the user is told so by name
   rather than left to notice 400 rows later.
   ============================================================= */

export type FieldKind = 'text' | 'email' | 'phone' | 'number' | 'money' | 'date' | 'status' | 'url';

export type FieldDef = {
  /** Column on the target table, or null when the field is knowingly not imported. */
  target: string | null;
  label: string;
  kind: FieldKind;
  /** Header spellings people actually use. Folded before comparison. */
  aliases: string[];
  /** Does this value look like this field? Used when the header is no help. */
  sniff?: (values: string[]) => number;
  /** Why it is dropped. Only set when target is null. */
  ignoredBecause?: string;
};

export type Dictionary = {
  entity: string;
  /** The field a row cannot be imported without. */
  required: string;
  /** How two rows are judged to be the same record, in priority order. */
  duplicateKeys: string[];
  fields: FieldDef[];
};

/* ---------- folding and value tests ---------- */

/** "E-Mail Address " and "email_address" meet here. */
export function fold(s: string): string {
  return String(s ?? '')
    .toLowerCase()
    .replace(/[‘’'"`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Damerau Levenshtein, capped.
 *
 * The transposition case is the reason. "Emial" for "email" and "Comapny"
 * for "company" are the two typos people actually make, and plain
 * Levenshtein scores both as two edits, which is the same distance as two
 * unrelated substitutions. Counting a swap as one edit lets the threshold
 * stay tight enough to refuse a genuine mismatch.
 */
export function distance(a: string, b: string): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > 3) return 99;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  const prevPrev = new Array(b.length + 1).fill(0);
  const curr = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      curr[j] = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      // A swapped pair of letters is one mistake, not two.
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        curr[j] = Math.min(curr[j], prevPrev[j - 2] + 1);
      }
    }
    for (let j = 0; j <= b.length; j++) { prevPrev[j] = prev[j]; prev[j] = curr[j]; }
  }
  return prev[b.length];
}

const nonEmpty = (values: string[]) => values.filter((v) => v != null && String(v).trim() !== '');

/** Share of non-empty cells that pass a test. Empty column scores nothing. */
function share(values: string[], test: (v: string) => boolean): number {
  const vals = nonEmpty(values);
  if (vals.length < 2) return 0;
  return vals.filter((v) => test(String(v).trim())).length / vals.length;
}

const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);
/** UK numbers, however they were typed: spaces, brackets, +44, leading apostrophe from Excel. */
const isPhone = (v: string) => {
  const d = v.replace(/[^\d+]/g, '');
  return /^(\+?44|0)\d{9,11}$/.test(d) || /^\d{10,11}$/.test(d);
};
const isUrl = (v: string) => /^(https?:\/\/|www\.)/i.test(v) || /^[a-z0-9-]+\.(co\.uk|com|net|org|uk)\/?$/i.test(v);
const isMoney = (v: string) => /^[£$€]?\s*-?[\d,]+(\.\d{1,2})?\s*(k|m)?$/i.test(v) && /\d/.test(v);
const isNumber = (v: string) => /^-?[\d,]+(\.\d+)?$/.test(v);
const isDate = (v: string) =>
  /^\d{4}-\d{2}-\d{2}/.test(v) ||
  /^\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}$/.test(v) ||
  /^\d{1,2}\s+[a-z]{3,9}\s+\d{2,4}$/i.test(v);

export const sniffers = {
  email: (v: string[]) => share(v, isEmail),
  phone: (v: string[]) => share(v, isPhone),
  url: (v: string[]) => share(v, isUrl),
  money: (v: string[]) => share(v, isMoney),
  number: (v: string[]) => share(v, isNumber),
  date: (v: string[]) => share(v, isDate),
};

/* =============================================================
   The CRM contact dictionary.
   ============================================================= */
export const CRM_CONTACTS: Dictionary = {
  entity: 'contact',
  required: 'company_name',
  // Email first: two firms can share a name, an address is a person.
  duplicateKeys: ['email', 'company_name'],
  fields: [
    {
      target: 'company_name', label: 'Company', kind: 'text',
      aliases: [
        'company', 'company name', 'business', 'business name', 'account',
        'account name', 'customer', 'customer name', 'client', 'client name',
        'organisation', 'organization', 'org', 'firm', 'trading name', 'name of company',
      ],
    },
    {
      target: 'contact_name', label: 'Contact name', kind: 'text',
      aliases: [
        'contact', 'contact name', 'name', 'full name', 'person', 'contact person',
        'first name', 'primary contact', 'decision maker', 'who', 'dm',
      ],
    },
    {
      target: 'email', label: 'Email', kind: 'email',
      aliases: [
        'email', 'e mail', 'email address', 'e mail address', 'em addrs', 'em addr',
        'emails', 'mail', 'contact email', 'work email', 'address email',
      ],
      sniff: sniffers.email,
    },
    {
      target: 'phone', label: 'Phone', kind: 'phone',
      aliases: [
        'phone', 'telephone', 'tel', 'tel no', 'phone number', 'phone no',
        'mobile', 'mob', 'contact number', 'number', 'landline', 'direct dial', 'dd',
      ],
      sniff: sniffers.phone,
    },
    {
      target: 'location', label: 'Town', kind: 'text',
      aliases: ['location', 'town', 'city', 'area', 'region', 'depot', 'based', 'based in', 'county'],
    },
    {
      target: 'address', label: 'Address', kind: 'text',
      aliases: ['address', 'full address', 'site address', 'postal address', 'street', 'addr'],
    },
    {
      target: 'status', label: 'Status', kind: 'status',
      aliases: ['status', 'stage', 'pipeline stage', 'lead status', 'state', 'progress'],
    },
    {
      target: 'assigned_to', label: 'Owner', kind: 'text',
      aliases: [
        'assigned', 'assigned to', 'owner', 'account manager', 'salesperson',
        'sales person', 'rep', 'sales rep', 'handler', 'responsible', 'am', 'bdm',
      ],
    },
    {
      target: 'turnover', label: 'Turnover', kind: 'money',
      aliases: ['turnover', 'revenue', 'annual turnover', 'sales', 'income', 'gross revenue'],
      sniff: sniffers.money,
    },
    {
      target: 'employee_count', label: 'Employees', kind: 'number',
      aliases: ['employees', 'employee count', 'staff', 'headcount', 'head count', 'no of employees', 'size'],
    },
    {
      target: 'trucks', label: 'Trucks', kind: 'number',
      aliases: ['trucks', 'truck', 'no of trucks', 'tractors', 'tractor units', 'units', 'hgv', 'hgvs'],
    },
    {
      target: 'trailers', label: 'Trailers', kind: 'number',
      aliases: ['trailers', 'trailer', 'no of trailers', 'trailer count', 'fleet trailers'],
    },
    { target: 'vans', label: 'Vans', kind: 'number', aliases: ['vans', 'van', 'no of vans', 'lcv', 'lcvs'] },
    {
      target: 'notes', label: 'Notes', kind: 'text',
      aliases: ['notes', 'note', 'comments', 'comment', 'remarks', 'detail', 'details', 'info', 'background'],
    },
    {
      target: 'last_contact', label: 'Last contact', kind: 'date',
      aliases: ['last contact', 'last contacted', 'last spoke', 'last call', 'last activity', 'last touch'],
      sniff: sniffers.date,
    },
    {
      target: 'date_of_enquiry', label: 'First enquiry', kind: 'date',
      aliases: ['enquiry date', 'date of enquiry', 'enquiry', 'first contact', 'date added', 'created', 'date'],
    },
    {
      target: 'source', label: 'Source', kind: 'text',
      aliases: ['source', 'lead source', 'origin', 'came from', 'referrer', 'how found'],
    },
    {
      target: 'estimated_value', label: 'Estimated value', kind: 'money',
      aliases: ['estimated value', 'value', 'deal value', 'opportunity value', 'potential', 'est value', 'pipeline value'],
    },
    {
      target: 'website', label: 'Website', kind: 'url',
      aliases: ['website', 'web', 'url', 'site', 'web address', 'domain', 'homepage'],
      sniff: sniffers.url,
    },

    /* ---- recognised, and deliberately not imported ----

       These exist so the user gets told the column was understood and
       dropped on purpose. Silence here is what makes an import feel like
       it ate half the file. */
    {
      target: null, label: 'Trailer or stock number', kind: 'text',
      aliases: [
        'stock number', 'stock no', 'stock', 'trailer number', 'trailer no',
        'chassis', 'chassis number', 'vin', 'fleet number', 'fleet no', 'asset number', 'reg', 'registration',
      ],
      ignoredBecause: 'belongs to the stock list, not a customer record',
    },
    {
      target: null, label: 'Price or cost', kind: 'money',
      aliases: [
        'price', 'sale price', 'cost', 'net book value', 'nbv', 'refurb cost',
        'purchase price', 'margin', 'profit', 'commission',
      ],
      ignoredBecause: 'a deal figure, and this import creates customers rather than deals',
    },
    {
      target: null, label: 'MOT or inspection date', kind: 'date',
      aliases: ['mot', 'mot expiry', 'mot due', 'inspection', 'inspection due', 'pmi', 'service due'],
      ignoredBecause: 'a vehicle compliance date with no place on a customer record',
    },
    {
      target: null, label: 'Spreadsheet bookkeeping', kind: 'text',
      aliases: ['row', 'row number', 'id', 'ref', 'reference', 'index', 'no', 'num', 'sheet', 'tab'],
      ignoredBecause: 'a spreadsheet row marker, not customer data',
    },
  ],
};
