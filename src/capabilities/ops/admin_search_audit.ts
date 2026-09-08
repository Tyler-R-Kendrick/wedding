import { z } from 'zod';
import { AUDIT_ACTIONS } from '@/contracts/audit';
import { defineCapability } from '@/contracts/capability';
import { ok } from '@/contracts/result';
import { auditTotals, searchAuditEvents, AUDIT_PAGE_DEFAULT, AUDIT_PAGE_MAX } from '@/domain/ops';
import { auditRowSchema, opsDb } from './_shared';

const isoDate = z.string().datetime().optional();

const input = z
  .object({
    actions: z.array(z.enum(AUDIT_ACTIONS)).max(20).optional(),
    outcome: z.enum(['success', 'denied', 'failed']).optional(),
    targetType: z.string().max(64).optional(),
    targetId: z.string().max(80).optional(),
    requestId: z.string().max(80).optional(),
    actorKind: z.enum(['anonymous', 'guest', 'admin', 'system']).optional(),
    from: isoDate,
    to: isoDate,
    limit: z.number().int().min(1).max(AUDIT_PAGE_MAX).optional(),
    /** From a previous page's `nextCursor`. */
    cursor: z.object({ at: z.string().datetime(), id: z.string().max(80) }).optional(),
  })
  .optional();

const output = z.object({
  rows: z.array(auditRowSchema),
  nextCursor: z.object({ at: z.string(), id: z.string() }).nullable(),
  /** Totals over the same time window (not the same filters) so the page can show proportion. */
  window: z.object({
    from: z.string().nullable(),
    to: z.string().nullable(),
    total: z.number().int(),
    byOutcome: z.record(z.string(), z.number().int()),
    topActions: z.array(z.object({ action: z.string(), count: z.number().int() })),
  }),
  actions: z.array(z.enum(AUDIT_ACTIONS)),
});
export type AuditSearchView = z.infer<typeof output>;

/**
 * The read side of the audit trail. Twenty-one admin capabilities write rows here and until now
 * nothing could read them without a psql prompt.
 *
 * What it will not do: return a row's metadata verbatim. Rows are redacted on write
 * (`redactForAudit`), and `projectAuditMetadata` redacts again on read, withholds the values of
 * free-text keys and caps every value — because this screen is the one place where every action
 * anyone took is visible at once, and it is readable by `admin_audit`, which a moderator holds and
 * `admin_guest_ops` is not implied by.
 */
export const adminSearchAudit = defineCapability<z.infer<typeof input>, AuditSearchView>({
  name: 'admin_search_audit',
  title: 'Audit trail',
  description: 'Searches the append-only audit trail by action, outcome, target, request id, actor kind and time, newest first, with a cursor for the next page. Metadata is redacted and free-text values are withheld. Admins only; reads only.',
  kind: 'read',
  auth: 'admin',
  requires: ['admin_audit'],
  annotations: { readOnlyHint: true, untrustedContentHint: false, consequentialHint: false },
  exposure: { ui: true, ai: false, webmcp: false },
  input,
  output,
  maxOutputChars: 200_000,
  async handler(ctx, i) {
    const db = opsDb(ctx);
    const from = i?.from ? new Date(i.from) : undefined;
    const to = i?.to ? new Date(i.to) : undefined;
    const [page, totals] = await Promise.all([
      searchAuditEvents(db, {
        actions: i?.actions,
        outcome: i?.outcome,
        targetType: i?.targetType,
        targetId: i?.targetId,
        requestId: i?.requestId,
        actorKind: i?.actorKind,
        from,
        to,
        limit: i?.limit ?? AUDIT_PAGE_DEFAULT,
        cursor: i?.cursor ? { at: new Date(i.cursor.at), id: i.cursor.id } : undefined,
      }),
      auditTotals(db, { from, to }),
    ]);
    return ok({
      data: {
        rows: page.rows,
        nextCursor: page.nextCursor,
        window: { from: from?.toISOString() ?? null, to: to?.toISOString() ?? null, ...totals },
        actions: [...AUDIT_ACTIONS],
      },
      sources: [],
    });
  },
});
