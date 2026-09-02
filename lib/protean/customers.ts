/* =============================================================
   Deciding which CRM customer a Protean account is.

   Done once per account, and then never again: the answer is stored
   against Protean's own code, and every future import joins on the code
   rather than on a name. That is the whole point of doing this
   carefully today. Get it right once and the weekly import stops being
   a matching problem.

   ---- Why character similarity is not used ----

   It was, in the first pass over the real files, and it produced three
   suggestions of which two were wrong:

     AFB Logistics Ltd       ->  H&B Logistics          0.85   wrong
     Enterprise Flex-E-Rent  ->  Enterprise Flex-e-Rent 0.88   right
     Jama Logistics Limited  ->  Jasin Logistics        0.83   wrong

   The scores do not separate them. There is no threshold that keeps
   Enterprise and drops the other two, because "AFB Logistics" and "H&B
   Logistics" genuinely are similar strings. They are just not the same
   company.

   ---- What is used instead ----

   The brand: the first word left after the generic ones are stripped.
   `AFB` is not `H&B` and `Jama` is not `Jasin`, so neither is offered
   at all. `Enterprise` is `Enterprise`, `Booker` is `Booker`, `Dawson`
   is `Dawson`.

   Over all 199 accounts in the real export that gives 134 exact, 17 to
   confirm and 48 to create, and both wrong suggestions disappear.

   ---- And it still never decides ----

   Only an exact match after normalising binds on its own. Everything
   else is offered to a person with its candidates, and the default is
   to CREATE rather than to bind.

   That default is the important one. Wrongly creating a customer leaves
   a duplicate somebody can see and merge. Wrongly binding merges two
   companies' revenue into one record, silently, forever, and the first
   symptom is a figure in a board meeting that nobody can explain.
   ============================================================= */

/**
 * Words that never identify a company.
 *
 * Company suffixes, and the handful of nouns that appear in so many
 * haulage names that they carry no information: `Logistics`, `Transport`
 * and the like are deliberately NOT here, because "Montgomery Transport"
 * and "Montgomery Distribution" are different firms and dropping the
 * second word would merge them.
 */
const GENERIC = new Set([
  'limited', 'ltd', 'plc', 'llp', 'llc', 'inc', 'uk', 'gb',
  'group', 'holdings', 'holding', 'company', 'co', 'the',
  'ta', 'trading', 'as', 'and', 'international', 'int',
]);

/** The identifying words, spelled as the company spells them. */
export function keptWords(name: string): string[] {
  return name
    .normalize('NFKD')
    // eslint-disable-next-line no-control-regex
    .replace(/[^\x00-\x7F]/g, '')
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .split(' ')
    .filter((w) => w && !GENERIC.has(w.toLowerCase()));
}

/** A company name reduced to the words that identify it. */
export function words(name: string): string[] {
  return keptWords(name).map((w) => w.toLowerCase());
}

/** The one word that says which company this is. */
export function brand(name: string): string | null {
  return words(name)[0] ?? null;
}

export type Candidate = {
  id: string;
  name: string;
  /** How much of the shorter name the two have in common, 0 to 1. */
  overlap: number;
};

export type Verdict =
  /** Same name once the generic words are gone. Binds without asking. */
  | { kind: 'exact'; account: string; proteanName: string; contact: Candidate }
  /** Same brand, different words after it. A person decides. */
  | { kind: 'confirm'; account: string; proteanName: string; candidates: Candidate[] }
  /** Nothing shares a brand. Offered as a new customer. */
  | { kind: 'create'; account: string; proteanName: string };

export type CrmCustomer = { id: string; company_name: string };

/**
 * What to do with one Protean account.
 *
 * `candidates` is never empty for a `confirm` and is ordered best
 * first, but nothing is pre-selected: see the note at the top about
 * which way the two failure modes cut.
 */
export function decide(
  account: string,
  proteanName: string,
  crm: CrmCustomer[],
): Verdict {
  const mine = words(proteanName);
  if (!mine.length) return { kind: 'create', account, proteanName };

  const key = mine.join(' ');
  const mineSet = new Set(mine);
  const candidates: Candidate[] = [];

  for (const c of crm) {
    const theirs = words(c.company_name);
    if (!theirs.length) continue;

    if (theirs.join(' ') === key) {
      return {
        kind: 'exact',
        account,
        proteanName,
        contact: { id: c.id, name: c.company_name, overlap: 1 },
      };
    }

    /* No shared brand, no candidacy. This one line is what stops AFB
       being offered H&B. */
    if (theirs[0] !== mine[0]) continue;

    /* AND THE SHORTER NAME MUST BE HOW THE LONGER ONE STARTS.

       The business ruled on all eighteen the brand rule offered, and
       the seven it got right are all a shortening from the front:

         Novuna Vehicle Solutions   ->  Novuna
         Holman Fleet Limited       ->  Holman
         Hippo Waste Management     ->  Hippo Waste

       Every one of the eleven it got wrong shares the brand and then
       diverges:

         Montgomery Transport       vs  Montgomery Tank Services
         Alltruck Leicester         vs  Alltruck PLC, Shepley Windows
         Fleet Assist               vs  Fleet Operations

       Those are subsidiaries of the same group, and the business was
       explicit that each needs its own account. So a shared brand is
       not evidence of anything on its own; a shared brand followed by
       the same words in the same order is.

       The case that proves it has to be this strict is Dawson Rentals
       Vans against Dawson Vans. Every token of the shorter name is in
       the longer one, so any overlap measure scores it 1.00, and it is
       still a different company. Only the ORDER separates them: the
       shorter name skips `rentals`, so it is a subsequence and not a
       beginning.

       On the eighteen the business ruled on, this agrees eighteen
       times. */
    const [shorter, longer] = mine.length <= theirs.length ? [mine, theirs] : [theirs, mine];
    if (!shorter.every((word, i) => longer[i] === word)) continue;

    candidates.push({
      id: c.id,
      name: c.company_name,
      overlap: shorter.length / longer.length,
    });
  }

  if (!candidates.length) return { kind: 'create', account, proteanName };

  candidates.sort((a, b) => b.overlap - a.overlap || a.name.localeCompare(b.name));
  return { kind: 'confirm', account, proteanName, candidates: candidates.slice(0, 4) };
}

export type Review = {
  exact: Extract<Verdict, { kind: 'exact' }>[];
  confirm: Extract<Verdict, { kind: 'confirm' }>[];
  create: Extract<Verdict, { kind: 'create' }>[];
};

/** Every account in an export, sorted into the three buckets. */
export function review(
  accounts: { account: string; name: string }[],
  crm: CrmCustomer[],
): Review {
  const out: Review = { exact: [], confirm: [], create: [] };
  for (const a of accounts) {
    const v = decide(a.account, a.name, crm);
    if (v.kind === 'exact') out.exact.push(v);
    else if (v.kind === 'confirm') out.confirm.push(v);
    else out.create.push(v);
  }
  return out;
}

/* =============================================================
   Groups.

   The matcher above keeps subsidiaries apart, which is what the
   business asked for:

     an alpha makes an account unique ... 99% of the time when a company
     is a subsidiary it has it's own accounts and requires a unique
     protean account on our end and therefore is part of a group.

   Keeping them apart is only half of it. The other half is being able
   to ask what Montgomery is worth without opening three records, and
   still see what each of the three billed.

   So the shared brand is not thrown away. It is exactly the wrong
   evidence for binding two accounts together and exactly the right
   evidence for SUGGESTING they belong to one group, and the difference
   between the two is that a group can be wrong and be fixed in a click,
   whereas a bind merges two companies' revenue permanently.

   Nothing here groups anything. It proposes, and a person accepts.
   ============================================================= */

export type GroupSuggestion = {
  /** The words the members share, spelled as the first one spells them. */
  name: string;
  members: { account: string; name: string }[];
};

/**
 * Accounts that share a brand, offered as groups.
 *
 * The name is the longest run of leading words they all share, so three
 * Montgomery companies suggest `Montgomery` and two Holman accounts
 * suggest `Holman Fleet` rather than both collapsing to one word.
 *
 * False suggestions are expected and are the price of the feature:
 * `Fleet Assist` and `Fleet Operations` share a first word and are
 * strangers, so a Fleet group will be offered and should be declined.
 * That is survivable in a way that binding them would not be.
 *
 * What is NOT worth offering is a suggestion nobody could ever accept.
 * On the real export, `H&B Logistics` and `H&C Cardiem Limited` were
 * offered as a group called `H`, because an ampersand is a word break
 * and both names therefore start with the word `h`. So does `K
 * Cotterill Transport` against `K.Azmeh (Textiles)`. A queue with those
 * in it is a queue somebody skims instead of reading, and the real
 * Montgomery is in the same list.
 */
/** Below this, a shared beginning is a coincidence rather than a brand. */
const SHORTEST_GROUP_NAME = 4;

export function suggestGroups(
  accounts: { account: string; name: string }[],
): GroupSuggestion[] {
  const byBrand = new Map<string, { account: string; name: string }[]>();
  for (const a of accounts) {
    const b = brand(a.name);
    if (!b) continue;
    const seen = byBrand.get(b);
    if (seen) seen.push(a);
    else byBrand.set(b, [a]);
  }

  const out: GroupSuggestion[] = [];
  for (const members of byBrand.values()) {
    if (members.length < 2) continue;

    /* How far the names agree, word for word, from the front. */
    const first = words(members[0]!.name);
    let common = 1;
    while (common < first.length
      && members.every((m) => words(m.name)[common] === first[common])) common += 1;

    const name = keptWords(members[0]!.name).slice(0, common).join(' ');
    if (name.length < SHORTEST_GROUP_NAME) continue;

    out.push({
      name,
      members: [...members].sort((a, b) => a.name.localeCompare(b.name)),
    });
  }

  return out.sort((a, b) => b.members.length - a.members.length || a.name.localeCompare(b.name));
}

/* -------------------------------------------------------------
   Reading Protean's own formats.

   Both exports are Windows-1252, so the pound sign arrives as a byte
   that is not valid UTF-8. Read as UTF-8 it becomes a replacement
   character and every money column silently stops parsing, which is
   the kind of failure that shows up as a revenue figure of zero rather
   than as an error.
   ------------------------------------------------------------- */

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/**
 * `27-Aug-26` to `2026-08-27`.
 *
 * Two digit years, so a century has to be assumed. Everything in these
 * exports is recent and Protean has no data before 2000, so 20xx is the
 * only reading that is ever right.
 */
export function proteanDate(raw: string): string | null {
  const m = /^(\d{1,2})-([A-Za-z]{3})-(\d{2})$/.exec((raw ?? '').trim());
  if (!m) return null;
  const month = MONTHS[m[2]!.toLowerCase()];
  if (!month) return null;
  const day = Number(m[1]);
  if (day < 1 || day > 31) return null;
  return `20${m[3]}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * `£1,234.56` to 1234.56, and `(£50.00)` to -50.
 *
 * Brackets are how a credit note reads in an accounting export. There
 * are none in the first file, and treating them as positive the day one
 * appears would overstate revenue by twice the credit.
 */
export function proteanMoney(raw: string): number | null {
  let s = (raw ?? '').replace(/[£$,\s]/g, '').replace(/�/g, '').trim();
  if (!s) return null;
  let negative = false;
  if (s.startsWith('(') && s.endsWith(')')) { negative = true; s = s.slice(1, -1); }
  if (s.startsWith('-')) { negative = true; s = s.slice(1); }
  if (!/^\d*\.?\d+$/.test(s)) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}
