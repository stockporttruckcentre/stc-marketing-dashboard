import { NextRequest, NextResponse } from 'next/server';
import { requireCapability } from '@/lib/api/guard';
import { planForExecution } from '@/lib/command/server/planner';
import { vocabularyFor } from '@/lib/command/server/vocabulary';
import { postgrestStore } from '@/lib/command/store/postgrest';
import { runEmit } from '@/lib/command/server/emit';

export const dynamic = 'force-dynamic';

/**
 * The file a sentence asked for.
 *
 * Same environment as every other command: the actor is authenticated
 * here, their capabilities are derived here, their vocabulary is loaded
 * here, and the raw text is planned here. The hash decides whether the
 * reading somebody was shown is the reading that runs.
 *
 * There is no format in this route and no entity either. Both are in the
 * plan, which is why "export the sold curtainsiders as a Word document"
 * and "give me a pdf of every proposal quoted this quarter" arrive at
 * the same twenty lines.
 *
 * Nothing is written. A download is a read with a file on the end of it,
 * so it does not ask for a confirmation the way a change does. What it
 * does need is `crm.export`, which the plan derives from the emit step's
 * own capability and the gate below checks along with everything else
 * the plan requires.
 */
export async function POST(req: NextRequest) {
  const gate = await requireCapability();
  if (!gate.ok) return gate.response;
  const { supabase, user, caps, fullName } = gate;

  const raw = await req.json().catch(() => ({})) as { text?: unknown; hash?: unknown };
  const text = typeof raw.text === 'string' ? raw.text : '';
  const previewHash = typeof raw.hash === 'string' ? raw.hash : '';
  if (!text.trim()) return NextResponse.json({ error: 'no request' }, { status: 400 });

  const agreement = await planForExecution({
    text,
    previewHash,
    capabilities: caps,
    vocabulary: vocabularyFor(supabase, user.id),
  });

  if (!agreement.agreed && agreement.reason === 'not understood') {
    return NextResponse.json({ error: 'nothing in that matched anything here' }, { status: 400 });
  }
  if (!agreement.agreed) {
    return NextResponse.json({
      error: 'what that means has changed since you typed it',
      restated: true,
      ...agreement.planned.meaning,
    }, { status: 409 });
  }

  const { planning, meaning } = agreement.planned;

  if (!planning.availability.permitted) {
    return NextResponse.json({
      error: 'you do not have access to that',
      missing: planning.availability.missingPermissions,
    }, { status: 403 });
  }
  if (!planning.availability.representable || meaning.completion === 'refused') {
    return NextResponse.json({ error: 'that plan will not run', problems: meaning.blocked }, { status: 400 });
  }
  if (!planning.availability.executable) {
    return NextResponse.json({
      error: 'nothing here can carry that out yet',
      missing: planning.availability.unavailable.map((u) => `${u.need}: ${u.why}`),
    }, { status: 501 });
  }

  const done = await runEmit(planning, {
    store: postgrestStore(supabase),
    actorName: fullName,
    now: new Date(),
  });

  if (!done.ok) {
    return NextResponse.json({ error: done.why }, { status: done.reason === 'unsupported' ? 501 : 400 });
  }

  /* The file itself, not a link to one. Nothing is stored, so there is
     nothing to clean up afterwards and nothing sitting in a bucket with
     somebody's customer list in it. */
  return new NextResponse(new Blob([done.artefact.bytes as unknown as BlobPart]), {
    status: 200,
    headers: {
      'Content-Type': done.artefact.mime,
      'Content-Disposition': `attachment; filename="${done.artefact.filename}"`,
      'X-Command-Rows': String(done.rows),
      'X-Command-Capped': done.capped ? '1' : '0',
      'Cache-Control': 'no-store',
    },
  });
}
