import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { buildWorkbook } from '@/lib/ratecards/export-xlsx';
import type { FullCard } from '@/lib/ratecards/types';

export const dynamic = 'force-dynamic';

/* =============================================================
   Download a rate card as the customer's own workbook.

   The card is read through `rate_card_read`, the same function the
   screen uses, so the file and the screen cannot disagree about a
   price. That function checks `ratecard.view` inside the database, so
   this route does not check it again and cannot be out of step with it:
   a person without the capability gets the database's own refusal.
   ============================================================= */
export async function GET(
  request: Request,
  { params }: { params: { id: string } },
) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });
  }

  const format = new URL(request.url).searchParams.get('format') ?? 'xlsx';
  if (format !== 'xlsx') {
    /* The PDF is the print view rather than a file built here, because
       there is no PDF renderer in this installation and a button that
       downloads a PDF nobody generated is the kind of half-wired
       control this repository has a check for. */
    return NextResponse.json({
      error: 'A PDF is taken from the print view at /export/rate-card, not from this route.',
    }, { status: 400 });
  }

  const { data, error } = await supabase.rpc('rate_card_read', { p_card: params.id });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 403 });
  }
  if (!data) {
    return NextResponse.json({ error: 'No rate card with that id.' }, { status: 404 });
  }

  const card = data as FullCard;

  try {
    const workbook = await buildWorkbook(card);
    const year = new Date(card.card.effective_from).getFullYear();
    /* The master's own naming, so a customer filing it beside last
       year's finds them next to each other. */
    const name = `${card.card.customer_name} - Customer Rates ${year}.xlsx`;

    /* A fresh ArrayBuffer rather than the Buffer's own view of a pooled
       one: Node reuses allocation pools, and handing the response a
       view into a shared pool can send bytes belonging to another
       request. */
    const body = new Uint8Array(workbook).slice().buffer;

    return new NextResponse(body, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${name.replace(/"/g, '')}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (e) {
    return NextResponse.json({
      error: e instanceof Error ? e.message : 'The workbook could not be built.',
    }, { status: 500 });
  }
}
