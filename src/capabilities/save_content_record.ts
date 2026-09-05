import { z } from 'zod';
import { defineCapability } from '@/contracts/capability';
import { toPrincipalRef } from '@/contracts/principal';
import { err, ok } from '@/contracts/result';
import type { Db } from '@/db/client';
import { CONTENT_TABLE_NAMES, saveContentRecord as save } from '@/domain/content/admin';
import { requireService } from './services';

const input = z.object({
  table: z.enum(CONTENT_TABLE_NAMES as [string, ...string[]]),
  /** Omit to create. */
  id: z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/).optional(),
  data: z.record(z.string(), z.unknown()),
});
const output = z.object({ id: z.string(), contentVersion: z.number().int(), created: z.boolean() });

/** "admin:<id>" for admins, "system:<component>" for jobs. Never a guest. */
export function editedByFor(principal: Parameters<typeof toPrincipalRef>[0]): string {
  const ref = toPrincipalRef(principal);
  if (ref.kind === 'admin') return `admin:${ref.adminId}`;
  if (ref.kind === 'system') return `system:${ref.component}`;
  return 'unknown';
}

export const saveContentRecord = defineCapability<z.infer<typeof input>, z.infer<typeof output>>({
  name: 'save_content_record',
  title: 'Save a content record',
  description:
    'Admin only. Creates or updates a story section, place, adventure memory, recommendation, itinerary, venue space, venue fact, operational field, or FAQ entry. ' +
    'Validates the record against its table schema, keeps the previous version, bumps contentVersion, and re-projects the AI corpus. Not offered to the concierge.',
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
    const result = await save(
      db,
      { table: i.table as (typeof CONTENT_TABLE_NAMES)[number], id: i.id, data: i.data },
      { actor: toPrincipalRef(ctx.principal), editedBy: editedByFor(ctx.principal), requestId: ctx.requestId, audit: ctx.audit, now: ctx.now },
    );
    if (!result.ok) return err(result.error);
    return ok({ data: result.value, sources: [] });
  },
});
