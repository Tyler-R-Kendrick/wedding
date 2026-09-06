import { z } from 'zod';
import { defineCapability } from '@/contracts/capability';
import { ok } from '@/contracts/result';
import type { Db } from '@/db/client';
import { createReadContext } from '@/domain/content/read-context';
import { storySectionViewSchema } from '@/domain/content/views';
import { getStory as readStory } from '@/domain/story/repo';
import { ROUTES } from '@/domain/routes';
import { requireService } from './services';

const input = z.object({}).optional();
const output = z.object({
  route: z.string(),
  title: z.string(),
  sections: z.array(storySectionViewSchema),
});
export type StoryPageData = z.infer<typeof output>;

export const getStory = defineCapability<z.infer<typeof input>, StoryPageData>({
  name: 'get_story',
  title: 'Our Story',
  description:
    "Returns Sara and Tyler's story as short authored chapters (how they met, the connection, their life together, love, the future, the engagement, what marriage means). " +
    'Chapters marked placeholder are not yet written; never present placeholder text as fact. Read only.',
  kind: 'read',
  auth: 'anonymous',
  requires: [],
  annotations: { readOnlyHint: true, untrustedContentHint: false, consequentialHint: false },
  exposure: { ui: true, ai: true, webmcp: true },
  input,
  output,
  maxOutputChars: 12_000,
  async handler(ctx) {
    const db = requireService<Db>(ctx, 'db');
    const rctx = await createReadContext(db, ctx.principal, ctx.surface ?? 'ui', ctx.now);
    const { sections, sources } = await readStory(rctx);
    return ok({ data: { route: ROUTES.story, title: 'Our Story', sections }, sources });
  },
});
