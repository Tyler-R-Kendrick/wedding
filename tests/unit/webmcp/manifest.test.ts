import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { CapabilityRegistryImpl } from '@/capabilities/registry';
import { siteStatus } from '@/capabilities/site_status';
import { navigateTo } from '@/capabilities/navigate_to';
import { defineCapability, type AnyCapability } from '@/contracts/capability';
import { readFlags } from '@/contracts/flags';
import type { AdminId, AuthIdentityId, GuestId, HouseholdId } from '@/contracts/ids';
import type { Entitlement, Principal } from '@/contracts/principal';
import { ok } from '@/contracts/result';
import { buildManifest, manifestFingerprint, WEBMCP_SPEC } from '@/webmcp/manifest';

/**
 * Authorization filtering for the manifest. Tool omission is UX minimisation, never the check
 * (ADR-0002 rule 1) — the bridge re-authorizes every call through `invoke` — but a tool a
 * principal cannot use must still not be advertised to their agent.
 */
const anonymous: Principal = { kind: 'anonymous' };

const guest = (entitlements: Entitlement[]): Principal => ({
  kind: 'guest',
  authIdentityId: 'auth-1' as AuthIdentityId,
  guestId: 'guest-1' as GuestId,
  householdId: 'house-1' as HouseholdId,
  actsFor: ['guest-1' as GuestId],
  entitlements: new Set(entitlements),
  authenticatedAt: new Date().toISOString(),
  sessionId: 'session-1',
});

const admin = (entitlements: Entitlement[]): Principal => ({
  kind: 'admin',
  authIdentityId: 'auth-2' as AuthIdentityId,
  adminId: 'admin-1' as AdminId,
  roles: new Set(['owner']),
  entitlements: new Set(entitlements),
  authenticatedAt: new Date().toISOString(),
  sessionId: 'session-2',
});

const cap = (over: Partial<AnyCapability> & { name: string }): AnyCapability =>
  defineCapability({
    title: 'T',
    description: 'Does a thing.',
    kind: 'read',
    auth: 'anonymous',
    requires: [],
    annotations: { readOnlyHint: true, untrustedContentHint: false, consequentialHint: false },
    exposure: { ui: true, ai: true, webmcp: true },
    input: z.object({}).optional(),
    output: z.object({ x: z.number() }),
    handler: async () => ok({ data: { x: 1 }, sources: [] }),
    ...over,
  } as AnyCapability);

// The read / draft / action / explicit-confirmation / admin cases the two real capabilities cannot cover.
const publicRead = cap({ name: 'public_read' });
const uiOnly = cap({ name: 'ui_only_read', exposure: { ui: true, ai: false, webmcp: false } });
const guestRead = cap({ name: 'guest_read', auth: 'guest', requires: ['view_table_assignment'] });
const guestDraft = cap({ name: 'guest_draft', kind: 'draft', auth: 'guest', requires: ['rsvp_self'], annotations: { readOnlyHint: false, untrustedContentHint: false, consequentialHint: false } });
const guestAction = cap({
  name: 'guest_action', kind: 'action', auth: 'guest', requires: ['rsvp_self'], confirmation: 'explicit', idempotent: true,
  annotations: { readOnlyHint: false, untrustedContentHint: false, consequentialHint: true },
});
const adminRead = cap({ name: 'admin_read', auth: 'admin', requires: ['admin_audit'] });
const flagged = cap({ name: 'flagged_read', flag: 'MEDIA_SEMANTIC_SEARCH' });

const registry = new CapabilityRegistryImpl();
registry.registerAll([siteStatus, navigateTo, publicRead, uiOnly, guestRead, guestDraft, guestAction, adminRead, flagged]);

const flags = readFlags({});
const names = (principal: Principal, source = flags) => buildManifest({ registry, principal, flags: source }).tools.map((t) => t.name);

describe('manifest authorization filtering', () => {
  it('lists only capabilities exposed to webmcp', () => {
    expect(names(anonymous)).not.toContain('ui_only_read');
  });

  it('gives an anonymous principal only anonymous-auth tools', () => {
    expect(names(anonymous)).toEqual(['flagged_read', 'navigate_to', 'public_read', 'site_status']);
  });

  it('adds a guest tool only when the guest holds its entitlement', () => {
    expect(names(guest([]))).toEqual(names(anonymous));
    expect(names(guest(['view_table_assignment']))).toContain('guest_read');
    expect(names(guest(['view_table_assignment']))).not.toContain('guest_draft');
    const full = names(guest(['view_table_assignment', 'rsvp_self']));
    expect(full).toEqual(expect.arrayContaining(['guest_read', 'guest_draft', 'guest_action']));
    expect(full).not.toContain('admin_read');
  });

  it('keeps admin tools out of every guest manifest and in the admin one', () => {
    expect(names(guest(['rsvp_self', 'view_table_assignment']))).not.toContain('admin_read');
    expect(names(admin(['admin_audit']))).toContain('admin_read');
    // An admin without the entitlement is refused just like a guest.
    expect(names(admin([]))).not.toContain('admin_read');
  });

  it('honours per-capability flags', () => {
    expect(names(anonymous, readFlags({ FLAG_MEDIA_SEMANTIC_SEARCH: 'off' }))).not.toContain('flagged_read');
  });

  it('returns nothing at all when the WEBMCP flag is off', () => {
    const manifest = buildManifest({ registry, principal: admin(['admin_audit']), flags: readFlags({ FLAG_WEBMCP: 'off' }) });
    expect(manifest.tools).toEqual([]);
  });

  it('derives new capabilities automatically: registering one exposes it with no code change here', () => {
    const later = new CapabilityRegistryImpl();
    later.registerAll([siteStatus]);
    expect(later.list({ exposure: 'webmcp', principal: anonymous, flags }).map((c) => c.name)).toEqual(['site_status']);
    later.register(cap({ name: 'seating_lookup', auth: 'guest', requires: ['view_table_assignment'] }));
    expect(buildManifest({ registry: later, principal: guest(['view_table_assignment']), flags }).tools.map((t) => t.name)).toEqual(['seating_lookup', 'site_status']);
  });
});

describe('manifest envelope', () => {
  it('records the principal kind and the pinned spec revision', () => {
    const manifest = buildManifest({ registry, principal: anonymous, flags, now: new Date('2026-09-05T00:00:00Z') });
    expect(manifest.principal).toEqual({ kind: 'anonymous' });
    expect(manifest.spec.url).toBe('https://webmachinelearning.github.io/webmcp/');
    expect(WEBMCP_SPEC.date).toBe('2026-09-04');
    expect(manifest.generatedAt).toBe('2026-09-05T00:00:00.000Z');
  });

  it('fingerprints the tool set and the principal, and is stable for an unchanged one', () => {
    const a = buildManifest({ registry, principal: anonymous, flags });
    const b = buildManifest({ registry, principal: anonymous, flags });
    expect(a.fingerprint).toBe(b.fingerprint);
    // The client re-registers on a fingerprint change, so signing in must change it.
    expect(buildManifest({ registry, principal: guest(['rsvp_self']), flags }).fingerprint).not.toBe(a.fingerprint);
    // ... and so must a change to a tool's schema or annotations, not just its name.
    expect(manifestFingerprint('anonymous', a.tools)).toBe(a.fingerprint);
    const tampered = a.tools.map((t, i) => (i === 0 ? { ...t, annotations: { ...t.annotations, consequentialHint: true } } : t));
    expect(manifestFingerprint('anonymous', tampered)).not.toBe(a.fingerprint);
  });
});

describe('review extras: the manifest cannot disagree with invoke', () => {
  const gated = cap({ name: 'face_match', flag: 'BIOMETRICS_ENABLED' });
  const reg = new CapabilityRegistryImpl();
  reg.registerAll([siteStatus, gated]);

  it('hides a readiness-gated capability whose readiness switch is off, even with the flag on', () => {
    const on = readFlags({ FLAG_BIOMETRICS_ENABLED: 'on' });
    // registry.list only checks the env flag, so without the readiness set the tool is advertised...
    expect(buildManifest({ registry: reg, principal: anonymous, flags: on }).tools.map((t) => t.name)).toContain('face_match');
    // ... and `invoke` would then always answer feature_disabled. Passing the unready set keeps the
    // two in step, and stops the manifest disclosing that a legally gated feature exists.
    const manifest = buildManifest({ registry: reg, principal: anonymous, flags: on, unreadyFlags: new Set(['BIOMETRICS_ENABLED']) });
    expect(manifest.tools.map((t) => t.name)).not.toContain('face_match');
  });

  it('leaves a ready gated capability listed, and never touches ungated ones', () => {
    const on = readFlags({ FLAG_BIOMETRICS_ENABLED: 'on' });
    const ready = buildManifest({ registry: reg, principal: anonymous, flags: on, unreadyFlags: new Set() });
    expect(ready.tools.map((t) => t.name)).toEqual(['face_match', 'site_status']);
    const noneReady = buildManifest({ registry: reg, principal: anonymous, flags: on, unreadyFlags: new Set(['BIOMETRICS_ENABLED']) });
    expect(noneReady.tools.map((t) => t.name)).toEqual(['site_status']);
  });
});
