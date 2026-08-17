import { NextRequest, NextResponse } from 'next/server';
import { requireCapability } from '@/lib/api/guard';
import { applyMutation } from '@/lib/command/server/mutation';
import { vocabularyFor } from '@/lib/command/server/vocabulary';
import { postgrestStore } from '@/lib/command/store/postgrest';
import { readContext } from '@/lib/command/server/context';

export const dynamic = 'force-dynamic';

/**
 * The one request that writes.
 *
 * It takes the sentence and two fingerprints, and nothing else. Not a
 * plan, not a list of record ids, not the values to write: every one of
 * those would be the browser deciding what happens to a record, and the
 * whole point of the preview is that the server decided it and somebody
 * agreed.
 *
 * So this repeats everything. It authenticates again, derives the
 * actor's capabilities again, loads THEIR vocabulary again, plans the
 * raw text again, validates again, authorises the whole plan's derived
 * requirements again, and resolves the rows again. The fingerprints only
 * decide whether what it arrived at is what was previewed:
 *
 *   planHash       the sentence still means the same thing
 *   programmeHash  the rows still hold what they held
 *
 * Either mismatch returns a fresh reading or a fresh preview and writes
 * nothing. A client that sends no hashes never previewed anything and
 * gets the same refusal, because agreeing to a reading is part of
 * running a command rather than a step a client may skip.
 *
 * No capability is named in the gate. What this may do is decided by the
 * plan's own derived requirement set, which covers every field of every
 * step, and a single capability written here would be a second and
 * coarser answer to the same question.
 */
export async function POST(req: NextRequest) {
  const gate = await requireCapability();
  if (!gate.ok) return gate.response;
  const { supabase, user, caps } = gate;

  const raw = await req.json().catch(() => ({})) as {
    text?: unknown; planHash?: unknown; programmeHash?: unknown; confirm?: unknown;
    context?: unknown;
  };

  const text = typeof raw.text === 'string' ? raw.text : '';
  const planHash = typeof raw.planHash === 'string' ? raw.planHash : '';
  const programmeHash = typeof raw.programmeHash === 'string' ? raw.programmeHash : '';

  if (!text.trim()) {
    return NextResponse.json({ ok: false, error: 'no instruction' }, { status: 400 });
  }
  /* An explicit yes, in the request that writes. The first press of
     Enter previews; nothing reaches here without a second deliberate
     act, and a request that forgot to say so is refused rather than
     assumed to have meant it. */
  if (raw.confirm !== true || !planHash || !programmeHash) {
    return NextResponse.json({
      ok: false,
      error: 'not confirmed',
      message: 'Nothing was changed. Look at the preview and confirm it.',
    }, { status: 400 });
  }

  const outcome = await applyMutation({
    text,
    capabilities: caps,
    vocabulary: vocabularyFor(supabase, user.id),
    store: postgrestStore(supabase),
    context: readContext(raw.context),
    previewPlanHash: planHash,
    previewProgrammeHash: programmeHash,
  });

  if (outcome.ok) {
    /* THE FILE THE SAME SENTENCE ASKED FOR.
       "Create a list from them and export it to Excel" is one thing
       somebody confirmed, and this used to return the list and drop the
       spreadsheet on the floor. The bytes come back with the outcome
       rather than through a second request, because a second request
       would re-plan the sentence against a database the first one had
       already changed and could answer a different question.

       Base64 in JSON rather than a binary body, so the outcome and the
       artefact arrive together. An export is a few hundred kilobytes;
       a selection too large for its format was refused before any of
       this ran. */
    return NextResponse.json({
      ok: true,
      changed: outcome.changed,
      message: outcome.message,
      artefact: outcome.artefact
        ? {
            filename: outcome.artefact.filename,
            mime: outcome.artefact.mime,
            rows: outcome.artefactRows ?? 0,
            base64: Buffer.from(outcome.artefact.bytes).toString('base64'),
          }
        : null,
    });
  }

  return NextResponse.json({
    ok: false,
    reason: outcome.reason,
    message: outcome.why,
    /* The new reading, or the new preview, so the bar can show what it
       is now rather than an error about what it was. */
    restated: outcome.restated?.meaning ?? null,
    preview: outcome.preview ?? null,
  });
}
