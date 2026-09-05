'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { field, noticeForError, runAsUi } from '@/app/(public)/travel/_shared/server';
import { adminRemoveHotel, adminRemoveTravelLink, adminSaveHotel, adminSaveTravelLink } from '@/capabilities/travel';

const compact = <T extends Record<string, unknown>>(o: T): Partial<T> => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;

const finish = (ok: boolean, error: { code: string; message: string } | undefined, notice: string): never => {
  revalidatePath('/admin/travel');
  revalidatePath('/travel');
  revalidatePath('/trip');
  redirect(`/admin/travel?notice=${ok ? notice : noticeForError(error as never)}`);
};

/** Reasons arrive one per line as `kind | text | value`. */
function parseReasons(raw: string | undefined) {
  if (!raw) return [];
  return raw
    .split('\n')
    .map((line) => line.split('|').map((p) => p.trim()))
    .filter((parts) => parts[0] && parts[1])
    .map(([kind, text, value]) => compact({ kind, text, value: value === undefined || value === '' ? undefined : Number.isFinite(Number(value)) ? Number(value) : value }));
}

export async function saveHotelAction(fd: FormData): Promise<void> {
  const isVenue = field.bool(fd, 'isVenue');
  const block = isVenue
    ? {
        url: field.str(fd, 'blockUrl') ?? null,
        code: field.str(fd, 'blockCode') ?? null,
        rateText: field.str(fd, 'blockRateText') ?? null,
        checkIn: field.str(fd, 'blockCheckIn') ?? null,
        checkOut: field.str(fd, 'blockCheckOut') ?? null,
        cutoff: field.str(fd, 'blockCutoff') ?? null,
        note: field.str(fd, 'blockNote') ?? null,
        placeholder: field.bool(fd, 'blockPlaceholder'),
      }
    : null;
  const input = compact({
    id: field.str(fd, 'id'),
    name: field.str(fd, 'name'),
    address: field.str(fd, 'address') ?? null,
    isVenue,
    sortOrder: field.int(fd, 'sortOrder'),
    reasons: parseReasons(field.str(fd, 'reasons')),
    priceBand: field.str(fd, 'priceBand') ?? null,
    walkMinutesToVenue: field.int(fd, 'walkMinutesToVenue') ?? null,
    websiteUrl: field.str(fd, 'websiteUrl') ?? null,
    bookingUrl: field.str(fd, 'bookingUrl') ?? null,
    block,
    placeholder: field.bool(fd, 'placeholder'),
    active: field.bool(fd, 'active'),
    sourceId: field.str(fd, 'sourceId') ?? null,
  });
  const r = await runAsUi(adminSaveHotel, input, { idempotencyKey: field.idempotencyKey(fd) });
  finish(r.ok, r.ok ? undefined : r.error, 'saved');
}

export async function removeHotelAction(fd: FormData): Promise<void> {
  const r = await runAsUi(adminRemoveHotel, { hotelId: field.str(fd, 'id') }, { idempotencyKey: field.idempotencyKey(fd) });
  finish(r.ok, r.ok ? undefined : r.error, 'removed');
}

export async function saveLinkAction(fd: FormData): Promise<void> {
  const input = compact({
    id: field.str(fd, 'id'),
    category: field.str(fd, 'category'),
    provider: field.str(fd, 'provider'),
    label: field.str(fd, 'label'),
    url: field.str(fd, 'url'),
    note: field.str(fd, 'note') ?? null,
    sortOrder: field.int(fd, 'sortOrder'),
    active: field.bool(fd, 'active'),
  });
  const r = await runAsUi(adminSaveTravelLink, input, { idempotencyKey: field.idempotencyKey(fd) });
  finish(r.ok, r.ok ? undefined : r.error, 'saved');
}

export async function removeLinkAction(fd: FormData): Promise<void> {
  const r = await runAsUi(adminRemoveTravelLink, { linkId: field.str(fd, 'id') }, { idempotencyKey: field.idempotencyKey(fd) });
  finish(r.ok, r.ok ? undefined : r.error, 'removed');
}
