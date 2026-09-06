import { describe, expect, it } from 'vitest';
import { computeRsvpWindow } from '@/domain/events/window';
import { validateHouseholdRsvp } from '@/domain/rsvp/validate';
import type { HouseholdRsvpInput, RsvpValidationContext } from '@/domain/rsvp/types';

const open = computeRsvpWindow({ mode: 'open', deadlineAt: null }, 'TEASER', new Date());
const closed = computeRsvpWindow({ mode: 'closed', deadlineAt: null }, 'RSVP_OPEN', new Date());

const base: RsvpValidationContext = {
  actsFor: new Set(['G1', 'G2']),
  entitlements: [
    { guestId: 'G1', eventId: 'E-CER', plusOnePolicy: 'none' },
    { guestId: 'G1', eventId: 'E-REC', plusOnePolicy: 'named' },
    { guestId: 'G2', eventId: 'E-REC', plusOnePolicy: 'unnamed' },
    { guestId: 'G3', eventId: 'E-REC', plusOnePolicy: 'none' },
  ],
  events: [
    { id: 'E-CER', hasMeal: false, mealOptionsVersion: 0, rsvpRequired: true },
    { id: 'E-REC', hasMeal: true, mealOptionsVersion: 2, rsvpRequired: true },
  ],
  mealOptions: [
    { id: 'M-OLD', eventId: 'E-REC', version: 1 },
    { id: 'M-BEEF', eventId: 'E-REC', version: 2 },
    { id: 'M-VEG', eventId: 'E-REC', version: 2 },
    { id: 'M-OTHER', eventId: 'E-CER', version: 1 },
  ],
  window: open,
  mode: 'guest',
};

const submission = (responses: HouseholdRsvpInput['responses'], needs: HouseholdRsvpInput['needs'] = []): HouseholdRsvpInput => ({ responses, needs });
const accepted = (guestId: string, eventId: string, mealOptionId: string | null = null, plusOne: HouseholdRsvpInput['responses'][number]['plusOne'] = null) => ({ guestId, eventId, status: 'accepted' as const, mealOptionId, plusOne });

describe('computeRsvpWindow', () => {
  const now = new Date('2027-06-01T12:00:00Z');
  it('manual open/closed beat the schedule', () => {
    expect(computeRsvpWindow({ mode: 'open', deadlineAt: new Date('2020-01-01') }, 'TEASER', now)).toMatchObject({ open: true, reason: 'manual_open' });
    expect(computeRsvpWindow({ mode: 'closed', deadlineAt: null }, 'RSVP_OPEN', now)).toMatchObject({ open: false, reason: 'manual_closed' });
  });
  it('auto follows the lifecycle and the deadline', () => {
    expect(computeRsvpWindow({ mode: 'auto', deadlineAt: null }, 'TEASER', now)).toMatchObject({ open: false, reason: 'lifecycle' });
    expect(computeRsvpWindow({ mode: 'auto', deadlineAt: null }, 'RSVP_OPEN', now)).toMatchObject({ open: true, reason: 'scheduled', deadlineAt: null });
    expect(computeRsvpWindow({ mode: 'auto', deadlineAt: new Date('2027-06-01T11:59:59Z') }, 'RSVP_OPEN', now)).toMatchObject({ open: false, reason: 'deadline_passed' });
    expect(computeRsvpWindow({ mode: 'auto', deadlineAt: '2027-06-01T12:00:00Z' }, 'RSVP_OPEN', now)).toMatchObject({ open: true, deadlineAt: '2027-06-01T12:00:00.000Z' });
    expect(computeRsvpWindow({ mode: 'auto', deadlineAt: null }, 'RSVP_CLOSED', now).open).toBe(false);
  });
});

describe('validateHouseholdRsvp: meals per version', () => {
  it('requires a current-version meal when attending an event with meals', () => {
    const r = validateHouseholdRsvp(submission([accepted('G1', 'E-REC', null)]), base);
    expect(r).toMatchObject({ ok: false, kind: 'validation' });
    if (!r.ok) expect(r.issues[0]).toMatchObject({ path: 'responses.0.mealOptionId', code: 'invalid' });
  });
  it('flags a choice from an older menu version as stale and an unknown/foreign option as invalid', () => {
    const stale = validateHouseholdRsvp(submission([accepted('G1', 'E-REC', 'M-OLD')]), base);
    if (!stale.ok) expect(stale.issues[0]).toMatchObject({ code: 'stale_meal', path: 'responses.0.mealOptionId' });
    expect(stale.ok).toBe(false);
    const foreign = validateHouseholdRsvp(submission([accepted('G1', 'E-REC', 'M-OTHER')]), base);
    expect(!foreign.ok && foreign.issues[0]?.code).toBe('invalid');
    const unknown = validateHouseholdRsvp(submission([accepted('G1', 'E-REC', 'nope')]), base);
    expect(unknown.ok).toBe(false);
  });
  it('accepts a current option, rejects a meal on an event without meals, and clears meals on decline', () => {
    const ok = validateHouseholdRsvp(submission([accepted('G1', 'E-REC', 'M-VEG')]), base);
    expect(ok.ok && ok.value.responses[0]?.mealOptionId).toBe('M-VEG');
    const noMeal = validateHouseholdRsvp(submission([accepted('G1', 'E-CER', 'M-VEG')]), base);
    expect(noMeal.ok).toBe(false);
    const declined = validateHouseholdRsvp(submission([{ guestId: 'G1', eventId: 'E-REC', status: 'declined', mealOptionId: 'M-OLD', plusOne: { attending: true, name: 'X', mealOptionId: 'M-BEEF' } }]), base);
    expect(declined.ok && declined.value.responses[0]).toEqual({ guestId: 'G1', eventId: 'E-REC', status: 'declined', mealOptionId: null, plusOne: null });
  });
});

describe('validateHouseholdRsvp: plus-one semantics', () => {
  it('none: a guest is rejected', () => {
    const r = validateHouseholdRsvp(submission([accepted('G1', 'E-CER', null, { attending: true, name: 'Pat', mealOptionId: null })]), base);
    expect(!r.ok && r.issues[0]).toMatchObject({ path: 'responses.0.plusOne', code: 'invalid' });
    const declinedPlusOne = validateHouseholdRsvp(submission([accepted('G1', 'E-CER', null, { attending: false, name: null, mealOptionId: null })]), base);
    expect(declinedPlusOne.ok && declinedPlusOne.value.responses[0]?.plusOne).toBeNull();
  });
  it('named: a name and (with meals) a meal are required', () => {
    const noName = validateHouseholdRsvp(submission([accepted('G1', 'E-REC', 'M-BEEF', { attending: true, name: '  ', mealOptionId: 'M-BEEF' })]), base);
    expect(!noName.ok && noName.issues.map((i) => i.path)).toEqual(['responses.0.plusOne.name']);
    const noMeal = validateHouseholdRsvp(submission([accepted('G1', 'E-REC', 'M-BEEF', { attending: true, name: 'Pat Guest', mealOptionId: null })]), base);
    expect(!noMeal.ok && noMeal.issues.map((i) => i.path)).toEqual(['responses.0.plusOne.mealOptionId']);
    const staleMeal = validateHouseholdRsvp(submission([accepted('G1', 'E-REC', 'M-BEEF', { attending: true, name: 'Pat Guest', mealOptionId: 'M-OLD' })]), base);
    expect(!staleMeal.ok && staleMeal.issues[0]?.code).toBe('stale_meal');
    const ok = validateHouseholdRsvp(submission([accepted('G1', 'E-REC', 'M-BEEF', { attending: true, name: ' Pat Guest ', mealOptionId: 'M-VEG' })]), base);
    expect(ok.ok && ok.value.responses[0]?.plusOne).toEqual({ attending: true, name: 'Pat Guest', mealOptionId: 'M-VEG' });
  });
  it('unnamed: the name is optional; not attending clears the name and meal', () => {
    const ok = validateHouseholdRsvp(submission([accepted('G2', 'E-REC', 'M-BEEF', { attending: true, name: '', mealOptionId: 'M-BEEF' })]), base);
    expect(ok.ok && ok.value.responses[0]?.plusOne).toEqual({ attending: true, name: null, mealOptionId: 'M-BEEF' });
    const off = validateHouseholdRsvp(submission([accepted('G2', 'E-REC', 'M-BEEF', { attending: false, name: 'Someone', mealOptionId: 'M-BEEF' })]), base);
    expect(off.ok && off.value.responses[0]?.plusOne).toEqual({ attending: false, name: null, mealOptionId: null });
  });
});

describe('validateHouseholdRsvp: ownership, entitlement, deadline', () => {
  it('rejects guests outside actsFor and events the guest is not invited to as forbidden', () => {
    const other = validateHouseholdRsvp(submission([accepted('G3', 'E-REC', 'M-BEEF')]), base);
    expect(other).toMatchObject({ ok: false, kind: 'forbidden' });
    const notInvited = validateHouseholdRsvp(submission([accepted('G2', 'E-CER')]), base);
    expect(notInvited).toMatchObject({ ok: false, kind: 'forbidden' });
    const needsForOther = validateHouseholdRsvp(submission([accepted('G1', 'E-CER')], [{ guestId: 'G3', dietary: 'x', accessibility: null }]), base);
    expect(needsForOther).toMatchObject({ ok: false, kind: 'forbidden' });
  });
  it('forbidden beats closed beats validation; a closed window rejects guests but not admin corrections', () => {
    const ctxClosed = { ...base, window: closed };
    expect(validateHouseholdRsvp(submission([accepted('G3', 'E-REC', null)]), ctxClosed)).toMatchObject({ ok: false, kind: 'forbidden' });
    expect(validateHouseholdRsvp(submission([accepted('G1', 'E-REC', null)]), ctxClosed)).toMatchObject({ ok: false, kind: 'closed' });
    expect(validateHouseholdRsvp(submission([accepted('G1', 'E-REC', 'M-BEEF')]), ctxClosed)).toMatchObject({ ok: false, kind: 'closed' });
    const admin = validateHouseholdRsvp(submission([accepted('G3', 'E-REC', 'M-BEEF')]), { ...ctxClosed, mode: 'admin' });
    expect(admin.ok).toBe(true);
    const adminStillValidates = validateHouseholdRsvp(submission([accepted('G3', 'E-CER')]), { ...ctxClosed, mode: 'admin' });
    expect(adminStillValidates).toMatchObject({ ok: false, kind: 'forbidden' });
  });
  it('rejects empty submissions, duplicates, and over-long needs; trims and nulls needs text', () => {
    expect(validateHouseholdRsvp(submission([]), base)).toMatchObject({ ok: false, kind: 'validation' });
    const dup = validateHouseholdRsvp(submission([accepted('G1', 'E-CER'), accepted('G1', 'E-CER')]), base);
    expect(!dup.ok && dup.issues[0]?.message).toMatch(/Duplicate/);
    const long = validateHouseholdRsvp(submission([accepted('G1', 'E-CER')], [{ guestId: 'G1', dietary: 'x'.repeat(501), accessibility: null }]), base);
    expect(!long.ok && long.issues[0]?.path).toBe('needs.0.dietary');
    const ok = validateHouseholdRsvp(submission([accepted('G1', 'E-CER')], [{ guestId: 'G1', dietary: '  nut allergy ', accessibility: '' }]), base);
    expect(ok.ok && ok.value.needs[0]).toEqual({ guestId: 'G1', dietary: 'nut allergy', accessibility: null });
  });
});
