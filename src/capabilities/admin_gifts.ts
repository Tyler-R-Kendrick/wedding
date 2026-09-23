import { z } from 'zod';
import { defineCapability } from '@/contracts/capability';
import { CapabilityError } from '@/contracts/errors';
import { ID_PATTERN } from '@/contracts/ids';
import { toPrincipalRef } from '@/contracts/principal';
import { err, ok } from '@/contracts/result';
import { assertAllowedRedirect } from '@/lib/redirects';
import { SLUG } from '@/domain/external/schemas';
import { GIFT_RAILS } from '@/db/schema';
import { listGiftFundEntries, listGiftLinkRows, listGiftLinks, listGiftRailRows, parseRailHandle, RAILS, upsertGiftFund, upsertGiftLink, upsertGiftRail } from '@/domain/gifts';
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

const fundInput = z.object({
  id: z.string().regex(SLUG),
  title: z.string().trim().min(1).max(80),
  description: z.string().trim().max(200).optional(),
  active: z.boolean().default(true),
  /** Omitted: a default keeps its place and a new fund goes after the defaults. */
  sortOrder: z.number().int().min(0).max(1000).optional(),
});

const fundSchema = z.object({ id: z.string(), title: z.string(), description: z.string().nullable(), active: z.boolean(), sortOrder: z.number(), origin: z.enum(['default', 'admin']) });

/**
 * Admin: rename, reorder, hide or add a fund (ADR-0013). The four defaults need no row; saving one
 * with a default's id (honeymoon, home, adoption, next-adventures) replaces its words.
 */
export const adminUpsertGiftFund = defineCapability<z.infer<typeof fundInput>, z.infer<typeof fundSchema>>({
  name: 'admin_upsert_gift_fund',
  title: 'Configure a gift fund',
  description: 'Admin: creates or updates what a gift of money can go toward (honeymoon, home, adoption, next adventures, or a new one).',
  kind: 'action',
  auth: 'admin',
  requires: ['admin_content'],
  confirmation: 'inline',
  idempotent: true,
  annotations: { readOnlyHint: false, untrustedContentHint: false, consequentialHint: false },
  exposure: { ui: true, ai: false, webmcp: false },
  input: fundInput,
  output: fundSchema,
  async handler(ctx, i) {
    const { db } = appServices(ctx);
    const row = await upsertGiftFund(db, { ...i, updatedBy: toPrincipalRef(ctx.principal) }, ctx.now);
    await ctx.audit.record({ actor: toPrincipalRef(ctx.principal), action: 'content.updated', target: { type: 'gift_fund', id: row.id }, outcome: 'success', requestId: ctx.requestId, metadata: { active: row.active } });
    return ok({ data: { id: row.id, title: row.title, description: row.description, active: row.active, sortOrder: row.sortOrder, origin: 'admin' as const }, sources: [] });
  },
});

const railInput = z.object({
  rail: z.enum(GIFT_RAILS),
  /** Venmo username, PayPal.Me name, $Cashtag, Zelle email or US mobile, or a mailing address (one line per row). */
  handle: z.union([z.string(), z.array(z.string())]).transform((h) => (Array.isArray(h) ? h.join('\n') : h)),
  recipientName: z.string().trim().min(1).max(80).optional(),
  active: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(1000).optional(),
});

const railRowSchema = z.object({ rail: z.enum(GIFT_RAILS), displayName: z.string(), handle: z.string(), recipientName: z.string().nullable(), active: z.boolean(), sortOrder: z.number(), updatedAt: z.string() });

const toRailRow = (r: Awaited<ReturnType<typeof upsertGiftRail>>) => ({ rail: r.rail, displayName: RAILS[r.rail].displayName, handle: r.handle, recipientName: r.recipientName, active: r.active, sortOrder: r.sortOrder, updatedAt: r.updatedAt.toISOString() });

/**
 * Admin: where a gift of money goes (ADR-0013) — the couple's own Venmo, PayPal.Me, $Cashtag, Zelle
 * or mailing address. Only the handle is entered; the link is built from it, so there is no URL to
 * mistype and nothing that can point anywhere else. The audit records which rail changed, never the
 * handle: an email, phone number or address does not belong in a log.
 */
export const adminUpsertGiftRail = defineCapability<z.infer<typeof railInput>, z.infer<typeof railRowSchema>>({
  name: 'admin_upsert_gift_rail',
  title: 'Configure a way to give',
  description: 'Admin: sets the couple’s own Venmo username, PayPal.Me name, $Cashtag, Zelle email or phone, or mailing address for checks.',
  kind: 'action',
  auth: 'admin',
  requires: ['admin_content'],
  confirmation: 'inline',
  idempotent: true,
  annotations: { readOnlyHint: false, untrustedContentHint: false, consequentialHint: false },
  exposure: { ui: true, ai: false, webmcp: false },
  input: railInput,
  output: railRowSchema,
  async handler(ctx, i) {
    const parsed = parseRailHandle(i.rail, i.handle);
    if (!parsed.ok) return err(new CapabilityError('validation', parsed.message, { issues: [{ path: 'handle', message: parsed.message }] }));
    const spec = RAILS[i.rail];
    // A link rail's URL is built, not typed, but it still has to clear the same gate every hand-off does.
    if (spec.url) {
      const allowed = assertAllowedRedirect(spec.url(parsed.handle, 'check'));
      if (!allowed.ok) return err(new CapabilityError('validation', allowed.error.message, { issues: [{ path: 'handle', message: allowed.error.message }] }));
    }
    const { db } = appServices(ctx);
    const row = await upsertGiftRail(db, { rail: i.rail, handle: parsed.handle, recipientName: i.recipientName, active: i.active, sortOrder: i.sortOrder, updatedBy: toPrincipalRef(ctx.principal) }, ctx.now);
    await ctx.audit.record({ actor: toPrincipalRef(ctx.principal), action: 'content.updated', target: { type: 'gift_rail', id: row.rail }, outcome: 'success', requestId: ctx.requestId, metadata: { active: row.active } });
    return ok({ data: toRailRow(row), sources: [] });
  },
});

const listOutput = z.object({ rows: z.array(rowSchema), effective: z.array(giftLinkViewSchema), funds: z.array(fundSchema), rails: z.array(railRowSchema) });

export const adminListGiftLinks = defineCapability<unknown, z.infer<typeof listOutput>>({
  name: 'admin_list_gift_links',
  title: 'Gift links (admin)',
  description: 'Admin: every configured gift link (including inactive), the list guests currently see, the gift funds and the ways to give.',
  kind: 'read',
  auth: 'admin',
  requires: ['admin_content'],
  annotations: { readOnlyHint: true, untrustedContentHint: false, consequentialHint: false },
  exposure: { ui: true, ai: false, webmcp: false },
  input: z.unknown(),
  output: listOutput,
  async handler(ctx) {
    const { db, providers } = appServices(ctx);
    const [rows, effective, funds, rails] = await Promise.all([
      listGiftLinkRows(db, { includeInactive: true }),
      listGiftLinks(db, { registry: providers('registry'), cashFund: providers('cash-fund') }),
      listGiftFundEntries(db),
      listGiftRailRows(db, { includeInactive: true }),
    ]);
    return ok({ data: { rows: rows.map(toRow), effective, funds, rails: rails.map(toRailRow) }, sources: [] });
  },
});

export const adminGiftCapabilities = [adminUpsertGiftLink, adminListGiftLinks, adminUpsertGiftFund, adminUpsertGiftRail];
