import { NextRequest, NextResponse } from 'next/server';
import { requireCapability } from '@/lib/api/guard';
import { applyMutation } from '@/lib/command/server/mutation';
import { vocabularyFor } from '@/lib/command/server/vocabulary';
import { postgrestStore } from '@/lib/command/store/postgrest';
import { bucketStore } from '@/lib/social/media';
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
    context?: unknown; acknowledge?: unknown;
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
    /* Somewhere to put bytes that are not a row: a picture on a post is
       a file on a bucket and a URL in a column. The port is what lets
       the whole path be checked with no bucket anywhere. */
    files: bucketStore(supabase),
    context: readContext(raw.context),
    previewPlanHash: planHash,
    previewProgrammeHash: programmeHash,
    /* How many records the caller is agreeing to remove. Only a
       destructive plan reads it, and one that needs it and does not get
       it comes back with a fresh preview rather than a smaller
       deletion. */
    acknowledge: typeof raw.acknowledge === 'number' ? raw.acknowledge : undefined,
  });

  if (outcome.ok) {
    /* THE FILE THE SAME SENTENCE ASKED FOR, AS A FILE.

       "Create a list from them and export it to Excel" is one thing
       somebody confirmed, and this used to return the list and drop the
       spreadsheet on the floor. It comes back from the SAME request,
       because a second one would re-plan the sentence against a
       database the first had already changed and could answer a
       different question.

       As the response body, not as base64 inside JSON. A workbook of a
       complete selection can be tens of megabytes, and base64 makes it
       a third larger again, then the browser holds the JSON string, the
       decoded binary string and the byte array at once. The export
       system was deliberately made capable of complete selections of
       any size; putting the result through a JSON string would put the
       limit straight back.

       What the command DID travels in the headers beside it. */
    if (outcome.artefact) {
      return new NextResponse(new Blob([outcome.artefact.bytes as unknown as BlobPart]), {
        status: 200,
        headers: {
          'Content-Type': outcome.artefact.mime,
          'Content-Disposition': `attachment; filename="${outcome.artefact.filename}"`,
          'X-Command-Changed': String(outcome.changed),
          'X-Command-Rows': String(outcome.artefactRows ?? 0),
          /* Encoded, because a header is Latin-1 and a message can hold
             a company name with anything in it. */
          'X-Command-Message': encodeURIComponent(outcome.message),
          'Cache-Control': 'no-store',
        },
      });
    }

    return NextResponse.json({
      ok: true,
      changed: outcome.changed,
      message: outcome.message,
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
