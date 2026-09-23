import { asc } from 'drizzle-orm';
import { loadContentSeed } from '@/content';
import type { Citation } from '@/contracts/provenance';
import { timelineMoments, type TimelineMomentRow } from '@/db/schema';
import { dedupeCitations, toProvenanceView, toRecordCitation } from '@/domain/content/provenance';
import type { ReadContext } from '@/domain/content/read-context';
import { textBlock } from '@/domain/content/text';
import type { TimelineMomentView } from '@/domain/content/views';
import { filterVisible } from '@/domain/content/visibility';
import { ROUTES } from '@/domain/routes';
import { timelineSeedRows } from '@/db/seed/content';
import { logger } from '@/lib/logger';

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
  const rows = await readRows(ctx);
  const visible = filterVisible(rows, ctx.principal, ctx.surface, ctx.now);
  const moments = visible.map((r) => toTimelineMomentView(r, ctx));
  const sources = dedupeCitations(
    visible.map((r) => toRecordCitation(r, { route: `${ROUTES.story}#${r.slug}`, title: `Our Story › ${r.title}`, recordRef: { type: 'timeline_moments', id: r.id }, now: ctx.now })),
  );
  return { moments, sources };
}

/** Postgres "undefined_table" for this table, however the driver wraps it (postgres-js, PGlite, drizzle). */
function isMissingTable(e: unknown): boolean {
  for (let cur: unknown = e, depth = 0; cur && depth < 4; cur = (cur as { cause?: unknown }).cause, depth++) {
    const { code, message } = cur as { code?: unknown; message?: unknown };
    if (code === '42P01' && String(message ?? '').includes('timeline_moments')) return true;
  }
  return false;
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
    if (!isMissingTable(e)) throw e;
    logger.warn({ table: 'timeline_moments' }, 'timeline table not migrated yet; serving the bundled seed stations');
    return timelineSeedRows(loadContentSeed(), ctx.now).sort((a, b) => a.order - b.order);
  }
}
