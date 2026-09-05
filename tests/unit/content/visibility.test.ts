import { describe, expect, it } from 'vitest';
import type { AdminPrincipal, GuestPrincipal, Principal } from '@/contracts/principal';
import { allowedVisibilities, canSee, canSeeExpired, filterVisible, isValidAt } from '@/domain/content/visibility';

const guest: GuestPrincipal = {
  kind: 'guest', authIdentityId: 'a' as never, guestId: 'g' as never, householdId: 'h' as never, actsFor: [], entitlements: new Set(['view_event']), authenticatedAt: new Date().toISOString(), sessionId: 's',
};
const admin = (entitlements: AdminPrincipal['entitlements'] = new Set(['admin_content'])): AdminPrincipal => ({
  kind: 'admin', authIdentityId: 'a' as never, adminId: 'adm' as never, roles: new Set(['owner']), entitlements, authenticatedAt: new Date().toISOString(), sessionId: 's',
});
const system: Principal = { kind: 'system', component: 'test' };
const anonymous: Principal = { kind: 'anonymous' };

describe('allowedVisibilities', () => {
  it('anonymous sees only public', () => {
    expect(allowedVisibilities(anonymous, 'ui')).toEqual(['public']);
    expect(allowedVisibilities(anonymous, 'ai')).toEqual(['public']);
  });
  it('guests see public + guest, never drafts', () => {
    expect(allowedVisibilities(guest, 'ui')).toEqual(['public', 'guest']);
    expect(canSee(guest, 'ui', 'private-draft')).toBe(false);
  });
  it('admins with admin_content see drafts on the UI surface only', () => {
    expect(allowedVisibilities(admin(), 'ui')).toEqual(['public', 'guest', 'private-draft']);
    expect(allowedVisibilities(admin(), 'ai')).toEqual(['public', 'guest']);
    expect(allowedVisibilities(admin(), 'webmcp')).toEqual(['public', 'guest']);
    expect(allowedVisibilities(admin(new Set(['admin_audit'])), 'ui')).toEqual(['public', 'guest']);
  });
  it('system sees drafts on ui but not on AI surfaces', () => {
    expect(allowedVisibilities(system, 'ui')).toContain('private-draft');
    expect(allowedVisibilities(system, 'ai')).not.toContain('private-draft');
  });
});

describe('validity + filterVisible', () => {
  const now = new Date('2026-09-05T12:00:00Z');
  const rows = [
    { id: 'pub', visibility: 'public' as const },
    { id: 'guest', visibility: 'guest' as const },
    { id: 'draft', visibility: 'private-draft' as const },
    { id: 'expired', visibility: 'public' as const, validUntil: '2025-02-28T23:59:59Z' },
    { id: 'future', visibility: 'public' as const, validFrom: '2027-01-01T00:00:00Z' },
  ];
  it('isValidAt respects both ends of the window', () => {
    expect(isValidAt({}, now)).toBe(true);
    expect(isValidAt({ validUntil: '2026-09-05T11:59:59Z' }, now)).toBe(false);
    expect(isValidAt({ validFrom: '2026-09-05T12:00:00Z' }, now)).toBe(true);
    expect(isValidAt({ validFrom: new Date('2026-09-06T00:00:00Z') }, now)).toBe(false);
  });
  it('drops drafts, guest-only rows, and expired rows for anonymous', () => {
    expect(filterVisible(rows, anonymous, 'ui', now).map((r) => r.id)).toEqual(['pub']);
  });
  it('shows guest rows to guests but never drafts or expired rows', () => {
    expect(filterVisible(rows, guest, 'ui', now).map((r) => r.id)).toEqual(['pub', 'guest']);
    expect(filterVisible(rows, guest, 'ui', now, { includeExpired: true }).map((r) => r.id)).toEqual(['pub', 'guest']);
  });
  it('lets content admins opt into expired rows on the UI surface only', () => {
    expect(canSeeExpired(admin(), 'ui')).toBe(true);
    expect(canSeeExpired(admin(), 'ai')).toBe(false);
    expect(filterVisible(rows, admin(), 'ui', now).map((r) => r.id)).toEqual(['pub', 'guest', 'draft']);
    expect(filterVisible(rows, admin(), 'ui', now, { includeExpired: true }).map((r) => r.id)).toEqual(['pub', 'guest', 'draft', 'expired', 'future']);
    expect(filterVisible(rows, admin(), 'ai', now, { includeExpired: true }).map((r) => r.id)).toEqual(['pub', 'guest']);
  });
});
