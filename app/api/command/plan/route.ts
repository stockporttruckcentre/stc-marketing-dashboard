import { NextRequest, NextResponse } from 'next/server';
import { requireCapability } from '@/lib/api/guard';
import { planAndPreview } from '@/lib/command/server/mutation';
import { vocabularyFor } from '@/lib/command/server/vocabulary';
import { postgrestStore } from '@/lib/command/store/postgrest';
import { changedFields } from '@/lib/command/server/mutation';
import { emitStep } from '@/lib/command/server/emit';
import { readContext } from '@/lib/command/server/context';

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
 *
 * INSTRUCTIONS COME BACK THROUGH HERE TOO.
 *
 * A sentence is a question or an instruction, and which it is was
 * decided in the bar until now, by calling the instruction reader in the
 * browser. Two semantic authorities for one sentence is one too many, so
 * `planCommand` decides it, and this route reports it.
 *
 * `preview: true` asks for the exact change as well: which records,
 * their labels, and what each holds now beside what it would hold. That
 * reads rows, so it is not done on every keystroke. The bar asks for the
 * meaning while somebody types and for the preview when they press
 * Enter, and the preview writes nothing either way.
 */
export async function POST(req: NextRequest) {
  const gate = await requireCapability();
  if (!gate.ok) return gate.response;
  const { supabase, user, caps } = gate;

  /* Only the sentence is read. There is no shape a client could send
     that this would treat as a plan. */
  const raw = await req.json().catch(() => ({})) as {
    text?: unknown; preview?: unknown; context?: unknown;
  };
  const text = typeof raw.text === 'string' ? raw.text : '';
  if (!text.trim()) return NextResponse.json({ ok: false, error: 'no question' }, { status: 400 });

  const result = await planAndPreview({
    text,
    capabilities: caps,
    /* Their vocabulary, not the last person's. */
    vocabulary: vocabularyFor(supabase, user.id),
    /* Their rows, through their own RLS session. */
    store: postgrestStore(supabase),
    preview: raw.preview === true,
    /* What the screen had open or selected. Read into a shape this
       application declares rather than trusted as it arrives, and every
       id in it is read back through the caller's own session before
       anything is done with it. */
    context: readContext(raw.context),
  });

  if (!result) {
    return NextResponse.json({ ok: false, understood: false }, { status: 200 });
  }

  const { planned, preview } = result;

  return NextResponse.json({
    ok: true,
    understood: true,
    ...planned.meaning,
    kind: planned.planning.kind,
    /* What it would change, when it is an instruction. Present without
       the row level detail until a preview is asked for. */
    mutation: planned.planning.kind === 'mutate'
      ? { fields: changedFields(planned.planning.plan) }
      : null,
    /* What it would produce, when the sentence asked for a file. The bar
       needs this to know whether Enter answers on screen or downloads,
       and it is a property of the plan rather than of the words. */
    emit: (() => {
      const step = emitStep(planned.planning.plan);
      if (!step) return null;
      if (step.output.kind === 'file') {
        return { format: step.output.format, to: step.to.kind };
      }
      /* THE CLIPBOARD IS REPORTED TOO, AND IS NOT A FILE.

         Copying is a client effect: no server can write to somebody's
         clipboard, so what comes back here is the destination and the
         browser is what carries it out. Without this the bar answered
         the question on screen and copied nothing, which is the same
         gap as an action that opens a screen and calls it copying. */
      return step.to.kind === 'clipboard' ? { format: null, to: 'clipboard' } : null;
    })(),
    preview: preview ?? null,
  });
}
