import { splitSentences } from './text';
import type { AnswerSource, SpotlightedSource } from './types';
import { citationToAnswerSource } from './trust';

/**
 * Citation markers. The model cites evidence blocks by id: "[S1]", "[S1, S3]", "[S1][S2]".
 * Every factual sentence must carry at least one; the verifier strips the rest (ADR-0003 rule 4).
 */
export const MARKER_GROUP = /\[\s*S\d+(?:\s*,\s*S\d+)*\s*\]/g;
const MARKER_ID = /S\d+/g;

export interface CitedSentence {
  text: string;
  /** Sentence with markers removed, for support checks and display. */
  plain: string;
  markers: string[];
}

export function markersIn(text: string): string[] {
  const out = new Set<string>();
  for (const group of text.match(MARKER_GROUP) ?? []) for (const id of group.match(MARKER_ID) ?? []) out.add(id);
  return [...out];
}

export function stripMarkers(text: string): string {
  return text.replace(MARKER_GROUP, '').replace(/\s+([.,;:!?])/g, '$1').replace(/\s{2,}/g, ' ').trim();
}

export function citedSentences(text: string): CitedSentence[] {
  return splitSentences(text).map((s) => ({ text: s, plain: stripMarkers(s), markers: markersIn(s) }));
}

/** Renumbers the markers that survived verification to a dense S1..Sn and returns the sources block. */
export function finaliseCitations(sentences: readonly CitedSentence[], sources: readonly SpotlightedSource[]): { text: string; sources: AnswerSource[]; markerMap: Map<string, string> } {
  const byMarker = new Map(sources.map((s) => [s.marker, s]));
  const order: string[] = [];
  for (const s of sentences) for (const m of s.markers) if (byMarker.has(m) && !order.includes(m)) order.push(m);
  const markerMap = new Map(order.map((m, i) => [m, `S${i + 1}`]));
  const text = sentences
    .map((s) =>
      s.text
        .replace(MARKER_GROUP, (group) => {
          const ids = (group.match(MARKER_ID) ?? []).map((id) => markerMap.get(id)).filter((id): id is string => !!id);
          return ids.length ? `[${[...new Set(ids)].join(', ')}]` : '';
        })
        .replace(/\s+([.,;:!?])/g, '$1')
        .replace(/\s{2,}/g, ' ')
        .trim(),
    )
    .join(' ');
  const answerSources = order.map((m) => {
    const src = byMarker.get(m)!;
    return citationToAnswerSource(markerMap.get(m)!, src.citation, src.trust, src.retrievedAt);
  });
  return { text, sources: answerSources, markerMap };
}
