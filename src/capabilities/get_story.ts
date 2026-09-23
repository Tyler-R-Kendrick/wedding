import { z } from 'zod';
import { defineCapability } from '@/contracts/capability';
import { ok } from '@/contracts/result';
import type { Db } from '@/db/client';
import { createReadContext } from '@/domain/content/read-context';
import { storySectionViewSchema, timelineMomentViewSchema } from '@/domain/content/views';
import { getStory as readStory } from '@/domain/story/repo';
import { getTimeline } from '@/domain/timeline/repo';
import { ROUTES } from '@/domain/routes';
import { requireService } from './services';

const input = z.object({}).optional();
const output = z.object({
  route: z.string(),
  title: z.string(),
  sections: z.array(storySectionViewSchema),
  timeline: z.array(timelineMomentViewSchema),
});
export type StoryPageData = z.infer<typeof output>;

export const getStory = defineCapability<z.infer<typeof input>, StoryPageData>({
  name: 'get_story',
  title: 'Our Story',
  description:
    "Returns Sara and Tyler's story as short authored chapters (how they met, the connection, their life together, love, the future, the engagement, what marriage means) " +
    'and the timeline of remembered moments along them (each with a chapter, and a date only when the couple recorded one). ' +
    'Chapters and moments marked placeholder are not yet written; never present placeholder text as fact, and never guess a missing date. Read only.',
  kind: 'read',
  auth: 'anonymous',
  requires: [],
  annotations: { readOnlyHint: true, untrustedContentHint: false, consequentialHint: false },
  exposure: { ui: true, ai: true, webmcp: true },
  input,
  output,
  maxOutputChars: 24_000,
  async handler(ctx) {
    const db = requireService<Db>(ctx, 'db');
    const rctx = await createReadContext(db, ctx.principal, ctx.surface ?? 'ui', ctx.now);
    const story = await readStory(rctx);
    const timeline = await getTimeline(rctx);
    return ok({ data: { route: ROUTES.story, title: 'Our Story', sections: story.sections, timeline: timeline.moments }, sources: [...story.sources, ...timeline.sources] });
  },
});
