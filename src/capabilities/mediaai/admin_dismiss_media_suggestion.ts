import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { defineCapability } from '@/contracts/capability';
import { CapabilityError } from '@/contracts/errors';
import { toPrincipalRef } from '@/contracts/principal';
import { err, ok } from '@/contracts/result';
import { mediaAiAnnotations } from '@/db/schema/media_ai';
import { getAssetWithCollection } from '@/domain/media';
import { ID, dbOf } from './_shared';

const input = z.object({ assetId: ID });
const output = z.object({ assetId: z.string(), reviewedAt: z.string() });

/**
 * A person decided a machine suggestion is wrong: it is marked reviewed, so it leaves the review
 * queue, and nothing else changes. The photo's published alt text and caption stay exactly as they
 * were (`admin_apply_media_text` is the only path that writes those).
 */
export const adminDismissMediaSuggestion = defineCapability<z.infer<typeof input>, z.infer<typeof output>>({
  name: 'admin_dismiss_media_suggestion',
  title: 'Dismiss an alt text suggestion',
  description: 'Marks the machine-written alt text and caption suggestion for one item as reviewed without publishing it. The item’s own alt text and caption are left unchanged. Admins only.',
  kind: 'action',
  auth: 'admin',
  requires: ['admin_media'],
  confirmation: 'inline',
  idempotent: true,
  annotations: { readOnlyHint: false, untrustedContentHint: false, consequentialHint: false },
  exposure: { ui: true, ai: false, webmcp: false },
  input,
  output,
  async handler(ctx, i) {
    const db = dbOf(ctx);
    const found = await getAssetWithCollection(db, i.assetId);
    if (!found || found.asset.deletedAt) return err(new CapabilityError('not_found', 'We could not find that item.'));
    const [row] = await db
      .update(mediaAiAnnotations)
      .set({ reviewedAt: ctx.now, reviewedBy: toPrincipalRef(ctx.principal), updatedAt: ctx.now })
      .where(eq(mediaAiAnnotations.assetId, i.assetId))
      .returning({ assetId: mediaAiAnnotations.assetId });
    if (!row) return err(new CapabilityError('not_found', 'There is no suggestion for that item.'));
    await ctx.audit.record({
      actor: toPrincipalRef(ctx.principal),
      action: 'content.updated',
      target: { type: 'media_asset', id: i.assetId },
      outcome: 'success',
      requestId: ctx.requestId,
      metadata: { suggestion: 'dismissed' },
    });
    return ok({ data: { assetId: i.assetId, reviewedAt: ctx.now.toISOString() }, sources: [] });
  },
});
