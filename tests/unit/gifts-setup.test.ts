import { describe, expect, it } from 'vitest';
import type { LifecycleState } from '@/contracts/lifecycle';
import { detectRegistryProvider, giftsSetup } from '@/domain/gifts/setup';
import { memberNavFor } from '@/domain/lifecycle/nav';

const listsGifts = (s: LifecycleState) => memberNavFor(s).some((i) => i.href === '/gifts');

describe('detectRegistryProvider', () => {
  it('reads the provider from what people paste, scheme or not', () => {
    expect(detectRegistryProvider('zola.com/registry/saraandtyler')).toMatchObject({ ok: true, provider: 'zola', url: 'https://zola.com/registry/saraandtyler' });
    expect(detectRegistryProvider(' https://www.theknot.com/us/sara-and-tyler ')).toMatchObject({ ok: true, provider: 'theknot', providerName: 'The Knot' });
    expect(detectRegistryProvider('https://withjoy.com/sara-and-tyler/registry')).toMatchObject({ ok: true, provider: 'withjoy', providerName: 'Joy' });
  });

  it('refuses a provider home page, an empty field and anything off the allowlist', () => {
    expect(detectRegistryProvider('https://www.zola.com/')).toMatchObject({ ok: false, message: expect.stringMatching(/home page/) });
    expect(detectRegistryProvider('')).toMatchObject({ ok: false });
    expect(detectRegistryProvider('https://evil.example/registry')).toMatchObject({ ok: false, message: expect.stringMatching(/Zola, The Knot or Joy/) });
    expect(detectRegistryProvider('http://www.zola.com/registry/x')).toMatchObject({ ok: false });
    expect(detectRegistryProvider('javascript:alert(1)')).toMatchObject({ ok: false });
  });
});

describe('giftsSetup', () => {
  it('never calls funds shown while there is no way to give (the bug in the old screen)', () => {
    const s = giftsSetup({ state: 'RSVP_OPEN', listsGifts, wishlistLinks: 0, rails: 0, shownFunds: 4 });
    expect(s.steps.funds).toEqual({ done: false, summary: '4 ready, but hidden until you add a way to give.' });
    expect(s.live).toBe(false);
    expect(s.next).toBe('wishlist');
  });

  it('says when guests will find the page, and is live only with something to give', () => {
    const early = giftsSetup({ state: 'SAVE_THE_DATE', listsGifts, wishlistLinks: 1, rails: 1, shownFunds: 4 });
    expect(early.live).toBe(false);
    expect(early.opensAt).toBe('RSVP_OPEN');
    expect(early.steps.page.summary).toMatch(/from RSVPs open/);
    const open = giftsSetup({ state: 'RSVP_OPEN', listsGifts, wishlistLinks: 1, rails: 1, shownFunds: 4 });
    expect(open).toMatchObject({ live: true, next: null, opensAt: null });
    const moneyOnly = giftsSetup({ state: 'RSVP_OPEN', listsGifts, wishlistLinks: 0, rails: 2, shownFunds: 1 });
    expect(moneyOnly).toMatchObject({ live: true, next: 'wishlist' });
  });
});
