import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { CapabilityError } from '@/contracts/errors';
import { newId } from '@/contracts/ids';
import { err, ok, type Result } from '@/contracts/result';
import type { Db } from '@/db/client';
import { GUEST_CONTACT_KINDS, guestContacts, guests, type GuestContactKind, type GuestContactRow } from '@/db/schema';
import { isEmailShape, normalizeEmail } from '@/domain/identity/mask';
import { isPhoneShape, normalizePhoneE164 } from '@/domain/identity/phone';

export interface GuestContactInput {
  kind: GuestContactKind;
  value: string;
  label?: string | null;
  isPrimary?: boolean;
}

export type GuestContactView = {
  id: string;
  kind: GuestContactKind;
  value: string;
  label: string | null;
  isPrimary: boolean;
};

const notMerged = sql`${guests.mergedIntoGuestId} is null`;

function normalizeContactValue(kind: GuestContactKind, raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (kind === 'email') {
    const n = normalizeEmail(trimmed);
    return isEmailShape(n) ? n : null;
  }
  const n = normalizePhoneE164(trimmed);
  return n && isPhoneShape(n) ? n : null;
}

export function validateContactInput(input: GuestContactInput): Result<{ kind: GuestContactKind; value: string; label: string | null; isPrimary: boolean }, CapabilityError> {
  if (!GUEST_CONTACT_KINDS.includes(input.kind)) return err(new CapabilityError('validation', 'Unknown contact kind.'));
  const value = normalizeContactValue(input.kind, input.value);
  if (!value) {
    const message = input.kind === 'email' ? 'Enter a valid email address.' : 'Enter a US mobile number with area code.';
    return err(new CapabilityError('validation', input.kind === 'email' ? 'That email address does not look right.' : 'That phone number does not look right.', { issues: [{ path: input.kind, message }] }));
  }
  const label = input.label?.trim() || null;
  return ok({ kind: input.kind, value, label: label && label.length > 0 ? label.slice(0, 64) : null, isPrimary: !!input.isPrimary });
}

export async function listGuestContacts(db: Db, guestId: string): Promise<GuestContactRow[]> {
  return db.select().from(guestContacts).where(eq(guestContacts.guestId, guestId)).orderBy(asc(guestContacts.kind), descPrimary(), asc(guestContacts.value));
}

function descPrimary() {
  return sql`case when ${guestContacts.isPrimary} then 0 else 1 end`;
}

export async function listGuestContactsForGuests(db: Db, guestIds: readonly string[]): Promise<Map<string, GuestContactRow[]>> {
  if (guestIds.length === 0) return new Map();
  const rows = await db.select().from(guestContacts).where(inArray(guestContacts.guestId, [...guestIds])).orderBy(asc(guestContacts.guestId), asc(guestContacts.kind), descPrimary());
  const out = new Map<string, GuestContactRow[]>();
  for (const r of rows) {
    const list = out.get(r.guestId) ?? [];
    list.push(r);
    out.set(r.guestId, list);
  }
  return out;
}

/** Guest ids with a live row that lists this normalized email or phone. */
export async function findGuestIdsByContact(db: Db, kind: GuestContactKind, value: string): Promise<string[]> {
  const normalized = kind === 'email' ? normalizeEmail(value) : normalizePhoneE164(value);
  if (!normalized) return [];
  if (kind === 'email' && !isEmailShape(normalized)) return [];
  if (kind === 'phone' && (!normalized || !isPhoneShape(normalized))) return [];
  const fromContacts = await db
    .select({ guestId: guestContacts.guestId })
    .from(guestContacts)
    .innerJoin(guests, eq(guests.id, guestContacts.guestId))
    .where(and(eq(guestContacts.kind, kind), eq(guestContacts.value, normalized), notMerged));
  const column = kind === 'email' ? guests.email : guests.phone;
  const fromLegacy = await db.select({ id: guests.id }).from(guests).where(and(eq(column, normalized), notMerged));
  return [...new Set([...fromContacts.map((r) => r.guestId), ...fromLegacy.map((r) => r.id)])];
}

async function ownerOfContact(db: Db, kind: GuestContactKind, value: string, exceptGuestId?: string): Promise<string | null> {
  const normalized =
    kind === 'email' ? (isEmailShape(normalizeEmail(value)) ? normalizeEmail(value) : null) : normalizePhoneE164(value);
  if (!normalized) return null;
  const rows = await db.select({ guestId: guestContacts.guestId }).from(guestContacts).where(and(eq(guestContacts.kind, kind), eq(guestContacts.value, normalized)));
  return rows.find((r) => r.guestId !== exceptGuestId)?.guestId ?? null;
}

/** Ensure one contact row exists for a primary email or phone on the guest row (used by upsert and rebind). */
export async function syncPrimaryContactColumn(
  db: Db,
  guestId: string,
  kind: 'email' | 'phone',
  value: string | null,
  opts?: { skipUniquenessForGuestId?: string },
): Promise<Result<void, CapabilityError>> {
  const now = new Date();
  const rows = await db.select().from(guestContacts).where(and(eq(guestContacts.guestId, guestId), eq(guestContacts.kind, kind)));
  if (!value) {
    await db.delete(guestContacts).where(and(eq(guestContacts.guestId, guestId), eq(guestContacts.kind, kind)));
    return ok(undefined);
  }
  const owner = await ownerOfContact(db, kind, value, opts?.skipUniquenessForGuestId ?? guestId);
  if (owner) {
    const label = kind === 'email' ? 'email' : 'phone';
    return err(new CapabilityError('conflict', `Another guest already uses that ${label}.`, { issues: [{ path: label, message: 'That address or number belongs to someone else.' }] }));
  }
  const primary = rows.find((r) => r.isPrimary) ?? rows[0];
  if (primary) {
    await db.update(guestContacts).set({ value, isPrimary: true, updatedAt: now }).where(eq(guestContacts.id, primary.id));
    await db.update(guestContacts).set({ isPrimary: false, updatedAt: now }).where(and(eq(guestContacts.guestId, guestId), eq(guestContacts.kind, kind), sql`${guestContacts.id} <> ${primary.id}`));
    if (!rows.some((r) => r.value === value)) {
      // Primary row was a different value; also drop duplicates of the new value on this guest.
      await db.delete(guestContacts).where(and(eq(guestContacts.guestId, guestId), eq(guestContacts.kind, kind), eq(guestContacts.value, value), sql`${guestContacts.id} <> ${primary.id}`));
    }
    return ok(undefined);
  }
  await db.insert(guestContacts).values({ id: newId(), guestId, kind, value, label: null, isPrimary: true, createdAt: now, updatedAt: now });
  return ok(undefined);
}

/**
 * Replace all contacts for a guest from admin input. Primary rows drive `guests.email` / `guests.phone`.
 * When `contacts` is omitted, callers sync only via `syncPrimaryContactColumn` on upsert.
 */
export async function replaceGuestContacts(db: Db, guestId: string, contacts: readonly GuestContactInput[]): Promise<Result<{ email: string | null; phone: string | null }, CapabilityError>> {
  const parsed: { kind: GuestContactKind; value: string; label: string | null; isPrimary: boolean }[] = [];
  for (const c of contacts) {
    const v = validateContactInput(c);
    if (!v.ok) return err(v.error);
    parsed.push(v.value);
  }
  const byKind = (k: GuestContactKind) => parsed.filter((p) => p.kind === k);
  for (const kind of GUEST_CONTACT_KINDS) {
    const group = byKind(kind);
    const primaries = group.filter((g) => g.isPrimary);
    if (primaries.length > 1) return err(new CapabilityError('validation', 'Only one primary per kind.', { issues: [{ path: kind, message: 'Mark at most one primary.' }] }));
    if (group.length > 0 && primaries.length === 0) group[0]!.isPrimary = true;
    const seen = new Set<string>();
    for (const g of group) {
      if (seen.has(g.value)) return err(new CapabilityError('validation', 'Duplicate contact on this guest.', { issues: [{ path: kind, message: 'Each address or number once per guest.' }] }));
      seen.add(g.value);
      const owner = await ownerOfContact(db, kind, g.value, guestId);
      if (owner) return err(new CapabilityError('conflict', `Another guest already uses that ${kind}.`, { issues: [{ path: kind, message: 'Belongs to another guest.' }] }));
    }
  }
  const now = new Date();
  await db.delete(guestContacts).where(eq(guestContacts.guestId, guestId));
  for (const p of parsed) {
    await db.insert(guestContacts).values({ id: newId(), guestId, kind: p.kind, value: p.value, label: p.label, isPrimary: p.isPrimary, createdAt: now, updatedAt: now });
  }
  const primaryEmail = byKind('email').find((e) => e.isPrimary)?.value ?? byKind('email')[0]?.value ?? null;
  const primaryPhone = byKind('phone').find((p) => p.isPrimary)?.value ?? byKind('phone')[0]?.value ?? null;
  await db.update(guests).set({ email: primaryEmail, phone: primaryPhone, updatedAt: now }).where(eq(guests.id, guestId));
  return ok({ email: primaryEmail, phone: primaryPhone });
}

/** Merge contact rows from `fromGuestId` onto `keepGuestId` during admin merge. */
export async function mergeGuestContacts(db: Db, keepGuestId: string, fromGuestId: string): Promise<void> {
  const now = new Date();
  const incoming = await db.select().from(guestContacts).where(eq(guestContacts.guestId, fromGuestId));
  const kept = await db.select().from(guestContacts).where(eq(guestContacts.guestId, keepGuestId));
  const keptValues = new Set(kept.map((k) => `${k.kind}:${k.value}`));
  for (const row of incoming) {
    const key = `${row.kind}:${row.value}`;
    if (keptValues.has(key)) continue;
    const owner = await ownerOfContact(db, row.kind as GuestContactKind, row.value, fromGuestId);
    if (owner && owner !== keepGuestId) continue;
    await db.insert(guestContacts).values({ id: newId(), guestId: keepGuestId, kind: row.kind, value: row.value, label: row.label, isPrimary: false, createdAt: now, updatedAt: now });
    keptValues.add(key);
  }
  await db.delete(guestContacts).where(eq(guestContacts.guestId, fromGuestId));
  const [guest] = await db.select({ email: guests.email, phone: guests.phone }).from(guests).where(eq(guests.id, keepGuestId)).limit(1);
  if (guest) {
    if (guest.email) await syncPrimaryContactColumn(db, keepGuestId, 'email', guest.email, { skipUniquenessForGuestId: keepGuestId });
    if (guest.phone) await syncPrimaryContactColumn(db, keepGuestId, 'phone', guest.phone, { skipUniquenessForGuestId: keepGuestId });
  }
}

export function contactsToViews(rows: GuestContactRow[]): GuestContactView[] {
  return rows.map((r) => ({ id: r.id, kind: r.kind as GuestContactKind, value: r.value, label: r.label, isPrimary: r.isPrimary }));
}
