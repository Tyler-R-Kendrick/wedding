import { describe, expect, it } from 'vitest';
import { assertAllowedRedirect, isAllowedRedirect } from '@/lib/redirects';

describe('redirect allowlist', () => {
  it('allows partner hosts and subdomains over https', () => {
    for (const u of [
      'https://www.hyatt.com/en-US/hotel/x',
      'https://www.chicagoathletichotel.com/about/faq/',
      'https://m.uber.com/ul/?action=setPickup',
      'https://www.theknot.com/us/x',
      'https://www.zola.com/registry/x',
      'https://withjoy.com/x',
      'https://www.google.com/maps/dir/?api=1',
      'https://www.google.com/maps/search/?api=1&query=x',
      'https://maps.google.com/?q=x',
      'https://maps.apple.com/?q=x',
      'https://www.apple.com/maps/',
      'https://www.apple.com/maps/directions/',
      'https://www.opentable.com/r/x',
      'https://resy.com/cities/chi/x',
      'https://www.skyscanner.com/transport/flights/lax/ord/',
      'https://www.skyscanner.co.uk/x',
      'https://www.skyscanner.de/x',
      'https://www.skyscanner.com.au/x',
      'https://app.duffel.com/x',
      'https://www.booking.com/searchresults.html',
    ]) {
      expect(isAllowedRedirect(u), u).toBe(true);
    }
  });

  it('rejects other hosts, http, credentials, lookalikes, and non-maps paths', () => {
    for (const u of [
      'http://www.hyatt.com/',
      'https://evil.example/',
      'https://hyatt.com.evil.example/',
      'https://notuber.com/',
      'https://www.google.com/search?q=x',
      'https://www.google.com/maps',
      'https://www.google.com/mapsomething/',
      'https://google.com/maps/',
      'https://docs.google.com/maps/',
      'https://evil.maps.google.com/',
      'https://www.apple.com/iphone/',
      'https://www.apple.com/maps',
      'https://apple.com/maps/',
      'https://x.maps.apple.com/',
      'https://user:pw@www.hyatt.com/',
      'https://skyscanner.evil.com/',
      'javascript:alert(1)',
      'not a url',
    ]) {
      expect(isAllowedRedirect(u), u).toBe(false);
    }
    const r = assertAllowedRedirect('https://evil.example/');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('forbidden');
  });
});
