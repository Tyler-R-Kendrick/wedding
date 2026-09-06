import type { RsvpStatus } from '@/db/schema/rsvp';
import type { HouseholdRsvpInput } from './types';

export interface RsvpProposalLine {
  guestId: string;
  guestName: string;
  eventId: string;
  eventName: string;
  status: RsvpStatus;
  mealLabel: string | null;
  plusOne: { attending: boolean; name: string | null; mealLabel: string | null } | null;
}

export interface RsvpProposal {
  lines: RsvpProposalLine[];
  /** Guest names whose dietary/accessibility notes will be recorded. Never the text. */
  needsRecordedFor: string[];
  summary: string;
}

interface Names {
  guestName: (id: string) => string;
  eventName: (id: string) => string;
  mealLabel: (id: string | null) => string | null;
}

/** Human-readable restatement of a normalized submission. Contains no needs text by construction. */
export function buildProposal(input: HouseholdRsvpInput, names: Names): RsvpProposal {
  const lines: RsvpProposalLine[] = input.responses.map((r) => ({
    guestId: r.guestId,
    guestName: names.guestName(r.guestId),
    eventId: r.eventId,
    eventName: names.eventName(r.eventId),
    status: r.status,
    mealLabel: names.mealLabel(r.mealOptionId),
    plusOne: r.plusOne ? { attending: r.plusOne.attending, name: r.plusOne.name, mealLabel: names.mealLabel(r.plusOne.mealOptionId) } : null,
  }));
  const needsRecordedFor = input.needs.filter((n) => n.dietary || n.accessibility).map((n) => names.guestName(n.guestId));
  const accepted = lines.filter((l) => l.status === 'accepted').length;
  const declined = lines.length - accepted;
  const summary = `${accepted} accepted, ${declined} declined across ${new Set(lines.map((l) => l.eventId)).size} event(s)`;
  return { lines, needsRecordedFor, summary };
}

/** Plain-text confirmation e-mail body. Restates what was submitted and how to change it; no needs text. */
export function buildConfirmationEmail(proposal: RsvpProposal, opts: { firstName: string; editableUntil: string | null; rsvpUrl: string }): { subject: string; body: string } {
  const byEvent = new Map<string, RsvpProposalLine[]>();
  for (const line of proposal.lines) byEvent.set(line.eventName, [...(byEvent.get(line.eventName) ?? []), line]);
  const parts: string[] = [`Hi ${opts.firstName},`, '', 'Thank you — here is what we have for your household:', ''];
  for (const [eventName, lines] of byEvent) {
    parts.push(eventName);
    for (const l of lines) {
      const bits = [l.status === 'accepted' ? 'attending' : 'not attending'];
      if (l.mealLabel) bits.push(`meal: ${l.mealLabel}`);
      if (l.plusOne?.attending) bits.push(`guest: ${l.plusOne.name ?? 'name to follow'}${l.plusOne.mealLabel ? ` (${l.plusOne.mealLabel})` : ''}`);
      parts.push(`  - ${l.guestName}: ${bits.join(', ')}`);
    }
    parts.push('');
  }
  if (proposal.needsRecordedFor.length) parts.push(`Dietary and accessibility notes recorded for: ${proposal.needsRecordedFor.join(', ')}.`, '');
  parts.push(
    opts.editableUntil
      ? `You can change any of this until ${opts.editableUntil} at ${opts.rsvpUrl}.`
      : `You can change any of this while RSVPs are open at ${opts.rsvpUrl}.`,
    '',
    'With love,',
    'Sara + Tyler',
  );
  return { subject: 'Your RSVP for Sara + Tyler', body: parts.join('\n') };
}
