/* =============================================================
   Changing what somebody is allowed to do.

     make Dave an admin
     elevate dave to admin
     change Tom's role to sales
     set Rama to read only
     demote Gareth to viewer

   THE HIGHEST RISK WRITE IN THIS APPLICATION.

   Every capability hangs off `profiles.role`, so one word here decides
   who can see a colleague's accounts, spend Lusha credits, delete
   records and change other people's roles in turn. It was left out of
   the command bar on the grounds that the admin screen's confirmation
   is the point, and that reason does not hold: the bar's confirmation
   IS a confirmation. The sentence is planned on the server, the person
   is resolved exactly, the preview names them with the old role and the
   new one, and the whole thing is planned and resolved again from the
   raw text before anything is written.

   What makes it safe is not which screen it happens on. It is that the
   person is resolved exactly and never guessed, that the capability is
   checked by the database as well as by the runtime, and that the write
   is one transaction.

   THE PERSON IS A REFERENCE, NOT AN ID.

   "Dave" goes into the plan as a lookup, the same shape a share's
   recipients use, so a plan built at ten past means the same thing as
   the identical sentence at quarter past. Two people called Dave is a
   question with two answers and the runtime asks it.
   ============================================================= */
import type { Cond, Expr, Invoke } from './ir/types';
import { capability } from './ir/registry';
import type { CrmCapabilities } from '@/lib/crm/permissions';

export type RolePlan = {
  step: Invoke;
  summary: string;
  requires: string;
  confidence: number;
  /** The words that named the person, for the preview. */
  who: string;
  role: string;
};

/**
 * What people call each role.
 *
 * Grouped rather than listed as sentences, for the usual reason. The
 * stored value is what `profiles.role` holds and what
 * `lib/crm/permissions.ts` reads, so the two cannot drift into two
 * different ideas of what "restricted" means.
 */
const ROLE_WORDS: { role: string; words: string[] }[] = [
  { role: 'admin', words: ['admin', 'administrator', 'admins', 'full access', 'superuser'] },
  { role: 'sales', words: ['sales', 'sales rep', 'rep', 'salesperson', 'account manager'] },
  {
    role: 'marketer',
    words: ['marketer', 'marketing', 'restricted', 'limited', 'editor'],
  },
  {
    role: 'viewer',
    words: ['viewer', 'read only', 'readonly', 'view only', 'read access', 'no access'],
  },
];

/** Verbs that mean "change what this person may do". */
const VERBS = [
  'make', 'set', 'change', 'elevate', 'promote', 'demote', 'upgrade', 'downgrade',
  'grant', 'give', 'move',
];

/** Words that sit between the verb and the name without adding anything. */
const FILLER = new Set([
  'a', 'an', 'the', 'to', 'into', 'as', 'up', 'down', 'role', 'access', 'permissions',
  'please', 'user', 'account', 'profile', 'of', 'for', 'their', 'his', 'her', 'them',
]);

const soften = (s: string) =>
  ` ${s.toLowerCase().replace(/[^a-z0-9@.' ]+/g, ' ').replace(/\s+/g, ' ').trim()} `;

/** The role a sentence names, longest phrase first. */
function roleIn(text: string): { role: string; said: string } | null {
  const t = soften(text);
  let best: { role: string; said: string } | null = null;
  for (const r of ROLE_WORDS) {
    for (const w of r.words) {
      if (!t.includes(` ${w} `)) continue;
      if (!best || w.length > best.said.length) best = { role: r.role, said: w };
    }
  }
  return best;
}

/**
 * The person, as a lookup rather than as a row id.
 *
 * Matches a full name loosely and an email address exactly, which is
 * how people refer to colleagues here: by first name most of the time
 * and by address when two of them share one.
 */
function personNamed(name: string): Cond {
  return {
    kind: 'or',
    of: [
      {
        kind: 'cmp', op: 'contains',
        left: { kind: 'field', of: { entity: 'people', field: 'full_name' } },
        right: { kind: 'literal', value: name },
      },
      {
        kind: 'cmp', op: 'eq',
        left: { kind: 'field', of: { entity: 'people', field: 'email' } },
        right: { kind: 'literal', value: name },
      },
    ],
  };
}

/**
 * Read a role change, or nothing.
 *
 * `null` for everything that is not one, which is nearly every
 * sentence. A reader this dangerous refuses early and often: no verb,
 * no role word, or no name and it is not this.
 */
export function parseRoleChange(
  raw: string, caps?: CrmCapabilities,
): RolePlan | null {
  const t = soften(raw);

  const verb = VERBS.filter((v) => t.includes(` ${v} `)).sort((a, b) => b.length - a.length)[0];
  if (!verb) return null;

  const wanted = roleIn(raw);
  if (!wanted) return null;

  const cap = capability('user.setRole');
  if (!cap || !cap.requires) return null;
  /* Nothing you cannot do is ever offered. A sales rep typing "elevate
     dave to admin" sees nothing at all, rather than something that
     appears and then refuses. */
  if (caps && !caps.has(cap.requires)) return null;

  /* Whoever is left once the verb, the role and the filler have gone.
     Taken off the RAW text so the preview shows the name the way it was
     typed: softening it first turned "Dave Ashworth" into "dave
     ashworth" and asked somebody to confirm a stranger.

     Deliberately not clever about which words are a name. A colleague
     is called whatever the profile says, and a reader that tries to be
     selective drops half of "Dave Ashworth". */
  const words = raw
    .replace(/'s\b/gi, ' ')
    .replace(new RegExp(`\\b${verb}\\b`, 'i'), ' ')
    .replace(new RegExp(`\\b${wanted.said.replace(/\s+/g, '\\s+')}\\b`, 'i'), ' ')
    .replace(/[^A-Za-z0-9@.' ]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .filter((w) => !FILLER.has(w.toLowerCase()));

  const who = words.join(' ').trim();
  if (who.length < 2) return null;
  /* A name, not a sentence. Four words is longer than any name in this
     database and shorter than any clause. */
  if (words.length > 4) return null;

  const person: Expr = {
    kind: 'reference',
    entity: 'people',
    where: personNamed(who),
    select: 'id',
    /* Two people called Dave is a real possibility, and giving the
       wrong one the run of the CRM is not a thing to guess at. */
    onAmbiguity: 'ask',
  };

  return {
    step: {
      op: 'invoke',
      id: 'r1',
      capability: 'user.setRole',
      /* One person. Two colleagues called Dave is a question, and
         promoting both is the worst answer available. */
      expect: 'one',
      subject: {
        op: 'select',
        from: { entity: 'people' },
        where: personNamed(who),
        produces: { kind: 'rows', entity: 'people' },
      },
      args: {
        role: { kind: 'literal', value: wanted.role },
        /* Carried so the requirement derivation sees the profiles read
           this performs, rather than only the write. */
        person,
      },
      produces: { kind: 'record', entity: 'people' },
    },
    /* "Change Dave to admin" rather than "make Dave an admin", because
       the same wording has to read properly for all four roles and
       "make Tom a sales" does not. */
    summary: `Change ${who} to ${wanted.role}`,
    requires: cap.requires,
    who,
    role: wanted.role,
    confidence: 13,
  };
}
