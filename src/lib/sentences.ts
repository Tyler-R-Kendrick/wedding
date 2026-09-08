/**
 * Sentence splitting, in one place.
 *
 * Two callers need it and they used to disagree, which is how a settled fact glued to a TODO came
 * to be deleted from the search corpus while the same string, read through `src/ai/facts.ts`, kept
 * its facts and dropped only the hint. `src/ai/text.ts` re-exports this so the AI paths keep their
 * import; `src/domain/content/text.ts` uses it directly.
 */

/**
 * Splits prose into sentences. Citation markers such as "[S1]" or "[S1, S2]" stay attached to the
 * sentence they follow, whether they come before or after the final punctuation.
 */
export function splitSentences(text: string): string[] {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return [];
  const parts = normalized.split(/(?<=[.!?](?:\s*\[S\d+(?:\s*,\s*S\d+)*\])*)\s+(?=[A-Z0-9"'(\[])/);
  return parts.map((p) => p.trim()).filter(Boolean);
}
