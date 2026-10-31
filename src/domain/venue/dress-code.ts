import { textBlock } from '@/domain/content/text';
import type { TextBlock } from '@/domain/content/text';

/** Tyler decision 2026-10-31 — cocktail attire and up; single source for page, FAQ seed, and AI corpus. */
export const DRESS_CODE_INTRO =
  'We would love to see you dressed up for an evening in a historic ballroom—cocktail attire or anything more formal. Black tie is welcome.';

export const DRESS_CODE_EXAMPLE_MEN =
  'Men: a suit with a dress shirt, preferably with a tie (a tuxedo is welcome too).';

export const DRESS_CODE_EXAMPLE_WOMEN =
  'Women: a cocktail dress, an elegant jumpsuit, dressy separates, or a formal gown.';

export const DRESS_CODE_SKIP = 'Please skip jeans, chinos, and khakis.';

/** Compact line on per-event cards when dress is repeated. */
export const DRESS_CODE_SHORT = 'Cocktail attire and up (black tie welcome).';

/** Ask Us / search / AI knowledge — one record, multiple sentences. */
export const DRESS_CODE_FAQ_ANSWER = [
  DRESS_CODE_INTRO,
  DRESS_CODE_EXAMPLE_MEN,
  DRESS_CODE_EXAMPLE_WOMEN,
  DRESS_CODE_SKIP,
].join(' ');

export function dressCodeIntroBlock(): TextBlock {
  return textBlock(DRESS_CODE_INTRO);
}

export function dressCodeShortBlock(): TextBlock {
  return textBlock(DRESS_CODE_SHORT);
}

export function dressCodeExampleBlocks(): TextBlock[] {
  return [textBlock(DRESS_CODE_EXAMPLE_MEN), textBlock(DRESS_CODE_EXAMPLE_WOMEN)];
}

export function dressCodeSkipBlock(): TextBlock {
  return textBlock(DRESS_CODE_SKIP);
}
