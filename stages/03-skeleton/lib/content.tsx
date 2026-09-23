'use client';

import { Skeleton } from 'boneyard-js/react';
import { createContext, useContext, type ReactNode } from 'react';
import { bonesFor, type Shape } from './bones';

/**
 * The seam between stage 3 and stage 4.
 *
 * Every place a wireframe block holds CONTENT (a lede, a paragraph, a list item's title, a fact's
 * value, an image) is a `Slot`. Stage 3 renders no provider, so every slot is a boneyard bone.
 * Stage 4 wraps the same tree in a provider that answers slots with labelled placeholder copy, and
 * the bones give way to text. Structure, links and controls are never slots: they are real at
 * stage 3 already, which is what makes the skeleton interactive rather than a picture.
 */
export interface Slot {
  /** `<pageId>/<blockId>/<part>`: stable across stages, so stage 4 can override one slot. */
  key: string;
  page: string;
  block: string;
  part: string;
  /** What the wireframe says belongs here ("Sara remembers", "Dress code"). */
  label: string;
  shape: Shape;
}

export type Resolver = (slot: Slot) => string | undefined;

const ContentContext = createContext<Resolver | null>(null);
const PageContext = createContext<string>('');

export function ContentProvider({ resolve, children }: { resolve: Resolver; children: ReactNode }) {
  return <ContentContext.Provider value={resolve}>{children}</ContentContext.Provider>;
}

export function PageScope({ page, children }: { page: string; children: ReactNode }) {
  return <PageContext.Provider value={page}>{children}</PageContext.Provider>;
}

export function useSlot(block: string, part: string, label: string, shape: Shape): { slot: Slot; value: string | undefined } {
  const page = useContext(PageContext);
  const resolve = useContext(ContentContext);
  const slot: Slot = { key: `${page}/${block}/${part}`, page, block, part, label, shape };
  return { slot, value: resolve?.(slot) };
}

/** Whether anything is filling slots: stage 3 says no, stage 4 says yes. */
export function useHasContent(): boolean {
  return useContext(ContentContext) !== null;
}

function Bone({ shape, label }: { shape: Shape; label: string }) {
  return (
    <>
      <Skeleton loading initialBones={bonesFor(shape)} color="var(--st-fill)" animate="solid" boneClass="st-bone" className="st-bones">
        {null}
      </Skeleton>
      <span className="st-sr">{label}, not written yet</span>
    </>
  );
}

/** Text content: bones until something fills it. */
export function Text({ block, part, label, lines = 3, as: Tag = 'p', className }: { block: string; part: string; label: string; lines?: number; as?: 'p' | 'span' | 'dd' | 'div'; className?: string }) {
  const shape: Shape = lines === 1 ? { kind: 'line' } : { kind: 'text', lines };
  const { value } = useSlot(block, part, label, shape);
  // Bones are <div>s, which a <p> cannot hold (the parser would split it and hydration would fail).
  const Holder = Tag === 'p' ? 'div' : Tag;
  if (value === undefined) return <Holder className={className}><Bone shape={shape} label={label} /></Holder>;
  return <Tag className={className} data-slot={`${block}/${part}`}>{value}</Tag>;
}

/**
 * An image slot. Filled means "there is a described image here", never a stock photo: stage 4
 * paints a labelled panel, and only the real app shows photographs (CLAUDE.md, media order).
 */
export function Media({ block, part, label, aspect = 'wide', className }: { block: string; part: string; label: string; aspect?: 'wide' | 'portrait' | 'square'; className?: string }) {
  const shape: Shape = { kind: 'media', aspect };
  const { value } = useSlot(block, part, label, shape);
  if (value === undefined) return <span className={`st-media st-media--${aspect} ${className ?? ''}`}><Bone shape={shape} label={label} /></span>;
  return (
    <span role="img" aria-label={value} className={`st-media st-media--${aspect} st-media--filled ${className ?? ''}`} data-slot={`${block}/${part}`}>
      <span className="st-media__label" aria-hidden="true">{value}</span>
    </span>
  );
}
