import { isPlaceholderText, PLACEHOLDER_MARKER } from '@/content/schemas';

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

/** Strips placeholder sentences so a TODO never enters the AI corpus. */
export function withoutPlaceholders(texts: readonly (string | null | undefined)[]): string[] {
  return texts.filter((t): t is string => typeof t === 'string' && t.trim().length > 0 && !isPlaceholderText(t));
}
