# How the command bar understands a sentence

A test arrived from outside: ten sentences that had never appeared in any
lexicon, test or example in this repo, with one rule attached. Do not add
them to a lexicon first. If the architecture is right they should mostly
work, because their parts are independently understood. If they do not,
another 1,700 lines of aliases will not save it.

The engine scored **0 out of 10**, and three of the ten came back meaning
the opposite of what was typed:

| Typed | Answered |
|---|---|
| `what's the highest mileage vehicle that isn't sold` | sold trailers |
| `everything except trailers that's available` | trailers |
| `give me all stock where price hasn't been entered` | a total of the prices |

An inverted answer is worse than no answer, because it looks right.

It now scores **10 out of 10**, and 31 out of 31 of the individual facts
in those sentences. Nothing in any lexicon was changed to get there. Run
it with `npm run check:litmus`.

---

## Why it failed, and what that meant

The first instinct was to add words. That instinct is what produced the
0, and it would have produced another 0 on the next ten sentences.

Every one of the failures was a missing **operator**, not a missing word.
No number of aliases fixes "cheapest", because cheapest is not a thing to
look up. It is something you do to an attribute:

```
cheapest        order by an attribute, ascending, then take one
five            take five
except          invert whatever clause follows
newest first    order by a date, descending
DAF vs Volvo    group by an attribute, show two of its values
stock age       an attribute computed from another one
not entered     that attribute is empty
```

Seven ideas. They apply to any attribute the data declares, in any
combination. `the five cheapest available rigids` is four independent
facts that happen to appear together, and so are the several thousand
other sentences built from those same four.

That is the difference between a grammar and a phrasebook. A phrasebook
grows by one entry per sentence and never finishes. A grammar grows by
one entry per idea and the sentences come free.

---

## The pipeline

```
                      the sentence
                           |
                    lib/command/grammar.ts
              operators: order, limit, negate,
              compare, derive, empty, and where
              each one's scope begins and ends
                           |
                    lib/command/vocab.ts
              what the DATA calls things, read
              from the database rather than a file
                           |
                    lib/command/query.ts
              which entity, which measure, which
              filters, and the operators bound to
              this entity's own columns
                           |
                 lib/command/attributes.ts
              which column a phrase names, merged
              from schema, fields and yard talk
                           |
                app/api/command/query/route.ts
              a constrained executor: every column
              allowlisted from the dictionary, never
              from the request
```

The executor did not change shape. It still takes a structured request
and resolves every column against the entity's own declarations, so
nothing here widens what can reach the database. What changed is
everything upstream of it.

---

## The parts, and why each exists

### `grammar.ts`, the operators

Reads a sentence into operations without knowing what a trailer is. A
superlative carries a direction and the KIND of attribute it wants
(`money`, `date`, `duration`, `any`); which attribute is the sentence's
business, not the operator's.

The first version of this file got that wrong in miniature. It listed
`longest in stock`, `been sitting longest` and `longest on the yard` as
three separate superlatives, so `what's been sitting in Stockport
longest` matched none of them. Same words, different order. That is a
phrasebook with seven entries instead of seven thousand, and it fails the
same way.

**Negation carries scope.** `except trailers that's available` inverts
the trailers and leaves the availability alone, so a negation runs from
where it appears to the end of its clause and only what falls inside gets
inverted. The negators are explicit rather than a general "not" rule: a
company called Nottingham, a status called "not started" and a depot with
"north" in it would each silently flip a query.

### `vocab.ts`, the data names itself

`DAFs older than 2022 excluding anything at Warrington` resolved to
nothing at all, because no word in it names anything this app holds. The
only reason a person reads it as stock is that they have seen DAF in the
make column.

A list of manufacturers in a file fixes that one sentence and goes stale
on the next delivery. So the values come from the database: whatever
appears in `stock_trailers.make` IS a make, by definition. The app loads
them once from `/api/command/vocabulary`; the checks load a sample.
An empty index changes nothing, so this costs coverage rather than the
whole feature when it is unavailable.

It also places filters. A word the data says is a make becomes a make
filter without a preposition having to prove it, which is what stopped
`average stock age for DAF versus Volvo` reading DAF as the sales rep.

### `attributes.ts`, which column a phrase names

This knowledge was in four places and each knew a different part of it:
`schema.ts` had the amounts and dates you can group by, `fields.ts` had
all 104 writable columns with their aliases, `select.ts` had a hand
written list of seventeen nullable columns, `columns.ts` had every column
of every table.

Asking only the first meant `trailers with no refurb cost` resolved to
**book value**, because `cost` is one of the words for book value.
Asking only the third meant `customers with no email` worked while
`customers with no website` did not, for no reason visible from either
file.

They are merged once, here, longest alias first. `select.ts` no longer
keeps its own list.

### `query.ts`, binding operators to columns

The operator says what kind of thing it wants; the entity says which of
its columns are that kind. Neither knows about the other, which is why
`highest mileage` will work the day a mileage column exists without a
line being written.

Entity resolution gained two last resorts before giving up:

- **A computed attribute names its entity.** Only stock has a stock age,
  so `what's been sitting in Stockport longest` is about stock even
  though it contains no noun for a trailer and a depot three entities
  share.
- **The data names its entity.** A word that only appears in
  `stock_trailers.make` can only be about trailers.

### Saying what it could not do

`what's the highest mileage vehicle that isn't sold` is three requests
and two of them work. This app sells trailers and holds no mileage
column, so the ordering has nowhere to go. Returning unsorted rows would
look like an answer to the question that was asked, so the plan carries
an `unmet` list and the bar prints it:

> Could not do this part: nothing on a trailer to sort "highest" by

The same applies to `high to low` with no attribute named. Guessing a
column there is how somebody reads the wrong number out in a meeting.

---

## What the checks now assert

The repo's rule is that a phrasing listed in a lexicon is a guess and a
phrasing asserted in a check is a promise. The operators are asserted by
combination, not one at a time:

- every superlative against every body type and depot, ordering and limit
  both, with the body type and depot surviving
- every negator against every status, in both spellings, asserting that
  `are sold` is not inverted and `aren't sold` is
- every column on every entity, asked to be empty, asserting that it is
  an emptiness test and not a total
- every pair of depots compared, asserting a comparison groups rather
  than narrows
- stock age asked three ways, asserting it is computed and not read as
  the status "in stock"

```bash
npm run check:litmus     # the ten sentences, per component
npm run check:coverage   # 8,758 assertions including the operators
npm run check:command    # the parser against real phrasings
npm run check:query      # query composition
npm run check:fuzz       # 103,144 generated sentences
npm run check:gaps       # sentences the bar still fumbles
```

`check:gaps` went from 241 fumbles to 117 as a side effect of the
consolidation, without any of those sentences being looked at
individually.

---

## What is still fragmented

This is the honest list, and it is the next work.

`ontology.ts` and `resolve.ts` are a parallel interpretation of the same
sentences and are **not wired into the bar**. `resolve.ts` scores
readings on raw words rather than on canonical concepts. `select.ts` now
shares the attribute resolver but still parses its own comparisons,
dates and ownership. `compose.ts` builds suggestions from a third set of
vocabulary.

The target is one canonical semantic pipeline that query, action and
navigation all read from, rather than four systems that each interpret
English slightly differently. The operators and the attribute resolver
are the first two pieces of it, and both are now shared rather than
duplicated.

49 of the remaining gaps are columns on tables the bar has no entity for
at all (`calendar_invites`, `contact_addresses`), which is an entity to
add rather than a phrasing to fix.
