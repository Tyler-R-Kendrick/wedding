import type { LifecycleState } from '@/contracts/lifecycle';
import { planDashboard, type DashboardFacts, type DashboardPlan } from '@/domain/lifecycle/guest-actions';

/**
 * The facts the dashboard is planned from, read off what the page already fetched. Pure: the page
 * passes the clock in, so "has the book-by date passed" is a test, not a guess.
 */
export interface DashboardInput {
  state: LifecycleState;
  /** The guest's reply and events, or null when their invitation does not carry any yet. */
  itinerary: {
    rsvp: { window: { open: boolean }; canAnswer: boolean; status: 'not_started' | 'partial' | 'complete'; parts: readonly { state: string }[] };
    events: readonly unknown[];
    seating: { state: string };
  } | null;
  block: { placeholder: boolean; url: string | null; cutoff: string | null } | null;
  rideBenefits: number;
  now: Date;
}

/** A block can be booked while it has a link and its book-by date (a calendar day in Chicago) is not behind us. */
export function isBlockOpen(block: DashboardInput['block'], now: Date): boolean {
  if (!block || block.placeholder || !block.url) return false;
  if (!block.cutoff) return true;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(now);
  return today <= block.cutoff.slice(0, 10);
}

export function dashboardFacts(input: DashboardInput): DashboardFacts {
  const it = input.itinerary;
  // An open window with no part of the reply released yet is not a reply a guest can give.
  const answerable = !!it && it.rsvp.window.open && it.rsvp.canAnswer && it.rsvp.parts.some((p) => p.state === 'open');
  return {
    rsvp: it ? { open: answerable, canAnswer: it.rsvp.canAnswer, status: it.rsvp.status } : null,
    hasEvents: !!it && it.events.length > 0,
    blockOpen: isBlockOpen(input.block, input.now),
    seated: it?.seating.state === 'seated',
    hasRide: input.rideBenefits > 0,
  };
}

export function dashboardPlan(input: DashboardInput): DashboardPlan {
  return planDashboard(input.state, dashboardFacts(input));
}
