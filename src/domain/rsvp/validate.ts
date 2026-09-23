import { mealsPublished, RSVP_PARTS, type RsvpPart } from './parts';
import { MAX_NEEDS_CHARS, MAX_PLUS_ONE_NAME_CHARS, type HouseholdRsvpDraft, type RsvpIssue, type RsvpNeedsInput, type RsvpResponseInput, type RsvpValidation, type RsvpValidationContext } from './types';

export const RSVP_CLOSED_MESSAGE = 'RSVPs are closed. If something has changed, reach out to Sara and Tyler and they will update it for you.';
const OWN_HOUSEHOLD = 'You can only RSVP for your own household.';
const NOT_INVITED = 'That guest is not invited to that event.';
const ALL_PARTS: ReadonlySet<RsvpPart> = new Set(RSVP_PARTS);

const trimOrNull = (v: string | null | undefined): string | null => {
  if (v === null || v === undefined) return null;
  const t = v.trim();
  return t.length ? t : null;
};

/**
 * Pure household RSVP validation + normalization. Order of precedence when several things are
 * wrong: ownership/entitlement violations (forbidden) > closed window > field problems.
 * Never throws; never includes needs text in issues.
 *
 * `ctx.parts` names the parts being answered; the returned value is the merged row — answered parts
 * from `raw`, the rest from `ctx.onFile` — which is exactly what gets persisted.
 */
export function validateHouseholdRsvp(raw: HouseholdRsvpDraft, ctx: RsvpValidationContext): RsvpValidation {
  const forbidden: RsvpIssue[] = [];
  const invalid: RsvpIssue[] = [];
  const eventsById = new Map(ctx.events.map((e) => [e.id, e]));
  const entitlementKey = (g: string, e: string) => `${g}::${e}`;
  const entitlements = new Map(ctx.entitlements.map((en) => [entitlementKey(en.guestId, en.eventId), en]));
  const optionById = new Map(ctx.mealOptions.map((m) => [m.id, m]));
  const parts = ctx.parts ?? ALL_PARTS;

  const answersRows = parts.has('attendance') || parts.has('plusOne') || parts.has('meal');
  if (answersRows ? !Array.isArray(raw.responses) || raw.responses.length === 0 : !raw.needs?.length) {
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

    // Every field belongs to one part. A part this submission answers comes from `r` and is
    // validated; any other part is carried over from what is on file, untouched and unjudged — it
    // was valid when it was written, and re-checking it here would block a guest from answering
    // attendance because of a meal they are not being asked about.
    const prior = ctx.onFile?.get(dupKey) ?? null;
    const status = parts.has('attendance') ? r.status : (prior?.status ?? null);
    if (!status) {
      invalid.push({ path: `${path}.status`, message: parts.has('attendance') ? 'Please tell us whether they are coming.' : 'Please tell us whether they are coming first.', code: 'invalid' });
      return;
    }
    const kept = prior?.status === 'accepted' ? prior : null;
    const menu = mealsPublished(event, ctx.mealOptions);
    const checkMeal = (value: string | null | undefined, at: string, missing: string): string | null => {
      const meal = trimOrNull(value);
      if (!menu) {
        if (meal) invalid.push({ path: at, message: event.hasMeal ? 'The menu for this event is not ready yet.' : 'This event has no meal choice.', code: 'invalid' });
        return null;
      }
      if (!meal) {
        invalid.push({ path: at, message: missing, code: 'invalid' });
        return null;
      }
      const option = optionById.get(meal);
      if (!option || option.eventId !== event.id) invalid.push({ path: at, message: 'That meal option is not available for this event.', code: 'invalid' });
      else if (option.version !== event.mealOptionsVersion) invalid.push({ path: at, message: 'The menu has changed — please choose again.', code: 'stale_meal' });
      else return meal;
      return null;
    };

    const normalized: RsvpResponseInput = { guestId: r.guestId, eventId: r.eventId, status, mealOptionId: null, plusOne: null };
    if (status === 'accepted') {
      // A meal is answered only where this event has a menu to choose from. Where it has none yet —
      // a new menu version not published — the form asked nothing, so what is on file is carried,
      // unjudged, and keeps the version it was chosen from; a meal sent for it anyway is refused.
      const answersMeal = parts.has('meal') && menu;
      if (parts.has('meal') && !menu) checkMeal(r.mealOptionId, `${path}.mealOptionId`, '');
      normalized.mealOptionId = answersMeal ? checkMeal(r.mealOptionId, `${path}.mealOptionId`, 'Please choose a meal.') : (kept?.mealOptionId ?? null);
      normalized.mealAnswered = answersMeal;

      // Who the plus-one is (attending + name) is the plus-one part; what they eat is the meal part.
      // A guest's row answers the plus-one question only when it carries one: a draft that leaves it
      // out keeps what is on file rather than recording "not bringing anyone" by omission. An admin
      // correction is the whole row as the couple want it, so there no plus-one means no plus-one.
      const answersPlusOne = parts.has('plusOne') && entitlement.plusOnePolicy !== 'none' && (r.plusOne != null || ctx.mode === 'admin');
      let who: { attending: boolean; name: string | null } | null = null;
      if (entitlement.plusOnePolicy === 'none') {
        if (parts.has('plusOne') && r.plusOne?.attending === true) invalid.push({ path: `${path}.plusOne`, message: 'This invitation does not include a guest.', code: 'invalid' });
      } else if (answersPlusOne) {
        if (r.plusOne?.attending === true) {
          const name = trimOrNull(r.plusOne.name);
          if (entitlement.plusOnePolicy === 'named' && !name) invalid.push({ path: `${path}.plusOne.name`, message: "Please tell us your guest's name.", code: 'invalid' });
          if (name && name.length > MAX_PLUS_ONE_NAME_CHARS) invalid.push({ path: `${path}.plusOne.name`, message: `Please keep the name under ${MAX_PLUS_ONE_NAME_CHARS} characters.`, code: 'invalid' });
          who = { attending: true, name };
        } else {
          who = { attending: false, name: null };
        }
      } else if (kept?.plusOne) {
        who = { attending: kept.plusOne.attending, name: kept.plusOne.attending ? kept.plusOne.name : null };
      }
      normalized.plusOneAnswered = answersPlusOne;

      if (who?.attending) {
        if (parts.has('meal') && !menu) checkMeal(r.plusOne?.mealOptionId, `${path}.plusOne.mealOptionId`, '');
        const plusMeal = answersMeal ? checkMeal(r.plusOne?.mealOptionId, `${path}.plusOne.mealOptionId`, 'Please choose a meal for your guest.') : kept?.plusOne?.attending ? kept.plusOne.mealOptionId : null;
        normalized.plusOne = { attending: true, name: who.name, mealOptionId: plusMeal };
      } else if (who) {
        normalized.plusOne = { attending: false, name: null, mealOptionId: null };
      }
    }
    responses.push(normalized);
  });

  const needs: RsvpNeedsInput[] = [];
  const needsSeen = new Set<string>();
  (parts.has('notes') ? (raw.needs ?? []) : []).forEach((n, i) => {
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
