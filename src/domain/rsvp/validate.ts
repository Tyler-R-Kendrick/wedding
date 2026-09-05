import { MAX_NEEDS_CHARS, MAX_PLUS_ONE_NAME_CHARS, type HouseholdRsvpInput, type RsvpIssue, type RsvpNeedsInput, type RsvpResponseInput, type RsvpValidation, type RsvpValidationContext } from './types';

export const RSVP_CLOSED_MESSAGE = 'RSVPs are closed. If something has changed, reach out to Sara and Tyler and they will update it for you.';
const OWN_HOUSEHOLD = 'You can only RSVP for your own household.';
const NOT_INVITED = 'That guest is not invited to that event.';

const trimOrNull = (v: string | null | undefined): string | null => {
  if (v === null || v === undefined) return null;
  const t = v.trim();
  return t.length ? t : null;
};

/**
 * Pure household RSVP validation + normalization. Order of precedence when several things are
 * wrong: ownership/entitlement violations (forbidden) > closed window > field problems.
 * Never throws; never includes needs text in issues.
 */
export function validateHouseholdRsvp(raw: HouseholdRsvpInput, ctx: RsvpValidationContext): RsvpValidation {
  const forbidden: RsvpIssue[] = [];
  const invalid: RsvpIssue[] = [];
  const eventsById = new Map(ctx.events.map((e) => [e.id, e]));
  const entitlementKey = (g: string, e: string) => `${g}::${e}`;
  const entitlements = new Map(ctx.entitlements.map((en) => [entitlementKey(en.guestId, en.eventId), en]));
  const optionById = new Map(ctx.mealOptions.map((m) => [m.id, m]));

  if (!Array.isArray(raw.responses) || raw.responses.length === 0) {
    invalid.push({ path: 'responses', message: 'Nothing to submit yet — answer for at least one event.', code: 'invalid' });
  }

  const seen = new Set<string>();
  const responses: RsvpResponseInput[] = [];
  (raw.responses ?? []).forEach((r, i) => {
    const path = `responses.${i}`;
    if (ctx.mode === 'guest' && !ctx.actsFor.has(r.guestId)) {
      forbidden.push({ path: `${path}.guestId`, message: OWN_HOUSEHOLD, code: 'forbidden' });
      return;
    }
    const event = eventsById.get(r.eventId);
    const entitlement = entitlements.get(entitlementKey(r.guestId, r.eventId));
    if (!event || !entitlement) {
      forbidden.push({ path: `${path}.eventId`, message: NOT_INVITED, code: 'forbidden' });
      return;
    }
    const dupKey = entitlementKey(r.guestId, r.eventId);
    if (seen.has(dupKey)) {
      invalid.push({ path, message: 'Duplicate answer for the same guest and event.', code: 'invalid' });
      return;
    }
    seen.add(dupKey);

    const normalized: RsvpResponseInput = { guestId: r.guestId, eventId: r.eventId, status: r.status, mealOptionId: null, plusOne: null };
    if (r.status === 'accepted') {
      const meal = trimOrNull(r.mealOptionId);
      if (event.hasMeal) {
        if (!meal) invalid.push({ path: `${path}.mealOptionId`, message: 'Please choose a meal.', code: 'invalid' });
        else {
          const option = optionById.get(meal);
          if (!option || option.eventId !== event.id) invalid.push({ path: `${path}.mealOptionId`, message: 'That meal option is not available for this event.', code: 'invalid' });
          else if (option.version !== event.mealOptionsVersion) invalid.push({ path: `${path}.mealOptionId`, message: 'The menu has changed — please choose again.', code: 'stale_meal' });
          else normalized.mealOptionId = meal;
        }
      } else if (meal) {
        invalid.push({ path: `${path}.mealOptionId`, message: 'This event has no meal choice.', code: 'invalid' });
      }

      const plusOne = r.plusOne;
      const wantsPlusOne = !!plusOne && plusOne.attending === true;
      if (entitlement.plusOnePolicy === 'none') {
        if (wantsPlusOne) invalid.push({ path: `${path}.plusOne`, message: 'This invitation does not include a guest.', code: 'invalid' });
      } else if (plusOne) {
        const name = trimOrNull(plusOne.name);
        const plusMeal = trimOrNull(plusOne.mealOptionId);
        if (wantsPlusOne) {
          if (entitlement.plusOnePolicy === 'named' && !name) invalid.push({ path: `${path}.plusOne.name`, message: "Please tell us your guest's name.", code: 'invalid' });
          if (name && name.length > MAX_PLUS_ONE_NAME_CHARS) invalid.push({ path: `${path}.plusOne.name`, message: `Please keep the name under ${MAX_PLUS_ONE_NAME_CHARS} characters.`, code: 'invalid' });
          let plusMealOk: string | null = null;
          if (event.hasMeal) {
            if (!plusMeal) invalid.push({ path: `${path}.plusOne.mealOptionId`, message: 'Please choose a meal for your guest.', code: 'invalid' });
            else {
              const option = optionById.get(plusMeal);
              if (!option || option.eventId !== event.id) invalid.push({ path: `${path}.plusOne.mealOptionId`, message: 'That meal option is not available for this event.', code: 'invalid' });
              else if (option.version !== event.mealOptionsVersion) invalid.push({ path: `${path}.plusOne.mealOptionId`, message: 'The menu has changed — please choose again.', code: 'stale_meal' });
              else plusMealOk = plusMeal;
            }
          }
          normalized.plusOne = { attending: true, name, mealOptionId: plusMealOk };
        } else {
          normalized.plusOne = { attending: false, name: null, mealOptionId: null };
        }
      }
    }
    responses.push(normalized);
  });

  const needs: RsvpNeedsInput[] = [];
  const needsSeen = new Set<string>();
  (raw.needs ?? []).forEach((n, i) => {
    const path = `needs.${i}`;
    if (ctx.mode === 'guest' && !ctx.actsFor.has(n.guestId)) {
      forbidden.push({ path: `${path}.guestId`, message: OWN_HOUSEHOLD, code: 'forbidden' });
      return;
    }
    if (needsSeen.has(n.guestId)) {
      invalid.push({ path, message: 'Duplicate notes for the same guest.', code: 'invalid' });
      return;
    }
    needsSeen.add(n.guestId);
    const dietary = trimOrNull(n.dietary);
    const accessibility = trimOrNull(n.accessibility);
    if (dietary && dietary.length > MAX_NEEDS_CHARS) invalid.push({ path: `${path}.dietary`, message: `Please keep this under ${MAX_NEEDS_CHARS} characters.`, code: 'invalid' });
    if (accessibility && accessibility.length > MAX_NEEDS_CHARS) invalid.push({ path: `${path}.accessibility`, message: `Please keep this under ${MAX_NEEDS_CHARS} characters.`, code: 'invalid' });
    needs.push({ guestId: n.guestId, dietary, accessibility });
  });

  if (forbidden.length) return { ok: false, kind: 'forbidden', issues: forbidden };
  if (ctx.mode === 'guest' && !ctx.window.open) return { ok: false, kind: 'closed', issues: [{ path: 'window', message: RSVP_CLOSED_MESSAGE, code: 'closed' }] };
  if (invalid.length) return { ok: false, kind: 'validation', issues: invalid };
  return { ok: true, value: { responses, needs } };
}
