import { z } from 'zod';
import { defineCapability } from '@/contracts/capability';
import { CapabilityError } from '@/contracts/errors';
import { toPrincipalRef } from '@/contracts/principal';
import { err, ok } from '@/contracts/result';
import { appServices } from '@/capabilities/context';
import { stableHash } from '@/lib/crypto';
import { buildProposal, type HouseholdRsvpInput } from '@/domain/rsvp';
import { loadForPrincipal, namesFor, validateFor } from './context';
import { draftInputSchema, proposalSchema, submitInputSchema, type DraftRsvpInput } from './schemas';
import { requireGuestPrincipal, windowSchema } from './shared';

const output = z.object({
  proposal: proposalSchema,
  /** Pass this object unchanged as the input of submit_rsvp, with the confirmation token. */
  submission: submitInputSchema,
  window: windowSchema,
});
export type DraftRsvpOutput = z.infer<typeof output>;

/** Draft inputs are normalized to the strict submission shape before hashing. */
export function toHouseholdInput(i: DraftRsvpInput): HouseholdRsvpInput {
  return {
    responses: i.responses.map((r) => ({
      guestId: r.guestId,
      eventId: r.eventId,
      status: r.status,
      mealOptionId: r.mealOptionId ?? null,
      plusOne: r.plusOne ? { attending: r.plusOne.attending, name: r.plusOne.name ?? null, mealOptionId: r.plusOne.mealOptionId ?? null } : null,
    })),
    needs: (i.needs ?? []).map((n) => ({ guestId: n.guestId, dietary: n.dietary ?? null, accessibility: n.accessibility ?? null })),
  };
}

export const draftRsvp = defineCapability<DraftRsvpInput, DraftRsvpOutput>({
  name: 'draft_rsvp',
  title: 'Draft an RSVP',
  description:
    "Checks a proposed household RSVP (per person, per event: attending or not, meal choice, plus-one where the invitation allows one) against the guest's invitation " +
    'and returns a readable proposal plus a confirmation token. It changes nothing. The guest must review the proposal on the website and confirm it with submit_rsvp. ' +
    'Dietary and accessibility notes are accepted here but are only ever shown on the website.',
  kind: 'draft',
  auth: 'guest',
  requires: ['rsvp_self'],
  annotations: { readOnlyHint: false, untrustedContentHint: true, consequentialHint: false },
  exposure: { ui: true, ai: true, webmcp: true },
  input: draftInputSchema,
  output,
  maxOutputChars: 12_000,
  async handler(ctx, i) {
    const p = requireGuestPrincipal(ctx);
    if (!p.ok) return err(p.error);
    const { confirmation } = appServices(ctx);
    if (!confirmation) return err(new CapabilityError('internal', 'Something went wrong on our side. Please try again in a moment.'));
    const hc = await loadForPrincipal(ctx, p.value);
    const validated = validateFor(hc, p.value.actsFor, 'guest', toHouseholdInput(i));
    if (!validated.ok) return err(validated.error);
    const submission = submitInputSchema.parse(validated.value);
    const proposal = buildProposal(submission, namesFor(hc));
    const issued = confirmation.issue({ capability: 'submit_rsvp', principalRef: toPrincipalRef(ctx.principal), payloadHash: stableHash(submission) }, { now: ctx.now });
    return ok({
      data: { proposal, submission, window: hc.window },
      sources: [],
      confirmation: { token: issued.token, expiresAt: issued.expiresAt, summary: proposal.summary },
    });
  },
});
