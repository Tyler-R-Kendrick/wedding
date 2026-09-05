import { asc } from 'drizzle-orm';
import type { Citation } from '@/contracts/provenance';
import { storySections, type StorySectionRow } from '@/db/schema';
import { dedupeCitations, toProvenanceView, toRecordCitation } from '@/domain/content/provenance';
import type { ReadContext } from '@/domain/content/read-context';
import { textBlocks } from '@/domain/content/text';
import type { StorySectionView } from '@/domain/content/views';
import { filterVisible } from '@/domain/content/visibility';
import { ROUTES } from '@/domain/routes';

export function toStorySectionView(row: StorySectionRow, ctx: ReadContext): StorySectionView {
  const route = `${ROUTES.story}#${row.slug}`;
  return {
    id: row.id,
    slug: row.slug,
    chapter: row.chapter,
    title: row.title,
    paragraphs: textBlocks(row.paragraphs),
    media: row.media.map((m) => ({ alt: m.alt, ...(m.caption ? { caption: m.caption } : {}), ...(m.src ? { src: m.src } : {}) })),
    placeholder: row.placeholder,
    provenance: toProvenanceView(row, { route, sources: ctx.sources, now: ctx.now }),
  };
}

export async function getStory(ctx: ReadContext): Promise<{ sections: StorySectionView[]; sources: Citation[] }> {
  const rows = await ctx.db.select().from(storySections).orderBy(asc(storySections.order));
  const visible = filterVisible(rows, ctx.principal, ctx.surface, ctx.now);
  const sections = visible.map((r) => toStorySectionView(r, ctx));
  const sources = dedupeCitations(
    visible.map((r) => toRecordCitation(r, { route: `${ROUTES.story}#${r.slug}`, title: `Our Story › ${r.title}`, recordRef: { type: 'story_sections', id: r.id }, now: ctx.now })),
  );
  return { sections, sources };
}
