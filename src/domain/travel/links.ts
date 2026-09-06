import { asc, eq } from 'drizzle-orm';
import { CapabilityError } from '@/contracts/errors';
import { newId } from '@/contracts/ids';
import type { PrincipalRef } from '@/contracts/principal';
import type { ExternalHandoff } from '@/contracts/providers';
import { err, ok, type Result } from '@/contracts/result';
import type { Db } from '@/db/client';
import { travelLinks, type TravelLinkCategory, type TravelLinkRow } from '@/db/schema/travel';
import { assertAllowedRedirect } from '@/lib/redirects';
import type { TravelLink, TravelLinkInput } from './types';

/**
 * Admin-configured airline / OTA / hotel / transit deep links: the "admin-configured URL" rung
 * of the fallback ladder. Written only when the URL passes the redirect allowlist, and dropped
 * on read if it no longer does.
 */
export function toTravelLink(row: TravelLinkRow): TravelLink | null {
  if (!assertAllowedRedirect(row.url).ok) return null;
  return {
    id: row.id,
    category: row.category,
    provider: row.provider,
    label: row.label,
    url: row.url,
    note: row.note,
    sortOrder: row.sortOrder,
    active: row.active,
    verifiedAt: row.verifiedAt.toISOString(),
  };
}

export async function listTravelLinks(db: Db, opts: { includeInactive?: boolean; categories?: readonly TravelLinkCategory[] } = {}): Promise<TravelLink[]> {
  const rows = await db
    .select()
    .from(travelLinks)
    .where(opts.includeInactive ? undefined : eq(travelLinks.active, true))
    .orderBy(asc(travelLinks.category), asc(travelLinks.sortOrder), asc(travelLinks.label));
  return rows
    .map(toTravelLink)
    .filter((l): l is TravelLink => l !== null)
    .filter((l) => !opts.categories || opts.categories.includes(l.category));
}

export async function getTravelLink(db: Db, id: string): Promise<TravelLink | null> {
  const rows = await db.select().from(travelLinks).where(eq(travelLinks.id, id)).limit(1);
  return rows[0] ? toTravelLink(rows[0]) : null;
}

export async function saveTravelLink(db: Db, args: { input: TravelLinkInput; actor: PrincipalRef; now: Date }): Promise<Result<TravelLink, CapabilityError>> {
  const { input, actor, now } = args;
  const allowed = assertAllowedRedirect(input.url);
  if (!allowed.ok) return err(new CapabilityError('validation', 'That link is not on our list of trusted partners.', { issues: [{ path: 'url', message: allowed.error.message }] }));
  const values = {
    category: input.category,
    provider: input.provider,
    label: input.label,
    url: allowed.value.toString(),
    note: input.note,
    sortOrder: input.sortOrder,
    active: input.active,
    verifiedAt: now,
    updatedBy: actor,
    updatedAt: now,
  };
  const existing = input.id ? (await db.select().from(travelLinks).where(eq(travelLinks.id, input.id)).limit(1))[0] : undefined;
  const [row] = existing
    ? await db.update(travelLinks).set(values).where(eq(travelLinks.id, existing.id)).returning()
    : await db.insert(travelLinks).values({ ...values, id: input.id ?? newId(), createdAt: now }).returning();
  const link = toTravelLink(row!);
  return link ? ok(link) : err(new CapabilityError('internal', 'The link could not be saved.'));
}

export async function removeTravelLink(db: Db, id: string): Promise<boolean> {
  const rows = await db.delete(travelLinks).where(eq(travelLinks.id, id)).returning({ id: travelLinks.id });
  return rows.length > 0;
}

export function linkToHandoff(link: TravelLink): ExternalHandoff {
  return {
    provider: link.provider,
    label: link.label,
    url: link.url,
    opensNewTab: true,
    disclosure: link.note ?? `You will leave our site to continue with ${link.provider}. We never see your payment details.`,
  };
}
