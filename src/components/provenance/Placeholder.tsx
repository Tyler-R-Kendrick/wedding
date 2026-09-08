import { Fragment, type ReactNode } from 'react';
import { PLACEHOLDER_MARKER } from '@/content/schemas';
import { splitPlaceholderText } from '@/domain/content/text';
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

const MARKER_RE = new RegExp(`${PLACEHOLDER_MARKER.replace(/[()&]/g, '\\$&')}:?\\s*`, 'g');

/** Removes the marker and any ticket reference, and tidies the spacing that leaves behind. */
const scrub = (text: string): string => text.replace(MARKER_RE, '').replace(BACKLOG_REF, '').replace(/\s+([.,;:])/g, '$1').trim();

/**
 * The hint after the marker, for display ("TODO(Tyler & Sara): the trail" -> "the trail").
 *
 * Only the sentences that actually carry the marker. A record that mixes the two — "The ceremony and
 * reception are indoors at the hotel. TODO(Tyler & Sara): any outdoor plans for the weekend." — used
 * to hand the whole thing to the placeholder block, which read as
 * "Sara + Tyler are still writing this: The ceremony and reception are indoors at the hotel. any
 * outdoor plans for the weekend." — a decided fact labelled undecided, then a lowercase run-on.
 * `Text` and `Paragraphs` render the settled half beside the block instead.
 */
export function placeholderHint(text: string): string {
  const { hints } = splitPlaceholderText(text);
  const stripped = scrub(hints.length ? hints.join(' ') : text);
  return stripped.length ? stripped : 'Details to come.';
}

/** The settled sentences of a mixed block. Empty when the whole string is a hint. */
export function placeholderFacts(text: string): string {
  const { settled, hints } = splitPlaceholderText(text);
  return hints.length ? scrub(settled.join(' ')) : '';
}

/**
 * The whole string as prose, marker and ticket reference removed — for the non-UI callers that
 * flatten a description or a label into one line and have no block to render a hint into.
 *
 * A hint that FOLLOWS a settled sentence is capitalised, because the marker sat where a capital
 * would be and stripping it leaves "…indoors at the hotel. any outdoor plans for the weekend." A
 * hint that stands alone keeps its own case: these strings are written to follow a label ("Sara +
 * Tyler are still writing this: a restaurant we love"), and a card prints one as a heading.
 */
export function withoutPlaceholderMarker(text: string): string {
  const { settled, hints } = splitPlaceholderText(text);
  if (!hints.length) return scrub(text);
  const facts = scrub(settled.join(' '));
  const hint = scrub(hints.join(' '));
  if (!facts) return hint;
  return `${facts} ${hint.charAt(0).toUpperCase()}${hint.slice(1)}`.trim();
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
      {/* Inline, the label leads into the hint and needs punctuation, or the two run together:
          "Sara + Tyler are still writing this the room is still to be confirmed." As a block the
          hint is its own paragraph, so the colon would be noise there. */}
      <span className="placeholder__label">{inline ? `${label}:` : label}</span>{' '}
      {inline ? <span className="placeholder__hint">{children}</span> : <p className="placeholder__hint">{children}</p>}
    </Tag>
  );
}

/**
 * Renders a TextBlock: plain text when it is a fact, a Placeholder when it is not, and — when the
 * block holds both — the decided sentences as prose with the hint labelled beside them.
 */
export function Text({ block, inline = false }: { block: TextBlockView; inline?: boolean }) {
  if (!block.placeholder) return <>{block.text}</>;
  const facts = placeholderFacts(block.text);
  const hint = <Placeholder inline={inline}>{placeholderHint(block.text)}</Placeholder>;
  if (!facts) return hint;
  return inline ? (
    <>
      {facts} {hint}
    </>
  ) : (
    <>
      <p>{facts}</p>
      {hint}
    </>
  );
}

/** Paragraph list: facts become <p>, placeholders become blocks, a mixed block becomes both. */
export function Paragraphs({ blocks, className }: { blocks: readonly TextBlockView[]; className?: string }) {
  return (
    <>
      {blocks.map((b, i) => {
        if (!b.placeholder) {
          return (
            <p key={i} className={className}>
              {b.text}
            </p>
          );
        }
        const facts = placeholderFacts(b.text);
        return (
          <Fragment key={i}>
            {facts ? <p className={className}>{facts}</p> : null}
            <Placeholder>{placeholderHint(b.text)}</Placeholder>
          </Fragment>
        );
      })}
    </>
  );
}
