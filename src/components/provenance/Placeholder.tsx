import type { ReactNode } from 'react';
import { PLACEHOLDER_MARKER } from '@/content/schemas';
import type { TextBlockView } from '@/domain/content/views';
import './provenance.css';

export const PLACEHOLDER_LABEL = 'Placeholder — Sara + Tyler are still writing this';
/** The stamp printed on the block. Short on purpose: it is set in caps, and long caps runs do not read. */
export const PLACEHOLDER_BADGE = 'Not written yet';

/** The hint after the marker, for display ("TODO(Tyler & Sara): the trail" -> "the trail"). */
export function placeholderHint(text: string): string {
  const stripped = text.replace(new RegExp(`${PLACEHOLDER_MARKER.replace(/[()&]/g, '\\$&')}:?\\s*`, 'g'), '').trim();
  return stripped.length ? stripped : 'Details to come.';
}

/**
 * A typed editorial placeholder. Never renders as a plain fact: it is visibly labelled,
 * carries `data-placeholder="true"`, and announces itself as a note to assistive tech.
 */
export function Placeholder({ children, inline = false, label = PLACEHOLDER_LABEL }: { children: ReactNode; inline?: boolean; label?: string }) {
  const Tag = inline ? 'span' : 'div';
  return (
    <Tag className={inline ? 'placeholder placeholder--inline' : 'placeholder'} data-placeholder="true" role="note" aria-label={label}>
      <span className="placeholder__label" aria-hidden="true">
        {label === PLACEHOLDER_LABEL ? PLACEHOLDER_BADGE : label}
      </span>
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
