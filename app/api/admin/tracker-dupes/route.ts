import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import postgres from 'postgres';

export const dynamic = 'force-dynamic';

/**
 * Scan a target user's Sales tracker list for duplicate companies and return groups.
 * Body: { target_email?: string  // defaults to current user }
 *       { delete?: boolean       // if true, deletes all but the OLDEST row per dupe group }
 */
export async function POST(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { data: caller } = await supabase.from('profiles').select('role').eq('id', user.id).single();
  if ((caller as any)?.role !== 'admin') return NextResponse.json({ error: 'admin only' }, { status: 403 });

  const body = await req.json().catch(() => ({})) as { target_email?: string; delete?: boolean; clear_all?: boolean };
  const targetEmail = body.target_email?.trim();
  let targetId = user.id;
  let targetName: string | null = null;
  if (targetEmail) {
    const { data: t } = await supabase.from('profiles').select('id, full_name').ilike('email', targetEmail).single();
    if (!t) return NextResponse.json({ error: `No profile for ${targetEmail}` }, { status: 404 });
    targetId = (t as any).id;
    targetName = (t as any).full_name;
  }

  const url = process.env.POSTGRES_URL || process.env.POSTGRES_URL_NON_POOLING;
  if (!url) return NextResponse.json({ error: 'POSTGRES_URL not set' }, { status: 500 });
  const sql = postgres(url, { ssl: 'require', max: 1, idle_timeout: 5, prepare: false });

  try {
    // Find target's tracker list
    const listRes = await sql<any[]>`
      SELECT id, name FROM crm_lists
      WHERE owner_id = ${targetId} AND is_global = false AND name ILIKE '%Sales tracker%'
      LIMIT 1`;
    if (!listRes.length) return NextResponse.json({ error: 'No Sales tracker list found for that user' }, { status: 404 });
    const listId = listRes[0].id;

    // clear_all: wipe every row from this tracker list (used to reset Alex's tracker after the visualisation import)
    if (body.clear_all) {
      const r = await sql`DELETE FROM crm_contacts WHERE list_id = ${listId} RETURNING id`;
      return NextResponse.json({ target: targetName ?? 'me', listId, cleared: r.length });
    }

    // Group by lowercased company_name, with a separate signature including side+contact for stricter dedup
    const dupGroups = await sql<any[]>`
      SELECT
        lower(company_name) AS key,
        side,
        COUNT(*)::int AS n,
        ARRAY_AGG(id ORDER BY created_at ASC) AS ids,
        ARRAY_AGG(company_name ORDER BY created_at ASC) AS names,
        ARRAY_AGG(contact_name ORDER BY created_at ASC) AS contacts,
        ARRAY_AGG(status ORDER BY created_at ASC) AS statuses,
        ARRAY_AGG(created_at ORDER BY created_at ASC) AS created_at_list
      FROM crm_contacts
      WHERE list_id = ${listId}
      GROUP BY lower(company_name), side
      HAVING COUNT(*) > 1
      ORDER BY n DESC, key`;

    if (!body.delete) {
      return NextResponse.json({
        target: targetName ?? 'me', listId,
        duplicateGroups: dupGroups.length,
        totalDuplicateRows: dupGroups.reduce((sum: number, g: any) => sum + (g.n - 1), 0),
        groups: dupGroups.map((g: any) => ({
          company: g.names[0],
          side: g.side,
          count: g.n,
          ids: g.ids,
          statuses: g.statuses,
          contacts: g.contacts,
        })),
      });
    }

    // DELETE: keep the oldest row in each group (first id), remove the rest
    const toDelete: string[] = [];
    for (const g of dupGroups) {
      const ids = g.ids as string[];
      toDelete.push(...ids.slice(1));
    }
    if (toDelete.length) {
      await sql`DELETE FROM crm_contacts WHERE id = ANY(${toDelete})`;
    }
    return NextResponse.json({
      target: targetName ?? 'me', listId,
      deleted: toDelete.length,
      keptOldestOf: dupGroups.length,
    });
  } finally { await sql.end({ timeout: 2 }); }
}
