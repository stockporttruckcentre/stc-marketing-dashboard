# How the command bar understands a sentence

A test arrived from outside: sentences that had never appeared in any
lexicon, test or example in this repo, with one rule attached. Do not add
them to a lexicon first. If the architecture is right they should mostly
work, because their parts are independently understood. If they do not,
another 1,700 lines of aliases will not save it.

The engine scored **zero**, and three of the sentences came back meaning
the opposite of what was typed:

| Typed | Answered |
|---|---|
| `... that isn't sold` | sold trailers |
| `everything except trailers that's available` | trailers |
| `all stock where price hasn't been entered` | a total of the prices |

An inverted answer is worse than no answer, because it looks right.

## The benchmark was wrong first

Those original ten sentences were about **trucks**. Rigids, 6x2 axle
configurations, mileage, DAF and Volvo. STC sells **trailers**. There is
no rigid, no 6x2 and no mileage column in this application and there
never should be, and the real make column holds Don Bur, Tiger, SDC,
Dennison, Cartwright, Krone, Montracon, Gray & Adams and Schmitz.

So the engine was being driven, and scored, against a business that does
not exist. It scored 10 out of 10 on that corpus, which was worse than
failing: a benchmark measuring the wrong thing tells you the work is
done when it is not. Nothing truck-shaped ever reached the schema or the
production code, but the test fixture had invented DAF and Volvo as
trailer makes, and the reasoning was being steered by nonsense.

The corpus is now twelve sentences about STC, and every noun in them is
something this application holds. The values the checks run against are
read from the hundred and ten real stock rows in
`app/api/admin/import-sold-2026`, messiness included: `Don Bur` and
`DonBur` are both in that column, and so are `Dukinfield` and
`DUKINFIELD`.

It scores **12 out of 12**, 46 of 46 individual facts, with nothing
added to any lexicon. `npm run check:litmus`.

Finding the right corpus found five real bugs the truck corpus never
touched: refurb cost was not a queryable amount at all, "compare A and B"
was not a comparison, "and no email" was not an emptiness test, "by sales
rep" lost its grouping because only one word after "by" was read, and
`in between May and July` was read as a depot called Between.

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
Don Bur vs Krone  group by an attribute, show two of its values
stock age       an attribute computed from another one
not entered     that attribute is empty
```

Seven ideas. They apply to any attribute the data declares, in any
combination. `show the five cheapest curtainsiders currently in stock`
is four independent facts that happen to appear together, and so are the
several thousand other sentences built from those same four.

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

`which Schmitz trailers have been here longest` contains no noun for a
trailer. The only reason a person reads it as stock is that they have
seen Schmitz in the make column.

A list of manufacturers in a file fixes that one sentence and goes stale
the day somebody stocks a Chereau. So the values come from the database:
whatever appears in `stock_trailers.make` IS a make, by definition. The
app loads them once from `/api/command/vocabulary`; the checks load STC's
own stock rows. An empty index changes nothing, so this costs coverage
rather than the whole feature when it is unavailable.

It also places filters. A word the data says is a make becomes a make
filter without a preposition having to prove it, which is what stopped
`compare Don Bur and Krone average profit` reading Don Bur as a sales
rep called Don.

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
`highest tread depth` will work the day `tread_depths` is declared as a
number, without a line being written here.

Entity resolution gained three last resorts before giving up:

- **A computed attribute names its entity.** Only stock has a stock age,
  so `which Schmitz trailers have been here longest` is about stock even
  when it contains no noun for a trailer.
- **The data names its entity.** A word that only appears in
  `stock_trailers.make` can only be about trailers.
- **One of our own yards names it**, since a depot is where stock sits.

### Saying what it could not do

This is the part that matters most, and it is the one the truck corpus
nearly cost.

`how many 6x2s have we got at Carrington` used to come back as a
confident count of every trailer on that site. A real number, plausibly
sized, and the answer to a different question. There is no 6x2 in this
business, and the only honest response is to count what it understood
and say what it could not place:

> Count of trailers where at Carrington
> nothing in the trailers matches "6x2s"

So any content word the plan cannot account for is named. The same
applies to an ordering with nothing to order by, and to `high to low`
with no attribute named. Guessing a column there is how somebody reads
the wrong number out in a meeting.

A depot on its own now implies stock, since a yard is where stock sits,
but only weakly and only as a last resort: the sentence said where and
did not say what, so anything else it contained still has to be
accounted for or named.

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
npm run check:litmus     # twelve STC sentences, scored per fact
npm run check:sweep      # 47 sentences through the whole bar
npm run check:audit      # what actually runs, not what parses
npm run check:coverage   # 8,758 assertions including the operators
npm run check:command    # the parser against real phrasings
npm run check:query      # query composition
npm run check:fuzz       # 103,144 generated sentences
npm run check:gaps       # sentences the bar still fumbles
```

`check:gaps` went from 241 fumbles to 126 out of a wider corpus, as a
side effect of the consolidation, without any of those sentences being
looked at individually.

---

## What is still fragmented

This is the honest list, and it is the next work.

**149 actions are declared and none of them carry out their operation
from the bar. 55 do nothing at all when picked.** That is the largest
gap in the product and it is written up in
`docs/command-bar-execution-audit.md`. Every number in this file
measures understanding, which is a third of the job.

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

## The rule this file exists to enforce

A benchmark written from outside the business will find operators the
engine is missing, which is genuinely useful. It will also quietly
redefine what the product is, which is not. Both happened here.

**Any sentence used to drive or score this engine must be about
something STC holds.** If a test needs a value, it comes from the real
rows, not from memory.
