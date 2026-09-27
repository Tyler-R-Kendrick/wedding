// Shared by the content screens (server) and their flows (client): types and plain helpers, no server imports.
import type { FieldSpec } from '@/domain/content/admin';

/** A source a record can cite, with what choosing it sets. */
export interface SourceOption {
  value: string;
  label: string;
  sourceType: string;
  trustClass: string;
  /** The official page, when the source is a website: the flow offers it as the record's own. */
  url?: string;
}

/** Another record, by name, for a field that points at one. */
export interface RefOption {
  value: string;
  label: string;
}

/** Everything the add/edit flow for one table needs (`contentEditor` in `./shared`). */
export interface ContentEditor {
  table: string;
  tableLabel: string;
  /** One record, in words: "question". */
  noun: string;
  titleField: string;
  fields: FieldSpec[];
  sources: SourceOption[];
  /** The records a field can point at, by table. */
  refs: Record<string, RefOption[]>;
  /** The placeholder marker; text containing it ticks "This is still a placeholder". */
  marker: string;
  /** A new record's starting values (the default source, trust class and visibility). */
  defaults: Record<string, string>;
}

/** "a question", "an itinerary". */
export function withArticle(noun: string): string {
  return `${/^[aeiou]/i.test(noun) ? 'an' : 'a'} ${noun}`;
}
