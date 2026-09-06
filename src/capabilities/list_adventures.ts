import { z } from 'zod';
import { defineCapability } from '@/contracts/capability';
import { ok } from '@/contracts/result';
import type { Db } from '@/db/client';
import { SEASONS } from '@/db/schema/content';
import { listAdventures as readAdventures } from '@/domain/adventures/repo';
import { createReadContext } from '@/domain/content/read-context';
import { adventureCardSchema } from '@/domain/content/views';
import { ROUTES } from '@/domain/routes';
import { requireService } from './services';

const input = z
  .object({
    /** Motif or practical tag, e.g. "adventure", "place", "memory", "hospitality", "future". */
    tag: z.string().regex(/^[a-z0-9-]{1,40}$/).optional(),
    season: z.enum(SEASONS).optional(),
    limit: z.number().int().min(1).max(100).optional(),
  })
  .optional();

const output = z.object({
  route: z.string(),
  items: z.array(adventureCardSchema),
  tags: z.array(z.string()),
  seasons: z.array(z.enum(SEASONS)),
  total: z.number().int(),
});
export type AdventuresPageData = z.infer<typeof output>;

export const listAdventures = defineCapability<z.infer<typeof input>, AdventuresPageData>({
  name: 'list_adventures',
  title: 'Our Adventures',
  description:
    "Lists the couple's adventure memories (places and experiences that shaped their life together) with optional tag and season filters. " +
    'Only memories the caller may see are returned; drafts are never included. Read only.',
  kind: 'read',
  auth: 'anonymous',
  requires: [],
  annotations: { readOnlyHint: true, untrustedContentHint: false, consequentialHint: false },
  exposure: { ui: true, ai: true, webmcp: true },
  input,
  output,
  maxOutputChars: 16_000,
  async handler(ctx, i) {
    const db = requireService<Db>(ctx, 'db');
    const rctx = await createReadContext(db, ctx.principal, ctx.surface ?? 'ui', ctx.now);
    const { items, tags, seasons, total, sources } = await readAdventures(rctx, { tag: i?.tag, season: i?.season, limit: i?.limit });
    return ok({ data: { route: ROUTES.adventures, items, tags, seasons, total }, sources });
  },
});
