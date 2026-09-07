import { asc, eq } from 'drizzle-orm';
import type { PrincipalRef } from '@/contracts/principal';
import type { Db } from '@/db/client';
import { giftLinks, type GiftLinkKind, type GiftLinkRow } from '@/db/schema';

export interface UpsertGiftLinkInput {
  id: string;
  kind: GiftLinkKind;
  provider: string;
  label: string;
  url: string;
  note?: string;
  disclosure?: string;
  placeholder?: boolean;
  active?: boolean;
  sortOrder?: number;
  sourceId?: string;
  verifiedAt?: Date;
  updatedBy: PrincipalRef;
}

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
  const { id: _id, createdAt: _c, ...update } = values;
  const [row] = await db.insert(giftLinks).values(values).onConflictDoUpdate({ target: giftLinks.id, set: update }).returning();
  return row!;
}

export async function listGiftLinkRows(db: Db, opts: { includeInactive?: boolean } = {}): Promise<GiftLinkRow[]> {
  return db
    .select()
    .from(giftLinks)
    .where(opts.includeInactive ? undefined : eq(giftLinks.active, true))
    .orderBy(asc(giftLinks.sortOrder), asc(giftLinks.id));
}
