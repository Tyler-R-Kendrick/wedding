import { z } from 'zod';
import { defineCapability } from '@/contracts/capability';
import { CapabilityError } from '@/contracts/errors';
import { err, ok } from '@/contracts/result';
import { getAssetWithCollection, isMediaAdmin, isOwner } from '@/domain/media';
import { getAnnotation } from '@/domain/mediaai';
import { ID, dbOf, suggestionSchema, toSuggestion } from './_shared';

const input = z.object({ assetId: ID });
const output = z.object({
  assetId: z.string(),
  /** What is published today (human-written or admin-applied). */
  current: z.object({ caption: z.string().nullable(), altText: z.string().nullable() }),
  /** The machine suggestion, if any. Editable by a human before it is applied; never applied automatically. */
  suggestion: suggestionSchema.nullable(),
  canApply: z.boolean(),
});
export type AltTextSuggestion = z.infer<typeof output>;

export const suggestAltText = defineCapability<z.infer<typeof input>, AltTextSuggestion>({
  name: 'suggest_alt_text',
  title: 'Alt-text suggestion',
  description:
    'Returns the suggested caption and alt text for one photo or video next to what is published now. Suggestions are drafts for a person to edit; ' +
    'only an admin can apply one. The uploader may read suggestions for their own items; admins for any item. Reads only.',
  kind: 'read',
  auth: 'guest',
  requires: [],
  annotations: { readOnlyHint: true, untrustedContentHint: true, consequentialHint: false },
  exposure: { ui: true, ai: false, webmcp: false },
  input,
  output,
  async handler(ctx, i) {
    const db = dbOf(ctx);
    const found = await getAssetWithCollection(db, i.assetId);
    const admin = isMediaAdmin(ctx.principal);
    if (!found || found.asset.deletedAt || (!admin && !isOwner(ctx.principal, found.asset))) return err(new CapabilityError('not_found', 'We could not find that item.'));
    const annotation = await getAnnotation(db, i.assetId);
    return ok({ data: { assetId: i.assetId, current: { caption: found.asset.caption, altText: found.asset.altText }, suggestion: toSuggestion(annotation), canApply: admin }, sources: [] });
  },
});
