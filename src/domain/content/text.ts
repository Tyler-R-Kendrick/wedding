import { isPlaceholderText, PLACEHOLDER_MARKER } from '@/content/schemas';
import { splitSentences } from '@/lib/sentences';

export { isPlaceholderText, PLACEHOLDER_MARKER };

/**
 * Every piece of copy that reaches a recipe is a TextBlock, so a typed placeholder can never be
 * rendered as a plain fact: recipes render `placeholder: true` inside a marked placeholder block.
 */
export interface TextBlock {
  text: string;
  placeholder: boolean;
}

/**
 * Internal ticket references ("(backlog C-01)", "(content backlog C-07)", a bare "backlog P-02")
 * are editorial metadata. They stay in the content record and in `docs/content/backlog.md`; they
 * never reach a guest, an export, or the AI corpus.
 */
const BACKLOG_REF = /\s*\((?:[^()]*\s)?backlog[^()]*\)|\s*\bbacklog\s+[A-Z]{1,2}-\d{1,3}\b/gi;

/** Scrubs ticket references from any string that is about to be shown to a guest. */
export function guestText(text: string): string {
  return text.replace(BACKLOG_REF, '').replace(/\s+([.,;:])/g, '$1').replace(/\s{2,}/g, ' ').trim();
}

export function textBlock(text: string, forcePlaceholder = false): TextBlock {
  // `isPlaceholderText` reads the original: scrubbing a ticket id never changes what a placeholder is.
  return { text: guestText(text), placeholder: forcePlaceholder || isPlaceholderText(text) };
}

export function textBlocks(texts: readonly string[], forcePlaceholder = false): TextBlock[] {
  return texts.map((t) => textBlock(t, forcePlaceholder));
}

export function optionalText(text: string | null | undefined, forcePlaceholder = false): TextBlock | undefined {
  return text ? textBlock(text, forcePlaceholder) : undefined;
}

/**
 * Splits a string into the sentences that are settled and the sentences that are still a TODO.
 *
 * Content records mix the two all the time — "The ceremony and reception are indoors at the hotel.
 * TODO(Tyler & Sara): any outdoor plans for the weekend." is one answer with one decided half. The
 * marker runs to the end of its own sentence, never further, so the split is per sentence.
 */
export function splitPlaceholderText(text: string): { settled: string[]; hints: string[] } {
  const settled: string[] = [];
  const hints: string[] = [];
  for (const sentence of splitSentences(text)) (isPlaceholderText(sentence) ? hints : settled).push(sentence);
  return { settled, hints };
}

/** True only when every sentence in the string is a placeholder — i.e. nothing is settled yet. */
export function isWhollyPlaceholder(text: string): boolean {
  return isPlaceholderText(text) && splitPlaceholderText(text).settled.length === 0;
}

/**
 * Strips placeholder SENTENCES so a TODO never enters the AI corpus, keeping whatever the record
 * has already decided.
 *
 * This used to drop the whole string, which deleted settled facts wholesale: five FAQ answers carry
 * the marker mid-answer, so the corpus lost "you pick your name and confirm with a one-time code",
 * "the ceremony and reception are indoors at the hotel", and three more — and the concierge then
 * denied knowing how to RSVP. A hint is not knowledge (ADR-0003 rule 6); the sentence beside it is.
 */
export function withoutPlaceholders(texts: readonly (string | null | undefined)[]): string[] {
  const out: string[] = [];
  for (const t of texts) {
    if (typeof t !== 'string' || !t.trim()) continue;
    const settled = isPlaceholderText(t) ? splitPlaceholderText(t).settled.join(' ') : t;
    if (settled.trim()) out.push(settled);
  }
  return out;
}
