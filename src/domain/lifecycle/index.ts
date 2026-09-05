import 'server-only';
import { cache } from 'react';
import type { Principal } from '@/contracts/principal';
import { getDb } from '@/db/client';
import { getLifecycle as getLifecycleRow, getSiteSettings } from '@/db/repos/site';
import { SEED_SITE } from '@/db/seed/seed';
import { logger } from '@/lib/logger';
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

interface SiteRow {
  coupleDisplayName: string;
  partner1Name: string;
  partner2Name: string;
  weddingDate: string;
  timezone: string;
  venueName: string;
  venueAddress: string;
  venueUrl: string | null;
  createdAt: Date | null;
}

/** The brief's facts (identical to the seed row) when the database is unreachable or unseeded. */
const FALLBACK_SITE: SiteRow = { ...SEED_SITE, createdAt: null };

/**
 * One DB round trip per request/render, shared by layout, page, and capabilities. Static Home is
 * prerendered at build time, where the database may be unmigrated or unreachable: in that case
 * the brief's seeded facts and the TEASER state render, and the 60 s revalidation picks up the real
 * row at runtime. Any other failure is logged, never thrown into a guest's page.
 */
const loadSite = cache(async (): Promise<{ site: SiteRow; lifecycle: Awaited<ReturnType<typeof getLifecycleRow>> }> => {
  try {
    const db = await getDb();
    const [site, lifecycle] = await Promise.all([getSiteSettings(db), getLifecycleRow(db)]);
    if (site) return { site, lifecycle };
    logger.warn('site_settings is empty; rendering from the brief facts (run npm run db:seed)');
  } catch (err) {
    if (process.env.NEXT_PHASE !== 'phase-production-build') logger.warn({ err }, 'site settings unavailable; rendering from the brief facts');
  }
  return { site: FALLBACK_SITE, lifecycle: null };
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
    publishedAt: lifecycle?.publishedAt ?? site.createdAt ?? null,
    note: lifecycle?.note ?? null,
    principal: opts.principal ?? ANONYMOUS,
    preview: opts.preview ?? null,
    secret: getPreviewSecret,
    now: opts.now ?? nowInLifecycle(),
    weddingDateIso: site.weddingDate,
  });
}

export async function getCountdown(now: Date = nowInLifecycle()): Promise<CountdownView> {
  const { site } = await loadSite();
  return countdownView(now, site.weddingDate, site.timezone);
}
