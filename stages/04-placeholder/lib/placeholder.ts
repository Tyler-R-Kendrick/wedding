import type { Slot } from '@wedding/skeleton';
import { OVERRIDES } from './overrides';

/**
 * Stage 4's content: every slot the skeleton exposes, answered with copy that is honest about
 * being a stand-in. No lorem ipsum (it reads as a template), and no plausible fiction (CLAUDE.md:
 * placeholder facts are TODO(Tyler & Sara), never invented). Paragraphs are sized to the slot, so
 * each design's measure, rhythm and line breaks can be judged before a real word is written.
 *
 * To try a specific line in every design at once, add it to ./overrides.ts by slot key.
 */

const SENTENCES = [
  'It is set at about the length the real copy should run.',
  'That way each design can be judged with its measure, rhythm and line breaks in place.',
  'Tyler and Sara will replace it; until then, nothing in it is a fact.',
  'Long words, short words and the occasional comma are here on purpose.',
  'A guest reading on a phone should never have to pinch to follow it.',
];

/** About how many words fill `lines` lines at a comfortable measure. */
const WORDS_PER_LINE = 11;

export function paragraph(label: string, lines: number): string {
  const target = Math.max(1, lines) * WORDS_PER_LINE;
  const out = [`This stands in for ${label.charAt(0).toLowerCase()}${label.slice(1)}.`];
  let words = out[0]!.split(' ').length;
  for (let i = 0; words < target; i++) {
    const s = SENTENCES[i % SENTENCES.length]!;
    out.push(s);
    words += s.split(' ').length;
  }
  return out.join(' ');
}

export function placeholderFor(slot: Slot): string {
  const override = OVERRIDES[slot.key] ?? OVERRIDES[`*/${slot.block}/${slot.part}`];
  if (override !== undefined) return override;
  switch (slot.shape.kind) {
    case 'media':
      return `Image: ${slot.label}`;
    case 'line':
      // A one-line value next to a label (a fact, a table cell) is a fact nobody has supplied yet.
      if (/^fact-|^r\d+-/.test(slot.part)) return 'TODO(Tyler & Sara)';
      return slot.label;
    case 'text':
      if (slot.part === 'lede') return slot.label;
      return paragraph(slot.label, slot.shape.lines);
  }
}
