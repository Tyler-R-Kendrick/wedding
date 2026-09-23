import type { PageId } from '@wedding/sitemap';

/**
 * Stage 2 — wireframes. A page is an ordered list of blocks; a block names WHAT goes there and
 * roughly how much of it, never how it looks. Stage 3 renders each kind as an interactive
 * skeleton, stage 4 fills it with placeholder copy in each design. Add a kind here and the type
 * checker walks you through every stage that must learn to draw it.
 *
 * Labels describe content ("Ceremony: room and time"); they are never the content. Facts belong to
 * the real app and PRODUCT.md, and unknowns stay TODO(Tyler & Sara) there.
 */

export interface Action {
  label: string;
  /** A sitemap page id. Validated against the sitemap, so a removed page breaks the wireframe that links it. */
  to?: PageId;
  /** An off-site destination, described rather than linked at this stage (e.g. "the registry"). */
  external?: string;
  variant?: 'primary' | 'secondary';
}

export type FieldType = 'text' | 'email' | 'tel' | 'textarea' | 'select' | 'radio' | 'checkbox' | 'file' | 'code' | 'date' | 'search';

export interface Field {
  label: string;
  type: FieldType;
  options?: string[];
  required?: boolean;
  hint?: string;
}

interface Base {
  /** Stable handle for later stages (skeleton names, placeholder overrides). Defaults to `<kind>-<index>`. */
  id?: string;
  /** Annotation drawn beside the block at stage 2: why it is there, what to watch for. */
  note?: string;
}

export type Block =
  | (Base & { kind: 'masthead'; title?: string; lede?: string; media?: 'none' | 'wide' | 'portrait'; actions?: Action[] })
  | (Base & { kind: 'prose'; label: string; paragraphs?: number })
  | (Base & { kind: 'media'; label: string; aspect?: 'wide' | 'portrait' | 'square'; count?: number })
  | (Base & { kind: 'facts'; label: string; items: string[] })
  | (Base & { kind: 'collection'; label: string; item: string; count: number; layout?: 'list' | 'grid' | 'rail'; to?: PageId; media?: boolean })
  | (Base & { kind: 'timeline'; label: string; items: string[] })
  | (Base & { kind: 'form'; label: string; fields: Field[]; submit: string; next?: PageId })
  | (Base & { kind: 'tasks'; label: string; tasks: { title: string; to?: PageId }[] })
  | (Base & { kind: 'map'; label: string; pins?: number })
  | (Base & { kind: 'faq'; label: string; questions: string[] })
  | (Base & { kind: 'callout'; label: string; action: Action })
  | (Base & { kind: 'table'; label: string; columns: string[]; rows?: number; filters?: string[] })
  | (Base & { kind: 'chat'; label: string; suggestions?: string[] })
  | (Base & { kind: 'tabs'; label: string; tabs: { title: string; blocks: Block[] }[] })
  | (Base & { kind: 'split'; label?: string; columns: [Block[], Block[]] });

export type BlockKind = Block['kind'];

export const BLOCK_KINDS = [
  'masthead', 'prose', 'media', 'facts', 'collection', 'timeline', 'form', 'tasks', 'map', 'faq', 'callout', 'table', 'chat', 'tabs', 'split',
] as const satisfies readonly BlockKind[];

/**
 * - `derived`: nobody has drawn this page yet; the wireframe was computed from its sitemap row.
 * - `draft` → `review` → `approved`: a drawn page's progress.
 */
export type WireframeStatus = 'derived' | 'draft' | 'review' | 'approved';

export interface Wireframe {
  page: PageId;
  status: WireframeStatus;
  blocks: Block[];
  notes?: string[];
}

/** An authored wireframe; `page` and `status` are supplied by the registry. */
export interface WireframeSpec {
  status?: Exclude<WireframeStatus, 'derived'>;
  blocks: Block[];
  notes?: string[];
}
