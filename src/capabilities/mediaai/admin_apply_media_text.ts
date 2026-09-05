import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { defineCapability } from '@/contracts/capability';
import { CapabilityError } from '@/contracts/errors';
import { toPrincipalRef } from '@/contracts/principal';
import { err, ok } from '@/contracts/result';
import { mediaAssets } from '@/db/schema/media';
import { mediaAiAnnotations } from '@/db/schema/media_ai';
import { getAssetWithCollection } from '@/domain/media';
import { enqueueIndex } from '@/domain/mediaai';
import { MAX_CAPTION_CHARS } from '@/lib/media/limits';
import { ID, dbOf } from './_shared';

const input = z.object({
  assetId: ID,
  /** The human-edited text to publish. Empty string clears the field. */
  altText: z.string().max(400).optional(),
  caption: z.string().max(MAX_CAPTION_CHARS).optional(),
});
const output = z.object({ assetId: z.string(), altText: z.string().nullable(), caption: z.string().nullable(), reviewedAt: z.string() });

/** A human decides what is published: this is the only path from a suggestion to media_assets.alt_text / caption. */
export const adminApplyMediaText = defineCapability<z.infer<typeof input>, z.infer<typeof output>>({
  name: 'admin_apply_media_text',
  title: 'Apply caption or alt text',
  description: 'Publishes an admin-edited alt text and/or caption for one item (usually starting from an AI suggestion) and marks the suggestion reviewed. Re-indexes the item. Admins only.',
  kind: 'action',
  auth: 'admin',
  requires: ['admin_media'],
  confirmation: 'inline',
  idempotent: true,
  annotations: { readOnlyHint: false, untrustedContentHint: true, consequentialHint: false },
  exposure: { ui: true, ai: false, webmcp: false },
  input,
  output,
  async handler(ctx, i) {
    const db = dbOf(ctx);
    const found = await getAssetWithCollection(db, i.assetId);
    if (!found || found.asset.deletedAt) return err(new CapabilityError('not_found', 'We could not find that item.'));
    if (i.altText === undefined && i.caption === undefined) return err(new CapabilityError('validation', 'Provide an alt text or a caption to apply.'));
    const clean = (s: string | undefined) => (s === undefined ? undefined : s.replace(/\s+/g, ' ').trim() || null);
    const set: Partial<typeof mediaAssets.$inferInsert> = { updatedAt: ctx.now };
    const altText = clean(i.altText);
    const caption = clean(i.caption);
    if (altText !== undefined) set.altText = altText;
    if (caption !== undefined) set.caption = caption;
    const [row] = await db.update(mediaAssets).set(set).where(eq(mediaAssets.id, i.assetId)).returning();
    await db.update(mediaAiAnnotations).set({ reviewedAt: ctx.now, reviewedBy: toPrincipalRef(ctx.principal), updatedAt: ctx.now }).where(eq(mediaAiAnnotations.assetId, i.assetId));
    await enqueueIndex(db, i.assetId, ctx.now);
    await ctx.audit.record({ actor: toPrincipalRef(ctx.principal), action: 'content.updated', target: { type: 'media_asset', id: i.assetId }, outcome: 'success', requestId: ctx.requestId, metadata: { fields: [altText !== undefined ? 'altText' : null, caption !== undefined ? 'caption' : null].filter(Boolean).join(',') } });
    return ok({ data: { assetId: i.assetId, altText: row!.altText, caption: row!.caption, reviewedAt: ctx.now.toISOString() }, sources: [] });
  },
});
