import { z } from 'zod';
import { defineCapability } from '@/contracts/capability';
import { ok } from '@/contracts/result';
import type { Db } from '@/db/client';
import { createReadContext } from '@/domain/content/read-context';
import { faqViewSchema } from '@/domain/content/views';
import { listFaq } from '@/domain/knowledge/repo';
import { ROUTES } from '@/domain/routes';
import { requireService } from './services';

const input = z.object({}).optional();
const output = z.object({ route: z.string(), entries: z.array(faqViewSchema) });
export type FaqPageData = z.infer<typeof output>;

export const getFaq = defineCapability<z.infer<typeof input>, FaqPageData>({
  name: 'get_faq',
  title: 'Ask Us (FAQ)',
  description:
    'Returns the frequently asked questions and their answers (when, where, dress code, kids, plus-ones, parking, weather, photos, accessibility, RSVP, travel, gifts, contact). ' +
    'Answers marked placeholder are not yet decided by the couple: say so and point at the page rather than guessing. Read only.',
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
    const { entries, sources } = await listFaq(rctx);
    return ok({ data: { route: ROUTES.ask, entries }, sources });
  },
});
