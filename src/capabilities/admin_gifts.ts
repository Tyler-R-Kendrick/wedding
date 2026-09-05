import { z } from 'zod';
import { defineCapability } from '@/contracts/capability';
import { CapabilityError } from '@/contracts/errors';
import { ID_PATTERN } from '@/contracts/ids';
import { toPrincipalRef } from '@/contracts/principal';
import { err, ok } from '@/contracts/result';
import { assertAllowedRedirect } from '@/lib/redirects';
import { SLUG } from '@/domain/external/schemas';
import { listGiftLinkRows, listGiftLinks, upsertGiftLink } from '@/domain/gifts';
import { appServices } from './context';
import { giftLinkViewSchema } from './list_gift_links';

const upsertInput = z.object({
  id: z.string().regex(SLUG),
  kind: z.enum(['registry', 'adventure-fund']),
  provider: z.string().trim().min(1).max(40),
  label: z.string().trim().min(1).max(120),
  url: z.url(),
  note: z.string().trim().max(200).optional(),
  disclosure: z.string().trim().max(300).optional(),
  placeholder: z.boolean().default(false),
  active: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(1000).default(0),
  sourceId: z.string().regex(ID_PATTERN).optional(),
  verifiedAt: z.string().datetime({ offset: true }).optional(),
});

const rowSchema = z.object({
  id: z.string(),
  kind: z.enum(['registry', 'adventure-fund']),
  provider: z.string(),
  label: z.string(),
  url: z.string(),
  note: z.string().nullable(),
  disclosure: z.string().nullable(),
  placeholder: z.boolean(),
  active: z.boolean(),
  sortOrder: z.number(),
  verifiedAt: z.string().nullable(),
  updatedAt: z.string(),
});

const toRow = (r: Awaited<ReturnType<typeof upsertGiftLink>>) => ({ ...r, sourceId: undefined, updatedBy: undefined, createdAt: undefined, verifiedAt: r.verifiedAt?.toISOString() ?? null, updatedAt: r.updatedAt.toISOString() });

export const adminUpsertGiftLink = defineCapability<z.infer<typeof upsertInput>, z.infer<typeof rowSchema>>({
  name: 'admin_upsert_gift_link',
  title: 'Configure a gift link',
  description: 'Admin: creates or updates a registry / next-adventures link. The URL must be on the trusted-partner allowlist (https, known host).',
  kind: 'action',
  auth: 'admin',
  requires: ['admin_content'],
  confirmation: 'inline',
  idempotent: true,
  annotations: { readOnlyHint: false, untrustedContentHint: false, consequentialHint: false },
  exposure: { ui: true, ai: false, webmcp: false },
  input: upsertInput,
  output: rowSchema,
  async handler(ctx, i) {
    const allowed = assertAllowedRedirect(i.url);
    if (!allowed.ok) return err(new CapabilityError('validation', 'That link is not on our list of trusted partners.', { issues: [{ path: 'url', message: allowed.error.message }] }));
    const { db } = appServices(ctx);
    const row = await upsertGiftLink(db, { ...i, url: allowed.value.toString(), verifiedAt: i.verifiedAt ? new Date(i.verifiedAt) : undefined, updatedBy: toPrincipalRef(ctx.principal) }, ctx.now);
    await ctx.audit.record({ actor: toPrincipalRef(ctx.principal), action: 'content.updated', target: { type: 'gift_link', id: row.id }, outcome: 'success', requestId: ctx.requestId, metadata: { kind: row.kind, provider: row.provider, active: row.active, placeholder: row.placeholder, host: allowed.value.hostname } });
    return ok({ data: toRow(row), sources: [] });
  },
});

const listOutput = z.object({ rows: z.array(rowSchema), effective: z.array(giftLinkViewSchema) });

export const adminListGiftLinks = defineCapability<unknown, z.infer<typeof listOutput>>({
  name: 'admin_list_gift_links',
  title: 'Gift links (admin)',
  description: 'Admin: every configured gift link (including inactive) and the list guests currently see.',
  kind: 'read',
  auth: 'admin',
  requires: ['admin_content'],
  annotations: { readOnlyHint: true, untrustedContentHint: false, consequentialHint: false },
  exposure: { ui: true, ai: false, webmcp: false },
  input: z.unknown(),
  output: listOutput,
  async handler(ctx) {
    const { db, providers } = appServices(ctx);
    const [rows, effective] = await Promise.all([listGiftLinkRows(db, { includeInactive: true }), listGiftLinks(db, { registry: providers('registry'), cashFund: providers('cash-fund') })]);
    return ok({ data: { rows: rows.map(toRow), effective }, sources: [] });
  },
});

export const adminGiftCapabilities = [adminUpsertGiftLink, adminListGiftLinks];
