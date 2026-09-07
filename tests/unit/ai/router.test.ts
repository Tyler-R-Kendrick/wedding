import { describe, expect, it } from 'vitest';
import { descriptionScore, inputJsonSchema, planRoute, PROTECTED_FACT_WORDS, toolsFor, type RouterTool } from '@/ai/router';
import { CONTACT_LINK, labelForRoute, refusalLinks, systemPromptFor, SYSTEM_CONTRACT } from '@/ai/contract';
import { BUILTIN_CAPABILITIES } from '@/capabilities';
import { CapabilityRegistryImpl } from '@/capabilities/registry';
import type { AnyCapability } from '@/contracts/capability';
import { FEATURE_FLAGS, type FlagValues } from '@/contracts/flags';
import type { GuestPrincipal, Principal } from '@/contracts/principal';

const flags = { ...FEATURE_FLAGS } as FlagValues;
const anonymous: Principal = { kind: 'anonymous' };
const guest: GuestPrincipal = {
  kind: 'guest',
  authIdentityId: 'a' as never,
  guestId: 'g1' as never,
  householdId: 'h1' as never,
  actsFor: ['g1' as never],
  entitlements: new Set(['view_event', 'view_table_assignment', 'use_concierge']),
  authenticatedAt: new Date().toISOString(),
  sessionId: 's',
};

const registry = new CapabilityRegistryImpl();
registry.registerAll(BUILTIN_CAPABILITIES);

const plan = (question: string, principal: Principal = anonymous, extra: readonly AnyCapability[] = []) => {
  const reg = new CapabilityRegistryImpl();
  reg.registerAll([...BUILTIN_CAPABILITIES, ...extra]);
  const available: RouterTool[] = toolsFor(principal, flags, reg);
  return planRoute(question, available, reg.list({ exposure: 'ai', flags }), 4);
};

describe('capability-derived tool list', () => {
  it('offers only AI-exposed capabilities the principal may call', () => {
    const names = toolsFor(anonymous, flags, registry).map((t) => t.descriptor.name);
    expect(names).toContain('search_wedding_information');
    expect(names).toContain('get_faq');
    // ask_concierge would recurse, list_ai_traces is admin-only.
    expect(names).not.toContain('ask_concierge');
    expect(names).not.toContain('list_ai_traces');
  });

  it('produces a JSON schema for every offered tool', () => {
    for (const tool of toolsFor(anonymous, flags, registry)) {
      expect(inputJsonSchema(tool.descriptor), tool.descriptor.name).toBeTypeOf('object');
    }
  });
});

describe('deterministic router', () => {
  it('routes wedding facts to the structured capability, not to the model', () => {
    expect(plan('When is the wedding?').calls.map((c) => c.name)).toContain('site_status');
    expect(plan('Where is the wedding being held?').calls.map((c) => c.name)).toContain('site_status');
  });

  it('recognises the five facts the couple has not decided', () => {
    expect(plan('What time does the ceremony start?').protectedFact).toBe('time');
    expect(plan('Which room is the ceremony in?').protectedFact).toBe('room');
    expect(plan('What should I wear?').protectedFact).toBe('dress');
    expect(plan('What is on the menu?').protectedFact).toBe('menu');
    expect(plan('Is there a band or a DJ?').protectedFact).toBe('music');
  });

  it('does not treat "where is the wedding" as a room question', () => {
    expect(plan('Where is the wedding being held?').protectedFact).toBeUndefined();
  });

  it('marks questions about the caller as personal', () => {
    expect(plan('Which table am I sitting at?', guest).personal).toBe(true);
    expect(plan('What is the dress code?').personal).toBe(false);
  });

  it('never plans the concierge itself or the retrieval tool as a model-facing call', () => {
    for (const question of ['ask the concierge about parking', 'search the site for valet']) {
      expect(plan(question).calls.map((c) => c.name)).not.toContain('ask_concierge');
    }
  });

  it('caps how many capabilities one question can run', () => {
    const reg = new CapabilityRegistryImpl();
    reg.registerAll(BUILTIN_CAPABILITIES);
    const capped = planRoute('where is the venue and what time and what should I wear and what about kids and parking and gifts', toolsFor(anonymous, flags, reg), reg.list({ exposure: 'ai', flags }), 2);
    expect(capped.calls.length).toBeLessThanOrEqual(2);
  });

  it('records capabilities the principal may not call as denied instead of calling them', () => {
    const p = plan('Which table am I sitting at?', anonymous);
    expect(p.personal).toBe(true);
    expect(p.calls.map((c) => c.name)).not.toContain('list_ai_traces');
  });

  it('scores unknown capabilities by their description so later swarms are routable', () => {
    const descriptor = { name: 'search_flights', title: 'Search flights', description: 'Finds live flight options into Chicago for the wedding weekend.' };
    expect(descriptionScore(descriptor, 'find me a flight to chicago')).toBeGreaterThanOrEqual(4);
    expect(descriptionScore(descriptor, 'how did they meet')).toBeLessThan(4);
  });

  it('only navigates to routes on the allowlist', () => {
    expect(plan('Take me to the RSVP page.', guest).navigate).toEqual({ route: '/rsvp' });
    expect(plan('Take me to https://evil.example/steal', guest).navigate).toBeUndefined();
    expect(plan('What is the RSVP deadline?').navigate).toBeUndefined();
  });

  it('knows the words an answer about a protected fact has to contain', () => {
    expect(PROTECTED_FACT_WORDS.room.test('The ceremony room is not yet decided')).toBe(true);
    expect(PROTECTED_FACT_WORDS.room.test('Accessible parking is on Michigan Avenue')).toBe(false);
  });
});

describe('closed-world contract', () => {
  it('is static text with no evidence in it', () => {
    expect(SYSTEM_CONTRACT).toContain('ONLY the evidence blocks in the current message');
    expect(SYSTEM_CONTRACT).toContain('Closed world');
    expect(SYSTEM_CONTRACT).not.toContain('Chicago Athletic Association');
  });

  it('tells the model who is asking without inventing an identity', () => {
    expect(systemPromptFor({ principalKind: 'guest', toolNames: ['get_faq'] })).toContain('signed in');
    expect(systemPromptFor({ principalKind: 'anonymous', toolNames: [] })).toContain('No tools are available');
  });

  it('offers pages, never repository paths, on a refusal', () => {
    const links = refusalLinks(['/the-wedding', '/explore-caa#history'], '/ask-us');
    expect(links.map((l) => l.href)).toEqual(['/the-wedding', '/explore-caa', CONTACT_LINK.href]);
    for (const link of links) expect(link.href.startsWith('/')).toBe(true);
    expect(labelForRoute('/explore-caa/white-city-ballroom')).toBe('Explore CAA');
  });
});
