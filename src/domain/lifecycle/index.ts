import 'server-only';
import { cache } from 'react';
import type { Principal } from '@/contracts/principal';
import { getDb } from '@/db/client';
import { getLifecycle as getLifecycleRow, getSiteSettings } from '@/db/repos/site';
import { ANONYMOUS } from '@/lib/principal';
import type { CountdownView, LifecycleView, SiteFacts } from '@/themes/types';
import { countdownView } from './countdown';
import { toSiteFacts } from './facts';
import { getPreviewSecret } from './secret';
import { resolveLifecycle } from './state';

export { navFor, homeLabelFor } from './nav';
export { countdownView, daysUntil, dateFacts, formatLongDate, motifDate } from './countdown';
export { resolveLifecycle } from './state';
export { mintPreviewToken, verifyPreviewToken, parsePreviewValue } from './preview';
export { PREVIEW_COOKIE, PREVIEW_QUERY, PREVIEW_TTL_SECONDS } from './constants';
export { toSiteFacts, mapsUrlFor } from './facts';
export { getPreviewSecret } from './secret';

/** One DB round trip per request/render, shared by layout, page, and capabilities. */
const loadSite = cache(async () => {
  const db = await getDb();
  const [site, lifecycle] = await Promise.all([getSiteSettings(db), getLifecycleRow(db)]);
  if (!site) throw new Error('site_settings is empty: run the seed (npm run db:seed)');
  return { site, lifecycle };
});

export interface LifecycleOptions {
  principal?: Principal;
  preview?: { value: string; source: 'query' | 'cookie' } | null;
  now?: Date;
}

/**
 * The lifecycle module is the only place outside tests that reads the clock (ADR-0012 compliance:
 * `new Date()` never appears in src/app or src/components).
 */
export function nowInLifecycle(): Date {
  return new Date();
}

export async function getSiteFacts(): Promise<SiteFacts> {
  const { site } = await loadSite();
  return toSiteFacts(site);
}

export async function getLifecycleView(opts: LifecycleOptions = {}): Promise<LifecycleView> {
  const { site, lifecycle } = await loadSite();
  return resolveLifecycle({
    persisted: lifecycle?.state ?? 'TEASER',
    publishedAt: lifecycle?.publishedAt ?? site.createdAt,
    note: lifecycle?.note ?? null,
    principal: opts.principal ?? ANONYMOUS,
    preview: opts.preview ?? null,
    secret: getPreviewSecret(),
    now: opts.now ?? nowInLifecycle(),
    weddingDateIso: site.weddingDate,
  });
}

export async function getCountdown(now: Date = nowInLifecycle()): Promise<CountdownView> {
  const { site } = await loadSite();
  return countdownView(now, site.weddingDate, site.timezone);
}
