import { defineCapability } from '@/contracts/capability';
import { toPrincipalRef } from '@/contracts/principal';
import { err, ok } from '@/contracts/result';
import { appServices } from '@/capabilities/context';
import { publicEnv } from '@/lib/env.public';
import { buildConfirmationEmail, buildProposal, persistHouseholdRsvp, queueRsvpConfirmation } from '@/domain/rsvp';
import { loadForPrincipal, namesFor, validateFor } from './context';
import { submitInputSchema, submitOutputSchema, type SubmitRsvpInput, type SubmitRsvpOutput } from './schemas';
import { requireGuestPrincipal } from './shared';

/**
 * Persists a household RSVP. The review is rendered inline on the RSVP page, and the pipeline's
 * `explicit` confirmation mode is what verifies the draft_rsvp token: bound to this principal and
 * the exact payload, single-use, redeemable only from the `ui` surface. Idempotent by key (the
 * pipeline reserves it before the handler). UI-only exposure: assistants draft, the guest confirms
 * on the website (ADR-0002 §4, design-doc decision 9).
 */
export const submitRsvp = defineCapability<SubmitRsvpInput, SubmitRsvpOutput>({
  name: 'submit_rsvp',
  title: 'Submit RSVP',
  description:
    'Records the household RSVP exactly as returned by draft_rsvp, after the guest has reviewed it. Requires the confirmation token from draft_rsvp and an idempotency key. ' +
    'Editable again until the deadline. Sends a confirmation e-mail.',
  kind: 'action',
  auth: 'guest',
  requires: ['rsvp_self'],
  confirmation: 'explicit',
  idempotent: true,
  annotations: { readOnlyHint: false, untrustedContentHint: true, consequentialHint: true },
  exposure: { ui: true, ai: false, webmcp: false },
  input: submitInputSchema,
  output: submitOutputSchema,
  async handler(ctx, i) {
    const p = requireGuestPrincipal(ctx);
    if (!p.ok) return err(p.error);
    const { db } = appServices(ctx);
    const actor = toPrincipalRef(ctx.principal);

    // Re-validate at submit time: the window may have closed or the menu changed since the draft.
    const hc = await loadForPrincipal(ctx, p.value);
    const validated = validateFor(hc, p.value.actsFor, 'guest', i);
    if (!validated.ok) return err(validated.error);

    const mealVersionByEvent = new Map(hc.entitledEvents.map((e) => [e.id, e.mealOptionsVersion]));
    await persistHouseholdRsvp(db, validated.value, { submittedBy: actor, via: 'guest', now: ctx.now, mealVersionByEvent });
    const proposal = buildProposal(validated.value, namesFor(hc));
    const householdId = hc.household?.id ?? p.value.householdId;

    // Domain audit: counts only. Never needs text, never per-person choices.
    await ctx.audit.record({
      actor,
      action: 'rsvp.submitted',
      target: { type: 'household', id: householdId },
      outcome: 'success',
      requestId: ctx.requestId,
      metadata: { responses: validated.value.responses.length, accepted: proposal.lines.filter((l) => l.status === 'accepted').length, needsRows: validated.value.needs.length, via: 'guest' },
    });

    const self = hc.guests.find((g) => g.id === p.value.guestId);
    const editableUntil = hc.window.deadlineAt;
    let emailQueued = false;
    if (self) {
      const email = buildConfirmationEmail(proposal, {
        firstName: self.firstName,
        editableUntil: editableUntil ? new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(new Date(editableUntil)) : null,
        rsvpUrl: `${publicEnv.siteUrl}/rsvp`,
      });
      await queueRsvpConfirmation(db, { householdId, recipientGuestId: self.id, subject: email.subject, body: email.body, now: ctx.now });
      emailQueued = true;
    }

    return ok({
      data: { submittedAt: ctx.now.toISOString(), householdId, lines: proposal.lines, needsRecordedFor: proposal.needsRecordedFor, emailQueued, window: hc.window, editableUntil },
      sources: [],
    });
  },
});
