import { describe, expect, it } from 'vitest';
import { createCapabilityContext, invoke } from '@/capabilities';
import { askConcierge } from '@/capabilities/ask_concierge';
import { getFaq } from '@/capabilities/get_faq';
import { searchWeddingInformationStatic } from '@/capabilities/search_wedding_information_static';
import type { GuestPrincipal } from '@/contracts/principal';
import { fixturePrincipal } from '@/db/seed/fixtures';

const anonymous = { kind: 'anonymous' as const };
const guest = fixturePrincipal('A1') as GuestPrincipal;

const ctxFor = async (principal: typeof anonymous | GuestPrincipal, surface: 'ui' | 'ai' = 'ui') =>
  createCapabilityContext({ principal, requestId: 'req-ask-auth', surface });

describe('Ask Us requires a guest session', () => {
  it('refuses anonymous callers on the FAQ and search capabilities', async () => {
    const faq = await invoke(getFaq, await ctxFor(anonymous), {});
    expect(!faq.ok && faq.error.code).toBe('unauthenticated');
    const search = await invoke(searchWeddingInformationStatic, await ctxFor(anonymous), { query: 'dress code' });
    expect(!search.ok && search.error.code).toBe('unauthenticated');
  });

  it('allows a signed-in guest', async () => {
    const faq = await invoke(getFaq, await ctxFor(guest), {});
    expect(faq.ok).toBe(true);
    const search = await invoke(searchWeddingInformationStatic, await ctxFor(guest), { query: 'dress code' });
    expect(search.ok).toBe(true);
  });

  it('refuses ask_concierge for anonymous callers', async () => {
    const r = await invoke(askConcierge, await ctxFor(anonymous), { question: 'When is the wedding?' });
    expect(!r.ok && r.error.code).toBe('unauthenticated');
  });
});
