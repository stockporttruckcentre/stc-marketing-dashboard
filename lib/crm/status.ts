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
  won: 'success', customer: 'success', lost: 'neutral',
};

/* How far along a deal is, in the order it actually moves. Sorting on
   the status column groups the pipeline by progress rather than by the
   first letter of the word, which is what somebody scanning a tracker
   means when they click that header.

   Lost sits at the end rather than at the start. It is an outcome, not
   a stage before Lead, and a sort that opens with everything you failed
   to win is a sort nobody uses twice. */
export const STATUS_ORDER: ContactStatus[] = [
  'lead', 'contacted', 'quoted', 'won', 'customer', 'lost',
];

export const STATUS_LABEL: Record<ContactStatus, string> = {
  lead: 'Lead', contacted: 'Contacted', quoted: 'Quoted',
  won: 'Won', customer: 'Customer', lost: 'Lost',
};
