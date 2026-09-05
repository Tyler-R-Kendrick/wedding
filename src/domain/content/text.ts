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

export function textBlock(text: string, forcePlaceholder = false): TextBlock {
  return { text, placeholder: forcePlaceholder || isPlaceholderText(text) };
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
