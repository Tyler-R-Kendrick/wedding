import type { PillTone } from '@/components/admin/flow/records';

/**
 * An RSVP answer in words, the same on every admin screen (CONVENTIONS "Words"): Coming, Not coming,
 * No answer yet. The stored values (`accepted`, `declined`, no row) never reach a reader.
 */
export type AnswerStatus = 'accepted' | 'declined' | null;

export const ANSWER_WORDS: Record<'accepted' | 'declined' | 'none', { label: string; tone: PillTone }> = {
  accepted: { label: 'Coming', tone: 'good' },
  declined: { label: 'Not coming', tone: 'bad' },
  none: { label: 'No answer yet', tone: 'neutral' },
};

export const answerWords = (status: AnswerStatus | undefined) => ANSWER_WORDS[status ?? 'none'];

/** The answer filter's values: the stored status, or `none` for no answer on record. */
export const ANSWER_FILTERS = [
  { value: '', label: 'Every answer' },
  { value: 'accepted', label: ANSWER_WORDS.accepted.label },
  { value: 'declined', label: ANSWER_WORDS.declined.label },
  { value: 'none', label: ANSWER_WORDS.none.label },
] as const;
