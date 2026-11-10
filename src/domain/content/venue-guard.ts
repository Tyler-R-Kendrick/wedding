import type { Principal } from '@/contracts/principal';

/**
 * Keeps the venue out of what a signed-out reader is told.
 *
 * The story is public and the venue is not, and the two meet in the story itself: the chapter about
 * a fourth date says where Tyler took Sara, and that it "would one day be where we'd say I do". That
 * sentence is true and it is theirs to tell — to their guests. For anyone else the chapter reads the
 * same without it.
 *
 * It works on the words, not on a flag in the record, on purpose: the couple edit this copy in the
 * admin console, and a rule that depended on someone remembering to mark a sentence private would
 * fail the first time they rewrote one. Any sentence that names the venue or its address is left
 * out for a signed-out reader, whoever wrote it and whenever. Signed in, nothing is touched.
 *
 * Applied where the story leaves the server (`get_story`), so the page, the WebMCP tool and the
 * concierge all get the same answer.
 */
const VENUE_MENTION = /chicago\s+athletic|\b12\s+s(?:outh|\.)?\s+michigan\b/i;

export const mentionsVenue = (text: string): boolean => VENUE_MENTION.test(text);

/** Whether this reader may be told where the wedding is. */
export const mayKnowVenue = (principal: Principal): boolean => principal.kind !== 'anonymous';

/**
 * Sentence ends, including one that closes inside a quotation (`…where we’d say “I do.” Along the
 * way…`). The site's shared splitter keeps that pair together, which here would take the sentence
 * after the venue's along with it.
 */
const SENTENCE_BREAK = /(?<=[.!?][”"’']?)\s+(?=[A-Z0-9“"‘'([])/;

/** `text` without the sentences that name the venue. A string that never names it comes back as it was. */
export function withoutVenueSentences(text: string): string {
  if (!mentionsVenue(text)) return text;
  return text
    .replace(/\s+/g, ' ')
    .trim()
    .split(SENTENCE_BREAK)
    .filter((sentence) => !mentionsVenue(sentence))
    .join(' ');
}

/** Paragraph blocks for a signed-out reader: venue sentences removed, and a paragraph that was only that, dropped. */
export function publicBlocks<T extends { text: string }>(blocks: readonly T[]): T[] {
  return blocks.map((b) => ({ ...b, text: withoutVenueSentences(b.text) })).filter((b) => b.text.trim().length > 0);
}
