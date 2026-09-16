import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { buildWorkbook } from '@/lib/ratecards/export-xlsx';
import { buildRateCardPdf } from '@/lib/ratecards/export-pdf';
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

  /* ---- Two formats, one card ----

     From the agreed development scope, Task 6:

       `/api/rate-cards/[id]/export?format=pdf` should return a real PDF
       rather than refusing and telling the user to use the print view.

     It used to refuse. Both are built here now, and both are built from
     `sheetGrid`: the same cells, in the same columns, in the same
     order. The workbook gets them written into a copy of the master so
     the customer's file keeps the master's own styling; the PDF draws
     the same grid on a page. Neither decides what is on the card. */
  const format = new URL(request.url).searchParams.get('format') ?? 'xlsx';
  if (format !== 'xlsx' && format !== 'pdf') {
    return NextResponse.json({
      error: `There is no ${format} rate card. Ask for xlsx or pdf.`,
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
    const year = new Date(card.card.effective_from).getFullYear();
    /* The master's own naming, so a customer filing it beside last
       year's finds them next to each other. */
    const name = `${card.card.customer_name} - Customer Rates ${year}.${format}`;

    if (format === 'pdf') {
      const pdf = await buildRateCardPdf(card);
      return new NextResponse(new Uint8Array(pdf).slice().buffer, {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="${name.replace(/"/g, '')}"`,
          'Cache-Control': 'no-store',
        },
      });
    }

    const workbook = await buildWorkbook(card);

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
      error: e instanceof Error ? e.message : 'The file could not be built.',
    }, { status: 500 });
  }
}
