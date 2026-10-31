import { DressCodeContent } from '@/components/wedding/DressCodeContent';
import { Text as Block } from '@/components/provenance';
import { guestText } from '@/domain/content/text';
import type { FaqView } from '@/domain/content/views';

/** FAQ answer body — dress code uses the shared scannable block; everything else is prose. */
export function FaqAnswerBody({ entry }: { entry: FaqView }) {
  if (entry.slug === 'dress-code') return <DressCodeContent />;
  return <Block block={entry.answer} />;
}

export function faqQuestionText(question: string) {
  return guestText(question);
}
