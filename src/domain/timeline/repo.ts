import { asc } from 'drizzle-orm';
import { loadContentSeed } from '@/content';
import type { Citation } from '@/contracts/provenance';
import { adventureMemories, timelineMoments, type TimelineMomentRow } from '@/db/schema';
import { dedupeCitations, toProvenanceView, toRecordCitation } from '@/domain/content/provenance';
import type { ReadContext } from '@/domain/content/read-context';
import { textBlock } from '@/domain/content/text';
import type { TimelineMomentView } from '@/domain/content/views';
import { filterVisible } from '@/domain/content/visibility';
import { ROUTES } from '@/domain/routes';
import { isMissingTable } from '@/db/missing-table';
import { timelineSeedRows } from '@/db/seed/content';
import { logger } from '@/lib/logger';

/**
 * `linkable` is the set of Our Adventures slugs this reader can open. A station names its adventure
 * whether or not that memory is published yet; it links only to one that is, never to a 404.
 */
export function toTimelineMomentView(row: TimelineMomentRow, ctx: ReadContext, linkable: ReadonlySet<string> = new Set()): TimelineMomentView {
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
    ...(row.adventureSlug && linkable.has(row.adventureSlug) ? { adventureRoute: `${ROUTES.adventures}/${row.adventureSlug}` } : {}),
    placeholder: row.placeholder,
    provenance: toProvenanceView(row, { route, sources: ctx.sources, now: ctx.now }),
  };
}

/** The stations in the couple's order (`order`), which the importer sets from the Paired dates. */
export async function getTimeline(ctx: ReadContext): Promise<{ moments: TimelineMomentView[]; sources: Citation[] }> {
  const [rows, adventures] = await Promise.all([
    readRows(ctx),
    ctx.db.select({ slug: adventureMemories.slug, visibility: adventureMemories.visibility, validFrom: adventureMemories.validFrom, validUntil: adventureMemories.validUntil }).from(adventureMemories),
  ]);
  const visible = filterVisible(rows, ctx.principal, ctx.surface, ctx.now);
  const linkable = new Set(filterVisible(adventures, ctx.principal, ctx.surface, ctx.now).map((a) => a.slug));
  const moments = visible.map((r) => toTimelineMomentView(r, ctx, linkable));
  const sources = dedupeCitations(
    visible.map((r) => toRecordCitation(r, { route: `${ROUTES.story}#${r.slug}`, title: `Our Story › ${r.title}`, recordRef: { type: 'timeline_moments', id: r.id }, now: ctx.now })),
  );
  return { moments, sources };
}

/**
 * The stations, or — only while `timeline_moments` has not been migrated yet — the bundled seed rows
 * `db:seed` would write. Previews read the production database and never migrate
 * (scripts/deploy/migrate-on-deploy.mjs), so without this every preview of a branch that adds the
 * table answers 500. Any other failure still throws.
 */
async function readRows(ctx: ReadContext): Promise<TimelineMomentRow[]> {
  try {
    return await ctx.db.select().from(timelineMoments).orderBy(asc(timelineMoments.order));
  } catch (e) {
    if (!isMissingTable(e, 'timeline_moments')) throw e;
    logger.warn({ table: 'timeline_moments' }, 'timeline table not migrated yet; serving the bundled seed stations');
    return timelineSeedRows(loadContentSeed(), ctx.now).sort((a, b) => a.order - b.order);
  }
}
