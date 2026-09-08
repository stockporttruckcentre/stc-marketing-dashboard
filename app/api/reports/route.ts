import { NextRequest, NextResponse } from 'next/server';
import { requireCapability } from '@/lib/api/guard';
import { buildReport } from '@/lib/reports/build';
import { reportBySlug } from '@/lib/reports/catalogue';
import type { Division, Period, ReportFilters } from '@/lib/reports/types';

export const dynamic = 'force-dynamic';

/* =============================================================
   Running a report.

   POST { slug, divisions, period, person, exclude }

   Everything is validated here rather than trusted, for the ordinary
   reason and one specific one: `exclude` and `divisions` end up in
   queries, and a report is the one screen somebody will paste a link to
   in a message. A link somebody else opens has to be as safe as a form
   somebody filled in.

   Nothing about WHO may see WHAT is decided here. Every query in the
   builder runs as the caller, so row level security answers it: a rep
   running the bi-weekly report sees their own pipeline in it and the
   sales director sees everybody's, from the same code.
   ============================================================= */

const DIVISIONS: Division[] = ['stc', 'trailer', 'rental'];
const PERIODS: Period[] = ['week', 'fortnight', 'month', 'quarter', 'fy', 'year'];

export async function POST(req: NextRequest) {
  const gate = await requireCapability('crm.view');
  if (!gate.ok) return gate.response;

  const b = await req.json().catch(() => ({})) as Record<string, unknown>;
  const slug = String(b.slug ?? '');
  const def = reportBySlug(slug);
  if (!def) return NextResponse.json({ error: 'No such report.' }, { status: 400 });

  const asked = Array.isArray(b.divisions) ? b.divisions.map(String) : [];
  const divisions = DIVISIONS.filter((d) => asked.includes(d));

  const period = PERIODS.includes(b.period as Period) ? (b.period as Period) : 'fortnight';

  /* Only ids this report's own section list names. Anything else is
     either a typo or somebody editing a URL, and both should get the
     whole report rather than a silently emptier one. */
  const known = new Set(def.sections.map((s) => s.id));
  const exclude = (Array.isArray(b.exclude) ? b.exclude.map(String) : []).filter((s) => known.has(s));

  const filters: ReportFilters = {
    divisions,
    period,
    person: typeof b.person === 'string' && b.person ? b.person : null,
    exclude,
  };

  const made = await buildReport(gate.supabase as never, slug, filters);
  if ('error' in made) return NextResponse.json(made, { status: 400 });
  return NextResponse.json(made);
}
