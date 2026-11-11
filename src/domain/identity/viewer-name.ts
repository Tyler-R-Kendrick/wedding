import { and, eq, isNull, sql } from 'drizzle-orm';
import type { Principal } from '@/contracts/principal';
import type { Db } from '@/db/client';
import { authUsers, guests } from '@/db/schema';
import { isPreviewPersonaGuestId } from './preview-personas';

/**
 * The first name of the person looking, when an administrator previews a guest role. Those previews
 * show a stand-in household whose guests are named "Preview", and greeting the couple as "Preview"
 * on their own site is wrong: they are known. The name is theirs as a guest (their guest record, by
 * the email they sign in with), else the name on their account. Null when neither is known, and for
 * anyone who is not previewing a role (a real guest, or an administrator viewing as a real guest,
 * who sees that guest's own name).
 */
export async function previewViewerFirstName(db: Db, principal: Principal): Promise<string | null> {
  if (principal.kind !== 'guest' || !principal.viewedBy) return null;
  if (!principal.viewedBy.previewRole && !isPreviewPersonaGuestId(principal.guestId)) return null;
  const [account] = await db.select({ email: authUsers.email, name: authUsers.name }).from(authUsers).where(eq(authUsers.id, String(principal.viewedBy.adminId))).limit(1);
  if (!account) return null;
  const [self] = account.email
    ? await db
        .select({ firstName: guests.firstName })
        .from(guests)
        .where(and(sql`lower(${guests.email}) = ${account.email.toLowerCase()}`, isNull(guests.mergedIntoGuestId)))
        .limit(1)
    : [];
  const first = self?.firstName?.trim() || firstWord(account.name);
  return first || null;
}

/** The first word of an account name, unless the "name" is really an email address or a phone number. */
function firstWord(name: string | null | undefined): string {
  const n = (name ?? '').trim();
  if (!n || n.includes('@') || /^\+?[\d\s()-]+$/.test(n)) return '';
  return n.split(/\s+/)[0]!;
}
