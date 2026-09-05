import { z } from 'zod';
import { defineCapability } from '@/contracts/capability';
import { toPrincipalRef } from '@/contracts/principal';
import { err, ok } from '@/contracts/result';
import type { Db } from '@/db/client';
import { CONTENT_TABLE_NAMES, markContentVerified as verify } from '@/domain/content/admin';
import { editedByFor } from './save_content_record';
import { requireService } from './services';

const input = z.object({
  table: z.enum(CONTENT_TABLE_NAMES as [string, ...string[]]),
  id: z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/),
  /** ISO instant; defaults to now. Never in the future. */
  verifiedAt: z.iso.datetime({ offset: true }).optional(),
});
const output = z.object({ id: z.string(), verifiedAt: z.string(), previousVerifiedAt: z.string(), contentVersion: z.number().int() });

export const markContentVerified = defineCapability<z.infer<typeof input>, z.infer<typeof output>>({
  name: 'mark_content_verified',
  title: 'Mark a record verified',
  description:
    'Admin only. Stamps verifiedAt on a content record after a person re-checked it against its source (an official page, the kit, the planner). Keeps the previous version and ' +
    'writes a content.verified audit event. Does not change the text. Not offered to the concierge.',
  kind: 'action',
  auth: 'admin',
  requires: ['admin_content'],
  confirmation: 'inline',
  idempotent: true,
  annotations: { readOnlyHint: false, untrustedContentHint: false, consequentialHint: true },
  exposure: { ui: true, ai: false, webmcp: false },
  input,
  output,
  async handler(ctx, i) {
    const db = requireService<Db>(ctx, 'db');
    const result = await verify(
      db,
      { table: i.table as (typeof CONTENT_TABLE_NAMES)[number], id: i.id, verifiedAt: i.verifiedAt },
      { actor: toPrincipalRef(ctx.principal), editedBy: editedByFor(ctx.principal), requestId: ctx.requestId, audit: ctx.audit, now: ctx.now },
    );
    if (!result.ok) return err(result.error);
    return ok({ data: result.value, sources: [] });
  },
});
