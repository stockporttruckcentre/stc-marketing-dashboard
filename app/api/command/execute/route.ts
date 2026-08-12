import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/**
 * Carries out a command once it is fully understood.
 *
 * Every branch returns the same shape: a sentence saying what happened,
 * and where to go and look at it. The command bar never dumps the user
 * on a list page and leaves them to find the thing themselves.
 */
type Result = {
  ok: boolean;
  message: string;
  link?: { href: string; label: string };
  detail?: string;
};

async function trackerListId(supabase: any, userId: string): Promise<string | null> {
  const { data } = await supabase.from('crm_lists').select('id')
    .eq('owner_id', userId).eq('is_global', false)
    .ilike('name', '%Sales tracker%').limit(1).maybeSingle();
  return (data as any)?.id ?? null;
}

async function globalListId(supabase: any): Promise<string | null> {
  const { data } = await supabase.from('crm_lists').select('id').eq('is_global', true).limit(1).maybeSingle();
  return (data as any)?.id ?? null;
}

export async function POST(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { intentId, slots = {} } = await req.json().catch(() => ({})) as {
    intentId?: string; slots?: Record<string, any>;
  };

  const { data: profile } = await supabase.from('profiles').select('full_name').eq('id', user.id).single();
  const fullName = (profile as any)?.full_name ?? user.email;

  switch (intentId) {

    // ---------------------------------------------------------------
    case 'create_prospect': {
      const name = String(slots.contact ?? '').trim();
      if (!name) return NextResponse.json<Result>({ ok: false, message: 'I need a company name.' });
      const listId = (await trackerListId(supabase, user.id)) ?? (await globalListId(supabase));
      if (!listId) return NextResponse.json<Result>({ ok: false, message: 'No CRM list to add this to.' });

      const { data, error } = await supabase.from('crm_contacts').insert({
        company_name: name, status: 'lead', source: 'Command bar',
        list_id: listId, assigned_to: fullName,
        date_of_enquiry: new Date().toISOString().slice(0, 10),
      }).select('id, company_name').single();
      if (error) return NextResponse.json<Result>({ ok: false, message: error.message });

      return NextResponse.json<Result>({
        ok: true,
        message: `Added ${(data as any).company_name} as a lead.`,
        detail: 'Set a next action on it so it turns up on your dashboard.',
        link: { href: `/dashboard/leads?contact=${(data as any).id}`, label: 'Open the record' },
      });
    }

    // ---------------------------------------------------------------
    case 'create_stock_trailer': {
      const stcNo = String(slots.stockNo ?? '').trim().toUpperCase();
      if (!stcNo) return NextResponse.json<Result>({ ok: false, message: 'I need an STC number.' });

      const { data: existing } = await supabase.from('stock_trailers')
        .select('id, stc_no').ilike('stc_no', stcNo).limit(1).maybeSingle();
      if (existing) {
        return NextResponse.json<Result>({
          ok: false,
          message: `${stcNo} is already in the stock list.`,
          link: { href: `/dashboard/sales?stock=${(existing as any).id}`, label: 'Open it' },
        });
      }

      const { data, error } = await supabase.from('stock_trailers').insert({
        stc_no: stcNo,
        make: slots.make ?? null,
        model: slots.model ?? null,
        category: slots.category ?? null,
        status: slots.status ?? 'in_stock',
      }).select('id, stc_no').single();
      if (error) return NextResponse.json<Result>({ ok: false, message: error.message });

      return NextResponse.json<Result>({
        ok: true,
        message: `${stcNo} added to stock.`,
        link: { href: `/dashboard/sales?stock=${(data as any).id}`, label: 'Open the trailer' },
      });
    }

    // ---------------------------------------------------------------
    case 'schedule_call': {
      const when = slots.date ? new Date(slots.date) : null;
      if (!when || Number.isNaN(when.getTime())) {
        return NextResponse.json<Result>({ ok: false, message: 'I need a date for the call.' });
      }
      const contactId = slots.contactId ?? null;
      const who = slots.contactLabel ?? slots.contact ?? 'someone';
      const end = new Date(when.getTime() + 30 * 60 * 1000);

      const { data, error } = await supabase.from('calendar_events').insert({
        title: `Call with ${who}`,
        start_at: when.toISOString(),
        end_at: end.toISOString(),
        all_day: false,
        color: '#cf2417',
        created_by: user.id,
        contact_id: contactId,
        attendees: [{ user_id: user.id, name: fullName }],
        visibility: 'private',
        visible_to: [],
      }).select('id').single();
      if (error) return NextResponse.json<Result>({ ok: false, message: error.message });

      return NextResponse.json<Result>({
        ok: true,
        message: `Call with ${who} booked for ${when.toLocaleString('en-GB', {
          weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
        })}.`,
        detail: 'It is private to your calendar. Open it to invite anyone else.',
        link: { href: `/dashboard/calendar?event=${(data as any).id}`, label: 'Open the calendar' },
      });
    }

    // ---------------------------------------------------------------
    case 'create_contract':
    case 'create_proposal': {
      const who = slots.contactLabel ?? slots.contact ?? 'the customer';
      const listId = await trackerListId(supabase, user.id);
      if (!listId) {
        return NextResponse.json<Result>({
          ok: false,
          message: 'You need a sales tracker before a proposal can be raised.',
          link: { href: '/dashboard/leads', label: 'Open the tracker' },
        });
      }

      const count = Number(slots.count) || null;
      const axle = slots.axle ?? null;
      const product = slots.product ?? null;
      const extra = slots.money?.amount ? Number(slots.money.amount) : null;
      const perUnit = slots.money?.per === 'unit';

      const description = [
        product, count ? `${count} vehicle${count === 1 ? '' : 's'}` : null, axle,
        extra ? `plus ${new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 }).format(extra)}${perUnit ? ' per unit' : ''}${slots.money?.label ? ` ${slots.money.label}` : ''}` : null,
      ].filter(Boolean).join(', ');

      const estimated = extra != null && count ? (perUnit ? extra * count : extra) : null;

      const { data, error } = await supabase.from('crm_contacts').insert({
        list_id: listId,
        company_name: String(who),
        status: 'quoted',
        side: 'trailer_sales',
        source: 'Command bar',
        description: description || null,
        requirement: product ?? null,
        vehicles: count ? String(count) : null,
        estimated_value: estimated,
        assigned_to: fullName,
        date_of_enquiry: new Date().toISOString().slice(0, 10),
        last_activity_at: new Date().toISOString(),
      }).select('id, company_name').single();
      if (error) return NextResponse.json<Result>({ ok: false, message: error.message });

      return NextResponse.json<Result>({
        ok: true,
        message: `Raised a ${intentId === 'create_contract' ? 'contract' : 'proposal'} for ${(data as any).company_name}.`,
        detail: description || undefined,
        link: { href: `/dashboard/leads?contact=${(data as any).id}`, label: 'Open the proposal' },
      });
    }

    // ---------------------------------------------------------------
    case 'query_sold': {
      const from = slots.range?.from ? new Date(slots.range.from) : new Date(Date.now() - 90 * 86400000);
      const to = slots.range?.to ? new Date(slots.range.to) : new Date();
      let q = supabase.from('stock_trailers')
        .select('id, stc_no, make, model, sales_price, dispatch_date, customer')
        .eq('status', 'sold')
        .gte('dispatch_date', from.toISOString().slice(0, 10))
        .lte('dispatch_date', to.toISOString().slice(0, 10));
      const who = slots.contactLabel ?? slots.contact;
      if (who) q = q.ilike('customer', `%${who}%`);

      const { data, error } = await q;
      if (error) return NextResponse.json<Result>({ ok: false, message: error.message });
      const rows = (data ?? []) as any[];
      const total = rows.reduce((s, r) => s + (Number(r.sales_price) || 0), 0);
      const label = slots.rangeLabel ?? 'that period';

      return NextResponse.json<Result>({
        ok: true,
        message: rows.length === 0
          ? `No trailers sold${who ? ` to ${who}` : ''} in ${label}.`
          : `${rows.length} trailer${rows.length === 1 ? '' : 's'} sold${who ? ` to ${who}` : ''} in ${label}, worth ${new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 }).format(total)}.`,
        detail: rows.slice(0, 5).map((r) => `${r.stc_no ?? '?'} ${[r.make, r.model].filter(Boolean).join(' ')}`).join(', ') || undefined,
        link: { href: '/dashboard/sales', label: 'Open the stock list' },
      });
    }

    // ---------------------------------------------------------------
    case 'query_target_gap': {
      const month = new Date(); month.setDate(1);
      const { data: targetRow, error: tErr } = await supabase
        .from('revenue_targets').select('target_amount')
        .is('user_id', null).eq('period_month', month.toISOString().slice(0, 10)).maybeSingle();

      if (tErr || !targetRow) {
        return NextResponse.json<Result>({
          ok: false,
          message: 'No target has been loaded for this month, so there is nothing to measure against.',
          detail: 'Targets are set by an admin. Once one exists this answers instantly.',
        });
      }
      const target = Number((targetRow as any).target_amount);
      const { data: sold } = await supabase.from('stock_trailers')
        .select('sales_price').eq('status', 'sold')
        .gte('dispatch_date', month.toISOString().slice(0, 10));
      const booked = ((sold ?? []) as any[]).reduce((s, r) => s + (Number(r.sales_price) || 0), 0);
      const gap = target - booked;
      const gbp = (n: number) => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 }).format(n);

      return NextResponse.json<Result>({
        ok: true,
        message: gap <= 0
          ? `Target already met. ${gbp(booked)} booked against ${gbp(target)}.`
          : `${gbp(gap)} still to invoice this month. ${gbp(booked)} booked of ${gbp(target)}.`,
        link: { href: '/dashboard/analytics', label: 'Open analytics' },
      });
    }

    // ---------------------------------------------------------------
    case 'find_record': {
      const term = String(slots.contactLabel ?? slots.contact ?? '').trim();
      if (slots.contactId) {
        return NextResponse.json<Result>({
          ok: true,
          message: `Found ${term}.`,
          link: { href: `/dashboard/crm?contact=${slots.contactId}`, label: 'Open the record' },
        });
      }
      return NextResponse.json<Result>({
        ok: false,
        message: `Nothing in the CRM matches "${term}".`,
        detail: 'Try a shorter version of the name, or add it as a prospect.',
      });
    }
  }

  return NextResponse.json<Result>({ ok: false, message: 'I understood the words but not the request.' });
}
