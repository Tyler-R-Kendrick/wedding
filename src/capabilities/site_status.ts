import { z } from 'zod';
import { defineCapability } from '@/contracts/capability';
import { CapabilityError } from '@/contracts/errors';
import type { ContentSourceId } from '@/contracts/ids';
import { LIFECYCLE_STATES } from '@/contracts/lifecycle';
import type { Citation } from '@/contracts/provenance';
import { err, ok } from '@/contracts/result';
import type { Db } from '@/db/client';
import { getContentSource, getLifecycle, getSiteSettings } from '@/db/repos/site';
import { countdownView } from '@/domain/lifecycle/countdown';
import { toSiteFacts } from '@/domain/lifecycle/facts';
import { navFor } from '@/domain/lifecycle/nav';
import { getPreviewSecret } from '@/domain/lifecycle/secret';
import { resolveLifecycle } from '@/domain/lifecycle/state';
import { DEFAULT_THEME, isThemeId, listThemes, THEME_IDS } from '@/themes/registry';
import { requireService } from './services';

const input = z.object({}).optional();

const navItem = z.object({ label: z.string(), href: z.string(), external: z.boolean().optional(), provider: z.string().optional() });

const output = z.object({
  lifecycle: z.object({
    state: z.enum(LIFECYCLE_STATES),
    mode: z.enum(['explore', 'act', 'operate', 'remember']),
    publishedAt: z.string(),
    note: z.string().nullable(),
    /** Calendar-based suggestion for admins; never applied automatically. */
    suggested: z.enum(LIFECYCLE_STATES),
    /** True when an admin preview overlays the persisted state for this response only. */
    preview: z.boolean(),
    persistedState: z.enum(LIFECYCLE_STATES),
  }),
  wedding: z.object({
    coupleDisplayName: z.string(),
    date: z.string(),
    /** "Saturday, July 17, 2027" in the wedding's time zone. */
    dateLong: z.string(),
    timezone: z.string(),
    venueName: z.string(),
    venueAddress: z.string(),
    venueUrl: z.string().nullable(),
    mapsUrl: z.string(),
  }),
  countdown: z.object({ days: z.number().int(), isToday: z.boolean(), isPast: z.boolean() }),
  navigation: z.object({ primary: z.array(navItem), more: z.array(navItem), sticky: z.array(navItem) }),
  theme: z.object({
    active: z.enum(THEME_IDS),
    available: z.array(z.object({ id: z.enum(THEME_IDS), name: z.string(), tagline: z.string() })),
    switcherEnabled: z.boolean(),
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
    'the venue, the days remaining, the navigation for this stage, and the active and available visual designs. ' +
    'Use it to orient before answering questions about timing. It reads only.',
  kind: 'read',
  auth: 'anonymous',
  requires: [],
  annotations: { readOnlyHint: true, untrustedContentHint: false, consequentialHint: false },
  exposure: { ui: true, ai: true, webmcp: true },
  input,
  output,
  maxOutputChars: 4_000,
  async handler(ctx) {
    const db = requireService<Db>(ctx, 'db');
    const [site, lifecycleRow] = await Promise.all([getSiteSettings(db), getLifecycle(db)]);
    if (!site) return err(new CapabilityError('not_found', 'The site has not been set up yet.'));
    const sources: Citation[] = [];
    if (site.sourceId) {
      const source = await getContentSource(db, site.sourceId);
      if (source) sources.push({ sourceId: source.id as ContentSourceId, title: source.title, url: source.canonicalUrl ?? undefined, verifiedAt: source.verifiedAt.toISOString() });
    }
    const lifecycle = resolveLifecycle({
      persisted: lifecycleRow?.state ?? 'TEASER',
      publishedAt: lifecycleRow?.publishedAt ?? site.createdAt,
      note: lifecycleRow?.note ?? null,
      principal: ctx.principal,
      preview: ctx.view?.lifecycle ? { value: ctx.view.lifecycle, source: 'query' } : null,
      secret: getPreviewSecret,
      now: ctx.now,
      weddingDateIso: site.weddingDate,
    });
    const facts = toSiteFacts(site);
    const countdown = countdownView(ctx.now, site.weddingDate, site.timezone);
    const nav = navFor(lifecycle.state, { venue: facts.venue, claimed: ctx.principal.kind === 'guest' });
    const requested = ctx.view?.theme?.toLowerCase();
    const active = isThemeId(requested) ? requested : isThemeId(site.defaultTheme) ? site.defaultTheme : DEFAULT_THEME;
    return ok({
      data: {
        lifecycle: {
          state: lifecycle.state,
          mode: lifecycle.mode,
          publishedAt: lifecycle.publishedAt ?? site.createdAt.toISOString(),
          note: lifecycle.note,
          suggested: lifecycle.suggested,
          preview: lifecycle.preview !== null,
          persistedState: lifecycle.persistedState,
        },
        wedding: {
          coupleDisplayName: site.coupleDisplayName,
          date: site.weddingDate,
          dateLong: facts.date.long,
          timezone: site.timezone,
          venueName: site.venueName,
          venueAddress: site.venueAddress,
          venueUrl: site.venueUrl,
          mapsUrl: facts.venue.mapsUrl,
        },
        countdown: { days: countdown.days, isToday: countdown.isToday, isPast: countdown.isPast },
        navigation: { primary: nav.primary, more: nav.more, sticky: nav.sticky },
        theme: {
          active,
          available: listThemes().map((t) => ({ id: t.id, name: t.name, tagline: t.tagline })),
          switcherEnabled: ctx.flags.DESIGN_SWITCHER,
        },
        themes: site.themes,
        defaultTheme: site.defaultTheme,
      },
      sources,
    });
  },
});
