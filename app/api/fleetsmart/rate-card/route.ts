import { NextRequest, NextResponse } from 'next/server';
import { requireCapability } from '@/lib/api/guard';
import { cardFrom, SHIPPED_CARD, whatChanged, type RateCard } from '@/lib/fleetsmart/ratecard';

export const dynamic = 'force-dynamic';

/* =============================================================
   Saving a rate card.

   ---- What the browser is allowed to send ----

   A whole card, and it is read through `cardFrom` before anything is
   stored. That is not politeness: a card missing its rates prices every
   line at nothing, and the first anybody would know about it is a
   contract going out at zero. `cardFrom` fills every missing field from
   the card STC ships, so the worst a malformed body can do is save the
   shipped prices under a new name.

   The database checks the same thing again in `fleetsmart_save_rate_card`,
   because a route is not the only way into a table.

   ---- Who ----

   `fleetsmart.discount`, which is the permission that already means
   "may change what something costs". Building a contract is not the
   right to set a price and the capability register says so in as many
   words, so the person who prices a fleet is not automatically the
   person who decides what a brake test costs.

   ---- The note ----

   Worked out here by comparing the incoming card with the one in use,
   rather than taken from the body. A note somebody typed says whatever
   they meant to change. A note derived from the two cards says what
   actually changed, which is the thing anybody reading the history in
   six months needs.
   ============================================================= */

export async function POST(req: NextRequest) {
  const gate = await requireCapability('fleetsmart.discount');
  if (!gate.ok) return gate.response;
  const { supabase } = gate;

  const body = await req.json().catch(() => ({})) as { version?: unknown; card?: unknown };

  const version = typeof body.version === 'string' ? body.version.trim() : '';
  if (!version) {
    return bad('Give the rate card a name, so a contract can say what it was priced against.');
  }
  if (version.length > 40) {
    return bad('That name is too long. A date like 2026-09 is what these are usually called.');
  }

  const incoming: RateCard = cardFrom(body.card, version);

  /* What is in use now, so the note says what moved rather than what
     somebody meant to move. */
  const { data: current } = await supabase
    .rpc('fleetsmart_current_rate_card')
    .maybeSingle();

  const before = current
    ? cardFrom((current as { card: unknown }).card, (current as { version: string }).version)
    : SHIPPED_CARD;

  const changes = whatChanged(before, incoming);
  const note = changes.length === 0
    ? `Saved from ${before.version} with nothing changed.`
    : `${changes.length} change${changes.length === 1 ? '' : 's'} from ${before.version}. `
      + changes.slice(0, 12).join('. ')
      + (changes.length > 12 ? `. And ${changes.length - 12} more.` : '.');

  const { data, error } = await supabase.rpc('fleetsmart_save_rate_card', {
    p_version: version,
    p_card: incoming,
    p_note: note,
  });

  if (error) {
    return NextResponse.json(
      { ok: false, error: 'refused', message: error.message.replace(/^ERROR:\s*/, '') },
      { status: 400 },
    );
  }

  return NextResponse.json({ ok: true, card: data, changes });
}

/** Going back to a version already saved. */
export async function PATCH(req: NextRequest) {
  const gate = await requireCapability('fleetsmart.discount');
  if (!gate.ok) return gate.response;

  const body = await req.json().catch(() => ({})) as { version?: unknown };
  const version = typeof body.version === 'string' ? body.version.trim() : '';
  if (!version) return bad('Name the version to go back to.');

  const { data, error } = await gate.supabase.rpc('fleetsmart_use_rate_card', {
    p_version: version,
  });

  if (error) {
    return NextResponse.json(
      { ok: false, error: 'refused', message: error.message.replace(/^ERROR:\s*/, '') },
      { status: 400 },
    );
  }
  return NextResponse.json({ ok: true, card: data });
}

function bad(message: string) {
  return NextResponse.json({ ok: false, error: 'bad_request', message }, { status: 400 });
}
