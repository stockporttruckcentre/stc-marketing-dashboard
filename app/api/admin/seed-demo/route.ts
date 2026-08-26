import { NextRequest, NextResponse } from 'next/server';
import { requireCapability } from '@/lib/api/guard';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Demo data, so a dashboard can be judged with something on it.
 *
 * Everything written here carries source 'DEMO' or a DEMO- prefixed
 * identifier, and `POST { "mode": "wipe" }` removes exactly those rows
 * and nothing else. Real records are never touched.
 *
 * Seeds against the calling user by default. Pass an email to target
 * somebody else; admin only.
 */

const DEMO = 'DEMO';
const DAY = 86_400_000;

/**
 * Insert rows that may reference columns the database does not have yet.
 *
 * The dashboard migration adds last_activity_at, but nothing forces it to
 * have been run, and the seeder must work either way. PostgREST reports an
 * unknown column by name, so strip whichever one it names and try again.
 */
async function insertTolerant(
  supabase: any, table: string, rows: any[], select = 'id',
): Promise<{ data: any[] | null; error: any; dropped: string[] }> {
  let payload = rows;
  const dropped: string[] = [];
  for (let attempt = 0; attempt < 6; attempt++) {
    const { data, error } = await supabase.from(table).insert(payload).select(select);
    if (!error) return { data, error: null, dropped };

    // PGRST204: "Could not find the 'x' column of 'y' in the schema cache"
    // 42703:    "column \"x\" of relation \"y\" does not exist"
    const m = String(error.message ?? '').match(/'([a-z_]+)' column|column "([a-z_]+)"/i);
    const col = m?.[1] ?? m?.[2];
    if (!col || !payload.some((r) => col in r)) return { data: null, error, dropped };

    dropped.push(col);
    payload = payload.map((r) => { const { [col]: _drop, ...rest } = r; return rest; });
  }
  return { data: null, error: { message: 'too many unknown columns' }, dropped };
}
const iso = (d: Date) => d.toISOString();
const day = (d: Date) => d.toISOString().slice(0, 10);
const ago = (n: number) => new Date(Date.now() - n * DAY);
const ahead = (n: number, hour = 10) => {
  const d = new Date(Date.now() + n * DAY); d.setHours(hour, 0, 0, 0); return d;
};

/** Open work. Some deliberately stale so "gone quiet" has something to show. */
const PIPELINE = [
  { company: 'TIP Trailers',        contact: 'Marie Vance',    status: 'quoted',    value: 184_000, quietDays: 21, vehicles: '4' },
  { company: 'Dawson Group',        contact: 'Ian Dawson',     status: 'quoted',    value: 96_500,  quietDays: 12, vehicles: '3' },
  { company: 'Fowler Welch',        contact: 'Priya Nair',     status: 'contacted', value: 74_200,  quietDays: 16, vehicles: '2' },
  { company: 'Gregory Distribution',contact: 'Sam Gregory',    status: 'quoted',    value: 61_800,  quietDays: 9,  vehicles: '2' },
  { company: 'Maritime Transport',  contact: 'Lewis Cardy',    status: 'contacted', value: 48_000,  quietDays: 3,  vehicles: '1' },
  { company: 'Culina Logistics',    contact: 'Hannah Reed',    status: 'quoted',    value: 132_000, quietDays: 2,  vehicles: '4' },
  { company: 'Turners of Soham',    contact: 'Rob Turner',     status: 'contacted', value: 27_500,  quietDays: 31, vehicles: '1' },
  { company: 'Bibby Distribution',  contact: 'Alan Prior',     status: 'lead',      value: 15_000,  quietDays: 1,  vehicles: '1' },
  { company: 'Knights of Old',      contact: 'Jess Wray',      status: 'quoted',    value: 88_400,  quietDays: 8,  vehicles: '3' },
  { company: 'Suttons Group',       contact: 'Michael Sutton', status: 'contacted', value: 39_900,  quietDays: 5,  vehicles: '1' },
  { company: 'A&A Scaffolding',     contact: 'Dean Ackroyd',   status: 'lead',      value: 12_400,  quietDays: 4,  vehicles: '1' },
];

/** Closed business, for the revenue and portfolio figures. */
const CLOSED = [
  { company: 'Wincanton',        contact: 'Ellie Marsh',  sale: 118_000, profit: 21_400, daysAgo: 6 },
  { company: 'Malcolm Logistics',contact: 'Craig Malcolm',sale: 74_500,  profit: 12_900, daysAgo: 18 },
  { company: 'TIP Trailers',     contact: 'Marie Vance',  sale: 152_000, profit: 28_800, daysAgo: 34 },
  { company: 'Pollock Scotrans', contact: 'Iain Pollock', sale: 46_750,  profit: 7_300,  daysAgo: 58 },
  { company: 'XPO Logistics',    contact: 'Nadia Khan',   sale: 205_000, profit: 34_100, daysAgo: 71 },
];

/** Sold stock, so "how many trailers have we sold to X" can answer. */
const SOLD_STOCK = [
  { stc: 'DEMO-STC90121', make: 'Schmitz',  model: 'S.KO Cool',  customer: 'TIP Trailers',      price: 38_500, daysAgo: 9 },
  { stc: 'DEMO-STC90122', make: 'Schmitz',  model: 'S.CS Universal', customer: 'TIP Trailers',  price: 36_900, daysAgo: 24 },
  { stc: 'DEMO-STC90123', make: 'Krone',    model: 'Profi Liner', customer: 'TIP Trailers',     price: 41_200, daysAgo: 47 },
  { stc: 'DEMO-STC90124', make: 'Don Bur',  model: 'Teardrop',    customer: 'Wincanton',        price: 44_000, daysAgo: 12 },
  { stc: 'DEMO-STC90125', make: 'SDC',      model: 'Curtainsider',customer: 'Malcolm Logistics',price: 33_750, daysAgo: 30 },
  { stc: 'DEMO-STC90126', make: 'Krone',    model: 'Box Liner',   customer: 'XPO Logistics',    price: 52_400, daysAgo: 66 },
];

const IN_STOCK = [
  { stc: 'DEMO-STC90201', make: 'Schmitz', model: 'S.KO Cool',    category: 'Fridge',       status: 'in_stock' },
  { stc: 'DEMO-STC90202', make: 'Don Bur', model: 'Teardrop',     category: 'Curtainsider', status: 'in_stock' },
  { stc: 'DEMO-STC90203', make: 'SDC',     model: 'Flatbed',      category: 'Flat',         status: 'new_build' },
  { stc: 'DEMO-STC90204', make: 'Krone',   model: 'Profi Liner',  category: 'Curtainsider', status: 'sales_order' },
];

export async function POST(req: NextRequest) {
  /* Admin whoever it targets. The old check only fired when an email
     named somebody else, so a viewer could seed and wipe against
     themselves, and the wipe deletes every stc_no LIKE 'DEMO-%' row on
     the stock list rather than only their own. */
  const gate = await requireCapability('admin.users');
  if (!gate.ok) return gate.response;
  const { supabase, user } = gate;
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({})) as { mode?: 'seed' | 'wipe'; email?: string };
  const mode = body.mode ?? 'seed';

  const { data: me } = await supabase.from('profiles').select('id, full_name, role, email').eq('id', user.id).single();
  let target = me as any;

  if (body.email && body.email !== (me as any)?.email) {
    if ((me as any)?.role !== 'admin') {
      return NextResponse.json({ error: 'only an admin can seed another account' }, { status: 403 });
    }
    const { data: other } = await supabase.from('profiles').select('id, full_name, role, email').eq('email', body.email).single();
    if (!other) return NextResponse.json({ error: `no profile for ${body.email}` }, { status: 404 });
    target = other;
  }

  const fullName: string = target.full_name || target.email;
  const initials = fullName.split(/\s+/).map((s: string) => s[0]).join('').toUpperCase();

  /* WHERE THE DEMO ACCOUNTS GO.

     This used to make the rep a private tracker list and write every
     deal onto it as a company. That is the shape the duplicates came
     from: TIP Trailers is quoted for more work below and has already
     bought from us, and one company written twice is two companies.

     Accounts go on the shared pipeline, the same place a real one goes,
     and each pitch is a lead against the account. TIP Trailers ends up
     as one customer with three pitches, which is the thing worth
     showing somebody. */
  const { data: pipeline } = await supabase.from('crm_lists')
    .select('id, name').eq('is_global', true).limit(1).maybeSingle();
  const pipelineId = (pipeline as any)?.id as string | undefined;
  const pipelineName = (pipeline as any)?.name ?? 'CRM pipeline';

  // ---------------- wipe ----------------
  const wiped: Record<string, number> = {};

  const { data: goneLeads } = await supabase.from('crm_leads').delete()
    .eq('owner_id', target.id).like('notes', `${DEMO}%`).select('id');
  wiped.leads = goneLeads?.length ?? 0;

  /* The accounts go too, but only the ones nothing points at any more.
     A demo company somebody has since raised a real lead against is a
     real customer now, and deleting it takes their lead with it. */
  const { data: demoAccounts } = await supabase.from('crm_contacts')
    .select('id').eq('source', DEMO);
  const demoIds = ((demoAccounts ?? []) as { id: string }[]).map((r) => r.id);
  if (demoIds.length) {
    const { data: stillPitched } = await supabase.from('crm_leads')
      .select('contact_id').in('contact_id', demoIds);
    const keep = new Set(((stillPitched ?? []) as { contact_id: string }[]).map((r) => r.contact_id));
    const removable = demoIds.filter((id) => !keep.has(id));
    if (removable.length) {
      const { data: gone } = await supabase.from('crm_contacts').delete()
        .in('id', removable).select('id');
      wiped.accounts = gone?.length ?? 0;
    }
  }

  const { data: goneStock } = await supabase.from('stock_trailers').delete()
    .like('stc_no', 'DEMO-%').select('id');
  wiped.stock = goneStock?.length ?? 0;

  const { data: goneEvents } = await supabase.from('calendar_events').delete()
    .eq('created_by', target.id).like('title', `${DEMO}%`).select('id');
  wiped.meetings = goneEvents?.length ?? 0;

  // Optional tables. Ignore failures: they may not exist yet.
  await supabase.from('notifications').delete().eq('user_id', target.id).like('title', `${DEMO}%`);
  await supabase.from('revenue_targets').delete().eq('user_id', target.id);

  if (mode === 'wipe') {
    return NextResponse.json({ ok: true, mode, target: fullName, wiped });
  }

  // ---------------- seed ----------------
  if (!pipelineId) {
    return NextResponse.json({
      error: 'there is no shared CRM pipeline to put the demo accounts on',
    }, { status: 500 });
  }
  const created: Record<string, number> = {};

  // One account per company, however many times it is pitched to below.
  const companies = new Map<string, string>();
  for (const p of PIPELINE) if (!companies.has(p.company)) companies.set(p.company, p.contact);
  for (const c of CLOSED) if (!companies.has(c.company)) companies.set(c.company, c.contact);

  const slug = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');
  const accountRows = [...companies].map(([company, contact], i) => ({
    source: DEMO, side: 'trailer_sales',
    company_name: company, contact_name: contact,
    email: `${contact.split(' ')[0].toLowerCase()}@${slug(company)}.co.uk`,
    phone: `0161 4${String(100000 + i * 4177).slice(0, 6)}`,
    assigned_to: fullName.split(' ')[0],
    account_manager: initials,
    location: 'North West',
    last_activity_at: iso(ago(1)),
  }));

  const accountsRes = await insertTolerant(supabase, 'crm_contacts', accountRows, 'id, company_name');
  if (accountsRes.error) {
    return NextResponse.json({ error: `accounts: ${accountsRes.error.message}` }, { status: 500 });
  }
  const accounts = accountsRes.data ?? [];
  created.accounts = accounts.length;

  const byName = new Map(accounts.map((a: any) => [a.company_name, a.id as string]));

  const { error: memberErr } = await supabase.from('crm_list_contacts')
    .insert(accounts.map((a: any) => ({ list_id: pipelineId, contact_id: a.id })));
  if (memberErr) {
    return NextResponse.json({ error: `pipeline: ${memberErr.message}` }, { status: 500 });
  }

  /* The pitches. Some deliberately stale, so "gone quiet" has something
     to find, and the closed ones so the revenue figures are not zero. */
  const leadRows = [
    ...PIPELINE.map((p) => ({
      contact_id: byName.get(p.company), owner_id: target.id, created_by: target.id,
      type: 'trailer_sales', status: p.status,
      estimated_value: p.value,
      what: `${p.vehicles} unit requirement`,
      requirement: 'Trailer supply',
      new_or_used: 'Used',
      rep_initials: initials,
      date_of_enquiry: day(ago(p.quietDays + 6)),
      last_activity_at: iso(ago(p.quietDays)),
      notes: `${DEMO} ${p.status === 'quoted' ? 'Quote issued' : 'Initial discussion'}`,
    })),
    ...CLOSED.map((c) => ({
      contact_id: byName.get(c.company), owner_id: target.id, created_by: target.id,
      type: 'trailer_sales', status: 'customer',
      sale_price: c.sale, profit: c.profit,
      commission: Number((c.profit * 0.1).toFixed(2)), commission_rate: 0.1,
      rep_initials: initials,
      order_date: day(ago(c.daysAgo)),
      dispatch_date: day(ago(Math.max(0, c.daysAgo - 5))),
      date_of_enquiry: day(ago(c.daysAgo + 30)),
      last_activity_at: iso(ago(c.daysAgo)),
      notes: `${DEMO} Delivered and invoiced`,
    })),
  ];

  const leadsRes = await insertTolerant(supabase, 'crm_leads', leadRows, 'id');
  if (leadsRes.error) return NextResponse.json({ error: `leads: ${leadsRes.error.message}` }, { status: 500 });
  created.leads = leadsRes.data?.length ?? 0;


  const stockRes = await insertTolerant(supabase, 'stock_trailers', [
    ...SOLD_STOCK.map((s) => ({
      stc_no: s.stc, make: s.make, model: s.model, status: 'sold',
      category: 'Curtainsider', customer: s.customer, sales_rep: initials,
      sales_price: s.price, profit: Math.round(s.price * 0.18),
      profit_pct: 18, order_date: day(ago(s.daysAgo + 7)), dispatch_date: day(ago(s.daysAgo)),
      year: 2023, location: 'Bredbury', new_or_used: 'Used',
    })),
    ...IN_STOCK.map((s) => ({
      stc_no: s.stc, make: s.make, model: s.model, status: s.status,
      category: s.category, year: 2024, location: 'Hyde', new_or_used: 'New',
      nbv: 28_000, retail_price: 36_500,
    })),
  ]);
  if (stockRes.error) return NextResponse.json({ error: `stock: ${stockRes.error.message}` }, { status: 500 });
  created.stock = stockRes.data?.length ?? 0;

  // Meetings: two today so the action queue is populated, plus the week.
  const meetings = [
    { title: `${DEMO} Call with Dawson Group`,      at: ahead(0, new Date().getHours() + 1), company: 'Dawson Group' },
    { title: `${DEMO} Site visit, Culina Logistics`,at: ahead(0, new Date().getHours() + 3), company: 'Culina Logistics' },
    { title: `${DEMO} Review with TIP Trailers`,    at: ahead(2, 11), company: 'TIP Trailers' },
    { title: `${DEMO} Quote walkthrough, Fowler Welch`, at: ahead(4, 14), company: 'Fowler Welch' },
  ];
  const eventsRes = await insertTolerant(supabase, 'calendar_events',
    meetings.map((m) => ({
      title: m.title,
      start_at: iso(m.at),
      end_at: iso(new Date(m.at.getTime() + 45 * 60 * 1000)),
      all_day: false, color: '#cf2417',
      created_by: target.id,
      contact_id: byName.get(m.company) ?? null,
      attendees: [{ user_id: target.id, name: fullName }],
      visibility: 'private', visible_to: [],
    })),
  );
  if (eventsRes.error) return NextResponse.json({ error: `meetings: ${eventsRes.error.message}` }, { status: 500 });
  created.meetings = eventsRes.data?.length ?? 0;

  // Optional tables. Report rather than fail if the migration has not run.
  const optional: Record<string, string> = {};

  const { error: notifErr } = await supabase.from('notifications').insert([
    { user_id: target.id, kind: 'lead_assigned', title: `${DEMO} New lead assigned to you`, body: 'A&A Scaffolding enquired about a curtainsider.', link_path: '/dashboard/leads' },
    { user_id: target.id, kind: 'system_alert',  title: `${DEMO} TIP Trailers has gone quiet`, body: 'No activity for 21 days on a £184,000 quote.', link_path: '/dashboard' },
    { user_id: target.id, kind: 'message',       title: `${DEMO} Tom left a note on Wincanton`, body: 'Deposit cleared, ready to dispatch.', link_path: '/dashboard/leads' },
  ]);
  optional.notifications = notifErr ? `skipped: ${notifErr.message}` : 'seeded';

  const month = new Date(); month.setDate(1);
  const { error: targetErr } = await supabase.from('revenue_targets').insert([
    { user_id: target.id, period_month: day(month), target_amount: 250_000 },
    { user_id: null,      period_month: day(month), target_amount: 1_100_000 },
  ]);
  optional.targets = targetErr ? `skipped: ${targetErr.message}` : 'seeded';

  const { error: ownErr } = await supabase.from('account_ownership').insert(
    accounts.slice(0, 10).map((a: any) => ({ contact_id: a.id, user_id: target.id, role_on_account: 'owner' })),
  );
  optional.account_ownership = ownErr ? `skipped: ${ownErr.message}` : 'seeded';

  const skippedColumns = Array.from(new Set([
    ...accountsRes.dropped, ...leadsRes.dropped, ...stockRes.dropped, ...eventsRes.dropped,
  ]));

  return NextResponse.json({
    ok: true, mode, target: fullName, list: pipelineName,
    wiped, created, optional,
    skippedColumns: skippedColumns.length ? skippedColumns : undefined,
    migrationNote: skippedColumns.length
      ? `Seeded without ${skippedColumns.join(', ')}. Run supabase/migrations/001_dashboard.sql to add them.`
      : undefined,
    note: 'Everything is marked DEMO. POST {"mode":"wipe"} to remove it and nothing else.',
  });
}
