import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import type { GuestId, HouseholdId } from '@/contracts/ids';
import { isAllowedRedirect } from '@/lib/redirects';
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
    // Tamper in the ciphertext BYTES, not in base64url characters.
    //
    // This rewrote the last two characters of the sealed string instead, and that is not reliably
    // tampering: the GCM tag is 16 bytes, base64url-encodes to 22 characters, and 22 % 4 === 2, so
    // the final character carries only two significant bits and the decoder throws the other four
    // away. Whenever the replacement agreed with the original on the bits that survive — last two
    // characters "A?" with ? in B/C/D, or "BA" when the string already ended in "A" — the
    // "tampered" payload decoded to the identical bytes. The vault was then right to unseal it and
    // this assertion failed anyway. Measured over 300,000 seals: 1,180 of them, 0.393%, or about
    // one run in 254.
    //
    // Flipping a bit of the decoded ciphertext is tampering by construction: 0 of the same 300,000
    // were a no-op. The assertion is unchanged and now means what it says.
    const parts = sealed.split('.');
    const ciphertext = Buffer.from(parts[3] as string, 'base64url');
    ciphertext.writeUInt8(ciphertext.readUInt8(0) ^ 0x01, 0);
    const tampered = [parts[0], parts[1], parts[2], ciphertext.toString('base64url'), parts[4]].join('.');
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

/*
 * `describe('dev principals')` lived here and is gone with the module it tested. Swarm G's
 * cookie-named principal resolver was a stand-in "until the identity swarm's Better Auth resolver
 * is wired" (its own words); that resolver landed at level 06, so the stand-in is deleted rather
 * than carried, and the three specs that drove it now use identity's header+secret injector.
 * Nothing is left untested by the removal. `tests/unit/test-principal-gate.test.ts` covers the same
 * properties for the injector that survives: "is disabled outside NODE_ENV=test, whatever headers
 * arrive" (never active in production), "is disabled without a secret, and without one long enough
 * to be a secret", "falls through on a wrong secret, a missing header, and unparseable JSON"
 * (rejection of malformed values, and yielding to the real resolver), and "injects only when
 * everything lines up".
 */

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
