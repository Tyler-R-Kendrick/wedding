import { z } from 'zod';
import { defineCapability } from '@/contracts/capability';
import { CapabilityError } from '@/contracts/errors';
import { err, ok } from '@/contracts/result';
import type { Db } from '@/db/client';
import { CONTENT_TABLE_NAMES, getContentRecord, listRevisions, rowToEditable } from '@/domain/content/admin';
import { computeFreshness } from '@/domain/content/freshness';
import { requireService } from './services';

const input = z.object({ table: z.enum(CONTENT_TABLE_NAMES as [string, ...string[]]), id: z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/) });
const output = z.object({
  table: z.string(),
  id: z.string(),
  values: z.record(z.string(), z.unknown()),
  contentVersion: z.number().int(),
  editedBy: z.string(),
  updatedAt: z.string(),
  freshness: z.enum(['fresh', 'aging', 'stale', 'expired', 'not_yet_valid']),
  revisions: z.array(z.object({ contentVersion: z.number().int(), editedBy: z.string(), editedAt: z.string(), reason: z.string().nullable() })),
});
export type ContentRecordData = z.infer<typeof output>;

export const getContentRecordCapability = defineCapability<z.infer<typeof input>, ContentRecordData>({
  name: 'get_content_record',
  title: 'Get a content record (admin)',
  description: 'Admin only. Returns one content record in its editable form with its revision history. Not offered to the concierge.',
  kind: 'read',
  auth: 'admin',
  requires: ['admin_content'],
  annotations: { readOnlyHint: true, untrustedContentHint: false, consequentialHint: false },
  exposure: { ui: true, ai: false, webmcp: false },
  input,
  output,
  async handler(ctx, { table, id }) {
    const db = requireService<Db>(ctx, 'db');
    const t = table as (typeof CONTENT_TABLE_NAMES)[number];
    const row = await getContentRecord(db, t, id);
    if (!row) return err(new CapabilityError('not_found', 'That record does not exist.'));
    const revisions = await listRevisions(db, t, id);
    return ok({
      data: {
        table,
        id,
        values: rowToEditable(t, row),
        contentVersion: Number(row.contentVersion),
        editedBy: String(row.editedBy),
        updatedAt: (row.updatedAt as Date).toISOString(),
        freshness: computeFreshness({ sourceType: row.sourceType as never, verifiedAt: row.verifiedAt as Date, validFrom: row.validFrom as Date | null, validUntil: row.validUntil as Date | null }, ctx.now),
        revisions: revisions.map((r) => ({ contentVersion: r.contentVersion, editedBy: r.editedBy, editedAt: r.editedAt.toISOString(), reason: r.reason })),
      },
      sources: [],
    });
  },
});
