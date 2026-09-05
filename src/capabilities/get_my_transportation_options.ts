import { z } from 'zod';
import { defineCapability } from '@/contracts/capability';
import { ok } from '@/contracts/result';
import { getTransportVault } from '@/domain/external/vault';
import { guestHandoffSchema } from '@/domain/external/schemas';
import { benefitViewsFor, transportationTopics, TRANSPORTATION_CITATIONS } from '@/domain/transport';
import { appServices } from './context';

const input = z.object({}).optional();

const redemptionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('link'), label: z.string(), providerDisplayName: z.string(), url: z.url(), host: z.string(), disclosure: z.string(), expiresAt: z.string().optional() }),
  z.object({ kind: z.literal('code'), code: z.string(), instructions: z.string(), expiresAt: z.string().optional() }),
  z.object({ kind: z.literal('hidden'), revealRoute: z.literal('/transportation'), note: z.string() }),
]);

export const benefitViewSchema = z.object({
  entitlementId: z.string(),
  program: z.string(),
  status: z.enum(['eligible', 'claimed', 'pending', 'failed', 'ineligible', 'revoked', 'expired', 'not_yet_valid', 'unavailable']),
  statusMessage: z.string(),
  amountNote: z.string().nullable(),
  validityNote: z.string().nullable(),
  geofenceNote: z.string().nullable(),
  verifiedAt: z.string().nullable(),
  claim: z.object({ claimId: z.string(), claimedAt: z.string().nullable(), provider: z.string(), providerDisplayName: z.string(), testMode: z.boolean() }).optional(),
  redemption: redemptionSchema.optional(),
});

const topicSchema = z.object({
  id: z.string(),
  title: z.string(),
  paragraphs: z.array(z.string()),
  sourceId: z.string(),
  verifiedAt: z.string(),
  placeholder: z.boolean(),
  directions: z.object({ google: guestHandoffSchema, apple: guestHandoffSchema }).optional(),
  official: guestHandoffSchema.optional(),
});

const output = z.object({
  signedIn: z.boolean(),
  topics: z.array(topicSchema),
  benefits: z.array(benefitViewSchema),
});

export type TransportationOptions = z.infer<typeof output>;

export const getMyTransportationOptions = defineCapability<z.infer<typeof input>, TransportationOptions>({
  name: 'get_my_transportation_options',
  title: 'Transportation options',
  description:
    'How to get to and from the Chicago Athletic Association: airports, trains and buses, taxis and rideshares, the valet entrance, ' +
    'accessible routes, and, for a signed-in guest, the status of their personal ride benefit. Reads only; it never claims anything. ' +
    'Ride codes and links are only shown on the website, never here.',
  kind: 'read',
  auth: 'anonymous',
  requires: [],
  annotations: { readOnlyHint: true, untrustedContentHint: false, consequentialHint: false },
  exposure: { ui: true, ai: true, webmcp: true },
  input,
  output,
  maxOutputChars: 12_000,
  async handler(ctx) {
    const { db, providers } = appServices(ctx);
    const topics = transportationTopics(providers('maps'));
    const signedIn = ctx.principal.kind === 'guest';
    const benefits = signedIn && ctx.principal.kind === 'guest' ? await benefitViewsFor(db, await getTransportVault(), ctx.principal, ctx.now, ctx.surface ?? 'ui') : [];
    return ok({ data: { signedIn, topics, benefits }, sources: TRANSPORTATION_CITATIONS });
  },
});
