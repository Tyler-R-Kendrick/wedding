import { describe, expect, it } from 'vitest';
import type { GuestId, HouseholdId } from '@/contracts/ids';
import { anonymousResolver, getPrincipalResolver, setPrincipalResolver } from '@/lib/principal';
import { isAllowedRedirect } from '@/lib/redirects';
import { DEV_PRINCIPAL_COOKIE, devPrincipalFromValue, devPrincipalResolver, installDevPrincipalResolver } from '@/domain/external/dev-principals';
import { providerDisplayName, toGuestHandoff } from '@/domain/external/handoff';
import { Vault } from '@/domain/external/vault';
import { FORBIDDEN_GIFT_WORDS, GIFTS_COPY } from '@/domain/gifts/copy';
import { DEFAULT_RESERVATION_VENUES } from '@/domain/reservations/repo';
import { TRANSPORTATION_TOPICS } from '@/domain/transport/content';
import { defaultEligibilityFactSource, getTransportEligibilityFactSource, setTransportEligibilityFactSource } from '@/domain/transport/eligibility';
import { transportationTopics } from '@/domain/transport/service';
import { DeepLinkMaps } from '@/providers/maps';
import { createTransportBenefitProvider, ManualCodeTransportBenefit, MemoryCodeSource, MockTransportBenefit, UberVouchersTransportBenefit } from '@/providers/transport-benefit';
import { installManualCodeSource, installedManualCodeSource } from '@/providers/transport-benefit/types';

describe('transport vault', () => {
  it('seals and unseals, rejects tampering and other keys, never stores plaintext', () => {
    const v = new Vault('unit-test-vault-material-0123456789');
    const sealed = v.seal('UBER-CODE-1234');
    expect(sealed).not.toContain('UBER-CODE');
    expect(sealed.split('.')).toHaveLength(5);
    expect(sealed.startsWith(`v1.${v.keyId}.`)).toBe(true);
    expect(v.unseal(sealed)).toEqual({ ok: true, value: 'UBER-CODE-1234' });
    expect(v.seal('UBER-CODE-1234')).not.toBe(sealed); // fresh iv every time
    const tampered = sealed.slice(0, -2) + (sealed.endsWith('A') ? 'BB' : 'AA');
    expect(v.unseal(tampered).ok).toBe(false);
    const other = new Vault('another-vault-material-0123456789');
    const r = other.unseal(sealed);
    expect(!r.ok && r.error.details?.reason).toBe('key_mismatch');
    expect(v.unseal('garbage').ok).toBe(false);
    expect(v.fingerprint('a')).toBe(v.fingerprint('a'));
    expect(v.fingerprint('a')).not.toBe(other.fingerprint('a'));
    expect(() => new Vault('short')).toThrow();
  });
});

describe('guest handoffs', () => {
  it('only allowlisted https links become handoffs (open-redirect guard)', () => {
    const base = { provider: 'zola', label: 'Go', opensNewTab: true, disclosure: 'd' };
    expect(toGuestHandoff({ ...base, url: 'https://www.zola.com/registry/x' }).ok).toBe(true);
    for (const url of ['javascript:alert(1)', 'data:text/html,hi', 'http://www.zola.com/', 'https://evil.example/', 'https://zola.com.evil.example/', 'https://user:pw@www.zola.com/', '//www.zola.com/', 'not a url', 'https://www.google.com/search?q=x']) {
      const r = toGuestHandoff({ ...base, url });
      expect(r.ok, url).toBe(false);
      if (!r.ok) expect(['forbidden', 'validation']).toContain(r.error.code);
    }
    const h = toGuestHandoff({ ...base, provider: 'mock', url: 'https://www.uber.com/redeem/X' });
    expect(h.ok && h.value).toMatchObject({ host: 'www.uber.com', providerDisplayName: 'Uber' });
  });

  it('names providers for guests', () => {
    expect(providerDisplayName('uber-vouchers')).toBe('Uber');
    expect(providerDisplayName('theknot')).toBe('The Knot');
    expect(providerDisplayName('withjoy')).toBe('Joy');
    expect(providerDisplayName('mock', 'www.uber.com')).toBe('Uber');
    expect(providerDisplayName('website', 'www.chicagoathletichotel.com')).toBe('the Chicago Athletic Association');
    expect(providerDisplayName('somethingelse')).toBe('somethingelse');
  });
});

describe('transportation content', () => {
  it('builds only allowlisted map and official links, and marks unknowns as placeholders', () => {
    const topics = transportationTopics(new DeepLinkMaps());
    expect(topics.map((t) => t.id)).toEqual(['arriving', 'do-i-need-a-car', 'getting-around', 'getting-home']);
    for (const t of topics) {
      if (t.directions) {
        expect(isAllowedRedirect(t.directions.google.url)).toBe(true);
        expect(isAllowedRedirect(t.directions.apple.url)).toBe(true);
      }
      if (t.official) expect(t.official.host).toBe('www.chicagoathletichotel.com');
      for (const p of t.paragraphs) if (p.startsWith('TODO(')) expect(t.placeholder).toBe(true);
    }
    // No invented operational facts: valet rate, airport recommendation and voucher terms are TODOs.
    const text = TRANSPORTATION_TOPICS.flatMap((t) => t.paragraphs).join('\n');
    expect(text).toMatch(/TODO\(Tyler & Sara\): which airport/);
    expect(text).toMatch(/TODO\(Tyler & Sara\): the special event valet rate/);
    expect(text).toMatch(/TODO\(Tyler & Sara\): ride benefit amount/);
    expect(text).not.toMatch(/\$\d/);
  });
});

describe('gift copy', () => {
  it('never says cash fund or donate and never suggests amounts', () => {
    const all = Object.values(GIFTS_COPY).join(' ');
    for (const re of FORBIDDEN_GIFT_WORDS) expect(all, String(re)).not.toMatch(re);
    expect(GIFTS_COPY.title).toBe('Help us with our next adventures');
  });
});

describe('reservation defaults', () => {
  it('are placeholders with brief provenance only', () => {
    expect(DEFAULT_RESERVATION_VENUES.every((v) => v.placeholder)).toBe(true);
    expect(DEFAULT_RESERVATION_VENUES.every((v) => v.resySlug === null && v.openTableId === null)).toBe(true);
    expect(DEFAULT_RESERVATION_VENUES.find((v) => v.id === 'caa-cindys')?.url).toBe('https://www.chicagoathletichotel.com/');
    expect(DEFAULT_RESERVATION_VENUES.find((v) => v.id === 'placeholder-restaurant')?.url).toBeNull();
  });
});

describe('eligibility fact source seam', () => {
  const entitlement = (guestIsMinor: boolean) => ({ guestIsMinor }) as never;
  const q = (guestIsMinor: boolean) => ({ guestId: 'G' as GuestId, householdId: 'H' as HouseholdId, entitlement: entitlement(guestIsMinor), now: new Date() });
  it('defaults to adults eligible, minors never, and can be replaced by the identity swarm', async () => {
    expect(await defaultEligibilityFactSource.isEligible(q(false))).toEqual({ eligible: true });
    expect(await defaultEligibilityFactSource.isEligible(q(true))).toEqual({ eligible: false, reason: 'minor' });
    expect(getTransportEligibilityFactSource()).toBe(defaultEligibilityFactSource);
    const custom = { isEligible: async () => ({ eligible: false, reason: 'not_in_household' as const }) };
    setTransportEligibilityFactSource(custom);
    expect(getTransportEligibilityFactSource()).toBe(custom);
    setTransportEligibilityFactSource(undefined);
    expect(getTransportEligibilityFactSource()).toBe(defaultEligibilityFactSource);
  });
});

describe('dev principals', () => {
  it('parses guest/admin cookies, flags, and rejects malformed values', () => {
    const g = devPrincipalFromValue('guest:G1:H1');
    expect(g).toMatchObject({ kind: 'guest', guestId: 'G1', householdId: 'H1', actsFor: ['G1'] });
    expect(g?.kind === 'guest' && g.entitlements.has('claim_transportation_benefit')).toBe(true);
    const noclaim = devPrincipalFromValue('guest:G1:H1:noclaim');
    expect(noclaim?.kind === 'guest' && noclaim.entitlements.has('claim_transportation_benefit')).toBe(false);
    const stale = devPrincipalFromValue('guest:G1:H1:stale', new Date('2026-09-05T12:00:00Z'));
    expect(stale?.kind === 'guest' && Date.parse(stale.authenticatedAt)).toBeLessThan(Date.parse('2026-09-05T11:30:00Z'));
    expect(devPrincipalFromValue('admin:A1')).toMatchObject({ kind: 'admin', adminId: 'A1' });
    for (const bad of ['', 'system:x', 'guest:G1', 'guest:G1:H1:../x', 'admin:', 'admin:A1:x:y', 'guest:G 1:H1']) expect(devPrincipalFromValue(bad), bad).toBeUndefined();
  });

  it('resolves from the cookie, is never installed in production, and yields to a real resolver', async () => {
    const req = new Request('http://x/', { headers: { cookie: `a=b; ${DEV_PRINCIPAL_COOKIE}=guest:G9:H9` } });
    expect((await devPrincipalResolver.resolve(req)).kind).toBe('guest');
    expect((await devPrincipalResolver.resolve(new Request('http://x/'))).kind).toBe('anonymous');
    expect(installDevPrincipalResolver({ enabled: true, isProduction: true })).toBe(false);
    expect(installDevPrincipalResolver({ enabled: false, isProduction: false })).toBe(false);
    expect(getPrincipalResolver()).toBe(anonymousResolver);
    const real = { resolve: async () => ({ kind: 'anonymous' as const }) };
    setPrincipalResolver(real);
    expect(installDevPrincipalResolver({ enabled: true, isProduction: false })).toBe(false);
    expect(getPrincipalResolver()).toBe(real);
    setPrincipalResolver(anonymousResolver);
    expect(installDevPrincipalResolver({ enabled: true, isProduction: false })).toBe(true);
    expect(getPrincipalResolver()).toBe(devPrincipalResolver);
    setPrincipalResolver(anonymousResolver);
  });
});

describe('transport-benefit provider selection', () => {
  const base = { FORCE_MOCK_PROVIDERS: false, TRANSPORT_BENEFIT_MODE: 'mock' as const, TRANSPORT_MANUAL_CODES: undefined, UBER_CLIENT_ID: undefined, UBER_CLIENT_SECRET: undefined, UBER_ORG_ID: undefined, UBER_VOUCHER_PROGRAM_ID: undefined, UBER_API_BASE_URL: undefined };
  it('degrades to the mock when uber is requested without credentials, and picks the adapter with them', () => {
    expect(createTransportBenefitProvider(base)).toBeInstanceOf(MockTransportBenefit);
    expect(createTransportBenefitProvider({ ...base, TRANSPORT_BENEFIT_MODE: 'uber' })).toBeInstanceOf(MockTransportBenefit);
    expect(createTransportBenefitProvider({ ...base, TRANSPORT_BENEFIT_MODE: 'uber', UBER_CLIENT_ID: 'id', UBER_CLIENT_SECRET: 's' })).toBeInstanceOf(MockTransportBenefit);
    const live = createTransportBenefitProvider({ ...base, TRANSPORT_BENEFIT_MODE: 'uber', UBER_CLIENT_ID: 'id', UBER_CLIENT_SECRET: 's', UBER_ORG_ID: 'org', UBER_VOUCHER_PROGRAM_ID: 'prog' });
    expect(live).toBeInstanceOf(UberVouchersTransportBenefit);
    expect(live.validateConfig().ok).toBe(true);
    expect(createTransportBenefitProvider({ ...base, TRANSPORT_BENEFIT_MODE: 'uber', FORCE_MOCK_PROVIDERS: true, UBER_CLIENT_ID: 'id', UBER_CLIENT_SECRET: 's', UBER_ORG_ID: 'org', UBER_VOUCHER_PROGRAM_ID: 'prog' })).toBeInstanceOf(MockTransportBenefit);
  });

  it('manual-code mode prefers an explicit source, then the installed DB source, then the env pool', async () => {
    installManualCodeSource(undefined);
    const envPool = createTransportBenefitProvider({ ...base, TRANSPORT_BENEFIT_MODE: 'manual-code', TRANSPORT_MANUAL_CODES: 'ENV1, ENV2' });
    expect(envPool).toBeInstanceOf(ManualCodeTransportBenefit);
    const a = await envPool.createVoucherClaim({ claimId: 'c1', guestId: 'g', entitlementId: 'e' });
    expect(a.ok && a.value.code).toBe('ENV1');
    const empty = createTransportBenefitProvider({ ...base, TRANSPORT_BENEFIT_MODE: 'manual-code' });
    expect(empty.validateConfig().warnings.join(' ')).toMatch(/no manual code source/);
    const none = await empty.createVoucherClaim({ claimId: 'c2', guestId: 'g', entitlementId: 'e' });
    expect(!none.ok && none.error.class).toBe('not_found');
    installManualCodeSource(new MemoryCodeSource(['DB1']));
    expect(installedManualCodeSource()).toBeDefined();
    const installed = await empty.createVoucherClaim({ claimId: 'c3', guestId: 'g', entitlementId: 'e' });
    expect(installed.ok && installed.value.code).toBe('DB1');
    const explicit = createTransportBenefitProvider({ ...base, TRANSPORT_BENEFIT_MODE: 'manual-code' }, { codeSource: new MemoryCodeSource(['EXPLICIT']) });
    const e = await explicit.createVoucherClaim({ claimId: 'c4', guestId: 'g', entitlementId: 'e' });
    expect(e.ok && e.value.code).toBe('EXPLICIT');
    installManualCodeSource(undefined);
  });
});
