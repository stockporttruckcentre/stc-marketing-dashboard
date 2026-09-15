'use client';

/* =============================================================
   Every call the Rate Card Builder makes.

   All of them are RPCs, because migration 110 revoked INSERT, UPDATE
   and DELETE on all six tables from `authenticated`. That is not
   ceremony: a card is what the admin team bills a customer against, so
   there is exactly one way in and it checks a capability first.

   Each function returns `{ ok: true, value }` or `{ ok: false, why }`
   with the database's own sentence in `why`. The screens print that
   sentence rather than inventing one, because the database knows why it
   refused and the browser is guessing.
   ============================================================= */
import { createClient } from '@/lib/supabase/client';
import type {
  FullCard, CardRow, ChangeRow, DuplicateVerdict, ChargeTo,
  TemplateRead, ResyncCandidate, TemplateChange,
} from './types';

export type Result<T> = { ok: true; value: T } | { ok: false; why: string };

function fail(e: { message?: string } | null, fallback: string): { ok: false; why: string } {
  return { ok: false, why: e?.message?.trim() || fallback };
}

const db = () => createClient();

/* ---- Reading ---- */

export async function listCards(status?: string | null): Promise<Result<CardRow[]>> {
  const { data, error } = await db().rpc('rate_cards_list', { p_status: status ?? null });
  if (error) return fail(error, 'The rate cards could not be loaded.');
  return { ok: true, value: (data ?? []) as CardRow[] };
}

export async function readCard(id: string): Promise<Result<FullCard>> {
  const { data, error } = await db().rpc('rate_card_read', { p_card: id });
  if (error) return fail(error, 'That rate card could not be loaded.');
  if (!data) return { ok: false, why: 'That rate card no longer exists.' };

  /* ---- The shape is checked rather than asserted ----

     `rate_card_read` returns one JSON object and the screen reads five
     lists out of it. A cast alone means a response that is not that
     object throws inside a render, which is a white screen with the
     reason only in the console. Found by pointing the screen at a
     stubbed endpoint that answered with an empty array.

     A shape that is wrong is a fault worth naming, so it is named. */
  const shaped = data as Partial<FullCard>;
  const missing = (['card', 'labour', 'rates', 'managers', 'fleetsmart', 'parts', 'missing'] as const)
    .filter((k) => shaped[k] === undefined || shaped[k] === null);
  if (missing.length > 0) {
    return {
      ok: false,
      why: `The database answered with something this screen cannot read: ${missing.join(', ')} `
         + `${missing.length === 1 ? 'is' : 'are'} missing. That is a fault in rate_card_read rather than in this card.`,
    };
  }

  return { ok: true, value: data as FullCard };
}

export async function history(id: string): Promise<Result<ChangeRow[]>> {
  const { data, error } = await db().rpc('rate_card_history', { p_card: id });
  if (error) return fail(error, 'The history could not be loaded.');
  return { ok: true, value: (data ?? []) as ChangeRow[] };
}

/** Does this customer already have one, and does it still matter. */
export async function checkCustomer(contactId: string): Promise<Result<DuplicateVerdict>> {
  const { data, error } = await db().rpc('rate_card_for_customer', { p_contact: contactId });
  if (error) return fail(error, 'That customer could not be checked.');
  const row = Array.isArray(data) ? data[0] : data;
  return { ok: true, value: (row ?? { verdict: 'none' }) as DuplicateVerdict };
}

/* ---- Writing ---- */

export async function createCard(args: {
  contactId: string; effective?: string | null; supersede?: boolean;
  contractId?: string | null;
  /** Another card to start from. Null means the current defaults. */
  copyFrom?: string | null;
}): Promise<Result<string>> {
  const { data, error } = await db().rpc('rate_card_create', {
    p_contact: args.contactId,
    p_effective: args.effective ?? null,
    p_supersede: args.supersede ?? false,
    p_contract: args.contractId ?? null,
    p_copy_from: args.copyFrom ?? null,
  });
  if (error) return fail(error, 'The rate card could not be created.');
  return { ok: true, value: data as string };
}

/** Returns how many derived rates followed, which the review dialog shows. */
export async function setLabour(
  card: string, pool: string, rate: number, chargeTo: ChargeTo = 'customer',
): Promise<Result<number>> {
  const { data, error } = await db().rpc('rate_card_set_labour', {
    p_card: card, p_pool: pool, p_rate: rate, p_charge_to: chargeTo,
  });
  if (error) return fail(error, 'That labour rate could not be changed.');
  return { ok: true, value: Number(data ?? 0) };
}

export async function addLabour(args: {
  card: string; pool: string; label: string; rate: number; chargeTo: ChargeTo; note?: string | null;
}): Promise<Result<string>> {
  const { data, error } = await db().rpc('rate_card_add_labour', {
    p_card: args.card, p_pool: args.pool, p_label: args.label,
    p_rate: args.rate, p_charge_to: args.chargeTo, p_note: args.note ?? null,
  });
  if (error) return fail(error, 'That labour rate could not be added.');
  return { ok: true, value: data as string };
}

export async function removeLabour(card: string, labourId: string): Promise<Result<true>> {
  const { error } = await db().rpc('rate_card_remove_labour', { p_card: card, p_labour: labourId });
  if (error) return fail(error, 'That labour rate could not be removed.');
  return { ok: true, value: true };
}

/** `value` of null reverts an override rather than setting one. */
export async function setRate(
  card: string, rateId: string, axle: number, value: number | null,
): Promise<Result<{ over_cap: boolean; cap: number | null; cap_by: string | null }>> {
  const { data, error } = await db().rpc('rate_card_set_rate', {
    p_card: card, p_rate_id: rateId, p_axle: axle, p_value: value,
  });
  if (error) return fail(error, 'That rate could not be changed.');
  const row = Array.isArray(data) ? data[0] : data;
  return { ok: true, value: row ?? { over_cap: false, cap: null, cap_by: null } };
}

export async function setDetail(card: string, field: string, value: string): Promise<Result<true>> {
  const { error } = await db().rpc('rate_card_set_detail', {
    p_card: card, p_field: field, p_value: value,
  });
  if (error) return fail(error, 'That detail could not be saved.');
  return { ok: true, value: true };
}

export async function setManagers(card: string, users: string[]): Promise<Result<number>> {
  const { data, error } = await db().rpc('rate_card_set_managers', { p_card: card, p_users: users });
  if (error) return fail(error, 'The account manager could not be saved.');
  return { ok: true, value: Number(data ?? 0) };
}

export async function showFleetsmart(card: string, show: boolean): Promise<Result<true>> {
  const { error } = await db().rpc('rate_card_show_fleetsmart', { p_card: card, p_show: show });
  if (error) return fail(error, 'That could not be changed.');
  return { ok: true, value: true };
}

export async function setStatus(card: string, status: string): Promise<Result<true>> {
  const { error } = await db().rpc('rate_card_set_status', { p_card: card, p_status: status });
  if (error) return fail(error, 'The status could not be changed.');
  return { ok: true, value: true };
}

export async function uplift(card: string, percent: number): Promise<Result<number>> {
  const { data, error } = await db().rpc('rate_card_uplift', { p_card: card, p_percent: percent });
  if (error) return fail(error, 'The uplift could not be applied.');
  return { ok: true, value: Number(data ?? 0) };
}

export async function resetToDefaults(
  card: string,
): Promise<Result<{ rates_moved: number; overrides_cleared: number }>> {
  const { data, error } = await db().rpc('rate_card_reset', { p_card: card });
  if (error) return fail(error, 'The card could not be reset.');
  const row = Array.isArray(data) ? data[0] : data;
  return { ok: true, value: row ?? { rates_moved: 0, overrides_cleared: 0 } };
}

/** What a new card can start from: the defaults, or another card. */
export async function cardSources(contactId?: string | null): Promise<Result<{
  card_id: string; card_ref: string; customer_name: string; card_status: string;
  effective_from: string; overrides: number; same_customer: boolean;
}[]>> {
  const { data, error } = await db().rpc('rate_card_sources', { p_contact: contactId ?? null });
  if (error) return fail(error, 'The cards you could copy could not be listed.');
  return { ok: true, value: data ?? [] };
}

/* ---- The defaults ---- */

export async function readDefaults(): Promise<Result<TemplateRead>> {
  const { data, error } = await db().rpc('rate_card_template_read');
  if (error) return fail(error, 'The default rates could not be loaded.');
  return { ok: true, value: data };
}

export async function setDefaultLabour(pool: string, rate: number): Promise<Result<number>> {
  const { data, error } = await db().rpc('rate_card_template_set_labour', {
    p_pool: pool, p_rate: rate,
  });
  if (error) return fail(error, 'That default could not be changed.');
  return { ok: true, value: Number(data ?? 0) };
}

export async function setDefaultRate(args: {
  rateId: string; axle: number; hours?: number | null; amount?: number | null; text?: string | null;
}): Promise<Result<number>> {
  const { data, error } = await db().rpc('rate_card_template_set_rate', {
    p_rate_id: args.rateId, p_axle: args.axle,
    p_hours: args.hours ?? null, p_amount: args.amount ?? null, p_text: args.text ?? null,
  });
  if (error) return fail(error, 'That default could not be changed.');
  return { ok: true, value: Number(data ?? 0) };
}

export async function resyncCandidates(): Promise<Result<ResyncCandidate[]>> {
  const { data, error } = await db().rpc('rate_card_resync_candidates');
  if (error) return fail(error, 'The cards could not be listed.');
  return { ok: true, value: data ?? [] };
}

export async function resyncOne(card: string): Promise<Result<number>> {
  const { data, error } = await db().rpc('rate_card_resync', { p_card: card });
  if (error) return fail(error, 'That card could not be brought into line.');
  return { ok: true, value: Number(data ?? 0) };
}

export async function resyncAll(): Promise<Result<number>> {
  const { data, error } = await db().rpc('rate_card_resync_all');
  if (error) return fail(error, 'The cards could not be brought into line.');
  return { ok: true, value: Number(data ?? 0) };
}

export async function defaultsHistory(): Promise<Result<TemplateChange[]>> {
  const { data, error } = await db().rpc('rate_card_template_history');
  if (error) return fail(error, 'The defaults history could not be loaded.');
  return { ok: true, value: data ?? [] };
}

/* ---- The customers a card can be made for ---- */

export async function customers(query: string): Promise<Result<
  { id: string; company_name: string; contact_name: string | null }[]
>> {
  let q = db().from('crm_contacts').select('id, company_name, contact_name')
    .order('company_name').limit(20);
  if (query.trim()) q = q.ilike('company_name', `%${query.trim()}%`);
  const { data, error } = await q;
  if (error) return fail(error, 'The customer list could not be loaded.');
  return { ok: true, value: data ?? [] };
}

export async function people(): Promise<Result<{ id: string; name: string }[]>> {
  const { data, error } = await db()
    .from('profiles').select('id, full_name, email').eq('is_active', true).order('full_name');
  if (error) return fail(error, 'The people list could not be loaded.');
  return {
    ok: true,
    value: (data ?? []).map((p: { id: string; full_name: string | null; email: string | null }) =>
      ({ id: p.id, name: p.full_name || p.email || 'Unnamed' })),
  };
}
