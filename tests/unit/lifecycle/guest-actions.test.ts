import { describe, expect, it } from 'vitest';
import { LIFECYCLE_STATES } from '@/contracts/lifecycle';
import { isSafeReturnPath } from '@/domain/identity/routes';
import { currentGuestAction, planDashboard, type DashboardFacts } from '@/domain/lifecycle/guest-actions';
import { dashboardFacts, isBlockOpen } from '@/domain/weekend/dashboard';

const NOTHING: DashboardFacts = { rsvp: null, hasEvents: false, blockOpen: false, seated: false, hasRide: false };
const OPEN_BLOCK: DashboardFacts = { ...NOTHING, blockOpen: true };
const invited = (status: 'not_started' | 'partial' | 'complete', open = true): DashboardFacts => ({ ...OPEN_BLOCK, hasEvents: true, rsvp: { open, canAnswer: true, status } });

describe('what a guest should do now', () => {
  it('has one action for every state, and each one survives the trip through sign-in', () => {
    for (const state of LIFECYCLE_STATES) {
      const action = currentGuestAction(state);
      expect(action.label.length, state).toBeGreaterThan(2);
      // Home links it as /sign-in?next=<href>; a path sign-in refuses would drop the guest on a fallback.
      expect(isSafeReturnPath(action.href), `${state}: ${action.href}`).toBe(true);
    }
  });

  it('follows the timeline: the room block with the save-the-date, the RSVP when replies open', () => {
    expect(currentGuestAction('SAVE_THE_DATE')).toEqual({ label: 'Book your hotel room', href: '/guests/travel' });
    expect(currentGuestAction('RSVP_OPEN')).toEqual({ label: 'RSVP', href: '/rsvp' });
  });
});

describe('the dashboard plan', () => {
  it('leads with the room block while the save-the-dates are out, then flights and getting around', () => {
    const plan = planDashboard('SAVE_THE_DATE', OPEN_BLOCK);
    expect(plan.lead).toBe('stay');
    expect(plan.next).toEqual(['flights', 'around']);
    expect(plan.done).toEqual([]);
  });

  it('opens for a guest with no invitation yet: the trip is still theirs to plan', () => {
    const plan = planDashboard('SAVE_THE_DATE', NOTHING);
    // No block to book is not a reason to show nothing: flights lead, where to stay follows.
    expect(plan.lead).toBe('flights');
    expect(plan.next).toEqual(['stay', 'around']);
  });

  it('puts the RSVP first the moment replies open, and the room block steps down', () => {
    const plan = planDashboard('RSVP_OPEN', invited('not_started'));
    expect(plan.lead).toBe('rsvp');
    expect(plan.next.slice(0, 3)).toEqual(['stay', 'flights', 'around']);
  });

  it('lets an answered RSVP step aside rather than lead', () => {
    const plan = planDashboard('RSVP_OPEN', invited('complete'));
    expect(plan.done).toEqual(['rsvp']);
    expect(plan.lead).toBe('stay');
    expect(plan.next).not.toContain('rsvp');
  });

  it('keeps a half-answered RSVP in the lead', () => {
    expect(planDashboard('RSVP_OPEN', invited('partial')).lead).toBe('rsvp');
  });

  it('never offers a reply that cannot be given', () => {
    const closed = planDashboard('RSVP_OPEN', invited('not_started', false));
    expect([closed.lead, ...closed.next, ...closed.done]).not.toContain('rsvp');
    const notInvited = planDashboard('RSVP_OPEN', OPEN_BLOCK);
    expect([notInvited.lead, ...notInvited.next]).not.toContain('rsvp');
  });

  it('shows nothing a guest cannot use yet', () => {
    for (const state of ['TEASER', 'SAVE_THE_DATE', 'INVITATIONS_OPEN', 'RSVP_OPEN', 'RSVP_CLOSED', 'WEDDING_WEEK'] as const) {
      const plan = planDashboard(state, { ...invited('complete'), seated: true, hasRide: true });
      const all = [plan.lead, ...plan.next, ...plan.done];
      expect(all, state).not.toContain('photos');
      if (state !== 'WEDDING_WEEK') expect(all, state).not.toContain('table');
    }
    for (const state of ['TEASER', 'SAVE_THE_DATE', 'INVITATIONS_OPEN'] as const) {
      const all = Object.values(planDashboard(state, invited('not_started'))).flat();
      expect(all, state).not.toContain('gifts');
    }
  });

  it('shows a table only once the guest has one, and a ride only when one is on the invitation', () => {
    const without = planDashboard('WEDDING_WEEK', invited('complete', false));
    expect([without.lead, ...without.next]).not.toContain('table');
    expect([without.lead, ...without.next]).not.toContain('ride');
    const withBoth = planDashboard('WEDDING_WEEK', { ...invited('complete', false), seated: true, hasRide: true });
    expect(withBoth.lead).toBe('schedule');
    expect(withBoth.next).toEqual(expect.arrayContaining(['table', 'ride', 'around']));
  });

  it('turns to photographs after the day', () => {
    expect(planDashboard('POST_WEDDING', invited('complete', false)).lead).toBe('photos');
    expect(planDashboard('ARCHIVE', NOTHING).lead).toBe('photos');
  });

  it('never lists a card twice', () => {
    for (const state of LIFECYCLE_STATES) {
      for (const facts of [NOTHING, OPEN_BLOCK, invited('not_started'), invited('complete'), { ...invited('complete'), seated: true, hasRide: true }]) {
        const plan = planDashboard(state, facts);
        const all = [plan.lead, ...plan.next, ...plan.done].filter(Boolean);
        expect(new Set(all).size, state).toBe(all.length);
      }
    }
  });
});

describe('the facts the plan is made from', () => {
  const block = { placeholder: false, url: 'https://example.test/book', cutoff: '2027-06-15' };

  it('a block is bookable through its book-by date in Chicago, and not after', () => {
    expect(isBlockOpen(block, new Date('2027-06-15T23:00:00-05:00'))).toBe(true);
    expect(isBlockOpen(block, new Date('2027-06-16T00:30:00-05:00'))).toBe(false);
    expect(isBlockOpen({ ...block, cutoff: null }, new Date('2030-01-01T00:00:00Z'))).toBe(true);
  });

  it('a block without a link, or still a placeholder, is not bookable', () => {
    const now = new Date('2027-01-01T00:00:00Z');
    expect(isBlockOpen({ ...block, url: null }, now)).toBe(false);
    expect(isBlockOpen({ ...block, placeholder: true }, now)).toBe(false);
    expect(isBlockOpen(null, now)).toBe(false);
  });

  it('an open window with no part released yet is not a reply to give', () => {
    const itinerary = { rsvp: { window: { open: true }, canAnswer: true, status: 'not_started' as const, parts: [{ state: 'later' }] }, events: [{}], seating: { state: 'not_published' } };
    const facts = dashboardFacts({ state: 'RSVP_OPEN', itinerary, block, rideBenefits: 0, now: new Date('2027-01-01T00:00:00Z') });
    expect(facts.rsvp?.open).toBe(false);
    expect(facts.hasEvents).toBe(true);
    expect(facts.seated).toBe(false);
  });
});
