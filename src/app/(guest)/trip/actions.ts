'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { field, noticeForError, runAsUi, toFormError, type FormError } from '@/app/(public)/travel/_shared/server';
import { addTripItemCapability, deleteMyTravelProfile, openBookingLink, removeTripItemCapability, updateMyTravelProfile, updateTripItemCapability } from '@/capabilities/travel';
import type { TravelProfile } from '@/domain/travel';

export type ProfileFormState = { status: 'idle' | 'saved'; values: Record<string, string>; profile?: TravelProfile } | { status: 'error'; error: FormError; values: Record<string, string> };
export type AddItemFormState = { status: 'idle' | 'added'; values: Record<string, string> } | { status: 'error'; error: FormError; values: Record<string, string> };

const PROFILE_FIELDS = ['homeCity', 'homeRegion', 'preferredAirport', 'alternateAirports', 'adults', 'children', 'airlinePreference', 'nonstopPreferred', 'cabin', 'arriveEarliest', 'arriveLatest', 'departEarliest', 'departLatest'] as const;
const ITEM_FIELDS = ['kind', 'title', 'startAt', 'endAt', 'timezone', 'providerRef', 'origin', 'destination', 'carrier', 'flightNumber', 'hotelName', 'address', 'note'] as const;

const compact = <T extends Record<string, unknown>>(o: T): Partial<T> => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;

/** Saving is the opt-in. Every field is sent back so the profile is replaced as a whole. */
export async function saveProfileAction(_prev: ProfileFormState, fd: FormData): Promise<ProfileFormState> {
  const values = field.values(fd, PROFILE_FIELDS);
  const input = {
    homeCity: field.str(fd, 'homeCity') ?? null,
    homeRegion: field.str(fd, 'homeRegion') ?? null,
    preferredAirport: field.str(fd, 'preferredAirport') ?? null,
    alternateAirports: field.list(fd, 'alternateAirports'),
    adults: field.int(fd, 'adults') ?? 1,
    children: field.int(fd, 'children') ?? 0,
    airlinePreference: field.str(fd, 'airlinePreference') ?? null,
    nonstopPreferred: field.bool(fd, 'nonstopPreferred'),
    cabin: field.str(fd, 'cabin') ?? 'economy',
    arriveEarliest: field.str(fd, 'arriveEarliest') ?? null,
    arriveLatest: field.str(fd, 'arriveLatest') ?? null,
    departEarliest: field.str(fd, 'departEarliest') ?? null,
    departLatest: field.str(fd, 'departLatest') ?? null,
  };
  const r = await runAsUi(updateMyTravelProfile, input, { idempotencyKey: field.idempotencyKey(fd) });
  if (!r.ok) return { status: 'error', error: toFormError(r.error), values };
  revalidatePath('/trip');
  revalidatePath('/travel');
  return { status: 'saved', values, profile: r.value.data };
}

export async function deleteProfileAction(fd: FormData): Promise<void> {
  const r = await runAsUi(deleteMyTravelProfile, {}, { idempotencyKey: field.idempotencyKey(fd) });
  revalidatePath('/trip');
  redirect(`/trip?notice=${r.ok ? 'profile_deleted' : noticeForError(r.error)}`);
}

export async function addItemAction(_prev: AddItemFormState, fd: FormData): Promise<AddItemFormState> {
  const values = field.values(fd, ITEM_FIELDS);
  const details = compact({
    origin: field.str(fd, 'origin'),
    destination: field.str(fd, 'destination'),
    carrier: field.str(fd, 'carrier'),
    flightNumber: field.str(fd, 'flightNumber'),
    hotelName: field.str(fd, 'hotelName'),
    address: field.str(fd, 'address'),
    note: field.str(fd, 'note'),
  });
  const input = compact({
    kind: field.str(fd, 'kind'),
    title: field.str(fd, 'title'),
    startAt: field.str(fd, 'startAt'),
    endAt: field.str(fd, 'endAt'),
    timezone: field.str(fd, 'timezone'),
    providerRef: field.str(fd, 'providerRef'),
    details,
  });
  const r = await runAsUi(addTripItemCapability, input, { idempotencyKey: field.idempotencyKey(fd) });
  if (!r.ok) return { status: 'error', error: toFormError(r.error), values };
  revalidatePath('/trip');
  return { status: 'added', values: {} };
}

const NOTICE_FOR_OP: Record<string, string> = { confirm: 'confirmed', cancel: 'cancelled', reopen: 'reopened', remove: 'removed' };

/** One-click item operations. "confirm" is the guest's own statement; a link click never gets here. */
export async function itemAction(fd: FormData): Promise<void> {
  const op = field.str(fd, 'op') ?? '';
  const itemId = field.str(fd, 'itemId') ?? '';
  const key = field.idempotencyKey(fd);
  const r =
    op === 'remove'
      ? await runAsUi(removeTripItemCapability, { itemId }, { idempotencyKey: key })
      : await runAsUi(updateTripItemCapability, compact({ action: op, itemId, providerRef: field.str(fd, 'providerRef') }), { idempotencyKey: key });
  revalidatePath('/trip');
  redirect(`/trip?notice=${r.ok ? (NOTICE_FOR_OP[op] ?? 'saved') : noticeForError(r.error)}`);
}

/** Hosted checkout (Duffel Links): the capability creates the session and the allowlisted URL; we hand the guest over. */
export async function hostedFlightsAction(fd: FormData): Promise<void> {
  const r = await runAsUi(openBookingLink, compact({ kind: 'hosted_flights', origin: field.str(fd, 'origin'), destination: field.str(fd, 'destination'), departDate: field.str(fd, 'departDate'), returnDate: field.str(fd, 'returnDate'), adults: field.int(fd, 'adults') }));
  if (!r.ok || !r.value.handoffUrl) redirect(`/trip?notice=${r.ok ? 'error' : noticeForError(r.error)}`);
  redirect(r.value.handoffUrl);
}
