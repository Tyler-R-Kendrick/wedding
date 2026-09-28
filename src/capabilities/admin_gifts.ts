import { z } from 'zod';
import { defineCapability } from '@/contracts/capability';
import { CapabilityError } from '@/contracts/errors';
import { ID_PATTERN } from '@/contracts/ids';
import { toPrincipalRef } from '@/contracts/principal';
import { err, ok } from '@/contracts/result';
import { assertAllowedRedirect } from '@/lib/redirects';
import { SLUG } from '@/domain/external/schemas';
import { GIFT_RAILS } from '@/db/schema';
import { deleteGiftFund, deleteGiftLink, deleteGiftRail, detectRegistryProvider, getGiftLinkRow, isDefaultGiftFund, isMissingGiftTable, listGiftFundEntries, listGiftLinkRows, listGiftLinks, listGiftRailRows, MAX_GIFT_FUNDS, parseRailHandle, RAILS, railInstructions, registryHomePageMessage, registryProviderFor, upsertGiftFund, upsertGiftLink, upsertGiftRail } from '@/domain/gifts';
import { appServices } from './context';
import { giftLinkViewSchema } from './list_gift_links';

/**
 * An optional text an edit can clear. Left out (`undefined`), a save keeps what the row holds; `null`
 * or an empty string clears it. The upserts never overwrite a field the caller did not send, so the
 * console's one-click Hide can send only what it knows, and a citation it never sees survives.
 */
const clearable = <T extends z.ZodType<string>>(s: T) =>
  z
    .union([s, z.literal(''), z.null()])
    .optional()
    .transform((v) => (v === '' ? null : v));

/** A saved check sent back unchanged. The same bound `markContentVerified` sets: never in the future. */
const verifiedAtInput = z.string().datetime({ offset: true }).nullable().optional();
const MAX_CLOCK_SKEW_MS = 60_000;

/** `confirmed` stamps the server's clock; a time sent back must not be ahead of it. `undefined` keeps the saved one. */
function resolveVerifiedAt(i: { confirmed?: boolean; verifiedAt?: string | null }, now: Date): { ok: true; value: Date | null | undefined } | { ok: false; error: CapabilityError } {
  if (i.confirmed) return { ok: true, value: now };
  if (i.verifiedAt === undefined || i.verifiedAt === null) return { ok: true, value: i.verifiedAt };
  const at = new Date(i.verifiedAt);
  if (Number.isNaN(at.getTime()) || at.getTime() > now.getTime() + MAX_CLOCK_SKEW_MS) {
    return { ok: false, error: new CapabilityError('validation', 'The verification time must be a valid time, not in the future.', { issues: [{ path: 'verifiedAt', message: 'invalid or in the future' }] }) };
  }
  return { ok: true, value: at };
}

/**
 * On an existing link, a field left out keeps its saved value (see `upsertGiftLink`); on a new one it
 * takes the default: shown, not a placeholder, first in order.
 */
const upsertInput = z.object({
  id: z.string().regex(SLUG),
  kind: z.enum(['registry', 'adventure-fund']),
  /** Omitted: read from the link's host (zola.com -> zola), so the name and the link cannot disagree. */
  provider: z.string().trim().min(1).max(40).optional(),
  label: z.string().trim().min(1).max(120),
  url: z.url(),
  note: clearable(z.string().trim().max(200)),
  disclosure: clearable(z.string().trim().max(300)),
  placeholder: z.boolean().optional(),
  active: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(1000).optional(),
  sourceId: z.string().regex(ID_PATTERN).nullable().optional(),
  verifiedAt: verifiedAtInput,
  /** The admin opened the link and confirmed it is theirs: stamped with the server's clock, never the browser's. */
  confirmed: z.boolean().optional(),
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
    const verified = resolveVerifiedAt(i, ctx.now);
    if (!verified.ok) return err(verified.error);
    const { db } = appServices(ctx);
    const url = allowed.value.toString();
    // The check step refuses a registry site's home page; the save refuses it too, so calling the
    // upsert directly cannot skip it. A link already saved with that address can still be hidden,
    // moved or renamed: only a new or changed address is refused.
    const homePage = registryHomePageMessage(allowed.value);
    if (homePage && (await getGiftLinkRow(db, i.id))?.url !== url) {
      return err(new CapabilityError('validation', homePage, { issues: [{ path: 'url', message: homePage }] }));
    }
    const provider = i.provider ?? registryProviderFor(allowed.value.hostname)?.id ?? 'custom';
    const { confirmed: _confirmed, ...fields } = i;
    const row = await upsertGiftLink(db, { ...fields, provider, url, verifiedAt: verified.value, updatedBy: toPrincipalRef(ctx.principal) }, ctx.now);
    await ctx.audit.record({ actor: toPrincipalRef(ctx.principal), action: 'content.updated', target: { type: 'gift_link', id: row.id }, outcome: 'success', requestId: ctx.requestId, metadata: { kind: row.kind, provider: row.provider, active: row.active, placeholder: row.placeholder, host: allowed.value.hostname } });
    return ok({ data: toRow(row), sources: [] });
  },
});

const fundInput = z.object({
  id: z.string().regex(SLUG),
  title: z.string().trim().min(1).max(80),
  description: z.string().trim().max(200).optional(),
  /** Omitted: an existing fund keeps its shown/hidden state (a rename must not un-hide it); a new one is shown. */
  active: z.boolean().optional(),
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
    const existing = await listGiftFundEntries(db);
    if (!existing.some((f) => f.id === i.id) && existing.length >= MAX_GIFT_FUNDS) {
      const message = `There can be up to ${MAX_GIFT_FUNDS} funds. Hide or rename one instead of adding another.`;
      return err(new CapabilityError('validation', message, { issues: [{ path: 'id', message }] }));
    }
    const row = await upsertGiftFund(db, { ...i, updatedBy: toPrincipalRef(ctx.principal) }, ctx.now);
    await ctx.audit.record({ actor: toPrincipalRef(ctx.principal), action: 'content.updated', target: { type: 'gift_fund', id: row.id }, outcome: 'success', requestId: ctx.requestId, metadata: { active: row.active } });
    return ok({ data: { id: row.id, title: row.title, description: row.description, active: row.active, sortOrder: row.sortOrder, origin: 'admin' as const }, sources: [] });
  },
});

/**
 * Venmo username, PayPal.Me name, $Cashtag, Zelle email or US mobile, or a mailing address (one line
 * per row). Capped before it is parsed: the longest a rail keeps is a 300-character address, and
 * the slack is for the spaces and blank lines normalising removes. The save and the check share it.
 */
const railHandle = z
  .union([z.string().max(600), z.array(z.string().max(200)).max(12)])
  .transform((h) => (Array.isArray(h) ? h.join('\n') : h))
  .pipe(z.string().max(600));

const railInput = z.object({
  rail: z.enum(GIFT_RAILS),
  handle: railHandle,
  recipientName: z.string().trim().min(1).max(80).optional(),
  /** Omitted: an existing rail keeps its shown/hidden state; a new one is shown. */
  active: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(1000).optional(),
});

const railRowSchema = z.object({ rail: z.enum(GIFT_RAILS), displayName: z.string(), handle: z.string(), recipientName: z.string().nullable(), active: z.boolean(), sortOrder: z.number(), updatedAt: z.string() });

const toRailRow = (r: Awaited<ReturnType<typeof upsertGiftRail>>) => ({ rail: r.rail, displayName: RAILS[r.rail].displayName, handle: r.handle, recipientName: r.recipientName, active: r.active, sortOrder: r.sortOrder, updatedAt: r.updatedAt.toISOString() });
/** A row this build no longer knows (written by hand, or a rail since removed) is left out, not fatal. */
const knownRail = (r: { rail: string }) => Object.hasOwn(RAILS, r.rail);

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
  // Step-up: this decides where guests' money is sent.
  stepUp: true,
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
    // A check is made out to someone, and only the couple know to whom: no name, no check rail.
    if (i.rail === 'check' && !i.recipientName) {
      const current = (await listGiftRailRows(db, { includeInactive: true })).find((r) => r.rail === 'check');
      if (!current?.recipientName) {
        const message = 'Enter the name checks should be made out to.';
        return err(new CapabilityError('validation', message, { issues: [{ path: 'recipientName', message }] }));
      }
    }
    const row = await upsertGiftRail(db, { rail: i.rail, handle: parsed.handle, recipientName: i.recipientName, active: i.active, sortOrder: i.sortOrder, updatedBy: toPrincipalRef(ctx.principal) }, ctx.now);
    await ctx.audit.record({ actor: toPrincipalRef(ctx.principal), action: 'content.updated', target: { type: 'gift_rail', id: row.rail }, outcome: 'success', requestId: ctx.requestId, metadata: { active: row.active } });
    return ok({ data: toRailRow(row), sources: [] });
  },
});

const deleteAnnotations = { readOnlyHint: false, untrustedContentHint: false, consequentialHint: true };

const deleteLinkInput = z.object({ id: z.string().regex(SLUG) });

/** Admin: takes a registry or next-adventures link off the Gifts page for good. Hide is the reversible choice. */
export const adminDeleteGiftLink = defineCapability<z.infer<typeof deleteLinkInput>, { id: string; deleted: boolean }>({
  name: 'admin_delete_gift_link',
  title: 'Delete a gift link',
  description: 'Admin: deletes a registry / next-adventures link. Guests stop being sent to it at once.',
  kind: 'action',
  auth: 'admin',
  requires: ['admin_content'],
  confirmation: 'inline',
  idempotent: true,
  annotations: deleteAnnotations,
  exposure: { ui: true, ai: false, webmcp: false },
  input: deleteLinkInput,
  output: z.object({ id: z.string(), deleted: z.boolean() }),
  async handler(ctx, i) {
    const { db } = appServices(ctx);
    const deleted = await deleteGiftLink(db, i.id);
    if (!deleted) return err(new CapabilityError('not_found', 'That link is not saved any more.'));
    await ctx.audit.record({ actor: toPrincipalRef(ctx.principal), action: 'content.updated', target: { type: 'gift_link', id: i.id }, outcome: 'success', requestId: ctx.requestId, metadata: { op: 'delete' } });
    return ok({ data: { id: i.id, deleted }, sources: [] });
  },
});

const deleteFundInput = z.object({ id: z.string().regex(SLUG) });
const deleteFundOutput = z.object({ id: z.string(), outcome: z.enum(['deleted', 'reset']) });

/**
 * Admin: deletes a fund the couple added, or puts a built-in one (honeymoon, home, adoption, next
 * adventures) back to its built-in words, place and "shown". A built-in fund cannot be deleted: it
 * exists without a row, so hiding it is how it comes off the page.
 */
export const adminDeleteGiftFund = defineCapability<z.infer<typeof deleteFundInput>, z.infer<typeof deleteFundOutput>>({
  name: 'admin_delete_gift_fund',
  title: 'Delete or reset a gift fund',
  description: 'Admin: deletes a fund the couple added; for a built-in fund, puts back its built-in words instead.',
  kind: 'action',
  auth: 'admin',
  requires: ['admin_content'],
  confirmation: 'inline',
  idempotent: true,
  annotations: deleteAnnotations,
  exposure: { ui: true, ai: false, webmcp: false },
  input: deleteFundInput,
  output: deleteFundOutput,
  async handler(ctx, i) {
    const { db } = appServices(ctx);
    const builtIn = isDefaultGiftFund(i.id);
    const deleted = await deleteGiftFund(db, i.id);
    // A built-in fund with no row already has its built-in words: resetting it again changes nothing.
    if (!deleted && !builtIn) return err(new CapabilityError('not_found', 'That fund is not saved any more.'));
    const outcome = builtIn ? ('reset' as const) : ('deleted' as const);
    await ctx.audit.record({ actor: toPrincipalRef(ctx.principal), action: 'content.updated', target: { type: 'gift_fund', id: i.id }, outcome: 'success', requestId: ctx.requestId, metadata: { op: outcome === 'reset' ? 'reset' : 'delete' } });
    return ok({ data: { id: i.id, outcome }, sources: [] });
  },
});

const deleteRailInput = z.object({ rail: z.enum(GIFT_RAILS) });

/**
 * Admin: stops offering one way to give. Step-up, like setting one: it decides where guests' money
 * can go. The audit names the rail, never the handle it held.
 */
export const adminDeleteGiftRail = defineCapability<z.infer<typeof deleteRailInput>, { rail: z.infer<typeof deleteRailInput>['rail']; deleted: boolean }>({
  name: 'admin_delete_gift_rail',
  title: 'Delete a way to give',
  description: 'Admin: deletes the couple’s Venmo, PayPal.Me, $Cashtag, Zelle or check details. With none left, guests see no gifts of money.',
  kind: 'action',
  auth: 'admin',
  requires: ['admin_content'],
  // Step-up: this decides where guests' money is sent.
  stepUp: true,
  confirmation: 'inline',
  idempotent: true,
  annotations: deleteAnnotations,
  exposure: { ui: true, ai: false, webmcp: false },
  input: deleteRailInput,
  output: z.object({ rail: z.enum(GIFT_RAILS), deleted: z.boolean() }),
  async handler(ctx, i) {
    const { db } = appServices(ctx);
    const deleted = await deleteGiftRail(db, i.rail);
    if (!deleted) return err(new CapabilityError('not_found', `${RAILS[i.rail].displayName} is not set up.`));
    await ctx.audit.record({ actor: toPrincipalRef(ctx.principal), action: 'content.updated', target: { type: 'gift_rail', id: i.rail }, outcome: 'success', requestId: ctx.requestId, metadata: { op: 'delete' } });
    return ok({ data: { rail: i.rail, deleted }, sources: [] });
  },
});

const checkInput = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('link'), url: z.string().max(2048) }),
  z.object({ kind: z.literal('rail'), rail: z.enum(GIFT_RAILS), handle: railHandle, recipientName: z.string().trim().max(80).optional() }),
]);

const checkOutput = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('link'), provider: z.string(), providerName: z.string(), host: z.string(), url: z.string() }),
  z.object({
    kind: z.literal('rail'),
    rail: z.enum(GIFT_RAILS),
    displayName: z.string(),
    handle: z.string(),
    /** The link guests will be handed, for a link rail — so the couple can open it and see their own profile. */
    url: z.string().nullable(),
    /** What a guest will read, for a direct rail. */
    instructions: z.string().nullable(),
    fee: z.string(),
  }),
]);

/**
 * Admin: checks a registry link or a way to give BEFORE it is saved, and says what guests will get.
 *
 * The setup flows in /admin/gifts call this between steps, so a mistyped Venmo name or a link to a
 * registry's home page is caught on the step where it was typed, with the fix in words, rather than
 * as a list of field paths under a form. It writes nothing and records nothing: the same checks run
 * again inside the upserts, which are what decide.
 */
export const adminCheckGiftSetup = defineCapability<z.infer<typeof checkInput>, z.infer<typeof checkOutput>>({
  name: 'admin_check_gift_setup',
  title: 'Check a gift link or way to give',
  description: 'Admin: validates a registry link or a way to give without saving it, and returns what guests would be shown.',
  kind: 'read',
  auth: 'admin',
  requires: ['admin_content'],
  annotations: { readOnlyHint: true, untrustedContentHint: false, consequentialHint: false },
  exposure: { ui: true, ai: false, webmcp: false },
  input: checkInput,
  output: checkOutput,
  async handler(_ctx, i) {
    if (i.kind === 'link') {
      const d = detectRegistryProvider(i.url);
      if (!d.ok) return err(new CapabilityError('validation', d.message, { issues: [{ path: 'url', message: d.message }] }));
      return ok({ data: { kind: 'link' as const, provider: d.provider, providerName: d.providerName, host: d.host, url: d.url }, sources: [] });
    }
    const parsed = parseRailHandle(i.rail, i.handle);
    if (!parsed.ok) return err(new CapabilityError('validation', parsed.message, { issues: [{ path: 'handle', message: parsed.message }] }));
    const spec = RAILS[i.rail];
    let url: string | null = null;
    if (spec.url) {
      const allowed = assertAllowedRedirect(spec.url(parsed.handle, 'Wedding gift'));
      if (!allowed.ok) return err(new CapabilityError('validation', allowed.error.message, { issues: [{ path: 'handle', message: allowed.error.message }] }));
      url = allowed.value.toString();
    }
    const instructions = railInstructions(spec, parsed.handle, i.recipientName || null);
    return ok({ data: { kind: 'rail' as const, rail: i.rail, displayName: spec.displayName, handle: parsed.handle, url, instructions, fee: spec.fee }, sources: [] });
  },
});

const listOutput = z.object({
  rows: z.array(rowSchema),
  effective: z.array(giftLinkViewSchema),
  funds: z.array(fundSchema),
  rails: z.array(railRowSchema),
  /** False when this database predates the gifts-of-money migration (a preview; see `isMissingGiftTable`). */
  fundsAvailable: z.boolean(),
});

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
    const [rows, effective, money] = await Promise.all([
      listGiftLinkRows(db, { includeInactive: true }),
      listGiftLinks(db, { registry: providers('registry'), cashFund: providers('cash-fund') }),
      Promise.all([listGiftFundEntries(db), listGiftRailRows(db, { includeInactive: true })]).catch((e: unknown) => {
        if (!isMissingGiftTable(e)) throw e;
        return null;
      }),
    ]);
    const [funds, rails] = money ?? [[], []];
    return ok({ data: { rows: rows.map(toRow), effective, funds, rails: rails.filter(knownRail).map(toRailRow), fundsAvailable: money !== null }, sources: [] });
  },
});

export const adminGiftCapabilities = [adminUpsertGiftLink, adminListGiftLinks, adminUpsertGiftFund, adminUpsertGiftRail, adminCheckGiftSetup, adminDeleteGiftLink, adminDeleteGiftFund, adminDeleteGiftRail];
