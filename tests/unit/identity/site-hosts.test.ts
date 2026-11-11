import { describe, expect, it } from 'vitest';
import { aliasLabelOf, aliasOrigins, relayTargetFor, requestHost, siteOriginOf, siteOriginsFor, stateForHost } from '@/lib/site-hosts';
import { isTrustedMutationRequest } from '@/lib/auth/csrf';
import { assertSameOriginJson } from '@/lib/request';

const CANONICAL = 'https://kendrick.wedding';
const ALIAS = 'https://fitzgerald.kendrick.wedding';

describe('site hosts: the alias is the site', () => {
  it('derives the alias from the canonical origin, whatever that is', () => {
    expect(aliasOrigins(CANONICAL)).toEqual([ALIAS]);
    expect(aliasOrigins('http://localhost:3000')).toEqual(['http://fitzgerald.localhost:3000']);
    expect(siteOriginsFor(`${CANONICAL}/`)).toEqual([CANONICAL, ALIAS]);
  });

  it('has no alias for a bare IP or a value that is not an origin', () => {
    expect(aliasOrigins('http://127.0.0.1:3000')).toEqual([]);
    expect(aliasOrigins('not a url')).toEqual([]);
  });

  it('recognises only its own labels on its own domain', () => {
    expect(aliasLabelOf('fitzgerald.kendrick.wedding', CANONICAL)).toBe('fitzgerald');
    expect(aliasLabelOf('FITZGERALD.kendrick.wedding', CANONICAL)).toBe('fitzgerald');
    expect(aliasLabelOf('kendrick.wedding', CANONICAL)).toBeNull();
    expect(aliasLabelOf('evil.kendrick.wedding', CANONICAL)).toBeNull();
    expect(aliasLabelOf('fitzgerald.kendrick.wedding.evil.example', CANONICAL)).toBeNull();
    expect(aliasLabelOf('fitzgerald.example.com', CANONICAL)).toBeNull();
  });

  it('reads the host the browser named, preferring the proxy header', () => {
    expect(requestHost(new Headers({ host: 'internal:3000', 'x-forwarded-host': 'Fitzgerald.kendrick.wedding' }))).toBe('fitzgerald.kendrick.wedding');
    expect(requestHost(new Headers({ host: 'kendrick.wedding' }))).toBe('kendrick.wedding');
    expect(requestHost(new Headers())).toBeNull();
  });
});

describe('site hosts: a redirect stays on the host the guest is using', () => {
  const FALLBACK = 'http://internal:3000';

  it('answers with the canonical origin or the alias, whichever was asked', () => {
    expect(siteOriginOf(new Headers({ host: 'kendrick.wedding' }), CANONICAL, FALLBACK)).toBe(CANONICAL);
    expect(siteOriginOf(new Headers({ host: 'internal:3000', 'x-forwarded-host': 'fitzgerald.kendrick.wedding' }), CANONICAL, FALLBACK)).toBe(ALIAS);
  });

  it('never builds an origin out of a host it does not own', () => {
    expect(siteOriginOf(new Headers({ host: 'evil.example' }), CANONICAL, FALLBACK)).toBe(FALLBACK);
    expect(siteOriginOf(new Headers({ host: 'evil.kendrick.wedding' }), CANONICAL, FALLBACK)).toBe(FALLBACK);
    expect(siteOriginOf(new Headers(), CANONICAL, FALLBACK)).toBe(FALLBACK);
  });
});

describe('site hosts: an OAuth answer goes back to the host that asked', () => {
  it('names the alias in state only when the sign-in started there', () => {
    expect(stateForHost('abc_-123', 'fitzgerald.kendrick.wedding', CANONICAL)).toBe('abc_-123.fitzgerald');
    expect(stateForHost('abc_-123', 'kendrick.wedding', CANONICAL)).toBe('abc_-123');
    expect(stateForHost('abc_-123', null, CANONICAL)).toBe('abc_-123');
  });

  it('relays from the canonical callback to the alias, and never anywhere else', () => {
    expect(relayTargetFor('abc.fitzgerald', 'kendrick.wedding', CANONICAL)).toBe(ALIAS);
    // Already on the alias: handle it here, or the browser would loop.
    expect(relayTargetFor('abc.fitzgerald', 'fitzgerald.kendrick.wedding', CANONICAL)).toBeNull();
    // An ordinary canonical sign-in, and labels this site never defined.
    expect(relayTargetFor('abc', 'kendrick.wedding', CANONICAL)).toBeNull();
    expect(relayTargetFor('abc.evil', 'kendrick.wedding', CANONICAL)).toBeNull();
    expect(relayTargetFor('abc.evil.example', 'kendrick.wedding', CANONICAL)).toBeNull();
    expect(relayTargetFor(null, 'kendrick.wedding', CANONICAL)).toBeNull();
  });
});

describe('site hosts: mutations from the alias are same-site', () => {
  const post = (headers: Record<string, string>) => new Request('https://kendrick.wedding/api/x', { method: 'POST', headers });

  it('trusts a POST whose Origin is the alias', () => {
    expect(isTrustedMutationRequest(post({ origin: ALIAS, host: 'internal' }), siteOriginsFor(CANONICAL))).toBe(true);
    expect(isTrustedMutationRequest(post({ origin: 'https://evil.example', host: 'internal' }), siteOriginsFor(CANONICAL))).toBe(false);
    expect(isTrustedMutationRequest(post({ origin: 'https://evil.kendrick.wedding', host: 'internal' }), siteOriginsFor(CANONICAL))).toBe(false);
  });

  it('accepts a JSON capability POST from the alias and still refuses a foreign origin', () => {
    const json = (origin: string) => post({ origin, 'content-type': 'application/json' });
    expect(assertSameOriginJson(json(ALIAS), { siteUrl: CANONICAL }).ok).toBe(true);
    expect(assertSameOriginJson(json(CANONICAL), { siteUrl: CANONICAL }).ok).toBe(true);
    expect(assertSameOriginJson(json('https://evil.example'), { siteUrl: CANONICAL }).ok).toBe(false);
  });
});
