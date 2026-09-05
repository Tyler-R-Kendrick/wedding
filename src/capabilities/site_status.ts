import { z } from 'zod';
import { defineCapability } from '@/contracts/capability';
import { CapabilityError } from '@/contracts/errors';
import type { ContentSourceId } from '@/contracts/ids';
import { LIFECYCLE_MODE, LIFECYCLE_STATES, suggestedStateFor } from '@/contracts/lifecycle';
import type { Citation } from '@/contracts/provenance';
import { err, ok } from '@/contracts/result';
import type { Db } from '@/db/client';
import { getContentSource, getLifecycle, getSiteSettings } from '@/db/repos/site';
import { requireService } from './services';

const input = z.object({}).optional();

const output = z.object({
  lifecycle: z.object({
    state: z.enum(LIFECYCLE_STATES),
    mode: z.enum(['explore', 'act', 'operate', 'remember']),
    publishedAt: z.string(),
    note: z.string().nullable(),
    /** Calendar-based suggestion for admins; never applied automatically. */
    suggested: z.enum(LIFECYCLE_STATES),
  }),
  wedding: z.object({
    coupleDisplayName: z.string(),
    date: z.string(),
    timezone: z.string(),
    venueName: z.string(),
    venueAddress: z.string(),
    venueUrl: z.string().nullable(),
  }),
  themes: z.array(z.string()),
  defaultTheme: z.string(),
});

export type SiteStatus = z.infer<typeof output>;

export const siteStatus = defineCapability<z.infer<typeof input>, SiteStatus>({
  name: 'site_status',
  title: 'Site status',
  description:
    'Returns what stage the wedding site is in (teaser, RSVP open, wedding week, archive...), the wedding date and time zone, ' +
    'the venue, and the available visual themes. Use it to orient before answering questions about timing. It reads only.',
  kind: 'read',
  auth: 'anonymous',
  requires: [],
  annotations: { readOnlyHint: true, untrustedContentHint: false, consequentialHint: false },
  exposure: { ui: true, ai: true, webmcp: true },
  input,
  output,
  maxOutputChars: 2_000,
  async handler(ctx) {
    const db = requireService<Db>(ctx, 'db');
    const [site, lifecycle] = await Promise.all([getSiteSettings(db), getLifecycle(db)]);
    if (!site) return err(new CapabilityError('not_found', 'The site has not been set up yet.'));
    const sources: Citation[] = [];
    if (site.sourceId) {
      const source = await getContentSource(db, site.sourceId);
      if (source) sources.push({ sourceId: source.id as ContentSourceId, title: source.title, url: source.canonicalUrl ?? undefined, verifiedAt: source.verifiedAt.toISOString() });
    }
    const state = lifecycle?.state ?? 'TEASER';
    return ok({
      data: {
        lifecycle: {
          state,
          mode: LIFECYCLE_MODE[state],
          publishedAt: (lifecycle?.publishedAt ?? site.createdAt).toISOString(),
          note: lifecycle?.note ?? null,
          suggested: suggestedStateFor(ctx.now, site.weddingDate),
        },
        wedding: {
          coupleDisplayName: site.coupleDisplayName,
          date: site.weddingDate,
          timezone: site.timezone,
          venueName: site.venueName,
          venueAddress: site.venueAddress,
          venueUrl: site.venueUrl,
        },
        themes: site.themes,
        defaultTheme: site.defaultTheme,
      },
      sources,
    });
  },
});
