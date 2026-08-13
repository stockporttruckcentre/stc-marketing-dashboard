/* =============================================================
   The ontology.

   The thing every previous attempt was missing.

   Domain knowledge was spread across six files: yard words in lexicon,
   columns in schema, writable columns in fields, clause words in select,
   parameters in params. Nothing owned the idea of a CONCEPT, so nothing
   could canonicalise. "Tri-axle", "3 axle" and "three axle trailer" were
   three unrelated strings to be matched rather than three ways of
   writing one fact, and matching strings is what kept producing
   collisions.

   This is the model of the business instead. One entry per concept, with
   every way somebody says it, what kind of thing it is, and what it
   resolves to in the data. Canonicalisation runs first and search never
   sees human language at all.

     "how is collection and delivery charged on a 3 axle trailer"
       ->  intent      pricing
           service     collection_delivery
           asset       trailer
           axles       3
           asks        charging_method

   The pipeline is

     normalise  ->  canonicalise  ->  intent and constraints
       ->  ontology  ->  structured query  ->  answer

   and the important property is the arrow order. The old engine searched
   with the words and narrowed afterwards, which is why every ambiguous
   word needed a rule. This resolves meaning first, so by the time
   anything is searched there is nothing left to be ambiguous about.

   When it cannot resolve, it says so. "I do not understand that yet" is
   a correct answer and a confident wrong one is not.
   ============================================================= */

/** What kind of thing a concept is. Decides how it may be used. */
export type ConceptKind =
  | 'entity'      // a thing that has rows: trailer, customer, deal, post
  | 'attribute'   // something a thing has: profit, mot date, axles
  | 'value'       // a value an attribute takes: sold, curtainsider, Carrington
  | 'measure'     // what to do with a number: count, total, average
  | 'modifier'    // narrows without being a value: mine, unassigned, empty
  | 'action'      // something done rather than asked: export, assign, approve
  | 'period';     // when

export type Concept = {
  /** The canonical name. Stable, and what everything downstream uses. */
  id: string;
  kind: ConceptKind;
  /** What it is called in plain English, for anything shown to a person. */
  label: string;
  /**
   * Every way somebody writes it. This is canonicalisation, not fuzzy
   * matching: each surface form maps to this concept exactly, and a form
   * that is not listed does not resolve rather than half resolving.
   */
  surface: string[];
  /**
   * Which entities this concept can belong to, for an attribute or a
   * value. An attribute on four entities is ambiguous by nature and the
   * resolver has to earn the choice from context.
   */
  on?: string[];
  /** Where it lives in the data, once the entity is known. */
  maps?: Record<string, { column: string; value?: string }>;
  /**
   * Facts this concept asserts on its own. "Tri-axle" is not a search
   * term, it is `axles = 3`, and saying so here is what stops it being
   * matched as a string.
   */
  asserts?: Record<string, string | number>;
};

/* -------------------------------------------------------------
   Things.
   ------------------------------------------------------------- */
export const CONCEPTS: Concept[] = [
  { id: 'trailer', kind: 'entity', label: 'trailer',
    surface: ['trailer', 'trailers', 'unit', 'units', 'vehicle', 'vehicles', 'stock',
              'stocklist', 'stock list', 'the yard', 'fleet'] },
  { id: 'customer', kind: 'entity', label: 'customer',
    surface: ['customer', 'customers', 'contact', 'contacts', 'company', 'companies',
              'client', 'clients', 'account', 'accounts', 'prospect', 'prospects'] },
  { id: 'deal', kind: 'entity', label: 'deal',
    surface: ['deal', 'deals', 'proposal', 'proposals', 'quote', 'quotes', 'opportunity',
              'opportunities', 'enquiry', 'enquiries', 'lead', 'leads', 'pipeline', 'tracker'] },
  { id: 'post', kind: 'entity', label: 'social post',
    surface: ['post', 'posts', 'social post', 'social posts', 'social', 'content'] },
  { id: 'meeting', kind: 'entity', label: 'meeting',
    surface: ['meeting', 'meetings', 'call', 'calls', 'appointment', 'appointments',
              'visit', 'visits', 'diary', 'calendar'] },

  /* -------------------------------------------------------------
     Sides of the business.

     Not entities. They narrow a deal, and they are the strongest single
     signal for resolving anything that exists on both sides, which is
     most of the money.
     ------------------------------------------------------------- */
  { id: 'side.sales', kind: 'modifier', label: 'trailer sales', on: ['deal'],
    surface: ['trailer sales', 'sales side', 'unit sales', 'new and used'],
    maps: { deal: { column: 'side', value: 'trailer_sales' } } },
  { id: 'side.maintenance', kind: 'modifier', label: 'maintenance', on: ['deal'],
    surface: ['maintenance', 'workshop', 'service', 'servicing', 'repairs', 'trukplan',
              'the workshop side', 'maintenance side'],
    maps: { deal: { column: 'side', value: 'maintenance' } } },

  /* -------------------------------------------------------------
     Money.

     Every one of these exists in more than one place, which is the whole
     problem. Listing where each one lives is what lets the resolver
     choose from context instead of from a rule written for the word.
     ------------------------------------------------------------- */
  { id: 'profit', kind: 'attribute', label: 'profit', on: ['trailer', 'deal'],
    surface: ['profit', 'margin', 'gross profit', 'net profit', 'what we made', 'made on'],
    maps: { trailer: { column: 'profit' }, deal: { column: 'profit' } } },
  { id: 'sale_price', kind: 'attribute', label: 'sale price', on: ['trailer', 'deal'],
    surface: ['sale price', 'sales price', 'sold for', 'selling price', 'invoice value',
              'revenue', 'turnover', 'takings'],
    maps: { trailer: { column: 'sales_price' }, deal: { column: 'sale_price' } } },
  { id: 'book_value', kind: 'attribute', label: 'book value', on: ['trailer'],
    surface: ['nbv', 'net book value', 'book value', 'book price', 'cost price'],
    maps: { trailer: { column: 'nbv' } } },
  { id: 'refurb_cost', kind: 'attribute', label: 'refurb cost', on: ['trailer'],
    surface: ['refurb', 'refurb cost', 'refurb costs', 'refurbishment', 'rectification',
              'prep cost', 'prep'],
    maps: { trailer: { column: 'refurb_costs' } } },
  { id: 'retail_price', kind: 'attribute', label: 'retail price', on: ['trailer'],
    surface: ['retail', 'retail price', 'list price', 'asking price', 'ticket price'],
    maps: { trailer: { column: 'retail_price' } } },
  { id: 'commission', kind: 'attribute', label: 'commission', on: ['deal'],
    surface: ['commission', 'comm', 'my cut', 'what i earned', 'earnings'],
    maps: { deal: { column: 'commission' } } },
  { id: 'estimated_value', kind: 'attribute', label: 'estimated value', on: ['deal'],
    surface: ['estimated value', 'deal value', 'pipeline value', 'estimate', 'expected value'],
    maps: { deal: { column: 'estimated_value' } } },
  { id: 'company_turnover', kind: 'attribute', label: 'their turnover', on: ['customer'],
    surface: ['their turnover', 'company turnover', 'annual turnover'],
    maps: { customer: { column: 'turnover' } } },

  /* -------------------------------------------------------------
     Specification.

     The example that makes canonicalisation obvious. "Tri-axle" is not
     a phrase to search for, it is a number of axles, and once it says so
     here it composes with everything else automatically.
     ------------------------------------------------------------- */
  { id: 'axles.3', kind: 'value', label: 'three axles', on: ['trailer'],
    surface: ['3 axle', '3-axle', '3 axles', 'three axle', 'three axles', 'tri axle',
              'tri-axle', 'triaxle', 'tri'],
    asserts: { axles: 3 },
    maps: { trailer: { column: 'axle_type', value: '3' } } },
  { id: 'axles.2', kind: 'value', label: 'two axles', on: ['trailer'],
    surface: ['2 axle', '2-axle', '2 axles', 'two axle', 'twin axle', 'tandem', 'bi axle'],
    asserts: { axles: 2 },
    maps: { trailer: { column: 'axle_type', value: '2' } } },
  { id: 'axles.1', kind: 'value', label: 'single axle', on: ['trailer'],
    surface: ['single axle', '1 axle', 'one axle', 'mono axle'],
    asserts: { axles: 1 },
    maps: { trailer: { column: 'axle_type', value: '1' } } },

  /* -------------------------------------------------------------
     Measures. What to do with the number once it is found.
     ------------------------------------------------------------- */
  { id: 'measure.count', kind: 'measure', label: 'count',
    surface: ['how many', 'count', 'number of', 'how many of', 'total number'] },
  { id: 'measure.sum', kind: 'measure', label: 'total',
    surface: ['total', 'how much', 'sum', 'altogether', 'combined', 'value of', 'worth'] },
  { id: 'measure.avg', kind: 'measure', label: 'average',
    surface: ['average', 'avg', 'mean', 'typical', 'per unit', 'each on average'] },
  { id: 'measure.list', kind: 'measure', label: 'list',
    surface: ['list', 'show me', 'which', 'what are', 'give me', 'find', 'display'] },

  /* -------------------------------------------------------------
     Modifiers. Narrow without naming a value.
     ------------------------------------------------------------- */
  { id: 'mine', kind: 'modifier', label: 'mine',
    surface: ['my', 'mine', 'my own', 'on my book', 'in my portfolio', 'i own'] },
  { id: 'unassigned', kind: 'modifier', label: 'unassigned',
    surface: ['unassigned', 'unowned', 'nobody', 'no owner', 'unclaimed', 'up for grabs'] },
  { id: 'everyone', kind: 'modifier', label: 'the whole team',
    surface: ['everyone', 'everybody', 'the team', 'company wide', 'across the board', 'all of us'] },

  /* -------------------------------------------------------------
     What is being asked, when it is not a number.

     "How is collection and delivery charged" is not a count, a total or
     a list. It is a question about a rule, and an engine that only knows
     three measures answers it with a list of something.
     ------------------------------------------------------------- */
  { id: 'asks.how_charged', kind: 'measure', label: 'how it is charged',
    surface: ['how is it charged', 'how do we charge', 'how is charging', 'charged how',
              'what do we charge', 'charging method', 'how much do we charge'] },
  { id: 'asks.definition', kind: 'measure', label: 'what it means',
    surface: ['what is', 'what does', 'what counts as', 'define', 'meaning of', 'what do we mean by'] },
  { id: 'asks.where', kind: 'measure', label: 'where it is',
    surface: ['where is', 'where are', 'which depot', 'what site', 'where do i find'] },
  { id: 'asks.who', kind: 'measure', label: 'who',
    surface: ['who is', 'who are', 'whose', 'who owns', 'who handles', 'who sold'] },
  { id: 'asks.when', kind: 'measure', label: 'when',
    surface: ['when is', 'when did', 'when was', 'what date', 'how long ago'] },
];

/* =============================================================
   Canonicalisation.

   Longest surface form first, always. "Tri axle trailer" has to resolve
   to the axle concept and the trailer concept, not to whichever matched
   alphabetically, and a shorter form must never consume a longer one it
   sits inside.
   ============================================================= */

export type Mention = {
  concept: Concept;
  /** The exact words that produced it, so nothing is counted twice. */
  matched: string;
  at: number;
};

const INDEX: { form: string; concept: Concept }[] = CONCEPTS
  .flatMap((c) => c.surface.map((form) => ({ form: form.toLowerCase(), concept: c })))
  .sort((a, b) => b.form.length - a.form.length);

/** Punctuation and spacing away, so "3-axle" and "3 axle" are one thing. */
export function normalise(input: string): string {
  return ` ${input
    .toLowerCase()
    .replace(/[’']s\b/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9£$€. ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()} `;
}

/**
 * Every concept the sentence mentions, with nothing counted twice.
 *
 * Consuming as it goes is the point. Once "tri axle" has resolved, those
 * words are spent and cannot also be read as something else, which is
 * what stops one phrase producing three contradictory facts.
 */
export function canonicalise(input: string): { mentions: Mention[]; leftover: string[] } {
  let text = normalise(input);
  const mentions: Mention[] = [];

  for (const { form, concept } of INDEX) {
    const needle = ` ${form} `;
    const at = text.indexOf(needle);
    if (at === -1) continue;
    mentions.push({ concept, matched: form, at });
    // Blank it out rather than deleting, so later positions stay honest.
    text = text.slice(0, at + 1) + ' '.repeat(form.length) + text.slice(at + 1 + form.length);
  }

  const leftover = text
    .replace(/ +/g, ' ')
    .split(' ')
    .filter((w) => w.length >= 3);

  return { mentions: mentions.sort((a, b) => a.at - b.at), leftover };
}

/** The concepts of one kind that a sentence mentioned. */
export function of(mentions: Mention[], kind: ConceptKind): Concept[] {
  return mentions.filter((m) => m.concept.kind === kind).map((m) => m.concept);
}

/**
 * Which entity an attribute belongs to, given everything else said.
 *
 * The answer to the profit problem, stated as a rule about the ontology
 * rather than about the word. An attribute that lives on one entity
 * needs no thought. One that lives on several is decided by which of
 * those entities the sentence actually mentioned, and if the sentence
 * mentioned none of them, it is genuinely ambiguous and the caller has
 * to ask rather than pick.
 */
export function hostFor(attribute: Concept, mentions: Mention[]): {
  entity: string | null; certain: boolean; candidates: string[];
} {
  const hosts = attribute.on ?? [];
  if (hosts.length === 1) return { entity: hosts[0], certain: true, candidates: hosts };

  const named = of(mentions, 'entity').map((c) => c.id).filter((id) => hosts.includes(id));
  if (named.length === 1) return { entity: named[0], certain: true, candidates: hosts };

  /* A side narrows a deal, so naming maintenance settles a money word
     that lives on both a trailer and a deal without naming either. */
  const sides = mentions.filter((m) => m.concept.id.startsWith('side.'));
  if (sides.length && hosts.includes('deal')) {
    return { entity: 'deal', certain: true, candidates: hosts };
  }

  if (named.length > 1) return { entity: null, certain: false, candidates: named };
  return { entity: null, certain: false, candidates: hosts };
}
