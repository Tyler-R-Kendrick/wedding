import { z } from 'zod';
import { defineCapability } from '@/contracts/capability';
import { ok } from '@/contracts/result';
import type { Db } from '@/db/client';
import { CONTENT_TABLE_NAMES, listContentRecords, TABLE_SPECS } from '@/domain/content/admin';
import { requireService } from './services';

const input = z.object({ table: z.enum(CONTENT_TABLE_NAMES as [string, ...string[]]).optional() }).optional();
const summary = z.object({
  id: z.string(),
  title: z.string(),
  contentVersion: z.number().int(),
  verifiedAt: z.string(),
  validUntil: z.string().optional(),
  visibility: z.string(),
  placeholder: z.boolean(),
  freshness: z.enum(['fresh', 'aging', 'stale', 'expired', 'not_yet_valid']),
  daysSinceVerified: z.number().int(),
  sourceType: z.string(),
});
const output = z.object({
  tables: z.array(z.object({ table: z.string(), label: z.string(), count: z.number().int(), needsAttention: z.number().int(), records: z.array(summary) })),
});
export type ContentRecordsData = z.infer<typeof output>;

export const listContentRecordsCapability = defineCapability<z.infer<typeof input>, ContentRecordsData>({
  name: 'list_content_records',
  title: 'List content records (admin)',
  description: 'Admin only. Lists content records per table with freshness so stale, expired, draft, and placeholder records stand out. Not offered to the concierge.',
  kind: 'read',
  auth: 'admin',
  requires: ['admin_content'],
  annotations: { readOnlyHint: true, untrustedContentHint: false, consequentialHint: false },
  exposure: { ui: true, ai: false, webmcp: false },
  input,
  output,
  async handler(ctx, i) {
    const db = requireService<Db>(ctx, 'db');
    const tables = i?.table ? [i.table as (typeof CONTENT_TABLE_NAMES)[number]] : CONTENT_TABLE_NAMES;
    const out = [];
    for (const table of tables) {
      const records = await listContentRecords(db, table, ctx.now);
      out.push({ table, label: TABLE_SPECS[table].label, count: records.length, needsAttention: records.filter((r) => r.freshness !== 'fresh' || r.placeholder).length, records });
    }
    return ok({ data: { tables: out }, sources: [] });
  },
});
