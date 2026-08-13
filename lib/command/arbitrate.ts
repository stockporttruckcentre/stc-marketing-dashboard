/* =============================================================
   Instruction, or the question its words could also be.

   "Approve all outstanding social posts" contains every word a question
   about social posts contains. "Create a new CRM list" contains the word
   list, which is also how people ask to be shown things. One of them is
   an instruction and one is a question, and getting it backwards means
   either answering a command with a chart or writing to the database
   when somebody wanted to look at it.

   This lived inside the CommandBar component, which meant the checks had
   to import a React file to test a rule that has nothing to do with
   React. Worse, the first version of the sweep restated the rule instead
   of importing it, and therefore tested a bar that does not exist: it
   reported the wrong answer for questions the real component gets right,
   and sent me hunting bugs that were only ever in the harness.

   One copy, no React, imported by both.
   ============================================================= */

/**
 * A sentence that opens by telling the bar to do something.
 *
 * The verb at the FRONT is what decides. Widening this to any
 * instruction-ish word anywhere broke "create a new CRM list", because
 * a list is a thing in this product as well as a verb, and the create
 * action was filtered out of its own sentence.
 */
export const INSTRUCTION =
  /^(create|add|new|make|book|schedule|set|assign|approve|reject|send|email|import|upload|export to|delete|remove|move|mark|elevate|invite|start|generate|duplicate|rename|archive|publish|post|log|record|update|change|edit)\b/i;

/**
 * Words that can only be a read.
 *
 * "Export a list of all trailers in stock" was being offered as Add a
 * trailer to stock, with slot chips and Enter to run, because the create
 * intent matched on "trailer" and "stock" and any write intent outranked
 * the query. A sentence that opens by asking for a list, a count or a
 * file is not an instruction to create a record, whatever nouns follow.
 */
export function readsOnlyText(text: string): boolean {
  const t = text.trim().toLowerCase();

  // An instruction wins outright, whatever else is in the sentence.
  if (INSTRUCTION.test(t)) return false;

  // Asking, in any of the ways people open a question.
  if (/^(how|what|which|who|when|where|why|show|list|find|export|download|count|give|break|split|group|compare|tell)\b/.test(t)) {
    return true;
  }

  return /\b(export|download|list of|show me|how many|how much|count of|total|value of|give me|what are|report on|broken down by|grouped by|unassigned)\b/i
    .test(t);
}
