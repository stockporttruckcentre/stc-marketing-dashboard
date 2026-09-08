import { reportBySlug } from './catalogue';
import type { Division, Period, ReportFilters } from './types';

/* =============================================================
   A report, in a URL.

   Four places have to agree about what "Dean's won leads, last two
   weeks, maintenance only, without the summary" looks like as text:

     the hub, which builds the link
     the print page, which reads it
     the Word route, which reads it
     the API route, which reads the same thing as JSON

   Written out four times, three of them would be right. So it is
   written once here, in both directions, and `npm run check:reports`
   asserts that anything encoded comes back identical.

   ---- Why anything unrecognised is dropped rather than refused ----

   A report link gets pasted into a message and forwarded. By the time
   somebody opens it, a section id in it may no longer exist because the
   report grew or shrank. Refusing the link means a colleague sees an
   error for a report that runs perfectly well; dropping the unknown
   part means they see the whole report, which is the safe way to be
   wrong. The one thing never done is silently showing LESS than asked
   for, which is why `exclude` is filtered against the report's own
   section list rather than trusted.
   ============================================================= */

const DIVISIONS: Division[] = ['stc', 'trailer', 'rental'];
const PERIODS: Period[] = ['week', 'fortnight', 'month', 'quarter', 'fy', 'year'];

export const DEFAULT_PERIOD: Period = 'fortnight';

/** What a report opens on before anybody touches a filter. */
export function defaultFilters(): ReportFilters {
  return { divisions: [], period: DEFAULT_PERIOD, person: null, exclude: [] };
}

/**
 * Filters as query parameters.
 *
 * Anything at its default is left out, so the commonest link is short
 * enough to read: `/export/report?slug=biweekly`.
 */
export function toParams(slug: string, f: ReportFilters): URLSearchParams {
  const p = new URLSearchParams();
  p.set('slug', slug);
  if (f.divisions.length > 0 && f.divisions.length < DIVISIONS.length) {
    p.set('divisions', f.divisions.join(','));
  }
  if (f.period !== DEFAULT_PERIOD) p.set('period', f.period);
  if (f.person) p.set('person', f.person);
  if (f.exclude.length) p.set('exclude', f.exclude.join(','));
  return p;
}

type Params = URLSearchParams | Record<string, string | string[] | undefined>;

function one(params: Params, key: string): string {
  if (params instanceof URLSearchParams) return params.get(key) ?? '';
  const v = params[key];
  return Array.isArray(v) ? (v[0] ?? '') : (v ?? '');
}

function list(params: Params, key: string): string[] {
  const raw = one(params, key);
  return raw ? raw.split(',').map((s) => s.trim()).filter(Boolean) : [];
}

/** The slug, if it names a report that exists. */
export function slugFromParams(params: Params): string | null {
  const slug = one(params, 'slug');
  return reportBySlug(slug) ? slug : null;
}

/**
 * Filters from query parameters, validated against the report itself.
 *
 * This is the only reader. The API route validates the JSON body the
 * same way and for the same reason: a link is a form somebody else
 * filled in.
 */
export function fromParams(slug: string, params: Params): ReportFilters {
  const def = reportBySlug(slug);
  const known = new Set((def?.sections ?? []).map((s) => s.id));

  const asked = list(params, 'divisions');
  const period = one(params, 'period') as Period;
  const person = one(params, 'person');

  return {
    divisions: DIVISIONS.filter((d) => asked.includes(d)),
    period: PERIODS.includes(period) ? period : DEFAULT_PERIOD,
    person: person || null,
    exclude: list(params, 'exclude').filter((id) => known.has(id)),
  };
}

/** Where the printable copy of this report lives. */
export function printHref(slug: string, f: ReportFilters): string {
  return `/export/report?${toParams(slug, f).toString()}`;
}

/** Where the Word copy of this report comes from. */
export function docxHref(slug: string, f: ReportFilters): string {
  return `/api/reports/docx?${toParams(slug, f).toString()}`;
}
