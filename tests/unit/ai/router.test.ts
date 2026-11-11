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
    const anonNames = toolsFor(anonymous, flags, registry).map((t) => t.descriptor.name);
    // With no session the concierge can tell the couple's story and move between pages. Nothing it
    // is offered knows the date, the venue, the hotel block or a recommendation.
    expect([...anonNames].sort()).toEqual(['get_story', 'list_adventures', 'navigate_to', 'show_adventure']);
    for (const name of ['site_status', 'get_venue_facts', 'show_venue_room', 'list_itineraries', 'find_adventures', 'get_reservation_options', 'open_reservation_link', 'list_hotel_recommendations', 'search_travel_options', 'open_booking_link', 'get_my_transportation_options']) {
      expect(anonNames, name).not.toContain(name);
    }
    expect(anonNames).not.toContain('search_wedding_information');
    expect(anonNames).not.toContain('get_faq');
    expect(anonNames).not.toContain('ask_concierge');
    expect(anonNames).not.toContain('list_ai_traces');

    const guestNames = toolsFor(guest, flags, registry).map((t) => t.descriptor.name);
    expect(guestNames).toContain('search_wedding_information');
    expect(guestNames).toContain('get_faq');
    for (const name of ['site_status', 'get_venue_facts', 'show_venue_room', 'list_itineraries', 'find_adventures', 'list_hotel_recommendations', 'get_my_transportation_options']) expect(guestNames, name).toContain(name);
  });

  it('produces a JSON schema for every offered tool', () => {
    for (const tool of toolsFor(guest, flags, registry)) {
      expect(inputJsonSchema(tool.descriptor), tool.descriptor.name).toBeTypeOf('object');
    }
  });
});

describe('deterministic router', () => {
  it('routes a guest\'s wedding facts to the structured capability, not to the model', () => {
    expect(plan('When is the wedding?', guest).calls.map((c) => c.name)).toContain('site_status');
    expect(plan('Where is the wedding being held?', guest).calls.map((c) => c.name)).toEqual(['site_status', 'get_venue_facts']);
    expect(plan('When is the wedding?', guest).denied).toEqual([]);
  });

  it('plans no call that could say when or where the wedding is for an asker with no session', () => {
    const when = plan('When is the wedding?');
    expect(when.calls).toEqual([]);
    expect(when.denied).toEqual(['site_status']);
    const where = plan('Where is the wedding being held?');
    expect(where.calls).toEqual([]);
    expect(where.denied).toEqual(['site_status', 'get_venue_facts']);
    // However the question is put, nothing planned for an anonymous asker reads a wedding detail.
    const open = new Set(['get_story', 'list_adventures', 'show_adventure', 'navigate_to']);
    for (const question of ['What date is it?', 'Which hotel should I book?', 'What is the venue address?', 'How do I get there from the airport?', 'What is there to do in Chicago?', 'Is there a room block?', 'Where can I park?', 'where is the venue and what time and what should I wear and what about kids and parking and gifts']) {
      for (const call of plan(question).calls) expect(open.has(call.name), `${question}: ${call.name}`).toBe(true);
    }
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
    const links = refusalLinks(['/guests', '/our-venue#history'], '/guests/ask-us');
    expect(links.map((l) => l.href)).toEqual(['/guests', '/our-venue', CONTACT_LINK.href]);
    expect(links.map((l) => l.label)).toEqual(['Your dashboard', 'Our Venue', 'Reach Sara and Tyler']);
    for (const link of links) expect(link.href.startsWith('/')).toBe(true);
    // Ask Us is the page the guest is already on: the fallback is how to reach the couple, there.
    expect(CONTACT_LINK.href).toBe('/guests/ask-us#contact');
    expect(refusalLinks([], '/guests/ask-us')).toEqual([CONTACT_LINK]);
    expect(labelForRoute('/our-venue/white-city-ballroom')).toBe('Our Venue');
    expect(labelForRoute('/guests/travel#stay')).toBe('Your Trip');
    expect(labelForRoute('/guests/travel#plan')).toBe('Your Trip');
    // The pages folded into the portal have no label of their own any more.
    for (const gone of ['/the-wedding', '/your-weekend', '/travel', '/share-an-adventure', '/ask-us']) expect(labelForRoute(gone), gone).toBe('the page');
  });
});
