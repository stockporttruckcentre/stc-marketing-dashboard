import { NextRequest, NextResponse } from 'next/server';
import { requireCapability } from '@/lib/api/guard';
import { slugify } from '@/lib/content/types';

export const dynamic = 'force-dynamic';

/* Structure above the post, which Buffer does not have at all. A launch
   is twenty posts across six channels over three weeks, and "how did
   the launch do" is the question somebody actually asks. */
export async function POST(req: NextRequest) {
  const gate = await requireCapability('social.draft');
  if (!gate.ok) return gate.response;
  const { supabase, user } = gate;

  const body = await req.json().catch(() => ({})) as {
    name?: string; description?: string; goal?: string;
    starts_on?: string | null; ends_on?: string | null;
  };
  const name = body.name?.trim();
  if (!name) {
    return NextResponse.json({ ok: false, error: 'bad_request', message: 'A campaign needs a name.' }, { status: 400 });
  }
  if (body.starts_on && body.ends_on && body.ends_on < body.starts_on) {
    return NextResponse.json(
      { ok: false, error: 'bad_request', message: 'A campaign cannot end before it starts.' },
      { status: 400 },
    );
  }

  const { data, error } = await supabase
    .from('social_campaigns')
    .insert({
      name,
      slug: slugify(name) || `campaign_${Date.now()}`,
      description: body.description?.trim() || null,
      goal: body.goal?.trim() || null,
      starts_on: body.starts_on || null,
      ends_on: body.ends_on || null,
      owner_id: user.id,
      created_by: user.id,
    })
    .select('*').single();

  if (error) {
    return NextResponse.json({ ok: false, error: 'create_failed', message: error.message }, { status: 400 });
  }
  return NextResponse.json({ ok: true, campaign: data });
}
