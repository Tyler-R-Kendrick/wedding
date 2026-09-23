import { describe, expect, it } from 'vitest';
import { GIFT_RAILS } from '@/db/schema';
import { FORBIDDEN_GIFT_WORDS, GIFTS_COPY, giftsStatement } from '@/domain/gifts/copy';
import { DEFAULT_GIFT_FUNDS, isMissingGiftTable } from '@/domain/gifts/funds';
import { parseRailHandle, RAILS, railInstructions } from '@/domain/gifts/rails';
import { isAllowedRedirect } from '@/lib/redirects';

const handle = (rail: Parameters<typeof parseRailHandle>[0], raw: string) => {
  const r = parseRailHandle(rail, raw);
  return r.ok ? r.handle : `invalid: ${r.message}`;
};

describe('gift rails (ADR-0013)', () => {
  it('normalises what people actually paste', () => {
    expect(handle('venmo', '@Sara-Tyler')).toBe('Sara-Tyler');
    expect(handle('paypal', 'https://paypal.me/SaraTyler/')).toBe('SaraTyler');
    expect(handle('paypal', 'www.paypal.com/paypalme/SaraTyler')).toBe('SaraTyler');
    expect(handle('cashapp', '$SaraTyler')).toBe('SaraTyler');
    expect(handle('cashapp', 'https://cash.app/$SaraTyler')).toBe('SaraTyler');
    expect(handle('zelle', '(312) 555-0142')).toBe('(312) 555-0142');
    expect(handle('zelle', '+1 312.555.0142')).toBe('(312) 555-0142');
    expect(handle('zelle', ' Us@Example.com ')).toBe('us@example.com');
    expect(handle('check', '  Sara + Tyler \n\n 1 Example St \r\n Chicago, IL 60603 ')).toBe('Sara + Tyler\n1 Example St\nChicago, IL 60603');
  });

  it('refuses anything that is not a handle, so no link can be steered elsewhere', () => {
    for (const [rail, raw] of [
      ['venmo', 'abc'],
      ['venmo', 'sara/../../evil'],
      ['venmo', 'https://evil.example/'],
      ['paypal', 'Sara Tyler'],
      ['paypal', 'https://evil.example/SaraTyler'],
      ['cashapp', '$2027'],
      ['cashapp', '$sara?x=1'],
      ['zelle', 'not an email'],
      ['zelle', '555-0142'],
      ['check', 'Chicago'],
    ] as const) {
      expect(handle(rail, raw), `${rail} ${raw}`).toMatch(/^invalid: /);
    }
  });

  it('builds each network’s own link, on the allowlist, and never with an amount', () => {
    const venmo = RAILS.venmo.url!('Sara-Tyler', 'Our honeymoon (wedding gift)');
    expect(venmo).toBe('https://venmo.com/Sara-Tyler?txn=pay&note=Our%20honeymoon%20(wedding%20gift)');
    expect(RAILS.paypal.url!('SaraTyler', 'x')).toBe('https://www.paypal.com/paypalme/SaraTyler');
    expect(RAILS.cashapp.url!('SaraTyler', 'x')).toBe('https://cash.app/$SaraTyler');
    for (const rail of GIFT_RAILS) {
      const spec = RAILS[rail];
      if (!spec.url) {
        expect(spec.mode, rail).toBe('direct');
        continue;
      }
      const url = spec.url('SaraTyler', 'Our home');
      expect(isAllowedRedirect(url), url).toBe(true);
      expect(new URL(url).searchParams.has('amount'), url).toBe(false);
    }
  });

  it('pins each payment host to the one link shape the site builds', () => {
    // A configured gift LINK (the older kind) can point at any allowlisted URL; these must not let
    // one reach a sign-in page, a checkout, or another path on the same host.
    for (const url of ['https://www.paypal.com/signin', 'https://www.paypal.com/checkoutnow?token=x', 'https://paypal.com/paypalme/x', 'https://cash.app/login', 'https://evil.cash.app/$x', 'https://account.venmo.com/pay', 'https://evil.venmo.com/x', 'https://venmo.com/u/anyone/settings', 'https://venmo.com/code?user_id=1', 'https://venmo.com/', 'https://venmo.com/Sara-Tyler/extra']) {
      expect(isAllowedRedirect(url), url).toBe(false);
    }
    expect(isAllowedRedirect('https://venmo.com/Sara-Tyler?txn=pay&note=x')).toBe(true);
  });

  it('fills instructions with what the couple typed, literally, and never a payee they did not name', () => {
    // `$&`, `$'` and `{name}` in a String.replace replacement are patterns; here they must be text.
    expect(railInstructions(RAILS.check, "1 Main $' St\n{name} Lane", "Sara $& Tyler")).toBe("Make it out to Sara $& Tyler and mail it to:\n1 Main $' St\n{name} Lane");
    expect(railInstructions(RAILS.check, '1 Main St', '{handle}')).toBe('Make it out to {handle} and mail it to:\n1 Main St');
    expect(railInstructions(RAILS.check, '1 Main St', null)).toBe('Mail it to:\n1 Main St');
    expect(railInstructions(RAILS.zelle, 'us@example.com', null)).toBe('Open your own bank’s app or website, choose Zelle, and send to us@example.com.');
    expect(railInstructions(RAILS.venmo, 'Sara-Tyler', null)).toBeNull();
  });

  it('keeps personal details personal and says what each network charges', () => {
    expect(RAILS.zelle.personal).toBe(true);
    expect(RAILS.check.personal).toBe(true);
    for (const rail of ['venmo', 'paypal', 'cashapp'] as const) expect(RAILS[rail].personal, rail).toBe(false);
    for (const rail of GIFT_RAILS) {
      expect(RAILS[rail].fee.length, rail).toBeGreaterThan(5);
      expect(RAILS[rail].source.verifiedAt, rail).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('ships the default funds in the couple’s language', () => {
    expect(DEFAULT_GIFT_FUNDS.map((f) => f.id)).toEqual(['honeymoon', 'home', 'adoption', 'next-adventures']);
    const words = [...DEFAULT_GIFT_FUNDS.flatMap((f) => [f.title, f.description]), ...Object.values(RAILS).flatMap((r) => [r.fee, r.instructions ?? '']), ...Object.values(GIFTS_COPY)].join(' ');
    for (const re of FORBIDDEN_GIFT_WORDS) expect(words).not.toMatch(re);
  });

  it('tells the concierge what exists, and nothing that does not', () => {
    const s = giftsStatement({ registry: 0, adventures: 0, funds: ['Our honeymoon', 'Our home'], rails: ['Venmo', 'Zelle'] });
    expect(s).toContain('“Our honeymoon” and “Our home”');
    expect(s).toContain('Venmo or Zelle');
    expect(s).toContain('never touches or holds the money');
    expect(s).toContain('no wishlist to link to yet');
    expect(s).not.toContain('have not chosen where to keep either list');
    for (const re of FORBIDDEN_GIFT_WORDS) expect(s).not.toMatch(re);
  });

  it('recognises a database the gifts-of-money migration has not reached, and nothing else', () => {
    // Previews never migrate (scripts/deploy/migrate-on-deploy.mjs), so /gifts must survive this.
    expect(isMissingGiftTable({ code: '42P01' })).toBe(true);
    expect(isMissingGiftTable(Object.assign(new Error('Failed query'), { cause: { code: '42P01' } }))).toBe(true);
    expect(isMissingGiftTable({ code: '42703' })).toBe(false);
    expect(isMissingGiftTable(new Error('connection refused'))).toBe(false);
    expect(isMissingGiftTable(undefined)).toBe(false);
  });
});
