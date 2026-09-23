import { asc } from 'drizzle-orm';
import type { Citation } from '@/contracts/provenance';
import { timelineMoments, type TimelineMomentRow } from '@/db/schema';
import { dedupeCitations, toProvenanceView, toRecordCitation } from '@/domain/content/provenance';
import type { ReadContext } from '@/domain/content/read-context';
import { textBlock } from '@/domain/content/text';
import type { TimelineMomentView } from '@/domain/content/views';
import { filterVisible } from '@/domain/content/visibility';
import { ROUTES } from '@/domain/routes';

export function toTimelineMomentView(row: TimelineMomentRow, ctx: ReadContext): TimelineMomentView {
  const route = `${ROUTES.story}#${row.slug}`;
  return {
    id: row.id,
    slug: row.slug,
    chapter: row.chapter,
    title: row.title,
    ...(row.occurredOn ? { occurredOn: row.occurredOn } : {}),
    ...(row.locationLabel ? { locationLabel: row.locationLabel } : {}),
    note: textBlock(row.note),
    media: row.media.map((m) => ({ alt: m.alt, ...(m.caption ? { caption: m.caption } : {}), ...(m.src ? { src: m.src } : {}) })),
    ...(row.adventureSlug ? { adventureRoute: `${ROUTES.adventures}/${row.adventureSlug}` } : {}),
    placeholder: row.placeholder,
    provenance: toProvenanceView(row, { route, sources: ctx.sources, now: ctx.now }),
  };
}

/** The stations in the couple's order (`order`), which the importer sets from the Paired dates. */
export async function getTimeline(ctx: ReadContext): Promise<{ moments: TimelineMomentView[]; sources: Citation[] }> {
  const rows = await ctx.db.select().from(timelineMoments).orderBy(asc(timelineMoments.order));
  const visible = filterVisible(rows, ctx.principal, ctx.surface, ctx.now);
  const moments = visible.map((r) => toTimelineMomentView(r, ctx));
  const sources = dedupeCitations(
    visible.map((r) => toRecordCitation(r, { route: `${ROUTES.story}#${r.slug}`, title: `Our Story › ${r.title}`, recordRef: { type: 'timeline_moments', id: r.id }, now: ctx.now })),
  );
  return { moments, sources };
}
