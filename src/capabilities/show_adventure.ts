import { z } from 'zod';
import { defineCapability } from '@/contracts/capability';
import { CapabilityError } from '@/contracts/errors';
import { err, ok } from '@/contracts/result';
import type { Db } from '@/db/client';
import { getAdventure } from '@/domain/adventures/repo';
import { createReadContext } from '@/domain/content/read-context';
import { adventureDetailSchema } from '@/domain/content/views';
import { requireService } from './services';

const input = z.object({ slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(80) });
const output = adventureDetailSchema;
export type AdventureDetailData = z.infer<typeof output>;

export const showAdventure = defineCapability<z.infer<typeof input>, AdventureDetailData>({
  name: 'show_adventure',
  title: 'Show an adventure',
  description:
    'Returns one adventure memory by slug: the summary, the longer memory, optional "Sara remembers" / "Tyler remembers" notes, the place, and the recommendations linked to it ' +
    '(each with a directions or booking handoff). Unknown or private memories return not_found. Read only.',
  kind: 'read',
  auth: 'anonymous',
  requires: [],
  annotations: { readOnlyHint: true, untrustedContentHint: false, consequentialHint: false },
  exposure: { ui: true, ai: true, webmcp: true },
  input,
  output,
  maxOutputChars: 16_000,
  async handler(ctx, { slug }) {
    const db = requireService<Db>(ctx, 'db');
    const rctx = await createReadContext(db, ctx.principal, ctx.surface ?? 'ui', ctx.now);
    const found = await getAdventure(rctx, slug);
    if (!found) return err(new CapabilityError('not_found', "We don't have an adventure by that name."));
    return ok({ data: found.detail, sources: found.sources });
  },
});
