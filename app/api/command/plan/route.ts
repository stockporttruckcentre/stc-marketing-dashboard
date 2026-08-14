import { NextRequest, NextResponse } from 'next/server';
import { requireCapability } from '@/lib/api/guard';
import { planAuthoritatively } from '@/lib/command/server/planner';
import { supabaseVocabulary } from '@/lib/command/server/vocabulary';

export const dynamic = 'force-dynamic';

/**
 * What this application understands a sentence to mean.
 *
 * The bar shows what comes back from here and nothing it worked out
 * itself. It plans locally as well, to decide whether a half typed
 * sentence is worth asking about at all, but the reading a person is
 * shown and agrees to is this one.
 *
 * That matters because the two sides do not know the same things. The
 * live vocabulary is what makes a word a make or a customer, and until
 * the server loaded the same vocabulary the browser had, the same text
 * could honestly mean two things.
 *
 * Not a second planner. It calls `planCommand` through
 * `planAuthoritatively`, which is what the query route calls too.
 *
 * The response carries a hash of the meaning. Execution sends it back
 * and the server replans from the text and compares, so a reading that
 * has changed since it was shown is previewed again rather than run.
 */
export async function POST(req: NextRequest) {
  const gate = await requireCapability();
  if (!gate.ok) return gate.response;
  const { supabase, caps } = gate;

  /* Only the sentence is read. There is no shape a client could send
     that this would treat as a plan. */
  const raw = await req.json().catch(() => ({})) as { text?: unknown };
  const text = typeof raw.text === 'string' ? raw.text : '';
  if (!text.trim()) return NextResponse.json({ ok: false, error: 'no question' }, { status: 400 });

  const planned = await planAuthoritatively({
    text,
    capabilities: caps,
    vocabulary: supabaseVocabulary(supabase),
  });

  if (!planned) {
    return NextResponse.json({ ok: false, understood: false }, { status: 200 });
  }

  return NextResponse.json({ ok: true, understood: true, ...planned.meaning });
}
