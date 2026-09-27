'use client';

/**
 * Where an unfinished admin flow is kept between page loads.
 *
 * `sessionStorage`, deliberately, not `localStorage`: a draft here can hold the couple's Zelle email
 * or mailing address, and a tab-scoped store is gone when the tab closes, while still surviving the
 * two things that used to throw a half-typed form away — a reload, and the round trip to /step-up
 * that every change to where money goes requires. A finished or discarded flow deletes its draft.
 * Nothing here ever reaches the server; the capability call is what saves.
 *
 * Every access is wrapped: storage can be switched off, full, or throw in a private window, and a
 * flow without a draft still works — it just starts from the beginning.
 */
export interface StoredDraft<V> {
  values: V;
  step: number;
  /** The flow was open when this was written (so a reload reopens it where it was). */
  open: boolean;
  /** Written just before leaving for /step-up: on the way back, the flow reopens at its last step. */
  stepUp?: boolean;
  savedAt: number;
}

const PREFIX = 'wedding.admin-flow:';
/** A draft older than this is dropped rather than resumed: nobody wants yesterday's half-finished form. */
const MAX_AGE_MS = 12 * 60 * 60 * 1000;

export function readDraft<V>(key: string): StoredDraft<V> | null {
  try {
    const raw = window.sessionStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const d = JSON.parse(raw) as StoredDraft<V>;
    if (typeof d !== 'object' || d === null || typeof d.step !== 'number' || Date.now() - d.savedAt > MAX_AGE_MS) {
      window.sessionStorage.removeItem(PREFIX + key);
      return null;
    }
    return d;
  } catch {
    return null;
  }
}

export function writeDraft<V>(key: string, draft: Omit<StoredDraft<V>, 'savedAt'>): void {
  try {
    window.sessionStorage.setItem(PREFIX + key, JSON.stringify({ ...draft, savedAt: Date.now() }));
  } catch {
    // Storage unavailable: the flow still works, it just will not survive a reload.
  }
}

export function clearDraft(key: string): void {
  try {
    window.sessionStorage.removeItem(PREFIX + key);
  } catch {
    // Nothing to clear.
  }
}
