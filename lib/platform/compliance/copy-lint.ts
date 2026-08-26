/* =============================================================
   What may and may not be written.

   `docs/source/STC_CONTEXT.md` sections 4.3 and 7. STC is an SEC
   reporting company, so the language used about Frame is a compliance
   surface rather than a style preference. The context document is
   direct about why this cannot live in a wiki:

     "If the CRM includes email templates, sequences, campaign builders
      or an AI drafting assistant, this cannot be a policy document
      sitting in a wiki. It has to be enforced in the product."

   So it is enforced here, and the same function runs in three places:
   the editor as you type, the approval gate before anything publishes,
   and a repository sweep that fails the build.

   ---- Three severities, and only two of them stop you ----

   legal      A statement that creates liability or names something
              legally off limits. Blocks publication. No override.
   banned     A house rule with no exceptions. Blocks publication.
   advisory   Probably wrong, occasionally right. Does not block, but
              publishing anyway writes an acknowledgement to the audit
              trail, so somebody chose it and that choice is recorded.

   The split matters. A linter that blocks everything gets switched off,
   and a linter that blocks nothing gets ignored. Advisory findings are
   the ones a person overrules, and recording the overrule is what makes
   them worth having.

   ---- The two hard rules ----

   The predecessor chain name is legally off limits in public
   communication. It must not appear in any string that can reach a
   public surface, and a leak through a CRM-sent email would be a
   compliance incident rather than a typo.

   "soon" is banned outright in Frame copy. It is a timeline commitment
   wearing a vague word.
   ============================================================= */

export type Severity = 'legal' | 'banned' | 'advisory';

/** Where the text is going, because the rules are not the same. */
export type Surface =
  /** Anything the public can read: website, blog, social, press. */
  | 'public'
  /** Leaves the company but to a named recipient: email, campaign. */
  | 'outbound'
  /** Stays inside: notes, tasks, internal documents. */
  | 'internal';

export type Finding = {
  rule: string;
  severity: Severity;
  /** The exact text that matched. */
  match: string;
  /** Character offset, so an editor can underline it. */
  index: number;
  /** What is wrong, in one sentence. */
  message: string;
  /** What to write instead, where there is a single right answer. */
  replacement?: string;
};

type Rule = {
  id: string;
  severity: Severity;
  /** Which surfaces this applies to. */
  surfaces: Surface[];
  pattern: RegExp;
  message: string;
  /** A fixed replacement, when there is exactly one. */
  replacement?: string | ((match: string) => string);
};

/* -------------------------------------------------------------
   British to American.

   STC context 7: US English. Decentralization, behavior, color,
   organize. This list is the endings rather than the words, so it
   catches spellings nobody thought to enumerate.

   Deliberately NOT applied to `internal`. Somebody typing a note should
   not be corrected on spelling while they work. It applies where the
   text leaves the company.
   ------------------------------------------------------------- */
const BRITISH: [RegExp, string][] = [
  [/\b(\w*?)isation\b/gi, '$1ization'],
  [/\b(\w*?)isations\b/gi, '$1izations'],
  [/\b(\w*?)ised\b/gi, '$1ized'],
  [/\b(\w*?)ising\b/gi, '$1izing'],
  [/\b(\w*?)ises\b/gi, '$1izes'],
  [/\bcolour(s|ed|ing)?\b/gi, 'color$1'],
  [/\bbehaviour(s|al)?\b/gi, 'behavior$1'],
  [/\bfavour(s|ed|ite|ites)?\b/gi, 'favor$1'],
  [/\blabour\b/gi, 'labor'],
  [/\bhonour(s|ed)?\b/gi, 'honor$1'],
  [/\bcentre(s|d)?\b/gi, 'center$1'],
  [/\blicence\b/gi, 'license'],
  [/\bdefence\b/gi, 'defense'],
  [/\bcatalogue\b/gi, 'catalog'],
  [/\bdialogue\b/gi, 'dialog'],
  [/\bgrey\b/gi, 'gray'],
  [/\bcancelled\b/gi, 'canceled'],
  [/\btravelling\b/gi, 'traveling'],
  [/\bfulfil\b/gi, 'fulfill'],
  [/\benrol\b/gi, 'enroll'],
  [/\bwhilst\b/gi, 'while'],
  [/\bamongst\b/gi, 'among'],
  [/\btowards\b/gi, 'toward'],
];

const RULES: Rule[] = [
  /* ---- legal: blocks, no override ---- */
  {
    id: 'predecessor-chain',
    severity: 'legal',
    surfaces: ['public', 'outbound'],
    /* The name and its spaced and hyphenated forms. Word boundaries on
       both sides, so it does not fire on `bravopaw` in a repository URL
       or on any word that happens to contain the letters. */
    pattern: /\bpaw(\s+|-)?chain\b|\bpaw\b(?=\s+(?:chain|holders|token|network))/gi,
    message:
      'The predecessor chain name is legally off limits in public communication. '
      + 'Refer to it as the predecessor chain.',
    replacement: 'the predecessor chain',
  },
  {
    id: 'unverified-claim',
    severity: 'legal',
    surfaces: ['public', 'outbound'],
    pattern:
      /\bFrame\s+(?:is|has|does|can|will)\s+(?:now\s+)?(?:live|launched|verified|audited|production[- ]ready|fully\s+\w+)\b/gi,
    message:
      'Nothing may be described as live, verified or functional unless it is. '
      + 'Hedge it: "is being designed to", "is intended to", "the roadmap calls for".',
  },
  {
    id: 'timeline-commitment',
    severity: 'legal',
    surfaces: ['public', 'outbound'],
    pattern:
      /\b(?:will\s+(?:launch|ship|go\s+live|release)|launching|shipping|going\s+live)\s+(?:in|on|by|before)\s+\w+/gi,
    message:
      'No timeline commitments in outbound copy. Say what the roadmap calls for, not when it will happen.',
  },

  /* ---- banned: house rules with no exceptions ---- */
  {
    id: 'soon',
    severity: 'banned',
    surfaces: ['public', 'outbound'],
    pattern: /\bsoon\b/gi,
    message: 'The word "soon" is banned in Frame copy. It is a timeline commitment in a vague word.',
  },
  {
    id: 'em-dash',
    severity: 'banned',
    surfaces: ['public', 'outbound', 'internal'],
    pattern: /[—–―]/g,
    message:
      'Hyphens only. No em dash, no en dash, anywhere. Use a comma, a colon, or two sentences.',
  },
  {
    id: 'the-protocol',
    severity: 'banned',
    surfaces: ['public', 'outbound'],
    pattern: /\b(?:the|this)\s+protocol\b/gi,
    message:
      'Frame refers to itself as "a protocol", never "the protocol" or "this protocol". '
      + 'Or name the thing: most networks, most chains, the outcome, a named stakeholder.',
    replacement: 'a protocol',
  },
  {
    id: 'authorised',
    severity: 'banned',
    surfaces: ['public', 'outbound', 'internal'],
    pattern: /\bauthoris(?:e|ed|es|ing|ation)\b/gi,
    message: 'Use "approved", not "authorised".',
    replacement: 'approved',
  },
  {
    id: 'bare-ticker',
    severity: 'banned',
    surfaces: ['public', 'outbound'],
    /* A CRCW not already preceded by OTCID and a colon. */
    pattern: /(?<!OTCID:\s{0,4})\bCRCW\b/g,
    message: 'The ticker always renders as "OTCID: CRCW", never a bare CRCW.',
    replacement: 'OTCID: CRCW',
  },
  {
    id: 'admitted-as-confirmed',
    severity: 'banned',
    surfaces: ['public', 'outbound', 'internal'],
    pattern: /\bADMITTED\b(?=[^.]{0,40}\b(?:confirmed|complete|final|settled)\b)/gi,
    message:
      'ADMITTED is not confirmation. FINALISED is the only safe point to describe as confirmed.',
  },

  /* ---- advisory: overruleable, and the overrule is recorded ---- */
  {
    id: 'unhedged-capability',
    severity: 'advisory',
    surfaces: ['public', 'outbound'],
    pattern: /\bFrame\s+(?:delivers|provides|offers|guarantees|ensures|enables)\b/gi,
    message:
      'Frame capability language is hedged: "is being designed to", "is intended to", "we aim to", "we believe".',
  },
  {
    id: 'unsourced-number',
    severity: 'advisory',
    surfaces: ['public', 'outbound'],
    /* A figure with a unit or a percent, which usually wants a source. */
    pattern: /\b\d[\d,.]*\s?(?:%|x|ms|TPS|million|billion|USD|\$)\b/gi,
    message: 'No specific numbers without a source. Say where this figure comes from.',
  },
  {
    id: 'token-price',
    severity: 'advisory',
    surfaces: ['public', 'outbound'],
    pattern: /\b(?:price|market\s?cap|valuation|moon|pump|listing\s+price)\b/gi,
    message: 'No token or price discussion in team-voice content.',
  },
];

/** The spelling rules, built once rather than per call. */
const SPELLING_RULES: Rule[] = BRITISH.map(([pattern, replacement], i) => ({
  id: `us-spelling-${i}`,
  severity: 'advisory' as Severity,
  surfaces: ['public', 'outbound'] as Surface[],
  pattern,
  message: 'US English. STC and Frame use American spelling throughout.',
  replacement: (m: string) => m.replace(new RegExp(pattern.source, 'i'), replacement),
}));

const ALL = [...RULES, ...SPELLING_RULES];

/**
 * Everything wrong with a piece of text, for the surface it is going to.
 *
 * Ordered by position rather than by severity, so an editor can walk
 * them in reading order. Callers that want the blocking ones first can
 * sort on `blocks()`.
 */
export function lintCopy(text: string, surface: Surface = 'outbound'): Finding[] {
  if (!text) return [];
  const findings: Finding[] = [];

  for (const rule of ALL) {
    if (!rule.surfaces.includes(surface)) continue;

    /* A fresh regex per rule per call. A shared global regex carries
       lastIndex between calls and silently skips matches on the second
       run, which is the kind of bug that shows up as one missed banned
       word in a hundred. */
    const re = new RegExp(rule.pattern.source, rule.pattern.flags);
    let m: RegExpExecArray | null;

    while ((m = re.exec(text)) !== null) {
      findings.push({
        rule: rule.id,
        severity: rule.severity,
        match: m[0],
        index: m.index,
        message: rule.message,
        replacement:
          typeof rule.replacement === 'function'
            ? rule.replacement(m[0])
            : rule.replacement,
      });
      /* A zero width match would loop forever. */
      if (m.index === re.lastIndex) re.lastIndex++;
    }
  }

  return findings.sort((a, b) => a.index - b.index);
}

/** Does this stop publication, or only need somebody to say yes. */
export function blocks(f: Finding): boolean {
  return f.severity === 'legal' || f.severity === 'banned';
}

/**
 * The one question the approval gate asks.
 *
 * `ok` false means it cannot publish at all. `needsAcknowledgement` means
 * it can, and doing so writes a line to the audit trail naming what was
 * overruled and by whom.
 */
export function copyGate(text: string, surface: Surface = 'outbound'): {
  ok: boolean;
  blocking: Finding[];
  advisory: Finding[];
  needsAcknowledgement: boolean;
} {
  const findings = lintCopy(text, surface);
  const blocking = findings.filter(blocks);
  const advisory = findings.filter((f) => !blocks(f));
  return {
    ok: blocking.length === 0,
    blocking,
    advisory,
    needsAcknowledgement: blocking.length === 0 && advisory.length > 0,
  };
}

/**
 * Apply every fix that has exactly one right answer.
 *
 * Only rules carrying a replacement. Anything needing judgement is left
 * alone, because a linter that rewrites a sentence it does not
 * understand produces copy nobody checked.
 */
export function autoFix(text: string, surface: Surface = 'outbound'): string {
  let out = text;
  for (const f of lintCopy(text, surface).filter((x) => x.replacement)) {
    out = out.split(f.match).join(f.replacement!);
  }
  return out;
}
