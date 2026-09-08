import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LIFECYCLE_STATES } from '@/contracts/lifecycle';
import { navFor } from '@/domain/lifecycle/nav';
import { guestText } from '@/domain/content/text';

/**
 * What the site claims about ITSELF, and about the reader's standing with it.
 *
 * A guest reviewer walked the public pages signed in and found the nav instructing them to do a
 * thing they had already done, and two shapes of editorial note — written to the couple, about the
 * couple's own homework — rendering as guest copy.
 */

describe('the public nav', () => {
  it('never instructs a guest to claim, because a static page cannot know whether they have', () => {
    // `claimed` is only ever passed a principal by `site_status` (AI/WebMCP) and the admin preview.
    // Public pages are statically rendered per design, so on every page a guest actually browses it
    // is false — and INVITATIONS_OPEN told a guest who had claimed, signed in and answered their
    // RSVP to go and claim their invitation.
    for (const state of LIFECYCLE_STATES) {
      const labels = [...navFor(state).sticky, ...navFor(state).primary, ...navFor(state).more].map((i) => i.label);
      expect(labels, state).not.toContain('Claim your invitation');
      for (const l of labels) expect(l, `${state}: ${l}`).not.toMatch(/^Claim\b/);
    }
    // The destination is still offered where the lifecycle wants it, and the sticky CTA does not
    // repeat the words the primary nav already uses for the same href.
    const open = navFor('INVITATIONS_OPEN');
    expect(open.sticky.map((i) => i.label)).toContain('Open your invitation');
    expect(open.primary.map((i) => i.label)).toContain('Your invitation');
    expect(open.sticky.every((i) => !open.primary.some((p) => p.label === i.label))).toBe(true);
  });
});

describe('editorial metadata never reaches a guest', () => {
  it('scrubs a bare ticket id, not only the ones that say "backlog"', () => {
    // `(P-02)` with the word "backlog" nowhere near it was invisible to the scrubber and rendered
    // verbatim in an itinerary intro on /our-adventures.
    expect(guestText('A calm Saturday morning, once the times are confirmed (P-02).')).toBe('A calm Saturday morning, once the times are confirmed.');
    expect(guestText('Short legs, short stops (C-05).')).toBe('Short legs, short stops.');
    expect(guestText('Kid policies (C-05, X-04) and the picks you trust.')).toBe('Kid policies and the picks you trust.');
    // and the shapes it already caught
    expect(guestText('The dress code (backlog C-01).')).toBe('The dress code.');
    expect(guestText('See backlog P-02 for more.')).toBe('See for more.');
    // an ordinary parenthetical survives
    expect(guestText('Cindy\'s (the rooftop) opens at 11.')).toBe('Cindy\'s (the rooftop) opens at 11.');
    expect(guestText('Ride the 146 (bus) north.')).toBe('Ride the 146 (bus) north.');
  });

  it('has no note in the seed that tells the couple what to do', () => {
    // "Kit figure — verify with the planner before publishing as fact." rendered four times on
    // /explore-caa. A guest needs the provenance, not the couple's task list.
    const spaces = readFileSync('src/content/seed/venue-spaces.json', 'utf8');
    expect(spaces).not.toContain('verify with the planner');
    expect(spaces).not.toContain('before publishing as fact');
    expect(spaces).toContain("venue's own kit figures");
    const itineraries = readFileSync('src/content/seed/itineraries.json', 'utf8');
    expect(itineraries).not.toMatch(/\((?:[CPVX]-\d{1,3})\)/);
  });
});

describe('Your Weekend does not describe a site that is not this one', () => {
  it('never says a tool is not live yet when it is live in the same nav', async () => {
    // Both slots were written at level 03 and were true then. Levels 08 and 09 shipped
    // /transportation and /trip into the same nav; the slot copy was never revisited, and
    // `registerWeekendSlotProvider` is called from one integration test and nowhere else, so the
    // fallback IS the shipped state. A guest read "once travel tools are live" one tap from them.
    const { resolveWeekendSlots, WEEKEND_SLOT_KINDS } = await import('@/domain/weekend/slots');
    // No provider is registered, so nothing here touches the context.
    const slots = await resolveWeekendSlots({} as never);
    const json = JSON.stringify(slots);
    expect(json).not.toMatch(/once travel tools are live|will appear here once/i);
    expect(json).not.toContain('swarm-');
    for (const kind of WEEKEND_SLOT_KINDS) {
      const slot = slots[kind];
      expect(slot.placeholder, kind).toBe(false);
      expect(slot, kind).not.toHaveProperty('owner');
    }
    expect(json).toContain('/transportation');
    expect(json).toContain('/trip');
  });
});
