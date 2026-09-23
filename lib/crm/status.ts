import type { Tone } from '@/components/kit/primitives';
import type { ContactStatus } from '@/lib/types';

/* =============================================================
   What a status looks like, decided once.

   Which tone a state carries is a product judgement, not a styling one,
   so it lives here rather than in the kit: quoted is the accent because
   it is the state somebody has to act on, and lost is neutral because a
   lost quote is an outcome rather than an error.

   It was written out inside the CRM tab, so the tracker drew its own
   pills from a stylesheet and the two disagreed about what "won" looks
   like.
   ============================================================= */
export const STATUS_TONE: Record<string, Tone> = {
  lead: 'info', contacted: 'warning', quoted: 'accent',
  won: 'success', lost: 'neutral',
  /* Kept so a row still carrying the old word draws as won rather than
     as nothing at all. Nothing writes it any more: migration 146. */
  customer: 'success',
};

/* How far along a deal is, in the order it actually moves. Sorting on
   the status column groups the pipeline by progress rather than by the
   first letter of the word, which is what somebody scanning a tracker
   means when they click that header.

   Lost sits at the end rather than at the start. It is an outcome, not
   a stage before Lead, and a sort that opens with everything you failed
   to win is a sort nobody uses twice. */
export const STATUS_ORDER: ContactStatus[] = [
  'lead', 'contacted', 'quoted', 'won', 'lost',
];

export const STATUS_LABEL: Record<ContactStatus, string> = {
  lead: 'Lead', contacted: 'Contacted', quoted: 'Quoted',
  won: 'Won', lost: 'Lost',
};

/* ---- THE WORD THAT WENT ----

   `customer` was a second name for won. From the business: "Then we
   have a status for Customer, which means won anyway. We only need 1
   status, Won."

   Migration 146 moves every row that held it. This reads anything that
   somehow still says it, an old export being imported, a row written by
   something that has not been restarted, and calls it what it is.
   Nothing in this application writes it. */
export function statusOf(raw: string | null | undefined): ContactStatus {
  const s = String(raw ?? '').toLowerCase();
  if (s === 'customer' || s === 'converted') return 'won';
  return (STATUS_ORDER as string[]).includes(s) ? (s as ContactStatus) : 'lead';
}
