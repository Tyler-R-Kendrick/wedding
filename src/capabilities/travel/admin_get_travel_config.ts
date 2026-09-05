import { z } from 'zod';
import { defineCapability } from '@/contracts/capability';
import { hasEntitlement } from '@/contracts/principal';
import { ok } from '@/contracts/result';
import { hotelRecommendationOutput, listHotels, listTravelLinks, travelLinkOutput } from '@/domain/travel';
import { ALLOWED_REDIRECT_HOSTS } from '@/lib/redirects';
import { travelServices } from './_shared';

const input = z.object({}).optional();
const providerStatus = z.object({
  name: z.string(),
  mode: z.string(),
  capabilities: z.record(z.string(), z.boolean()),
  /** Names of missing/malformed variables, never values. */
  config: z.object({ ok: z.boolean(), missing: z.array(z.string()), warnings: z.array(z.string()) }),
});
const output = z.object({
  /** Present only for principals with admin_integrations. */
  providers: z.object({ flights: providerStatus, hotels: providerStatus }).nullable(),
  hotels: z.array(hotelRecommendationOutput),
  links: z.array(travelLinkOutput),
  /** Hosts an admin-entered link may point at (from the redirect allowlist). */
  allowedHosts: z.array(z.string()),
});

export const adminGetTravelConfig = defineCapability<z.infer<typeof input>, z.infer<typeof output>>({
  name: 'admin_get_travel_config',
  title: 'Travel configuration (admin)',
  description: 'Admin view of the travel feature: flight/hotel provider modes and missing configuration names, the curated hotel list including the venue block, and the airline/OTA deep-link table.',
  kind: 'read',
  auth: 'admin',
  requires: ['admin_content'],
  annotations: { readOnlyHint: true, untrustedContentHint: false, consequentialHint: false },
  exposure: { ui: true, ai: false, webmcp: false },
  input,
  output,
  async handler(ctx) {
    const s = travelServices(ctx);
    const describe = (p: { name: string; mode: string; capabilities: Record<string, boolean>; validateConfig(): { ok: boolean; missing: string[]; warnings: string[] } }) => ({
      name: p.name,
      mode: p.mode,
      capabilities: { ...p.capabilities },
      config: p.validateConfig(),
    });
    const providers = hasEntitlement(ctx.principal, 'admin_integrations') ? { flights: describe(s.flights), hotels: describe(s.hotels) } : null;
    const [hotels, links] = await Promise.all([listHotels(s.db, { includeInactive: true, now: ctx.now }), listTravelLinks(s.db, { includeInactive: true })]);
    const allowedHosts = ALLOWED_REDIRECT_HOSTS.map((h) => (typeof h.host === 'string' ? `${h.host}${h.pathPrefix ?? ''}` : 'skyscanner.<tld>'));
    return ok({ data: { providers, hotels, links, allowedHosts }, sources: [] });
  },
});
