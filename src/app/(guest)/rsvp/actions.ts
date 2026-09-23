'use server';

import { invoke } from '@/capabilities';
import { draftRsvp, submitRsvp } from '@/capabilities/rsvp';
import { submitInputSchema } from '@/capabilities/rsvp/schemas';
import { ID_PATTERN, newId } from '@/contracts/ids';
import { RSVP_PARTS, type RsvpPart } from '@/domain/rsvp/parts';
import { fieldNames, type RsvpFormState, type RsvpFormValues } from '@/components/rsvp/types';
import { uiContext } from '../_shared/principal';

const RETRY = 'We could not save that just now. Please try again in a moment — and if it keeps happening, reach Sara and Tyler directly.';

const str = (fd: FormData, key: string): string | null => {
  const v = fd.get(key);
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length ? t : null;
};

const ROW_FIELD = /^(status|meal|p1|p1name|p1meal):([^:]+):([^:]+)$/;

/**
 * Rebuilds the draft input from the form. A form asks only some parts of the RSVP (`parts`, one
 * hidden input each), so a row is whatever (guest, event) any rendered field names: the meals page
 * has no attendance radios, and its rows are built from the meal selects alone. When attendance IS
 * asked, a person left unanswered is left out, as before — a partial household reply is allowed.
 */
function parseDraft(fd: FormData) {
  const parts = fd.getAll('parts').filter((p): p is RsvpPart => typeof p === 'string' && (RSVP_PARTS as readonly string[]).includes(p));
  const asksAttendance = parts.length === 0 || parts.includes('attendance');
  const rows = new Map<string, { guestId: string; eventId: string }>();
  const guests = new Set<string>();
  for (const key of new Set([...fd.keys()])) {
    const m = ROW_FIELD.exec(key);
    if (m) {
      const [, , g, e] = m as unknown as [string, string, string, string];
      if (ID_PATTERN.test(g) && ID_PATTERN.test(e)) rows.set(`${g}:${e}`, { guestId: g, eventId: e });
      continue;
    }
    const n = /^(dietary|accessibility):([^:]+)$/.exec(key);
    if (n && ID_PATTERN.test(n[2]!)) guests.add(n[2]!);
  }
  const responses: Array<{ guestId: string; eventId: string; status: 'accepted' | 'declined' | null; mealOptionId: string | null; plusOne: { attending: boolean; name: string | null; mealOptionId: string | null } | null }> = [];
  for (const { guestId: g, eventId: e } of rows.values()) {
    const raw = str(fd, fieldNames.status(g, e));
    const status = raw === 'accepted' || raw === 'declined' ? raw : null;
    if (asksAttendance && !status) continue;
    const hasPlusOneFields = fd.has(fieldNames.plusOne(g, e)) || fd.has(fieldNames.plusOneName(g, e)) || fd.has(fieldNames.plusOneMeal(g, e));
    responses.push({
      guestId: g,
      eventId: e,
      status,
      mealOptionId: str(fd, fieldNames.meal(g, e)),
      plusOne: hasPlusOneFields ? { attending: str(fd, fieldNames.plusOne(g, e)) === 'yes', name: str(fd, fieldNames.plusOneName(g, e)), mealOptionId: str(fd, fieldNames.plusOneMeal(g, e)) } : null,
    });
  }
  const needs: Array<{ guestId: string; dietary: string | null; accessibility: string | null }> = [];
  for (const g of guests) needs.push({ guestId: g, dietary: str(fd, fieldNames.dietary(g)), accessibility: str(fd, fieldNames.accessibility(g)) });
  return { ...(parts.length ? { parts } : {}), responses, needs };
}

/** Maps capability issue paths (`responses.2.plusOne.name`) onto form field names. */
function mapIssues(issues: Array<{ path: string; message: string }>, input: ReturnType<typeof parseDraft>): { errors: Record<string, string>; messages: string[] } {
  const errors: Record<string, string> = {};
  const messages: string[] = [];
  for (const issue of issues) {
    const r = /^responses\.(\d+)(?:\.(.+))?$/.exec(issue.path);
    const n = /^needs\.(\d+)\.(dietary|accessibility)$/.exec(issue.path);
    if (r) {
      const row = input.responses[Number(r[1])];
      if (!row) {
        messages.push(issue.message);
        continue;
      }
      const sub = r[2];
      const { guestId: g, eventId: e } = row;
      const key =
        sub === 'mealOptionId' ? fieldNames.meal(g, e)
        : sub === 'plusOne.name' ? fieldNames.plusOneName(g, e)
        : sub === 'plusOne.mealOptionId' ? fieldNames.plusOneMeal(g, e)
        : sub === 'plusOne' ? fieldNames.plusOne(g, e)
        : fieldNames.status(g, e);
      errors[key] ??= issue.message;
    } else if (n) {
      const row = input.needs[Number(n[1])];
      if (row) errors[n[2] === 'dietary' ? fieldNames.dietary(row.guestId) : fieldNames.accessibility(row.guestId)] ??= issue.message;
      else messages.push(issue.message);
    } else messages.push(issue.message);
  }
  return { errors, messages };
}

/** What to re-fill the form with after a failed draft: exactly what the guest entered. */
const toValues = (input: ReturnType<typeof parseDraft>): RsvpFormValues => ({ responses: input.responses, needs: input.needs });

/** One action, three intents: draft (review), confirm (submit), edit (back to the form). */
export async function rsvpAction(_prev: RsvpFormState, fd: FormData): Promise<RsvpFormState> {
  const intent = str(fd, 'intent') ?? 'draft';
  try {
    if (intent === 'edit') {
      const parsed = submitInputSchema.safeParse(JSON.parse(str(fd, 'submission') ?? '{}'));
      return { stage: 'form', errors: {}, messages: [], values: parsed.success ? parsed.data : null, failure: false };
    }
    if (intent === 'confirm') {
      const submission = submitInputSchema.safeParse(JSON.parse(str(fd, 'submission') ?? '{}'));
      const token = str(fd, 'token');
      const idempotencyKey = str(fd, 'idempotencyKey') ?? newId();
      if (!submission.success || !token) return { stage: 'form', errors: {}, messages: ['Your review timed out — please check your answers and confirm again.'], values: submission.success ? submission.data : null, failure: false };
      const { ctx } = await uiContext({ idempotencyKey, confirmationToken: token });
      const result = await invoke(submitRsvp, ctx, submission.data);
      if (result.ok) return { stage: 'done', result: result.value.data };
      const { code, message } = result.error;
      if (code === 'confirmation_required') return { stage: 'form', errors: {}, messages: ['Your review timed out — please check your answers and confirm again.'], values: submission.data, failure: false };
      if (code === 'validation' || code === 'forbidden' || code === 'conflict') {
        const issues = (result.error.details?.issues as Array<{ path: string; message: string }> | undefined) ?? [];
        const mapped = mapIssues(issues, submission.data);
        return { stage: 'form', errors: mapped.errors, messages: mapped.messages.length ? mapped.messages : [message], values: submission.data, failure: false };
      }
      return { stage: 'form', errors: {}, messages: [RETRY], values: submission.data, failure: true };
    }
    // draft
    const input = parseDraft(fd);
    const { ctx } = await uiContext();
    const result = await invoke(draftRsvp, ctx, input);
    if (result.ok) {
      const { proposal, submission, window } = result.value.data;
      const confirmation = result.value.confirmation!;
      return { stage: 'review', proposal, submission, token: confirmation.token, expiresAt: confirmation.expiresAt, idempotencyKey: str(fd, 'idempotencyKey') ?? newId(), editableUntil: window.deadlineAt };
    }
    const { code, message } = result.error;
    if (code === 'validation' || code === 'forbidden' || code === 'conflict') {
      const issues = (result.error.details?.issues as Array<{ path: string; message: string }> | undefined) ?? [];
      const mapped = mapIssues(issues, input);
      return { stage: 'form', errors: mapped.errors, messages: mapped.messages.length ? mapped.messages : [message], values: toValues(input), failure: false };
    }
    if (code === 'unauthenticated') return { stage: 'form', errors: {}, messages: ['Your session ended. Please open your invitation link again.'], values: toValues(input), failure: false };
    return { stage: 'form', errors: {}, messages: [RETRY], values: toValues(input), failure: true };
  } catch {
    return { stage: 'form', errors: {}, messages: [RETRY], values: null, failure: true };
  }
}
