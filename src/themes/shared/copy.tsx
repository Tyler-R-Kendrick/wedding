import type { ReactNode } from 'react';
import type { Copy, CopyPart } from '@/themes/types';

export const isPlaceholder = (part: CopyPart): part is { todo: string } => typeof part !== 'string';

/** Renders Copy: strings as text, placeholders through the theme's Placeholder component. */
export function renderCopy(copy: Copy | undefined, Placeholder: (p: { todo: string }) => ReactNode): ReactNode {
  if (!copy) return null;
  return copy.map((part, i) => (isPlaceholder(part) ? <Placeholder key={i} todo={part.todo} /> : <span key={i}>{part}</span>));
}

export function copyHasPlaceholder(copy: Copy | undefined): boolean {
  return !!copy?.some(isPlaceholder);
}
