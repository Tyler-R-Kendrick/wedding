import type { LifecycleState } from '@/contracts/lifecycle';
import type { RsvpWindowMode } from '@/db/schema/events';

export type RsvpWindowReason = 'manual_open' | 'manual_closed' | 'lifecycle' | 'deadline_passed' | 'scheduled';

/** Guest-safe description of whether RSVPs are accepted right now and why. */
export interface RsvpWindow {
  open: boolean;
  reason: RsvpWindowReason;
  mode: RsvpWindowMode;
  /** ISO instant or null while TODO(Tyler & Sara). */
  deadlineAt: string | null;
  lifecycle: LifecycleState;
}

/**
 * Manual override beats the schedule (ADR-0012): `open`/`closed` win outright; `auto`
 * follows the lifecycle (RSVP_OPEN) and the deadline. Evaluated server-side on every
 * draft and submit — the form being visible is never the check.
 */
export function computeRsvpWindow(
  settings: { mode: RsvpWindowMode; deadlineAt: Date | string | null },
  lifecycle: LifecycleState,
  now: Date,
): RsvpWindow {
  const deadline = settings.deadlineAt ? new Date(settings.deadlineAt) : null;
  const deadlineAt = deadline ? deadline.toISOString() : null;
  const base = { mode: settings.mode, deadlineAt, lifecycle };
  if (settings.mode === 'open') return { ...base, open: true, reason: 'manual_open' };
  if (settings.mode === 'closed') return { ...base, open: false, reason: 'manual_closed' };
  if (lifecycle !== 'RSVP_OPEN') return { ...base, open: false, reason: 'lifecycle' };
  if (deadline && now.getTime() > deadline.getTime()) return { ...base, open: false, reason: 'deadline_passed' };
  return { ...base, open: true, reason: 'scheduled' };
}
