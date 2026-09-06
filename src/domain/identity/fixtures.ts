import type { AuditSink } from '@/contracts/audit';
import type { PrincipalRef } from '@/contracts/principal';
import type { Db } from '@/db/client';
import { adminRoles } from '@/db/schema';
import { env } from '@/lib/env';
import { upsertGuest } from '@/domain/guests/repo';
import { getHousehold, upsertHousehold } from '@/domain/households/repo';
import { issueInvitation, revokeInvitation } from '@/domain/invitations/repo';

/**
 * Deterministic identity fixtures for integration, security, and e2e tests (never seeded in
 * production). Names are placeholders, not the couple's real guest list.
 *
 *  - fitzgerald: Sara + Tyler share one inbox (spouses), Sara manages; child Nora; grandparent Ruth has no email
 *  - ruiz: Ana (own email, manager) + "Guest" (unnamed plus-one)
 *  - okafor: Chidi (own email, manager) + Amara (own, different email)
 *  - revoked/expired: households whose links are no longer usable
 */
export interface IdentityFixtures {
  households: Record<'fitzgerald' | 'ruiz' | 'okafor' | 'revoked' | 'expired', string>;
  guests: Record<'sara' | 'tyler' | 'nora' | 'ruth' | 'ana' | 'anaPlusOne' | 'chidi' | 'amara' | 'rev' | 'exp', string>;
  invitations: Record<'fitzgerald' | 'ruiz' | 'okafor' | 'revoked' | 'expired', { id: string; token: string }>;
  emails: { shared: string; ana: string; chidi: string; amara: string; rev: string; exp: string; admin: string };
}

export const FIXTURE_EMAILS = {
  shared: 'fitzgeralds@example.test',
  ana: 'ana@example.test',
  chidi: 'chidi@example.test',
  amara: 'amara@example.test',
  rev: 'rev@example.test',
  exp: 'exp@example.test',
  admin: 'admin@example.test',
} as const;

export async function seedIdentityFixtures(db: Db, deps: { audit: AuditSink; requestId?: string; now?: Date; suffix?: string }): Promise<IdentityFixtures> {
  const actor: PrincipalRef = { kind: 'system', component: 'identity-fixtures' };
  const requestId = deps.requestId ?? 'fixtures';
  const now = deps.now ?? new Date();
  const sfx = deps.suffix ?? '';
  const emails = Object.fromEntries(Object.entries(FIXTURE_EMAILS).map(([k, v]) => [k, sfx ? v.replace('@', `+${sfx}@`) : v])) as IdentityFixtures['emails'];
  const hh = async (name: string) => {
    const r = await upsertHousehold(db, { name: sfx ? `${name} ${sfx}` : name });
    if (!r.ok) throw r.error;
    return r.value.id;
  };
  const g = async (input: Parameters<typeof upsertGuest>[1]) => {
    const r = await upsertGuest(db, input);
    if (!r.ok) throw r.error;
    return r.value.id;
  };
  const households = { fitzgerald: await hh('The Fitzgerald Family'), ruiz: await hh('Ana Ruiz & Guest'), okafor: await hh('Chidi & Amara Okafor'), revoked: await hh('The Revoked Household'), expired: await hh('The Expired Household') };
  const guests = {
    sara: await g({ householdId: households.fitzgerald, firstName: 'Sara', lastName: 'Fitzgerald', email: emails.shared }),
    tyler: await g({ householdId: households.fitzgerald, firstName: 'Tyler', lastName: 'Kendrick', email: emails.shared }),
    nora: await g({ householdId: households.fitzgerald, firstName: 'Nora', lastName: 'Fitzgerald', kind: 'child', isMinor: true }),
    ruth: await g({ householdId: households.fitzgerald, firstName: 'Ruth', lastName: 'Fitzgerald', kind: 'adult' }),
    ana: await g({ householdId: households.ruiz, firstName: 'Ana', lastName: 'Ruiz', email: emails.ana }),
    anaPlusOne: await g({ householdId: households.ruiz, firstName: 'Guest', lastName: '', kind: 'plus_one', isNamed: false }),
    chidi: await g({ householdId: households.okafor, firstName: 'Chidi', lastName: 'Okafor', email: emails.chidi }),
    amara: await g({ householdId: households.okafor, firstName: 'Amara', lastName: 'Okafor', email: emails.amara }),
    rev: await g({ householdId: households.revoked, firstName: 'Rev', lastName: 'Oked', email: emails.rev }),
    exp: await g({ householdId: households.expired, firstName: 'Ex', lastName: 'Pired', email: emails.exp }),
  };
  for (const [id, manager] of [[households.fitzgerald, guests.sara], [households.ruiz, guests.ana], [households.okafor, guests.chidi], [households.revoked, guests.rev], [households.expired, guests.exp]] as const) {
    const current = await getHousehold(db, id);
    const r = await upsertHousehold(db, { id, name: current?.name ?? '', managerGuestId: manager });
    if (!r.ok) throw r.error;
  }
  await upsertGuest(db, { id: guests.anaPlusOne, householdId: households.ruiz, firstName: 'Guest', lastName: '', kind: 'plus_one', isNamed: false, plusOneOfGuestId: guests.ana });
  const issue = async (householdId: string, extra: { expiresAt?: Date } = {}) => {
    const r = await issueInvitation(db, { householdId, eventKeys: ['ceremony', 'reception'], plusOneAllowance: householdId === households.ruiz ? 1 : 0, childrenAllowance: householdId === households.fitzgerald ? 1 : 0, issuedBy: actor, requestId, audit: deps.audit, now, ...extra });
    if (!r.ok) throw r.error;
    return { id: r.value.invitation.id, token: r.value.token };
  };
  const invitations = {
    fitzgerald: await issue(households.fitzgerald),
    ruiz: await issue(households.ruiz),
    okafor: await issue(households.okafor),
    revoked: await issue(households.revoked),
    expired: await issue(households.expired, { expiresAt: new Date(now.getTime() - 60_000) }),
  };
  const revoked = await revokeInvitation(db, { invitationId: invitations.revoked.id, reason: 'fixture', actor, requestId, audit: deps.audit, now });
  if (!revoked.ok) throw revoked.error;
  // The fixture administrator holds the owner role in test/development only — never on a production database (review S5).
  if (env.isTest || env.isDevelopment) {
    await db.insert(adminRoles).values({ email: emails.admin, role: 'owner', grantedBy: actor, grantedAt: now }).onConflictDoNothing();
  }
  return { households, guests, invitations, emails };
}
