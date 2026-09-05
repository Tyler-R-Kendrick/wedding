import { z } from 'zod';
import { defineCapability } from '@/contracts/capability';
import { CapabilityError } from '@/contracts/errors';
import { err, ok } from '@/contracts/result';
import type { Db } from '@/db/client';
import { createReadContext } from '@/domain/content/read-context';
import { textBlockSchema, venueSpaceViewSchema } from '@/domain/content/views';
import { getVenueSpace, ROOMS_NOT_CONFIRMED } from '@/domain/venue/repo';
import { requireService } from './services';

const input = z.object({ slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(80) });
const output = z.object({ space: venueSpaceViewSchema, roomsNotConfirmed: textBlockSchema });
export type VenueRoomData = z.infer<typeof output>;

export const showVenueRoom = defineCapability<z.infer<typeof input>, VenueRoomData>({
  name: 'show_venue_room',
  title: 'Show a CAA space',
  description:
    'Returns one Chicago Athletic Association event space by slug (white-city-ballroom, madison-ballroom, stagg-court, the-tank): character, features, "look for this" details, ' +
    'and kit capacities that are explicitly unverified. Which room hosts the ceremony or reception is NOT confirmed; never state one as the wedding room. Read only.',
  kind: 'read',
  auth: 'anonymous',
  requires: [],
  annotations: { readOnlyHint: true, untrustedContentHint: false, consequentialHint: false },
  exposure: { ui: true, ai: true, webmcp: true },
  input,
  output,
  maxOutputChars: 6_000,
  async handler(ctx, { slug }) {
    const db = requireService<Db>(ctx, 'db');
    const rctx = await createReadContext(db, ctx.principal, ctx.surface ?? 'ui', ctx.now);
    const found = await getVenueSpace(rctx, slug);
    if (!found) return err(new CapabilityError('not_found', "We don't have a space by that name."));
    return ok({ data: { space: found.space, roomsNotConfirmed: ROOMS_NOT_CONFIRMED }, sources: found.sources });
  },
});
