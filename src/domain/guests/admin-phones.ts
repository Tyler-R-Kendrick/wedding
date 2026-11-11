import { eq } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { authUsers, guests } from '@/db/schema';
import { upsertHousehold } from '@/domain/households/repo';
import { isEmailShape, normalizeEmail } from '@/domain/identity/mask';
import { normalizePhoneE164 } from '@/domain/identity/phone';
import { findGuestsByEmail, upsertGuest } from './repo';

/**
 * The couple's own mobile numbers, put on their guest records so they can sign in by text without
 * anyone typing them into /admin. Phone sign-in only texts a number that is on an adult guest's
 * record (src/capabilities/request_phone_otp.ts), and an administrator is a guest like any other
 * once signed in: the session is an admin's because the guest's email is.
 *
 * The numbers come from `ADMIN_PHONES` (`email=phone,email=phone`), a private Vercel variable. They
 * are never written into this repository, which is public: a migration like 0015's, which seeds
 * the bride's guest row, would publish them.
 *
 *   the email has a guest record   its phone is set to the configured number
 *   it has none                    one is created in a household of its own, named from the
 *                                  account's name (or the address) the way an admin would add it
 */
export interface AdminPhone {
  email: string;
  phone: string;
}

/** `a@x.com=+15551234567, b@y.com=(555) 123-4567` → pairs; anything malformed is skipped. */
export function parseAdminPhones(raw: string | undefined): AdminPhone[] {
  const out: AdminPhone[] = [];
  for (const entry of (raw ?? '').split(',')) {
    const at = entry.indexOf('=');
    if (at < 0) continue;
    const email = normalizeEmail(entry.slice(0, at).trim());
    const phone = normalizePhoneE164(entry.slice(at + 1).trim());
    if (isEmailShape(email) && phone && !out.some((p) => p.email === email)) out.push({ email, phone });
  }
  return out;
}

/** What one pass changed, by count only: phone numbers are never logged. */
export interface AdminPhoneSeedResult {
  updated: number;
  created: number;
  unchanged: number;
  failed: number;
}

export async function seedAdminPhones(db: Db, pairs: readonly AdminPhone[]): Promise<AdminPhoneSeedResult> {
  const result: AdminPhoneSeedResult = { updated: 0, created: 0, unchanged: 0, failed: 0 };
  for (const { email, phone } of pairs) {
    const existing = await findGuestsByEmail(db, email);
    if (existing.length > 0) {
      for (const guest of existing) {
        if (guest.phone === phone) {
          result.unchanged += 1;
          continue;
        }
        await db.update(guests).set({ phone, updatedAt: new Date() }).where(eq(guests.id, guest.id));
        result.updated += 1;
      }
      continue;
    }
    const account = (await db.select({ name: authUsers.name }).from(authUsers).where(eq(authUsers.email, email)).limit(1))[0];
    const [firstName = email.split('@')[0]!, ...rest] = (account?.name?.trim() || email.split('@')[0]!).split(/\s+/);
    const lastName = rest.join(' ');
    const household = await upsertHousehold(db, { name: [firstName, lastName].filter(Boolean).join(' ') });
    if (!household.ok) {
      result.failed += 1;
      continue;
    }
    const guest = await upsertGuest(db, { householdId: household.value.id, firstName, lastName, email, phone, kind: 'adult', isMinor: false, isNamed: true });
    if (!guest.ok) {
      result.failed += 1;
      continue;
    }
    await upsertHousehold(db, { id: household.value.id, name: household.value.name, managerGuestId: guest.value.id });
    result.created += 1;
  }
  return result;
}

const g = globalThis as unknown as { __weddingAdminPhones?: Map<string, Promise<AdminPhoneSeedResult>> };

/**
 * Once per server process and value of `ADMIN_PHONES`: phone sign-in calls this before it looks a
 * number up, so a number added to the variable works on the next deploy with nothing else to do.
 */
export function ensureAdminPhones(db: Db, raw: string | undefined): Promise<AdminPhoneSeedResult> {
  const pairs = parseAdminPhones(raw);
  if (pairs.length === 0) return Promise.resolve({ updated: 0, created: 0, unchanged: 0, failed: 0 });
  const key = pairs.map((p) => `${p.email}=${p.phone}`).join(',');
  const held = (g.__weddingAdminPhones ??= new Map());
  let pass = held.get(key);
  if (!pass) {
    pass = seedAdminPhones(db, pairs).catch((e: unknown) => {
      held.delete(key);
      throw e;
    });
    held.set(key, pass);
  }
  return pass;
}

/** Tests: forget which values were seeded. */
export function resetAdminPhones(): void {
  g.__weddingAdminPhones = new Map();
}
