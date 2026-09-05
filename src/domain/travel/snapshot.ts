import type { LiveSnapshot } from '@/contracts/providers';
import type { TransferKind } from '@/providers/flights/types';

/**
 * Live results are snapshots. They carry the provider's timestamp and a TTL; past the TTL the UI
 * must ask for a refresh instead of presenting the price, and every price says "refresh before
 * booking" because the provider's checkout price is the only real one.
 */
export type SnapshotStatus = 'fresh' | 'stale';

export const REFRESH_BEFORE_BOOKING = 'Prices move. Refresh before you book; the price the provider shows at checkout is the one that counts.';

export function snapshotExpiresAt(s: Pick<LiveSnapshot<unknown>, 'retrievedAt' | 'ttlSeconds'>): string {
  return new Date(Date.parse(s.retrievedAt) + s.ttlSeconds * 1000).toISOString();
}

export function snapshotStatus(s: Pick<LiveSnapshot<unknown>, 'retrievedAt' | 'ttlSeconds'>, now: Date = new Date()): SnapshotStatus {
  const retrieved = Date.parse(s.retrievedAt);
  if (!Number.isFinite(retrieved)) return 'stale';
  return now.getTime() - retrieved <= s.ttlSeconds * 1000 ? 'fresh' : 'stale';
}

export function isSnapshotUsable(s: Pick<LiveSnapshot<unknown>, 'retrievedAt' | 'ttlSeconds'>, now: Date = new Date()): boolean {
  return snapshotStatus(s, now) === 'fresh';
}

export function transferLabel(kind: TransferKind): { label: string; caution?: string } {
  switch (kind) {
    case 'nonstop':
      return { label: 'Nonstop' };
    case 'protected':
      return { label: 'Connection on one ticket', caution: 'If a delay makes you miss the connection, the airline rebooks you.' };
    case 'self_transfer':
      return { label: 'Separate tickets (self-transfer)', caution: 'Two separate bookings: if the first flight is late, the second airline will not rebook you. Allow extra time or choose a protected option.' };
  }
}

export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? (m ? `${h} h ${m} min` : `${h} h`) : `${m} min`;
}

export function formatMoney(cents: number | undefined, currency = 'USD'): string | undefined {
  if (cents === undefined) return undefined;
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(0)} ${currency}`;
  }
}
