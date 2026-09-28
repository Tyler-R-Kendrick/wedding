import { asc, eq, sql, type SQL } from 'drizzle-orm';
import type { PrincipalRef } from '@/contracts/principal';
import type { Db } from '@/db/client';
import { giftLinks, type GiftLinkKind, type GiftLinkRow } from '@/db/schema';

/**
 * A field left `undefined` keeps what the row already holds; `null` clears it. Only a first save
 * (an insert) falls back to defaults: shown, not a placeholder, first in order, no note.
 */
export interface UpsertGiftLinkInput {
  id: string;
  kind: GiftLinkKind;
  provider: string;
  label: string;
  url: string;
  note?: string | null;
  disclosure?: string | null;
  placeholder?: boolean;
  active?: boolean;
  sortOrder?: number;
  sourceId?: string | null;
  verifiedAt?: Date | null;
  updatedBy: PrincipalRef;
}

/**
 * Creates or changes one link. The admin console never sees a link's `sourceId` (its citation) and
 * its one-click Hide does not send `disclosure`, so overwriting the whole row lost both on every
 * edit: a field the caller left out keeps its current value, as `upsertGiftFund` already does.
 */
export async function upsertGiftLink(db: Db, input: UpsertGiftLinkInput, now: Date = new Date()): Promise<GiftLinkRow> {
  const values = {
    id: input.id,
    kind: input.kind,
    provider: input.provider,
    label: input.label,
    url: input.url,
    note: input.note ?? null,
    disclosure: input.disclosure ?? null,
    placeholder: input.placeholder ?? false,
    active: input.active ?? true,
    sortOrder: input.sortOrder ?? 0,
    sourceId: input.sourceId ?? null,
    verifiedAt: input.verifiedAt ?? null,
    updatedBy: input.updatedBy,
    createdAt: now,
    updatedAt: now,
  };
  const update = definedOnly({
    kind: input.kind,
    provider: input.provider,
    label: input.label,
    url: input.url,
    note: input.note,
    disclosure: input.disclosure,
    placeholder: input.placeholder,
    active: input.active,
    sortOrder: input.sortOrder,
    sourceId: input.sourceId,
    verifiedAt: input.verifiedAt,
    updatedBy: input.updatedBy,
    updatedAt: now,
  });
  const set: Omit<typeof update, 'verifiedAt'> & { verifiedAt?: Date | null | SQL } = update;
  // A saved check vouches for the link it checked. With no word on the check (no `verifiedAt`, which
  // is also what `confirmed` becomes), a link that now differs from the saved one clears it: keeping
  // it would say the new link was checked. A link sent back unchanged (Hide, Up, Down) keeps it.
  if (input.verifiedAt === undefined) set.verifiedAt = sql`case when ${giftLinks.url} is distinct from ${input.url} then null else ${giftLinks.verifiedAt} end`;
  const [row] = await db.insert(giftLinks).values(values).onConflictDoUpdate({ target: giftLinks.id, set }).returning();
  return row!;
}

/** One saved link, or null. */
export async function getGiftLinkRow(db: Db, id: string): Promise<GiftLinkRow | null> {
  const rows = await db.select().from(giftLinks).where(eq(giftLinks.id, id)).limit(1);
  return rows[0] ?? null;
}

/** The fields a caller actually supplied (`null` included), so an upsert never overwrites a value with "not given". */
export function definedOnly<T extends Record<string, unknown>>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}

export async function listGiftLinkRows(db: Db, opts: { includeInactive?: boolean } = {}): Promise<GiftLinkRow[]> {
  return db
    .select()
    .from(giftLinks)
    .where(opts.includeInactive ? undefined : eq(giftLinks.active, true))
    .orderBy(asc(giftLinks.sortOrder), asc(giftLinks.id));
}

/** Deletes one link. True when there was a row to delete. */
export async function deleteGiftLink(db: Db, id: string): Promise<boolean> {
  const rows = await db.delete(giftLinks).where(eq(giftLinks.id, id)).returning({ id: giftLinks.id });
  return rows.length > 0;
}
