import type { ReactNode } from 'react';
import { PLACEHOLDER_MARKER } from '@/content/schemas';
import type { TextBlockView } from '@/domain/content/views';
import './provenance.css';

/**
 * The stamp printed on the block. Sentence case at body size, and it names who is writing: a gap has
 * to read as editorial, not broken. It is the visible text *and* the accessible name — no
 * `aria-hidden` copy, no separate `aria-label` a sighted guest cannot see.
 */
export const PLACEHOLDER_LABEL = 'Sara + Tyler are still writing this';

/**
 * Internal ticket references live in the content record, never on a guest page. Catches both the
 * parenthesised forms — "(backlog C-01)", "(content backlog C-07)", "(backlog V-01, C-10)" — and a
 * bare "backlog P-02" left in a sentence.
 */
const BACKLOG_REF = /\s*\((?:[^()]*\s)?backlog[^()]*\)|\s*\bbacklog\s+[A-Z]{1,2}-\d{1,3}\b/gi;

/** The hint after the marker, for display ("TODO(Tyler & Sara): the trail" -> "the trail"). */
export function placeholderHint(text: string): string {
  const stripped = text
    .replace(new RegExp(`${PLACEHOLDER_MARKER.replace(/[()&]/g, '\\$&')}:?\\s*`, 'g'), '')
    .replace(BACKLOG_REF, '')
    .replace(/\s+([.,;:])/g, '$1')
    .trim();
  return stripped.length ? stripped : 'Details to come.';
}

/** Same scrub for any other guest-facing string that may carry a hint verbatim. */
export function stripBacklogRefs(text: string): string {
  return text.replace(BACKLOG_REF, '').replace(/\s+([.,;:])/g, '$1').trim();
}

/**
 * A typed editorial placeholder. Never renders as a plain fact: it is visibly labelled,
 * carries `data-placeholder="true"`, and announces itself as a note to assistive tech.
 */
export function Placeholder({ children, inline = false, label = PLACEHOLDER_LABEL }: { children: ReactNode; inline?: boolean; label?: string }) {
  const Tag = inline ? 'span' : 'div';
  return (
    <Tag className={inline ? 'placeholder placeholder--inline' : 'placeholder'} data-placeholder="true" role="note">
      <span className="placeholder__label">{label}</span>{' '}
      {inline ? <span className="placeholder__hint">{children}</span> : <p className="placeholder__hint">{children}</p>}
    </Tag>
  );
}

/** Renders a TextBlock: plain text when it is a fact, a Placeholder when it is not. */
export function Text({ block, inline = false }: { block: TextBlockView; inline?: boolean }) {
  if (block.placeholder) return <Placeholder inline={inline}>{placeholderHint(block.text)}</Placeholder>;
  return <>{block.text}</>;
}

/** Paragraph list: facts become <p>, placeholders become blocks. */
export function Paragraphs({ blocks, className }: { blocks: readonly TextBlockView[]; className?: string }) {
  return (
    <>
      {blocks.map((b, i) =>
        b.placeholder ? (
          <Placeholder key={i}>{placeholderHint(b.text)}</Placeholder>
        ) : (
          <p key={i} className={className}>
            {b.text}
          </p>
        ),
      )}
    </>
  );
}
