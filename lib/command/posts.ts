/* =============================================================
   Writing a social post from the sentence that asked for one.

     create a LinkedIn post saying "Our Haydock depot is open Saturday"
     new Facebook post that says we are open Saturday
     draft a post saying "MOT lane free Thursday" for next Monday

   A COMPOSER IS FOR WHAT THE WORDS CANNOT CARRY.

   The command bar used to answer every one of these by opening the
   composer with the text pre-filled, which is a reasonable thing to do
   when a post needs an image, a crop and a preview on four platforms.
   It is not a reasonable thing to do when somebody has already typed the
   whole post: they said the words, and being handed a form to retype
   them into is the tool asking them to do it twice.

   So a sentence that carries the content writes the draft, and a
   sentence that does not still opens the composer. The test is not how
   the sentence is phrased, it is whether the required text is in it.
   Images, crops and per-platform previews are genuinely visual and stay
   where they are.

   THE SAME OPERATION THE COMPOSER PERFORMS.

   `command_create_post` fills in the author from the profile and the
   status from the role, exactly as the form does, because those are
   properties of who is writing rather than of what the sentence said.
   The platforms and the date default to what the form defaults to.
   ============================================================= */
import type { Expr, Invoke } from './ir/types';
import { capability } from './ir/registry';
import { PLATFORMS } from '@/lib/social/posts';
import { readDate } from './mutate';
import { CREATE_WORDS } from './lifecycle';
import type { CrmCapabilities } from '@/lib/crm/permissions';

export type PostPlan = {
  step: Invoke;
  summary: string;
  requires: string;
  confidence: number;
};

/** Words that say the sentence is about a social post. */
const POST_WORDS = ['post', 'posts', 'social post', 'update', 'advert', 'ad'];

/** The words after which the rest of the sentence IS the post. */
const SAYING = /\b(?:saying|that says|which says|reading|with the (?:text|words)|text)\b[:,]?\s*/i;

const soften = (s: string) =>
  ` ${s.toLowerCase().replace(/[^a-z0-9£$€.,/:@'\- ]+/g, ' ').replace(/\s+/g, ' ').trim()} `;

/**
 * What the post says, if the sentence said it.
 *
 * Quotes first, because they are unambiguous and they are what people
 * type when the wording matters. Otherwise everything after "saying",
 * which is the other way the whole post arrives in one sentence.
 *
 * Null means the words are not here, and the composer is the right
 * answer rather than a post reading "about the Haydock depot".
 */
export function contentIn(raw: string): string | null {
  const quoted = raw.match(/["“”']([^"“”']{3,600})["“”']/);
  if (quoted) return quoted[1].trim();

  const said = raw.split(SAYING);
  if (said.length > 1) {
    /* Everything after the word, minus a trailing scheduling clause:
       "saying we are open Saturday for next Monday" is a post about
       Saturday that goes out on Monday. */
    const rest = said.slice(1).join(' ')
      .replace(/\s+\b(?:for|on|scheduled for|to go out on)\s+(?:next\s+)?\w+day\b\s*$/i, '')
      .replace(/[.,;]\s*$/, '')
      .trim();
    if (rest.length >= 3) return rest;
  }
  return null;
}

/** Which platforms the sentence named, by the names the planner uses. */
function platformsIn(raw: string): string[] {
  const t = soften(raw);
  const found = PLATFORMS.filter((p) => {
    const word = p.toLowerCase();
    /* "X" is a platform and a letter, so it counts only when it is
       clearly being used as one. */
    if (word === 'x') return / (?:on |to )?x (?:post|posts)? /.test(t) || / twitter /.test(t);
    return t.includes(` ${word} `);
  });
  if (!found.length && / twitter /.test(t)) return ['X'];
  return found;
}

export function parsePost(
  raw: string,
  caps?: CrmCapabilities,
  now: Date = new Date(),
): PostPlan | null {
  const text = raw.trim();
  if (text.length < 8) return null;
  if (text.endsWith('?')) return null;

  const t = soften(text);
  if (!POST_WORDS.some((w) => t.includes(` ${w} `))) return null;
  if (!CREATE_WORDS.some((w) => t.includes(` ${w} `)) && !/\bdraft(?:ing)?\b/i.test(text)) {
    return null;
  }

  const cap = capability('post.create');
  if (!cap?.requires || !cap.handler) return null;
  if (caps && !caps.has(cap.requires)) return null;

  /* NO CONTENT MEANS THE COMPOSER, AND THAT IS THE RIGHT ANSWER.

     "Create a social post about the Haydock depot" names a topic. A
     draft whose text is the topic is worse than no draft, so this
     declines and the action registry opens the composer. */
  const content = contentIn(text);
  if (!content) return null;

  const platforms = platformsIn(text);

  /* A date the sentence gave, read off the part that is not the post.
     Without taking the content out, "saying the yard is open on the
     14th" would schedule the post for the fourteenth. */
  const outside = text.replace(content, ' ');
  const when = readDate(outside, now);

  const args: Record<string, Expr> = {
    content: { kind: 'literal', value: content },
  };
  if (platforms.length) args.platform = { kind: 'literal', value: platforms.join(',') };
  if (when) args.scheduledDate = { kind: 'literal', value: when.value };

  const where = platforms.length ? platforms.join(' and ') : 'Facebook and LinkedIn';
  const shown = content.length > 60 ? `${content.slice(0, 57)}...` : content;

  return {
    step: {
      op: 'invoke',
      id: 'p1',
      capability: 'post.create',
      args,
      produces: { kind: 'record', entity: 'posts' },
    },
    summary: `Write a ${where} post saying "${shown}"${when ? ` for ${when.raw}` : ''}`,
    requires: cap.requires,
    confidence: 13,
  };
}
