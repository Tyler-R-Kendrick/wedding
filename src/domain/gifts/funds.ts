import { asc, eq } from 'drizzle-orm';
import { hasEntitlement, type Principal, type PrincipalRef } from '@/contracts/principal';
import type { Db } from '@/db/client';
import { giftFunds, giftPaymentRails, type GiftFundRow, type GiftPaymentRailRow, type GiftRail } from '@/db/schema';
import { toGuestHandoff, type GuestHandoff } from '../external/handoff';
import { parseRailHandle, RAIL_ORDER, RAILS, railInstructions } from './rails';

/**
 * The funds a guest can give toward, before the couple change anything (ADR-0013).
 *
 * These are the categories every mainstream registry offers pre-built (Joy and Zola both ship a
 * honeymoon fund and a home fund), plus the two Tyler asked for by name. The words are deliberately
 * plain: they say what the money is for without inventing a destination, a house, or a date. The
 * couple change any of it in /admin/gifts — a row with the same id replaces the default.
 */
export interface DefaultFund {
  id: string;
  title: string;
  description: string;
}

export const DEFAULT_GIFT_FUNDS: readonly DefaultFund[] = [
  { id: 'honeymoon', title: 'Our honeymoon', description: 'Toward the first trip of our married life.' },
  { id: 'home', title: 'Our home', description: 'Toward a house of our own.' },
  { id: 'adoption', title: 'Growing our family', description: 'Toward adoption, and the family we hope to grow.' },
  { id: 'next-adventures', title: 'Our next adventures', description: 'Wherever it helps most: trips, date nights, and the things we have not thought of yet.' },
];

export interface GiftFundEntry {
  id: string;
  title: string;
  description: string | null;
  active: boolean;
  sortOrder: number;
  /** `default`: the built-in words. `admin`: changed or added in /admin/gifts. */
  origin: 'default' | 'admin';
}

/** Defaults merged with admin rows by id; admin rows win, new ids are appended. Includes inactive funds. */
export async function listGiftFundEntries(db: Db): Promise<GiftFundEntry[]> {
  const rows = await db.select().from(giftFunds);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const out: GiftFundEntry[] = DEFAULT_GIFT_FUNDS.map((d, i) => {
    const r = byId.get(d.id);
    return r ? fromRow(r) : { ...d, active: true, sortOrder: i * 10, origin: 'default' as const };
  });
  for (const r of rows) if (!DEFAULT_GIFT_FUNDS.some((d) => d.id === r.id)) out.push(fromRow(r));
  return out.sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
}

const fromRow = (r: GiftFundRow): GiftFundEntry => ({ id: r.id, title: r.title, description: r.description, active: r.active, sortOrder: r.sortOrder, origin: 'admin' });

/** Most funds there can be, the defaults included. Keeps `list_gift_links` inside its output budget. */
export const MAX_GIFT_FUNDS = 12;

/**
 * Creates or changes one fund. A field left out keeps its current value: re-saving a fund with a new
 * title keeps its description and its place. On a first save, a default keeps its place and a new
 * fund goes after the defaults.
 */
export async function upsertGiftFund(
  db: Db,
  input: { id: string; title: string; description?: string; active?: boolean; sortOrder?: number; updatedBy: PrincipalRef },
  now: Date = new Date(),
): Promise<GiftFundRow> {
  const defaultAt = DEFAULT_GIFT_FUNDS.findIndex((d) => d.id === input.id);
  const fallback = DEFAULT_GIFT_FUNDS[defaultAt];
  const values = {
    id: input.id,
    title: input.title,
    description: input.description ?? fallback?.description ?? null,
    active: input.active ?? true,
    sortOrder: input.sortOrder ?? (defaultAt >= 0 ? defaultAt * 10 : 100),
    updatedBy: input.updatedBy,
    createdAt: now,
    updatedAt: now,
  };
  const update = definedOnly({ title: input.title, description: input.description, active: input.active, sortOrder: input.sortOrder, updatedBy: input.updatedBy, updatedAt: now });
  const [row] = await db.insert(giftFunds).values(values).onConflictDoUpdate({ target: giftFunds.id, set: update }).returning();
  return row!;
}

/** The fields a caller actually supplied, so an upsert never overwrites a value with "not given". */
function definedOnly<T extends Record<string, unknown>>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}

export async function listGiftRailRows(db: Db, opts: { includeInactive?: boolean } = {}): Promise<GiftPaymentRailRow[]> {
  return db
    .select()
    .from(giftPaymentRails)
    .where(opts.includeInactive ? undefined : eq(giftPaymentRails.active, true))
    .orderBy(asc(giftPaymentRails.sortOrder), asc(giftPaymentRails.rail));
}

/** Creates or changes one rail. A field left out (the payee name, the order) keeps its current value. */
export async function upsertGiftRail(
  db: Db,
  input: { rail: GiftRail; handle: string; recipientName?: string; active?: boolean; sortOrder?: number; updatedBy: PrincipalRef },
  now: Date = new Date(),
): Promise<GiftPaymentRailRow> {
  const values = { rail: input.rail, handle: input.handle, recipientName: input.recipientName ?? null, active: input.active ?? true, sortOrder: input.sortOrder ?? RAIL_ORDER.indexOf(input.rail) * 10, updatedBy: input.updatedBy, createdAt: now, updatedAt: now };
  const update = definedOnly({ handle: input.handle, recipientName: input.recipientName, active: input.active, sortOrder: input.sortOrder, updatedBy: input.updatedBy, updatedAt: now });
  const [row] = await db.insert(giftPaymentRails).values(values).onConflictDoUpdate({ target: giftPaymentRails.rail, set: update }).returning();
  return row!;
}

/** One way to give, as a guest sees it. */
export interface GiftRailView {
  rail: GiftRail;
  displayName: string;
  mode: 'link' | 'direct';
  fee: string;
  source: { url: string; verifiedAt: string };
  /** The name the app shows, so a guest can check they are paying the right person. */
  recipientName: string | null;
  /**
   * For `direct` rails, the filled-in instructions — or null when the details are personal and the
   * viewer has not opened the site from their invitation. `link` rails carry their link per fund.
   */
  instructions: string | null;
  /** True when this viewer is not shown the details and should open the site from their invitation. */
  needsInvitation: boolean;
}

export interface GiftFundLink extends GuestHandoff {
  rail: GiftRail;
}

export interface GiftFundView {
  id: string;
  title: string;
  description: string | null;
  /** One hand-off per `link` rail, each carrying this fund in the note where the network takes one. */
  links: GiftFundLink[];
}

export interface GiftFunds {
  funds: GiftFundView[];
  rails: GiftRailView[];
}

/**
 * True when a query failed because a gifts-of-money table is not in this database yet (Postgres
 * `42P01`, undefined_table), directly or wrapped by drizzle as `cause`.
 *
 * Migrations run only on production deploys (`scripts/deploy/migrate-on-deploy.mjs`), so a preview
 * build of this change runs against a database without `gift_funds` / `gift_payment_rails`. That must
 * not take the registry links down with it: callers treat this one failure as "nothing configured".
 */
export function isMissingGiftTable(e: unknown): boolean {
  for (let cur: unknown = e, depth = 0; cur && depth < 4; cur = (cur as { cause?: unknown }).cause, depth++) {
    if ((cur as { code?: unknown }).code === '42P01') return true;
  }
  return false;
}

/**
 * A guest whose invitation is live (it is what grants `view_event`), and admins. Never an anonymous
 * visitor, and never a guest whose invitation was revoked: their session outlives the invitation, but
 * the resolver derives no entitlements for them, and the couple's address must not outlive it either.
 */
const seesPersonal = (p: Principal) => (p.kind === 'guest' && hasEntitlement(p, 'view_event')) || p.kind === 'admin';

/**
 * The funds and the ways to give, for this viewer. With no rail configured there is nothing to
 * give WITH, so there are no funds either: a list of reasons to give with no way to do it is a dead
 * end, and the page says what is still to come instead.
 */
export async function listGiftFunds(db: Db, principal: Principal): Promise<GiftFunds> {
  // Configuration in the database is not trusted either (the same rule `toGuestHandoff` applies to
  // URLs): a handle is re-validated on the way out, so a row written behind the capability layer
  // cannot smuggle a path into a link or a stranger's details onto the page.
  const [allRails, allFunds] = await Promise.all([listGiftRailRows(db), listGiftFundEntries(db)]);
  const railRows = allRails.flatMap((r) => {
    if (!RAILS[r.rail]) return [];
    const parsed = parseRailHandle(r.rail, r.handle);
    return parsed.ok ? [{ ...r, handle: parsed.handle }] : [];
  });
  if (!railRows.length) return { funds: [], rails: [] };
  const personal = seesPersonal(principal);
  const rails: GiftRailView[] = railRows.map((r) => {
    const spec = RAILS[r.rail];
    const hidden = spec.personal && !personal;
    return {
      rail: r.rail,
      displayName: spec.displayName,
      mode: spec.mode,
      fee: spec.fee,
      source: spec.source,
      recipientName: hidden ? null : r.recipientName,
      instructions: hidden ? null : railInstructions(spec, r.handle, r.recipientName),
      needsInvitation: hidden,
    };
  });
  const entries = allFunds.filter((f) => f.active);
  const funds = entries.map((f) => {
    const links: GiftFundLink[] = [];
    for (const r of railRows) {
      const spec = RAILS[r.rail];
      if (spec.mode !== 'link' || !spec.url) continue;
      const handoff = toGuestHandoff({
        provider: r.rail,
        label: `Give with ${spec.displayName}`,
        url: spec.url(r.handle, `${f.title} (wedding gift)`),
        opensNewTab: true,
        disclosure: `This opens ${spec.displayName}. The gift goes straight to us; we never see payment details.`,
      });
      // A handle that somehow builds a URL off the allowlist is dropped, never shown.
      if (handoff.ok) links.push({ ...handoff.value, rail: r.rail });
    }
    return { id: f.id, title: f.title, description: f.description, links };
  });
  return { funds, rails };
}
